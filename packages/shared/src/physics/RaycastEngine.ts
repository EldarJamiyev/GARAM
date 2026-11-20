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
  hitboxes?: TargetHitboxes;
}

export interface SmokeOccluder {
  center: Vec3;
  radius: number;
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
  let tmin = -Infinity;
  let tmax = Infinity;
  let normal: Vec3 = { x: 0, y: 0, z: 0 };

  // X axis
  if (Math.abs(ray.direction.x) < 1e-8) {
    if (ray.origin.x < minX || ray.origin.x > maxX) return { hit: false, tNear: 0, tFar: 0, normal };
  } else {
    const invD = 1.0 / ray.direction.x;
    let t1 = (minX - ray.origin.x) * invD;
    let t2 = (maxX - ray.origin.x) * invD;
    let n1: Vec3 = { x: -1, y: 0, z: 0 };
    let n2: Vec3 = { x: 1, y: 0, z: 0 };
    if (t1 > t2) {
      const temp = t1; t1 = t2; t2 = temp;
      n1 = { x: 1, y: 0, z: 0 };
    }
    if (t1 > tmin) {
      tmin = t1;
      normal = n1;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return { hit: false, tNear: 0, tFar: 0, normal };
  }

  // Y axis
  if (Math.abs(ray.direction.y) < 1e-8) {
    if (ray.origin.y < minY || ray.origin.y > maxY) return { hit: false, tNear: 0, tFar: 0, normal };
  } else {
    const invD = 1.0 / ray.direction.y;
    let t1 = (minY - ray.origin.y) * invD;
    let t2 = (maxY - ray.origin.y) * invD;
    let n1: Vec3 = { x: 0, y: -1, z: 0 };
    if (t1 > t2) {
      const temp = t1; t1 = t2; t2 = temp;
      n1 = { x: 0, y: 1, z: 0 };
    }
    if (t1 > tmin) {
      tmin = t1;
      normal = n1;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return { hit: false, tNear: 0, tFar: 0, normal };
  }

  // Z axis
  if (Math.abs(ray.direction.z) < 1e-8) {
    if (ray.origin.z < minZ || ray.origin.z > maxZ) return { hit: false, tNear: 0, tFar: 0, normal };
  } else {
    const invD = 1.0 / ray.direction.z;
    let t1 = (minZ - ray.origin.z) * invD;
    let t2 = (maxZ - ray.origin.z) * invD;
    let n1: Vec3 = { x: 0, y: 0, z: -1 };
    if (t1 > t2) {
      const temp = t1; t1 = t2; t2 = temp;
      n1 = { x: 0, y: 0, z: 1 };
    }
    if (t1 > tmin) {
      tmin = t1;
      normal = n1;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return { hit: false, tNear: 0, tFar: 0, normal };
  }

  if (tmax < 0) return { hit: false, tNear: 0, tFar: 0, normal };

  return {
    hit: true,
    tNear: Math.max(0, tmin),
    tFar: tmax,
    normal,
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
  spatialGrid?: SpatialGrid
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

  // 1. Gather block intersections (accelerated via SpatialGrid if provided)
  if (spatialGrid) {
    spatialGrid.queryRay(ray, maxRange, (idx) => {
      const block = blocks[idx];
      const res = intersectRayAABB(
        ray,
        block.minX, block.maxX,
        block.minY, block.maxY,
        block.minZ, block.maxZ
      );
      if (res.hit && res.tNear <= maxRange) {
        candidates.push({
          type: 'block',
          distance: res.tNear,
          normal: res.normal,
          block,
          tNear: res.tNear,
          tFar: res.tFar,
        });
      }
    });
  } else {
    for (const block of blocks) {
      const res = intersectRayAABB(
        ray,
        block.minX, block.maxX,
        block.minY, block.maxY,
        block.minZ, block.maxZ
      );
      if (res.hit && res.tNear <= maxRange) {
        candidates.push({
          type: 'block',
          distance: res.tNear,
          normal: res.normal,
          block,
          tNear: res.tNear,
          tFar: res.tFar,
        });
      }
    }
  }

  // 2. Gather 5-Zone Target Hitbox intersections with 100% silhouette coverage & crouch support
  // Standing: Head [1.48..1.84] r=0.18, Chest [1.18..1.50] r=0.34, Stomach [0.88..1.18] r=0.34, Arms [0.95..1.48] r=0.45, Legs [0.00..0.88] r=0.30
  // Crouching: Head [0.96..1.32] r=0.18, Chest [0.72..1.02] r=0.35, Stomach [0.44..0.72] r=0.35, Arms [0.48..1.00] r=0.45, Legs [0.00..0.44] r=0.32
  for (const t of targets) {
    if (t.isDead) continue;
    const bx = t.center.x;
    const by = t.center.y;
    const bz = t.center.z;
    const hb = t.hitboxes;
    const isCrouched = !!t.isCrouched;

    // Fast bounding-sphere early out: distance to operator center
    const opCenter: Vec3 = isCrouched
      ? { x: bx, y: by + 0.65, z: bz }
      : { x: bx, y: by + 0.92, z: bz };
    const boundRadius = isCrouched ? 1.05 : 1.30;
    const boundCheck = intersectRaySphere(ray, opCenter, boundRadius);
    if (!boundCheck.hit || boundCheck.t > maxRange) {
      continue;
    }

    // Head Sphere (uses articulated bone position if available)
    const headDefaultY = isCrouched ? by + 1.14 : by + 1.66;
    const headPos = hb?.head ?? { x: bx, y: headDefaultY, z: bz };
    const headHit = intersectRaySphere(ray, headPos, 0.18);
    if (headHit.hit && headHit.t <= maxRange) {
      candidates.push({
        type: 'target',
        distance: headHit.t,
        normal: { x: 0, y: 0, z: 1 },
        target: t,
        hitZone: 'HEAD',
        tNear: headHit.t,
        tFar: headHit.t + 0.36,
      });
    }

    // Chest Cylinder / Box
    const chestX = hb?.chest?.x ?? bx;
    const chestZ = hb?.chest?.z ?? bz;
    const chestMinY = hb?.chest ? hb.chest.y - 0.16 : (isCrouched ? by + 0.72 : by + 1.18);
    const chestMaxY = hb?.chest ? hb.chest.y + 0.16 : (isCrouched ? by + 1.02 : by + 1.50);
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

    // Stomach Cylinder
    const stomX = hb?.stomach?.x ?? bx;
    const stomZ = hb?.stomach?.z ?? bz;
    const stomMinY = hb?.stomach ? hb.stomach.y - 0.15 : (isCrouched ? by + 0.44 : by + 0.88);
    const stomMaxY = hb?.stomach ? hb.stomach.y + 0.15 : (isCrouched ? by + 0.72 : by + 1.18);
    const stomHit = intersectRayVerticalCylinder(ray, stomX, stomZ, stomMinY, stomMaxY, 0.35);
    if (stomHit.hit && stomHit.t <= maxRange) {
      candidates.push({
        type: 'target',
        distance: stomHit.t,
        normal: { x: 0, y: 0, z: 1 },
        target: t,
        hitZone: 'STOMACH',
        tNear: stomHit.t,
        tFar: stomHit.t + 0.70,
      });
    }

    // Arms (Outer shoulder cylinders covering out to r=0.45)
    const armsMinY = isCrouched ? by + 0.48 : by + 0.95;
    const armsMaxY = isCrouched ? by + 1.00 : by + 1.48;
    const armsHit = intersectRayVerticalCylinder(ray, bx, bz, armsMinY, armsMaxY, 0.45);
    if (armsHit.hit && armsHit.t <= maxRange && !chestHit.hit) {
      candidates.push({
        type: 'target',
        distance: armsHit.t,
        normal: { x: 0, y: 0, z: 1 },
        target: t,
        hitZone: 'ARMS',
        tNear: armsHit.t,
        tFar: armsHit.t + 0.90,
      });
    }

    // Legs Cylinder (extends from ground y=0.00 up to pelvis, 100% continuous coverage)
    const legsMaxY = isCrouched ? by + 0.44 : by + 0.88;
    const legsHit = intersectRayVerticalCylinder(ray, bx, bz, by + 0.00, legsMaxY, 0.32);
    if (legsHit.hit && legsHit.t <= maxRange) {
      candidates.push({
        type: 'target',
        distance: legsHit.t,
        normal: { x: 0, y: 0, z: 1 },
        target: t,
        hitZone: 'LEGS',
        tNear: legsHit.t,
        tFar: legsHit.t + 0.64,
      });
    }
  }

  // 3. Sort chronologically along the ray path
  candidates.sort((a, b) => a.distance - b.distance);

  const results: RaycastHit[] = [];
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
      // 5-Zone Damage Multipliers
      let zoneMultiplier = 1.0;
      let isArmoredZone = false;

      switch (c.hitZone) {
        case 'HEAD':
          zoneMultiplier = HITBOX.HEAD_MULTIPLIER; // 4.0x
          isArmoredZone = c.target.hasHelmet;
          break;
        case 'CHEST':
          zoneMultiplier = HITBOX.CHEST_MULTIPLIER; // 1.0x
          isArmoredZone = c.target.armor > 0;
          break;
        case 'STOMACH':
          zoneMultiplier = HITBOX.STOMACH_MULTIPLIER; // 1.15x
          isArmoredZone = c.target.armor > 0;
          break;
        case 'ARMS':
          zoneMultiplier = HITBOX.ARMS_MULTIPLIER; // 0.75x
          isArmoredZone = c.target.armor > 0;
          break;
        case 'LEGS':
          zoneMultiplier = HITBOX.LEGS_MULTIPLIER; // 0.75x
          isArmoredZone = false; // Legs are unarmored in CS!
          break;
      }

      // Apply range dropoff: effective damage decays per 10m traveled
      const rangeDecay = Math.pow(rangeDropoff, c.distance / 10);
      const effectiveDamage = currentDamage * rangeDecay;

      const rawDamage = effectiveDamage * zoneMultiplier;
      let healthDamage = Math.round(rawDamage);
      let armorDamage = 0;

      if (isArmoredZone && c.target.armor > 0) {
        healthDamage = Math.round(rawDamage * armorPenetration);
        armorDamage = Math.round(rawDamage * (1 - armorPenetration) * 0.5);
      }

      results.push({
        hit: true,
        point: hitPoint,
        normal: c.normal,
        distance: c.distance,
        material: 'WOOD_THIN', // Flesh
        targetId: c.target.id,
        hitZone: c.hitZone,
        isHeadshot: c.hitZone === 'HEAD',
        awardedDamage: healthDamage,
        armorDamage,
        penetratedWalls: wallsPenetrated,
      });

      // Target absorbs bullet
      currentDamage = 0;
      break;
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

  // Check world concrete / opaque blocks
  if (spatialGrid) {
    let obstructed = false;
    spatialGrid.queryRay(ray, dist, (idx) => {
      const b = blocks[idx];
      const res = intersectRayAABB(ray, b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ);
      if (res.hit && res.tNear < dist && res.tNear > 0.05) {
        if (b.material === 'CONCRETE' || b.h >= 2.0) {
          obstructed = true;
          return true; // early exit traversal
        }
      }
    });
    if (obstructed) return false;
  } else {
    for (const b of blocks) {
      const res = intersectRayAABB(ray, b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ);
      if (res.hit && res.tNear < dist && res.tNear > 0.05) {
        if (b.material === 'CONCRETE') return false;
        if (b.h >= 2.0) return false;
      }
    }
  }

  // Check smoke occluders
  for (const s of smokeOccluders) {
    const hit = intersectRaySphere(ray, s.center, s.radius);
    if (hit.hit && hit.t < dist && hit.t > 0) {
      return false;
    }
  }

  return true;
}
