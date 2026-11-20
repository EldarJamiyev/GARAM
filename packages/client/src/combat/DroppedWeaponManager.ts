import * as THREE from 'three';
import { AABBCollider, WEAPONS } from '@garam/shared';
import { AssetManager } from '../render/AssetManager.js';

const WEAPON_GLB_MAP: Record<string, { path: string; length: number }> = {
  'garam-47': { path: '/models/garam47.glb', length: 0.88 },
  'vanguard-m4': { path: '/models/m4a1s.glb', length: 0.92 },
  'sovereign-awp': { path: '/models/awp.glb', length: 1.15 },
  'desert-eagle': { path: '/models/deagle.glb', length: 0.28 },
};

export interface DroppedWeaponEntity {
  id: string;
  weaponId: string;
  currentAmmo: number;
  reserveAmmo: number;
  isBomb: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  mesh: THREE.Group;
  isGrounded: boolean;
}

const _toDrop = new THREE.Vector3();

// Shared immutable geometries & materials (eliminates per-drop GPU allocation/disposal churn)
let _sharedAssets: {
  bombGeo: THREE.BoxGeometry;
  bombMat: THREE.MeshStandardMaterial;
  rifleGeo: THREE.BoxGeometry;
  pistolGeo: THREE.BoxGeometry;
  sniperMat: THREE.MeshStandardMaterial;
  gunMat: THREE.MeshStandardMaterial;
  magGeo: THREE.BoxGeometry;
  magMat: THREE.MeshStandardMaterial;
  ringGeo: THREE.RingGeometry;
  bombRingMat: THREE.MeshBasicMaterial;
  gunRingMat: THREE.MeshBasicMaterial;
} | null = null;

function getSharedDropAssets() {
  if (!_sharedAssets) {
    _sharedAssets = {
      bombGeo: new THREE.BoxGeometry(0.35, 0.22, 0.25),
      bombMat: new THREE.MeshStandardMaterial({
        color: 0xffaa00,
        emissive: 0xffaa00,
        emissiveIntensity: 0.6,
        metalness: 0.8,
        roughness: 0.2,
      }),
      rifleGeo: new THREE.BoxGeometry(0.06, 0.12, 0.65),
      pistolGeo: new THREE.BoxGeometry(0.06, 0.08, 0.24),
      sniperMat: new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        emissive: 0x3b9eff,
        emissiveIntensity: 0.25,
        metalness: 0.9,
        roughness: 0.3,
      }),
      gunMat: new THREE.MeshStandardMaterial({
        color: 0x2e343d,
        emissive: 0x3b9eff,
        emissiveIntensity: 0.25,
        metalness: 0.9,
        roughness: 0.3,
      }),
      magGeo: new THREE.BoxGeometry(0.04, 0.16, 0.08),
      magMat: new THREE.MeshStandardMaterial({ color: 0x181a1d, metalness: 0.8, roughness: 0.4 }),
      ringGeo: new THREE.RingGeometry(0.25, 0.32, 16),
      bombRingMat: new THREE.MeshBasicMaterial({
        color: 0xffaa00,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      }),
      gunRingMat: new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      }),
    };
  }
  return _sharedAssets;
}

/**
 * Pure AABB collision resolution for a dropped weapon entity.
 * Deflects horizontally off side walls instead of teleporting items onto tall roofs,
 * and lands cleanly on top surfaces only when descending from above.
 */
export function resolveDroppedWeaponCollision(
  position: { x: number; y: number; z: number },
  velocity: { x: number; y: number; z: number },
  colliders: AABBCollider[]
): boolean {
  const dropRadius = 0.12;
  let grounded = false;

  for (const box of colliders) {
    if (
      position.x + dropRadius > box.minX &&
      position.x - dropRadius < box.maxX &&
      position.z + dropRadius > box.minZ &&
      position.z - dropRadius < box.maxZ &&
      position.y + dropRadius > box.minY &&
      position.y - dropRadius < box.maxY
    ) {
      // Landing on top surface only when descending near the roof plane
      if (velocity.y <= 0 && position.y >= box.maxY - 0.18) {
        position.y = box.maxY + dropRadius;
        velocity.x = 0;
        velocity.y = 0;
        velocity.z = 0;
        grounded = true;
        break;
      }

      // Side-face collision: push out along shallowest horizontal penetration axis
      const penLeft = position.x + dropRadius - box.minX;
      const penRight = box.maxX - (position.x - dropRadius);
      const penBack = position.z + dropRadius - box.minZ;
      const penFront = box.maxZ - (position.z - dropRadius);
      const minPen = Math.min(penLeft, penRight, penBack, penFront);

      if (minPen === penLeft) {
        position.x = box.minX - dropRadius;
        if (velocity.x > 0) velocity.x *= -0.35;
      } else if (minPen === penRight) {
        position.x = box.maxX + dropRadius;
        if (velocity.x < 0) velocity.x *= -0.35;
      } else if (minPen === penBack) {
        position.z = box.minZ - dropRadius;
        if (velocity.z > 0) velocity.z *= -0.35;
      } else {
        position.z = box.maxZ + dropRadius;
        if (velocity.z < 0) velocity.z *= -0.35;
      }
    }
  }

  return grounded;
}

export class DroppedWeaponManager {
  private scene: THREE.Scene;
  private droppedWeapons: DroppedWeaponEntity[] = [];
  private nextId = 1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public getWeapons(): DroppedWeaponEntity[] {
    return this.droppedWeapons;
  }

  public dropWeapon(
    weaponId: string,
    currentAmmo: number,
    reserveAmmo: number,
    pos: THREE.Vector3,
    forward: THREE.Vector3,
    isBomb = false
  ): DroppedWeaponEntity {
    const assets = getSharedDropAssets();
    const group = new THREE.Group();

    const proxyGroup = new THREE.Group();
    if (isBomb) {
      const bombBox = new THREE.Mesh(assets.bombGeo, assets.bombMat);
      proxyGroup.add(bombBox);
    } else {
      const def = WEAPONS[weaponId];
      const isRifle = def?.category === 'rifle' || def?.category === 'sniper';
      const body = new THREE.Mesh(
        isRifle ? assets.rifleGeo : assets.pistolGeo,
        def?.category === 'sniper' ? assets.sniperMat : assets.gunMat
      );
      proxyGroup.add(body);

      const mag = new THREE.Mesh(assets.magGeo, assets.magMat);
      mag.position.set(0, -0.08, -0.05);
      proxyGroup.add(mag);
    }
    group.add(proxyGroup);

    const glowRing = new THREE.Mesh(assets.ringGeo, isBomb ? assets.bombRingMat : assets.gunRingMat);
    glowRing.rotation.x = -Math.PI / 2;
    glowRing.position.y = -0.05;
    group.add(glowRing);

    group.position.copy(pos);
    this.scene.add(group);

    // Asynchronously mount real CS2 GLB weapon or C4 model
    const spec = isBomb ? { path: '/models/c4.glb', length: 0.30 } : WEAPON_GLB_MAP[weaponId];
    if (spec) {
      void AssetManager.getInstance()
        .loadModel(spec.path, {
          targetLength: spec.length,
          centerPivot: true,
          rotationEuler: isBomb ? [0, 0, 0] : [0, 0, Math.PI / 2],
          envMapIntensity: 1.6,
        })
        .then((glb) => {
          if (!glb || !group.parent) return;
          proxyGroup.visible = false;
          group.add(glb);
        });
    }

    const tossVel = forward.clone().normalize().multiplyScalar(4.5);
    tossVel.y = 2.4; // Toss upward arc

    const entity: DroppedWeaponEntity = {
      id: `drop_${this.nextId++}`,
      weaponId,
      currentAmmo,
      reserveAmmo,
      isBomb,
      position: pos.clone(),
      velocity: tossVel,
      mesh: group,
      isGrounded: false,
    };

    this.droppedWeapons.push(entity);
    return entity;
  }

  public update(
    dt: number,
    colliders: AABBCollider[],
    playerPos: THREE.Vector3,
    onAutoLoot?: (entity: DroppedWeaponEntity) => boolean
  ): void {
    const gravity = -9.81;

    for (let i = this.droppedWeapons.length - 1; i >= 0; i--) {
      const drop = this.droppedWeapons[i];

      if (!drop.isGrounded) {
        drop.velocity.y += gravity * dt;
        drop.position.addScaledVector(drop.velocity, dt);

        if (drop.position.y <= 0.12) {
          drop.position.y = 0.12;
          drop.velocity.set(0, 0, 0);
          drop.isGrounded = true;
        } else {
          drop.isGrounded = resolveDroppedWeaponCollision(drop.position, drop.velocity, colliders);
        }
      }

      // Gentle tactical rotation while resting on ground
      drop.mesh.rotation.y += dt * 1.2;
      drop.mesh.position.copy(drop.position);

      // Check distance to player for auto-pickup
      const dist = drop.position.distanceTo(playerPos);
      if (dist <= 1.4 && onAutoLoot) {
        const looted = onAutoLoot(drop);
        if (looted) {
          this.removeDrop(i);
        }
      }
    }
  }

  public tryLootAimingAt(
    playerPos: THREE.Vector3,
    rayDir: THREE.Vector3,
    onLoot: (entity: DroppedWeaponEntity) => boolean
  ): boolean {
    for (let i = this.droppedWeapons.length - 1; i >= 0; i--) {
      const drop = this.droppedWeapons[i];
      const dist = drop.position.distanceTo(playerPos);
      if (dist > 2.8) continue;

      _toDrop.copy(drop.position).sub(playerPos).normalize();
      if (rayDir.dot(_toDrop) >= 0.85) {
        const looted = onLoot(drop);
        if (looted) {
          this.removeDrop(i);
          return true;
        }
      }
    }
    return false;
  }

  private removeDrop(index: number): void {
    const drop = this.droppedWeapons[index];
    if (drop) {
      this.scene.remove(drop.mesh);
      this.droppedWeapons.splice(index, 1);
    }
  }

  public clearAll(): void {
    for (let i = this.droppedWeapons.length - 1; i >= 0; i--) {
      this.removeDrop(i);
    }
  }
}

