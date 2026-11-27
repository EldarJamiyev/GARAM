import * as THREE from 'three';
import {
  KinematicPlayerController, SpatialGrid, getMapDescriptor,
} from '@garam/shared';
import { SceneManager, probeSoftwareWebGL } from './render/SceneManager.js';
import { WeaponViewmodel } from './viewmodel/WeaponViewmodel.js';
import { ProceduralAudio } from './audio/ProceduralAudio.js';
import { buildDeDust2Map } from './maps/DeDust2Map.js';
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
import { BotAISystem, DE_DUST2_BOT_MAP_CONFIG, CS_OFFICE_BOT_MAP_CONFIG } from './match/BotAISystem.js';
import { settingsStore, GraphicsQuality, QualityTier, FpsLimit } from './core/SettingsStore.js';
import { NetworkClient } from './net/NetworkClient.js';
import { PerfMonitor } from './core/PerfMonitor.js';
import {
  GameContext, buildUtilityCallbacks, buildBotAICallbacks, buildWeaponControllerCallbacks,
  buildRoundCallbacks, buildInputManagerCallbacks, buildBuyMenuCallbacks, buildLobbyCallbacks,
  buildNetworkCallbacks, stepMatchFrame,
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
    const isSoftwareGlHint = probeSoftwareWebGL();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isSoftwareGlHint,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.autoClear = false;

    const mapDesc = getMapDescriptor(settingsStore.settings.mapId);
    this.sceneManager = new SceneManager(this.renderer);
    if (mapDesc.id === 'cs_office') this.sceneManager.configureOfficeAtmosphere();
    else this.sceneManager.configureDust2Atmosphere();
    this.renderer.setPixelRatio(this.sceneManager.isSoftwareGl ? 0.75 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.sceneManager.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const viewmodel = new WeaponViewmodel();
    viewmodel.setFaction(settingsStore.settings.faction);
    viewmodel.setViewportAspect(window.innerWidth / Math.max(1, window.innerHeight));
    viewmodel.mesh.visible = false;
    this.sceneManager.viewmodelScene.add(viewmodel.mesh);

    const audio = new ProceduralAudio();
    audio.setMasterVolume(settingsStore.settings.masterVolume);
    const hud = new HUDManager();
    hud.setFactionTheme(settingsStore.settings.faction);
    const effects = new EffectsManager(this.sceneManager.worldScene, this.sceneManager.worldCamera);
    const droppedWeapons = new DroppedWeaponManager(this.sceneManager.worldScene);
    const radar = new RadarRenderer();
    radar.configureMap(mapDesc.bounds, mapDesc.bombsites, mapDesc.isGlbArena);
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

    const applyFpsLimit = (limit: FpsLimit) => {
      this.sceneManager.setFpsLimit(limit);
      this.perfMonitor.setFpsLimitState(limit);
    };
    applyFpsLimit(settingsStore.settings.fpsLimit);

    const combatReport = new CombatReportManager();
    const spectator = new SpectatorManager();
    const inventory = new InventoryManager();
    const economy = new EconomyManager(mapDesc.spawnZones);

    const isSyndicate = settingsStore.settings.faction === 'Syndicate';
    const baseSpawn = isSyndicate ? mapDesc.spawnPoints.OBSIDIAN_T : mapDesc.spawnPoints.VANGUARD_CT;
    const spawnPos = { x: baseSpawn.x, y: baseSpawn.y, z: baseSpawn.z };
    const player = new KinematicPlayerController(spawnPos.x, spawnPos.y, spawnPos.z);

    const mapData = mapDesc.id === 'cs_office'
      ? buildCsOfficeMap(this.sceneManager.worldScene)
      : buildDeDust2Map(this.sceneManager.worldScene, () => {
          radar.bakeFromScene(this.renderer, this.sceneManager.worldScene);
          this.sceneManager.invalidateShadows();
        });
    if (mapDesc.id === 'cs_office') radar.bakeFromScene(this.renderer, this.sceneManager.worldScene);
    const spatialGrid = new SpatialGrid(mapData.blocks, 6);

    let ctxRef!: GameContext;
    const utilityManager = new UtilityManager(
      this.sceneManager.worldScene,
      audio,
      buildUtilityCallbacks(new Proxy({} as GameContext, { get: (_, prop) => Reflect.get(ctxRef, prop) }))
    );
    utilityManager.setMapBounds(mapDesc.bounds);

    const playerManager = new PlayerManager(
      player, inventory, economy, droppedWeapons, utilityManager, audio, hud, combatReport, spectator,
      {
        onSyncActiveWeapon: () => this.syncActiveWeapon(),
        onUtilityThrow: (type, mode, origin, dir, vel) =>
          ctxRef.networkClient?.sendUtilityThrow(type, mode, origin, dir, vel),
      }
    );

    ctxRef = {
      canvas,
      renderer: this.renderer,
      sceneManager: this.sceneManager,
      worldCamera: this.sceneManager.worldCamera,
      viewmodelCamera: this.sceneManager.viewmodelCamera,
      worldScene: this.sceneManager.worldScene,
      audio, hud, effects, droppedWeapons, utilityManager, radar, inventory, economy,
      player, playerManager, combatReport, spectator, viewmodel, spatialGrid,
      bots: mapData.bots, blocks: mapData.blocks, colliders: mapData.colliders, spawnPos,
      hasMatchStarted: { value: false }, isFiring: { value: false },
      pendingFireTrigger: { value: false }, isInteracting: { value: false },
      cameraPunchPitch: { value: 0 },
      syncActiveWeapon: () => this.syncActiveWeapon(),
      applyGraphicsQuality: applyQuality,
      applyFpsLimit,
    };
    this.ctx = ctxRef;

    const botMapCfg = mapDesc.id === 'cs_office' ? CS_OFFICE_BOT_MAP_CONFIG : DE_DUST2_BOT_MAP_CONFIG;
    ctxRef.botAI = new BotAISystem(buildBotAICallbacks(ctxRef), settingsStore.settings.botDifficulty, botMapCfg);
    ctxRef.weaponController = new WeaponController(inventory, viewmodel, effects, audio, buildWeaponControllerCallbacks(ctxRef));
    ctxRef.roundManager = new RoundManager(this.sceneManager.worldScene, audio, buildRoundCallbacks(ctxRef), mapDesc.bombsites);

    const blocker = document.getElementById('blocker') as HTMLElement;
    ctxRef.inputManager = new InputManager(canvas, blocker, buildInputManagerCallbacks(ctxRef));
    ctxRef.buyMenuUI = new BuyMenuUI(economy, inventory, audio, hud, buildBuyMenuCallbacks(ctxRef));

    const lobbyCallbacks = buildLobbyCallbacks(ctxRef);
    new LobbyUI(lobbyCallbacks);

    const networkClient = new NetworkClient(this.sceneManager.worldScene, hud, mapData.colliders, buildNetworkCallbacks(ctxRef), spatialGrid);
    networkClient.bindLocalPlayer(player);
    ctxRef.networkClient = networkClient;

    ctxRef.inputManager.setSensitivity(settingsStore.settings.mouseSensitivity);
    const initialYaw = mapDesc.initialYaw[settingsStore.settings.faction];
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
    this.ctx.viewmodel.setViewportAspect(w / Math.max(1, h));
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
      const t = now * 0.00016;
      worldCamera.position.set(-8 + Math.sin(t) * 18, 12.2, 4 + Math.cos(t) * 16);
      worldCamera.lookAt(-2, 4.2, -2);
      ctx.effects.update(frameDelta);
      this.sceneManager.update(frameDelta, worldCamera.position);
      this.sceneManager.updateShadows(frameDelta, true);
      this.renderer.clear();
      this.renderer.render(this.sceneManager.worldScene, worldCamera);
      this.sceneManager.scheduleNextFrame(this.boundLoop, true);
      return;
    }

    const { inputManager: inputMgr, networkClient: net, roundManager: rm } = ctx;
    if (!inputMgr || !net || !rm) { this.sceneManager.scheduleNextFrame(this.boundLoop, true); return; }

    this.accumulator += frameDelta;
    const activeWp = ctx.inventory.getActiveWeapon();
    const isFreezeTime = rm.phase === 'FREEZE_TIME';
    const activeDesc = getMapDescriptor(settingsStore.settings.mapId);

    // 128Hz Fixed Kinematics Accumulator
    while (this.accumulator >= this.FIXED_DT) {
      if (!ctx.spectator.isSpectating) {
        inputMgr.update(this.FIXED_DT, ctx.player.state.isGrounded);
        if (isFreezeTime) {
          inputMgr.input.forward = inputMgr.input.backward = inputMgr.input.left = inputMgr.input.right = inputMgr.input.jump = false;
          ctx.player.state.vx = ctx.player.state.vy = ctx.player.state.vz = 0;
          ctx.player.prevState.x = ctx.player.state.x;
          ctx.player.prevState.y = ctx.player.state.y;
          ctx.player.prevState.z = ctx.player.state.z;
          ctx.player.prevState.currentEyeHeight = ctx.player.state.currentEyeHeight;
        } else {
          const wasGrounded = ctx.player.state.isGrounded;
          const prevVy = ctx.player.state.vy;
          ctx.player.update(inputMgr.input, this.FIXED_DT, activeWp.movementSpeed, ctx.colliders, activeDesc.bounds, ctx.spatialGrid);
          if (!wasGrounded && ctx.player.state.isGrounded && prevVy < -2.2) ctx.viewmodel.notifyLanding(prevVy);
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
          type: 'footstep', pos: _playerFeet, radius: 22,
          team: settingsStore.settings.faction, timestamp: Date.now(),
        });
        this.lastStepDist = this.distanceTraveled;
      }
    }

    const currentZone = activeDesc.getCalloutName(ctx.player.state.x, ctx.player.state.y, ctx.player.state.z);
    this.sceneManager.update(frameDelta, worldCamera.position, currentZone);
    stepMatchFrame(ctx, {
      frameDelta, hozSpeed, distanceTraveled: this.distanceTraveled, isFreezeTime,
      playerFeet: _playerFeet, interpX: interp.x, interpEyeY: interp.eyeY, interpZ: interp.z, currentZone,
    });

    net.updateBandwidthTelemetry();
    this.perfMonitor.recordFrame(frameDelta * 1000, net.isConnected ? net.ping : -1, net.rxKbps, net.txKbps);

    const showVm = !ctx.spectator.isSpectating && ctx.hasMatchStarted.value && document.body.dataset.state === 'playing';
    ctx.viewmodel.mesh.visible = showVm;
    this.sceneManager.updateShadows(frameDelta, isFreezeTime);
    this.sceneManager.render(showVm);
    this.sceneManager.scheduleNextFrame(this.boundLoop, document.body.dataset.state !== 'playing');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new GaramGame();
});