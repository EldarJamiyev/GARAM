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

// Pre-allocated scratch objects for zero-GC ballistics hot loop
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _terminalPoint = new THREE.Vector3();
const _hitVec = new THREE.Vector3();
const _exitVec = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
const _reverseNormal = new THREE.Vector3();

export interface WeaponCombatCallbacks {
  onKill: (killerName: string, victimBot: BotEntity, headshot: boolean, weaponName: string, reward: number) => void;
  onCameraPunch: (pitchKick: number, yawKick?: number) => void;
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

  // Physical camera aim-punch angles (radians)
  public aimPunchPitch = 0;
  public aimPunchYaw = 0;

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

  public update(dt: number, currentSpeed: number, isCrouching: boolean): void {
    const now = performance.now();
    const weapon = this.inventory.getActiveWeapon();

    // 1. Recover physical camera aim-punch smoothly according to weapon recovery rate
    const recoveryTime = isCrouching
      ? (weapon.recoveryTimeCrouch || 0.28)
      : (weapon.recoveryTimeStand || 0.35);
    const decayRate = 1.0 / Math.max(0.06, recoveryTime);
    const decayFactor = 1.0 - Math.exp(-decayRate * dt);

    this.aimPunchPitch += (0 - this.aimPunchPitch) * decayFactor;
    this.aimPunchYaw += (0 - this.aimPunchYaw) * decayFactor;

    // Decay consecutive shots counter after pausing fire
    const fireIntervalMs = (60 / Math.max(1, weapon.fireRateRpm)) * 1000;
    if (now - this.lastShotTime > fireIntervalMs * 1.5) {
      this.consecutiveShots = Math.max(0, this.consecutiveShots - Math.ceil(dt * 14));
    }

    // 2. Scoped AWP motion blur: when moving scoped with AWP, scope reticle blurs
    if (this.zoomStage > 0 && weapon.id === 'sovereign-awp') {
      const scopeEl = document.getElementById('sniper-scope');
      if (scopeEl) {
        if (currentSpeed > 0.38) {
          const blurPx = Math.min(10, (currentSpeed - 0.38) * 2.8);
          scopeEl.style.filter = `blur(${blurPx.toFixed(1)}px)`;
        } else {
          scopeEl.style.filter = 'none';
        }
      }
    }
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
    camera.getWorldDirection(_forward);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.effects.spawnShellCasing(camera.position, _forward, _right);

    // Recoil spray calculation from weapon spray pattern
    let sprayPitchDeg = 0;
    let sprayYawDeg = 0;
    if (weapon.sprayPattern.length > 0) {
      const idx = Math.min(this.consecutiveShots, weapon.sprayPattern.length - 1);
      const spray = weapon.sprayPattern[idx];
      sprayPitchDeg = spray[0];
      sprayYawDeg = spray[1];
    }
    this.consecutiveShots++;

    // Calculate physical aim-punch kick scaled by recoilViewPunchScale
    const punchScale = weapon.recoilViewPunchScale;
    const punchPitchRad = (sprayPitchDeg * Math.PI / 180) * punchScale;
    const punchYawRad = (sprayYawDeg * Math.PI / 180) * punchScale;

    this.aimPunchPitch = punchPitchRad;
    this.aimPunchYaw = punchYawRad;
    this.callbacks.onCameraPunch(punchPitchRad, punchYawRad);

    // Spread calculation: zero standing spread RNG when counter-strafed!
    let dynamicSpread = 0;
    if (currentSpeed > 0.38) {
      dynamicSpread = (currentSpeed / weapon.movementSpeed) * (weapon.inaccuracyMove || 0.045);
    }
    if (!isGrounded) {
      dynamicSpread += (weapon.inaccuracyJump || 0.16);
    }
    if (weapon.id === 'sovereign-awp' && this.zoomStage === 0) {
      dynamicSpread += 0.085; // Heavy noscope spread penalty
    }

    const spreadX = (Math.random() - 0.5) * dynamicSpread;
    const spreadY = (Math.random() - 0.5) * dynamicSpread;

    const pitchRad = inputPitch + this.aimPunchPitch + spreadY;
    const yawRad = inputYaw + this.aimPunchYaw + spreadX;

    const eyePos = camera.position;
    _rayDir.set(
      -Math.sin(yawRad) * Math.cos(pitchRad),
      Math.sin(pitchRad),
      -Math.cos(yawRad) * Math.cos(pitchRad)
    ).normalize();

    // Map targets for RaycastEngine with live 1:1 articulated hitboxes
    const targets: TargetCollider[] = bots.map(b => ({
      id: b.id,
      name: b.name,
      team: b.team,
      center: { x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z },
      hasHelmet: true,
      armor: 100,
      isDead: b.isDead,
      hitboxes: b.rig?.getWorldHitboxes(),
    }));

    const sharedRay: Ray = {
      origin: { x: eyePos.x, y: eyePos.y, z: eyePos.z },
      direction: { x: _rayDir.x, y: _rayDir.y, z: _rayDir.z },
    };

    // Execute distance-sorted raycast against solid world geometry first!
    const hits = executeTacticalRaycast(
      sharedRay,
      weapon.damage,
      weapon.armorPenetration,
      weapon.penetrationPower,
      250,
      blocks,
      targets,
      weapon.damageDropoffPer10m || 0.98
    );

    _terminalPoint.copy(eyePos).addScaledVector(_rayDir, 160);

    if (hits.length > 0) {
      for (const hit of hits) {
        _hitVec.set(hit.point.x, hit.point.y, hit.point.z);
        _terminalPoint.copy(_hitVec);

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
            this.effects.spawnDamagePopup(_hitVec, hit.awardedDamage, !!hit.isHeadshot);

            if (victim.health <= 0) {
              victim.isDead = true;
              this.callbacks.onKill('Eldar Garamov', victim, !!hit.isHeadshot, weapon.name, weapon.killReward);
            }
          }
        } else {
          // Spawn wall entry decal
          _hitNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
          this.effects.spawnBulletDecal(_hitVec, _hitNormal, hit.material);

          // If wall was penetrated, spawn exit decal on the other side!
          if (hit.exitPoint) {
            _exitVec.set(hit.exitPoint.x, hit.exitPoint.y, hit.exitPoint.z);
            _reverseNormal.set(-hit.normal.x, -hit.normal.y, -hit.normal.z);
            this.effects.spawnBulletDecal(_exitVec, _reverseNormal, hit.material);
          }
        }
      }
    }

    // Draw ONE continuous tracer beam to the terminal hit point
    this.effects.spawnTracer(eyePos, _terminalPoint, weapon.id);
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
