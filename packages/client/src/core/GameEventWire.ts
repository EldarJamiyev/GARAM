import * as THREE from 'three';
import {
  WEAPONS,
  HitZone,
  SurfaceMaterial,
  WeaponDef,
  MapBlockCollider,
  AABBCollider,
  SpatialGrid,
  KinematicPlayerController,
  KINEMATICS,
  getMapDescriptor,
  MapDescriptor,
  MapId,
} from '@garam/shared';
import {
  settingsStore,
  BotDifficulty,
  CrosshairConfig,
  PlayerFaction,
  GraphicsQuality,
  FpsLimit,
  ActiveMapId,
} from './SettingsStore.js';
import { BotEntity } from '../maps/DeCitadelMap.js';
import {
  BotAISystem,
  BotAISystemCallbacks,
  BotMapConfig,
  DE_DUST2_BOT_MAP_CONFIG,
} from '../match/BotAISystem.js';
import { buildDeDust2Map } from '../maps/DeDust2Map.js';
import { BreakablePropManager } from '../maps/BreakablePropManager.js';
import { SprayManager, SprayEmblemId } from '../combat/SprayManager.js';
import { RadioCommsManager } from '../match/RadioCommsManager.js';
import { HostageManager } from '../match/HostageManager.js';
import { SceneManager } from '../render/SceneManager.js';
import { AssetManager } from '../render/AssetManager.js';
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
  renderer?: THREE.WebGLRenderer;
  sceneManager?: SceneManager;
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
  applyGraphicsQuality?: (quality: GraphicsQuality) => void;
  applyFpsLimit?: (limit: FpsLimit) => void;
  // Late-initialized controllers populated during GaramGame constructor
  weaponController?: WeaponController;
  roundManager?: RoundManager;
  inputManager?: InputManager;
  botAI?: BotAISystem;
  customizer?: CustomizerUI;
  buyMenuUI?: BuyMenuUI;
  networkClient?: NetworkClient;
  breakableProps?: BreakablePropManager;
  sprayManager?: SprayManager;
  radioComms?: RadioCommsManager;
  hostageManager?: HostageManager;
  nvgActive?: { value: boolean };
}

const _utilThrowOrigin = new THREE.Vector3();
const _utilThrowDir = new THREE.Vector3();
const _utilThrowVel = new THREE.Vector3();
const _playerFeetScratch = new THREE.Vector3();

const customizerPromises = new WeakMap<GameContext, Promise<CustomizerUI>>();

export function getBotMapConfigForMap(_mapId: ActiveMapId): BotMapConfig {
  return DE_DUST2_BOT_MAP_CONFIG;
}

export function buildArenaMap(
  _mapId: ActiveMapId,
  worldScene: THREE.Scene,
  _droppedWeapons: DroppedWeaponManager,
  onDust2Ready?: () => void
): { blocks: MapBlockCollider[]; colliders: AABBCollider[]; bots: BotEntity[] } {
  return buildDeDust2Map(worldScene, onDust2Ready);
}

export function initCS16Systems(ctx: GameContext, mapDesc: MapDescriptor): void {
  ctx.breakableProps = new BreakablePropManager(ctx.worldScene, ctx.audio, ctx.effects);
  ctx.sprayManager = new SprayManager(ctx.worldScene, ctx.audio, ctx.hud);
  ctx.radioComms = new RadioCommsManager(ctx.audio, ctx.hud);
  ctx.hostageManager = new HostageManager(ctx.worldScene, ctx.audio, ctx.hud);
  ctx.nvgActive = { value: false };
  ctx.weaponController?.setBreakableManager(ctx.breakableProps);

  const mutableColliders = [...ctx.colliders];
  ctx.breakableProps.initForMap(mapDesc.breakables, mutableColliders);
  ctx.colliders = mutableColliders;
  ctx.networkClient?.setMapColliders(ctx.colliders, ctx.spatialGrid);

  ctx.hostageManager.configure(false, mapDesc.hostageSpawns, mapDesc.rescueZones);
  ctx.roundManager?.setObjectiveType('bomb');
}

export function switchActiveMap(ctx: GameContext, mapId: ActiveMapId): void {
  const desc = getMapDescriptor(mapId);

  ctx.spectator.stop();
  ctx.droppedWeapons.clearAll();
  ctx.utilityManager.resetRound();
  ctx.radar.clearSpotted();
  ctx.effects.clearAll();
  ctx.sprayManager?.clearAll();
  ctx.radioComms?.resetRound();
  if (ctx.nvgActive) ctx.nvgActive.value = false;
  ctx.hud.setNightVision(false);

  for (const bot of ctx.bots) {
    bot.rig?.dispose();
    ctx.worldScene.remove(bot.mesh);
  }
  const toRemove: THREE.Object3D[] = [];
  for (const child of ctx.worldScene.children) {
    if (child.userData?.isMapRoot) {
      toRemove.push(child);
    }
  }
  for (const root of toRemove) {
    ctx.worldScene.remove(root);
    AssetManager.disposeObject3D(root, true);
  }

  ctx.sceneManager?.configureMapAtmosphere(mapId);

  const mapData = buildArenaMap(mapId, ctx.worldScene, ctx.droppedWeapons, () => {
    if (ctx.renderer) {
      ctx.radar.bakeFromScene(ctx.renderer, ctx.worldScene);
    }
    ctx.sceneManager?.invalidateShadows();
  });

  const mutableColliders = [...mapData.colliders];
  ctx.breakableProps?.initForMap(desc.breakables, mutableColliders);
  ctx.blocks = mapData.blocks;
  ctx.colliders = mutableColliders;
  ctx.bots = mapData.bots;
  ctx.spatialGrid = new SpatialGrid(mapData.blocks, 6);

  ctx.economy.setSpawnZones(desc.spawnZones);
  ctx.utilityManager.setMapBounds(desc.bounds);
  ctx.roundManager?.setBombsites(desc.bombsites);
  ctx.hostageManager?.configure(false, desc.hostageSpawns, desc.rescueZones);
  ctx.roundManager?.setObjectiveType('bomb');
  ctx.botAI?.setMapConfig(getBotMapConfigForMap(mapId));
  ctx.networkClient?.setMapColliders(ctx.colliders, ctx.spatialGrid);

  ctx.radar.configureMap(desc.bounds, desc.bombsites, desc.isGlbArena);
  if (ctx.renderer) {
    ctx.radar.bakeFromScene(ctx.renderer, ctx.worldScene);
  }
  ctx.sceneManager?.invalidateShadows();

  const scoreboardTitle = document.querySelector('#scoreboard-modal h2');
  if (scoreboardTitle) {
    scoreboardTitle.textContent = `TACTICAL OPERATIONS // ${desc.id.toUpperCase()}`;
  }

  const faction = settingsStore.settings.faction;
  const factionSpawn =
    faction === 'Syndicate' ? desc.spawnPoints.OBSIDIAN_T : desc.spawnPoints.VANGUARD_CT;
  ctx.spawnPos.x = factionSpawn.x;
  ctx.spawnPos.y = factionSpawn.y;
  ctx.spawnPos.z = factionSpawn.z;

  const initialYaw = desc.initialYaw[faction];
  ctx.weaponController?.resetRoundCombatState();
  ctx.cameraPunchPitch.value = 0;
  ctx.isFiring.value = false;
  ctx.pendingFireTrigger.value = false;
  ctx.isInteracting.value = false;
  ctx.inputManager?.resetMovementInputs();
  ctx.playerManager.reset(ctx.spawnPos, initialYaw);
  if (ctx.inputManager) {
    ctx.inputManager.input.yaw = initialYaw;
    ctx.inputManager.input.pitch = 0;
    ctx.inputManager.mouseDeltaX = 0;
    ctx.inputManager.mouseDeltaY = 0;
  }
  ctx.worldCamera.position.set(ctx.spawnPos.x, ctx.spawnPos.y + KINEMATICS.EYE_HEIGHT_STAND, ctx.spawnPos.z);
  ctx.worldCamera.rotation.set(0, initialYaw, 0, 'YXZ');
  ctx.worldCamera.updateMatrixWorld(true);
  ctx.viewmodel.resetMotionState();
  ctx.hud.resetRoundKills();
  ctx.hud.setFactionTheme(faction);
}

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
    onMapSync: (serverMapId: MapId) => {
      if (serverMapId !== settingsStore.settings.mapId) {
        settingsStore.update('mapId', serverMapId);
        const sel = document.getElementById('map-selector') as HTMLSelectElement | null;
        if (sel) sel.value = serverMapId;
        switchActiveMap(ctx, serverMapId);
      }
    },
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
    onRadioBroadcast: (payload) => {
      ctx.audio.playRadioClick?.(payload.text, 1.0);
      ctx.hud.addRadioMessage(`[RADIO] ${payload.senderName}: "${payload.text}"`);
    },
    onBreakableBroken: (blockId: string) => {
      ctx.breakableProps?.applyDamage(blockId, 999);
    },
    onSprayEvent: (payload) => {
      ctx.sprayManager?.spawnSprayAt(
        payload.emblemId as SprayEmblemId,
        new THREE.Vector3(payload.pos.x, payload.pos.y, payload.pos.z),
        new THREE.Vector3(payload.normal.x, payload.normal.y, payload.normal.z)
      );
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
    onKillfeed: (text: string) => {
      if (text.includes('eliminated')) {
        ctx.hud.addKillfeed(text);
      } else {
        ctx.hud.addRadioMessage(text);
      }
    },
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
      const botWeaponId =
        bot.weaponId && WEAPONS[bot.weaponId]
          ? bot.weaponId
          : bot.team === 'Syndicate'
            ? 'garam-47'
            : 'vanguard-m4';
      // RaycastEngine already computed armor-penetration damage and armor durability loss
      ctx.playerManager.damagePlayer(
        dmg,
        bot.mesh.position,
        ctx.worldCamera.position,
        ctx.inputManager?.input.yaw ?? 0,
        ctx.bots,
        true,
        armorDamage,
        {
          name: bot.name,
          team: bot.team,
          weaponId: botWeaponId,
          isHeadshot,
        }
      );
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
      ctx.hud.addRadioMessage(`${bot.name}: "${message}"`);
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
    onUtilityThrown: () => ctx.hud.addRadioMessage('Tactical Smoke Deployed'),
    onHitmarker: (headshot: boolean) => ctx.hud.triggerHitmarker(headshot),
    onRadioNotice: (message: string) => ctx.hud.addRadioMessage(message),
    onBreakableHit: (blockId: string) => ctx.networkClient?.sendBreakableHit(blockId, 100),
    onSecondaryToggle: (weaponId: string, action: 'silencer' | 'burst' | 'shield') => {
      ctx.networkClient?.sendSecondaryToggle(weaponId, action);
    },
    onFire: (weapon: WeaponDef, isScoped: boolean, rayDir: THREE.Vector3, isSecondaryMelee: boolean) => {
      // Alert nearby hostile bots to gunshot acoustic signature (suppressed rifles have smaller radius)
      if (weapon.category !== 'melee') {
        const isSuppressed =
          (weapon.id === 'vanguard-m4' || weapon.id === 'usp-s') &&
          ctx.inventory.isSilencerAttached(weapon.id);
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
        const objType = ctx.roundManager?.objectiveType ?? 'bomb';
        const objective =
          objType === 'hostage'
            ? settingsStore.settings.faction === 'Vanguard'
              ? 'RESCUE HOSTAGES [E] TO EXTRACTION ZONE'
              : 'DEFEND HOSTAGES FROM VANGUARD'
            : objType === 'elimination'
              ? 'ELIMINATE ALL HOSTILE OPERATORS'
              : settingsStore.settings.faction === 'Syndicate'
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

      // Determine winning-team MVP callsign by top kills
      let mvpName = settingsStore.settings.callsign || 'Operator';
      let bestKills = didWin ? ctx.playerManager.kills : -1;
      for (const b of ctx.bots) {
        if (b.team === winner && b.kills > bestKills) {
          bestKills = b.kills;
          mvpName = b.name;
        }
      }
      if (!didWin && bestKills < 0) {
        const fallbackBot = ctx.bots.find((b) => b.team === winner);
        if (fallbackBot) mvpName = fallbackBot.name;
      }

      ctx.hud.showRoundWinRibbon(winner, reason, mvpName, 4500);
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
      ctx.hud.addRadioMessage(`Round End Payout: +$${payout}`);
    },
    onResetRound: () => {
      const desc = getMapDescriptor(settingsStore.settings.mapId);
      const faction = settingsStore.settings.faction;
      const factionSpawn =
        faction === 'Syndicate' ? desc.spawnPoints.OBSIDIAN_T : desc.spawnPoints.VANGUARD_CT;
      ctx.spawnPos.x = factionSpawn.x;
      ctx.spawnPos.y = factionSpawn.y;
      ctx.spawnPos.z = factionSpawn.z;
      const initialYaw = desc.initialYaw[faction];

      // Instant CS2 hard-cut round reset: stop deathcam, zero camera roll/punch/zoom, lock kinematics to spawn floor
      ctx.spectator.stop();
      ctx.weaponController?.resetRoundCombatState();
      ctx.cameraPunchPitch.value = 0;
      ctx.isFiring.value = false;
      ctx.pendingFireTrigger.value = false;
      ctx.isInteracting.value = false;
      ctx.inputManager?.resetMovementInputs();

      ctx.droppedWeapons.clearAll();
      if (desc.floorWeaponSpawns.length > 0) {
        const zeroDir = new THREE.Vector3(0, 0, 0);
        for (const fw of desc.floorWeaponSpawns) {
          const def = WEAPONS[fw.weaponId];
          if (def) {
            ctx.droppedWeapons.dropWeapon(
              def.id,
              def.magCapacity,
              def.reserveAmmo,
              new THREE.Vector3(fw.pos.x, fw.pos.y + 0.25, fw.pos.z),
              zeroDir
            );
          }
        }
      }
      ctx.breakableProps?.resetRound();
      ctx.radioComms?.resetRound();
      ctx.hostageManager?.resetRound(desc.hostageSpawns);
      if (ctx.nvgActive) ctx.nvgActive.value = false;
      ctx.hud.setNightVision?.(false);
      ctx.utilityManager.resetRound();
      ctx.effects.clearAll();
      ctx.radar.clearSpotted();
      ctx.playerManager.reset(ctx.spawnPos, initialYaw);
      if (ctx.inputManager) {
        ctx.inputManager.input.yaw = initialYaw;
        ctx.inputManager.input.pitch = 0;
        ctx.inputManager.mouseDeltaX = 0;
        ctx.inputManager.mouseDeltaY = 0;
      }
      ctx.worldCamera.position.set(
        ctx.spawnPos.x,
        ctx.spawnPos.y + KINEMATICS.EYE_HEIGHT_STAND,
        ctx.spawnPos.z
      );
      ctx.worldCamera.rotation.set(0, initialYaw, 0, 'YXZ');
      ctx.worldCamera.updateMatrixWorld(true);
      ctx.viewmodel.resetMotionState();
      ctx.hud.resetRoundKills();
      ctx.hud.setFactionTheme(faction);

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
      ctx.hud.addRadioMessage('Practice Mode: $16,000 Cash + Infinite Utility Granted');
    },
    onToggleInfiniteAmmo: (en: boolean) => ctx.hud.addRadioMessage(`Infinite Ammo: ${en ? 'ON' : 'OFF'}`),
    onToggleShowImpacts: (en: boolean) => ctx.hud.addRadioMessage(`Show Impacts: ${en ? 'ON' : 'OFF'}`),
    onToggleFreezeBots: (fr: boolean) => ctx.hud.addRadioMessage(`Freeze Bots: ${fr ? 'FROZEN' : 'ACTIVE'}`),
    onToggleHitboxes: (sh: boolean) => ctx.bots.forEach((b) => b.rig?.setWireframesVisible(sh)),
    onToggleFollowRecoil: (en: boolean) => ctx.hud.addRadioMessage(`Follow Recoil: ${en ? 'ON' : 'OFF'}`),
    onRespawnBots: () => {
      ctx.playerManager.respawnAllBots(ctx.bots);
      ctx.hud.addRadioMessage('Respawned all bots to tactical spawn positions');
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
      if (ctx.roundManager?.phase === 'FREEZE_TIME') return;
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
      if (ctx.roundManager?.phase === 'FREEZE_TIME') {
        // Allow scopes, silencer/burst toggles, and shield guard during freeze time; block knife stab & grenade throw
        if (active.category === 'melee' || active.category === 'grenade') return;
      }
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
      if (slot === 4 && (ctx.inventory.activeSlot === 4 || !ctx.inventory.slots[4])) {
        const nextUtil = ctx.inventory.cycleOwnedUtility(
          ctx.economy.ownedUtilities,
          ctx.economy.practiceInfiniteUtility
        );
        if (nextUtil) {
          ctx.inventory.equipSlot(4, true);
          ctx.audio.cancelReloadAudio();
          ctx.syncActiveWeapon();
          return;
        }
      }
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
      ctx.hud.addRadioMessage('Practice Mode: $16,000 Cash + Infinite Utility Granted');
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
      _playerFeetScratch.set(ctx.player.state.x, ctx.player.state.y, ctx.player.state.z);
      if (ctx.hostageManager?.enabled && ctx.roundManager?.phase === 'ROUND_LIVE') {
        const handledHostage = ctx.hostageManager.tryInteract(
          'local',
          settingsStore.settings.faction,
          _playerFeetScratch,
          (amount) => ctx.economy.addCash(amount)
        );
        if (handledHostage) return;
      }
      if (ctx.roundManager?.phase !== 'FREEZE_TIME') {
        ctx.isInteracting.value = true;
        if (ctx.networkClient?.isConnected) {
          const action = settingsStore.settings.faction === 'Syndicate' ? 'plant' : 'defuse';
          ctx.networkClient.sendPlantDefuse(action);
        }
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
    onAutoBuy: () => {
      _playerFeetScratch.set(ctx.player.state.x, ctx.player.state.y, ctx.player.state.z);
      ctx.buyMenuUI?.executeAutoBuy(
        ctx.roundManager?.phase ?? 'ROUND_LIVE',
        ctx.roundManager?.phaseTimer ?? 0,
        _playerFeetScratch
      );
      ctx.networkClient?.sendAutoBuy();
    },
    onRebuy: () => {
      _playerFeetScratch.set(ctx.player.state.x, ctx.player.state.y, ctx.player.state.z);
      ctx.buyMenuUI?.executeRebuy(
        ctx.roundManager?.phase ?? 'ROUND_LIVE',
        ctx.roundManager?.phaseTimer ?? 0,
        _playerFeetScratch
      );
      ctx.networkClient?.sendRebuy();
    },
    onToggleRadioMenu: () => ctx.radioComms?.toggleMenu(),
    onRadioCommand: (num: number) => {
      _playerFeetScratch.set(ctx.player.state.x, ctx.player.state.y, ctx.player.state.z);
      const desc = getMapDescriptor(settingsStore.settings.mapId);
      const callout = desc.getCalloutName(ctx.player.state.x, ctx.player.state.y, ctx.player.state.z);
      const cmd = ctx.radioComms?.issueCommand(
        num,
        settingsStore.settings.callsign || 'Operator',
        settingsStore.settings.faction,
        _playerFeetScratch,
        callout,
        ctx.bots
      );
      if (cmd) ctx.networkClient?.sendRadioCmd(cmd.id, callout);
    },
    onSprayLogo: () => {
      const emblem = settingsStore.settings.sprayEmblem || 'sovereign';
      const placed = ctx.sprayManager?.trySpray(ctx.worldCamera, ctx.blocks, ctx.spatialGrid, emblem);
      if (placed) {
        ctx.networkClient?.sendSprayLogo(
          emblem,
          { x: placed.pos.x, y: placed.pos.y, z: placed.pos.z },
          { x: placed.normal.x, y: placed.normal.y, z: placed.normal.z }
        );
      }
    },
    onToggleNightVision: () => {
      if (!ctx.economy.hasNightVision) {
        ctx.hud.addRadioMessage('Buy NightVision Goggles ($1,250) in [B] Buy Menu first');
        return;
      }
      if (!ctx.nvgActive) ctx.nvgActive = { value: false };
      ctx.nvgActive.value = !ctx.nvgActive.value;
      ctx.hud.setNightVision?.(ctx.nvgActive.value);
      ctx.audio.playNvgToggle?.(ctx.nvgActive.value);
    },
    onBuyAmmo: (kind: 'primary' | 'secondary') => {
      _playerFeetScratch.set(ctx.player.state.x, ctx.player.state.y, ctx.player.state.z);
      ctx.buyMenuUI?.executePurchase(
        kind === 'primary' ? 'primammo' : 'secammo',
        ctx.roundManager?.phase ?? 'ROUND_LIVE',
        ctx.roundManager?.phaseTimer ?? 0,
        _playerFeetScratch
      );
    },
    onCycleSpectatorMode: () => {
      if (ctx.spectator.isSpectating) {
        ctx.spectator.cycleCameraMode(ctx.worldCamera);
      }
    },
    isRadioMenuOpen: () => ctx.radioComms?.isMenuOpen ?? false,
    isSpectating: () => ctx.spectator.isSpectating,
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
      const desc = getMapDescriptor(settingsStore.settings.mapId);
      const initialYaw = desc.initialYaw[settingsStore.settings.faction];
      if (ctx.inputManager) {
        ctx.inputManager.input.yaw = initialYaw;
        ctx.inputManager.input.pitch = 0;
      }
      ctx.worldCamera.position.set(ctx.spawnPos.x, ctx.spawnPos.y + 1.68, ctx.spawnPos.z);
      ctx.worldCamera.rotation.set(0, initialYaw, 0, 'YXZ');
      ctx.viewmodel.mesh.visible = true;
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
        ctx.networkClient.connect(
          wsUrl,
          callsign,
          settingsStore.settings.faction,
          settingsStore.settings.mapId
        );
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
      ctx.hud.addRadioMessage(`Bot Difficulty: ${diff.toUpperCase()}`);
    },
    onFactionChanged: (faction: PlayerFaction) => {
      ctx.viewmodel.setFaction(faction);
      ctx.hud.setFactionTheme(faction);
      const desc = getMapDescriptor(settingsStore.settings.mapId);
      const nextSpawn =
        faction === 'Syndicate' ? desc.spawnPoints.OBSIDIAN_T : desc.spawnPoints.VANGUARD_CT;
      ctx.spawnPos.x = nextSpawn.x;
      ctx.spawnPos.y = nextSpawn.y;
      ctx.spawnPos.z = nextSpawn.z;
      if (!ctx.hasMatchStarted.value) {
        const nextYaw = desc.initialYaw[faction];
        ctx.player.hardReset(nextSpawn.x, nextSpawn.y, nextSpawn.z, nextYaw, 0);
        if (ctx.inputManager) {
          ctx.inputManager.input.yaw = nextYaw;
          ctx.inputManager.input.pitch = 0;
        }
        ctx.worldCamera.position.set(nextSpawn.x, nextSpawn.y + KINEMATICS.EYE_HEIGHT_STAND, nextSpawn.z);
        ctx.worldCamera.rotation.set(0, nextYaw, 0, 'YXZ');
      }
    },
    onMapChanged: (mapId: ActiveMapId) => {
      switchActiveMap(ctx, mapId);
      ctx.hud.addRadioMessage(`Arena Loaded: ${mapId.toUpperCase()}`);
    },
    onQualityChanged: (quality: GraphicsQuality) => {
      ctx.applyGraphicsQuality?.(quality);
      ctx.hud.addRadioMessage(`Graphics Quality: ${quality}`);
    },
    onFpsLimitChanged: (limit: FpsLimit) => {
      ctx.applyFpsLimit?.(limit);
      ctx.hud.addRadioMessage(`Frame Pacing: ${limit}`);
    },
    onRightHandChanged: (rightHanded: boolean) => {
      ctx.viewmodel.setLeftHanded(!rightHanded);
      ctx.hud.addRadioMessage(
        rightHanded ? 'Viewmodel: Right-Handed (cl_righthand 1)' : 'Viewmodel: Left-Handed (cl_righthand 0)'
      );
    },
    onOfficeObjectiveChanged: (mode: 'bomb' | 'hostage') => {
      ctx.hud.addRadioMessage(
        mode === 'hostage' ? 'Objective: Hostage Rescue' : 'Objective: Bomb Defusal'
      );
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
const _camForward = new THREE.Vector3();

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
  ctx.audio.setIndoorZone(currentZone === 'CT SPAWN' || currentZone === 'A SHORT');

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

  if (ctx.hostageManager?.enabled && rm.phase === 'ROUND_LIVE') {
    const activeDesc = getMapDescriptor(settingsStore.settings.mapId);
    ctx.hostageManager.update(
      frameDelta,
      playerFeet,
      settingsStore.settings.faction,
      ctx.colliders,
      activeDesc.bounds,
      (amount) => ctx.economy.addCash(amount),
      (reason) => rm.endRound('Vanguard', reason)
    );
  }

  if (ctx.playerManager.playerHealth <= 0 && ctx.nvgActive?.value) {
    ctx.nvgActive.value = false;
    ctx.hud.setNightVision?.(false);
  }

  ctx.utilityManager.update(frameDelta, ctx.colliders, ctx.blocks, playerFeet, worldCamera, ctx.bots, ctx.spatialGrid);
  const smokeOccluders = ctx.utilityManager.getActiveSmokeOccluders();

  if (!cust?.freezeBots) {
    worldCamera.getWorldDirection(_camForward);
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
      ctx.economy.hasHelmet,
      _camForward,
      ctx.radioComms
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
    ctx.spectator.update(frameDelta, worldCamera, ctx.bots, inputMgr.input);
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
  const localFaction = settingsStore.settings.faction;
  let ctAlive = localFaction === 'Vanguard' && ctx.playerManager.playerHealth > 0 ? 1 : 0;
  let tAlive = localFaction === 'Syndicate' && ctx.playerManager.playerHealth > 0 ? 1 : 0;
  for (let i = 0; i < ctx.bots.length; i++) {
    const b = ctx.bots[i];
    if (!b.isDead) {
      if (b.team === 'Vanguard') ctAlive++;
      else tAlive++;
    }
  }
  ctx.hud.updateAliveCounts(ctAlive, tAlive);
  ctx.hud.updateCallout(currentZone);
}


