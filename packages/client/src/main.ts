import * as THREE from 'three';
import {
  KinematicPlayerController,
  KINEMATICS,
  ECONOMY,
  WEAPONS,
  WeaponDef,
  MapBlockCollider,
  AABBCollider,
  SPAWN_POINTS,
  getCalloutName,
} from '@garam/shared';
import { SceneManager } from './render/SceneManager.js';
import { WeaponViewmodel } from './viewmodel/WeaponViewmodel.js';
import { ProceduralAudio } from './audio/ProceduralAudio.js';
import { buildTacticalCitadelMap, BotEntity } from './maps/DeCitadelMap.js';
import { InventoryManager, SlotNumber } from './combat/InventoryManager.js';
import { WeaponController } from './combat/WeaponController.js';
import { EffectsManager } from './combat/EffectsManager.js';
import { DroppedWeaponManager } from './combat/DroppedWeaponManager.js';
import { PlayerManager } from './combat/PlayerManager.js';
import { InputManager } from './core/InputManager.js';
import { RoundManager } from './match/RoundManager.js';
import { EconomyManager } from './match/EconomyManager.js';
import { HUDManager } from './ui/HUDManager.js';
import { LobbyUI } from './ui/LobbyUI.js';
import { BuyMenuUI } from './ui/BuyMenuUI.js';
import { CombatReportManager } from './ui/CombatReportManager.js';
import { SpectatorManager } from './match/SpectatorManager.js';
import { UtilityManager, UtilityType } from './utility/UtilityManager.js';
import { RadarRenderer } from './ui/RadarRenderer.js';
import { BotAISystem } from './match/BotAISystem.js';
import { settingsStore } from './core/SettingsStore.js';
import { CustomizerUI } from './ui/CustomizerUI.js';
import { NetworkClient } from './net/NetworkClient.js';
import { PerfMonitor } from './core/PerfMonitor.js';

// Pre-allocated scratch objects for zero-GC render hot loop
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _forward = new THREE.Vector3();

export class GaramGame {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;

  // Scene & PBR Lighting Pipeline
  private sceneManager: SceneManager;
  private worldScene: THREE.Scene;
  private worldCamera: THREE.PerspectiveCamera;
  private viewmodelScene: THREE.Scene;
  private viewmodelCamera: THREE.PerspectiveCamera;
  private viewmodel: WeaponViewmodel;

  // Audio, Effects, Utilities & HUD
  private audio: ProceduralAudio;
  private effects: EffectsManager;
  private utilityManager: UtilityManager;
  private droppedWeapons: DroppedWeaponManager;
  private radar: RadarRenderer;
  private customizer: CustomizerUI;
  private networkClient: NetworkClient;
  private perfMonitor: PerfMonitor;
  private combatReport: CombatReportManager;
  private spectator: SpectatorManager;

  // Gameplay & Physics Systems
  private player: KinematicPlayerController;
  private inventory: InventoryManager;
  private economy: EconomyManager;
  private playerManager: PlayerManager;
  private hud: HUDManager;
  private weaponController: WeaponController;
  private roundManager: RoundManager;
  private inputManager: InputManager;
  private botAI: BotAISystem;
  private lobbyUI: LobbyUI;
  private buyMenuUI: BuyMenuUI;

  // Map Data
  private bots: BotEntity[] = [];
  private blocks: MapBlockCollider[] = [];
  private colliders: AABBCollider[] = [];
  private bombsites: { A: THREE.Vector3; B: THREE.Vector3 };

  // Runtime State
  private hasMatchStarted = false;
  private isFiring = false;
  private isInteracting = false;
  private cameraPunchPitch = 0;

  // 128Hz Fixed Physics Accumulator
  private lastTime = performance.now();
  private accumulator = 0;
  private readonly FIXED_DT = 1 / 128;
  private distanceTraveled = 0;
  private lastStepDist = 0;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;

    // 1. Scene Pipeline with PMREM IBL, Sun & Sky Dome
    this.sceneManager = new SceneManager(this.renderer);
    this.worldScene = this.sceneManager.worldScene;
    this.worldCamera = this.sceneManager.worldCamera;
    this.viewmodelScene = this.sceneManager.viewmodelScene;
    this.viewmodelCamera = this.sceneManager.viewmodelCamera;

    this.viewmodel = new WeaponViewmodel();
    this.viewmodelScene.add(this.viewmodel.mesh);

    // 2. Audio, Effects & Tactical Managers
    this.audio = new ProceduralAudio();
    this.audio.setMasterVolume(settingsStore.settings.masterVolume);
    this.hud = new HUDManager();
    this.effects = new EffectsManager(this.worldScene, this.worldCamera);
    this.droppedWeapons = new DroppedWeaponManager(this.worldScene);
    this.radar = new RadarRenderer();
    this.perfMonitor = new PerfMonitor(this.renderer);
    this.combatReport = new CombatReportManager();
    this.spectator = new SpectatorManager();

    this.utilityManager = new UtilityManager(this.worldScene, this.audio, {
      onFlashPlayer: (dur) => this.hud.triggerFlashEffect(dur),
      onPlayerDamage: (dmg) => this.playerManager.damagePlayer(dmg, null, this.worldCamera.position, this.inputManager?.input?.yaw || 0, this.bots),
      onKillfeed: (text) => this.hud.addKillfeed(text),
    });

    // 3. Core Combat, Inventory & Economy
    this.inventory = new InventoryManager();
    this.economy = new EconomyManager();

    const spawnPos = settingsStore.settings.faction === 'Syndicate' ? SPAWN_POINTS.OBSIDIAN_T : SPAWN_POINTS.VANGUARD_CT;
    this.player = new KinematicPlayerController(spawnPos.x, spawnPos.y, spawnPos.z);

    this.playerManager = new PlayerManager(
      this.player,
      this.inventory,
      this.economy,
      this.droppedWeapons,
      this.utilityManager,
      this.audio,
      this.hud,
      this.combatReport,
      this.spectator,
      {
        onSyncActiveWeapon: () => this.syncActiveWeapon(),
      }
    );

    // 4. Map Setup
    const mapData = buildTacticalCitadelMap(this.worldScene);
    this.bots = mapData.bots;
    this.blocks = mapData.blocks;
    this.colliders = mapData.colliders;
    this.bombsites = mapData.bombsites;

    // 5. Tactical Bot AI
    this.botAI = new BotAISystem(
      {
        onBotShootPlayer: (bot, dmg, hitZone, isHeadshot, penetrated) => {
          this.combatReport.recordDamageTaken(bot.id, bot.name, dmg, isHeadshot);
          this.playerManager.damagePlayer(dmg, bot.mesh.position, this.worldCamera.position, this.inputManager?.input?.yaw || 0, this.bots);
          this.audio.playGunshot('garam-47', bot.mesh.position, this.worldCamera.position, this.blocks);
        },
        onBotShootBot: (s, v, dmg, hz, hs, pen) => this.playerManager.handleBotDamagedByBot(s, v, dmg, hs, pen, this.blocks, this.worldCamera.position, this.bots),
        onBotSpawnTracer: (from, to, weaponId) => this.effects.spawnTracer(from, to, weaponId || 'garam-47'),
        onBotSpawnDecal: (pt, norm, mat) => this.effects.spawnBulletDecal(pt, norm, mat),
        onBotThrowUtility: (bot, type, target) => {
          const forward = target.clone().sub(bot.mesh.position).normalize();
          const utilMap: Record<string, UtilityType> = {
            smoke: 'smoke-grenade',
            flash: 'flashbang',
            molotov: 'molotov',
          };
          this.utilityManager.throwGrenade(
            utilMap[type] || 'smoke-grenade',
            bot.mesh.position.clone().add(new THREE.Vector3(0, 1.6, 0)),
            forward,
            new THREE.Vector3(0, 0, 0),
            'long'
          );
        },
      },
      settingsStore.settings.botDifficulty
    );

    // 6. Weapon Controller
    this.weaponController = new WeaponController(
      this.inventory,
      this.viewmodel,
      this.effects,
      this.audio,
      {
        onKill: (k, b, hs, wp, r) => this.playerManager.handlePlayerKill(k, b, hs, wp, r, this.bots),
        onCameraPunch: () => {},
        onScopeChanged: (zoomStage, fov, sens) => {
          this.worldCamera.fov = fov;
          this.worldCamera.updateProjectionMatrix();
          this.hud.setScopeOverlay(zoomStage > 0);
          const scopedSens = sens * settingsStore.settings.scopedSensitivityMultiplier;
          this.inputManager.setSensitivity(scopedSens);
        },
        onUtilityThrown: () => this.hud.addKillfeed('💨 Tactical Smoke Deployed'),
        onHitmarker: (headshot) => this.hud.triggerHitmarker(headshot),
        onFire: (weapon, isScoped, rayDir, isSecondaryMelee) => {
          if (this.networkClient.isConnected) {
            this.networkClient.sendFire(
              rayDir,
              weapon.id,
              this.inputManager.input.yaw,
              this.inputManager.input.pitch,
              isSecondaryMelee,
              isScoped
            );
          }
        },
      }
    );

    // 7. Sandbox Customizer [F2]
    this.customizer = new CustomizerUI({
      onCrosshairChanged: (cfg) => {
        document.querySelectorAll('.crosshair-bar, .crosshair-dot').forEach((el) => { (el as HTMLElement).style.background = cfg.color; });
      },
      onGrantCash: () => {
        this.economy.devPracticeMoney();
        this.hud.addKillfeed('🛠️ Practice Mode: $16,000 Cash Granted');
      },
      onToggleInfiniteAmmo: (en) => this.hud.addKillfeed(`Infinite Ammo: ${en ? 'ON' : 'OFF'}`),
      onToggleShowImpacts: (en) => this.hud.addKillfeed(`Show Impacts: ${en ? 'ON' : 'OFF'}`),
      onToggleFreezeBots: (fr) => this.hud.addKillfeed(`Freeze Bots: ${fr ? 'FROZEN' : 'ACTIVE'}`),
      onToggleHitboxes: (sh) => this.bots.forEach((b) => b.rig?.setWireframesVisible(sh)),
      onToggleFollowRecoil: (en) => this.hud.addKillfeed(`Follow Recoil: ${en ? 'ON' : 'OFF'}`),
      onRespawnBots: () => {
        this.playerManager.respawnAllBots(this.bots);
        this.hud.addKillfeed('Respawned all bots to tactical spawn positions');
      },
      onExit: () => { if (this.inputManager.uiState === 'PLAYING') this.inputManager.requestPointerLock(); },
    });

    // 8. Round Manager
    this.roundManager = new RoundManager(this.worldScene, this.audio, {
      onPhaseChanged: (phase, round) => {
        if (phase === 'FREEZE_TIME') {
          this.combatReport.resetRound();
          this.spectator.stop();
          this.botAI.startNewRound(round, this.bots);
          this.hud.showCenterBanner(`ROUND ${round}`, 'FREEZE TIME — REQUISITION WEAPONS [B]', 3000);
        } else if (phase === 'ROUND_LIVE') {
          this.hud.showCenterBanner('LIVE', 'DEFEND SITES A & B', 1800);
        }
      },
      onTimerTick: (timeRemaining, isBombArmed) => this.hud.updateRoundTimer(timeRemaining, isBombArmed),
      onPlantProgress: (p) => this.hud.updateInteractionBar(p, 'PLANTING PULSE CORE...'),
      onDefuseProgress: (p) => this.hud.updateInteractionBar(p, 'DEFUSING PULSE CORE...'),
      onRoundWon: (winner, reason, ctScore, tScore) => {
        this.hud.updateScores(ctScore, tScore);
        const isVanguard = winner === 'Vanguard';
        this.hud.showCenterBanner(`${winner.toUpperCase()} WINS THE ROUND`, reason, 4500);
        this.combatReport.show();

        const payout = this.economy.awardRoundEndPayout(
          isVanguard,
          isVanguard ? this.roundManager.ctLossStreak : this.roundManager.tLossStreak,
          reason.includes('Defused') || reason.includes('Detonated')
        );
        this.hud.addKillfeed(`Round End Payout: +$${payout}`);
      },
      onResetRound: () => {
        this.spectator.stop();
        this.playerManager.reset(spawnPos);
        this.playerManager.respawnAllBots(this.bots);
        for (let s = 1; s <= 3; s++) {
          const state = this.inventory.slots[s as SlotNumber];
          if (state && WEAPONS[state.weaponId]) {
            const def = WEAPONS[state.weaponId];
            state.currentAmmo = def.magCapacity;
            state.reserveAmmo = def.reserveAmmo;
          }
        }
        this.syncActiveWeapon();
      },
      onMatchComplete: (winner, ctScore, tScore) => {
        this.hud.updateScores(ctScore, tScore);
        this.hud.showCenterBanner(`MATCH VICTORY — ${winner.toUpperCase()}`, `Final Score: Vanguard ${ctScore} : ${tScore} Syndicate`, 8000);
      },
    });

    // 9. Input & UI Glue
    const blocker = document.getElementById('blocker')!;
    this.inputManager = new InputManager(this.canvas, blocker, {
      onFireDown: () => {
        if (this.spectator.isSpectating) {
          this.spectator.cycleTeammate(1, this.bots);
          return;
        }
        this.isFiring = true;
        const active = this.inventory.getActiveWeapon();
        if (active.category === 'grenade') {
          this.playerManager.throwUtilityGrenade('long', this.worldCamera);
          return;
        }
        this.weaponController.handlePrimaryFire(
          this.worldCamera,
          this.player.getHorizontalSpeed(),
          this.player.state.isGrounded,
          this.inputManager.input.yaw,
          this.inputManager.input.pitch,
          this.blocks,
          this.bots
        );
      },
      onFireUp: () => {
        this.isFiring = false;
        this.weaponController.onFireRelease();
      },
      onAltFire: () => {
        if (this.spectator.isSpectating) {
          this.spectator.cycleTeammate(-1, this.bots);
          return;
        }
        const active = this.inventory.getActiveWeapon();
        if (active.category === 'grenade') {
          this.playerManager.throwUtilityGrenade('short', this.worldCamera);
          return;
        }
        this.weaponController.handleSecondaryFire(this.worldCamera, this.blocks, this.bots);
      },
      onReload: () => {
        if (this.inventory.startReload()) {
          this.audio.playReload();
          this.viewmodel.isReloading = true;
        }
      },
      onQuickSwitch: () => {
        if (this.inventory.quickSwitch()) this.syncActiveWeapon();
      },
      onSlotSelect: (slot) => {
        if (this.inventory.equipSlot(slot)) {
          this.syncActiveWeapon();
        } else if (!this.inventory.hasSlot(slot)) {
          this.audio.playDryFire();
        }
      },
      onCycleWeapon: (dir) => {
        const switched = dir > 0 ? this.inventory.cycleNext() : this.inventory.cyclePrev();
        if (switched) this.syncActiveWeapon();
      },
      onToggleBuyMenu: () => this.buyMenuUI.toggle(undefined, this.roundManager.phase, this.roundManager.phaseTimer, this.worldCamera.position),
      onBuyItem: (key) => this.buyMenuUI.handleBuyByKey(key, this.roundManager.phase, this.roundManager.phaseTimer, this.worldCamera.position),
      onPracticeToggle: () => {
        this.economy.devPracticeMoney();
        this.hud.addKillfeed('🛠️ Practice Mode: $16,000 Cash Granted');
      },
      onInspectWeapon: () => this.weaponController.inspectWeapon(),
      onDropWeapon: () => this.playerManager.handleDropActiveWeapon(this.worldCamera),
      onUtilityQuickSelect: (type) => this.playerManager.handleQuickUtility(type),
      onToggleCustomizer: () => {
        this.customizer.toggle();
        if (this.customizer.isOpen) this.inputManager.exitPointerLock();
      },
      onInteractDown: () => {
        this.isInteracting = true;
        this.worldCamera.getWorldDirection(_forward);
        this.droppedWeapons.tryLootAimingAt(this.worldCamera.position, _forward, (dropped) => {
          return this.playerManager.equipDroppedWeapon(dropped);
        });
      },
      onInteractUp: () => { this.isInteracting = false; },
    });

    // 10. Modular UI Managers
    this.buyMenuUI = new BuyMenuUI(this.economy, this.inventory, this.audio, this.hud, {
      onTogglePointerLock: (lock) => {
        if (lock) {
          this.inputManager.uiState = 'PLAYING';
          this.inputManager.requestPointerLock();
        } else {
          this.inputManager.uiState = 'BUY_MENU';
          this.inputManager.exitPointerLock();
        }
      },
      onWeaponEquipped: () => this.syncActiveWeapon(),
    });

    this.lobbyUI = new LobbyUI({
      onDeploy: () => {
        if (!this.hasMatchStarted) {
          this.hasMatchStarted = true;
          this.roundManager.startMatch();
        }
        if (settingsStore.settings.gameMode === 'multiplayer') {
          if (!this.networkClient.isConnected) {
            const urlInput = document.getElementById('server-url-input') as HTMLInputElement;
            const nameInput = document.getElementById('player-callsign-input') as HTMLInputElement;
            this.networkClient.connect(urlInput?.value || 'ws://localhost:2567', nameInput?.value || 'Eldar Garamov', settingsStore.settings.faction);
          }
        } else {
          this.networkClient.disconnect();
        }
        this.inputManager.requestPointerLock();
      },
      onCustomizer: () => this.customizer.toggle(true),
      onSensitivityChanged: (val) => this.inputManager.setSensitivity(val),
      onFovChanged: (val) => { this.worldCamera.fov = val; this.worldCamera.updateProjectionMatrix(); },
      onVolumeChanged: (vol) => this.audio.setMasterVolume(vol),
      onDifficultyChanged: (diff) => { this.botAI.setDifficulty(diff); this.hud.addKillfeed(`Bot Difficulty: ${diff.toUpperCase()}`); },
    });

    this.networkClient = new NetworkClient(this.worldScene, this.hud, this.colliders, {
      onKillfeed: (text) => this.hud.addKillfeed(text),
      onScoresUpdated: (ct, t) => this.hud.updateScores(ct, t),
    });

    this.inputManager.setSensitivity(settingsStore.settings.mouseSensitivity);
    this.syncActiveWeapon();

    window.addEventListener('resize', this.onResize.bind(this));
    requestAnimationFrame(this.loop.bind(this));
  }

  private syncActiveWeapon(): void {
    const active = this.inventory.getActiveWeapon();
    if (this.weaponController.zoomStage > 0 && active.id !== 'sovereign-awp') {
      this.weaponController.zoomStage = 0;
      this.worldCamera.fov = settingsStore.settings.fov;
      this.worldCamera.updateProjectionMatrix();
      this.hud.setScopeOverlay(false);
      this.inputManager.setSensitivity(settingsStore.settings.mouseSensitivity);
    }
    if (active.id === 'garam-karambit') {
      this.audio.playKnifeDraw();
    }
    this.viewmodel.setWeapon(active.id);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.worldCamera.aspect = w / h;
    this.worldCamera.updateProjectionMatrix();
    this.viewmodelCamera.aspect = w / h;
    this.viewmodelCamera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private loop(now: number): void {
    requestAnimationFrame(this.loop.bind(this));

    const frameDelta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (!this.hasMatchStarted) {
      this.effects.update(frameDelta);
      this.sceneManager.update(frameDelta, this.worldCamera.position);
      this.renderer.clear();
      this.renderer.render(this.worldScene, this.worldCamera);
      return;
    }

    this.accumulator += frameDelta;

    const activeWp = this.inventory.getActiveWeapon();
    const activeSlotState = this.inventory.getActiveSlotState();

    // 128Hz Fixed Kinematics Accumulator
    while (this.accumulator >= this.FIXED_DT) {
      if (!this.spectator.isSpectating) {
        this.inputManager.update(this.FIXED_DT, this.player.state.isGrounded);
        this.player.update(this.inputManager.input, this.FIXED_DT, activeWp.movementSpeed, this.colliders);
        if (this.networkClient.isConnected) {
          this.networkClient.sendInput(this.inputManager.input, this.FIXED_DT, activeWp.movementSpeed, this.player, activeWp.id);
        }
      }
      this.accumulator -= this.FIXED_DT;
    }

    if (this.networkClient.isConnected) {
      this.networkClient.update(frameDelta);
    }

    // Footstep audio
    const hozSpeed = this.player.getHorizontalSpeed();
    if (!this.spectator.isSpectating && this.player.state.isGrounded && hozSpeed > 0.8 && !this.inputManager.input.walk) {
      this.distanceTraveled += hozSpeed * frameDelta;
      if (this.distanceTraveled - this.lastStepDist > 2.2) {
        this.audio.playFootstep('CONCRETE');
        this.lastStepDist = this.distanceTraveled;
      }
    }

    // Web Audio Listener Sync & Dynamic Indoor Reverb
    this.audio.updateListener(this.worldCamera);
    const currentZone = getCalloutName(this.player.state.x, this.player.state.y, this.player.state.z);
    const isIndoor = currentZone === 'B TUNNELS' || currentZone === 'A CONNECTOR' || currentZone === 'B CONNECTOR';
    this.audio.setIndoorZone(isIndoor);

    // Weapon Inventory Timers Tick
    const invUpdate = this.inventory.update(frameDelta);
    if (invUpdate.reloadCompleted) {
      this.viewmodel.isReloading = false;
      this.hud.updateReloadProgress(false, 0);
    }
    if (this.inventory.isReloading) {
      const progress = 1 - (this.inventory.reloadRemaining / this.inventory.reloadDuration);
      this.viewmodel.reloadProgress = progress;
      this.hud.updateReloadProgress(true, progress);
    }

    // Continuous fire for automatic weapons
    if (this.isFiring && this.inputManager.isLocked && activeWp.fireMode === 'auto' && !this.spectator.isSpectating) {
      if (this.customizer.infiniteAmmo) {
        activeSlotState.currentAmmo = activeWp.magCapacity;
      }
      this.weaponController.handlePrimaryFire(
        this.worldCamera,
        hozSpeed,
        this.player.state.isGrounded,
        this.inputManager.input.yaw,
        this.inputManager.input.pitch,
        this.blocks,
        this.bots
      );
    }

    this.weaponController.update(frameDelta, hozSpeed, this.inputManager.input.crouch);
    this.effects.update(frameDelta);
    this.sceneManager.update(frameDelta, this.worldCamera.position);

    // Dropped weapons floor updates & auto-looting
    this.droppedWeapons.update(frameDelta, this.colliders, this.worldCamera.position, (dropped) => {
      const def = WEAPONS[dropped.weaponId];
      if (def && !this.inventory.slots[def.slot]) {
        return this.playerManager.equipDroppedWeapon(dropped);
      }
      return false;
    });

    this.cameraPunchPitch += (0 - this.cameraPunchPitch) * (1 - Math.exp(-18 * frameDelta));

    // Round Manager & Tactical Utility updates
    const isPlayerCarrier = this.inventory.slots[5] !== null;
    this.roundManager.update(
      frameDelta,
      this.worldCamera.position,
      this.isInteracting,
      isPlayerCarrier,
      this.economy.hasDefuseKit,
      this.bots
    );

    this.utilityManager.update(
      frameDelta,
      this.colliders,
      this.blocks,
      this.worldCamera.position,
      this.worldCamera,
      this.bots
    );

    const smokeOccluders = this.utilityManager.getActiveSmokeOccluders();

    // Bot AI update with nav graph, real ballistics & smoke occlusion
    if (!this.customizer.freezeBots) {
      this.botAI.update(
        this.bots,
        frameDelta,
        this.colliders,
        this.blocks,
        this.worldCamera.position,
        this.worldCamera.position,
        smokeOccluders,
        this.roundManager.isBombPlanted,
        this.roundManager.bombPlantSite,
        this.playerManager.playerHealth,
        this.economy.armor
      );
    }

    // Radar update
    this.radar.update(
      this.worldCamera.position,
      this.inputManager.input.yaw,
      this.blocks,
      this.bots,
      smokeOccluders,
      this.roundManager.bombPosition,
      this.roundManager.isBombPlanted
    );

    // Camera transform or Spectator follow cam
    if (this.spectator.isSpectating) {
      this.spectator.update(frameDelta, this.worldCamera, this.bots);
    } else {
      const alpha = Math.min(1, Math.max(0, this.accumulator / this.FIXED_DT));
      const interp = this.player.getInterpolatedPosition(alpha);
      this.worldCamera.position.set(interp.x, interp.eyeY, interp.z);

      const effectivePitch = this.inputManager.input.pitch + this.cameraPunchPitch + this.weaponController.aimPunchPitch * 0.45;
      const effectiveYaw = this.inputManager.input.yaw + this.weaponController.aimPunchYaw * 0.45;
      _euler.set(effectivePitch, effectiveYaw, 0, 'YXZ');
      this.worldCamera.quaternion.setFromEuler(_euler);
    }

    const walkBob = Math.sin(this.distanceTraveled * 4) * 0.008 * (hozSpeed / 5.45);
    let strafeRoll = 0;
    if (this.inputManager.input.left) strafeRoll = 0.025;
    if (this.inputManager.input.right) strafeRoll = -0.025;

    this.viewmodel.update(frameDelta, this.inputManager.mouseDeltaX, this.inputManager.mouseDeltaY, walkBob, strafeRoll);
    this.inputManager.mouseDeltaX = 0;
    this.inputManager.mouseDeltaY = 0;

    // HUD Stats Update
    const isPinpoint = hozSpeed <= 0.38 && this.player.state.isGrounded;
    this.hud.updatePlayerStats(
      this.playerManager.playerHealth,
      this.economy.armor,
      this.economy.cash,
      hozSpeed,
      isPinpoint,
      activeWp.name,
      activeSlotState.currentAmmo,
      activeSlotState.reserveAmmo,
      this.inventory.activeSlot
    );

    this.hud.updateCrosshair(
      hozSpeed,
      this.weaponController.consecutiveShots,
      isPinpoint,
      this.weaponController.aimPunchYaw,
      this.weaponController.aimPunchPitch,
      settingsStore.settings.followRecoil
    );

    this.hud.updateCallout(currentZone);
    this.perfMonitor.recordFrame(frameDelta * 1000, this.networkClient.isConnected ? 14 : -1);

    // Dual-Pass Rendering
    this.renderer.clear();
    this.renderer.render(this.worldScene, this.worldCamera);
    this.renderer.clearDepth();
    if (!this.spectator.isSpectating) {
      this.renderer.render(this.viewmodelScene, this.viewmodelCamera);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new GaramGame();
});
