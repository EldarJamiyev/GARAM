import * as THREE from 'three';
import {
  KinematicPlayerController,
  MapBlockCollider,
  AABBCollider,
  SPAWN_POINTS,
  WEAPONS,
  getCalloutName,
} from '@garam/shared';
import { SceneManager } from './render/SceneManager.js';
import { WeaponViewmodel } from './viewmodel/WeaponViewmodel.js';
import { ProceduralAudio } from './audio/ProceduralAudio.js';
import { buildTacticalCitadelMap, BotEntity } from './maps/DeCitadelMap.js';
import { InventoryManager } from './combat/InventoryManager.js';
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
import { UtilityManager } from './utility/UtilityManager.js';
import { RadarRenderer } from './ui/RadarRenderer.js';
import { BotAISystem } from './match/BotAISystem.js';
import { settingsStore } from './core/SettingsStore.js';
import { CustomizerUI } from './ui/CustomizerUI.js';
import { NetworkClient } from './net/NetworkClient.js';
import { PerfMonitor } from './core/PerfMonitor.js';
import {
  GameContext,
  buildBotAICallbacks,
  buildWeaponControllerCallbacks,
  buildRoundCallbacks,
  buildCustomizerCallbacks,
  buildInputManagerCallbacks,
  buildBuyMenuCallbacks,
  buildLobbyCallbacks,
} from './core/GameEventWire.js';

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _forward = new THREE.Vector3();

export class GaramGame {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private sceneManager: SceneManager;
  private worldScene: THREE.Scene;
  private worldCamera: THREE.PerspectiveCamera;
  private viewmodelScene: THREE.Scene;
  private viewmodelCamera: THREE.PerspectiveCamera;
  private viewmodel: WeaponViewmodel;

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

  private bots: BotEntity[] = [];
  private blocks: MapBlockCollider[] = [];
  private colliders: AABBCollider[] = [];

  // Runtime State Wrapped for Wire Access
  private hasMatchStarted = { value: false };
  private isFiring = { value: false };
  private pendingFireTrigger = { value: false };
  private isInteracting = { value: false };
  private cameraPunchPitch = 0;

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

    this.sceneManager = new SceneManager(this.renderer);
    this.worldScene = this.sceneManager.worldScene;
    this.worldCamera = this.sceneManager.worldCamera;
    this.viewmodelScene = this.sceneManager.viewmodelScene;
    this.viewmodelCamera = this.sceneManager.viewmodelCamera;

    this.viewmodel = new WeaponViewmodel();
    this.viewmodelScene.add(this.viewmodel.mesh);

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
      { onSyncActiveWeapon: () => this.syncActiveWeapon() }
    );

    const mapData = buildTacticalCitadelMap(this.worldScene);
    this.bots = mapData.bots;
    this.blocks = mapData.blocks;
    this.colliders = mapData.colliders;

    const ctx: GameContext = {
      canvas: this.canvas,
      worldCamera: this.worldCamera,
      viewmodelCamera: this.viewmodelCamera,
      worldScene: this.worldScene,
      audio: this.audio,
      hud: this.hud,
      effects: this.effects,
      droppedWeapons: this.droppedWeapons,
      utilityManager: this.utilityManager,
      inventory: this.inventory,
      economy: this.economy,
      player: this.player,
      playerManager: this.playerManager,
      combatReport: this.combatReport,
      spectator: this.spectator,
      weaponController: null as any,
      roundManager: null as any,
      inputManager: null as any,
      botAI: null as any,
      customizer: null as any,
      buyMenuUI: null as any,
      networkClient: null as any,
      bots: this.bots,
      blocks: this.blocks,
      colliders: this.colliders,
      spawnPos,
      hasMatchStarted: this.hasMatchStarted,
      isFiring: this.isFiring,
      pendingFireTrigger: this.pendingFireTrigger,
      isInteracting: this.isInteracting,
      viewmodel: this.viewmodel,
      syncActiveWeapon: () => this.syncActiveWeapon(),
    };

    this.botAI = new BotAISystem(buildBotAICallbacks(ctx), settingsStore.settings.botDifficulty);
    ctx.botAI = this.botAI;

    this.weaponController = new WeaponController(this.inventory, this.viewmodel, this.effects, this.audio, buildWeaponControllerCallbacks(ctx));
    ctx.weaponController = this.weaponController;

    this.customizer = new CustomizerUI(buildCustomizerCallbacks(ctx));
    ctx.customizer = this.customizer;

    this.roundManager = new RoundManager(this.worldScene, this.audio, buildRoundCallbacks(ctx));
    ctx.roundManager = this.roundManager;

    const blocker = document.getElementById('blocker')!;
    this.inputManager = new InputManager(this.canvas, blocker, buildInputManagerCallbacks(ctx));
    ctx.inputManager = this.inputManager;

    this.buyMenuUI = new BuyMenuUI(this.economy, this.inventory, this.audio, this.hud, buildBuyMenuCallbacks(ctx));
    ctx.buyMenuUI = this.buyMenuUI;

    this.lobbyUI = new LobbyUI(buildLobbyCallbacks(ctx));

    this.networkClient = new NetworkClient(this.worldScene, this.hud, this.colliders, {
      onKillfeed: (text) => this.hud.addKillfeed(text),
      onScoresUpdated: (ct, t) => this.hud.updateScores(ct, t),
    });
    ctx.networkClient = this.networkClient;

    this.inputManager.setSensitivity(settingsStore.settings.mouseSensitivity);
    this.syncActiveWeapon();

    window.addEventListener('resize', this.onResize.bind(this));
    requestAnimationFrame(this.loop.bind(this));
  }

  private syncActiveWeapon(): void {
    this.audio.cancelReloadAudio();
    this.viewmodel.isReloading = false;
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

    if (!this.hasMatchStarted.value) {
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

    const hozSpeed = this.player.getHorizontalSpeed();
    if (!this.spectator.isSpectating && this.player.state.isGrounded && hozSpeed > 0.8 && !this.inputManager.input.walk) {
      this.distanceTraveled += hozSpeed * frameDelta;
      if (this.distanceTraveled - this.lastStepDist > 2.2) {
        this.audio.playFootstep('CONCRETE');
        this.lastStepDist = this.distanceTraveled;
      }
    }

    this.audio.updateListener(this.worldCamera);
    const currentZone = getCalloutName(this.player.state.x, this.player.state.y, this.player.state.z);
    const isIndoor = currentZone === 'B TUNNELS' || currentZone === 'A CONNECTOR' || currentZone === 'B CONNECTOR';
    this.audio.setIndoorZone(isIndoor);

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

    this.weaponController.update(frameDelta, hozSpeed, this.inputManager.input.crouch);
    this.effects.update(frameDelta);
    this.sceneManager.update(frameDelta, this.worldCamera.position);

    this.droppedWeapons.update(frameDelta, this.colliders, this.worldCamera.position, (dropped) => {
      const def = WEAPONS[dropped.weaponId];
      if (def && !this.inventory.slots[def.slot]) {
        return this.playerManager.equipDroppedWeapon(dropped);
      }
      return false;
    });

    this.cameraPunchPitch += (0 - this.cameraPunchPitch) * (1 - Math.exp(-18 * frameDelta));

    const isPlayerCarrier = this.inventory.slots[5] !== null;
    this.roundManager.update(frameDelta, this.worldCamera.position, this.isInteracting.value, isPlayerCarrier, this.economy.hasDefuseKit, this.bots);

    this.utilityManager.update(frameDelta, this.colliders, this.blocks, this.worldCamera.position, this.worldCamera, this.bots);
    const smokeOccluders = this.utilityManager.getActiveSmokeOccluders();

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

    this.radar.update(this.worldCamera.position, this.inputManager.input.yaw, this.blocks, this.bots, smokeOccluders, this.roundManager.bombPosition, this.roundManager.isBombPlanted);

    if (this.spectator.isSpectating) {
      this.spectator.update(frameDelta, this.worldCamera, this.bots);
    } else {
      const alpha = Math.min(1, Math.max(0, this.accumulator / this.FIXED_DT));
      const interp = this.player.getInterpolatedPosition(alpha);
      this.worldCamera.position.set(interp.x, interp.eyeY, interp.z);

      const effectivePitch = this.inputManager.input.pitch + this.cameraPunchPitch + this.weaponController.aimPunchPitch;
      const effectiveYaw = this.inputManager.input.yaw + this.weaponController.aimPunchYaw;
      _euler.set(effectivePitch, effectiveYaw, 0, 'YXZ');
      this.worldCamera.quaternion.setFromEuler(_euler);
    }
    this.worldCamera.updateMatrixWorld(true);

    const shouldFire = (this.pendingFireTrigger.value || (this.isFiring.value && activeWp.fireMode === 'auto')) &&
      this.inputManager.isLocked && !this.spectator.isSpectating;
    if (shouldFire) {
      this.pendingFireTrigger.value = false;
      if (this.customizer.infiniteAmmo) {
        activeSlotState.currentAmmo = activeWp.magCapacity;
      }
      this.weaponController.handlePrimaryFire(
        this.worldCamera,
        hozSpeed,
        this.player.state.isGrounded,
        this.inputManager.input.crouch,
        this.inputManager.input.yaw,
        this.inputManager.input.pitch,
        this.blocks,
        this.bots
      );
    }

    const walkBob = Math.sin(this.distanceTraveled * 4) * 0.008 * (hozSpeed / 5.45);
    let strafeRoll = 0;
    if (this.inputManager.input.left) strafeRoll = 0.025;
    if (this.inputManager.input.right) strafeRoll = -0.025;

    this.viewmodel.update(frameDelta, this.inputManager.mouseDeltaX, this.inputManager.mouseDeltaY, walkBob, strafeRoll);
    this.inputManager.mouseDeltaX = 0;
    this.inputManager.mouseDeltaY = 0;

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
    this.networkClient.updateBandwidthTelemetry();
    this.perfMonitor.recordFrame(
      frameDelta * 1000,
      this.networkClient.isConnected ? this.networkClient.ping : -1,
      this.networkClient.rxKbps,
      this.networkClient.txKbps
    );

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
