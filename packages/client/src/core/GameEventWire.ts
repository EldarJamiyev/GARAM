import * as THREE from 'three';
import {
  WEAPONS,
  SPAWN_POINTS,
  HitZone,
  SurfaceMaterial,
  WeaponDef,
  MapBlockCollider,
  AABBCollider,
  SpatialGrid,
  KinematicPlayerController,
} from '@garam/shared';
import { settingsStore, BotDifficulty, CrosshairConfig, PlayerFaction } from './SettingsStore.js';
import { BotEntity } from '../maps/DeCitadelMap.js';
import { BotAISystem, BotAISystemCallbacks } from '../match/BotAISystem.js';
import { WeaponController, WeaponCombatCallbacks } from '../combat/WeaponController.js';
import { RoundManager, RoundCallbacks, RoundPhase } from '../match/RoundManager.js';
import type { CustomizerUI, CustomizerCallbacks } from '../ui/CustomizerUI.js';
import { InputManager, InputCallbacks } from './InputManager.js';
import { LobbyUICallbacks } from '../ui/LobbyUI.js';
import { BuyMenuUI, BuyMenuUICallbacks } from '../ui/BuyMenuUI.js';
import { InventoryManager, SlotNumber } from '../combat/InventoryManager.js';
import { UtilityManager, UtilityCallbacks, UtilityType } from '../utility/UtilityManager.js';
import { ProceduralAudio } from '../audio/ProceduralAudio.js';
import { HUDManager } from '../ui/HUDManager.js';
import { EffectsManager } from '../combat/EffectsManager.js';
import { DroppedWeaponManager, DroppedWeaponEntity } from '../combat/DroppedWeaponManager.js';
import { EconomyManager } from '../match/EconomyManager.js';
import { PlayerManager } from '../combat/PlayerManager.js';
import { CombatReportManager } from '../ui/CombatReportManager.js';
import { SpectatorManager } from '../match/SpectatorManager.js';
import { NetworkClient, NetworkClientCallbacks } from '../net/NetworkClient.js';
import { WeaponViewmodel } from '../viewmodel/WeaponViewmodel.js';
import { RadarRenderer } from '../ui/RadarRenderer.js';

export interface GameContext {
  canvas: HTMLCanvasElement;
  worldCamera: THREE.PerspectiveCamera;
  viewmodelCamera: THREE.PerspectiveCamera;
  worldScene: THREE.Scene;
  audio: ProceduralAudio;
  hud: HUDManager;
  effects: EffectsManager;
  droppedWeapons: DroppedWeaponManager;
  utilityManager: UtilityManager;
  radar: RadarRenderer;
  inventory: InventoryManager;
  economy: EconomyManager;
  player: KinematicPlayerController;
  playerManager: PlayerManager;
  combatReport: CombatReportManager;
  spectator: SpectatorManager;
  viewmodel: WeaponViewmodel;
  spatialGrid: SpatialGrid;
  bots: BotEntity[];
  blocks: MapBlockCollider[];
  colliders: AABBCollider[];
  spawnPos: { x: number; y: number; z: number };
  hasMatchStarted: { value: boolean };
  isFiring: { value: boolean };
  pendingFireTrigger: { value: boolean };
  isInteracting: { value: boolean };
  cameraPunchPitch: { value: number };
  syncActiveWeapon: () => void;
  // Late-initialized controllers populated during GaramGame constructor
  weaponController?: WeaponController;
  roundManager?: RoundManager;
  inputManager?: InputManager;
  botAI?: BotAISystem;
  customizer?: CustomizerUI;
  buyMenuUI?: BuyMenuUI;
  networkClient?: NetworkClient;
}

const _utilThrowOrigin = new THREE.Vector3();
const _utilThrowDir = new THREE.Vector3();
const _utilThrowVel = new THREE.Vector3();
const _playerFeetScratch = new THREE.Vector3();

const customizerPromises = new WeakMap<GameContext, Promise<CustomizerUI>>();

export function ensureCustomizer(ctx: GameContext): Promise<CustomizerUI> {
  if (ctx.customizer) return Promise.resolve(ctx.customizer);
  const inflight = customizerPromises.get(ctx);
  if (inflight) return inflight;

  const loader = import('../ui/CustomizerUI.js').then(({ CustomizerUI: CustomizerCtor }) => {
    const instance = new CustomizerCtor(buildCustomizerCallbacks(ctx));
    ctx.customizer = instance;
    return instance;
  });
  customizerPromises.set(ctx, loader);
  return loader;
}

export function buildNetworkCallbacks(ctx: GameContext): NetworkClientCallbacks {
  return {
    onKillfeed: (text: string) => ctx.hud.addKillfeed(text),
    onScoresUpdated: (ct: number, t: number) => ctx.hud.updateScores(ct, t),
    onEconomySync: (payload) => {
      ctx.economy.cash = payload.cash;
      ctx.economy.armor = payload.armor;
      ctx.economy.hasHelmet = payload.hasHelmet;
      ctx.economy.hasDefuseKit = payload.hasDefuseKit;

      for (const weaponId of payload.ownedWeapons) {
        const def = WEAPONS[weaponId];
        if (!def) continue;
        const slot = def.slot as SlotNumber;
        if (slot === 1 || slot === 2) {
          const existing = ctx.inventory.slots[slot];
          if (!existing || existing.weaponId !== def.id) {
            ctx.inventory.slots[slot] = {
              weaponId: def.id,
              currentAmmo: def.magCapacity,
              reserveAmmo: def.reserveAmmo,
            };
          }
        }
      }
      ctx.syncActiveWeapon();
    },
    onUtilityEvent: (evt) => {
      const validTypes: UtilityType[] = ['smoke-grenade', 'flashbang', 'he-grenade', 'molotov'];
      if (!validTypes.includes(evt.utilityType as UtilityType)) return;
      _utilThrowOrigin.set(evt.origin.x, evt.origin.y, evt.origin.z);
      _utilThrowDir.set(evt.direction.x, evt.direction.y, evt.direction.z);
      _utilThrowVel.set(evt.velocity.x, evt.velocity.y, evt.velocity.z);
      ctx.utilityManager.throwGrenade(
        evt.utilityType as UtilityType,
        _utilThrowOrigin,
        _utilThrowDir,
        _utilThrowVel,
        'long'
      );
    },
    onLocalStateSync: (state) => {
      ctx.playerManager.playerHealth = state.health;
      ctx.economy.armor = state.armor;
      if (state.hasHelmet !== undefined) ctx.economy.hasHelmet = state.hasHelmet;
      if (state.hasDefuseKit !== undefined) ctx.economy.hasDefuseKit = state.hasDefuseKit;
      const activeSlot = ctx.inventory.getActiveSlotState();
      if (activeSlot && activeSlot.weaponId === state.activeWeapon) {
        activeSlot.currentAmmo = state.currentAmmo;
        activeSlot.reserveAmmo = state.reserveAmmo;
      }
    },
  };
}

export function buildUtilityCallbacks(ctx: GameContext): UtilityCallbacks {
  return {
    onFlashPlayer: (dur: number) => ctx.hud.triggerFlashEffect(dur),
    onFlashbangExploded: (flashPos: THREE.Vector3) => {
      ctx.botAI?.onFlashbangExploded(flashPos, ctx.bots);
    },
    onPlayerDamage: (dmg: number) => {
      ctx.playerManager.damagePlayer(
        dmg,
        null,
        ctx.worldCamera.position,
        ctx.inputManager?.input.yaw ?? 0,
        ctx.bots,
        true,
        0
      );
    },
    onKillfeed: (text: string) => ctx.hud.addKillfeed(text),
  };
}

export function buildBotAICallbacks(ctx: GameContext): BotAISystemCallbacks {
  return {
    onBotShootPlayer: (
      bot: BotEntity,
      dmg: number,
      _hitZone: HitZone,
      isHeadshot: boolean,
      _penetrated: number,
      armorDamage = 0
    ) => {
      ctx.combatReport.recordDamageTaken(bot.id, bot.name, dmg, isHeadshot);
      // RaycastEngine already computed armor-penetration damage and armor durability loss
      ctx.playerManager.damagePlayer(
        dmg,
        bot.mesh.position,
        ctx.worldCamera.position,
        ctx.inputManager?.input.yaw ?? 0,
        ctx.bots,
        true,
        armorDamage
      );
      const botWeaponId = bot.team === 'Syndicate' ? 'garam-47' : 'vanguard-m4';
      ctx.audio.playGunshot(botWeaponId, bot.mesh.position, ctx.worldCamera.position, ctx.blocks);
    },
    onBotShootBot: (
      s: BotEntity,
      v: BotEntity,
      dmg: number,
      _hz: HitZone,
      hs: boolean,
      pen: number,
      armorDamage = 0
    ) => {
      ctx.playerManager.handleBotDamagedByBot(
        s,
        v,
        dmg,
        hs,
        pen,
        ctx.blocks,
        ctx.worldCamera.position,
        ctx.bots,
        armorDamage
      );
    },
    onBotSpawnTracer: (from: THREE.Vector3, to: THREE.Vector3, weaponId?: string) =>
      ctx.effects.spawnTracer(from, to, weaponId || 'garam-47'),
    onBotSpawnDecal: (pt: THREE.Vector3, norm: THREE.Vector3, mat: SurfaceMaterial) =>
      ctx.effects.spawnBulletDecal(pt, norm, mat),
    onBotThrowUtility: (bot: BotEntity, type: 'smoke' | 'flash' | 'molotov', target: THREE.Vector3) => {
      _utilThrowDir.copy(target).sub(bot.mesh.position).normalize();
      _utilThrowOrigin.copy(bot.mesh.position).setY(bot.mesh.position.y + 1.6);
      const utilMap: Record<'smoke' | 'flash' | 'molotov', UtilityType> = {
        smoke: 'smoke-grenade',
        flash: 'flashbang',
        molotov: 'molotov',
      };
      ctx.utilityManager.throwGrenade(utilMap[type], _utilThrowOrigin, _utilThrowDir, _utilThrowVel, 'long');
    },
    onBotRadioCallout: (bot: BotEntity, message: string) => {
      ctx.audio.playRadioChirp();
      ctx.hud.addKillfeed(`[RADIO] ${bot.name}: "${message}"`);
    },
  };
}

export function buildWeaponControllerCallbacks(ctx: GameContext): WeaponCombatCallbacks {
  return {
    onKill: (k: string, b: BotEntity, hs: boolean, wp: string, r: number) =>
      ctx.playerManager.handlePlayerKill(k, b, hs, wp, r, ctx.bots),
    onCameraPunch: (pitchRad: number) => {
      ctx.cameraPunchPitch.value = Math.min(0.18, ctx.cameraPunchPitch.value + pitchRad);
    },
    onScopeChanged: (zoomStage: number, fov: number, sens: number) => {
      ctx.worldCamera.fov = fov;
      ctx.worldCamera.updateProjectionMatrix();
      ctx.hud.setScopeOverlay(zoomStage > 0);
      const scopedSens = sens * settingsStore.settings.scopedSensitivityMultiplier;
      ctx.inputManager?.setSensitivity(scopedSens);
    },
    onUtilityThrown: () => ctx.hud.addKillfeed('Tactical Smoke Deployed'),
    onHitmarker: (headshot: boolean) => ctx.hud.triggerHitmarker(headshot),
    onFire: (weapon: WeaponDef, isScoped: boolean, rayDir: THREE.Vector3, isSecondaryMelee: boolean) => {
      // Alert nearby hostile bots to gunshot acoustic signature (suppressed rifles have smaller radius)
      if (weapon.category !== 'melee') {
        const isSuppressed = weapon.id === 'vanguard-m4';
        ctx.botAI?.onSoundEvent({
          type: isSuppressed ? 'suppressed_gunfire' : 'gunfire',
          pos: ctx.worldCamera.position,
          radius: isSuppressed ? 24 : 48,
          team: settingsStore.settings.faction,
          timestamp: Date.now(),
        });
      }
      if (ctx.networkClient?.isConnected && ctx.inputManager) {
        ctx.networkClient.sendFire(
          rayDir,
          weapon.id,
          ctx.inputManager.input.yaw,
          ctx.inputManager.input.pitch,
          isSecondaryMelee,
          isScoped
        );
      }
    },
  };
}

export function buildRoundCallbacks(ctx: GameContext): RoundCallbacks {
  return {
    onPhaseChanged: (phase: RoundPhase, round: number) => {
      if (phase === 'FREEZE_TIME') {
        ctx.combatReport.resetRound();
        ctx.spectator.stop();
        if (ctx.roundManager) {
          ctx.botAI?.startNewRound(round, ctx.bots, ctx.roundManager.ctLossStreak, ctx.roundManager.tLossStreak);
        }
        ctx.hud.showCenterBanner(`ROUND ${round}`, 'FREEZE TIME — REQUISITION WEAPONS [B]', 3000);
      } else if (phase === 'ROUND_LIVE') {
        const objective =
          settingsStore.settings.faction === 'Syndicate'
            ? 'PLANT PULSE CORE AT SITE A OR B'
            : 'DEFEND SITES A & B';
        ctx.hud.showCenterBanner('LIVE', objective, 1800);
      }
    },
    onTimerTick: (timeRemaining: number, isBombArmed: boolean) =>
      ctx.hud.updateRoundTimer(timeRemaining, isBombArmed),
    onPlantProgress: (p: number) => ctx.hud.updateInteractionBar(p, 'PLANTING PULSE CORE...'),
    onDefuseProgress: (p: number) => ctx.hud.updateInteractionBar(p, 'DEFUSING PULSE CORE...'),
    onRoundWon: (winner: 'Vanguard' | 'Syndicate', reason: string, ctScore: number, tScore: number) => {
      ctx.hud.updateScores(ctScore, tScore);
      const localTeam = settingsStore.settings.faction;
      const didWin = winner === localTeam;
      ctx.hud.showCenterBanner(`${winner.toUpperCase()} WINS THE ROUND`, reason, 4500);
      ctx.combatReport.show();

      const lossStreak =
        localTeam === 'Vanguard'
          ? (ctx.roundManager?.ctLossStreak ?? 0)
          : (ctx.roundManager?.tLossStreak ?? 0);
      const payout = ctx.economy.awardRoundEndPayout(
        didWin,
        lossStreak,
        reason.includes('Defused') || reason.includes('Detonated')
      );
      ctx.hud.addKillfeed(`Round End Payout: +$${payout}`);
    },
    onResetRound: () => {
      const factionSpawn =
        settingsStore.settings.faction === 'Syndicate'
          ? SPAWN_POINTS.OBSIDIAN_T
          : SPAWN_POINTS.VANGUARD_CT;
      ctx.spawnPos.x = factionSpawn.x;
      ctx.spawnPos.y = factionSpawn.y;
      ctx.spawnPos.z = factionSpawn.z;

      ctx.spectator.stop();
      ctx.droppedWeapons.clearAll();
      ctx.utilityManager.resetRound();
      ctx.radar.clearSpotted();
      ctx.playerManager.reset(ctx.spawnPos);
      if (ctx.inputManager) {
        ctx.inputManager.input.yaw = settingsStore.settings.faction === 'Syndicate' ? 0 : Math.PI;
        ctx.inputManager.input.pitch = 0;
      }
      ctx.playerManager.respawnAllBots(ctx.bots);
      for (let s = 1; s <= 3; s++) {
        const state = ctx.inventory.slots[s as SlotNumber];
        if (state && WEAPONS[state.weaponId]) {
          const def = WEAPONS[state.weaponId];
          state.currentAmmo = def.magCapacity;
          state.reserveAmmo = def.reserveAmmo;
        }
      }
      ctx.syncActiveWeapon();
    },
    onMatchComplete: (winner: 'Vanguard' | 'Syndicate', ctScore: number, tScore: number) => {
      ctx.hud.updateScores(ctScore, tScore);
      ctx.hud.showCenterBanner(
        `MATCH VICTORY — ${winner.toUpperCase()}`,
        `Final Score: Vanguard ${ctScore} : ${tScore} Syndicate`,
        8000
      );
    },
  };
}

export function buildCustomizerCallbacks(ctx: GameContext): CustomizerCallbacks {
  return {
    onCrosshairChanged: (cfg: CrosshairConfig) => {
      document.querySelectorAll('.crosshair-bar, .crosshair-dot').forEach((el) => {
        (el as HTMLElement).style.background = cfg.color;
      });
    },
    onGrantCash: () => {
      ctx.economy.devPracticeMoney();
      ctx.hud.addKillfeed('Practice Mode: $16,000 Cash + Infinite Utility Granted');
    },
    onToggleInfiniteAmmo: (en: boolean) => ctx.hud.addKillfeed(`Infinite Ammo: ${en ? 'ON' : 'OFF'}`),
    onToggleShowImpacts: (en: boolean) => ctx.hud.addKillfeed(`Show Impacts: ${en ? 'ON' : 'OFF'}`),
    onToggleFreezeBots: (fr: boolean) => ctx.hud.addKillfeed(`Freeze Bots: ${fr ? 'FROZEN' : 'ACTIVE'}`),
    onToggleHitboxes: (sh: boolean) => ctx.bots.forEach((b) => b.rig?.setWireframesVisible(sh)),
    onToggleFollowRecoil: (en: boolean) => ctx.hud.addKillfeed(`Follow Recoil: ${en ? 'ON' : 'OFF'}`),
    onRespawnBots: () => {
      ctx.playerManager.respawnAllBots(ctx.bots);
      ctx.hud.addKillfeed('Respawned all bots to tactical spawn positions');
    },
    onExit: () => {
      if (ctx.hasMatchStarted.value) {
        const blocker = document.getElementById('blocker');
        const overlay = document.getElementById('ui-overlay');
        if (blocker) blocker.style.display = 'none';
        if (overlay) overlay.style.display = 'block';
        document.body.dataset.state = 'playing';
        if (ctx.inputManager) {
          ctx.inputManager.uiState = 'PLAYING';
          ctx.inputManager.requestPointerLock();
        }
      } else {
        document.body.dataset.state = 'title';
      }
    },
  };
}

export function buildInputManagerCallbacks(ctx: GameContext): InputCallbacks {
  const _forward = new THREE.Vector3();
  return {
    onFireDown: () => {
      if (ctx.spectator.isSpectating) {
        ctx.spectator.cycleTeammate(1, ctx.bots);
        return;
      }
      const active = ctx.inventory.getActiveWeapon();
      if (active.category === 'grenade') {
        ctx.playerManager.throwUtilityGrenade('long', ctx.worldCamera);
        return;
      }
      ctx.isFiring.value = true;
      ctx.pendingFireTrigger.value = true;
    },
    onFireUp: () => {
      ctx.isFiring.value = false;
      ctx.pendingFireTrigger.value = false;
      ctx.weaponController?.onFireRelease();
    },
    onAltFire: () => {
      if (ctx.spectator.isSpectating) {
        ctx.spectator.cycleTeammate(-1, ctx.bots);
        return;
      }
      const active = ctx.inventory.getActiveWeapon();
      if (active.category === 'grenade') {
        ctx.playerManager.throwUtilityGrenade('short', ctx.worldCamera);
        return;
      }
      ctx.weaponController?.handleSecondaryFire(ctx.worldCamera, ctx.blocks, ctx.bots, ctx.spatialGrid);
    },
    onReload: () => {
      const slotState = ctx.inventory.getActiveSlotState();
      ctx.viewmodel.isEmptyReload = slotState.currentAmmo === 0;
      if (ctx.inventory.startReload()) {
        ctx.audio.playReload(ctx.viewmodel.isEmptyReload);
        ctx.viewmodel.isReloading = true;
        if (ctx.networkClient?.isConnected) {
          ctx.networkClient.sendReload();
        }
      }
    },
    onQuickSwitch: () => {
      if (ctx.inventory.quickSwitch()) {
        ctx.audio.cancelReloadAudio();
        ctx.syncActiveWeapon();
      }
    },
    onSlotSelect: (slot: SlotNumber) => {
      if (ctx.inventory.equipSlot(slot)) {
        ctx.audio.cancelReloadAudio();
        ctx.syncActiveWeapon();
      } else if (!ctx.inventory.hasSlot(slot)) {
        ctx.audio.playDryFire();
      }
    },
    onCycleWeapon: (dir: 1 | -1) => {
      const switched = dir > 0 ? ctx.inventory.cycleNext() : ctx.inventory.cyclePrev();
      if (switched) {
        ctx.audio.cancelReloadAudio();
        ctx.syncActiveWeapon();
      }
    },
    onToggleBuyMenu: () => {
      _playerFeetScratch.set(ctx.player.state.x, ctx.player.state.y, ctx.player.state.z);
      ctx.buyMenuUI?.toggle(
        undefined,
        ctx.roundManager?.phase ?? 'ROUND_LIVE',
        ctx.roundManager?.phaseTimer ?? 0,
        _playerFeetScratch
      );
    },
    onBuyItem: (key: number) => {
      _playerFeetScratch.set(ctx.player.state.x, ctx.player.state.y, ctx.player.state.z);
      ctx.buyMenuUI?.handleBuyByKey(
        key,
        ctx.roundManager?.phase ?? 'ROUND_LIVE',
        ctx.roundManager?.phaseTimer ?? 0,
        _playerFeetScratch
      );
    },
    onPracticeToggle: () => {
      ctx.economy.devPracticeMoney();
      ctx.hud.addKillfeed('Practice Mode: $16,000 Cash + Infinite Utility Granted');
    },
    onInspectWeapon: () => ctx.weaponController?.inspectWeapon(),
    onDropWeapon: () => {
      ctx.audio.cancelReloadAudio();
      ctx.playerManager.handleDropActiveWeapon(ctx.worldCamera);
    },
    onUtilityQuickSelect: (type: 'molotov' | 'smoke' | 'flash' | 'he') =>
      ctx.playerManager.handleQuickUtility(type),
    onToggleCustomizer: () => {
      const willOpen = !(ctx.customizer?.isOpen ?? false);
      if (willOpen && ctx.inputManager) {
        // Set uiState BEFORE exiting PointerLock so pointerlockchange does not pop #blocker
        ctx.inputManager.uiState = 'SETTINGS';
        document.body.dataset.state = 'customizer';
        ctx.inputManager.exitPointerLock();
      }
      void ensureCustomizer(ctx).then((cust) => cust.toggle(willOpen));
    },
    onInteractDown: () => {
      ctx.isInteracting.value = true;
      if (ctx.networkClient?.isConnected) {
        const action = settingsStore.settings.faction === 'Syndicate' ? 'plant' : 'defuse';
        ctx.networkClient.sendPlantDefuse(action);
      }
      ctx.worldCamera.getWorldDirection(_forward);
      ctx.droppedWeapons.tryLootAimingAt(ctx.worldCamera.position, _forward, (dropped: DroppedWeaponEntity) => {
        return ctx.playerManager.equipDroppedWeapon(dropped);
      });
    },
    onInteractUp: () => {
      ctx.isInteracting.value = false;
      if (ctx.networkClient?.isConnected) {
        ctx.networkClient.sendPlantDefuse('cancel');
      }
    },
  };
}

export function buildBuyMenuCallbacks(ctx: GameContext): BuyMenuUICallbacks {
  return {
    onTogglePointerLock: (lock: boolean) => {
      if (!ctx.inputManager) return;
      if (lock) {
        ctx.inputManager.uiState = 'PLAYING';
        document.body.dataset.state = 'playing';
        ctx.inputManager.requestPointerLock();
      } else {
        ctx.inputManager.uiState = 'BUY_MENU';
        ctx.inputManager.exitPointerLock();
      }
    },
    onWeaponEquipped: () => ctx.syncActiveWeapon(),
    getBuyState: () => ({
      phase: ctx.roundManager?.phase ?? 'ROUND_LIVE',
      phaseTimer: ctx.roundManager?.phaseTimer ?? 0,
      playerPos: _playerFeetScratch.set(ctx.player.state.x, ctx.player.state.y, ctx.player.state.z),
    }),
    onOnlineBuy: (itemId: string) => {
      if (ctx.networkClient?.isConnected) {
        ctx.networkClient.sendBuy(itemId);
        return true;
      }
      return false;
    },
  };
}

export function buildLobbyCallbacks(ctx: GameContext): LobbyUICallbacks {
  const deployToArena = () => {
    const blocker = document.getElementById('blocker');
    const overlay = document.getElementById('ui-overlay');
    if (blocker) blocker.style.display = 'none';
    if (overlay) overlay.style.display = 'block';
    document.body.dataset.state = 'playing';
    if (ctx.inputManager) {
      ctx.inputManager.uiState = 'PLAYING';
    }

    if (!ctx.hasMatchStarted.value) {
      ctx.hasMatchStarted.value = true;
      ctx.roundManager?.startMatch();
    }

    if (settingsStore.settings.gameMode === 'multiplayer') {
      if (ctx.networkClient && !ctx.networkClient.isConnected) {
        const host = window.location.hostname || 'localhost';
        const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const defaultWs = `${wsProto}://${host}:2567`;
        const urlInput = document.getElementById('server-url-input') as HTMLInputElement | null;
        const nameInput = document.getElementById('player-callsign-input') as HTMLInputElement | null;
        let wsUrl = urlInput?.value?.trim() || defaultWs;
        if (wsUrl === 'ws://localhost:2567' && host !== 'localhost' && host !== '127.0.0.1') {
          wsUrl = defaultWs;
        }
        const callsign = nameInput?.value?.trim() || settingsStore.settings.callsign || 'Eldar Garamov';
        ctx.networkClient.connect(wsUrl, callsign, settingsStore.settings.faction);
      }
    } else {
      ctx.networkClient?.disconnect();
    }
    ctx.inputManager?.requestPointerLock();
  };

  return {
    onDeploy: deployToArena,
    onCustomizer: () => {
      void ensureCustomizer(ctx).then((cust) => cust.toggle(true));
    },
    onSensitivityChanged: (val: number) => ctx.inputManager?.setSensitivity(val),
    onFovChanged: (val: number) => {
      ctx.worldCamera.fov = val;
      ctx.worldCamera.updateProjectionMatrix();
    },
    onVolumeChanged: (vol: number) => ctx.audio.setMasterVolume(vol),
    onDifficultyChanged: (diff: BotDifficulty) => {
      ctx.botAI?.setDifficulty(diff);
      ctx.hud.addKillfeed(`Bot Difficulty: ${diff.toUpperCase()}`);
    },
    onFactionChanged: (faction: PlayerFaction) => {
      const nextSpawn = faction === 'Syndicate' ? SPAWN_POINTS.OBSIDIAN_T : SPAWN_POINTS.VANGUARD_CT;
      ctx.spawnPos.x = nextSpawn.x;
      ctx.spawnPos.y = nextSpawn.y;
      ctx.spawnPos.z = nextSpawn.z;
      if (!ctx.hasMatchStarted.value) {
        ctx.player.state.x = nextSpawn.x;
        ctx.player.state.y = nextSpawn.y;
        ctx.player.state.z = nextSpawn.z;
        ctx.player.state.vx = 0;
        ctx.player.state.vy = 0;
        ctx.player.state.vz = 0;
        const nextYaw = faction === 'Syndicate' ? 0 : Math.PI;
        if (ctx.inputManager) {
          ctx.inputManager.input.yaw = nextYaw;
          ctx.inputManager.input.pitch = 0;
        }
        ctx.worldCamera.position.set(nextSpawn.x, nextSpawn.y + 1.68, nextSpawn.z);
        ctx.worldCamera.rotation.set(0, nextYaw, 0, 'YXZ');
      }
    },
  };
}

export interface FrameStepState {
  frameDelta: number;
  hozSpeed: number;
  distanceTraveled: number;
  isFreezeTime: boolean;
  playerFeet: THREE.Vector3;
  interpX: number;
  interpEyeY: number;
  interpZ: number;
  currentZone: string;
}

const _camEuler = new THREE.Euler(0, 0, 0, 'YXZ');

export function stepMatchFrame(ctx: GameContext, s: FrameStepState): void {
  const { frameDelta, hozSpeed, isFreezeTime, playerFeet, currentZone } = s;
  const worldCamera = ctx.worldCamera;
  const activeWp = ctx.inventory.getActiveWeapon();
  const activeSlotState = ctx.inventory.getActiveSlotState();
  const inputMgr = ctx.inputManager;
  const wc = ctx.weaponController;
  const rm = ctx.roundManager;
  const botAI = ctx.botAI;
  const cust = ctx.customizer;
  const net = ctx.networkClient;
  if (!inputMgr || !wc || !rm || !botAI || !net) return;

  ctx.audio.updateListener(worldCamera);
  ctx.audio.setIndoorZone(
    currentZone === 'SUNKEN AQUEDUCT' ||
      currentZone === 'A CONNECTOR' ||
      currentZone === 'B SHORT' ||
      currentZone === 'A PALACE' ||
      currentZone === 'B APARTMENTS' ||
      currentZone === 'B CANAL'
  );

  const invUpdate = ctx.inventory.update(frameDelta);
  if (invUpdate.reloadCompleted) {
    ctx.viewmodel.isReloading = false;
    ctx.hud.updateReloadProgress(false, 0);
  }
  if (ctx.inventory.isReloading) {
    const progress = 1 - ctx.inventory.reloadRemaining / ctx.inventory.reloadDuration;
    ctx.viewmodel.reloadProgress = progress;
    ctx.hud.updateReloadProgress(true, progress);
  }

  wc.update(frameDelta, hozSpeed, inputMgr.input.crouch);
  ctx.effects.update(frameDelta);
  ctx.droppedWeapons.update(frameDelta, ctx.colliders, playerFeet, (dropped) => {
    const def = WEAPONS[dropped.weaponId];
    return def && !ctx.inventory.slots[def.slot] ? ctx.playerManager.equipDroppedWeapon(dropped) : false;
  });

  ctx.cameraPunchPitch.value += (0 - ctx.cameraPunchPitch.value) * (1 - Math.exp(-18 * frameDelta));

  rm.update(
    frameDelta,
    playerFeet,
    ctx.isInteracting.value,
    ctx.inventory.slots[5] !== null,
    ctx.economy.hasDefuseKit,
    ctx.bots,
    ctx.playerManager.playerHealth
  );

  ctx.utilityManager.update(frameDelta, ctx.colliders, ctx.blocks, playerFeet, worldCamera, ctx.bots, ctx.spatialGrid);
  const smokeOccluders = ctx.utilityManager.getActiveSmokeOccluders();

  if (!cust?.freezeBots) {
    botAI.update(
      ctx.bots,
      frameDelta,
      ctx.colliders,
      ctx.blocks,
      playerFeet,
      worldCamera.position,
      smokeOccluders,
      rm.isBombPlanted,
      rm.bombPlantSite,
      ctx.playerManager.playerHealth,
      ctx.economy.armor,
      settingsStore.settings.faction,
      isFreezeTime,
      ctx.spatialGrid,
      ctx.economy.hasHelmet
    );
  }

  ctx.radar.update(
    playerFeet,
    inputMgr.input.yaw,
    ctx.blocks,
    ctx.bots,
    smokeOccluders,
    rm.bombPosition,
    rm.isBombPlanted,
    ctx.spatialGrid
  );

  if (ctx.spectator.isSpectating) {
    ctx.spectator.update(frameDelta, worldCamera, ctx.bots);
  } else {
    const predOff = net.predictionErrorOffset;
    worldCamera.position.set(s.interpX + predOff.x, s.interpEyeY + predOff.y, s.interpZ + predOff.z);
    const effectivePitch = inputMgr.input.pitch + ctx.cameraPunchPitch.value + wc.aimPunchPitch;
    const effectiveYaw = inputMgr.input.yaw + wc.aimPunchYaw;
    _camEuler.set(effectivePitch, effectiveYaw, 0, 'YXZ');
    worldCamera.quaternion.setFromEuler(_camEuler);
  }
  worldCamera.updateMatrixWorld(true);

  const shouldFire =
    (ctx.pendingFireTrigger.value || (ctx.isFiring.value && activeWp.fireMode === 'auto')) &&
    inputMgr.isLocked &&
    !ctx.spectator.isSpectating &&
    !isFreezeTime;
  if (shouldFire) {
    ctx.pendingFireTrigger.value = false;
    if (cust?.infiniteAmmo) activeSlotState.currentAmmo = activeWp.magCapacity;
    wc.handlePrimaryFire(
      worldCamera,
      hozSpeed,
      ctx.player.state.isGrounded,
      inputMgr.input.crouch,
      inputMgr.input.yaw,
      inputMgr.input.pitch,
      ctx.blocks,
      ctx.bots,
      ctx.spatialGrid
    );
  }

  const walkBob = Math.sin(s.distanceTraveled * 4) * 0.008 * (hozSpeed / 5.45);
  const strafeRoll = inputMgr.input.left ? 0.025 : inputMgr.input.right ? -0.025 : 0;
  ctx.viewmodel.update(frameDelta, inputMgr.mouseDeltaX, inputMgr.mouseDeltaY, walkBob, strafeRoll, hozSpeed);
  inputMgr.mouseDeltaX = 0;
  inputMgr.mouseDeltaY = 0;

  const isPinpoint = hozSpeed <= 0.38 && ctx.player.state.isGrounded;
  ctx.hud.updatePlayerStats(
    ctx.playerManager.playerHealth,
    ctx.economy.armor,
    ctx.economy.cash,
    hozSpeed,
    isPinpoint,
    activeWp.name,
    activeSlotState.currentAmmo,
    activeSlotState.reserveAmmo,
    ctx.inventory.activeSlot
  );
  ctx.hud.updateCrosshair(
    hozSpeed,
    wc.consecutiveShots,
    isPinpoint,
    wc.aimPunchYaw,
    wc.aimPunchPitch,
    settingsStore.settings.followRecoil
  );
  ctx.hud.updateCallout(currentZone);
}


