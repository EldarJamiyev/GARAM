import * as THREE from 'three';
import {
  MapBlockCollider,
  AABBCollider,
  SmokeOccluder,
  SpatialGrid,
  hasLineOfSight,
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
  mesh: THREE.Mesh;
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
const _nextPos = new THREE.Vector3();

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
  private sharedPuffGeo: THREE.SphereGeometry;
  private sharedGrenadeGeo: THREE.CylinderGeometry;
  private sharedFireGeo: THREE.CircleGeometry;
  private dummyPuff: THREE.Object3D = new THREE.Object3D();
  private lightPool: Array<{ light: THREE.PointLight; inUse: boolean }> = [];

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
    grad.addColorStop(0, 'rgba(210, 215, 222, 0.95)');
    grad.addColorStop(0.45, 'rgba(180, 186, 194, 0.82)');
    grad.addColorStop(0.85, 'rgba(150, 155, 162, 0.35)');
    grad.addColorStop(1, 'rgba(140, 145, 150, 0.0)');
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
      color: 0xd8dde3,
    });

    this.grenadeMat = new THREE.MeshStandardMaterial({
      color: 0x243229,
      roughness: 0.5,
      metalness: 0.6,
    });

    this.fireMat = new THREE.MeshBasicMaterial({
      color: 0xff5511,
      transparent: true,
      opacity: 0.75,
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
    colliders: AABBCollider[],
    blocks: MapBlockCollider[],
    playerPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    bots: BotEntity[],
    spatialGrid?: SpatialGrid
  ): void {
    const now = performance.now();

    // 1. Simulate Thrown Grenades
    for (let i = this.thrownGrenades.length - 1; i >= 0; i--) {
      const g = this.thrownGrenades[i];
      g.fuseTime -= dt;

      g.velocity.y -= 15.5 * dt;
      g.velocity.x *= 1 - 0.25 * dt;
      g.velocity.z *= 1 - 0.25 * dt;

      _nextPos.copy(g.position).addScaledVector(g.velocity, dt);
      let didBounce = false;

      if (_nextPos.y <= 0.08) {
        _nextPos.y = 0.08;
        g.velocity.y = -g.velocity.y * 0.42;
        g.velocity.x *= 0.72;
        g.velocity.z *= 0.72;
        didBounce = true;

        if (g.type === 'molotov') {
          this.detonateMolotov(_nextPos);
          this.scene.remove(g.mesh);
          this.thrownGrenades.splice(i, 1);
          continue;
        }
      }

      for (const b of colliders) {
        if (
          _nextPos.x >= b.minX - 0.08 &&
          _nextPos.x <= b.maxX + 0.08 &&
          _nextPos.y >= b.minY &&
          _nextPos.y <= b.maxY &&
          _nextPos.z >= b.minZ - 0.08 &&
          _nextPos.z <= b.maxZ + 0.08
        ) {
          const dxMin = Math.abs(_nextPos.x - b.minX);
          const dxMax = Math.abs(_nextPos.x - b.maxX);
          const dzMin = Math.abs(_nextPos.z - b.minZ);
          const dzMax = Math.abs(_nextPos.z - b.maxZ);
          const min = Math.min(dxMin, dxMax, dzMin, dzMax);

          if (min === dxMin || min === dxMax) {
            g.velocity.x = -g.velocity.x * 0.45;
          } else {
            g.velocity.z = -g.velocity.z * 0.45;
          }
          didBounce = true;
          break;
        }
      }

      if (didBounce && g.bounces < 4) {
        g.bounces++;
        this.audio.playFootstep();
      }

      g.position.copy(_nextPos);
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
    const instancedMesh = new THREE.InstancedMesh(this.sharedPuffGeo, mat, 28);
    instancedMesh.position.copy(pos);

    for (let p = 0; p < 28; p++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.2) * Math.PI;
      const r = Math.random() * 2.8;

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
    const fireMesh = new THREE.Mesh(this.sharedFireGeo, this.fireMat);
    fireMesh.rotation.x = -Math.PI / 2;
    fireMesh.position.set(pos.x, Math.max(0.04, pos.y + 0.04), pos.z);
    this.scene.add(fireMesh);

    const light = this.acquireFireLight(pos);

    this.activeFireZones.push({
      id: Math.random().toString(36).substring(2, 9),
      center: pos.clone(),
      radius,
      mesh: fireMesh,
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
