import * as THREE from 'three';
import { KinematicPlayerController, PlayerInput } from '@garam/shared';
import { WEAPONS, WeaponDef } from '@garam/shared';
import { WeaponViewmodel } from './viewmodel/WeaponViewmodel.js';
import { ProceduralAudio } from './audio/ProceduralAudio.js';
import { buildTacticalMap, TargetEntity } from './maps/DeCitadelMap.js';

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

  // Map entities & raycasting
  private targets: TargetEntity[] = [];
  private colliders: THREE.Box3[] = [];
  private raycaster = new THREE.Raycaster();

  // Accumulator loop
  private lastTime = performance.now();
  private accumulator = 0;
  private readonly FIXED_DT = 1 / 128; // 128Hz

  // Walk bob & step cycle
  private distanceTraveled = 0;
  private lastStepDist = 0;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.audio = new ProceduralAudio();
    this.player = new KinematicPlayerController(0, 0, 30); // Spawn at CT Garam Base

    // WebGL Renderer with PCFSoftShadowMap & Depth clearing
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false; // Required for dual-pass viewmodel

    // 1. World Scene (FOV 90°)
    this.worldScene = new THREE.Scene();
    this.worldScene.background = new THREE.Color(0x0e1114);
    this.worldScene.fog = new THREE.FogExp2(0x0e1114, 0.015);

    this.worldCamera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 500);

    // Directional Sunlight & Ambient Sky
    const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x111620, 0.6);
    this.worldScene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfffaed, 1.4);
    sunLight.position.set(40, 60, -30);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 150;
    const d = 50;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    this.worldScene.add(sunLight);

    // 2. Viewmodel Scene (FOV 68°, near: 0.005m - Zero wall clipping)
    this.viewmodelScene = new THREE.Scene();
    this.viewmodelCamera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.005, 5);

    const vmLight = new THREE.DirectionalLight(0xffffff, 1.2);
    vmLight.position.set(1, 2, 1);
    this.viewmodelScene.add(vmLight);
    this.viewmodelScene.add(new THREE.AmbientLight(0x444950, 0.8));

    this.viewmodel = new WeaponViewmodel();
    this.viewmodelScene.add(this.viewmodel.mesh);

    // Build tactical map
    const mapData = buildTacticalMap(this.worldScene);
    this.targets = mapData.targets;
    this.colliders = mapData.colliders;

    this.setupInputs();
    this.setupEvents();

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
      const sens = 0.0022;
      this.mouseDeltaX = e.movementX;
      this.mouseDeltaY = e.movementY;

      this.input.yaw -= e.movementX * sens;
      this.input.pitch -= e.movementY * sens;

      // Clamp vertical pitch to prevent backflips (-89° to +89°)
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
        case 'Digit1': this.switchWeapon('garam-47'); break;
        case 'Digit2': this.switchWeapon('desert-eagle'); break;
        case 'Digit3': this.switchWeapon('garam-karambit'); break;
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
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (this.isLocked && e.button === 0) {
        this.isFiring = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isFiring = false;
        this.lastFireReleaseTime = performance.now();
      }
    });
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

  private switchWeapon(weaponId: string): void {
    if (!WEAPONS[weaponId]) return;
    this.currentWeapon = WEAPONS[weaponId];
    this.currentAmmo = this.currentWeapon.magCapacity;
    this.reserveAmmo = this.currentWeapon.reserveAmmo;
    this.consecutiveShots = 0;

    const nameEl = document.getElementById('hud-weapon-name');
    if (nameEl) nameEl.innerText = this.currentWeapon.name.toUpperCase();
    this.updateAmmoUI();
  }

  private reload(): void {
    if (this.currentAmmo >= this.currentWeapon.magCapacity || this.reserveAmmo <= 0) return;
    const needed = this.currentWeapon.magCapacity - this.currentAmmo;
    const taken = Math.min(needed, this.reserveAmmo);
    this.currentAmmo += taken;
    this.reserveAmmo -= taken;
    this.consecutiveShots = 0;
    this.updateAmmoUI();
  }

  private shoot(): void {
    if (this.currentAmmo <= 0) {
      this.reload();
      return;
    }

    this.currentAmmo--;
    this.updateAmmoUI();
    this.audio.playGunshot(this.currentWeapon.id === 'vanguard-m4');
    this.viewmodel.fireRecoil(0.065, 0.045);

    // 1. Calculate deterministic spray pattern offset
    let sprayPitchDeg = 0;
    let sprayYawDeg = 0;
    if (this.currentWeapon.sprayPattern.length > 0) {
      const idx = Math.min(this.consecutiveShots, this.currentWeapon.sprayPattern.length - 1);
      const spray = this.currentWeapon.sprayPattern[idx];
      sprayPitchDeg = spray[0];
      sprayYawDeg = spray[1];
    }
    this.consecutiveShots++;

    // 2. Velocity-driven spread cone
    const horzSpeed = this.player.getHorizontalSpeed();
    let dynamicSpread = 0;
    if (horzSpeed > 0.38) {
      dynamicSpread = (horzSpeed / this.currentWeapon.movementSpeed) * 0.05;
    }
    if (!this.player.state.isGrounded) {
      dynamicSpread += 0.12;
    }

    const spreadX = (Math.random() - 0.5) * dynamicSpread;
    const spreadY = (Math.random() - 0.5) * dynamicSpread;

    // 3. Construct ray direction incorporating spray + spread
    const pitchRad = this.input.pitch + (sprayPitchDeg * Math.PI / 180) + spreadY;
    const yawRad = this.input.yaw + (sprayYawDeg * Math.PI / 180) + spreadX;

    const rayDir = new THREE.Vector3(
      -Math.sin(yawRad) * Math.cos(pitchRad),
      Math.sin(pitchRad),
      -Math.cos(yawRad) * Math.cos(pitchRad)
    ).normalize();

    const rayOrigin = this.worldCamera.position.clone();
    this.raycaster.set(rayOrigin, rayDir);

    // 4. Test hitboxes on target dummies
    const hitCandidates: THREE.Object3D[] = [];
    this.targets.forEach((t) => {
      if (!t.isDead) {
        hitCandidates.push(t.headCollider, t.bodyCollider);
      }
    });

    const intersects = this.raycaster.intersectObjects(hitCandidates, false);
    if (intersects.length > 0) {
      const hit = intersects[0];
      for (const t of this.targets) {
        if (hit.object === t.headCollider) {
          // Headshot 4x metallic dink cue
          this.audio.playHeadshotDink();
          t.health -= this.currentWeapon.damage * 4.0;
          this.spawnHitSpark(hit.point, 0xffcc00);
          break;
        } else if (hit.object === t.bodyCollider) {
          t.health -= this.currentWeapon.damage;
          this.spawnHitSpark(hit.point, 0xdd2222);
          break;
        }
      }
    } else {
      // Wall impact decal / dust spark
      const worldHits = this.raycaster.intersectObjects(this.worldScene.children, true);
      if (worldHits.length > 0) {
        this.spawnHitSpark(worldHits[0].point, 0xaaaaaa);
      }
    }
  }

  private spawnHitSpark(pos: THREE.Vector3, color: number): void {
    const pGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const pMat = new THREE.MeshBasicMaterial({ color });
    const p = new THREE.Mesh(pGeo, pMat);
    p.position.copy(pos);
    this.worldScene.add(p);
    setTimeout(() => {
      this.worldScene.remove(p);
    }, 400);
  }

  private updateAmmoUI(): void {
    const curEl = document.getElementById('hud-ammo-cur');
    const resEl = document.getElementById('hud-ammo-res');
    if (curEl) curEl.innerText = this.currentAmmo.toString();
    if (resEl) resEl.innerText = this.reserveAmmo.toString();
  }

  private updateDynamicCrosshair(): void {
    const speed = this.player.getHorizontalSpeed();
    const isPinpoint = this.player.isPinpointAccurate();

    // Spread expansion formula based on velocity and spray bloom
    const spreadGap = (speed / 5.45) * 14 + (this.consecutiveShots * 1.5);

    const chTop = document.getElementById('ch-top');
    const chBottom = document.getElementById('ch-bottom');
    const chLeft = document.getElementById('ch-left');
    const chRight = document.getElementById('ch-right');

    const baseGap = 4;
    const totalGap = baseGap + spreadGap;

    if (chTop) chTop.style.top = `${-totalGap - 8}px`;
    if (chBottom) chBottom.style.top = `${totalGap}px`;
    if (chLeft) chLeft.style.left = `${-totalGap - 8}px`;
    if (chRight) chRight.style.left = `${totalGap}px`;

    // Crosshair turns bright green on pinpoint counter-strafe
    const color = isPinpoint ? '#00ff88' : '#ff4444';
    const bars = document.querySelectorAll('.crosshair-bar, .crosshair-dot');
    bars.forEach((el) => {
      (el as HTMLElement).style.background = color;
    });

    const speedEl = document.getElementById('hud-speed');
    if (speedEl) {
      speedEl.innerText = `${speed.toFixed(1)} m/s ${isPinpoint ? '• PINPOINT' : ''}`;
      speedEl.style.color = isPinpoint ? '#00ff88' : '#e0e6ed';
    }
  }

  private loop(now: number): void {
    requestAnimationFrame(this.loop.bind(this));

    const frameDelta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.accumulator += frameDelta;

    // Fixed-timestep kinematics (128Hz)
    while (this.accumulator >= this.FIXED_DT) {
      this.player.update(this.input, this.FIXED_DT, this.currentWeapon.movementSpeed);
      this.accumulator -= this.FIXED_DT;
    }

    // Step cycle footstep audio
    const hozSpeed = this.player.getHorizontalSpeed();
    if (this.player.state.isGrounded && hozSpeed > 0.8 && !this.input.walk) {
      this.distanceTraveled += hozSpeed * frameDelta;
      if (this.distanceTraveled - this.lastStepDist > 2.2) {
        this.audio.playFootstep();
        this.lastStepDist = this.distanceTraveled;
      }
    }

    // Weapon firing interval check
    if (this.isFiring && this.isLocked) {
      const fireInterval = 60 / this.currentWeapon.fireRateRpm;
      if (now - this.lastShotTime >= fireInterval * 1000) {
        this.shoot();
        this.lastShotTime = now;
      }
    }

    // Smooth reset of recoil spray pattern after releasing trigger
    if (!this.isFiring && this.consecutiveShots > 0) {
      if (now - this.lastFireReleaseTime > 280) {
        this.consecutiveShots = 0;
      }
    }

    // Update camera position to player position + eye height
    const eyeY = this.player.state.y + this.player.state.currentEyeHeight;
    this.worldCamera.position.set(this.player.state.x, eyeY, this.player.state.z);

    // Apply pitch and yaw
    const euler = new THREE.Euler(this.input.pitch, this.input.yaw, 0, 'YXZ');
    this.worldCamera.quaternion.setFromEuler(euler);

    // Viewmodel bob & strafe banking
    const walkBob = Math.sin(this.distanceTraveled * 4) * 0.008 * (hozSpeed / 5.45);
    let strafeRoll = 0;
    if (this.input.left) strafeRoll = 0.025;
    if (this.input.right) strafeRoll = -0.025;

    this.viewmodel.update(frameDelta, this.mouseDeltaX, this.mouseDeltaY, walkBob, strafeRoll);
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    this.updateDynamicCrosshair();

    // DUAL-PASS RENDERING
    // 1. Render World Scene
    this.renderer.clear();
    this.renderer.render(this.worldScene, this.worldCamera);

    // 2. Clear depth buffer & Render First-Person Viewmodel (Zero wall clipping)
    this.renderer.clearDepth();
    this.renderer.render(this.viewmodelScene, this.viewmodelCamera);
  }
}

// Start Game
window.addEventListener('DOMContentLoaded', () => {
  new GaramGame();
});
