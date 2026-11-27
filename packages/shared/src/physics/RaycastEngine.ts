import { MapBlockCollider, SurfaceMaterial, SURFACE_MATERIALS, Vec3 } from '../maps/DeCitadelData.js';
export type { Vec3 } from '../maps/DeCitadelData.js';
import { HITBOX } from '../constants/kinematics.js';
import { SpatialGrid } from './SpatialGrid.js';

export interface Ray {
  origin: Vec3;
  direction: Vec3; // Must be normalized
}

export interface RayIntersectionResult {
  hit: boolean;
  tNear: number;
  tFar: number;
  normal: Vec3;
}

export interface MutableRayAABBHit {
  tNear: number;
  tFar: number;
  nx: number;
  ny: number;
  nz: number;
}

const _aabbScratch: MutableRayAABBHit = {
  tNear: 0,
  tFar: 0,
  nx: 0,
  ny: 0,
  nz: 0,
};

export type HitZone = 'HEAD' | 'CHEST' | 'STOMACH' | 'ARMS' | 'LEGS';

export interface RaycastHit {
  hit: boolean;
  point: Vec3;
  exitPoint?: Vec3;
  normal: Vec3;
  distance: number;
  material: SurfaceMaterial;
  blockId?: string;
  targetId?: string;
  hitZone?: HitZone;
  isHeadshot?: boolean;
  awardedDamage: number;
  armorDamage: number;
  penetratedWalls: number;
}

export interface TargetHitboxes {
  head?: Vec3;
  chest?: Vec3;
  stomach?: Vec3;
  leftArm?: Vec3;
  rightArm?: Vec3;
  leftLeg?: Vec3;
  rightLeg?: Vec3;
}

export interface TargetCollider {
  id: string;
  name: string;
  team: 'Vanguard' | 'Syndicate';
  center: Vec3; // Base center
  hasHelmet: boolean;
  armor: number;
  isDead: boolean;
  isCrouched?: boolean;
  yaw?: number;
  hitboxes?: TargetHitboxes;
}

export interface SmokeOccluder {
  center: Vec3;
  radius: number;
}

/**
 * Shared deterministic spread ray direction calculation.
 * Computes exact orthonormal camera/viewplane basis vectors from yaw and pitch (with zero roll),
 * applying viewplane tangent spread offsets (sx, sy). Never degenerates at steep pitch angles.
 */
export function computeSpreadRayDirection(
  yaw: number,
  pitch: number,
  sx: number,
  sy: number
): Vec3 {
  // Forward vector: -Z forward convention
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const syaw = Math.sin(yaw);

  const fx = -syaw * cp;
  const fy = sp;
  const fz = -cy * cp;

  // Right vector: orthonormal unit vector perpendicular to forward with zero roll
  const rx = cy;
  const ry = 0;
  const rz = -syaw;

  // Up vector: U = R x F (strictly orthonormal, unit length)
  const ux = syaw * sp;
  const uy = cp;
  const uz = cy * sp;

  // Viewplane spread displacement
  const dx = fx + sx * rx + sy * ux;
  const dy = fy + sx * ry + sy * uy;
  const dz = fz + sx * rz + sy * uz;

  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-8) {
    return { x: fx, y: fy, z: fz };
  }
  return {
    x: dx / len,
    y: dy / len,
    z: dz / len,
  };
}

/**
 * Zero-allocation slab method ray-AABB test writing into a caller-owned MutableRayAABBHit.
 */
export function intersectRayAABBInto(
  ray: Ray,
  minX: number, maxX: number,
  minY: number, maxY: number,
  minZ: number, maxZ: number,
  out: MutableRayAABBHit
): boolean {
  let tmin = -Infinity;
  let tmax = Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;

  // X axis
  if (Math.abs(ray.direction.x) < 1e-8) {
    if (ray.origin.x < minX || ray.origin.x > maxX) return false;
  } else {
    const invD = 1.0 / ray.direction.x;
    let t1 = (minX - ray.origin.x) * invD;
    let t2 = (maxX - ray.origin.x) * invD;
    let n1x = -1;
    if (t1 > t2) {
      const temp = t1; t1 = t2; t2 = temp;
      n1x = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = n1x; ny = 0; nz = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }

  // Y axis
  if (Math.abs(ray.direction.y) < 1e-8) {
    if (ray.origin.y < minY || ray.origin.y > maxY) return false;
  } else {
    const invD = 1.0 / ray.direction.y;
    let t1 = (minY - ray.origin.y) * invD;
    let t2 = (maxY - ray.origin.y) * invD;
    let n1y = -1;
    if (t1 > t2) {
      const temp = t1; t1 = t2; t2 = temp;
      n1y = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0; ny = n1y; nz = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }

  // Z axis
  if (Math.abs(ray.direction.z) < 1e-8) {
    if (ray.origin.z < minZ || ray.origin.z > maxZ) return false;
  } else {
    const invD = 1.0 / ray.direction.z;
    let t1 = (minZ - ray.origin.z) * invD;
    let t2 = (maxZ - ray.origin.z) * invD;
    let n1z = -1;
    if (t1 > t2) {
      const temp = t1; t1 = t2; t2 = temp;
      n1z = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0; ny = 0; nz = n1z;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }

  if (tmax < 0) return false;

  out.tNear = tmin > 0 ? tmin : 0;
  out.tFar = tmax;
  out.nx = nx;
  out.ny = ny;
  out.nz = nz;
  return true;
}

/**
 * Standard slab method ray-AABB test
 */
export function intersectRayAABB(
  ray: Ray,
  minX: number, maxX: number,
  minY: number, maxY: number,
  minZ: number, maxZ: number
): RayIntersectionResult {
  const hit = intersectRayAABBInto(ray, minX, maxX, minY, maxY, minZ, maxZ, _aabbScratch);
  if (!hit) {
    return { hit: false, tNear: 0, tFar: 0, normal: { x: 0, y: 0, z: 0 } };
  }
  return {
    hit: true,
    tNear: _aabbScratch.tNear,
    tFar: _aabbScratch.tFar,
    normal: { x: _aabbScratch.nx, y: _aabbScratch.ny, z: _aabbScratch.nz },
  };
}

/**
 * Ray-Sphere intersection
 */
export function intersectRaySphere(ray: Ray, center: Vec3, radius: number): { hit: boolean; t: number } {
  const ocX = ray.origin.x - center.x;
  const ocY = ray.origin.y - center.y;
  const ocZ = ray.origin.z - center.z;

  const b = ocX * ray.direction.x + ocY * ray.direction.y + ocZ * ray.direction.z;
  const c = ocX * ocX + ocY * ocY + ocZ * ocZ - radius * radius;
  const discriminant = b * b - c;

  if (discriminant < 0) return { hit: false, t: -1 };

  const sqrtDisc = Math.sqrt(discriminant);
  const t0 = -b - sqrtDisc;
  const t1 = -b + sqrtDisc;

  if (t0 > 0) return { hit: true, t: t0 };
  if (t1 > 0) return { hit: true, t: t1 };

  return { hit: false, t: -1 };
}

/**
 * Ray-Vertical Cylinder intersection for player body parts with planar top & bottom circular caps
 */
export function intersectRayVerticalCylinder(
  ray: Ray,
  centerX: number,
  centerZ: number,
  minY: number,
  maxY: number,
  radius: number
): { hit: boolean; t: number } {
  const ocX = ray.origin.x - centerX;
  const ocZ = ray.origin.z - centerZ;
  let closestT = Infinity;
  let hit = false;

  // 1. Curved cylindrical side surface
  const a = ray.direction.x * ray.direction.x + ray.direction.z * ray.direction.z;
  if (a > 1e-8) {
    const b = 2 * (ocX * ray.direction.x + ocZ * ray.direction.z);
    const c = ocX * ocX + ocZ * ocZ - radius * radius;
    const discriminant = b * b - 4 * a * c;

    if (discriminant >= 0) {
      const sqrtDisc = Math.sqrt(discriminant);
      const t0 = (-b - sqrtDisc) / (2 * a);
      const t1 = (-b + sqrtDisc) / (2 * a);

      if (t0 > 0) {
        const y0 = ray.origin.y + ray.direction.y * t0;
        if (y0 >= minY && y0 <= maxY && t0 < closestT) {
          closestT = t0;
          hit = true;
        }
      }
      if (t1 > 0) {
        const y1 = ray.origin.y + ray.direction.y * t1;
        if (y1 >= minY && y1 <= maxY && t1 < closestT) {
          closestT = t1;
          hit = true;
        }
      }
    }
  }

  // 2. Planar Top & Bottom Circular Caps (essential for downward/upward angled shots!)
  if (Math.abs(ray.direction.y) > 1e-8) {
    // Top Cap (y = maxY)
    const tTop = (maxY - ray.origin.y) / ray.direction.y;
    if (tTop > 0 && tTop < closestT) {
      const xTop = ray.origin.x + ray.direction.x * tTop - centerX;
      const zTop = ray.origin.z + ray.direction.z * tTop - centerZ;
      if (xTop * xTop + zTop * zTop <= radius * radius) {
        closestT = tTop;
        hit = true;
      }
    }

    // Bottom Cap (y = minY)
    const tBot = (minY - ray.origin.y) / ray.direction.y;
    if (tBot > 0 && tBot < closestT) {
      const xBot = ray.origin.x + ray.direction.x * tBot - centerX;
      const zBot = ray.origin.z + ray.direction.z * tBot - centerZ;
      if (xBot * xBot + zBot * zBot <= radius * radius) {
        closestT = tBot;
        hit = true;
      }
    }
  }

  return hit ? { hit: true, t: closestT } : { hit: false, t: -1 };
}

/**
 * Perform a deterministic, distance-sorted tactical raycast with 5-zone hitboxes,
 * Kevlar/Helmet armor calculations, and multi-material penetration.
 */
export function executeTacticalRaycast(
  ray: Ray,
  baseDamage: number,
  armorPenetration: number,
  penetrationPower: number,
  maxRange = 250,
  blocks: MapBlockCollider[] = [],
  targets: TargetCollider[] = [],
  rangeDropoff = 1.0,
  spatialGrid?: SpatialGrid,
  headDamageMultiplier: number = HITBOX.HEAD_MULTIPLIER
): RaycastHit[] {
  interface HitCandidate {
    type: 'block' | 'target';
    distance: number;
    normal: Vec3;
    block?: MapBlockCollider;
    target?: TargetCollider;
    hitZone?: HitZone;
    tNear: number;
    tFar: number;
  }

  const candidates: HitCandidate[] = [];

  // 1. Gather block intersections (accelerated via SpatialGrid if provided, zero-allocation AABB slab)
  if (spatialGrid) {
    spatialGrid.queryRay(ray, maxRange, (idx) => {
      const block = blocks[idx];
      if (
        intersectRayAABBInto(
          ray,
          block.minX, block.maxX,
          block.minY, block.maxY,
          block.minZ, block.maxZ,
          _aabbScratch
        ) &&
        _aabbScratch.tNear <= maxRange
      ) {
        candidates.push({
          type: 'block',
          distance: _aabbScratch.tNear,
          normal: { x: _aabbScratch.nx, y: _aabbScratch.ny, z: _aabbScratch.nz },
          block,
          tNear: _aabbScratch.tNear,
          tFar: _aabbScratch.tFar,
        });
      }
    });
  } else {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (
        intersectRayAABBInto(
          ray,
          block.minX, block.maxX,
          block.minY, block.maxY,
          block.minZ, block.maxZ,
          _aabbScratch
        ) &&
        _aabbScratch.tNear <= maxRange
      ) {
        candidates.push({
          type: 'block',
          distance: _aabbScratch.tNear,
          normal: { x: _aabbScratch.nx, y: _aabbScratch.ny, z: _aabbScratch.nz },
          block,
          tNear: _aabbScratch.tNear,
          tFar: _aabbScratch.tFar,
        });
      }
    }
  }

  // 2. Gather 5-Zone Target Hitbox intersections with 100% silhouette coverage & crouch support
  // Standing: Head [1.48..1.84] r=0.18, Chest [1.16..1.50] r=0.35, Stomach [0.86..1.18] r=0.34, Left/Right Arms [0.95..1.48] r=0.12, Legs [0.00..0.88] r=0.30
  // Crouching: Head [0.88..1.22] r=0.17 (flush with 1.22m crouch capsule!), Chest [0.72..0.96] r=0.35, Stomach [0.42..0.74] r=0.34, Left/Right Arms [0.48..0.96] r=0.12, Legs [0.00..0.44] r=0.30
  for (const t of targets) {
    if (t.isDead) continue;
    const bx = t.center.x;
    const by = t.center.y;
    const bz = t.center.z;
    const hb = t.hitboxes;
    const isCrouched = !!t.isCrouched;

    // Fast bounding-sphere early out: distance to operator center
    const opCenter: Vec3 = isCrouched
      ? { x: bx, y: by + 0.61, z: bz }
      : { x: bx, y: by + 0.92, z: bz };
    const boundRadius = isCrouched ? 1.05 : 1.30;
    const boundCheck = intersectRaySphere(ray, opCenter, boundRadius);
    if (!boundCheck.hit || boundCheck.t > maxRange) {
      continue;
    }

    // Head Sphere (uses articulated bone position if available)
    const headDefaultY = isCrouched ? by + 1.05 : by + 1.66;
    const headRadius = isCrouched ? 0.17 : 0.18;
    const headPos = hb?.head ?? { x: bx, y: headDefaultY, z: bz };
    const headHit = intersectRaySphere(ray, headPos, headRadius);
    if (headHit.hit && headHit.t <= maxRange) {
      candidates.push({
        type: 'target',
        distance: headHit.t,
        normal: { x: 0, y: 0, z: 1 },
        target: t,
        hitZone: 'HEAD',
        tNear: headHit.t,
        tFar: headHit.t + headRadius * 2,
      });
    }

    // Chest Cylinder / Box
    const chestX = hb?.chest?.x ?? bx;
    const chestZ = hb?.chest?.z ?? bz;
    const chestMinY = hb?.chest ? hb.chest.y - 0.16 : (isCrouched ? by + 0.72 : by + 1.16);
    const chestMaxY = hb?.chest ? hb.chest.y + 0.16 : (isCrouched ? by + 0.96 : by + 1.50);
    const chestHit = intersectRayVerticalCylinder(ray, chestX, chestZ, chestMinY, chestMaxY, 0.35);
    if (chestHit.hit && chestHit.t <= maxRange) {
      candidates.push({
        type: 'target',
        distance: chestHit.t,
        normal: { x: 0, y: 0, z: 1 },
        target: t,
        hitZone: 'CHEST',
        tNear: chestHit.t,
        tFar: chestHit.t + 0.70,
      });
    }

    // Stomach Cylinder (2cm overlap with chest & legs guarantees zero midriff gaps)
    const stomX = hb?.stomach?.x ?? bx;
    const stomZ = hb?.stomach?.z ?? bz;
    const stomMinY = hb?.stomach ? hb.stomach.y - 0.15 : (isCrouched ? by + 0.42 : by + 0.86);
    const stomMaxY = hb?.stomach ? hb.stomach.y + 0.15 : (isCrouched ? by + 0.74 : by + 1.18);
    const stomHit = intersectRayVerticalCylinder(ray, stomX, stomZ, stomMinY, stomMaxY, 0.34);
    if (stomHit.hit && stomHit.t <= maxRange) {
      candidates.push({
        type: 'target',
        distance: stomHit.t,
        normal: { x: 0, y: 0, z: 1 },
        target: t,
        hitZone: 'STOMACH',
        tNear: stomHit.t,
        tFar: stomHit.t + 0.68,
      });
    }

    // Arms: modeled as two laterally offset cylinders (leftArm & rightArm at local x = ±0.34m, r = 0.12m)
    // rotated by target yaw so frontal chest shots NEVER hit an oversized coaxial barrel
    const targetYaw = t.yaw ?? 0;
    const cosY = Math.cos(targetYaw);
    const sinY = Math.sin(targetYaw);
    const leftArmX = hb?.leftArm?.x ?? (bx - 0.34 * cosY);
    const leftArmZ = hb?.leftArm?.z ?? (bz + 0.34 * sinY);
    const rightArmX = hb?.rightArm?.x ?? (bx + 0.34 * cosY);
    const rightArmZ = hb?.rightArm?.z ?? (bz - 0.34 * sinY);
    const armsMinY = isCrouched ? by + 0.48 : by + 0.95;
    const armsMaxY = isCrouched ? by + 0.96 : by + 1.48;

    const leftArmHit = intersectRayVerticalCylinder(ray, leftArmX, leftArmZ, armsMinY, armsMaxY, 0.12);
    if (leftArmHit.hit && leftArmHit.t <= maxRange) {
      candidates.push({
        type: 'target',
        distance: leftArmHit.t,
        normal: { x: 0, y: 0, z: 1 },
        target: t,
        hitZone: 'ARMS',
        tNear: leftArmHit.t,
        tFar: leftArmHit.t + 0.24,
      });
    }

    const rightArmHit = intersectRayVerticalCylinder(ray, rightArmX, rightArmZ, armsMinY, armsMaxY, 0.12);
    if (rightArmHit.hit && rightArmHit.t <= maxRange) {
      candidates.push({
        type: 'target',
        distance: rightArmHit.t,
        normal: { x: 0, y: 0, z: 1 },
        target: t,
        hitZone: 'ARMS',
        tNear: rightArmHit.t,
        tFar: rightArmHit.t + 0.24,
      });
    }

    // Legs Cylinder (extends from ground y=0.00 up to pelvis, 100% continuous coverage)
    const legsMaxY = isCrouched ? by + 0.44 : by + 0.88;
    const legsHit = intersectRayVerticalCylinder(ray, bx, bz, by + 0.00, legsMaxY, 0.30);
    if (legsHit.hit && legsHit.t <= maxRange) {
      candidates.push({
        type: 'target',
        distance: legsHit.t,
        normal: { x: 0, y: 0, z: 1 },
        target: t,
        hitZone: 'LEGS',
        tNear: legsHit.t,
        tFar: legsHit.t + 0.60,
      });
    }
  }

  // 3. Sort chronologically along the ray path
  candidates.sort((a, b) => a.distance - b.distance);

  const ZONE_PRIORITY: Record<HitZone, number> = {
    HEAD: 4,    // 4.0x
    STOMACH: 3, // 1.15x
    CHEST: 2,   // 1.0x
    ARMS: 1,    // 0.75x
    LEGS: 1,    // 0.75x
  };

  const results: RaycastHit[] = [];
  const processedTargetIds = new Set<string>();
  let currentDamage = baseDamage;
  let wallsPenetrated = 0;

  for (const c of candidates) {
    if (currentDamage <= 1) break;

    const hitPoint: Vec3 = {
      x: ray.origin.x + ray.direction.x * c.distance,
      y: ray.origin.y + ray.direction.y * c.distance,
      z: ray.origin.z + ray.direction.z * c.distance,
    };

    if (c.type === 'block' && c.block) {
      const mat = c.block.material;
      const matProps = SURFACE_MATERIALS[mat];

      const exitPoint: Vec3 = {
        x: ray.origin.x + ray.direction.x * c.tFar,
        y: ray.origin.y + ray.direction.y * c.tFar,
        z: ray.origin.z + ray.direction.z * c.tFar,
      };

      results.push({
        hit: true,
        point: hitPoint,
        exitPoint,
        normal: c.normal,
        distance: c.distance,
        material: mat,
        blockId: c.block.id,
        awardedDamage: 0,
        armorDamage: 0,
        penetratedWalls: wallsPenetrated,
      });

      // Concrete is strictly impenetrable
      if (matProps.isImpenetrable) {
        currentDamage = 0;
        break;
      }

      // Wall thickness
      const thickness = Math.max(0.05, c.tFar - c.tNear);
      if (thickness > matProps.maxThickness) {
        currentDamage = 0;
        break;
      }

      // Penetration damage calculation factored by weapon penetrationPower
      const penFactor = Math.max(0.5, 200 / Math.max(100, penetrationPower));
      currentDamage = currentDamage * matProps.mu - thickness * matProps.cost * penFactor;
      wallsPenetrated++;

      if (currentDamage <= 2) {
        currentDamage = 0;
        break;
      }
    } else if (c.target && c.hitZone) {
      if (processedTargetIds.has(c.target.id)) continue;
      processedTargetIds.add(c.target.id);

      // CS2 Target Penetration Priority Resolution:
      // Scan all hitboxes of that same target reached before any intervening impenetrable wall
      // and award the highest-priority damage multiplier (HEAD > STOMACH > CHEST > ARMS/LEGS)
      let bestCandidate = c;
      let bestPriority = ZONE_PRIORITY[c.hitZone];

      for (const other of candidates) {
        if (other.type === 'block' && other.block) {
          if (SURFACE_MATERIALS[other.block.material].isImpenetrable && other.distance > c.distance) {
            break; // Impenetrable barrier prevents further penetration into target
          }
        }
        if (other.type === 'target' && other.target?.id === c.target.id && other.hitZone) {
          const prio = ZONE_PRIORITY[other.hitZone];
          if (prio > bestPriority) {
            bestPriority = prio;
            bestCandidate = other;
          }
        }
      }

      // 5-Zone Damage Multipliers
      let zoneMultiplier = 1.0;
      let isArmoredZone = false;

      switch (bestCandidate.hitZone) {
        case 'HEAD':
          zoneMultiplier = headDamageMultiplier; // 4.0x firearms, 1.0x melee
          isArmoredZone = bestCandidate.target!.hasHelmet;
          break;
        case 'CHEST':
          zoneMultiplier = HITBOX.CHEST_MULTIPLIER; // 1.0x
          isArmoredZone = bestCandidate.target!.armor > 0;
          break;
        case 'STOMACH':
          zoneMultiplier = HITBOX.STOMACH_MULTIPLIER; // 1.15x
          isArmoredZone = bestCandidate.target!.armor > 0;
          break;
        case 'ARMS':
          zoneMultiplier = HITBOX.ARMS_MULTIPLIER; // 0.75x
          isArmoredZone = bestCandidate.target!.armor > 0;
          break;
        case 'LEGS':
          zoneMultiplier = HITBOX.LEGS_MULTIPLIER; // 0.75x
          isArmoredZone = false; // Legs are unarmored in CS!
          break;
      }

      // Apply range dropoff: effective damage decays per 10m traveled
      const rangeDecay = Math.pow(rangeDropoff, bestCandidate.distance / 10);
      const effectiveDamage = currentDamage * rangeDecay;

      const rawDamage = effectiveDamage * zoneMultiplier;
      let healthDamage = Math.round(rawDamage);
      let armorDamage = 0;

      if (isArmoredZone && bestCandidate.target!.armor > 0) {
        healthDamage = Math.round(rawDamage * armorPenetration);
        armorDamage = Math.round(rawDamage * (1 - armorPenetration) * 0.5);
      }

      const bestHitPoint: Vec3 = {
        x: ray.origin.x + ray.direction.x * bestCandidate.distance,
        y: ray.origin.y + ray.direction.y * bestCandidate.distance,
        z: ray.origin.z + ray.direction.z * bestCandidate.distance,
      };

      results.push({
        hit: true,
        point: bestHitPoint,
        normal: bestCandidate.normal,
        distance: bestCandidate.distance,
        material: 'WOOD_THIN', // Flesh
        targetId: bestCandidate.target!.id,
        hitZone: bestCandidate.hitZone,
        isHeadshot: bestCandidate.hitZone === 'HEAD',
        awardedDamage: healthDamage,
        armorDamage,
        penetratedWalls: wallsPenetrated,
      });

      // High-penetration sniper rounds (e.g. Sovereign AWP, penPower >= 250) can deliver attenuated collateral hits
      if (penetrationPower >= 250) {
        currentDamage *= 0.65;
        if (currentDamage <= 2) {
          currentDamage = 0;
          break;
        }
      } else {
        // Standard rifle/pistol target absorbs bullet
        currentDamage = 0;
        break;
      }
    }
  }

  return results;
}

/**
 * Line of Sight verification: Returns true ONLY if eyeA can see eyeB without solid obstruction.
 */
export function hasLineOfSight(
  eyeA: Vec3,
  eyeB: Vec3,
  blocks: MapBlockCollider[],
  smokeOccluders: SmokeOccluder[] = [],
  spatialGrid?: SpatialGrid
): boolean {
  const dx = eyeB.x - eyeA.x;
  const dy = eyeB.y - eyeA.y;
  const dz = eyeB.z - eyeA.z;
  const dist = Math.hypot(dx, dy, dz);

  if (dist < 0.001) return true;

  const ray: Ray = {
    origin: eyeA,
    direction: { x: dx / dist, y: dy / dist, z: dz / dist },
  };

  // Check all opaque world geometry (concrete, crates, containers — zero heap allocations per block)
  if (spatialGrid) {
    let obstructed = false;
    spatialGrid.queryRay(ray, dist, (idx) => {
      const b = blocks[idx];
      if (
        intersectRayAABBInto(ray, b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ, _aabbScratch) &&
        _aabbScratch.tNear < dist &&
        _aabbScratch.tNear > 0.05
      ) {
        obstructed = true;
        return true; // early exit traversal
      }
    });
    if (obstructed) return false;
  } else {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (
        intersectRayAABBInto(ray, b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ, _aabbScratch) &&
        _aabbScratch.tNear < dist &&
        _aabbScratch.tNear > 0.05
      ) {
        return false;
      }
    }
  }

  // Check smoke occluders (blocks sightlines passing through OR originating/terminating inside smoke)
  for (const s of smokeOccluders) {
    const rSq = s.radius * s.radius;
    const dASq =
      (eyeA.x - s.center.x) ** 2 +
      (eyeA.y - s.center.y) ** 2 +
      (eyeA.z - s.center.z) ** 2;
    const dBSq =
      (eyeB.x - s.center.x) ** 2 +
      (eyeB.y - s.center.y) ** 2 +
      (eyeB.z - s.center.z) ** 2;
    if (dASq < rSq || dBSq < rSq) {
      return false;
    }
    const hit = intersectRaySphere(ray, s.center, s.radius);
    if (hit.hit && hit.t < dist && hit.t > 0) {
      return false;
    }
  }

  return true;
}

export interface PelletRayOutcome {
  rayDirection: Vec3;
  hits: RaycastHit[];
}

/**
 * Deterministic CS 1.6 multi-pellet buckshot dispersion (for Leone M3 = 9 pellets, XM1014 = 6 pellets).
 * Pellet 0 is tight center-biased while outer pellets trace a golden-angle ring pattern.
 */
export function executeShotgunRaycast(
  origin: Vec3,
  yaw: number,
  pitch: number,
  pelletCount: number,
  pelletSpreadRad: number,
  baseDamagePerPellet: number,
  armorPenetration: number,
  penetrationPower: number,
  blocks: MapBlockCollider[],
  targets: TargetCollider[],
  rangeDropoff: number,
  spatialGrid?: SpatialGrid,
  headDamageMultiplier = 4.0,
  seed = 1
): PelletRayOutcome[] {
  const outcomes: PelletRayOutcome[] = [];
  const goldenAngle = 2.399963229728653;

  for (let p = 0; p < pelletCount; p++) {
    let sx = 0;
    let sy = 0;
    if (p > 0) {
      const hash = Math.abs(Math.sin((seed + p) * 19.371) * 43758.5453) % 1;
      const radial = Math.sqrt(p / pelletCount) * pelletSpreadRad * (0.78 + hash * 0.44);
      const theta = p * goldenAngle + hash * 0.55;
      sx = Math.cos(theta) * radial;
      sy = Math.sin(theta) * radial;
    }
    const dir = computeSpreadRayDirection(yaw, pitch, sx, sy);
    const hits = executeTacticalRaycast(
      { origin, direction: dir },
      baseDamagePerPellet,
      armorPenetration,
      penetrationPower,
      75, // Effective shotgun range
      blocks,
      targets,
      rangeDropoff,
      spatialGrid,
      headDamageMultiplier
    );
    outcomes.push({ rayDirection: dir, hits });
  }
  return outcomes;
}

/**
 * Checks whether a target holding a raised Tactical Shield blocks an incoming bullet vector.
 */
export function isBlockedByTacticalShield(
  bulletDir: Vec3,
  targetYaw: number,
  hasRaisedShield: boolean,
  hitZone?: HitZone
): boolean {
  if (!hasRaisedShield) return false;
  if (hitZone === 'LEGS') return false; // Feet remain exposed under raised shield (authentic CS 1.6 counterplay!)
  // Target forward (-Z in Three.js yaw convention)
  const tgtFwdX = -Math.sin(targetYaw);
  const tgtFwdZ = -Math.cos(targetYaw);
  const incomingTowardShooterX = -bulletDir.x;
  const incomingTowardShooterZ = -bulletDir.z;
  const len = Math.hypot(incomingTowardShooterX, incomingTowardShooterZ);
  if (len < 1e-6) return false;
  const dot = (tgtFwdX * incomingTowardShooterX + tgtFwdZ * incomingTowardShooterZ) / len;
  return dot >= 0.42; // ~65 deg frontal ballistic shield arc
}
