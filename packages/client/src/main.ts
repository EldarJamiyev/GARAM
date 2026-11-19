import * as THREE from 'three';
import {
  KinematicPlayerController,
  KINEMATICS,
  ECONOMY,
  WEAPONS,
  WeaponDef,
  MapBlockCollider,
  AABBCollider,
  SPAWN_ZONES
} from '@garam/shared';
import { WeaponViewmodel } from './viewmodel/WeaponViewmodel.js';
import { ProceduralAudio } from './audio/ProceduralAudio.js';
import { buildTacticalCitadelMap, updateBotSystem, BotEntity } from './maps/DeCitadelMap.js';
import { InventoryManager, SlotNumber } from './combat/InventoryManager.js';
import { WeaponController } from './combat/WeaponController.js';
import { EffectsManager } from './combat/EffectsManager.js';
import { InputManager } from './core/InputManager.js';
import { RoundManager } from './match/RoundManager.js';
import { EconomyManager } from './match/EconomyManager.js';
import { HUDManager } from './ui/HUDManager.js';

export class GaramGame {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;

  // Dual-pass scenes & cameras
  private worldScene: THREE.Scene;
  private worldCamera: THREE.PerspectiveCamera;
  private viewmodelScene: THREE.Scene;
  private viewmodelCamera: THREE.PerspectiveCamera;
  private viewmodel: WeaponViewmodel;

  // Audio & Effects
  private audio: ProceduralAudio;
  private effects: EffectsManager;

  // Game Systems
  private player: KinematicPlayerController;
  private inventory: InventoryManager;
  private economy: EconomyManager;
  private hud: HUDManager;
  private weaponController: WeaponController;
  private roundManager: RoundManager;
  private inputManager: InputManager;

  // Map Data
  private bots: BotEntity[] = [];
  private blocks: MapBlockCollider[] = [];
  private colliders: AABBCollider[] = [];
  private bombsites: { A: THREE.Vector3; B: THREE.Vector3 };

  // Runtime State
  private isFiring = false;
  private isInteracting = false;
  private cameraPunchPitch = 0;
  private playerHealth = 100;
  private kills = 0;
  private deaths = 0;

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
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;

    // 1. World Scene
    this.worldScene = new THREE.Scene();
    this.worldCamera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.05, 500);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.worldScene.add(ambientLight);

    const sun = new THREE.DirectionalLight(0xfff3e0, 1.25);
    sun.position.set(45, 70, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 150;
    const d = 55;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    this.worldScene.add(sun);

    // 2. Viewmodel Scene (Dual-pass to completely eliminate wall clipping)
    this.viewmodelScene = new THREE.Scene();
    this.viewmodelCamera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.01, 10);
    this.viewmodel = new WeaponViewmodel();
    this.viewmodelScene.add(this.viewmodel.mesh);

    const vmAmb = new THREE.AmbientLight(0xffffff, 0.85);
    this.viewmodelScene.add(vmAmb);
    const vmDir = new THREE.DirectionalLight(0xffffff, 0.9);
    vmDir.position.set(2, 4, 2);
    this.viewmodelScene.add(vmDir);

    // 3. Audio & Combat
    this.audio = new ProceduralAudio();
    this.effects = new EffectsManager(this.worldScene);
    this.inventory = new InventoryManager();
    this.economy = new EconomyManager();
    this.hud = new HUDManager();

    // Spawn player at Vanguard Defender Spawn
    const spawnPos = SPAWN_ZONES.VANGUARD_SPAWN;
    this.player = new KinematicPlayerController(spawnPos.x, spawnPos.y, spawnPos.z);

    // 4. Build Map
    const mapData = buildTacticalCitadelMap(this.worldScene);
    this.bots = mapData.bots;
    this.blocks = mapData.blocks;
    this.colliders = mapData.colliders;
    this.bombsites = mapData.bombsites;

    // 5. Weapon Controller
    this.weaponController = new WeaponController(
      this.inventory,
      this.viewmodel,
      this.effects,
      this.audio,
      {
        onKill: (killerName, victimBot, headshot, weaponName, reward) => {
          this.kills++;
          this.economy.addCash(reward);
          victimBot.isDead = true;
          this.worldScene.remove(victimBot.mesh);
          this.hud.addKillfeed(`${headshot ? '🎯 [HEADSHOT] ' : '💀 '}${killerName} [${weaponName}] ${victimBot.name} (+$${reward})`);
          this.hud.updateScoreboard(this.kills, this.deaths, this.economy.cash, this.bots);
        },
        onCameraPunch: (kick) => {
          this.cameraPunchPitch += kick;
        },
        onScopeChanged: (zoomStage, fov, sens) => {
          this.worldCamera.fov = fov;
          this.worldCamera.updateProjectionMatrix();
          this.hud.setScopeOverlay(zoomStage > 0);
          this.inputManager.setSensitivity(sens);
        },
        onUtilityThrown: () => {
          this.hud.addKillfeed('💨 Tactical Smoke Deployed');
        }
      }
    );

    // 6. Round Manager (MR12 Competitive Format)
    this.roundManager = new RoundManager(this.worldScene, this.audio, {
      onPhaseChanged: (phase, round) => {
        if (phase === 'FREEZE_TIME') {
          this.hud.showCenterBanner(`ROUND ${round}`, 'FREEZE TIME — REQUISITION WEAPONS [B]', 3000);
        } else if (phase === 'ROUND_LIVE') {
          this.hud.showCenterBanner('LIVE', 'DEFEND SITES A & B', 1800);
        }
      },
      onTimerTick: (timeRemaining, isBombArmed) => {
        this.hud.updateRoundTimer(timeRemaining, isBombArmed);
      },
      onPlantProgress: (p) => {
        this.hud.updateInteractionBar(p, 'PLANTING PULSE CORE...');
      },
      onDefuseProgress: (p) => {
        this.hud.updateInteractionBar(p, 'DEFUSING PULSE CORE...');
      },
      onRoundWon: (winner, reason, ctScore, tScore) => {
        this.hud.updateScores(ctScore, tScore);
        const isVanguard = winner === 'Vanguard';
        this.hud.showCenterBanner(`${winner.toUpperCase()} WINS THE ROUND`, reason, 4500);

        const payout = this.economy.awardRoundEndPayout(
          isVanguard,
          isVanguard ? this.roundManager.ctLossStreak : this.roundManager.tLossStreak,
          reason.includes('Defused') || reason.includes('Detonated')
        );
        this.hud.addKillfeed(`Round End Payout: +$${payout}`);
      },
      onResetRound: () => {
        this.player.state.x = spawnPos.x;
        this.player.state.y = spawnPos.y;
        this.player.state.z = spawnPos.z;
        this.player.state.vx = 0;
        this.player.state.vy = 0;
        this.player.state.vz = 0;
        this.playerHealth = 100;
        this.economy.armor = 100;

        // Reset bots
        for (const bot of this.bots) {
          bot.isDead = false;
          bot.health = bot.maxHealth;
          bot.armor = 100;
          if (!this.worldScene.children.includes(bot.mesh)) {
            this.worldScene.add(bot.mesh);
          }
          if (bot.patrolWaypoints.length > 0) {
            bot.waypointIndex = 0;
            bot.patrolTarget = bot.patrolWaypoints[0];
            bot.mesh.position.set(bot.patrolTarget.x, 0, bot.patrolTarget.z);
          }
        }

        // Restock ammo in current weapons
        for (let s = 1; s <= 3; s++) {
          const state = this.inventory.slots[s as SlotNumber];
          if (state && WEAPONS[state.weaponId]) {
            const def = WEAPONS[state.weaponId];
            state.currentAmmo = def.magazineSize;
            state.reserveAmmo = def.reserveAmmo;
          }
        }
        this.syncActiveWeapon();
      },
      onMatchComplete: (winner, ctScore, tScore) => {
        this.hud.updateScores(ctScore, tScore);
        this.hud.showCenterBanner(`MATCH VICTORY — ${winner.toUpperCase()}`, `Final Score: Vanguard ${ctScore} : ${tScore} Syndicate`, 8000);
      }
    });

    // 7. Input Manager
    const blocker = document.getElementById('blocker')!;
    this.inputManager = new InputManager(this.canvas, blocker, {
      onFireDown: () => {
        this.isFiring = true;
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
        this.weaponController.handleSecondaryFire(this.worldCamera, this.bots, this.blocks);
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
        if (this.inventory.equipSlot(slot)) this.syncActiveWeapon();
      },
      onCycleWeapon: (dir) => {
        if (dir > 0) this.inventory.cycleNext();
        else this.inventory.cyclePrev();
        this.syncActiveWeapon();
      },
      onToggleBuyMenu: () => this.toggleBuyMenu(),
      onBuyItem: (key) => this.handleBuyByKey(key),
      onPracticeToggle: () => this.handlePracticeToggle(),
      onInteractDown: () => { this.isInteracting = true; },
      onInteractUp: () => { this.isInteracting = false; }
    });

    // Setup Buy Menu listeners
    this.setupBuyMenuUI();

    // Start competitive match
    this.roundManager.startMatch();
    this.syncActiveWeapon();

    window.addEventListener('resize', this.onResize.bind(this));
    requestAnimationFrame(this.loop.bind(this));
  }

  private syncActiveWeapon(): void {
    const active = this.inventory.getActiveWeapon();
    if (this.weaponController.zoomStage > 0 && active.id !== 'sovereign-awp') {
      this.weaponController.zoomStage = 0;
      this.worldCamera.fov = 90;
      this.worldCamera.updateProjectionMatrix();
      this.hud.setScopeOverlay(false);
      this.inputManager.setSensitivity(0.0022);
    }
    this.viewmodel.setWeapon(active.id);
  }

  private toggleBuyMenu(forceState?: boolean): void {
    const buyMenu = document.getElementById('buy-menu');
    if (!buyMenu) return;

    const isOpening = forceState !== undefined ? forceState : buyMenu.style.display !== 'block';
    if (isOpening) {
      const check = this.economy.canBuy(this.roundManager.phase, this.roundManager.phaseTimer, this.worldCamera.position);
      const statusEl = document.getElementById('buy-zone-status');
      if (statusEl) {
        statusEl.innerText = check.canBuy ? 'BUY ZONE ACTIVE' : (check.reason || 'CANNOT BUY');
        statusEl.style.color = check.canBuy ? '#00ff88' : '#ff4444';
      }
      buyMenu.style.display = 'block';
      this.inputManager.uiState = 'BUY_MENU';
      this.inputManager.exitPointerLock();
    } else {
      buyMenu.style.display = 'none';
      if (this.inputManager.uiState === 'BUY_MENU') {
        this.inputManager.requestPointerLock();
      }
    }
  }

  private setupBuyMenuUI(): void {
    const buyClose = document.getElementById('buy-close-btn');
    if (buyClose) buyClose.addEventListener('click', () => this.toggleBuyMenu(false));

    const practiceBtn = document.getElementById('practice-btn');
    if (practiceBtn) practiceBtn.addEventListener('click', () => this.handlePracticeToggle());

    const cards = document.querySelectorAll('.buy-card');
    cards.forEach((card) => {
      card.addEventListener('click', () => {
        const item = card.getAttribute('data-buy');
        if (item) this.executePurchase(item);
      });
    });
  }

  private handleBuyByKey(key: number): void {
    const keyMap: Record<number, string> = {
      1: 'garam-47',
      2: 'vanguard-m4',
      3: 'sovereign-awp',
      4: 'desert-eagle',
      5: 'kevlar',
      6: 'kevlar-helmet',
      7: 'defuse-kit',
      8: 'smoke-grenade',
    };
    if (keyMap[key]) {
      this.executePurchase(keyMap[key]);
    }
  }

  private handlePracticeToggle(): void {
    this.economy.devPracticeMoney();
    this.hud.addKillfeed('🛠️ Practice Mode: $16,000 + Armor + Defuse Kit Granted');
    this.audio.playReload();
    this.toggleBuyMenu(false);
  }

  private executePurchase(item: string): void {
    const check = this.economy.canBuy(this.roundManager.phase, this.roundManager.phaseTimer, this.worldCamera.position);
    if (!check.canBuy) {
      this.hud.addKillfeed(`❌ ${check.reason}`);
      return;
    }

    if (item === 'kevlar') {
      if (this.economy.spendCash(650)) {
        this.economy.armor = 100;
        this.hud.addKillfeed('Requisitioned Kevlar Vest ($650)');
        this.audio.playReload();
      }
      return;
    }

    if (item === 'kevlar-helmet') {
      if (this.economy.spendCash(1000)) {
        this.economy.armor = 100;
        this.economy.hasHelmet = true;
        this.hud.addKillfeed('Requisitioned Kevlar + Helmet ($1,000)');
        this.audio.playReload();
      }
      return;
    }

    if (item === 'defuse-kit') {
      if (this.economy.spendCash(400)) {
        this.economy.hasDefuseKit = true;
        this.hud.addKillfeed('Requisitioned Defuse Kit ($400)');
        this.audio.playReload();
      }
      return;
    }

    if (item === 'smoke-grenade') {
      if (this.economy.spendCash(300)) {
        this.inventory.slots[4] = { weaponId: 'smoke-grenade', currentAmmo: 1, reserveAmmo: 0 };
        this.hud.addKillfeed('Requisitioned Tactical Smoke Grenade ($300)');
        this.audio.playReload();
      }
      return;
    }

    // Weapons (Garam-47, M4A1-S, AWP, Desert Eagle)
    if (WEAPONS[item]) {
      const def = WEAPONS[item];
      if (this.economy.spendCash(def.price)) {
        const slot = (def.slot || (def.category === 'primary' ? 1 : 2)) as SlotNumber;
        this.inventory.slots[slot] = {
          weaponId: def.id,
          currentAmmo: def.magazineSize,
          reserveAmmo: def.reserveAmmo
        };
        this.inventory.equipSlot(slot);
        this.syncActiveWeapon();
        this.hud.addKillfeed(`Requisitioned ${def.name} ($${def.price})`);
        this.audio.playReload();
      }
    }
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
    this.accumulator += frameDelta;

    const activeWp = this.inventory.getActiveWeapon();
    const activeSlotState = this.inventory.getActiveSlotState();

    // 128Hz Fixed Physics Kinematics Accumulator
    while (this.accumulator >= this.FIXED_DT) {
      this.player.update(this.inputManager.input, this.FIXED_DT, activeWp.movementSpeed, this.colliders);
      this.accumulator -= this.FIXED_DT;
    }

    // Footstep audio
    const hozSpeed = this.player.getHorizontalSpeed();
    if (this.player.state.isGrounded && hozSpeed > 0.8 && !this.inputManager.input.walk) {
      this.distanceTraveled += hozSpeed * frameDelta;
      if (this.distanceTraveled - this.lastStepDist > 2.2) {
        this.audio.playFootstep();
        this.lastStepDist = this.distanceTraveled;
      }
    }

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
    if (this.isFiring && this.inputManager.isLocked && activeWp.fireMode === 'auto') {
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

    // Recoil spray reset after releasing trigger
    if (!this.isFiring && this.weaponController.consecutiveShots > 0) {
      if (now - this.weaponController.lastFireReleaseTime > 260) {
        this.weaponController.consecutiveShots = 0;
      }
    }

    // Camera recoil punch recovery
    this.cameraPunchPitch += (0 - this.cameraPunchPitch) * (1 - Math.exp(-18 * frameDelta));

    // Update Round Manager
    const isPlayerCarrier = this.inventory.slots[5] !== null;
    this.roundManager.update(
      frameDelta,
      this.worldCamera.position,
      this.isInteracting,
      isPlayerCarrier,
      this.economy.hasDefuseKit,
      this.bots
    );

    // Bot AI update with line-of-sight checks and wall collisions
    const playerEye = this.worldCamera.position.clone();
    updateBotSystem(
      this.bots,
      frameDelta,
      this.colliders,
      this.blocks,
      this.worldCamera.position,
      playerEye,
      (bot, dmg) => {
        // Player damaged by bot
        if (this.economy.armor > 0) {
          this.economy.armor = Math.max(0, this.economy.armor - Math.round(dmg * 0.5));
          this.playerHealth = Math.max(0, this.playerHealth - Math.round(dmg * 0.5));
        } else {
          this.playerHealth = Math.max(0, this.playerHealth - dmg);
        }

        if (this.playerHealth <= 0) {
          this.deaths++;
          this.hud.addKillfeed(`💀 ${bot.name} eliminated Eldar Garamov`);
          this.playerHealth = 100;
          this.economy.armor = 100;
          this.player.state.x = SPAWN_ZONES.VANGUARD_SPAWN.x;
          this.player.state.z = SPAWN_ZONES.VANGUARD_SPAWN.z;
        }
      },
      (shooter, victim, dmg) => {
        // Bot vs Bot combat
        if (victim.armor > 0) {
          victim.armor = Math.max(0, victim.armor - Math.round(dmg * 0.5));
          victim.health = Math.max(0, victim.health - Math.round(dmg * 0.5));
        } else {
          victim.health = Math.max(0, victim.health - dmg);
        }

        if (victim.health <= 0 && !victim.isDead) {
          victim.isDead = true;
          this.worldScene.remove(victim.mesh);
          shooter.kills++;
          victim.deaths++;
          this.hud.addKillfeed(`💀 ${shooter.name} eliminated ${victim.name}`);
        }
      }
    );

    // Camera transform with view-punch
    const eyeY = this.player.state.y + this.player.state.currentEyeHeight;
    this.worldCamera.position.set(this.player.state.x, eyeY, this.player.state.z);

    const effectivePitch = this.inputManager.input.pitch + this.cameraPunchPitch;
    const euler = new THREE.Euler(effectivePitch, this.inputManager.input.yaw, 0, 'YXZ');
    this.worldCamera.quaternion.setFromEuler(euler);

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
      this.playerHealth,
      this.economy.armor,
      this.economy.cash,
      hozSpeed,
      isPinpoint,
      activeWp.name,
      activeSlotState.currentAmmo,
      activeSlotState.reserveAmmo,
      this.inventory.activeSlot
    );

    this.hud.updateCrosshair(hozSpeed, this.weaponController.consecutiveShots, isPinpoint);

    // DUAL-PASS RENDERING (World then Viewmodel without depth clipping)
    this.renderer.clear();
    this.renderer.render(this.worldScene, this.worldCamera);

    if (this.weaponController.zoomStage === 0) {
      this.renderer.clearDepth();
      this.renderer.render(this.viewmodelScene, this.viewmodelCamera);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new GaramGame();
});
