import * as THREE from 'three';
import {
  MapBlockCollider,
  AABBCollider,
  MapBounds,
  SmokeOccluder,
  SpatialGrid,
  hasLineOfSight,
  stepGrenadePhysics,
} from '@garam/shared';
import { ProceduralAudio } from '../audio/ProceduralAudio.js';
import { BotEntity } from '../maps/DeCitadelMap.js';
import { AssetManager } from '../render/AssetManager.js';

export type UtilityType = 'smoke-grenade' | 'flashbang' | 'he-grenade' | 'molotov';
export type ThrowMode = 'long' | 'medium' | 'short';

export interface MolotovTickResult {
  nextAccumulator: number;
  ticks: number;
  damage: number;
}

/**
 * Pure FPS-independent burn tick accumulator for Molotov/Incendiary zones.
 * Emits discrete 10 HP ticks every 0.25s (= 40 DPS) regardless of frame rate (30–240+ FPS),
 * eliminating sub-integer rounding loss at high refresh rates.
 */
export function stepMolotovBurnAccumulator(
  accumulator: number,
  dt: number,
  tickInterval = 0.25,
  damagePerTick = 10
): MolotovTickResult {
  const safeDt = Math.max(0, dt);
  let nextAccumulator = accumulator + safeDt;
  let ticks = 0;
  while (nextAccumulator >= tickInterval) {
    nextAccumulator -= tickInterval;
    ticks++;
  }
  return {
    nextAccumulator,
    ticks,
    damage: ticks * damagePerTick,
  };
}

interface ThrownGrenade {
  id: string;
  type: UtilityType;
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  fuseTime: number;
  isArmed: boolean;
  bounces: number;
}

interface SmokePuffData {
  offset: THREE.Vector3;
  targetScale: number;
  rotSpeed: number;
  rotationZ: number;
}

export interface ActiveSmokeCloud {
  id: string;
  center: THREE.Vector3;
  radius: number;
  puffs: SmokePuffData[];
  instancedMesh: THREE.InstancedMesh;
  spawnTime: number;
  duration: number;
  clearedHoleUntil: number;
}

interface MolotovFireZone {
  id: string;
  center: THREE.Vector3;
  radius: number;
  mesh: THREE.Object3D;
  light: THREE.PointLight | null;
  spawnTime: number;
  duration: number;
  burnAccum: number;
}

export interface UtilityCallbacks {
  onFlashPlayer: (durationSec: number) => void;
  onPlayerDamage: (damage: number) => void;
  onKillfeed: (text: string) => void;
  onFlashbangExploded?: (flashPos: THREE.Vector3) => void;
}

const _camForward = new THREE.Vector3();
const _toFlash = new THREE.Vector3();
const _botEye = new THREE.Vector3();
const _stepPos = { x: 0, y: 0, z: 0 };
const _stepVel = { x: 0, y: 0, z: 0 };

export class UtilityManager {
  private scene: THREE.Scene;
  private audio: ProceduralAudio;
  private callbacks: UtilityCallbacks;

  private thrownGrenades: ThrownGrenade[] = [];
  private activeSmokeClouds: ActiveSmokeCloud[] = [];
  private activeFireZones: MolotovFireZone[] = [];

  // Reusable materials, geometries & pooled PointLights (max 3 active fire lights to avoid shader stalls)
  private smokeMaterial: THREE.MeshStandardMaterial;
  private grenadeMat: THREE.MeshStandardMaterial;
  private fireMat: THREE.MeshBasicMaterial;
  private flameTongueMat: THREE.MeshBasicMaterial;
  private sharedPuffGeo: THREE.SphereGeometry;
  private sharedGrenadeGeo: THREE.CylinderGeometry;
  private sharedFireGeo: THREE.CircleGeometry;
  private dummyPuff: THREE.Object3D = new THREE.Object3D();
  private lightPool: Array<{ light: THREE.PointLight; inUse: boolean }> = [];
  private mapBounds?: MapBounds;

  constructor(scene: THREE.Scene, audio: ProceduralAudio, callbacks: UtilityCallbacks) {
    this.scene = scene;
    this.audio = audio;
    this.callbacks = callbacks;
    this.sharedPuffGeo = new THREE.SphereGeometry(1.2, 10, 8);
    this.sharedGrenadeGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.16, 12);
    this.sharedFireGeo = new THREE.CircleGeometry(3.4, 24);

    // Pre-allocate 3 pooled fire PointLights once at startup
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xff6611, 0, 12);
      light.visible = false;
      this.scene.add(light);
      this.lightPool.push({ light, inUse: false });
    }

    const smokeCanvas = document.createElement('canvas');
    smokeCanvas.width = 128;
    smokeCanvas.height = 128;
    const sCtx = smokeCanvas.getContext('2d')!;
    const grad = sCtx.createRadialGradient(64, 64, 8, 64, 64, 60);
    grad.addColorStop(0, 'rgba(235, 228, 216, 0.96)'); // CS2 warm sunlit cream core
    grad.addColorStop(0.45, 'rgba(185, 192, 202, 0.85)'); // mid-tone dispersion
    grad.addColorStop(0.85, 'rgba(114, 128, 145, 0.38)'); // cool slate shadow edge
    grad.addColorStop(1, 'rgba(100, 110, 125, 0.0)');
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 128, 128);

    const smokeTex = new THREE.CanvasTexture(smokeCanvas);

    this.smokeMaterial = new THREE.MeshStandardMaterial({
      map: smokeTex,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      roughness: 0.95,
      metalness: 0.0,
      color: 0xebe4d8,
    });

    this.grenadeMat = new THREE.MeshStandardMaterial({
      color: 0x243229,
      roughness: 0.5,
      metalness: 0.6,
    });

    this.fireMat = new THREE.MeshBasicMaterial({
      color: 0xff4408,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    });

    const flameCanvas = document.createElement('canvas');
    flameCanvas.width = 128;
    flameCanvas.height = 256;
    const fCtx = flameCanvas.getContext('2d')!;
    const fGrad = fCtx.createLinearGradient(64, 256, 64, 0);
    fGrad.addColorStop(0.0, 'rgba(255, 245, 200, 0.96)');
    fGrad.addColorStop(0.3, 'rgba(255, 130, 20, 0.88)');
    fGrad.addColorStop(0.7, 'rgba(210, 40, 10, 0.65)');
    fGrad.addColorStop(1.0, 'rgba(100, 10, 0, 0.0)');
    fCtx.fillStyle = fGrad;
    fCtx.fillRect(0, 0, 128, 256);
    const flameTex = new THREE.CanvasTexture(flameCanvas);
    this.flameTongueMat = new THREE.MeshBasicMaterial({
      map: flameTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  private acquireFireLight(pos: THREE.Vector3): THREE.PointLight | null {
    const slot = this.lightPool.find((p) => !p.inUse);
    if (!slot) return null;
    slot.inUse = true;
    slot.light.position.set(pos.x, pos.y + 1.2, pos.z);
    slot.light.intensity = 2.2;
    slot.light.visible = true;
    return slot.light;
  }

  private releaseFireLight(light: THREE.PointLight | null): void {
    if (!light) return;
    const slot = this.lightPool.find((p) => p.light === light);
    if (slot) {
      slot.inUse = false;
      slot.light.intensity = 0;
      slot.light.visible = false;
    }
  }

  public setMapBounds(bounds: MapBounds): void {
    this.mapBounds = bounds;
  }

  public resetRound(): void {
    for (const g of this.thrownGrenades) {
      this.scene.remove(g.mesh);
    }
    this.thrownGrenades = [];

    for (const smoke of this.activeSmokeClouds) {
      this.scene.remove(smoke.instancedMesh);
      (smoke.instancedMesh.material as THREE.Material).dispose();
      smoke.instancedMesh.dispose();
    }
    this.activeSmokeClouds = [];

    for (const fire of this.activeFireZones) {
      this.scene.remove(fire.mesh);
      this.releaseFireLight(fire.light);
    }
    this.activeFireZones = [];
  }

  public throwGrenade(
    type: UtilityType,
    eyePos: THREE.Vector3,
    viewDir: THREE.Vector3,
    playerVelocity: THREE.Vector3,
    mode: ThrowMode
  ): void {
    let speed = 18.0;
    if (mode === 'short') speed = 7.0;
    else if (mode === 'medium') speed = 12.5;

    const initialVelocity = viewDir
      .clone()
      .multiplyScalar(speed)
      .addScaledVector(playerVelocity, 0.7);

    const grenadeGroup = new THREE.Group();
    const fallbackMesh = new THREE.Mesh(this.sharedGrenadeGeo, this.grenadeMat);
    fallbackMesh.castShadow = true;
    grenadeGroup.add(fallbackMesh);
    grenadeGroup.position.copy(eyePos).addScaledVector(viewDir, 0.5);
    this.scene.add(grenadeGroup);

    void AssetManager.getInstance()
      .loadModel('/models/grenade.glb', {
        targetLength: 0.14,
        centerPivot: true,
        envMapIntensity: 1.5,
      })
      .then((glb) => {
        if (!glb || !grenadeGroup.parent) return;
        fallbackMesh.visible = false;
        grenadeGroup.add(glb);
      });

    const mesh = grenadeGroup;

    this.thrownGrenades.push({
      id: Math.random().toString(36).substring(2, 9),
      type,
      mesh,
      position: mesh.position.clone(),
      velocity: initialVelocity,
      fuseTime: type === 'molotov' ? 5.0 : 1.6,
      isArmed: true,
      bounces: 0,
    });
  }

  public update(
    dt: number,
    _colliders: AABBCollider[],
    blocks: MapBlockCollider[],
    playerPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    bots: BotEntity[],
    spatialGrid?: SpatialGrid
  ): void {
    const now = performance.now();

    // 1. Simulate Thrown Grenades via shared 3D closest-point AABB physics (multi-tier y=0.0, 2.1, 4.9 parity)
    for (let i = this.thrownGrenades.length - 1; i >= 0; i--) {
      const g = this.thrownGrenades[i];
      g.fuseTime -= dt;

      // Subtle aerodynamic drag matching CS2 throw arc feel
      const drag = Math.max(0.5, 1 - 0.14 * dt);
      _stepPos.x = g.position.x;
      _stepPos.y = g.position.y;
      _stepPos.z = g.position.z;
      _stepVel.x = g.velocity.x * drag;
      _stepVel.y = g.velocity.y;
      _stepVel.z = g.velocity.z * drag;

      const stepRes = stepGrenadePhysics(
        _stepPos,
        _stepVel,
        dt,
        blocks,
        0.08,
        0.45,
        15.5,
        spatialGrid,
        this.mapBounds
      );

      g.position.set(_stepPos.x, _stepPos.y, _stepPos.z);
      g.velocity.set(_stepVel.x, _stepVel.y, _stepVel.z);

      if (stepRes.hitGround && g.type === 'molotov') {
        this.detonateMolotov(g.position);
        this.scene.remove(g.mesh);
        this.thrownGrenades.splice(i, 1);
        continue;
      }

      if (stepRes.bounced && g.bounces < 4) {
        g.bounces++;
        this.audio.playFootstep();
      }

      g.mesh.position.copy(g.position);
      g.mesh.rotation.x += g.velocity.z * dt * 2.5;
      g.mesh.rotation.z += g.velocity.x * dt * 2.5;

      if (g.fuseTime <= 0) {
        this.detonateGrenade(g, blocks, playerPos, camera, bots, spatialGrid);
        this.scene.remove(g.mesh);
        this.thrownGrenades.splice(i, 1);
      }
    }

    // 2. Update Volumetric Smoke Clouds
    for (let i = this.activeSmokeClouds.length - 1; i >= 0; i--) {
      const smoke = this.activeSmokeClouds[i];
      const age = (now - smoke.spawnTime) / 1000;

      if (age > smoke.duration) {
        this.scene.remove(smoke.instancedMesh);
        (smoke.instancedMesh.material as THREE.Material).dispose();
        smoke.instancedMesh.dispose();
        this.activeSmokeClouds.splice(i, 1);
        continue;
      }

      const scale = age < 0.8 ? age / 0.8 : 1.0;
      const opacity = age > smoke.duration - 2.0 ? 0.92 * ((smoke.duration - age) / 2.0) : 0.92;
      const isCleared = now < smoke.clearedHoleUntil;
      smoke.instancedMesh.visible = !isCleared;

      if (!isCleared) {
        (smoke.instancedMesh.material as THREE.MeshStandardMaterial).opacity = opacity;
        for (let p = 0; p < smoke.puffs.length; p++) {
          const puff = smoke.puffs[p];
          puff.rotationZ += puff.rotSpeed * dt;
          this.dummyPuff.position.copy(puff.offset);
          this.dummyPuff.rotation.set(0, 0, puff.rotationZ);
          this.dummyPuff.scale.setScalar(puff.targetScale * scale);
          this.dummyPuff.updateMatrix();
          smoke.instancedMesh.setMatrixAt(p, this.dummyPuff.matrix);
        }
        smoke.instancedMesh.instanceMatrix.needsUpdate = true;
      }
    }

    // 3. Update Molotov Fire Zones (FPS-independent 0.25s discrete burn ticks = 40 DPS at any refresh rate)
    for (let i = this.activeFireZones.length - 1; i >= 0; i--) {
      const fire = this.activeFireZones[i];
      const age = (now - fire.spawnTime) / 1000;

      if (age > fire.duration) {
        this.scene.remove(fire.mesh);
        this.releaseFireLight(fire.light);
        this.activeFireZones.splice(i, 1);
        continue;
      }

      if (fire.light) {
        fire.light.intensity = 1.8 + Math.sin(now * 0.02) * 0.6;
      }

      const burnStep = stepMolotovBurnAccumulator(fire.burnAccum, dt, 0.25, 10);
      fire.burnAccum = burnStep.nextAccumulator;

      if (burnStep.damage > 0) {
        const dxP = playerPos.x - fire.center.x;
        const dzP = playerPos.z - fire.center.z;
        if (dxP * dxP + dzP * dzP <= fire.radius * fire.radius && Math.abs(playerPos.y - fire.center.y) <= 2.2) {
          this.callbacks.onPlayerDamage(burnStep.damage);
        }

        for (const bot of bots) {
          if (bot.isDead) continue;
          const dxB = bot.mesh.position.x - fire.center.x;
          const dzB = bot.mesh.position.z - fire.center.z;
          if (
            dxB * dxB + dzB * dzB <= fire.radius * fire.radius &&
            Math.abs(bot.mesh.position.y - fire.center.y) <= 2.2
          ) {
            bot.health = Math.max(0, bot.health - burnStep.damage);
            if (bot.health <= 0) {
              bot.isDead = true;
              this.callbacks.onKillfeed(`🔥 Incendiary eliminated ${bot.name}`);
            }
          }
        }
      }
    }
  }

  private detonateGrenade(
    g: ThrownGrenade,
    blocks: MapBlockCollider[],
    playerPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    bots: BotEntity[],
    spatialGrid?: SpatialGrid
  ): void {
    if (g.type === 'smoke-grenade') {
      this.detonateSmoke(g.position);
    } else if (g.type === 'flashbang') {
      this.detonateFlashbang(g.position, blocks, camera, bots, spatialGrid);
    } else if (g.type === 'he-grenade') {
      this.detonateHE(g.position, blocks, playerPos, bots, spatialGrid);
    } else if (g.type === 'molotov') {
      this.detonateMolotov(g.position);
    }
  }

  private detonateSmoke(pos: THREE.Vector3): void {
    this.audio.playSmokeDeploy();

    for (let i = this.activeFireZones.length - 1; i >= 0; i--) {
      const f = this.activeFireZones[i];
      if (pos.distanceTo(f.center) <= 4.8) {
        this.audio.playKnifeSlash();
        this.scene.remove(f.mesh);
        this.releaseFireLight(f.light);
        this.activeFireZones.splice(i, 1);
        this.callbacks.onKillfeed('💨 Smoke extinguished fire zone');
      }
    }

    const puffs: SmokePuffData[] = [];
    const mat = this.smokeMaterial.clone();
    const instancedMesh = new THREE.InstancedMesh(this.sharedPuffGeo, mat, 48);
    instancedMesh.position.copy(pos);

    for (let p = 0; p < 48; p++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.2) * Math.PI;
      const r = Math.random() * 3.6;

      const offset = new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        Math.max(0.4, Math.abs(r * Math.cos(phi))),
        r * Math.sin(phi) * Math.sin(theta)
      );

      this.dummyPuff.position.copy(offset);
      this.dummyPuff.rotation.set(0, 0, Math.random() * Math.PI * 2);
      this.dummyPuff.scale.setScalar(0.001);
      this.dummyPuff.updateMatrix();
      instancedMesh.setMatrixAt(p, this.dummyPuff.matrix);

      puffs.push({
        offset,
        targetScale: 1.4 + Math.random() * 0.6,
        rotSpeed: (Math.random() - 0.5) * 0.6,
        rotationZ: Math.random() * Math.PI * 2,
      });
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(instancedMesh);

    this.activeSmokeClouds.push({
      id: Math.random().toString(36).substring(2, 9),
      center: pos.clone(),
      radius: 4.6,
      puffs,
      instancedMesh,
      spawnTime: performance.now(),
      duration: 18.0,
      clearedHoleUntil: 0,
    });
  }

  private detonateFlashbang(
    flashPos: THREE.Vector3,
    blocks: MapBlockCollider[],
    camera: THREE.PerspectiveCamera,
    bots: BotEntity[],
    spatialGrid?: SpatialGrid
  ): void {
    this.audio.playFlashbangDetonate();
    this.callbacks.onFlashbangExploded?.(flashPos);

    const eyePos = camera.position;
    const distToPlayer = eyePos.distanceTo(flashPos);
    const smokeOccluders = this.getActiveSmokeOccluders();

    if (distToPlayer <= 32) {
      const hasLOS = hasLineOfSight(eyePos, flashPos, blocks, smokeOccluders, spatialGrid);
      if (hasLOS) {
        camera.getWorldDirection(_camForward);
        _toFlash.subVectors(flashPos, eyePos).normalize();
        const dot = _camForward.dot(_toFlash);
        const distFactor = Math.max(0, 1 - distToPlayer / 32);
        const blindDuration = (0.35 + 2.85 * Math.pow(Math.max(0, dot), 1.6)) * distFactor;

        if (blindDuration > 0.15) {
          this.callbacks.onFlashPlayer(blindDuration);
        }
      }
    }

    for (const bot of bots) {
      if (bot.isDead) continue;
      _botEye.set(bot.mesh.position.x, bot.mesh.position.y + 1.68, bot.mesh.position.z);
      const dist = _botEye.distanceTo(flashPos);
      if (dist <= 28) {
        if (hasLineOfSight(_botEye, flashPos, blocks, smokeOccluders, spatialGrid)) {
          bot.lastShotTime = performance.now() + 2500;
        }
      }
    }
  }

  private detonateHE(
    pos: THREE.Vector3,
    blocks: MapBlockCollider[],
    playerPos: THREE.Vector3,
    bots: BotEntity[],
    spatialGrid?: SpatialGrid
  ): void {
    this.audio.playGrenadeExplosion();

    const now = performance.now();
    for (const smoke of this.activeSmokeClouds) {
      if (pos.distanceTo(smoke.center) <= 5.8) {
        smoke.clearedHoleUntil = now + 2600;
        this.callbacks.onKillfeed('💥 HE Grenade dispersed tactical smoke');
      }
    }

    const distToPlayer = playerPos.distanceTo(pos);
    if (distToPlayer <= 7.2) {
      if (hasLineOfSight(playerPos, pos, blocks, [], spatialGrid)) {
        const damageRatio = Math.max(0, 1 - distToPlayer / 7.2);
        const dmg = Math.round(damageRatio * 85);
        this.callbacks.onPlayerDamage(dmg);
      }
    }

    for (const bot of bots) {
      if (bot.isDead) continue;
      const dist = bot.mesh.position.distanceTo(pos);
      if (dist <= 7.2) {
        if (hasLineOfSight(bot.mesh.position, pos, blocks, [], spatialGrid)) {
          const damageRatio = Math.max(0, 1 - dist / 7.2);
          const dmg = Math.round(damageRatio * 85);
          bot.health = Math.max(0, bot.health - dmg);
          if (bot.health <= 0) {
            bot.isDead = true;
            this.callbacks.onKillfeed(`💥 HE Grenade eliminated ${bot.name}`);
          }
        }
      }
    }
  }

  private detonateMolotov(pos: THREE.Vector3): void {
    this.audio.playGrenadeExplosion();

    const radius = 3.4;
    const fireGroup = new THREE.Group();
    fireGroup.position.set(pos.x, Math.max(0.04, pos.y + 0.04), pos.z);

    // Ground scorched fire pool decal
    const fireDecal = new THREE.Mesh(this.sharedFireGeo, this.fireMat);
    fireDecal.rotation.x = -Math.PI / 2;
    fireGroup.add(fireDecal);

    // Multi-tongue vertical animated flame billboards
    const flameGeo = new THREE.PlaneGeometry(1.4, 2.2);
    flameGeo.translate(0, 1.1, 0);
    for (let f = 0; f < 14; f++) {
      const angle = (f / 14) * Math.PI * 2;
      const r = 0.5 + Math.random() * (radius - 0.9);
      const tongue = new THREE.Mesh(flameGeo, this.flameTongueMat);
      tongue.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      tongue.rotation.y = Math.random() * Math.PI;
      fireGroup.add(tongue);
    }

    this.scene.add(fireGroup);

    const light = this.acquireFireLight(pos);

    this.activeFireZones.push({
      id: Math.random().toString(36).substring(2, 9),
      center: pos.clone(),
      radius,
      mesh: fireGroup,
      light,
      spawnTime: performance.now(),
      duration: 7.0,
      burnAccum: 0,
    });
  }

  public getActiveSmokeOccluders(): SmokeOccluder[] {
    const now = performance.now();
    const occluders: SmokeOccluder[] = [];

    for (const smoke of this.activeSmokeClouds) {
      if (now < smoke.clearedHoleUntil) continue;
      occluders.push({
        center: { x: smoke.center.x, y: smoke.center.y, z: smoke.center.z },
        radius: smoke.radius,
      });
    }

    return occluders;
  }
}
