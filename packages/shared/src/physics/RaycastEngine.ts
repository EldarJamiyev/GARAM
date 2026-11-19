import { MapBlockCollider, SurfaceMaterial, SURFACE_MATERIALS, Vec3 } from '../maps/DeCitadelData.js';

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

export interface RaycastHit {
  hit: boolean;
  point: Vec3;
  normal: Vec3;
  distance: number;
  material: SurfaceMaterial;
  blockId?: string;
  targetId?: string;
  isHeadshot?: boolean;
  awardedDamage: number;
  penetratedWalls: number;
}

export interface TargetCollider {
  id: string;
  name: string;
  team: 'Vanguard' | 'Syndicate';
  headCenter: Vec3;
  headRadius: number;
  bodyCenter: Vec3;
  bodyRadius: number;
  bodyHeight: number;
  isDead: boolean;
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
 * Ray-Vertical Cylinder intersection for player body
 */
export function intersectRayVerticalCylinder(
  ray: Ray,
  center: Vec3,
  radius: number,
  height: number
): { hit: boolean; t: number } {
  const ocX = ray.origin.x - center.x;
  const ocZ = ray.origin.z - center.z;

  const a = ray.direction.x * ray.direction.x + ray.direction.z * ray.direction.z;
  if (a < 1e-8) {
    // Ray parallel to cylinder axis
    if (ocX * ocX + ocZ * ocZ <= radius * radius) {
      const minY = center.y - height / 2;
      const maxY = center.y + height / 2;
      if (ray.direction.y > 0 && ray.origin.y < minY) {
        return { hit: true, t: (minY - ray.origin.y) / ray.direction.y };
      }
      if (ray.direction.y < 0 && ray.origin.y > maxY) {
        return { hit: true, t: (maxY - ray.origin.y) / ray.direction.y };
      }
    }
    return { hit: false, t: -1 };
  }

  const b = 2 * (ocX * ray.direction.x + ocZ * ray.direction.z);
  const c = ocX * ocX + ocZ * ocZ - radius * radius;
  const discriminant = b * b - 4 * a * c;

  if (discriminant < 0) return { hit: false, t: -1 };

  const sqrtDisc = Math.sqrt(discriminant);
  const t0 = (-b - sqrtDisc) / (2 * a);
  const t1 = (-b + sqrtDisc) / (2 * a);

  const minY = center.y - height / 2;
  const maxY = center.y + height / 2;

  if (t0 > 0) {
    const y0 = ray.origin.y + ray.direction.y * t0;
    if (y0 >= minY && y0 <= maxY) return { hit: true, t: t0 };
  }
  if (t1 > 0) {
    const y1 = ray.origin.y + ray.direction.y * t1;
    if (y1 >= minY && y1 <= maxY) return { hit: true, t: t1 };
  }

  return { hit: false, t: -1 };
}

/**
 * Perform a deterministic, distance-sorted tactical raycast with multi-material penetration.
 */
export function executeTacticalRaycast(
  ray: Ray,
  baseDamage: number,
  headMultiplier: number,
  maxRange = 250,
  blocks: MapBlockCollider[] = [],
  targets: TargetCollider[] = []
): RaycastHit[] {
  interface HitCandidate {
    type: 'block' | 'target_head' | 'target_body';
    distance: number;
    normal: Vec3;
    block?: MapBlockCollider;
    target?: TargetCollider;
    tNear: number;
    tFar: number;
  }

  const candidates: HitCandidate[] = [];

  // 1. Gather all block intersections
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

  // 2. Gather all target intersections (Head sphere + Body cylinder)
  for (const t of targets) {
    if (t.isDead) continue;

    // Head
    const headHit = intersectRaySphere(ray, t.headCenter, t.headRadius);
    if (headHit.hit && headHit.t <= maxRange) {
      const normal: Vec3 = {
        x: (ray.origin.x + ray.direction.x * headHit.t - t.headCenter.x) / t.headRadius,
        y: (ray.origin.y + ray.direction.y * headHit.t - t.headCenter.y) / t.headRadius,
        z: (ray.origin.z + ray.direction.z * headHit.t - t.headCenter.z) / t.headRadius,
      };
      candidates.push({
        type: 'target_head',
        distance: headHit.t,
        normal,
        target: t,
        tNear: headHit.t,
        tFar: headHit.t + t.headRadius * 2,
      });
    }

    // Body
    const bodyHit = intersectRayVerticalCylinder(ray, t.bodyCenter, t.bodyRadius, t.bodyHeight);
    if (bodyHit.hit && bodyHit.t <= maxRange) {
      const normal: Vec3 = {
        x: (ray.origin.x + ray.direction.x * bodyHit.t - t.bodyCenter.x) / t.bodyRadius,
        y: 0,
        z: (ray.origin.z + ray.direction.z * bodyHit.t - t.bodyCenter.z) / t.bodyRadius,
      };
      candidates.push({
        type: 'target_body',
        distance: bodyHit.t,
        normal,
        target: t,
        tNear: bodyHit.t,
        tFar: bodyHit.t + t.bodyRadius * 2,
      });
    }
  }

  // 3. Sort chronologically along the ray path
  candidates.sort((a, b) => a.distance - b.distance);

  const results: RaycastHit[] = [];
  let currentDamage = baseDamage;
  let wallsPenetrated = 0;

  for (const c of candidates) {
    if (currentDamage <= 0) break;

    const hitPoint: Vec3 = {
      x: ray.origin.x + ray.direction.x * c.distance,
      y: ray.origin.y + ray.direction.y * c.distance,
      z: ray.origin.z + ray.direction.z * c.distance,
    };

    if (c.type === 'block' && c.block) {
      const mat = c.block.material;
      const matProps = SURFACE_MATERIALS[mat];

      results.push({
        hit: true,
        point: hitPoint,
        normal: c.normal,
        distance: c.distance,
        material: mat,
        blockId: c.block.id,
        awardedDamage: 0,
        penetratedWalls: wallsPenetrated,
      });

      // If impenetrable concrete, bullet stops dead!
      if (matProps.isImpenetrable) {
        currentDamage = 0;
        break;
      }

      // Compute wall thickness
      const thickness = Math.max(0.05, c.tFar - c.tNear);
      if (thickness > matProps.maxThickness) {
        // Wall is too thick to penetrate
        currentDamage = 0;
        break;
      }

      // Penetrate: Damage_exit = Damage_entry * mu - thickness * cost
      currentDamage = currentDamage * matProps.mu - thickness * matProps.cost;
      wallsPenetrated++;

      if (currentDamage <= 2) {
        currentDamage = 0;
        break;
      }
    } else if (c.target) {
      const isHead = c.type === 'target_head';
      const dmg = Math.round(currentDamage * (isHead ? headMultiplier : 1.0));

      results.push({
        hit: true,
        point: hitPoint,
        normal: c.normal,
        distance: c.distance,
        material: 'WOOD_THIN', // Flesh equivalent
        targetId: c.target.id,
        isHeadshot: isHead,
        awardedDamage: dmg,
        penetratedWalls: wallsPenetrated,
      });

      // Target absorbs damage; bullet terminates on human target
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
  smokeOccluders: SmokeOccluder[] = []
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
  for (const b of blocks) {
    const res = intersectRayAABB(ray, b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ);
    if (res.hit && res.tNear < dist && res.tNear > 0.05) {
      // Concrete stops line of sight completely
      if (b.material === 'CONCRETE') return false;
      // Tall crates also break vision
      if (b.h >= 2.0) return false;
    }
  }

  // Check smoke occluders
  for (const s of smokeOccluders) {
    const hit = intersectRaySphere(ray, s.center, s.radius);
    if (hit.hit && hit.t < dist && hit.t > 0) {
      return false; // Smoke blocks vision
    }
  }

  return true;
}
