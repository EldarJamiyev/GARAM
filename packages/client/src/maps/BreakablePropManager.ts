import * as THREE from 'three';
import { AABBCollider, BreakableBlockSpec } from '@garam/shared';
import { ProceduralAudio } from '../audio/ProceduralAudio.js';
import { EffectsManager } from '../combat/EffectsManager.js';

interface BreakableRuntime {
  spec: BreakableBlockSpec;
  hp: number;
  broken: boolean;
  mesh: THREE.Mesh;
  colliderRef: AABBCollider;
}

/**
 * Manages CS 1.6 func_breakable glass panes & air vents across maps:
 * - Shatters when shot/knifed, disabling the matching collider so players/bullets pass through.
 * - Restores all glass/vents cleanly on round reset.
 */
export class BreakablePropManager {
  private entries: BreakableRuntime[] = [];
  private sharedMaterials: THREE.Material[] = [];
  private scene: THREE.Scene;
  private audio: ProceduralAudio;
  private effects: EffectsManager;

  constructor(scene: THREE.Scene, audio: ProceduralAudio, effects: EffectsManager) {
    this.scene = scene;
    this.audio = audio;
    this.effects = effects;
  }

  public initForMap(specs: readonly BreakableBlockSpec[], mapColliders: AABBCollider[]): void {
    this.dispose();
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xaad8ff,
      roughness: 0.08,
      metalness: 0.12,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    });
    const ventMat = new THREE.MeshStandardMaterial({
      color: 0x5c6670,
      roughness: 0.42,
      metalness: 0.75,
    });
    this.sharedMaterials.push(glassMat, ventMat);

    for (const spec of specs) {
      const w = Math.max(0.05, spec.maxX - spec.minX);
      const h = Math.max(0.05, spec.maxY - spec.minY);
      const d = Math.max(0.05, spec.maxZ - spec.minZ);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), spec.label === 'GLASS' ? glassMat : ventMat);
      mesh.position.set((spec.minX + spec.maxX) * 0.5, (spec.minY + spec.maxY) * 0.5, (spec.minZ + spec.maxZ) * 0.5);
      mesh.userData.isMapRoot = true;
      mesh.userData.breakableId = spec.id;
      this.scene.add(mesh);

      const col: AABBCollider = {
        minX: spec.minX,
        maxX: spec.maxX,
        minY: spec.minY,
        maxY: spec.maxY,
        minZ: spec.minZ,
        maxZ: spec.maxZ,
      };
      mapColliders.push(col);

      this.entries.push({ spec, hp: spec.health, broken: false, mesh, colliderRef: col });
    }
  }

  public applyDamage(blockId: string, damage: number): boolean {
    const entry = this.entries.find((e) => e.spec.id === blockId && !e.broken);
    if (!entry) return false;
    entry.hp -= damage;
    if (entry.hp <= 0) {
      this.shatter(entry);
      return true;
    }
    return false;
  }

  public checkRayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 40): string | null {
    let bestT = maxDist;
    let bestEntry: BreakableRuntime | null = null;
    const box = new THREE.Box3();
    const ray = new THREE.Ray(origin, dir);
    const hitPt = new THREE.Vector3();

    for (const e of this.entries) {
      if (e.broken) continue;
      box.min.set(e.spec.minX, e.spec.minY, e.spec.minZ);
      box.max.set(e.spec.maxX, e.spec.maxY, e.spec.maxZ);
      if (ray.intersectBox(box, hitPt)) {
        const d = origin.distanceTo(hitPt);
        if (d < bestT) {
          bestT = d;
          bestEntry = e;
        }
      }
    }
    if (bestEntry) {
      this.shatter(bestEntry);
      return bestEntry.spec.id;
    }
    return null;
  }

  private shatter(entry: BreakableRuntime): void {
    entry.broken = true;
    entry.mesh.visible = false;
    // Move collider safely out of bounds without mutating array indices
    entry.colliderRef.minY = -999;
    entry.colliderRef.maxY = -998;
    const center = entry.mesh.position;
    this.effects.spawnImpactBurst(center, new THREE.Vector3(0, 1, 0), 'METAL_SHEET');
    if (entry.spec.label === 'GLASS') {
      this.audio.playGlassShatter?.(center);
    } else {
      this.audio.playSurfaceImpact('METAL_SHEET', center);
    }
  }

  public resetRound(): void {
    for (const e of this.entries) {
      e.broken = false;
      e.hp = e.spec.health;
      e.mesh.visible = true;
      e.colliderRef.minY = e.spec.minY;
      e.colliderRef.maxY = e.spec.maxY;
    }
  }

  public dispose(): void {
    for (const e of this.entries) {
      this.scene.remove(e.mesh);
      e.mesh.geometry.dispose();
    }
    for (const mat of this.sharedMaterials) {
      mat.dispose();
    }
    this.sharedMaterials = [];
    this.entries = [];
  }
}
