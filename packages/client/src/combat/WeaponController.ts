import * as THREE from 'three';
import {
  WeaponDef,
  MapBlockCollider,
  SpatialGrid,
  executeTacticalRaycast,
  hasLineOfSight,
  TargetCollider,
  Ray,
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
const _up = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _terminalPoint = new THREE.Vector3();
const _hitVec = new THREE.Vector3();
const _exitVec = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
const _reverseNormal = new THREE.Vector3();
const _botChest = new THREE.Vector3();
const _toBot = new THREE.Vector3();
const _botForward = new THREE.Vector3();

export interface WeaponCombatCallbacks {
  onKill: (killerName: string, victimBot: BotEntity, headshot: boolean, weaponName: string, reward: number) => void;
  onCameraPunch: (pitchKick: number, yawKick?: number) => void;
  onScopeChanged: (zoomStage: number, fov: number, sens: number) => void;
  onUtilityThrown: () => void;
  onHitmarker?: (headshot: boolean) => void;
  onFire?: (weapon: WeaponDef, isScoped: boolean, rayDir: THREE.Vector3, isSecondaryMelee: boolean) => void;
}

export class WeaponController {
  private inventory: InventoryManager;
  private viewmodel: WeaponViewmodel;
  private effects: EffectsManager;
  private audio: ProceduralAudio;
  private callbacks: WeaponCombatCallbacks;

  public consecutiveShots = 0;
  public lastShotTime = 0;
  public lastFireReleaseTime = 0;

  public aimPunchPitch = 0;
  public aimPunchYaw = 0;

  public zoomStage = 0;
  private scopeEl: HTMLElement | null = null;
  private lastScopeBlur = '';

  public get isScoped(): boolean {
    return this.zoomStage > 0;
  }

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
    this.scopeEl = document.getElementById('sniper-scope');
  }

  public update(dt: number, currentSpeed: number, isCrouching: boolean): void {
    const now = performance.now();
    const weapon = this.inventory.getActiveWeapon();

    const recoveryTime = isCrouching
      ? weapon.recoveryTimeCrouch || 0.28
      : weapon.recoveryTimeStand || 0.35;
    const decayRate = 1.0 / Math.max(0.06, recoveryTime);
    const decayFactor = 1.0 - Math.exp(-decayRate * dt);

    this.aimPunchPitch += (0 - this.aimPunchPitch) * decayFactor;
    this.aimPunchYaw += (0 - this.aimPunchYaw) * decayFactor;

    const fireIntervalMs = (60 / Math.max(1, weapon.fireRateRpm)) * 1000;
    if (now - this.lastShotTime > fireIntervalMs * 1.5) {
      this.consecutiveShots = Math.max(0, this.consecutiveShots - Math.ceil(dt * 14));
    }

    if (this.zoomStage > 0 && weapon.id === 'sovereign-awp') {
      const scopeEl = this.scopeEl || document.getElementById('sniper-scope');
      if (scopeEl) {
        const nextFilter =
          currentSpeed > 0.38
            ? `blur(${Math.min(10, (currentSpeed - 0.38) * 2.8).toFixed(1)}px)`
            : 'none';
        if (nextFilter !== this.lastScopeBlur) {
          scopeEl.style.filter = nextFilter;
          this.lastScopeBlur = nextFilter;
        }
      }
    }
  }

  public handlePrimaryFire(
    camera: THREE.PerspectiveCamera,
    currentSpeed: number,
    isGrounded: boolean,
    isCrouching: boolean,
    _inputYaw: number,
    _inputPitch: number,
    blocks: MapBlockCollider[],
    bots: BotEntity[],
    spatialGrid?: SpatialGrid
  ): void {
    const now = performance.now();
    const weapon = this.inventory.getActiveWeapon();

    const canFireCheck = this.inventory.canFire(now, true);
    if (!canFireCheck.canFire) {
      if (canFireCheck.reason === 'out_of_ammo') {
        this.audio.playDryFire();
        this.viewmodel.isEmptyReload = true;
        this.inventory.startReload();
      }
      return;
    }

    if (weapon.category === 'melee') {
      this.executeKarambitAttack(camera, bots, blocks, false, spatialGrid);
      return;
    }

    const fireIntervalMs = (60 / weapon.fireRateRpm) * 1000;
    if (now - this.lastShotTime < fireIntervalMs) return;

    this.lastShotTime = now;
    this.inventory.onFireExecuted(now);
    this.audio.playGunshot(weapon.id);

    const wasScoped = this.zoomStage > 0;

    camera.getWorldDirection(_forward);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.effects.spawnShellCasing(camera.position, _forward, _right);

    let dynamicSpread = 0;
    const excessSpeed = Math.max(0, currentSpeed - 0.38);
    if (excessSpeed > 0) {
      const ratio = Math.min(1.0, excessSpeed / weapon.movementSpeed);
      let moveInacc = ratio * ratio * (weapon.inaccuracyMove || 0.045);
      if (isCrouching) {
        moveInacc *= weapon.crouchSpreadMultiplier || 0.65;
      }
      dynamicSpread += moveInacc;
    }
    if (!isGrounded) {
      dynamicSpread += weapon.inaccuracyJump || 0.16;
    }
    if (weapon.id === 'sovereign-awp' && !wasScoped) {
      dynamicSpread += 0.085;
    }

    const spreadX = (Math.random() - 0.5) * dynamicSpread;
    const spreadY = (Math.random() - 0.5) * dynamicSpread;

    camera.getWorldDirection(_forward);
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _up.setFromMatrixColumn(camera.matrixWorld, 1);

    _rayDir
      .copy(_forward)
      .addScaledVector(_right, spreadX)
      .addScaledVector(_up, spreadY)
      .normalize();

    const eyePos = camera.position;
    const playerTeam = settingsStore.settings.faction;
    const callsign = settingsStore.settings.callsign || 'Operator';

    this.callbacks.onFire?.(weapon, wasScoped, _rayDir, false);

    const targets: TargetCollider[] = bots.map((b) => ({
      id: b.id,
      name: b.name,
      team: b.team,
      center: { x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z },
      hasHelmet: b.hasHelmet,
      armor: b.armor,
      isDead: b.isDead,
      isCrouched: !!(b as unknown as { isCrouching?: boolean }).isCrouching,
      yaw: b.mesh.rotation.y,
      hitboxes: b.rig?.getWorldHitboxes(),
    }));

    const sharedRay: Ray = {
      origin: { x: eyePos.x, y: eyePos.y, z: eyePos.z },
      direction: { x: _rayDir.x, y: _rayDir.y, z: _rayDir.z },
    };

    const hits = executeTacticalRaycast(
      sharedRay,
      weapon.damage,
      weapon.armorPenetration,
      weapon.penetrationPower,
      250,
      blocks,
      targets,
      weapon.damageDropoffPer10m || 0.98,
      spatialGrid,
      weapon.headDamageMultiplier
    );

    _terminalPoint.copy(eyePos).addScaledVector(_rayDir, 160);

    if (hits.length > 0) {
      for (const hit of hits) {
        _hitVec.set(hit.point.x, hit.point.y, hit.point.z);
        _terminalPoint.copy(_hitVec);

        if (hit.targetId) {
          const victim = bots.find((b) => b.id === hit.targetId);
          if (victim && !victim.isDead) {
            if (victim.team === playerTeam) {
              this.callbacks.onHitmarker?.(false);
              break;
            }

            if (hit.isHeadshot) {
              this.audio.playHeadshotDink();
            } else {
              this.audio.playBodyHitCrunch(_hitVec, eyePos, blocks);
            }

            victim.rig?.triggerFlinch();
            this.callbacks.onHitmarker?.(!!hit.isHeadshot);

            victim.armor = Math.max(0, victim.armor - hit.armorDamage);
            victim.health = Math.max(0, victim.health - hit.awardedDamage);
            this.effects.spawnDamagePopup(_hitVec, hit.awardedDamage, !!hit.isHeadshot);

            if (victim.health <= 0) {
              victim.isDead = true;
              this.callbacks.onKill(callsign, victim, !!hit.isHeadshot, weapon.name, weapon.killReward);
            }
          }
        } else {
          _hitNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
          this.effects.spawnBulletDecal(_hitVec, _hitNormal, hit.material);

          if (hit.exitPoint) {
            _exitVec.set(hit.exitPoint.x, hit.exitPoint.y, hit.exitPoint.z);
            _reverseNormal.set(-hit.normal.x, -hit.normal.y, -hit.normal.z);
            this.effects.spawnBulletDecal(_exitVec, _reverseNormal, hit.material);
          }
        }
      }
    }

    this.effects.spawnTracer(eyePos, _terminalPoint, weapon.id);

    let sprayPitchDeg = 0;
    let sprayYawDeg = 0;
    if (weapon.sprayPattern.length > 0) {
      const idx = Math.min(this.consecutiveShots, weapon.sprayPattern.length - 1);
      const spray = weapon.sprayPattern[idx];
      sprayPitchDeg = spray[0];
      sprayYawDeg = spray[1];
    }
    this.consecutiveShots++;

    const punchScale = weapon.recoilViewPunchScale;
    const punchPitchRad = ((sprayPitchDeg * Math.PI) / 180) * punchScale;
    const punchYawRad = ((sprayYawDeg * Math.PI) / 180) * punchScale;

    let punchKick = 0.026;
    if (weapon.id === 'sovereign-awp') punchKick = 0.075;
    else if (weapon.id === 'desert-eagle') punchKick = 0.048;
    else if (weapon.id === 'vanguard-m4') punchKick = 0.015;

    this.aimPunchPitch = punchPitchRad + (weapon.id === 'sovereign-awp' ? punchKick : 0);
    this.aimPunchYaw = punchYawRad;
    this.callbacks.onCameraPunch(punchPitchRad + punchKick, punchYawRad);
    this.viewmodel.fireRecoil(punchKick * 2.5, 0.05);

    if (weapon.id === 'sovereign-awp' && wasScoped) {
      this.resetZoom();
    }
  }

  public handleSecondaryFire(
    camera: THREE.PerspectiveCamera,
    blocks: MapBlockCollider[],
    bots: BotEntity[],
    spatialGrid?: SpatialGrid
  ): void {
    const weapon = this.inventory.getActiveWeapon();

    if (weapon.category === 'melee') {
      this.executeKarambitAttack(camera, bots, blocks, true, spatialGrid);
      return;
    }

    if (weapon.id === 'sovereign-awp') {
      this.zoomStage = (this.zoomStage + 1) % 3;
      let fov = settingsStore.settings.fov;
      let sens = settingsStore.settings.mouseSensitivity;

      if (this.zoomStage === 1) {
        fov = 28;
        sens = settingsStore.settings.mouseSensitivity * 0.38;
      } else if (this.zoomStage === 2) {
        fov = 10;
        sens = settingsStore.settings.mouseSensitivity * 0.16;
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
    isHeavyStab: boolean,
    spatialGrid?: SpatialGrid
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
    camera.getWorldDirection(_forward);
    const playerTeam = settingsStore.settings.faction;
    const callsign = settingsStore.settings.callsign || 'Operator';

    this.callbacks.onFire?.(this.inventory.getActiveWeapon(), false, _forward, isHeavyStab);

    for (const bot of bots) {
      if (bot.isDead || bot.team === playerTeam) continue;

      _botChest.set(bot.mesh.position.x, bot.mesh.position.y + 1.2, bot.mesh.position.z);
      const dist = eye.distanceTo(_botChest);

      if (dist <= 2.2) {
        _toBot.subVectors(_botChest, eye).normalize();
        if (_forward.dot(_toBot) < 0.65) continue;

        const canHit = hasLineOfSight(
          { x: eye.x, y: eye.y, z: eye.z },
          { x: _botChest.x, y: _botChest.y, z: _botChest.z },
          blocks,
          [],
          spatialGrid
        );
        if (!canHit) continue;

        _botForward.set(0, 0, 1).applyEuler(bot.mesh.rotation);
        const isBackstab = _forward.dot(_botForward) > 0.45;

        const dmg = isHeavyStab ? (isBackstab ? 180 : 90) : isBackstab ? 90 : 55;
        bot.health = Math.max(0, bot.health - dmg);

        this.effects.spawnDamagePopup(_botChest, dmg, isBackstab);
        if (bot.health <= 0) {
          bot.isDead = true;
          this.callbacks.onKill(callsign, bot, isBackstab, 'Garam Crimson Karambit', 1500);
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
      const baseSens = settingsStore.settings.mouseSensitivity;
      this.callbacks.onScopeChanged(0, baseFov, baseSens);
    }
  }

  public inspectWeapon(): void {
    this.viewmodel.inspect();
  }
}
