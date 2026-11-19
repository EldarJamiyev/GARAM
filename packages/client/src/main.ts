import * as THREE from 'three';
import { KinematicPlayerController, PlayerInput } from '@garam/shared';
import { WEAPONS, WeaponDef } from '@garam/shared';
import { WeaponViewmodel } from './viewmodel/WeaponViewmodel.js';
import { ProceduralAudio } from './audio/ProceduralAudio.js';
import { buildTacticalCitadelMap, BotEntity } from './maps/DeCitadelMap.js';

interface SmokeCloud {
  mesh: THREE.Mesh;
  startTime: number;
  duration: number;
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
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;

  // Weapons & Ballistics
  private currentWeapon: WeaponDef = WEAPONS['garam-47'];
  private currentAmmo = 30;
  private reserveAmmo = 90;
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
  private roundTimeRemaining = 105; // 1:45 round timer
  private ctScore = 0;
  private tScore = 0;
  private isBombPlanted = false;
  private bombPlantTimer = 40;
  private bombMesh: THREE.Mesh | null = null;
  private isInteracting = false;
  private interactionProgress = 0;

  // Map entities & Colliders
  private bots: BotEntity[] = [];
  private colliders: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }[] = [];
  private bombsites: { A: THREE.Vector3; B: THREE.Vector3 };
  private smokeClouds: SmokeCloud[] = [];
  private raycaster = new THREE.Raycaster();

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
    this.player = new KinematicPlayerController(0, 0, 35); // CT Garam Vanguard Base Spawn

    // WebGL Renderer with ACESFilmicToneMapping & PCFSoftShadowMap
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;

    // 1. World Scene (Vibrant Sky & Crisp Lighting)
    this.worldScene = new THREE.Scene();
    this.worldScene.background = new THREE.Color(0x87ceeb); // Daylight sky
    this.worldScene.fog = new THREE.FogExp2(0x87ceeb, 0.007);

    this.worldCamera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 500);

    // Warm Directional Sunlight + Ambient Sky Fill
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x556677, 0.85);
    this.worldScene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff6e5, 1.8);
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

    const vmLight = new THREE.DirectionalLight(0xffffff, 1.4);
    vmLight.position.set(1, 2, 1);
    this.viewmodelScene.add(vmLight);
    this.viewmodelScene.add(new THREE.AmbientLight(0x777e88, 0.9));

    this.viewmodel = new WeaponViewmodel();
    this.viewmodelScene.add(this.viewmodel.mesh);

    // Build tactical map
    const mapData = buildTacticalCitadelMap(this.worldScene);
    this.bots = mapData.bots;
    this.colliders = mapData.colliders;
    this.bombsites = mapData.bombsites;

    this.setupInputs();
    this.setupEvents();
    this.setupBuyMenu();

    requestAnimationFrame(this.loop.bind(this));
  }

  private setupInputs(): void {
    const blocker = document.getElementById('blocker')!;
    blocker.addEventListener('click', () => {
      this.canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.canvas;
      blocker.style.display = this.isLocked ? 'none' : 'flex';
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      const sens = this.isScoped ? 0.0009 : 0.0022;
      this.mouseDeltaX = e.movementX;
      this.mouseDeltaY = e.movementY;

      this.input.yaw -= e.movementX * sens;
      this.input.pitch -= e.movementY * sens;

      const maxPitch = (Math.PI / 2) - 0.02;
      this.input.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.input.pitch));
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
        case 'KeyE': this.isInteracting = true; break;
        case 'Tab': {
          e.preventDefault();
          const sb = document.getElementById('scoreboard-modal')!;
          sb.style.display = 'block';
          break;
        }
        case 'Digit1': this.switchWeapon('garam-47'); break;
        case 'Digit2': this.switchWeapon('desert-eagle'); break;
        case 'Digit3': this.switchWeapon('garam-karambit'); break;
        case 'Digit4': this.throwSmokeGrenade(); break;
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
        case 'KeyE': this.isInteracting = false; this.interactionProgress = 0; break;
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
        } else if (e.button === 2) {
          // Right click zoom (AWP scope toggle)
          if (this.currentWeapon.id === 'sovereign-awp') {
            this.toggleScope();
          }
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isFiring = false;
        this.lastFireReleaseTime = performance.now();
      }
    });

    // Disable browser context menu on right-click
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
    this.worldCamera.fov = this.isScoped ? 30 : 90;
    this.worldCamera.updateProjectionMatrix();
  }

  private toggleBuyMenu(): void {
    const buyEl = document.getElementById('buy-menu')!;
    const isVisible = buyEl.style.display === 'block';
    buyEl.style.display = isVisible ? 'none' : 'block';
  }

  private setupBuyMenu(): void {
    const cards = document.querySelectorAll('.buy-card');
    cards.forEach((card) => {
      card.addEventListener('click', () => {
        const item = card.getAttribute('data-buy');
        if (!item) return;

        if (WEAPONS[item]) {
          const w = WEAPONS[item];
          if (this.playerCash >= w.price) {
            this.playerCash -= w.price;
            this.switchWeapon(item);
            this.updateHUD();
            this.addKillfeedEntry(`Bought ${w.name} for $${w.price}`);
          }
        } else if (item === 'kevlar-helmet' && this.playerCash >= 1000) {
          this.playerCash -= 1000;
          this.playerArmor = 100;
          this.updateHUD();
          this.addKillfeedEntry('Bought Kevlar + Helmet');
        } else if (item === 'smoke-grenade' && this.playerCash >= 300) {
          this.playerCash -= 300;
          this.updateHUD();
          this.throwSmokeGrenade();
        }
      });
    });
  }

  private switchWeapon(weaponId: string): void {
    if (!WEAPONS[weaponId]) return;
    if (this.isScoped) this.toggleScope();

    this.currentWeapon = WEAPONS[weaponId];
    this.currentAmmo = this.currentWeapon.magCapacity;
    this.reserveAmmo = this.currentWeapon.reserveAmmo;
    this.consecutiveShots = 0;

    const nameEl = document.getElementById('hud-weapon-name');
    if (nameEl) nameEl.innerText = this.currentWeapon.name.toUpperCase();
    this.updateHUD();
  }

  private reload(): void {
    if (this.currentAmmo >= this.currentWeapon.magCapacity || this.reserveAmmo <= 0) return;
    const needed = this.currentWeapon.magCapacity - this.currentAmmo;
    const taken = Math.min(needed, this.reserveAmmo);
    this.currentAmmo += taken;
    this.reserveAmmo -= taken;
    this.consecutiveShots = 0;
    this.updateHUD();
  }

  private shoot(): void {
    if (this.currentAmmo <= 0) {
      this.reload();
      return;
    }

    this.currentAmmo--;
    this.updateHUD();
    this.audio.playGunshot(this.currentWeapon.id);
    this.viewmodel.fireRecoil(0.07, 0.05);

    // 1. Recoil spray pattern
    let sprayPitchDeg = 0;
    let sprayYawDeg = 0;
    if (this.currentWeapon.sprayPattern.length > 0) {
      const idx = Math.min(this.consecutiveShots, this.currentWeapon.sprayPattern.length - 1);
      const spray = this.currentWeapon.sprayPattern[idx];
      sprayPitchDeg = spray[0];
      sprayYawDeg = spray[1];
    }
    this.consecutiveShots++;

    // 2. Spread calculation
    const horzSpeed = this.player.getHorizontalSpeed();
    let dynamicSpread = 0;
    if (horzSpeed > 0.38) {
      dynamicSpread = (horzSpeed / this.currentWeapon.movementSpeed) * 0.04;
    }
    if (!this.player.state.isGrounded) {
      dynamicSpread += 0.14;
    }

    const spreadX = (Math.random() - 0.5) * dynamicSpread;
    const spreadY = (Math.random() - 0.5) * dynamicSpread;

    const pitchRad = this.input.pitch + (sprayPitchDeg * Math.PI / 180) + spreadY;
    const yawRad = this.input.yaw + (sprayYawDeg * Math.PI / 180) + spreadX;

    const rayDir = new THREE.Vector3(
      -Math.sin(yawRad) * Math.cos(pitchRad),
      Math.sin(pitchRad),
      -Math.cos(yawRad) * Math.cos(pitchRad)
    ).normalize();

    this.raycaster.set(this.worldCamera.position, rayDir);

    // 3. Test bot hitboxes
    const hitCandidates: THREE.Object3D[] = [];
    this.bots.forEach((b) => {
      if (!b.isDead) {
        hitCandidates.push(b.headCollider, b.bodyCollider);
      }
    });

    const intersects = this.raycaster.intersectObjects(hitCandidates, false);
    if (intersects.length > 0) {
      const hit = intersects[0];
      for (const bot of this.bots) {
        if (hit.object === bot.headCollider) {
          // Headshot 4x dink
          this.audio.playHeadshotDink();
          const dmg = Math.round(this.currentWeapon.damage * 4.0);
          bot.health -= dmg;
          this.spawnHitFeedback(hit.point, dmg, true);
          this.checkBotDeath(bot, true);
          break;
        } else if (hit.object === bot.bodyCollider) {
          const dmg = this.currentWeapon.damage;
          bot.health -= dmg;
          this.spawnHitFeedback(hit.point, dmg, false);
          this.checkBotDeath(bot, false);
          break;
        }
      }
    } else {
      // Wall impact spark
      const worldHits = this.raycaster.intersectObjects(this.worldScene.children, true);
      if (worldHits.length > 0) {
        this.spawnHitFeedback(worldHits[0].point, 0, false);
      }
    }
  }

  private checkBotDeath(bot: BotEntity, headshot: boolean): void {
    if (bot.health <= 0 && !bot.isDead) {
      bot.isDead = true;
      bot.mesh.rotation.x = Math.PI / 2; // Ragdoll fall
      bot.mesh.position.y = 0.2;

      this.kills++;
      this.playerCash += 300;
      this.updateHUD();

      // Top right killfeed announcement
      this.addKillfeedEntry(`★ Eldar Garamov [${this.currentWeapon.name}] ${headshot ? '⚡ HEADSHOT ⚡ ' : ''}${bot.name}`);

      // Update scoreboard
      const sbKills = document.getElementById('sb-kills');
      if (sbKills) sbKills.innerText = this.kills.toString();

      // Check if all Syndicate enemies dead
      const livingEnemies = this.bots.filter(b => b.team === 'Syndicate' && !b.isDead);
      if (livingEnemies.length === 0) {
        this.ctScore++;
        this.addKillfeedEntry(`🏆 ROUND WON: All Syndicate hostiles eliminated!`);
      }
    }
  }

  private spawnHitFeedback(pos: THREE.Vector3, dmg: number, isHeadshot: boolean): void {
    // 1. Visual hit spark particle
    const pGeo = new THREE.SphereGeometry(isHeadshot ? 0.08 : 0.04, 8, 8);
    const pMat = new THREE.MeshBasicMaterial({ color: isHeadshot ? 0xffea00 : 0xff3333 });
    const p = new THREE.Mesh(pGeo, pMat);
    p.position.copy(pos);
    this.worldScene.add(p);
    setTimeout(() => this.worldScene.remove(p), 350);

    // 2. Floating Damage Popup Number on HUD
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
    // Spawn volumetric smoke cloud at aim location
    const eye = this.worldCamera.position;
    const dir = new THREE.Vector3();
    this.worldCamera.getWorldDirection(dir);

    const targetPos = eye.clone().addScaledVector(dir, 14);
    targetPos.y = 2.0;

    const smokeGeo = new THREE.SphereGeometry(5.2, 16, 16);
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0xc4c9ce,
      transparent: true,
      opacity: 0.88,
      roughness: 0.9,
    });
    const smokeMesh = new THREE.Mesh(smokeGeo, smokeMat);
    smokeMesh.position.copy(targetPos);
    this.worldScene.add(smokeMesh);

    this.smokeClouds.push({
      mesh: smokeMesh,
      startTime: performance.now(),
      duration: 18000, // 18s smoke duration
    });

    this.audio.playGrenadeExplosion();
    this.addKillfeedEntry(`Smoke deployed at tactical zone`);
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

    if (hpEl) hpEl.innerText = this.playerHealth.toString();
    if (armorEl) armorEl.innerText = this.playerArmor.toString();
    if (cashEl) cashEl.innerText = `$${this.playerCash}`;
    if (curEl) curEl.innerText = this.currentAmmo.toString();
    if (resEl) resEl.innerText = this.reserveAmmo.toString();
    if (ctEl) ctEl.innerText = `VANGUARD: ${this.ctScore}`;
    if (tEl) tEl.innerText = `${this.tScore} :SYNDICATE`;
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

    this.bots.forEach((bot) => {
      if (bot.isDead) return;

      // 1. Move towards current patrol waypoint
      const target = bot.patrolTarget;
      const toTarget = new THREE.Vector3().subVectors(target, bot.mesh.position);
      toTarget.y = 0;
      const distToTarget = toTarget.length();

      if (distToTarget < 1.0) {
        // Next waypoint
        bot.waypointIndex = (bot.waypointIndex + 1) % bot.patrolWaypoints.length;
        bot.patrolTarget = bot.patrolWaypoints[bot.waypointIndex];
      } else {
        toTarget.normalize();
        bot.mesh.position.addScaledVector(toTarget, 3.2 * dt);
        bot.mesh.lookAt(target.x, bot.mesh.position.y, target.z);
      }

      // 2. Line of sight check to player (Shoot player if enemy Syndicate)
      if (bot.team === 'Syndicate') {
        const distToPlayer = bot.mesh.position.distanceTo(playerPos);
        if (distToPlayer < 35) {
          bot.mesh.lookAt(playerPos.x, bot.mesh.position.y, playerPos.z);

          // Shoot at player every 900ms
          if (now - bot.lastShotTime > 900) {
            bot.lastShotTime = now;
            this.audio.playGunshot('garam-47');

            // 35% chance to land hit on player
            if (Math.random() < 0.35) {
              const dmg = 22;
              if (this.playerArmor > 0) {
                this.playerArmor = Math.max(0, this.playerArmor - dmg * 0.5);
                this.playerHealth = Math.max(0, this.playerHealth - dmg * 0.5);
              } else {
                this.playerHealth = Math.max(0, this.playerHealth - dmg);
              }
              this.updateHUD();

              if (this.playerHealth <= 0) {
                this.deaths++;
                this.tScore++;
                this.addKillfeedEntry(`💀 ${bot.name} eliminated Eldar Garamov`);
                // Respawn player
                this.playerHealth = 100;
                this.playerArmor = 100;
                this.player.state.x = 0;
                this.player.state.z = 35;
                this.updateHUD();
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

    // Fixed-timestep kinematics with true wall collision sliding
    while (this.accumulator >= this.FIXED_DT) {
      this.player.update(this.input, this.FIXED_DT, this.currentWeapon.movementSpeed, this.colliders);
      this.accumulator -= this.FIXED_DT;
    }

    // Footstep audio cycle
    const hozSpeed = this.player.getHorizontalSpeed();
    if (this.player.state.isGrounded && hozSpeed > 0.8 && !this.input.walk) {
      this.distanceTraveled += hozSpeed * frameDelta;
      if (this.distanceTraveled - this.lastStepDist > 2.2) {
        this.audio.playFootstep();
        this.lastStepDist = this.distanceTraveled;
      }
    }

    // Continuous weapon fire
    if (this.isFiring && this.isLocked) {
      const fireInterval = 60 / this.currentWeapon.fireRateRpm;
      if (now - this.lastShotTime >= fireInterval * 1000) {
        this.shoot();
        this.lastShotTime = now;
      }
    }

    // Reset recoil spray pattern after releasing trigger
    if (!this.isFiring && this.consecutiveShots > 0) {
      if (now - this.lastFireReleaseTime > 280) {
        this.consecutiveShots = 0;
      }
    }

    // Update bots
    this.updateBots(frameDelta, now);

    // Update round timer & bomb beeps
    const timerEl = document.getElementById('round-timer');
    if (timerEl) {
      const mins = Math.floor(this.roundTimeRemaining / 60);
      const secs = Math.floor(this.roundTimeRemaining % 60);
      timerEl.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // Camera transform
    const eyeY = this.player.state.y + this.player.state.currentEyeHeight;
    this.worldCamera.position.set(this.player.state.x, eyeY, this.player.state.z);

    const euler = new THREE.Euler(this.input.pitch, this.input.yaw, 0, 'YXZ');
    this.worldCamera.quaternion.setFromEuler(euler);

    // Viewmodel springs & sway
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
