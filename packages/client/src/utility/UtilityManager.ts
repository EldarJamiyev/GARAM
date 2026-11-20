import * as THREE from 'three';
import {
  MapBlockCollider,
  AABBCollider,
  Vec3,
  SmokeOccluder,
  hasLineOfSight
} from '@garam/shared';
import { ProceduralAudio } from '../audio/ProceduralAudio.js';
import { BotEntity } from '../maps/DeCitadelMap.js';

export type UtilityType = 'smoke-grenade' | 'flashbang' | 'he-grenade' | 'molotov';
export type ThrowMode = 'long' | 'medium' | 'short';

interface ThrownGrenade {
  id: string;
  type: UtilityType;
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  fuseTime: number; // Seconds remaining
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
  duration: number; // 18.0s
  clearedHoleUntil: number; // Timestamp if temporarily cleared by HE grenade
}

interface MolotovFireZone {
  id: string;
  center: THREE.Vector3;
  radius: number;
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  spawnTime: number;
  duration: number; // 7.0s
}

export interface UtilityCallbacks {
  onFlashPlayer: (durationSec: number) => void;
  onPlayerDamage: (damage: number) => void;
  onKillfeed: (text: string) => void;
}

export class UtilityManager {
  private scene: THREE.Scene;
  private audio: ProceduralAudio;
  private callbacks: UtilityCallbacks;

  private thrownGrenades: ThrownGrenade[] = [];
  private activeSmokeClouds: ActiveSmokeCloud[] = [];
  private activeFireZones: MolotovFireZone[] = [];

  // Reusable materials & geometry
  private smokeMaterial: THREE.MeshStandardMaterial;
  private grenadeMat: THREE.MeshStandardMaterial;
  private fireMat: THREE.MeshBasicMaterial;
  private sharedPuffGeo: THREE.SphereGeometry;
  private dummyPuff: THREE.Object3D = new THREE.Object3D();

  constructor(scene: THREE.Scene, audio: ProceduralAudio, callbacks: UtilityCallbacks) {
    this.scene = scene;
    this.audio = audio;
    this.callbacks = callbacks;
    this.sharedPuffGeo = new THREE.SphereGeometry(1.2, 10, 8);

    // Soft volumetric alpha smoke material
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

  /**
   * Throws a tactical grenade with CS2 throw physics
   */
  public throwGrenade(
    type: UtilityType,
    eyePos: THREE.Vector3,
    viewDir: THREE.Vector3,
    playerVelocity: THREE.Vector3,
    mode: ThrowMode
  ): void {
    let speed = 18.0; // Long throw (M1)
    if (mode === 'short') speed = 7.0; // Short lob (M2)
    else if (mode === 'medium') speed = 12.5; // Medium throw (M1+M2)

    const initialVelocity = viewDir.clone().multiplyScalar(speed).add(playerVelocity.clone().multiplyScalar(0.7));

    // Grenade 3D canister mesh
    const geo = new THREE.CylinderGeometry(0.042, 0.042, 0.16, 12);
    const mesh = new THREE.Mesh(geo, this.grenadeMat);
    mesh.position.copy(eyePos).addScaledVector(viewDir, 0.5);
    mesh.castShadow = true;
    this.scene.add(mesh);

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

  /**
   * Main Physics & Simulation Tick
   */
  public update(
    dt: number,
    colliders: AABBCollider[],
    blocks: MapBlockCollider[],
    playerPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    bots: BotEntity[]
  ): void {
    const now = performance.now();

    // 1. Simulate Thrown Grenades
    for (let i = this.thrownGrenades.length - 1; i >= 0; i--) {
      const g = this.thrownGrenades[i];
      g.fuseTime -= dt;

      // Gravity
      g.velocity.y -= 15.5 * dt;

      // Air resistance
      g.velocity.x *= 1 - 0.25 * dt;
      g.velocity.z *= 1 - 0.25 * dt;

      const nextPos = g.position.clone().addScaledVector(g.velocity, dt);

      // Floor & Wall bounce collision
      let didBounce = false;

      // Ground plane
      if (nextPos.y <= 0.08) {
        nextPos.y = 0.08;
        g.velocity.y = -g.velocity.y * 0.42;
        g.velocity.x *= 0.72;
        g.velocity.z *= 0.72;
        didBounce = true;

        if (g.type === 'molotov') {
          // Molotov explodes immediately on ground contact!
          this.detonateMolotov(nextPos, bots);
          this.scene.remove(g.mesh);
          g.mesh.geometry.dispose();
          this.thrownGrenades.splice(i, 1);
          continue;
        }
      }

      // Check AABB block collisions
      for (const b of colliders) {
        if (
          nextPos.x >= b.minX - 0.08 && nextPos.x <= b.maxX + 0.08 &&
          nextPos.y >= b.minY && nextPos.y <= b.maxY &&
          nextPos.z >= b.minZ - 0.08 && nextPos.z <= b.maxZ + 0.08
        ) {
          // Bounce off normal
          const dxMin = Math.abs(nextPos.x - b.minX);
          const dxMax = Math.abs(nextPos.x - b.maxX);
          const dzMin = Math.abs(nextPos.z - b.minZ);
          const dzMax = Math.abs(nextPos.z - b.maxZ);
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
        this.audio.playFootstep(); // Canister bounce sound
      }

      g.position.copy(nextPos);
      g.mesh.position.copy(g.position);
      g.mesh.rotation.x += g.velocity.z * dt * 2.5;
      g.mesh.rotation.z += g.velocity.x * dt * 2.5;

      // Detonation on fuse expiration
      if (g.fuseTime <= 0) {
        this.detonateGrenade(g, blocks, playerPos, camera, bots);
        this.scene.remove(g.mesh);
        g.mesh.geometry.dispose();
        this.thrownGrenades.splice(i, 1);
      }
    }

    // 2. Update Volumetric Smoke Clouds
    for (let i = this.activeSmokeClouds.length - 1; i >= 0; i--) {
      const smoke = this.activeSmokeClouds[i];
      const age = (now - smoke.spawnTime) / 1000;

      if (age > smoke.duration) {
        // Expired - clean up GPU resources
        this.scene.remove(smoke.instancedMesh);
        (smoke.instancedMesh.material as THREE.Material).dispose();
        smoke.instancedMesh.dispose();
        this.activeSmokeClouds.splice(i, 1);
        continue;
      }

      // Smooth expansion to 4.6m radius over 0.8s, fade over final 2s
      let scale = 1.0;
      if (age < 0.8) {
        scale = age / 0.8;
      }
      let opacity = 0.92;
      if (age > smoke.duration - 2.0) {
        opacity = 0.92 * ((smoke.duration - age) / 2.0);
      }

      // Check if temporarily cleared by HE grenade
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

    // 3. Update Molotov Fire Zones
    for (let i = this.activeFireZones.length - 1; i >= 0; i--) {
      const fire = this.activeFireZones[i];
      const age = (now - fire.spawnTime) / 1000;

      if (age > fire.duration) {
        this.scene.remove(fire.mesh);
        this.scene.remove(fire.light);
        fire.mesh.geometry.dispose();
        this.activeFireZones.splice(i, 1);
        continue;
      }

      // Flicker light
      fire.light.intensity = 1.8 + Math.sin(now * 0.02) * 0.6;

      // Deal 40 DPS tick damage to players & bots standing inside fire zone
      const distToPlayer = playerPos.distanceTo(fire.center);
      if (distToPlayer <= fire.radius) {
        this.callbacks.onPlayerDamage(40 * dt);
      }

      for (const bot of bots) {
        if (!bot.isDead && bot.mesh.position.distanceTo(fire.center) <= fire.radius) {
          bot.health = Math.max(0, bot.health - 40 * dt);
          if (bot.health <= 0) {
            bot.isDead = true;
            this.scene.remove(bot.mesh);
            this.callbacks.onKillfeed(`🔥 Incendiary eliminated ${bot.name}`);
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
    bots: BotEntity[]
  ): void {
    if (g.type === 'smoke-grenade') {
      this.detonateSmoke(g.position);
    } else if (g.type === 'flashbang') {
      this.detonateFlashbang(g.position, blocks, playerPos, camera, bots);
    } else if (g.type === 'he-grenade') {
      this.detonateHE(g.position, blocks, playerPos, bots);
    } else if (g.type === 'molotov') {
      this.detonateMolotov(g.position, bots);
    }
  }

  /**
   * Spawns multi-puff volumetric tactical smoke cloud
   */
  private detonateSmoke(pos: THREE.Vector3): void {
    this.audio.playSmokeDeploy();

    // Extinguish any overlapping molotov fire zones immediately!
    for (let i = this.activeFireZones.length - 1; i >= 0; i--) {
      const f = this.activeFireZones[i];
      if (pos.distanceTo(f.center) <= 4.8) {
        this.audio.playKnifeSlash(); // Sizzle hiss
        this.scene.remove(f.mesh);
        this.scene.remove(f.light);
        f.mesh.geometry.dispose();
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

  /**
   * Directional Flashbang with FOV dot-product calculation
   */
  private detonateFlashbang(
    flashPos: THREE.Vector3,
    blocks: MapBlockCollider[],
    playerPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    bots: BotEntity[]
  ): void {
    this.audio.playFlashbangDetonate();

    const eyePos = camera.position;
    const distToPlayer = eyePos.distanceTo(flashPos);
    const smokeOccluders = this.getActiveSmokeOccluders();

    // 1. Test Player Blindness
    if (distToPlayer <= 32) {
      const hasLOS = hasLineOfSight(eyePos, flashPos, blocks, smokeOccluders);
      if (hasLOS) {
        const camForward = new THREE.Vector3();
        camera.getWorldDirection(camForward);

        const toFlash = flashPos.clone().sub(eyePos).normalize();
        const dot = camForward.dot(toFlash); // 1 = looking directly, -1 = looking completely away

        const distFactor = Math.max(0, 1 - distToPlayer / 32);
        // Direct look = up to 3.2s flash with whiteout; turned away = brief 0.3s glare
        const blindDuration = (0.35 + 2.85 * Math.pow(Math.max(0, dot), 1.6)) * distFactor;

        if (blindDuration > 0.15) {
          this.callbacks.onFlashPlayer(blindDuration);
        }
      }
    }

    // 2. Test Bot Blindness
    for (const bot of bots) {
      if (bot.isDead) continue;
      const botEye = bot.mesh.position.clone().add(new THREE.Vector3(0, 1.68, 0));
      const dist = botEye.distanceTo(flashPos);
      if (dist <= 28) {
        if (hasLineOfSight(botEye, flashPos, blocks, smokeOccluders)) {
          // Bots looking towards flashbang are blinded for 2.5s
          bot.lastShotTime = performance.now() + 2500;
        }
      }
    }
  }

  /**
   * High-Explosive Grenade with Smoke-Clearing Hole
   */
  private detonateHE(
    pos: THREE.Vector3,
    blocks: MapBlockCollider[],
    playerPos: THREE.Vector3,
    bots: BotEntity[]
  ): void {
    this.audio.playGrenadeExplosion();

    // 1. Temporarily blow a 2.6s transparent hole in any overlapping Smoke Cloud!
    const now = performance.now();
    for (const smoke of this.activeSmokeClouds) {
      if (pos.distanceTo(smoke.center) <= 5.8) {
        smoke.clearedHoleUntil = now + 2600; // Clears vision & LOS for 2.6s
        this.callbacks.onKillfeed('💥 HE Grenade dispersed tactical smoke');
      }
    }

    // 2. Damage Player
    const distToPlayer = playerPos.distanceTo(pos);
    if (distToPlayer <= 7.2) {
      if (hasLineOfSight(playerPos, pos, blocks, [])) {
        const damageRatio = Math.max(0, 1 - distToPlayer / 7.2);
        const dmg = Math.round(damageRatio * 85);
        this.callbacks.onPlayerDamage(dmg);
      }
    }

    // 3. Damage Bots
    for (const bot of bots) {
      if (bot.isDead) continue;
      const dist = bot.mesh.position.distanceTo(pos);
      if (dist <= 7.2) {
        if (hasLineOfSight(bot.mesh.position, pos, blocks, [])) {
          const damageRatio = Math.max(0, 1 - dist / 7.2);
          const dmg = Math.round(damageRatio * 85);
          bot.health = Math.max(0, bot.health - dmg);
          if (bot.health <= 0) {
            bot.isDead = true;
            this.scene.remove(bot.mesh);
            this.callbacks.onKillfeed(`💥 HE Grenade eliminated ${bot.name}`);
          }
        }
      }
    }
  }

  /**
   * Shatters Molotov into burning ground fire zone
   */
  private detonateMolotov(pos: THREE.Vector3, bots: BotEntity[]): void {
    this.audio.playGrenadeExplosion();

    const radius = 3.4;
    const fireMesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), this.fireMat);
    fireMesh.rotation.x = -Math.PI / 2;
    fireMesh.position.set(pos.x, 0.04, pos.z);
    this.scene.add(fireMesh);

    const light = new THREE.PointLight(0xff6611, 2.2, 12);
    light.position.set(pos.x, 1.2, pos.z);
    this.scene.add(light);

    this.activeFireZones.push({
      id: Math.random().toString(36).substring(2, 9),
      center: pos.clone(),
      radius,
      mesh: fireMesh,
      light,
      spawnTime: performance.now(),
      duration: 7.0,
    });
  }

  /**
   * CRITICAL BUGFIX FOR 722d576:
   * Returns all active volumetric smoke spheres so hasLineOfSight NEVER receives an empty array!
   */
  public getActiveSmokeOccluders(): SmokeOccluder[] {
    const now = performance.now();
    const occluders: SmokeOccluder[] = [];

    for (const smoke of this.activeSmokeClouds) {
      // If HE grenade currently cleared a hole through smoke, skip occlusion
      if (now < smoke.clearedHoleUntil) continue;

      occluders.push({
        center: { x: smoke.center.x, y: smoke.center.y, z: smoke.center.z },
        radius: smoke.radius,
      });
    }

    return occluders;
  }
}
