import * as THREE from 'three';
import {
  KinematicPlayerController,
  PlayerInput,
  WEAPONS,
  WeaponDef,
  MapBlockCollider,
  executeTacticalRaycast,
  hasLineOfSight,
  TargetCollider,
  Ray,
  SmokeOccluder
} from '@garam/shared';
import { WeaponViewmodel } from './viewmodel/WeaponViewmodel.js';
import { ProceduralAudio } from './audio/ProceduralAudio.js';
import { buildTacticalCitadelMap, BotEntity } from './maps/DeCitadelMap.js';
import { InventoryManager, SlotNumber } from './combat/InventoryManager.js';

interface SmokeCloud {
  mesh: THREE.Mesh;
  startTime: number;
  duration: number;
  center: THREE.Vector3;
  radius: number;
}

class GaramGame {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;

  // Dual-pass scenes
  private worldScene: THREE.Scene;
  private worldCamera: THREE.PerspectiveCamera;

  private viewmodelScene: THREE.Scene;
  private viewmodelCamera: THREE.PerspectiveCamera;
  private viewmodel: WeaponViewmodel;

  // Audio DSP
  private audio: ProceduralAudio;

  // Kinematics & Input
  private player: KinematicPlayerController;
  private input: PlayerInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    crouch: false,
    walk: false,
    yaw: 0,
    pitch: 0,
  };

  private isLocked = false;
  private isBuyMenuOpen = false;
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;

  // Camera recoil punch (Screen kick)
  private cameraPunchPitch = 0;

  // Combat & Inventory
  private inventory: InventoryManager;
  private isFiring = false;
  private lastShotTime = 0;
  private consecutiveShots = 0;
  private lastFireReleaseTime = 0;
  private isScoped = false;

  // Player Stats & Economy
  private playerHealth = 100;
  private playerArmor = 100;
  private playerCash = 800;
  private kills = 0;
  private deaths = 0;

  // Match State Machine
  private roundTimeRemaining = 105;
  private ctScore = 0;
  private tScore = 0;

  // Map entities & Colliders
  private bots: BotEntity[] = [];
  private blocks: MapBlockCollider[] = [];
  private colliders: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }[] = [];
  private bombsites: { A: THREE.Vector3; B: THREE.Vector3 };
  private smokeClouds: SmokeCloud[] = [];

  // Accumulator loop (128Hz)
  private lastTime = performance.now();
  private accumulator = 0;
  private readonly FIXED_DT = 1 / 128;

  // Step cycle
  private distanceTraveled = 0;
  private lastStepDist = 0;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.audio = new ProceduralAudio();
    this.inventory = new InventoryManager();
    this.player = new KinematicPlayerController(0, 0, 38);

    // WebGL Renderer with ACESFilmicToneMapping & PCFSoftShadowMap
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;

    // 1. World Scene
    this.worldScene = new THREE.Scene();
    this.worldScene.background = new THREE.Color(0x82b2d6);
    this.worldScene.fog = new THREE.FogExp2(0x82b2d6, 0.005);

    this.worldCamera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 500);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x3d4752, 0.95);
    this.worldScene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff6ea, 2.1);
    sunLight.position.set(45, 80, -35);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 200;
    const d = 65;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    this.worldScene.add(sunLight);

    // 2. Viewmodel Scene (FOV 68°, near: 0.005m - Zero wall clipping)
    this.viewmodelScene = new THREE.Scene();
    this.viewmodelCamera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.005, 5);

    const vmLight = new THREE.DirectionalLight(0xffffff, 1.5);
    vmLight.position.set(1, 2, 1);
    this.viewmodelScene.add(vmLight);
    this.viewmodelScene.add(new THREE.AmbientLight(0x777e88, 0.95));

    this.viewmodel = new WeaponViewmodel();
    this.viewmodelScene.add(this.viewmodel.mesh);

    // Build tactical map
    const mapData = buildTacticalCitadelMap(this.worldScene);
    this.bots = mapData.bots;
    this.blocks = mapData.blocks;
    this.colliders = mapData.colliders;
    this.bombsites = mapData.bombsites;

    // Set initial weapon
    this.syncActiveWeaponView();

    this.setupInputs();
    this.setupEvents();
    this.setupBuyMenu();

    requestAnimationFrame(this.loop.bind(this));
  }

  private setupInputs(): void {
    const blocker = document.getElementById('blocker')!;
    blocker.addEventListener('click', () => {
      if (!this.isBuyMenuOpen) {
        this.canvas.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.canvas;
      if (this.isBuyMenuOpen) {
        blocker.style.display = 'none';
      } else {
        blocker.style.display = this.isLocked ? 'none' : 'flex';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      const sens = this.isScoped ? 0.0008 : 0.0022;
      this.mouseDeltaX = e.movementX;
      this.mouseDeltaY = e.movementY;

      this.input.yaw -= e.movementX * sens;
      this.input.pitch -= e.movementY * sens;

      const maxPitch = (Math.PI / 2) - 0.02;
      this.input.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.input.pitch));
    });

    // Mouse scroll wheel weapon switching
    window.addEventListener('wheel', (e) => {
      if (!this.isLocked) return;
      if (e.deltaY > 0) {
        this.inventory.cycleNext();
      } else {
        this.inventory.cyclePrev();
      }
      this.syncActiveWeaponView();
    });

    window.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'KeyW': this.input.forward = true; break;
        case 'KeyS': this.input.backward = true; break;
        case 'KeyA': this.input.left = true; break;
        case 'KeyD': this.input.right = true; break;
        case 'Space': this.input.jump = true; break;
        case 'ControlLeft': this.input.crouch = true; break;
        case 'ShiftLeft': this.input.walk = true; break;
        case 'KeyR': this.reload(); break;
        case 'KeyB': this.toggleBuyMenu(); break;
        case 'KeyQ': {
          if (this.inventory.quickSwitch()) {
            this.syncActiveWeaponView();
          }
          break;
        }
        case 'Escape': {
          if (this.isBuyMenuOpen) {
            this.toggleBuyMenu(false);
          }
          break;
        }
        case 'Tab': {
          e.preventDefault();
          const sb = document.getElementById('scoreboard-modal')!;
          sb.style.display = 'block';
          break;
        }
        case 'Digit1': {
          if (this.inventory.equipSlot(1)) this.syncActiveWeaponView();
          break;
        }
        case 'Digit2': {
          if (this.inventory.equipSlot(2)) this.syncActiveWeaponView();
          break;
        }
        case 'Digit3': {
          if (this.inventory.equipSlot(3)) this.syncActiveWeaponView();
          break;
        }
        case 'Digit4': {
          this.throwSmokeGrenade();
          break;
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW': this.input.forward = false; break;
        case 'KeyS': this.input.backward = false; break;
        case 'KeyA': this.input.left = false; break;
        case 'KeyD': this.input.right = false; break;
        case 'Space': this.input.jump = false; break;
        case 'ControlLeft': this.input.crouch = false; break;
        case 'ShiftLeft': this.input.walk = false; break;
        case 'Tab': {
          const sb = document.getElementById('scoreboard-modal')!;
          sb.style.display = 'none';
          break;
        }
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (this.isLocked) {
        if (e.button === 0) {
          this.isFiring = true;
          // Trigger immediate shot if ready
          this.tryFire();
        } else if (e.button === 2) {
          // Right-click AWP sniper scope
          const activeWp = this.inventory.getActiveWeapon();
          if (activeWp.id === 'sovereign-awp') {
            this.toggleScope();
          }
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isFiring = false;
        this.inventory.onMouseUp();
        this.lastFireReleaseTime = performance.now();
      }
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private setupEvents(): void {
    window.addEventListener('resize', () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      this.worldCamera.aspect = width / height;
      this.worldCamera.updateProjectionMatrix();

      this.viewmodelCamera.aspect = width / height;
      this.viewmodelCamera.updateProjectionMatrix();

      this.renderer.setSize(width, height);
    });
  }

  private toggleScope(): void {
    this.isScoped = !this.isScoped;
    this.viewmodel.isScoped = this.isScoped;
    const scopeEl = document.getElementById('sniper-scope')!;
    scopeEl.style.display = this.isScoped ? 'block' : 'none';
    this.worldCamera.fov = this.isScoped ? 26 : 90;
    this.worldCamera.updateProjectionMatrix();
  }

  private toggleBuyMenu(force?: boolean): void {
    const buyEl = document.getElementById('buy-menu')!;
    const blocker = document.getElementById('blocker')!;

    const shouldOpen = force !== undefined ? force : !this.isBuyMenuOpen;
    this.isBuyMenuOpen = shouldOpen;

    if (shouldOpen) {
      if (this.isLocked) {
        document.exitPointerLock();
      }
      buyEl.style.display = 'block';
      blocker.style.display = 'none'; // Guarantee blocker never overlays buy menu
    } else {
      buyEl.style.display = 'none';
      if (!this.isLocked) {
        blocker.style.display = 'flex';
      }
    }
  }

  private setupBuyMenu(): void {
    const closeBtn = document.getElementById('buy-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.toggleBuyMenu(false);
      });
    }

    const cards = document.querySelectorAll('.buy-card');
    cards.forEach((card) => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = card.getAttribute('data-buy');
        if (!item) return;

        if (WEAPONS[item]) {
          const w = WEAPONS[item];
          if (this.playerCash >= w.price) {
            this.playerCash -= w.price;
            this.inventory.buyWeapon(item);
            this.syncActiveWeaponView();
            this.updateHUD();
            this.addKillfeedEntry(`Requisitioned ${w.name} for $${w.price}`);
            this.audio.playReload();
          }
        } else if (item === 'kevlar-helmet' && this.playerCash >= 1000) {
          this.playerCash -= 1000;
          this.playerArmor = 100;
          this.updateHUD();
          this.addKillfeedEntry('Requisitioned Kevlar + Ballistic Helmet');
          this.audio.playReload();
        } else if (item === 'smoke-grenade' && this.playerCash >= 300) {
          this.playerCash -= 300;
          this.updateHUD();
          this.throwSmokeGrenade();
        }
      });
    });
  }

  private syncActiveWeaponView(): void {
    const active = this.inventory.getActiveWeapon();
    if (this.isScoped && active.id !== 'sovereign-awp') {
      this.toggleScope();
    }

    this.viewmodel.setWeapon(active.id);

    // Update weapon name & slot UI
    const nameEl = document.getElementById('hud-weapon-name');
    if (nameEl) nameEl.innerText = active.name.toUpperCase();

    // Slot bar highlight
    for (let i = 1; i <= 4; i++) {
      const el = document.getElementById(`slot-${i}`);
      if (el) {
        if (i === this.inventory.activeSlot) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      }
    }

    this.updateHUD();
  }

  private reload(): void {
    if (this.inventory.startReload()) {
      this.audio.playReload();
      this.viewmodel.isReloading = true;
      const bar = document.getElementById('reload-indicator');
      if (bar) bar.style.display = 'block';
    }
  }

  private tryFire(): void {
    const now = performance.now();
    const canFireCheck = this.inventory.canFire(now, this.isFiring);

    if (!canFireCheck.canFire) {
      if (canFireCheck.reason === 'out_of_ammo') {
        this.reload();
      }
      return;
    }

    const weapon = this.inventory.getActiveWeapon();
    const fireIntervalMs = (60 / weapon.fireRateRpm) * 1000;

    if (now - this.lastShotTime < fireIntervalMs) {
      return;
    }

    this.lastShotTime = now;
    this.shoot();
  }

  private shoot(): void {
    const now = performance.now();
    const weapon = this.inventory.getActiveWeapon();
    this.inventory.onFireExecuted(now);
    this.updateHUD();

    // 1. Melee Attack (Karambit)
    if (weapon.category === 'melee') {
      this.audio.playKnifeSlash();
      this.viewmodel.triggerSlash();
      this.executeMeleeAttack(weapon);
      return;
    }

    // 2. Firearm Gunshot & Recoil
    this.audio.playGunshot(weapon.id);
    this.viewmodel.fireRecoil(0.08, 0.05);

    // Camera view-punch screen kick
    this.cameraPunchPitch += 0.024;

    // Recoil spray pattern
    let sprayPitchDeg = 0;
    let sprayYawDeg = 0;
    if (weapon.sprayPattern.length > 0) {
      const idx = Math.min(this.consecutiveShots, weapon.sprayPattern.length - 1);
      const spray = weapon.sprayPattern[idx];
      sprayPitchDeg = spray[0];
      sprayYawDeg = spray[1];
    }
    this.consecutiveShots++;

    // Spread calculation
    const horzSpeed = this.player.getHorizontalSpeed();
    let dynamicSpread = 0;

    // Zero standing spread RNG: stationary rifles have pinpoint laser accuracy!
    if (horzSpeed > 0.38) {
      dynamicSpread = (horzSpeed / weapon.movementSpeed) * 0.045;
    }
    if (!this.player.state.isGrounded) {
      dynamicSpread += 0.16;
    }

    // AWP noscope penalty
    if (weapon.id === 'sovereign-awp' && !this.isScoped) {
      dynamicSpread += 0.085;
    }

    const spreadX = (Math.random() - 0.5) * dynamicSpread;
    const spreadY = (Math.random() - 0.5) * dynamicSpread;

    const pitchRad = this.input.pitch + (sprayPitchDeg * Math.PI / 180) + spreadY;
    const yawRad = this.input.yaw + (sprayYawDeg * Math.PI / 180) + spreadX;

    const eyePos = this.worldCamera.position;
    const rayDir: THREE.Vector3 = new THREE.Vector3(
      -Math.sin(yawRad) * Math.cos(pitchRad),
      Math.sin(pitchRad),
      -Math.cos(yawRad) * Math.cos(pitchRad)
    ).normalize();

    // Prepare target colliders for shared RaycastEngine
    const targets: TargetCollider[] = this.bots.map(b => ({
      id: b.id,
      name: b.name,
      team: b.team,
      headCenter: { x: b.mesh.position.x, y: b.mesh.position.y + 1.68, z: b.mesh.position.z },
      headRadius: 0.18,
      bodyCenter: { x: b.mesh.position.x, y: b.mesh.position.y + 0.95, z: b.mesh.position.z },
      bodyRadius: 0.35,
      bodyHeight: 1.15,
      isDead: b.isDead,
    }));

    const sharedRay: Ray = {
      origin: { x: eyePos.x, y: eyePos.y, z: eyePos.z },
      direction: { x: rayDir.x, y: rayDir.y, z: rayDir.z },
    };

    // Execute distance-sorted tactical raycast against solid world geometry first!
    const hits = executeTacticalRaycast(
      sharedRay,
      weapon.damage,
      weapon.headDamageMultiplier,
      250,
      this.blocks,
      targets
    );

    if (hits.length > 0) {
      for (const hit of hits) {
        const hitVec = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
        this.spawnBulletTracer(eyePos, hitVec);

        if (hit.targetId) {
          const bot = this.bots.find(b => b.id === hit.targetId);
          if (bot && !bot.isDead) {
            if (hit.isHeadshot) {
              this.audio.playHeadshotDink();
            }
            bot.health -= hit.awardedDamage;
            this.spawnHitFeedback(hitVec, hit.awardedDamage, !!hit.isHeadshot);
            this.checkBotDeath(bot, !!hit.isHeadshot, weapon.name);
          }
        } else {
          // Hit world block / wall
          this.spawnHitFeedback(hitVec, 0, false);
        }
      }
    } else {
      // Bullet travels into open sky
      const farPoint = eyePos.clone().addScaledVector(rayDir, 180);
      this.spawnBulletTracer(eyePos, farPoint);
    }
  }

  private executeMeleeAttack(weapon: WeaponDef): void {
    const eye = this.worldCamera.position;
    const forward = new THREE.Vector3();
    this.worldCamera.getWorldDirection(forward);

    for (const bot of this.bots) {
      if (bot.isDead) continue;
      const botPos = bot.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      const dist = eye.distanceTo(botPos);

      if (dist <= 2.2) {
        // Check backstab angle: dot product of view direction and bot forward direction
        const botDir = new THREE.Vector3(0, 0, 1).applyEuler(bot.mesh.rotation);
        const isBackstab = forward.dot(botDir) > 0.45;

        const dmg = isBackstab ? 180 : 55;
        bot.health -= dmg;
        this.spawnHitFeedback(botPos, dmg, isBackstab);
        this.checkBotDeath(bot, isBackstab, weapon.name);
        break;
      }
    }
  }

  private spawnBulletTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const points = [from.clone().add(new THREE.Vector3(0, -0.12, 0)), to];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0xffea55,
      linewidth: 2,
    });
    const line = new THREE.Line(geo, mat);
    this.worldScene.add(line);
    setTimeout(() => {
      this.worldScene.remove(line);
      geo.dispose();
      mat.dispose();
    }, 55);
  }

  private checkBotDeath(bot: BotEntity, headshot: boolean, weaponName: string): void {
    if (bot.health <= 0 && !bot.isDead) {
      bot.isDead = true;
      bot.mesh.rotation.x = Math.PI / 2;
      bot.mesh.position.y = 0.2;

      this.kills++;
      this.playerCash += 300;
      this.updateHUD();

      this.addKillfeedEntry(`★ Eldar Garamov [${weaponName}] ${headshot ? '⚡ HEADSHOT ⚡ ' : ''}${bot.name}`);

      const sbKills = document.getElementById('sb-kills');
      if (sbKills) sbKills.innerText = this.kills.toString();

      const livingEnemies = this.bots.filter(b => b.team === 'Syndicate' && !b.isDead);
      if (livingEnemies.length === 0) {
        this.ctScore++;
        this.addKillfeedEntry(`🏆 ROUND WON: All Syndicate hostiles neutralized!`);
      }
    }
  }

  private spawnHitFeedback(pos: THREE.Vector3, dmg: number, isHeadshot: boolean): void {
    // Impact spark / dust
    const pGeo = new THREE.SphereGeometry(isHeadshot ? 0.08 : 0.04, 8, 8);
    const pMat = new THREE.MeshBasicMaterial({ color: isHeadshot ? 0xffea00 : (dmg > 0 ? 0xff2222 : 0xcccccc) });
    const p = new THREE.Mesh(pGeo, pMat);
    p.position.copy(pos);
    this.worldScene.add(p);
    setTimeout(() => {
      this.worldScene.remove(p);
      pGeo.dispose();
      pMat.dispose();
    }, 350);

    if (dmg > 0) {
      const screenPos = pos.clone().project(this.worldCamera);
      const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-(screenPos.y * 0.5) + 0.5) * window.innerHeight;

      const pop = document.createElement('div');
      pop.className = `damage-popup ${isHeadshot ? 'headshot' : ''}`;
      pop.style.left = `${x}px`;
      pop.style.top = `${y}px`;
      pop.innerText = `-${dmg}${isHeadshot ? ' (HEADSHOT)' : ''}`;
      document.body.appendChild(pop);
      setTimeout(() => pop.remove(), 800);
    }
  }

  private throwSmokeGrenade(): void {
    const eye = this.worldCamera.position;
    const dir = new THREE.Vector3();
    this.worldCamera.getWorldDirection(dir);

    const targetPos = eye.clone().addScaledVector(dir, 14);
    targetPos.y = 2.0;

    const smokeGeo = new THREE.SphereGeometry(5.4, 16, 16);
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0xc2c8cf,
      transparent: true,
      opacity: 0.88,
      roughness: 0.95,
    });
    const smokeMesh = new THREE.Mesh(smokeGeo, smokeMat);
    smokeMesh.position.copy(targetPos);
    this.worldScene.add(smokeMesh);

    this.smokeClouds.push({
      mesh: smokeMesh,
      startTime: performance.now(),
      duration: 18000,
      center: targetPos,
      radius: 5.4,
    });

    this.audio.playGrenadeExplosion();
    this.addKillfeedEntry(`Smoke deployed at tactical choke point`);
  }

  private addKillfeedEntry(text: string): void {
    const kf = document.getElementById('killfeed')!;
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.innerText = text;
    kf.appendChild(entry);
    setTimeout(() => entry.remove(), 5000);
  }

  private updateHUD(): void {
    const hpEl = document.getElementById('hud-hp');
    const armorEl = document.getElementById('hud-armor');
    const cashEl = document.getElementById('hud-cash');
    const curEl = document.getElementById('hud-ammo-cur');
    const resEl = document.getElementById('hud-ammo-res');
    const ctEl = document.getElementById('score-ct');
    const tEl = document.getElementById('score-t');

    const slotState = this.inventory.getActiveSlotState();

    if (hpEl) hpEl.innerText = this.playerHealth.toString();
    if (armorEl) armorEl.innerText = this.playerArmor.toString();
    if (cashEl) cashEl.innerText = `$${this.playerCash}`;
    if (curEl) curEl.innerText = slotState.currentAmmo.toString();
    if (resEl) resEl.innerText = slotState.reserveAmmo.toString();
    if (ctEl) ctEl.innerText = this.ctScore.toString();
    if (tEl) tEl.innerText = this.tScore.toString();
  }

  private updateDynamicCrosshair(): void {
    const speed = this.player.getHorizontalSpeed();
    const isPinpoint = this.player.isPinpointAccurate();

    const spreadGap = (speed / 5.45) * 16 + (this.consecutiveShots * 1.6);
    const baseGap = 4;
    const totalGap = baseGap + spreadGap;

    const chTop = document.getElementById('ch-top');
    const chBottom = document.getElementById('ch-bottom');
    const chLeft = document.getElementById('ch-left');
    const chRight = document.getElementById('ch-right');

    if (chTop) chTop.style.top = `${-totalGap - 8}px`;
    if (chBottom) chBottom.style.top = `${totalGap}px`;
    if (chLeft) chLeft.style.left = `${-totalGap - 8}px`;
    if (chRight) chRight.style.left = `${totalGap}px`;

    const color = isPinpoint ? '#00ff88' : '#ff4444';
    const bars = document.querySelectorAll('.crosshair-bar, .crosshair-dot');
    bars.forEach((el) => {
      (el as HTMLElement).style.background = color;
    });

    const speedEl = document.getElementById('hud-speed');
    if (speedEl) {
      speedEl.innerText = `${speed.toFixed(1)} m/s ${isPinpoint ? '• PINPOINT' : ''}`;
      speedEl.style.color = isPinpoint ? '#00ff88' : '#ffaa33';
    }
  }

  private updateBots(dt: number, now: number): void {
    const playerPos = new THREE.Vector3(this.player.state.x, this.player.state.y, this.player.state.z);
    const playerEye = new THREE.Vector3(this.player.state.x, this.player.state.y + this.player.state.currentEyeHeight, this.player.state.z);

    const smokeOccluders: SmokeOccluder[] = this.smokeClouds.map(s => ({
      center: { x: s.center.x, y: s.center.y, z: s.center.z },
      radius: s.radius,
    }));

    this.bots.forEach((bot) => {
      if (bot.isDead) return;

      // 1. Patrol movement along waypoints
      const target = bot.patrolTarget;
      const toTarget = new THREE.Vector3().subVectors(target, bot.mesh.position);
      toTarget.y = 0;
      const distToTarget = toTarget.length();

      if (distToTarget < 1.0) {
        bot.waypointIndex = (bot.waypointIndex + 1) % bot.patrolWaypoints.length;
        bot.patrolTarget = bot.patrolWaypoints[bot.waypointIndex];
      } else {
        toTarget.normalize();
        bot.mesh.position.addScaledVector(toTarget, 3.2 * dt);
        bot.mesh.lookAt(target.x, bot.mesh.position.y, target.z);
      }

      // 2. Syndicate Bot Target Engagement with Line of Sight Verification
      if (bot.team === 'Syndicate') {
        const distToPlayer = bot.mesh.position.distanceTo(playerPos);
        if (distToPlayer < 38) {
          const botEye: THREE.Vector3 = bot.mesh.position.clone().add(new THREE.Vector3(0, 1.68, 0));

          // Verify strict line of sight through world blocks & smoke clouds!
          const canSee = hasLineOfSight(
            { x: botEye.x, y: botEye.y, z: botEye.z },
            { x: playerEye.x, y: playerEye.y, z: playerEye.z },
            this.blocks,
            smokeOccluders
          );

          if (canSee) {
            bot.mesh.lookAt(playerPos.x, bot.mesh.position.y, playerPos.z);

            if (now - bot.lastShotTime > 880) {
              bot.lastShotTime = now;
              this.audio.playGunshot('garam-47');
              this.spawnBulletTracer(botEye, playerEye);

              // 35% hit accuracy when having clear line of sight
              if (Math.random() < 0.35) {
                const dmg = 24;
                if (this.playerArmor > 0) {
                  this.playerArmor = Math.max(0, this.playerArmor - Math.round(dmg * 0.5));
                  this.playerHealth = Math.max(0, this.playerHealth - Math.round(dmg * 0.5));
                } else {
                  this.playerHealth = Math.max(0, this.playerHealth - dmg);
                }
                this.updateHUD();

                if (this.playerHealth <= 0) {
                  this.deaths++;
                  this.tScore++;
                  this.addKillfeedEntry(`💀 ${bot.name} eliminated Eldar Garamov`);
                  this.playerHealth = 100;
                  this.playerArmor = 100;
                  this.player.state.x = 0;
                  this.player.state.z = 38;
                  this.updateHUD();
                }
              }
            }
          }
        }
      }
    });
  }

  private loop(now: number): void {
    requestAnimationFrame(this.loop.bind(this));

    const frameDelta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.accumulator += frameDelta;

    const activeWp = this.inventory.getActiveWeapon();

    // 128Hz Fixed Physics Kinematics Accumulator
    while (this.accumulator >= this.FIXED_DT) {
      this.player.update(this.input, this.FIXED_DT, activeWp.movementSpeed, this.colliders);
      this.accumulator -= this.FIXED_DT;
    }

    // Footstep audio
    const hozSpeed = this.player.getHorizontalSpeed();
    if (this.player.state.isGrounded && hozSpeed > 0.8 && !this.input.walk) {
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
      const bar = document.getElementById('reload-indicator');
      if (bar) bar.style.display = 'none';
      this.updateHUD();
    }

    // Update reload progress bar
    if (this.inventory.isReloading) {
      const progress = 1 - (this.inventory.reloadRemaining / this.inventory.reloadDuration);
      this.viewmodel.reloadProgress = progress;
      const fill = document.getElementById('reload-fill');
      if (fill) fill.style.width = `${Math.round(progress * 100)}%`;
    }

    // Continuous fire for automatic weapons
    if (this.isFiring && this.isLocked && activeWp.fireMode === 'auto') {
      this.tryFire();
    }

    // Recoil spray reset after releasing trigger
    if (!this.isFiring && this.consecutiveShots > 0) {
      if (now - this.lastFireReleaseTime > 260) {
        this.consecutiveShots = 0;
      }
    }

    // Camera recoil punch recovery
    this.cameraPunchPitch += (0 - this.cameraPunchPitch) * (1 - Math.exp(-18 * frameDelta));

    // Bot AI update with line-of-sight checks
    this.updateBots(frameDelta, now);

    // Clean up expired smoke clouds
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      const s = this.smokeClouds[i];
      if (now - s.startTime > s.duration) {
        this.worldScene.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.smokeClouds.splice(i, 1);
      }
    }

    // Round timer
    const timerEl = document.getElementById('round-timer');
    if (timerEl) {
      const mins = Math.floor(this.roundTimeRemaining / 60);
      const secs = Math.floor(this.roundTimeRemaining % 60);
      timerEl.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // Camera transform with view-punch
    const eyeY = this.player.state.y + this.player.state.currentEyeHeight;
    this.worldCamera.position.set(this.player.state.x, eyeY, this.player.state.z);

    const effectivePitch = this.input.pitch + this.cameraPunchPitch;
    const euler = new THREE.Euler(effectivePitch, this.input.yaw, 0, 'YXZ');
    this.worldCamera.quaternion.setFromEuler(euler);

    const walkBob = Math.sin(this.distanceTraveled * 4) * 0.008 * (hozSpeed / 5.45);
    let strafeRoll = 0;
    if (this.input.left) strafeRoll = 0.025;
    if (this.input.right) strafeRoll = -0.025;

    this.viewmodel.update(frameDelta, this.mouseDeltaX, this.mouseDeltaY, walkBob, strafeRoll);
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    this.updateDynamicCrosshair();

    // DUAL-PASS RENDERING
    this.renderer.clear();
    this.renderer.render(this.worldScene, this.worldCamera);

    if (!this.isScoped) {
      this.renderer.clearDepth();
      this.renderer.render(this.viewmodelScene, this.viewmodelCamera);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new GaramGame();
});
