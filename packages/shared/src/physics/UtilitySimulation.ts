import { MapBlockCollider, Vec3 } from '../maps/DeCitadelData.js';
import { hasLineOfSight } from './RaycastEngine.js';
import { SpatialGrid } from './SpatialGrid.js';
import type { MapBounds } from './KinematicPlayerController.js';

export interface GrenadeStepResult {
  bounced: boolean;
  hitGround: boolean;
}

export interface GrenadeTrajectoryResult {
  finalPos: Vec3;
  finalVel: Vec3;
  bounces: number;
}

const DEFAULT_GRENADE_BOUNDS: MapBounds = {
  minX: -96,
  maxX: 96,
  minZ: -96,
  maxZ: 96,
};

/**
 * Advances a grenade projectile by `dt` seconds against static map AABBs with
 * exact closest-point normal reflection and CS2 sloped-ramp lip smoothing so
 * grenades never clip walls or bounce backwards off stepped voxel ramps.
 */
export function stepGrenadePhysics(
  pos: Vec3,
  vel: Vec3,
  dt: number,
  colliders: MapBlockCollider[],
  radius = 0.08,
  restitution = 0.45,
  gravity = 15.5,
  spatialGrid?: SpatialGrid,
  bounds?: MapBounds
): GrenadeStepResult {
  let bounced = false;
  let hitGround = false;

  // Integrate gravity and position
  vel.y -= gravity * dt;
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  pos.z += vel.z * dt;

  // Floor plane bounce (y = 0)
  if (pos.y < radius) {
    pos.y = radius;
    if (vel.y < -0.6) {
      vel.y = -vel.y * restitution;
      bounced = true;
    } else {
      vel.y = 0;
    }
    vel.x *= 0.80;
    vel.z *= 0.80;
    hitGround = true;
  }

  const resolveBlock = (b: MapBlockCollider): void => {
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cy = Math.max(b.minY, Math.min(pos.y, b.maxY));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));

    const dx = pos.x - cx;
    const dy = pos.y - cy;
    const dz = pos.z - cz;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq >= radius * radius) return;

    let nx = 0;
    let ny = 0;
    let nz = 0;
    let pen = 0;

    if (distSq > 1e-8) {
      const dist = Math.sqrt(distSq);
      nx = dx / dist;
      ny = dy / dist;
      nz = dz / dist;
      pen = radius - dist;
    } else {
      // Inside AABB: eject along shallowest face
      const dMinX = Math.abs(pos.x - b.minX);
      const dMaxX = Math.abs(b.maxX - pos.x);
      const dMinY = Math.abs(pos.y - b.minY);
      const dMaxY = Math.abs(b.maxY - pos.y);
      const dMinZ = Math.abs(pos.z - b.minZ);
      const dMaxZ = Math.abs(b.maxZ - pos.z);
      const m = Math.min(dMinX, dMaxX, dMinY, dMaxY, dMinZ, dMaxZ);
      if (m === dMinX) { nx = -1; pen = dMinX + radius; }
      else if (m === dMaxX) { nx = 1; pen = dMaxX + radius; }
      else if (m === dMinY) { ny = -1; pen = dMinY + radius; }
      else if (m === dMaxY) { ny = 1; pen = dMaxY + radius; }
      else if (m === dMinZ) { nz = -1; pen = dMinZ + radius; }
      else { nz = 1; pen = dMaxZ + radius; }
    }

    pos.x += nx * (pen + 0.001);
    pos.y += ny * (pen + 0.001);
    pos.z += nz * (pen + 0.001);

    // Smooth low voxel ramp/stair lip hits so grenades rolling across Dust 2 A Ramp,
    // Pit, or Short Stairs deflect smoothly up the slope instead of rebounding backward.
    const lipBelowTop = b.maxY - pos.y;
    const isLowRampLip =
      Math.abs(ny) < 0.35 &&
      lipBelowTop > -radius &&
      lipBelowTop <= 0.34 &&
      b.maxY - b.minY <= 1.25;

    let rnx = nx;
    let rny = ny;
    let rnz = nz;
    if (isLowRampLip) {
      const slopeLen = Math.hypot(nx * 0.42, 0.90, nz * 0.42);
      rnx = (nx * 0.42) / slopeLen;
      rny = 0.90 / slopeLen;
      rnz = (nz * 0.42) / slopeLen;
      pos.y = Math.max(pos.y, b.maxY + radius * 0.5);
    }

    const vn = vel.x * rnx + vel.y * rny + vel.z * rnz;
    if (vn < 0) {
      vel.x -= (1 + restitution) * vn * rnx;
      vel.y -= (1 + restitution) * vn * rny;
      vel.z -= (1 + restitution) * vn * rnz;
      if (rny > 0.7) {
        vel.x *= 0.80;
        vel.z *= 0.80;
        hitGround = true;
      }
      bounced = true;
    }
  };

  if (spatialGrid) {
    spatialGrid.queryAABB(
      pos.x - radius - 0.1,
      pos.x + radius + 0.1,
      pos.z - radius - 0.1,
      pos.z + radius + 0.1,
      (idx) => {
        resolveBlock(colliders[idx]);
      }
    );
  } else {
    for (let i = 0; i < colliders.length; i++) {
      resolveBlock(colliders[i]);
    }
  }

  // Clamp inside active map bounds (e.g. DE_DUST2 extends to minX=-68 for Pit & A Long)
  const activeBounds = bounds ?? DEFAULT_GRENADE_BOUNDS;
  const pad = radius + 0.12;
  pos.x = Math.max(activeBounds.minX + pad, Math.min(activeBounds.maxX - pad, pos.x));
  pos.z = Math.max(activeBounds.minZ + pad, Math.min(activeBounds.maxZ - pad, pos.z));

  return { bounced, hitGround };
}

/**
 * Simulates a complete grenade arc for `fuseSec` seconds (or until ground detonation for molotovs).
 */
export function simulateGrenadeTrajectory(
  origin: Vec3,
  velocity: Vec3,
  fuseSec: number,
  colliders: MapBlockCollider[],
  detonateOnGround = false,
  dt = 1 / 64,
  spatialGrid?: SpatialGrid,
  bounds?: MapBounds
): GrenadeTrajectoryResult {
  const pos: Vec3 = { x: origin.x, y: origin.y, z: origin.z };
  const vel: Vec3 = { x: velocity.x, y: velocity.y, z: velocity.z };
  const steps = Math.max(1, Math.ceil(fuseSec / dt));
  let bounces = 0;

  for (let i = 0; i < steps; i++) {
    const res = stepGrenadePhysics(pos, vel, dt, colliders, 0.08, 0.45, 15.5, spatialGrid, bounds);
    if (res.bounced) bounces++;
    if (detonateOnGround && res.hitGround) break;
  }

  return { finalPos: pos, finalVel: vel, bounces };
}

/**
 * Calculates authoritative High-Explosive (HE) grenade damage with radial falloff,
 * solid wall occlusion check, and Kevlar armor mitigation.
 */
export function computeHEDamage(
  explosionPos: Vec3,
  targetBaseCenter: Vec3,
  targetArmor: number,
  blocks: MapBlockCollider[],
  spatialGrid?: SpatialGrid,
  maxRadius = 8.5,
  maxDamage = 98
): { healthDamage: number; armorDamage: number } {
  const targetChest: Vec3 = {
    x: targetBaseCenter.x,
    y: targetBaseCenter.y + 1.0,
    z: targetBaseCenter.z,
  };
  const dist = Math.hypot(
    targetChest.x - explosionPos.x,
    targetChest.y - explosionPos.y,
    targetChest.z - explosionPos.z
  );

  if (dist >= maxRadius) return { healthDamage: 0, armorDamage: 0 };

  const blastOrigin: Vec3 = {
    x: explosionPos.x,
    y: explosionPos.y + 0.15,
    z: explosionPos.z,
  };

  // Solid walls block explosive shrapnel (smoke does NOT block blast waves)
  if (!hasLineOfSight(blastOrigin, targetChest, blocks, [], spatialGrid)) {
    return { healthDamage: 0, armorDamage: 0 };
  }

  const falloff = Math.max(0, 1 - dist / maxRadius);
  const rawDamage = maxDamage * falloff * falloff;
  if (rawDamage < 1) return { healthDamage: 0, armorDamage: 0 };

  const armorPen = 0.60;
  if (targetArmor > 0) {
    return {
      healthDamage: Math.round(rawDamage * armorPen),
      armorDamage: Math.round(rawDamage * (1 - armorPen) * 0.5),
    };
  }
  return {
    healthDamage: Math.round(rawDamage),
    armorDamage: 0,
  };
}

/**
 * Calculates authoritative Molotov incendiary burn damage for a single tick (`dt` seconds).
 */
export function computeMolotovTickDamage(
  fireCenter: Vec3,
  fireRadius: number,
  targetBaseCenter: Vec3,
  dt: number,
  targetArmor: number,
  dps = 40
): { healthDamage: number; armorDamage: number } {
  const dx = targetBaseCenter.x - fireCenter.x;
  const dz = targetBaseCenter.z - fireCenter.z;
  const dy = Math.abs(targetBaseCenter.y - fireCenter.y);

  if (dx * dx + dz * dz > fireRadius * fireRadius || dy > 1.8) {
    return { healthDamage: 0, armorDamage: 0 };
  }

  const raw = dps * dt;
  const armorPen = 0.90;
  if (targetArmor > 0) {
    return {
      healthDamage: raw * armorPen,
      armorDamage: raw * (1 - armorPen) * 0.5,
    };
  }
  return { healthDamage: raw, armorDamage: 0 };
}
