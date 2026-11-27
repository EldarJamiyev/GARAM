import * as THREE from 'three';
import {
  WeaponDef,
  MapBlockCollider,
  SpatialGrid,
  executeTacticalRaycast,
  executeShotgunRaycast,
  hasLineOfSight,
  TargetCollider,
  Ray,
  computeWeaponSpread,
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
  onRadioNotice?: (message: string) => void;
  onBreakableHit?: (blockId: string) => void;
  onSecondaryToggle?: (weaponId: string, mode: 'silencer' | 'burst' | 'shield') => void;
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
  private targetsScratch: TargetCollider[] = [];
  private burstQueueRemaining = 0;
  private burstNextFireMs = 0;
  private burstContext: {
    camera: THREE.PerspectiveCamera;
    currentSpeed: number;
    isGrounded: boolean;
    isCrouching: boolean;
    blocks: MapBlockCollider[];
    bots: BotEntity[];
    spatialGrid?: SpatialGrid;
  } | null = null;
  private breakableManager?: { checkRayHit: (o: THREE.Vector3, d: THREE.Vector3, maxD?: number) => string | null };

  public setBreakableManager(mgr: { checkRayHit: (o: THREE.Vector3, d: THREE.Vector3, maxD?: number) => string | null }): void {
    this.breakableManager = mgr;
  }

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

    if (this.burstQueueRemaining > 0 && now >= this.burstNextFireMs && this.burstContext) {
      const st = this.inventory.getActiveSlotState();
      if (st.currentAmmo > 0 && weapon.secondaryAction === 'toggle_burst') {
        this.burstQueueRemaining--;
        this.burstNextFireMs = now + (60 / (weapon.burstFireRateRpm || 960)) * 1000;
        this.executeBallisticShot(
          this.burstContext.camera,
          this.burstContext.currentSpeed,
          this.burstContext.isGrounded,
          this.burstContext.isCrouching,
          this.burstContext.blocks,
          this.burstContext.bots,
          this.burstContext.spatialGrid,
          true
        );
      } else {
        this.burstQueueRemaining = 0;
      }
    }

    if (this.zoomStage > 0 && (weapon.id === 'sovereign-awp' || weapon.id === 'schmidt-scout')) {
      const scopeEl = this.scopeEl || document.getElementById('sniper-scope');
      if (scopeEl) {
        const blurThreshold = weapon.id === 'schmidt-scout' ? 3.5 : 1.0;
        const nextFilter =
          currentSpeed > blurThreshold
            ? `blur(${Math.min(8, (currentSpeed - blurThreshold) * 2.2).toFixed(1)}px)`
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

    if (weapon.id === 'tactical-shield') {
      return;
    }

    if (weapon.category === 'melee') {
      this.executeKarambitAttack(camera, bots, blocks, false, spatialGrid);
      return;
    }

    const fireIntervalMs = (60 / weapon.fireRateRpm) * 1000;
    if (now - this.lastShotTime < fireIntervalMs) return;

    this.executeBallisticShot(camera, currentSpeed, isGrounded, isCrouching, blocks, bots, spatialGrid, false);
  }

  private executeBallisticShot(
    camera: THREE.PerspectiveCamera,
    currentSpeed: number,
    isGrounded: boolean,
    isCrouching: boolean,
    blocks: MapBlockCollider[],
    bots: BotEntity[],
    spatialGrid: SpatialGrid | undefined,
    isBurstFollowup: boolean
  ): void {
    const now = performance.now();
    const weapon = this.inventory.getActiveWeapon();

    this.lastShotTime = now;
    this.inventory.onFireExecuted(now);

    const silenced = this.inventory.isSilencerAttached(weapon.id);
    const effectiveDamage = silenced ? weapon.damage : weapon.damage + (weapon.unsilencedDamageBonus || 0);
    this.audio.playGunshot(weapon.id, undefined, undefined, undefined, silenced);

    const wasScoped = this.zoomStage > 0;

    camera.getWorldDirection(_forward);
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _up.setFromMatrixColumn(camera.matrixWorld, 1);
    this.effects.spawnShellCasing(camera.position, _forward, _right, weapon.id);
    this.audio.playShellClink(0.38 + Math.random() * 0.12);

    const dynamicSpread = computeWeaponSpread(weapon, currentSpeed, isGrounded, isCrouching, wasScoped, this.consecutiveShots);
    const spreadX = (Math.random() - 0.5) * dynamicSpread;
    const spreadY = (Math.random() - 0.5) * dynamicSpread;

    _rayDir
      .copy(_forward)
      .addScaledVector(_right, spreadX)
      .addScaledVector(_up, spreadY)
      .normalize();

    const eyePos = camera.position;
    const playerTeam = settingsStore.settings.faction;
    const callsign = settingsStore.settings.callsign || 'Operator';

    this.callbacks.onFire?.(weapon, wasScoped, _rayDir, false);

    // Reuse TargetCollider scratch array to avoid per-shot GC allocations
    this.targetsScratch.length = bots.length;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      let t = this.targetsScratch[i];
      if (!t) {
        t = {
          id: b.id,
          name: b.name,
          team: b.team,
          center: { x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z },
          hasHelmet: b.hasHelmet,
          armor: b.armor,
          isDead: b.isDead,
          isCrouched: false,
          yaw: b.mesh.rotation.y,
          hitboxes: undefined,
        };
        this.targetsScratch[i] = t;
      } else {
        t.id = b.id;
        t.name = b.name;
        t.team = b.team;
        t.center.x = b.mesh.position.x;
        t.center.y = b.mesh.position.y;
        t.center.z = b.mesh.position.z;
        t.hasHelmet = b.hasHelmet;
        t.armor = b.armor;
        t.isDead = b.isDead;
        t.yaw = b.mesh.rotation.y;
      }
      t.isCrouched = !!(b as unknown as { isCrouching?: boolean }).isCrouching;
      t.hitboxes = b.rig?.getWorldHitboxes();
    }

    const brokenId = this.breakableManager?.checkRayHit(eyePos, _rayDir, 60);
    if (brokenId) {
      this.callbacks.onBreakableHit?.(brokenId);
    }

    if (weapon.pelletCount && weapon.pelletCount > 1) {
      const pelletOutcomes = executeShotgunRaycast(
        { x: eyePos.x, y: eyePos.y, z: eyePos.z },
        camera.rotation.y,
        camera.rotation.x,
        weapon.pelletCount,
        weapon.pelletSpreadRad || 0.065,
        effectiveDamage,
        weapon.armorPenetration,
        weapon.penetrationPower,
        blocks,
        this.targetsScratch,
        weapon.damageDropoffPer10m || 0.65,
        spatialGrid,
        weapon.headDamageMultiplier,
        Math.floor(now) & 0xffff
      );

      const damageByBot = new Map<BotEntity, { hp: number; armor: number; headshot: boolean; hitPt: THREE.Vector3 }>();
      for (const p of pelletOutcomes) {
        _terminalPoint.set(
          eyePos.x + p.rayDirection.x * 55,
          eyePos.y + p.rayDirection.y * 55,
          eyePos.z + p.rayDirection.z * 55
        );
        for (const hit of p.hits) {
          _hitVec.set(hit.point.x, hit.point.y, hit.point.z);
          _terminalPoint.copy(_hitVec);
          if (hit.targetId) {
            const victim = bots.find((b) => b.id === hit.targetId);
            if (victim && !victim.isDead && victim.team !== playerTeam) {
              const prev = damageByBot.get(victim) || { hp: 0, armor: 0, headshot: false, hitPt: _hitVec.clone() };
              prev.hp += hit.awardedDamage;
              prev.armor += hit.armorDamage;
              if (hit.isHeadshot) prev.headshot = true;
              prev.hitPt.copy(_hitVec);
              damageByBot.set(victim, prev);
            }
          } else {
            _hitNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
            this.effects.spawnBulletDecal(_hitVec, _hitNormal, hit.material);
            this.effects.spawnImpactBurst(_hitVec, _hitNormal, hit.material);
          }
        }
        this.effects.spawnTracer(eyePos, _terminalPoint, weapon.id, _right);
      }

      damageByBot.forEach((agg, victim) => {
        if (agg.headshot) {
          this.audio.playHeadshotDink();
        } else {
          this.audio.playBodyHitCrunch(agg.hitPt, eyePos, blocks);
        }
        _reverseNormal.copy(_rayDir).negate();
        this.effects.spawnBloodBurst(agg.hitPt, _reverseNormal, agg.headshot);
        victim.rig?.triggerFlinch();
        this.callbacks.onHitmarker?.(agg.headshot);
        victim.armor = Math.max(0, victim.armor - agg.armor);
        victim.health = Math.max(0, victim.health - agg.hp);
        this.effects.spawnDamagePopup(agg.hitPt, Math.round(agg.hp), agg.headshot);
        if (victim.health <= 0) {
          victim.isDead = true;
          this.callbacks.onKill(callsign, victim, agg.headshot, weapon.name, weapon.killReward);
        }
      });
    } else {
      const sharedRay: Ray = {
        origin: { x: eyePos.x, y: eyePos.y, z: eyePos.z },
        direction: { x: _rayDir.x, y: _rayDir.y, z: _rayDir.z },
      };

      const hits = executeTacticalRaycast(
        sharedRay,
        effectiveDamage,
        weapon.armorPenetration,
        weapon.penetrationPower,
        250,
        blocks,
        this.targetsScratch,
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

              _reverseNormal.copy(_rayDir).negate();
              this.effects.spawnBloodBurst(_hitVec, _reverseNormal, !!hit.isHeadshot);
              const wallHits = executeTacticalRaycast(
                {
                  origin: { x: _hitVec.x + _rayDir.x * 0.15, y: _hitVec.y + _rayDir.y * 0.15, z: _hitVec.z + _rayDir.z * 0.15 },
                  direction: { x: _rayDir.x, y: _rayDir.y, z: _rayDir.z },
                },
                1,
                0,
                0,
                3.5,
                blocks,
                [],
                1.0,
                spatialGrid
              );
              if (wallHits.length > 0 && !wallHits[0].targetId) {
                _exitVec.set(wallHits[0].point.x, wallHits[0].point.y, wallHits[0].point.z);
                _hitNormal.set(wallHits[0].normal.x, wallHits[0].normal.y, wallHits[0].normal.z);
                this.effects.spawnBloodDecal(_exitVec, _hitNormal, !!hit.isHeadshot);
              } else {
                const floorHits = executeTacticalRaycast(
                  {
                    origin: { x: _hitVec.x + _rayDir.x * 0.45, y: _hitVec.y, z: _hitVec.z + _rayDir.z * 0.45 },
                    direction: { x: 0, y: -1, z: 0 },
                  },
                  1,
                  0,
                  0,
                  2.5,
                  blocks,
                  [],
                  1.0,
                  spatialGrid
                );
                if (floorHits.length > 0 && !floorHits[0].targetId) {
                  _exitVec.set(floorHits[0].point.x, floorHits[0].point.y, floorHits[0].point.z);
                  _hitNormal.set(floorHits[0].normal.x, floorHits[0].normal.y, floorHits[0].normal.z);
                  this.effects.spawnBloodDecal(_exitVec, _hitNormal, !!hit.isHeadshot);
                }
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
            this.effects.spawnImpactBurst(_hitVec, _hitNormal, hit.material);
            this.audio.playSurfaceImpact(hit.material as 'CONCRETE' | 'WOOD_THIN' | 'METAL_SHEET', _hitVec, eyePos, blocks);

            if (hit.exitPoint) {
              _exitVec.set(hit.exitPoint.x, hit.exitPoint.y, hit.exitPoint.z);
              _reverseNormal.set(-hit.normal.x, -hit.normal.y, -hit.normal.z);
              this.effects.spawnBulletDecal(_exitVec, _reverseNormal, hit.material);
            }
          }
        }
      }

      this.effects.spawnTracer(eyePos, _terminalPoint, weapon.id, _right);
    }

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
    if (weapon.id === 'sovereign-awp' || weapon.id === 'leone-m3') punchKick = 0.075;
    else if (weapon.id === 'schmidt-scout' || weapon.id === 'xm1014') punchKick = 0.056;
    else if (weapon.id === 'desert-eagle') punchKick = 0.048;
    else if (weapon.id === 'vanguard-m4') punchKick = 0.015;

    this.aimPunchPitch = punchPitchRad + (weapon.id === 'sovereign-awp' ? punchKick : 0);
    this.aimPunchYaw = punchYawRad;
    this.callbacks.onCameraPunch(punchPitchRad + punchKick, punchYawRad);
    if (weapon.isDualWield) {
      this.viewmodel.fireDualElitesShot();
    } else {
      this.viewmodel.fireRecoil(punchKick * 2.5, 0.05);
    }

    // Queue 3-round burst follow-ups on Glock-18 & Clarion FAMAS
    if (!isBurstFollowup && weapon.secondaryAction === 'toggle_burst' && this.inventory.burstModeWeapons.has(weapon.id)) {
      this.burstQueueRemaining = Math.max(0, (weapon.burstCount || 3) - 1);
      this.burstNextFireMs = now + (60 / (weapon.burstFireRateRpm || 960)) * 1000;
      this.burstContext = { camera, currentSpeed, isGrounded, isCrouching, blocks, bots, spatialGrid };
    }

    if ((weapon.id === 'sovereign-awp' || weapon.id === 'schmidt-scout') && wasScoped) {
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

    if (weapon.secondaryAction === 'toggle_silencer') {
      const attached = this.inventory.toggleSilencer(weapon.id);
      this.viewmodel.setSilencerAttached(attached);
      this.audio.playSilencerToggle(attached);
      this.callbacks.onSecondaryToggle?.(weapon.id, 'silencer');
      this.callbacks.onRadioNotice?.(
        attached ? `${weapon.name}: Suppressor Attached` : `${weapon.name}: Suppressor Detached`
      );
      return;
    }

    if (weapon.secondaryAction === 'toggle_burst') {
      const burstOn = this.inventory.toggleBurstMode(weapon.id);
      this.callbacks.onSecondaryToggle?.(weapon.id, 'burst');
      this.callbacks.onRadioNotice?.(
        burstOn ? `${weapon.name}: 3-Round Burst Mode` : `${weapon.name}: Standard Fire Mode`
      );
      return;
    }

    if (weapon.secondaryAction === 'raise_shield') {
      const next = !this.viewmodel.isShieldRaised;
      this.viewmodel.setShieldRaised(next);
      this.callbacks.onSecondaryToggle?.(weapon.id, 'shield');
      this.callbacks.onRadioNotice?.(next ? 'Tactical Shield: BALLISTIC GUARD UP' : 'Tactical Shield: LOWERED');
      return;
    }

    if (weapon.category === 'melee') {
      this.executeKarambitAttack(camera, bots, blocks, true, spatialGrid);
      return;
    }

    if (weapon.id === 'sovereign-awp' || weapon.id === 'schmidt-scout') {
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
    const brokenId = this.breakableManager?.checkRayHit(eye, _forward, 2.5);
    if (brokenId) {
      this.callbacks.onBreakableHit?.(brokenId);
    }

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
    const scopeEl = this.scopeEl || document.getElementById('sniper-scope');
    if (scopeEl && this.lastScopeBlur !== 'none') {
      scopeEl.style.filter = 'none';
      this.lastScopeBlur = 'none';
    }
  }

  public resetRoundCombatState(): void {
    this.resetZoom();
    this.aimPunchPitch = 0;
    this.aimPunchYaw = 0;
    this.consecutiveShots = 0;
    this.lastShotTime = 0;
    this.nextMeleeTime = 0;
    this.burstQueueRemaining = 0;
    this.burstContext = null;
    this.viewmodel.setShieldRaised(false);
  }

  public inspectWeapon(): void {
    this.viewmodel.inspect();
  }
}
