import * as THREE from 'three';
import { WEAPONS, HitZone, SurfaceMaterial, WeaponDef } from '@garam/shared';
import { settingsStore } from './SettingsStore.js';
import { BotEntity } from '../maps/DeCitadelMap.js';
import { BotAISystemCallbacks } from '../match/BotAISystem.js';
import { WeaponCombatCallbacks } from '../combat/WeaponController.js';
import { RoundCallbacks, RoundPhase } from '../match/RoundManager.js';
import { CustomizerCallbacks } from '../ui/CustomizerUI.js';
import { InputCallbacks } from './InputManager.js';
import { LobbyUICallbacks } from '../ui/LobbyUI.js';
import { BuyMenuUICallbacks } from '../ui/BuyMenuUI.js';
import { SlotNumber } from '../combat/InventoryManager.js';
import { UtilityType } from '../utility/UtilityManager.js';

export interface GameContext {
  canvas: HTMLCanvasElement;
  worldCamera: THREE.PerspectiveCamera;
  viewmodelCamera: THREE.PerspectiveCamera;
  worldScene: THREE.Scene;
  audio: any;
  hud: any;
  effects: any;
  droppedWeapons: any;
  utilityManager: any;
  inventory: any;
  economy: any;
  player: any;
  playerManager: any;
  combatReport: any;
  spectator: any;
  weaponController: any;
  roundManager: any;
  inputManager: any;
  botAI: any;
  customizer: any;
  buyMenuUI: any;
  networkClient: any;
  bots: BotEntity[];
  blocks: any[];
  colliders: any[];
  spawnPos: { x: number; y: number; z: number };
  hasMatchStarted: { value: boolean };
  isFiring: { value: boolean };
  pendingFireTrigger: { value: boolean };
  isInteracting: { value: boolean };
  viewmodel: any;
  syncActiveWeapon: () => void;
}

export function buildBotAICallbacks(ctx: GameContext): BotAISystemCallbacks {
  return {
    onBotShootPlayer: (bot: BotEntity, dmg: number, hitZone: HitZone, isHeadshot: boolean, penetrated: number) => {
      ctx.combatReport.recordDamageTaken(bot.id, bot.name, dmg, isHeadshot);
      ctx.playerManager.damagePlayer(dmg, bot.mesh.position, ctx.worldCamera.position, ctx.inputManager?.input?.yaw || 0, ctx.bots);
      ctx.audio.playGunshot('garam-47', bot.mesh.position, ctx.worldCamera.position, ctx.blocks);
    },
    onBotShootBot: (s: BotEntity, v: BotEntity, dmg: number, hz: HitZone, hs: boolean, pen: number) => {
      ctx.playerManager.handleBotDamagedByBot(s, v, dmg, hs, pen, ctx.blocks, ctx.worldCamera.position, ctx.bots);
    },
    onBotSpawnTracer: (from: THREE.Vector3, to: THREE.Vector3, weaponId?: string) => ctx.effects.spawnTracer(from, to, weaponId || 'garam-47'),
    onBotSpawnDecal: (pt: THREE.Vector3, norm: THREE.Vector3, mat: SurfaceMaterial) => ctx.effects.spawnBulletDecal(pt, norm, mat),
    onBotThrowUtility: (bot: BotEntity, type: 'smoke' | 'flash' | 'molotov', target: THREE.Vector3) => {
      const forward = target.clone().sub(bot.mesh.position).normalize();
      const utilMap: Record<string, UtilityType> = {
        smoke: 'smoke-grenade',
        flash: 'flashbang',
        molotov: 'molotov',
      };
      ctx.utilityManager.throwGrenade(
        utilMap[type] || 'smoke-grenade',
        bot.mesh.position.clone().add(new THREE.Vector3(0, 1.6, 0)),
        forward,
        new THREE.Vector3(0, 0, 0),
        'long'
      );
    },
    onBotRadioCallout: (bot: BotEntity, message: string) => {
      ctx.hud.addKillfeed(`📻 ${bot.name}: "${message}"`);
    },
  };
}

export function buildWeaponControllerCallbacks(ctx: GameContext): WeaponCombatCallbacks {
  return {
    onKill: (k: string, b: BotEntity, hs: boolean, wp: string, r: number) => ctx.playerManager.handlePlayerKill(k, b, hs, wp, r, ctx.bots),
    onCameraPunch: () => {},
    onScopeChanged: (zoomStage: number, fov: number, sens: number) => {
      ctx.worldCamera.fov = fov;
      ctx.worldCamera.updateProjectionMatrix();
      ctx.hud.setScopeOverlay(zoomStage > 0);
      const scopedSens = sens * settingsStore.settings.scopedSensitivityMultiplier;
      ctx.inputManager.setSensitivity(scopedSens);
    },
    onUtilityThrown: () => ctx.hud.addKillfeed('💨 Tactical Smoke Deployed'),
    onHitmarker: (headshot: boolean) => ctx.hud.triggerHitmarker(headshot),
    onFire: (weapon: WeaponDef, isScoped: boolean, rayDir: THREE.Vector3, isSecondaryMelee: boolean) => {
      if (ctx.networkClient.isConnected) {
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
        ctx.botAI.startNewRound(round, ctx.bots, ctx.roundManager.ctLossStreak, ctx.roundManager.tLossStreak);
        ctx.hud.showCenterBanner(`ROUND ${round}`, 'FREEZE TIME — REQUISITION WEAPONS [B]', 3000);
      } else if (phase === 'ROUND_LIVE') {
        ctx.hud.showCenterBanner('LIVE', 'DEFEND SITES A & B', 1800);
      }
    },
    onTimerTick: (timeRemaining: number, isBombArmed: boolean) => ctx.hud.updateRoundTimer(timeRemaining, isBombArmed),
    onPlantProgress: (p: number) => ctx.hud.updateInteractionBar(p, 'PLANTING PULSE CORE...'),
    onDefuseProgress: (p: number) => ctx.hud.updateInteractionBar(p, 'DEFUSING PULSE CORE...'),
    onRoundWon: (winner: 'Vanguard' | 'Syndicate', reason: string, ctScore: number, tScore: number) => {
      ctx.hud.updateScores(ctScore, tScore);
      const isVanguard = winner === 'Vanguard';
      ctx.hud.showCenterBanner(`${winner.toUpperCase()} WINS THE ROUND`, reason, 4500);
      ctx.combatReport.show();

      const payout = ctx.economy.awardRoundEndPayout(
        isVanguard,
        isVanguard ? ctx.roundManager.ctLossStreak : ctx.roundManager.tLossStreak,
        reason.includes('Defused') || reason.includes('Detonated')
      );
      ctx.hud.addKillfeed(`Round End Payout: +$${payout}`);
    },
    onResetRound: () => {
      ctx.spectator.stop();
      ctx.playerManager.reset(ctx.spawnPos);
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
      ctx.hud.showCenterBanner(`MATCH VICTORY — ${winner.toUpperCase()}`, `Final Score: Vanguard ${ctScore} : ${tScore} Syndicate`, 8000);
    },
  };
}

export function buildCustomizerCallbacks(ctx: GameContext): CustomizerCallbacks {
  return {
    onCrosshairChanged: (cfg: any) => {
      document.querySelectorAll('.crosshair-bar, .crosshair-dot').forEach((el) => {
        (el as HTMLElement).style.background = cfg.color;
      });
    },
    onGrantCash: () => {
      ctx.economy.devPracticeMoney();
      ctx.hud.addKillfeed('🛠️ Practice Mode: $16,000 Cash Granted');
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
      if (ctx.inputManager.uiState === 'PLAYING') ctx.inputManager.requestPointerLock();
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
      ctx.weaponController.onFireRelease();
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
      ctx.weaponController.handleSecondaryFire(ctx.worldCamera, ctx.blocks, ctx.bots);
    },
    onReload: () => {
      const slotState = ctx.inventory.getActiveSlotState();
      ctx.viewmodel.isEmptyReload = slotState.currentAmmo === 0;
      if (ctx.inventory.startReload()) {
        ctx.audio.playReload(ctx.viewmodel.isEmptyReload);
        ctx.viewmodel.isReloading = true;
      }
    },
    onQuickSwitch: () => {
      if (ctx.inventory.quickSwitch()) {
        ctx.audio.cancelReloadAudio?.();
        ctx.syncActiveWeapon();
      }
    },
    onSlotSelect: (slot: SlotNumber) => {
      if (ctx.inventory.equipSlot(slot)) {
        ctx.audio.cancelReloadAudio?.();
        ctx.syncActiveWeapon();
      } else if (!ctx.inventory.hasSlot(slot)) {
        ctx.audio.playDryFire();
      }
    },
    onCycleWeapon: (dir: number) => {
      const switched = dir > 0 ? ctx.inventory.cycleNext() : ctx.inventory.cyclePrev();
      if (switched) {
        ctx.audio.cancelReloadAudio?.();
        ctx.syncActiveWeapon();
      }
    },
    onToggleBuyMenu: () => {
      ctx.buyMenuUI.toggle(undefined, ctx.roundManager.phase, ctx.roundManager.phaseTimer, ctx.worldCamera.position);
    },
    onBuyItem: (key: number) => {
      ctx.buyMenuUI.handleBuyByKey(key, ctx.roundManager.phase, ctx.roundManager.phaseTimer, ctx.worldCamera.position);
    },
    onPracticeToggle: () => {
      ctx.economy.devPracticeMoney();
      ctx.hud.addKillfeed('🛠️ Practice Mode: $16,000 Cash Granted');
    },
    onInspectWeapon: () => ctx.weaponController.inspectWeapon(),
    onDropWeapon: () => {
      ctx.audio.cancelReloadAudio?.();
      ctx.playerManager.handleDropActiveWeapon(ctx.worldCamera);
    },
    onUtilityQuickSelect: (type: 'molotov' | 'smoke' | 'flash' | 'he') => ctx.playerManager.handleQuickUtility(type),
    onToggleCustomizer: () => {
      ctx.customizer.toggle();
      if (ctx.customizer.isOpen) ctx.inputManager.exitPointerLock();
    },
    onInteractDown: () => {
      ctx.isInteracting.value = true;
      ctx.worldCamera.getWorldDirection(_forward);
      ctx.droppedWeapons.tryLootAimingAt(ctx.worldCamera.position, _forward, (dropped: any) => {
        return ctx.playerManager.equipDroppedWeapon(dropped);
      });
    },
    onInteractUp: () => { ctx.isInteracting.value = false; },
  };
}

export function buildBuyMenuCallbacks(ctx: GameContext): BuyMenuUICallbacks {
  return {
    onTogglePointerLock: (lock: boolean) => {
      if (lock) {
        ctx.inputManager.uiState = 'PLAYING';
        ctx.inputManager.requestPointerLock();
      } else {
        ctx.inputManager.uiState = 'BUY_MENU';
        ctx.inputManager.exitPointerLock();
      }
    },
    onWeaponEquipped: () => ctx.syncActiveWeapon(),
  };
}

export function buildLobbyCallbacks(ctx: GameContext): LobbyUICallbacks {
  return {
    onDeploy: () => {
      if (!ctx.hasMatchStarted.value) {
        ctx.hasMatchStarted.value = true;
        ctx.roundManager.startMatch();
      }
      if (settingsStore.settings.gameMode === 'multiplayer') {
        if (!ctx.networkClient.isConnected) {
          const urlInput = document.getElementById('server-url-input') as HTMLInputElement;
          const nameInput = document.getElementById('player-callsign-input') as HTMLInputElement;
          ctx.networkClient.connect(urlInput?.value || 'ws://localhost:2567', nameInput?.value || 'Eldar Garamov', settingsStore.settings.faction);
        }
      } else {
        ctx.networkClient.disconnect();
      }
      ctx.inputManager.requestPointerLock();
    },
    onCustomizer: () => ctx.customizer.toggle(true),
    onSensitivityChanged: (val: number) => ctx.inputManager.setSensitivity(val),
    onFovChanged: (val: number) => { ctx.worldCamera.fov = val; ctx.worldCamera.updateProjectionMatrix(); },
    onVolumeChanged: (vol: number) => ctx.audio.setMasterVolume(vol),
    onDifficultyChanged: (diff: any) => {
      ctx.botAI.setDifficulty(diff);
      ctx.hud.addKillfeed(`Bot Difficulty: ${diff.toUpperCase()}`);
    },
  };
}
