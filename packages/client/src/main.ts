import * as THREE from 'three';
import {
  KinematicPlayerController,
  SPAWN_POINTS,
  SpatialGrid,
  getCalloutName,
} from '@garam/shared';
import { SceneManager } from './render/SceneManager.js';
import { WeaponViewmodel } from './viewmodel/WeaponViewmodel.js';
import { ProceduralAudio } from './audio/ProceduralAudio.js';
import { buildCsOfficeMap } from './maps/CsOfficeMap.js';
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
import { settingsStore, GraphicsQuality, QualityTier } from './core/SettingsStore.js';
import { NetworkClient } from './net/NetworkClient.js';
import { PerfMonitor } from './core/PerfMonitor.js';
import {
  GameContext,
  buildUtilityCallbacks,
  buildBotAICallbacks,
  buildWeaponControllerCallbacks,
  buildRoundCallbacks,
  buildInputManagerCallbacks,
  buildBuyMenuCallbacks,
  buildLobbyCallbacks,
  buildNetworkCallbacks,
  stepMatchFrame,
} from './core/GameEventWire.js';

const _playerFeet = new THREE.Vector3();

export class GaramGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sceneManager: SceneManager;
  private readonly perfMonitor: PerfMonitor;
  private readonly ctx: GameContext;

  private lastTime = performance.now();
  private accumulator = 0;
  private readonly FIXED_DT = 1 / 128;
  private distanceTraveled = 0;
  private lastStepDist = 0;
  private readonly boundLoop: (now: number) => void;
  private readonly boundResize: () => void;

  constructor() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.autoClear = false;

    this.sceneManager = new SceneManager(this.renderer);
    this.renderer.setPixelRatio(this.sceneManager.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.sceneManager.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const viewmodel = new WeaponViewmodel();
    viewmodel.mesh.visible = false;
    this.sceneManager.viewmodelScene.add(viewmodel.mesh);

    const audio = new ProceduralAudio();
    audio.setMasterVolume(settingsStore.settings.masterVolume);
    const hud = new HUDManager();
    const effects = new EffectsManager(this.sceneManager.worldScene, this.sceneManager.worldCamera);
    const droppedWeapons = new DroppedWeaponManager(this.sceneManager.worldScene);
    const radar = new RadarRenderer();
    this.perfMonitor = new PerfMonitor(this.renderer, this.sceneManager.isSoftwareGl);
    const applyQuality = (q: GraphicsQuality) => {
      const tier: QualityTier = q === 'AUTO' ? (this.sceneManager.isSoftwareGl ? 'LOW' : 'HIGH') : q;
      this.sceneManager.applyQualityTier(tier);
      this.perfMonitor.setQualityState(q, this.sceneManager.activeQualityTier, this.sceneManager.currentDpr);
    };
    this.perfMonitor.onAdaptiveTierChanged = (tier) => {
      this.sceneManager.applyQualityTier(tier);
      this.perfMonitor.setQualityState(settingsStore.settings.graphicsQuality, tier, this.sceneManager.currentDpr);
    };
    applyQuality(settingsStore.settings.graphicsQuality);
    const combatReport = new CombatReportManager();
    const spectator = new SpectatorManager();
    const inventory = new InventoryManager();
    const economy = new EconomyManager();

    const baseSpawn = settingsStore.settings.faction === 'Syndicate' ? SPAWN_POINTS.OBSIDIAN_T : SPAWN_POINTS.VANGUARD_CT;
    const spawnPos = { x: baseSpawn.x, y: baseSpawn.y, z: baseSpawn.z };
    const player = new KinematicPlayerController(spawnPos.x, spawnPos.y, spawnPos.z);

    const mapData = buildCsOfficeMap(this.sceneManager.worldScene);
    const spatialGrid = new SpatialGrid(mapData.blocks, 6);
    radar.bakeFromScene(this.renderer, this.sceneManager.worldScene);

    let ctxRef!: GameContext;
    const utilityManager = new UtilityManager(
      this.sceneManager.worldScene,
      audio,
      buildUtilityCallbacks(new Proxy({} as GameContext, { get: (_, prop) => Reflect.get(ctxRef, prop) }))
    );

    const playerManager = new PlayerManager(
      player,
      inventory,
      economy,
      droppedWeapons,
      utilityManager,
      audio,
      hud,
      combatReport,
      spectator,
      {
        onSyncActiveWeapon: () => this.syncActiveWeapon(),
        onUtilityThrow: (type, mode, origin, dir, vel) =>
          ctxRef.networkClient?.sendUtilityThrow(type, mode, origin, dir, vel),
      }
    );

    ctxRef = {
      canvas,
      worldCamera: this.sceneManager.worldCamera,
      viewmodelCamera: this.sceneManager.viewmodelCamera,
      worldScene: this.sceneManager.worldScene,
      audio,
      hud,
      effects,
      droppedWeapons,
      utilityManager,
      radar,
      inventory,
      economy,
      player,
      playerManager,
      combatReport,
      spectator,
      viewmodel,
      spatialGrid,
      bots: mapData.bots,
      blocks: mapData.blocks,
      colliders: mapData.colliders,
      spawnPos,
      hasMatchStarted: { value: false },
      isFiring: { value: false },
      pendingFireTrigger: { value: false },
      isInteracting: { value: false },
      cameraPunchPitch: { value: 0 },
      syncActiveWeapon: () => this.syncActiveWeapon(),
      applyGraphicsQuality: applyQuality,
    };
    this.ctx = ctxRef;

    ctxRef.botAI = new BotAISystem(buildBotAICallbacks(ctxRef), settingsStore.settings.botDifficulty);
    ctxRef.weaponController = new WeaponController(
      inventory,
      viewmodel,
      effects,
      audio,
      buildWeaponControllerCallbacks(ctxRef)
    );
    ctxRef.roundManager = new RoundManager(this.sceneManager.worldScene, audio, buildRoundCallbacks(ctxRef));

    const blocker = document.getElementById('blocker') as HTMLElement;
    ctxRef.inputManager = new InputManager(canvas, blocker, buildInputManagerCallbacks(ctxRef));
    ctxRef.buyMenuUI = new BuyMenuUI(economy, inventory, audio, hud, buildBuyMenuCallbacks(ctxRef));

    const lobbyCallbacks = buildLobbyCallbacks(ctxRef);
    new LobbyUI(lobbyCallbacks);

    const networkClient = new NetworkClient(
      this.sceneManager.worldScene,
      hud,
      mapData.colliders,
      buildNetworkCallbacks(ctxRef),
      spatialGrid
    );
    networkClient.bindLocalPlayer(player);
    ctxRef.networkClient = networkClient;

    ctxRef.inputManager.setSensitivity(settingsStore.settings.mouseSensitivity);
    const initialYaw = settingsStore.settings.faction === 'Syndicate' ? 0 : Math.PI;
    ctxRef.inputManager.input.yaw = initialYaw;
    const cam = this.sceneManager.worldCamera;
    cam.position.set(spawnPos.x, spawnPos.y + 1.68, spawnPos.z);
    cam.rotation.set(0, initialYaw, 0, 'YXZ');
    cam.fov = settingsStore.settings.fov;
    cam.updateProjectionMatrix();
    this.syncActiveWeapon();

    this.boundResize = this.onResize.bind(this);
    this.boundLoop = this.loop.bind(this);
    window.addEventListener('resize', this.boundResize);
    if (new URLSearchParams(window.location.search).get('autostart') === '1') lobbyCallbacks.onDeploy();
    requestAnimationFrame(this.boundLoop);
  }

  private syncActiveWeapon(): void {
    this.ctx.audio.cancelReloadAudio();
    this.ctx.viewmodel.isReloading = false;
    const active = this.ctx.inventory.getActiveWeapon();
    if (this.ctx.weaponController && this.ctx.weaponController.zoomStage > 0 && active.id !== 'sovereign-awp') {
      this.ctx.weaponController.zoomStage = 0;
      this.sceneManager.worldCamera.fov = settingsStore.settings.fov;
      this.sceneManager.worldCamera.updateProjectionMatrix();
      this.ctx.hud.setScopeOverlay(false);
      this.ctx.inputManager?.setSensitivity(settingsStore.settings.mouseSensitivity);
    }
    if (active.id === 'garam-karambit') this.ctx.audio.playKnifeDraw();
    this.ctx.viewmodel.setWeapon(active.id);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.sceneManager.worldCamera.aspect = w / h;
    this.sceneManager.worldCamera.updateProjectionMatrix();
    this.sceneManager.viewmodelCamera.aspect = w / h;
    this.sceneManager.viewmodelCamera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.sceneManager.onResize(w, h);
  }

  private loop(now: number): void {
    const frameDelta = Math.max(0.0001, Math.min((now - this.lastTime) / 1000, 0.05));
    this.lastTime = now;
    const worldCamera = this.sceneManager.worldCamera;
    const { ctx } = this;

    if (!ctx.hasMatchStarted.value) {
      ctx.viewmodel.mesh.visible = false;
      const t = now * 0.00018;
      worldCamera.position.set(Math.sin(t) * 20, 8.2, -26 + Math.cos(t) * 6);
      worldCamera.lookAt(0, 2.8, -11);
      ctx.effects.update(frameDelta);
      this.sceneManager.update(frameDelta, worldCamera.position);
      this.renderer.clear();
      this.renderer.render(this.sceneManager.worldScene, worldCamera);
      this.sceneManager.scheduleNextFrame(this.boundLoop);
      return;
    }

    const { inputManager: inputMgr, networkClient: net, roundManager: rm } = ctx;
    if (!inputMgr || !net || !rm) { this.sceneManager.scheduleNextFrame(this.boundLoop); return; }

    this.accumulator += frameDelta;
    const activeWp = ctx.inventory.getActiveWeapon();
    const isFreezeTime = rm.phase === 'FREEZE_TIME';

    // 128Hz Fixed Kinematics Accumulator
    while (this.accumulator >= this.FIXED_DT) {
      if (!ctx.spectator.isSpectating) {
        inputMgr.update(this.FIXED_DT, ctx.player.state.isGrounded);
        if (!isFreezeTime) {
          ctx.player.update(inputMgr.input, this.FIXED_DT, activeWp.movementSpeed, ctx.colliders, undefined, ctx.spatialGrid);
        }
        if (net.isConnected) {
          net.sendInput(inputMgr.input, this.FIXED_DT, activeWp.movementSpeed, ctx.player, activeWp.id);
        }
      }
      this.accumulator -= this.FIXED_DT;
    }

    if (net.isConnected) net.update(frameDelta);

    const alpha = Math.min(1, Math.max(0, this.accumulator / this.FIXED_DT));
    const interp = ctx.player.getInterpolatedPosition(alpha);
    _playerFeet.set(interp.x, interp.y, interp.z);

    const hozSpeed = ctx.player.getHorizontalSpeed();
    if (!ctx.spectator.isSpectating && ctx.player.state.isGrounded && hozSpeed > 0.8 && !inputMgr.input.walk) {
      this.distanceTraveled += hozSpeed * frameDelta;
      if (this.distanceTraveled - this.lastStepDist > 2.2) {
        ctx.audio.playFootstep('CONCRETE');
        ctx.botAI?.onSoundEvent({
          type: 'footstep',
          pos: _playerFeet,
          radius: 22,
          team: settingsStore.settings.faction,
          timestamp: Date.now(),
        });
        this.lastStepDist = this.distanceTraveled;
      }
    }

    const currentZone = getCalloutName(ctx.player.state.x, ctx.player.state.y, ctx.player.state.z);
    this.sceneManager.update(frameDelta, worldCamera.position, currentZone);
    stepMatchFrame(ctx, {
      frameDelta,
      hozSpeed,
      distanceTraveled: this.distanceTraveled,
      isFreezeTime,
      playerFeet: _playerFeet,
      interpX: interp.x,
      interpEyeY: interp.eyeY,
      interpZ: interp.z,
      currentZone,
    });

    net.updateBandwidthTelemetry();
    this.perfMonitor.recordFrame(frameDelta * 1000, net.isConnected ? net.ping : -1, net.rxKbps, net.txKbps);

    const showVm = !ctx.spectator.isSpectating && ctx.hasMatchStarted.value && document.body.dataset.state === 'playing';
    ctx.viewmodel.mesh.visible = showVm;
    this.sceneManager.render(showVm);
    this.sceneManager.scheduleNextFrame(this.boundLoop);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new GaramGame();
});