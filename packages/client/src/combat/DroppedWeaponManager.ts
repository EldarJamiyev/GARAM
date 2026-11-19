import * as THREE from 'three';
import { AABBCollider, WEAPONS, WeaponDef } from '@garam/shared';

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
    const group = new THREE.Group();

    if (isBomb) {
      // Glowing Pulse Core
      const bombBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.22, 0.25),
        new THREE.MeshStandardMaterial({
          color: 0xffaa00,
          emissive: 0xffaa00,
          emissiveIntensity: 0.6,
          metalness: 0.8,
          roughness: 0.2,
        })
      );
      group.add(bombBox);
    } else {
      // 3D Weapon Model with Glowing Tactical Aura
      const def = WEAPONS[weaponId];
      const isRifle = def?.category === 'rifle' || def?.category === 'sniper';
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, isRifle ? 0.12 : 0.08, isRifle ? 0.65 : 0.24),
        new THREE.MeshStandardMaterial({
          color: def?.category === 'sniper' ? 0xd4af37 : 0x2e343d,
          emissive: 0x3b9eff,
          emissiveIntensity: 0.25,
          metalness: 0.9,
          roughness: 0.3,
        })
      );
      group.add(body);

      // Magazine
      const mag = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.16, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x181a1d, metalness: 0.8, roughness: 0.4 })
      );
      mag.position.set(0, -0.08, -0.05);
      group.add(mag);
    }

    // Tactical ground glow halo
    const glowRing = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.32, 16),
      new THREE.MeshBasicMaterial({
        color: isBomb ? 0xffaa00 : 0x00ff88,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      })
    );
    glowRing.rotation.x = -Math.PI / 2;
    glowRing.position.y = -0.05;
    group.add(glowRing);

    group.position.copy(pos);
    this.scene.add(group);

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

        // Ground check
        if (drop.position.y <= 0.12) {
          drop.position.y = 0.12;
          drop.velocity.set(0, 0, 0);
          drop.isGrounded = true;
        } else {
          // AABB step collisions
          for (const box of colliders) {
            if (
              drop.position.x >= box.minX &&
              drop.position.x <= box.maxX &&
              drop.position.z >= box.minZ &&
              drop.position.z <= box.maxZ &&
              drop.position.y <= box.maxY + 0.1 &&
              drop.position.y >= box.minY
            ) {
              drop.position.y = box.maxY + 0.12;
              drop.velocity.set(0, 0, 0);
              drop.isGrounded = true;
              break;
            }
          }
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

      const toDrop = drop.position.clone().sub(playerPos).normalize();
      if (rayDir.dot(toDrop) >= 0.85) {
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
      drop.mesh.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material?.dispose();
          }
        }
      });
      this.droppedWeapons.splice(index, 1);
    }
  }

  public clearAll(): void {
    for (let i = this.droppedWeapons.length - 1; i >= 0; i--) {
      this.removeDrop(i);
    }
  }
}
