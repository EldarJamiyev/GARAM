import * as THREE from 'three';
import {
  WeaponDef,
  MapBlockCollider,
  executeTacticalRaycast,
  hasLineOfSight,
  TargetCollider,
  Ray,
  SmokeOccluder
} from '@garam/shared';
import { InventoryManager } from './InventoryManager.js';
import { WeaponViewmodel } from '../viewmodel/WeaponViewmodel.js';
import { EffectsManager } from './EffectsManager.js';
import { ProceduralAudio } from '../audio/ProceduralAudio.js';
import { BotEntity } from '../maps/DeCitadelMap.js';
import { settingsStore } from '../core/SettingsStore.js';

export interface WeaponCombatCallbacks {
  onKill: (killerName: string, victimBot: BotEntity, headshot: boolean, weaponName: string, reward: number) => void;
  onCameraPunch: (pitchKick: number) => void;
  onScopeChanged: (zoomStage: number, fov: number, sens: number) => void;
  onUtilityThrown: () => void;
  onHitmarker?: (headshot: boolean) => void;
}

export class WeaponController {
  private inventory: InventoryManager;
  private viewmodel: WeaponViewmodel;
  private effects: EffectsManager;
  private audio: ProceduralAudio;
  private callbacks: WeaponCombatCallbacks;

  // Recoil spray state
  public consecutiveShots = 0;
  public lastShotTime = 0;
  public lastFireReleaseTime = 0;

  // AWP 2-stage zoom state: 0 = 90°, 1 = 28° (1x), 2 = 10° (2x)
  public zoomStage = 0;

  // Melee cooldowns
  private nextMeleeTime = 0;

  constructor(
    inventory: InventoryManager,
    viewmodel: WeaponViewmodel,
    effects: EffectsManager,
    audio: ProceduralAudio,
    callbacks: WeaponCombatCallbacks
  ) {
    this.inventory = inventory;
    this.viewmodel = viewmodel;
    this.effects = effects;
    this.audio = audio;
    this.callbacks = callbacks;
  }

  public handlePrimaryFire(
    camera: THREE.PerspectiveCamera,
    currentSpeed: number,
    isGrounded: boolean,
    inputYaw: number,
    inputPitch: number,
    blocks: MapBlockCollider[],
    bots: BotEntity[]
  ): void {
    const now = performance.now();
    const weapon = this.inventory.getActiveWeapon();

    // Check weapon firing readiness
    const canFireCheck = this.inventory.canFire(now, true);
    if (!canFireCheck.canFire) {
      if (canFireCheck.reason === 'out_of_ammo') {
        this.audio.playDryFire();
        this.inventory.startReload();
      }
      return;
    }

    if (weapon.category === 'melee') {
      this.executeKarambitAttack(camera, bots, blocks, false); // M1 Light Slash
      return;
    }

    // Check rate of fire
    const fireIntervalMs = (60 / weapon.fireRateRpm) * 1000;
    if (now - this.lastShotTime < fireIntervalMs) return;

    this.lastShotTime = now;
    this.inventory.onFireExecuted(now);

    // Audio & Viewmodel kicks
    this.audio.playGunshot(weapon.id);

    // Per-weapon camera punch pitch
    let punchKick = 0.026;
    if (weapon.id === 'sovereign-awp') punchKick = 0.075;
    else if (weapon.id === 'desert-eagle') punchKick = 0.048;
    else if (weapon.id === 'vanguard-m4') punchKick = 0.015;

    this.callbacks.onCameraPunch(punchKick);
    this.viewmodel.fireRecoil(punchKick * 2.5, 0.05);

    // Auto-unscope immediately on AWP fire for bolt-action pull!
    if (weapon.id === 'sovereign-awp' && this.zoomStage > 0) {
      this.resetZoom();
    }

    // Eject spinning brass shell casing to the right
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    this.effects.spawnShellCasing(camera.position, forward, right);

    // Recoil spray calculation
    let sprayPitchDeg = 0;
    let sprayYawDeg = 0;
    if (weapon.sprayPattern.length > 0) {
      const idx = Math.min(this.consecutiveShots, weapon.sprayPattern.length - 1);
      const spray = weapon.sprayPattern[idx];
      sprayPitchDeg = spray[0];
      sprayYawDeg = spray[1];
    }
    this.consecutiveShots++;

    // Spread calculation: zero standing spread RNG when counter-strafed!
    let dynamicSpread = 0;
    if (currentSpeed > 0.38) {
      dynamicSpread = (currentSpeed / weapon.movementSpeed) * 0.045;
    }
    if (!isGrounded) {
      dynamicSpread += 0.16;
    }
    if (weapon.id === 'sovereign-awp' && this.zoomStage === 0) {
      dynamicSpread += 0.085; // Heavy noscope spread penalty
    }

    const spreadX = (Math.random() - 0.5) * dynamicSpread;
    const spreadY = (Math.random() - 0.5) * dynamicSpread;

    const pitchRad = inputPitch + (sprayPitchDeg * Math.PI / 180) + spreadY;
    const yawRad = inputYaw + (sprayYawDeg * Math.PI / 180) + spreadX;

    const eyePos = camera.position;
    const rayDir = new THREE.Vector3(
      -Math.sin(yawRad) * Math.cos(pitchRad),
      Math.sin(pitchRad),
      -Math.cos(yawRad) * Math.cos(pitchRad)
    ).normalize();

    // Map targets for RaycastEngine
    const targets: TargetCollider[] = bots.map(b => ({
      id: b.id,
      name: b.name,
      team: b.team,
      center: { x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z },
      hasHelmet: true,
      armor: 100,
      isDead: b.isDead,
    }));

    const sharedRay: Ray = {
      origin: { x: eyePos.x, y: eyePos.y, z: eyePos.z },
      direction: { x: rayDir.x, y: rayDir.y, z: rayDir.z },
    };

    // Execute distance-sorted raycast against solid world geometry first!
    const hits = executeTacticalRaycast(
      sharedRay,
      weapon.damage,
      weapon.armorPenetration,
      weapon.penetrationPower,
      250,
      blocks,
      targets
    );

    let terminalPoint = eyePos.clone().addScaledVector(rayDir, 160);

    if (hits.length > 0) {
      for (const hit of hits) {
        const hitVec = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
        terminalPoint = hitVec;

        if (hit.targetId) {
          const victim = bots.find(b => b.id === hit.targetId);
          if (victim && !victim.isDead) {
            // Friendly-fire protection: Vanguard teammates cannot be damaged or award cash!
            if (victim.team === 'Vanguard') {
              this.callbacks.onHitmarker?.(false);
              break;
            }

            if (hit.isHeadshot) {
              this.audio.playHeadshotDink();
            }

            // Trigger operator flinch & hitmarker
            victim.rig?.triggerFlinch();
            this.callbacks.onHitmarker?.(!!hit.isHeadshot);

            victim.health = Math.max(0, victim.health - hit.awardedDamage);
            this.effects.spawnDamagePopup(hitVec, hit.awardedDamage, !!hit.isHeadshot);

            if (victim.health <= 0) {
              victim.isDead = true;
              this.callbacks.onKill('Eldar Garamov', victim, !!hit.isHeadshot, weapon.name, weapon.killReward);
            }
          }
        } else {
          // Spawn wall entry decal
          this.effects.spawnBulletDecal(hitVec, new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), hit.material);

          // If wall was penetrated, spawn exit decal on the other side!
          if (hit.exitPoint) {
            const exitVec = new THREE.Vector3(hit.exitPoint.x, hit.exitPoint.y, hit.exitPoint.z);
            const reverseNormal = new THREE.Vector3(-hit.normal.x, -hit.normal.y, -hit.normal.z);
            this.effects.spawnBulletDecal(exitVec, reverseNormal, hit.material);
          }
        }
      }
    }

    // Draw ONE continuous tracer beam to the terminal hit point
    this.effects.spawnTracer(eyePos, terminalPoint, weapon.id);
  }

  public handleSecondaryFire(camera: THREE.PerspectiveCamera, blocks: MapBlockCollider[], bots: BotEntity[]): void {
    const weapon = this.inventory.getActiveWeapon();

    // 1. Karambit M2 Heavy Stab
    if (weapon.category === 'melee') {
      this.executeKarambitAttack(camera, bots, blocks, true); // M2 Heavy Backstab
      return;
    }

    // 2. Sovereign AWP 2-Stage Optical Zoom
    if (weapon.id === 'sovereign-awp') {
      this.zoomStage = (this.zoomStage + 1) % 3;
      let fov = settingsStore.settings.fov;
      let sens = settingsStore.settings.mouseSensitivity * 0.001;

      if (this.zoomStage === 1) {
        fov = 28; // 1x Magnification
        sens = (settingsStore.settings.mouseSensitivity * 0.001) * 0.38;
      } else if (this.zoomStage === 2) {
        fov = 10; // 2x Extreme Magnification
        sens = (settingsStore.settings.mouseSensitivity * 0.001) * 0.16;
      }

      this.viewmodel.isScoped = this.zoomStage > 0;
      this.callbacks.onScopeChanged(this.zoomStage, fov, sens);
    }
  }

  public onFireRelease(): void {
    this.lastFireReleaseTime = performance.now();
    this.inventory.isSemiTriggerReleased = true;
  }

  private executeKarambitAttack(
    camera: THREE.PerspectiveCamera,
    bots: BotEntity[],
    blocks: MapBlockCollider[],
    isHeavyStab: boolean
  ): void {
    const now = performance.now();
    if (now < this.nextMeleeTime) return;

    this.nextMeleeTime = now + (isHeavyStab ? 850 : 450);
    this.audio.playKnifeSlash();

    if (isHeavyStab) {
      this.viewmodel.triggerStab();
    } else {
      this.viewmodel.triggerSlash();
    }

    const eye = camera.position;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);

    for (const bot of bots) {
      if (bot.isDead || bot.team === 'Vanguard') continue;

      const botChest = bot.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      const dist = eye.distanceTo(botChest);

      // 2.2m reach check
      if (dist <= 2.2) {
        // Forward Aim Cone check: angle must be within forward view (dot >= 0.65)
        const toBot = botChest.clone().sub(eye).normalize();
        if (forward.dot(toBot) < 0.65) continue;

        // Wall obstruction check: cannot knife through solid walls!
        const canHit = hasLineOfSight(
          { x: eye.x, y: eye.y, z: eye.z },
          { x: botChest.x, y: botChest.y, z: botChest.z },
          blocks
        );
        if (!canHit) continue;

        // Backstab detection
        const botForward = new THREE.Vector3(0, 0, 1).applyEuler(bot.mesh.rotation);
        const isBackstab = forward.dot(botForward) > 0.45;

        let dmg = isHeavyStab ? (isBackstab ? 180 : 90) : (isBackstab ? 90 : 55);
        bot.health = Math.max(0, bot.health - dmg);

        this.effects.spawnDamagePopup(botChest, dmg, isBackstab);
        if (bot.health <= 0) {
          this.callbacks.onKill('Eldar Garamov', bot, isBackstab, 'Garam Crimson Karambit', 1500);
        }
        break;
      }
    }
  }

  public resetZoom(): void {
    if (this.zoomStage > 0) {
      this.zoomStage = 0;
      this.viewmodel.isScoped = false;
      const baseFov = settingsStore.settings.fov;
      const baseSens = settingsStore.settings.mouseSensitivity * 0.001;
      this.callbacks.onScopeChanged(0, baseFov, baseSens);
    }
  }

  public inspectWeapon(): void {
    this.viewmodel.inspect();
  }
}
