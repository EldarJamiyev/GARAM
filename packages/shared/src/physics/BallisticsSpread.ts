import { KINEMATICS } from '../constants/kinematics.js';
import { WeaponDef } from '../constants/weapons.js';
import { computeSpreadRayDirection, Vec3 } from './RaycastEngine.js';

/**
 * Deterministic 32-bit PRNG (Mulberry32) shared between authoritative server and client.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Computes exact angular spread radius (in radians) matching CS2 counter-strafing rules.
 * Stationary grounded rifles & scoped snipers have 0.0 first-shot inaccuracy.
 */
export function computeWeaponSpread(
  weapon: WeaponDef,
  horizontalSpeed: number,
  isGrounded: boolean,
  isCrouching: boolean,
  isScoped: boolean,
  consecutiveShots: number
): number {
  let spread = weapon.baseSpread;

  // Unscoped sniper hipfire penalty
  if (weapon.category === 'sniper' && !isScoped) {
    spread += 0.075;
  }

  // Movement inaccuracy (zero when stationary / counter-strafed <= 0.38 m/s)
  if (horizontalSpeed > KINEMATICS.PINPOINT_ACCURACY_THRESHOLD) {
    const moveFactor = Math.min(1.5, horizontalSpeed / Math.max(0.1, weapon.movementSpeed));
    spread += moveFactor * weapon.inaccuracyMove;
  }

  // Airborne penalty
  if (!isGrounded) {
    spread += weapon.inaccuracyJump;
  }

  // Consecutive shot firing bloom (0 on first shot)
  if (consecutiveShots > 0) {
    spread += Math.min(6, consecutiveShots) * weapon.inaccuracyFire;
  }

  // Crouching tightens bloom without eliminating airborne inaccuracy
  if (isCrouching && isGrounded) {
    spread *= weapon.crouchSpreadMultiplier;
  }

  return Math.max(0, spread);
}

export interface DeterministicShotResult {
  direction: Vec3;
  spread: number;
  recoilPitchRad: number;
  recoilYawRad: number;
}

/**
 * Computes deterministic shot ray direction from aim angles, spray pattern index,
 * movement/stance spread, and a shared shot seed.
 */
export function computeDeterministicShotDirection(
  yaw: number,
  pitch: number,
  weapon: WeaponDef,
  horizontalSpeed: number,
  isGrounded: boolean,
  isCrouching: boolean,
  isScoped: boolean,
  consecutiveShots: number,
  shotSeed: number
): DeterministicShotResult {
  const spread = computeWeaponSpread(
    weapon,
    horizontalSpeed,
    isGrounded,
    isCrouching,
    isScoped,
    consecutiveShots
  );

  // Deterministic spray pattern offset (sprayPattern[0] is strictly [0, 0])
  let recoilPitchRad = 0;
  let recoilYawRad = 0;
  if (weapon.sprayPattern.length > 0 && consecutiveShots > 0) {
    const idx = Math.min(consecutiveShots, weapon.sprayPattern.length - 1);
    const [pitchDeg, yawDeg] = weapon.sprayPattern[idx];
    const degToRad = Math.PI / 180;
    const crouchScale = isCrouching && isGrounded ? weapon.crouchSpreadMultiplier : 1.0;
    recoilPitchRad = pitchDeg * degToRad * crouchScale;
    recoilYawRad = yawDeg * degToRad * crouchScale;
  }

  let sx = 0;
  let sy = 0;
  if (spread > 1e-6) {
    const rand = mulberry32(shotSeed);
    // Uniform distribution inside disk of radius `spread`
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * spread;
    sx = Math.cos(angle) * radius;
    sy = Math.sin(angle) * radius;
  }

  const effectivePitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, pitch + recoilPitchRad));
  const effectiveYaw = yaw + recoilYawRad;

  const direction = computeSpreadRayDirection(effectiveYaw, effectivePitch, sx, sy);

  return {
    direction,
    spread,
    recoilPitchRad,
    recoilYawRad,
  };
}
