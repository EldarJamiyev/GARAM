import { KINEMATICS } from '../constants/kinematics.js';
import type { SpatialGrid } from './SpatialGrid.js';

export interface KinematicSnapshot {
  state: PlayerState;
  prevState: { x: number; y: number; z: number; currentEyeHeight: number };
  actualCrouching: boolean;
  stepOffsetY: number;
  taggingFactor: number;
  landingSpeedFactor: number;
  landingCameraDip: number;
  crouchStamina: number;
  prevCrouchInput: boolean;
  airEntryMaxSpeed: number;
}

export interface PlayerInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  crouch: boolean;
  walk: boolean;
  yaw: number;
  pitch: number;
}

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  isGrounded: boolean;
  isCrouching: boolean;
  isWalking: boolean;
  currentEyeHeight: number;
}

export interface AABBCollider {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const DEFAULT_MAP_BOUNDS: MapBounds = {
  minX: -47,
  maxX: 47,
  minZ: -45,
  maxZ: 45,
};

/**
 * Checks if a cylinder capsule overlaps an AABB box vertically and horizontally
 */
export function testCapsuleAABBOverlap(
  px: number,
  py: number,
  pz: number,
  r: number,
  h: number,
  b: AABBCollider
): boolean {
  // Vertical test
  if (py >= b.maxY || py + h <= b.minY) return false;

  // Clamped horizontal distance
  const cx = Math.max(b.minX, Math.min(px, b.maxX));
  const cz = Math.max(b.minZ, Math.min(pz, b.maxZ));

  const dx = px - cx;
  const dz = pz - cz;

  return (dx * dx + dz * dz) < (r * r);
}

/**
 * Checks if there is headroom clearance above base Y for a standing height
 */
export function hasHeadClearance(
  px: number,
  baseY: number,
  pz: number,
  height: number,
  colliders: AABBCollider[],
  ignoreBox?: AABBCollider
): boolean {
  for (const b of colliders) {
    if (b === ignoreBox) continue;
    if (testCapsuleAABBOverlap(px, baseY, pz, KINEMATICS.CAPSULE_RADIUS, height, b)) {
      return false;
    }
  }
  return true;
}

export interface HorizontalResolutionResult {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  stepped: boolean;
}

/**
 * Reusable horizontal AABB collision resolution with smooth continuous sliding and auto-step.
 * Uses exact Circle-AABB closest-point projection and collision normal deflection.
 * Used identically for both player and AI bots to prevent clipping through walls and eliminates kickback.
 */
export function resolveHorizontalAABB(
  startX: number,
  startY: number,
  startZ: number,
  vx: number,
  vz: number,
  dt: number,
  radius: number,
  height: number,
  colliders: AABBCollider[],
  canStep = true,
  maxStep = KINEMATICS.STEP_HEIGHT,
  bounds: MapBounds = DEFAULT_MAP_BOUNDS,
  isAirTuck = false,
  tuckOffset = 0.55
): HorizontalResolutionResult {
  let curX = startX;
  let curY = startY;
  let curZ = startZ;
  let outVx = vx;
  let outVz = vz;
  let didStep = false;

  // Substepping prevents tunneling even at high velocities
  const moveDist = Math.hypot(vx * dt, vz * dt);
  const numSteps = Math.max(1, Math.min(6, Math.ceil(moveDist / (radius * 0.35))));
  const subDt = dt / numSteps;

  for (let s = 0; s < numSteps; s++) {
    const stepPrevX = curX;
    const stepPrevZ = curZ;

    // Integrate velocity for this substep
    curX += outVx * subDt;
    curZ += outVz * subDt;

    // 4 Iterative solver passes (handles corners, tight crevices, and multi-box intersections)
    for (let pass = 0; pass < 4; pass++) {
      // Pass pre-scan: select the lowest valid step-up riser first so voxel stairs/ramps
      // never deflect horizontally off an adjacent higher block before stepping up smoothly.
      if (canStep || isAirTuck) {
        const effectiveFeetY = curY + (isAirTuck ? tuckOffset : 0);
        let bestStepY = Infinity;
        let bestStepBox: AABBCollider | null = null;
        for (const b of colliders) {
          if (effectiveFeetY >= b.maxY || curY + height <= b.minY) continue;
          const stepDiff = b.maxY - effectiveFeetY;
          if (stepDiff > 0 && stepDiff <= maxStep && b.maxY < bestStepY) {
            const cx = Math.max(b.minX, Math.min(curX, b.maxX));
            const cz = Math.max(b.minZ, Math.min(curZ, b.maxZ));
            const dx = curX - cx;
            const dz = curZ - cz;
            if ((dx * dx + dz * dz) < (radius * radius)) {
              if (hasHeadClearance(curX, b.maxY, curZ, height, colliders, b)) {
                bestStepY = b.maxY;
                bestStepBox = b;
              }
            }
          }
        }
        if (bestStepBox !== null) {
          curY = bestStepY;
          didStep = true;
        }
      }

      for (const b of colliders) {
        // Vertical height check with mid-air crouch-jump tuck clearance
        const effectiveFeetY = curY + (isAirTuck ? tuckOffset : 0);
        if (effectiveFeetY >= b.maxY || curY + height <= b.minY) continue;

        // Secondary step-up check in case a horizontal slide moved onto a new riser mid-pass
        const stepDiff = b.maxY - (isAirTuck ? effectiveFeetY : curY);
        const canStepNow = canStep || (isAirTuck && stepDiff <= maxStep);
        if (canStepNow && stepDiff > 0 && stepDiff <= maxStep) {
          const cx = Math.max(b.minX, Math.min(curX, b.maxX));
          const cz = Math.max(b.minZ, Math.min(curZ, b.maxZ));
          const dx = curX - cx;
          const dz = curZ - cz;
          if ((dx * dx + dz * dz) < (radius * radius)) {
            if (hasHeadClearance(curX, b.maxY, curZ, height, colliders, b)) {
              curY = b.maxY;
              didStep = true;
              continue;
            }
          }
        }

        // Closest point on AABB to cylinder center
        const cx = Math.max(b.minX, Math.min(curX, b.maxX));
        const cz = Math.max(b.minZ, Math.min(curZ, b.maxZ));
        const dx = curX - cx;
        const dz = curZ - cz;
        const distSq = dx * dx + dz * dz;

        if (distSq < radius * radius) {
          if (distSq > 0.000001) {
            // Case 1: Circle center is outside box, touching face or corner
            const dist = Math.sqrt(distSq);
            const pen = radius - dist;
            const nx = dx / dist;
            const nz = dz / dist;

            // Push out along collision normal
            curX += nx * (pen + 0.001);
            curZ += nz * (pen + 0.001);

            // Project velocity onto tangent plane (remove velocity into surface, preserve slide)
            const vn = outVx * nx + outVz * nz;
            if (vn < 0) {
              outVx -= vn * nx;
              outVz -= vn * nz;
            }
          } else {
            // Case 2: Circle center penetrated INSIDE the box
            // Priority: Push back towards where the player came from (stepPrevX, stepPrevZ)
            // This prevents teleporting to the other side of thin walls or doors!
            const fromPrevX = curX - stepPrevX;
            const fromPrevZ = curZ - stepPrevZ;
            const travelDist = Math.hypot(fromPrevX, fromPrevZ);

            if (travelDist > 0.0001) {
              // Eject along reverse movement vector
              const revX = -fromPrevX / travelDist;
              const revZ = -fromPrevZ / travelDist;
              curX = stepPrevX + revX * 0.01;
              curZ = stepPrevZ + revZ * 0.01;
              outVx = 0;
              outVz = 0;
            } else {
              // Fallback to closest boundary face
              const distMinX = curX - b.minX;
              const distMaxX = b.maxX - curX;
              const distMinZ = curZ - b.minZ;
              const distMaxZ = b.maxZ - curZ;
              const minDist = Math.min(distMinX, distMaxX, distMinZ, distMaxZ);

              if (minDist === distMinX) {
                curX = b.minX - radius - 0.002;
                if (outVx > 0) outVx = 0;
              } else if (minDist === distMaxX) {
                curX = b.maxX + radius + 0.002;
                if (outVx < 0) outVx = 0;
              } else if (minDist === distMinZ) {
                curZ = b.minZ - radius - 0.002;
                if (outVz > 0) outVz = 0;
              } else {
                curZ = b.maxZ + radius + 0.002;
                if (outVz < 0) outVz = 0;
              }
            }
          }
        }
      }
    }
  }

  // Map bounds perimeter clamp (e.g. walls at +/-58.5 with radius = 0.36 -> clamp at +/-58.14)
  curX = Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, curX));
  curZ = Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, curZ));

  return {
    x: curX,
    y: curY,
    z: curZ,
    vx: outVx,
    vz: outVz,
    stepped: didStep,
  };
}

export class KinematicPlayerController {
  public state: PlayerState;
  public prevState: { x: number; y: number; z: number; currentEyeHeight: number };
  public radius = KINEMATICS.CAPSULE_RADIUS;
  public actualCrouching = false;

  // Sprint E2 Tournament Kinematics depth
  public stepOffsetY = 0;              // Smooth vertical step camera damping
  public taggingFactor = 1.0;          // Bullet tagging deceleration (0.55x-0.72x recovering to 1.0)
  public landingSpeedFactor = 1.0;      // Hard touchdown recovery damping (0.82x recovering to 1.0)
  public landingCameraDip = 0;         // Camera dip on landing (m)
  public crouchStamina = 1.0;          // Crouch stamina (0.1 to 1.0) to prevent duck-spam
  private prevCrouchInput = false;
  private airEntryMaxSpeed = KINEMATICS.SPEED_RIFLE * 1.25;
  private readonly nearbyCollidersScratch: AABBCollider[] = [];

  constructor(startX = 0, startY = 0, startZ = 25) {
    this.state = {
      x: startX,
      y: startY,
      z: startZ,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      isGrounded: true,
      isCrouching: false,
      isWalking: false,
      currentEyeHeight: KINEMATICS.EYE_HEIGHT_STAND,
    };
    this.prevState = {
      x: startX,
      y: startY,
      z: startZ,
      currentEyeHeight: KINEMATICS.EYE_HEIGHT_STAND,
    };
  }

  public exportSnapshot(): KinematicSnapshot {
    return {
      state: { ...this.state },
      prevState: { ...this.prevState },
      actualCrouching: this.actualCrouching,
      stepOffsetY: this.stepOffsetY,
      taggingFactor: this.taggingFactor,
      landingSpeedFactor: this.landingSpeedFactor,
      landingCameraDip: this.landingCameraDip,
      crouchStamina: this.crouchStamina,
      prevCrouchInput: this.prevCrouchInput,
      airEntryMaxSpeed: this.airEntryMaxSpeed,
    };
  }

  public importSnapshot(snap: KinematicSnapshot): void {
    this.state = { ...snap.state };
    this.prevState = { ...snap.prevState };
    this.actualCrouching = snap.actualCrouching;
    this.stepOffsetY = snap.stepOffsetY;
    this.taggingFactor = snap.taggingFactor;
    this.landingSpeedFactor = snap.landingSpeedFactor;
    this.landingCameraDip = snap.landingCameraDip;
    this.crouchStamina = snap.crouchStamina;
    this.prevCrouchInput = snap.prevCrouchInput;
    this.airEntryMaxSpeed = snap.airEntryMaxSpeed;
  }

  /**
   * Applies bullet tagging deceleration to the player
   * @param tagPower fraction of max speed to retain (e.g. 0.55 for rifle hit, 0.65 for pistol hit)
   */
  public applyTagging(tagPower = 0.58): void {
    this.taggingFactor = Math.min(this.taggingFactor, Math.max(0.40, tagPower));
  }

  /**
   * Retrieves sub-tick interpolated camera & player position for zero-jitter rendering
   * @param alpha interpolation factor between 0.0 (previous tick) and 1.0 (current tick)
   */
  public getInterpolatedPosition(alpha: number): { x: number; y: number; z: number; eyeY: number } {
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    const x = this.prevState.x + (this.state.x - this.prevState.x) * clampedAlpha;
    const y = this.prevState.y + (this.state.y - this.prevState.y) * clampedAlpha;
    const z = this.prevState.z + (this.state.z - this.prevState.z) * clampedAlpha;
    const eyeHeight = this.prevState.currentEyeHeight + (this.state.currentEyeHeight - this.prevState.currentEyeHeight) * clampedAlpha;
    const eyeY = y + eyeHeight + this.stepOffsetY - this.landingCameraDip;
    return { x, y, z, eyeY };
  }

  public update(
    input: PlayerInput,
    dt: number,
    weaponMaxSpeed = KINEMATICS.SPEED_RIFLE,
    colliders: AABBCollider[] = [],
    bounds: MapBounds = DEFAULT_MAP_BOUNDS,
    spatialGrid?: SpatialGrid
  ): void {
    // Store previous physics state before ticking for sub-tick render interpolation
    this.prevState.x = this.state.x;
    this.prevState.y = this.state.y;
    this.prevState.z = this.state.z;
    this.prevState.currentEyeHeight = this.state.currentEyeHeight;

    this.state.yaw = input.yaw;
    this.state.pitch = input.pitch;
    this.state.isWalking = input.walk;

    // SpatialGrid broadphase culling for static arena colliders (reduces O(N) checks to O(local))
    let activeColliders = colliders;
    if (spatialGrid && colliders.length > 0) {
      const reach = this.radius + Math.max(1.5, Math.hypot(this.state.vx, this.state.vz) * dt + 1.0);
      this.nearbyCollidersScratch.length = 0;
      spatialGrid.queryAABB(
        this.state.x - reach,
        this.state.x + reach,
        this.state.z - reach,
        this.state.z + reach,
        (idx) => {
          const b = colliders[idx];
          if (b) this.nearbyCollidersScratch.push(b);
        }
      );
      activeColliders = this.nearbyCollidersScratch;
    }

    // Crouch stamina decay on crouch transition
    if (input.crouch !== this.prevCrouchInput) {
      this.crouchStamina = Math.max(0.15, this.crouchStamina - 0.28);
      this.prevCrouchInput = input.crouch;
    } else {
      this.crouchStamina = Math.min(1.0, this.crouchStamina + dt * 0.75);
    }

    // Headroom check when uncrouching
    if (input.crouch) {
      this.actualCrouching = true;
    } else if (this.actualCrouching) {
      // Check ceiling clearance before expanding to standing height
      if (hasHeadClearance(this.state.x, this.state.y, this.state.z, KINEMATICS.CAPSULE_HEIGHT_STAND, activeColliders)) {
        this.actualCrouching = false;
      }
    }
    this.state.isCrouching = this.actualCrouching;

    // Eye height interpolation with crouch stamina scaling
    const targetEyeHeight = this.actualCrouching ? KINEMATICS.EYE_HEIGHT_CROUCH : KINEMATICS.EYE_HEIGHT_STAND;
    const effectiveCrouchLerp = KINEMATICS.CROUCH_LERP_SPEED * (0.35 + 0.65 * this.crouchStamina);
    this.state.currentEyeHeight += (targetEyeHeight - this.state.currentEyeHeight) * (1 - Math.exp(-effectiveCrouchLerp * dt));

    // Stance speed calculation with tagging and landing recovery multipliers
    let maxSpeed = weaponMaxSpeed;
    if (this.actualCrouching) {
      maxSpeed = KINEMATICS.SPEED_CROUCH;
    } else if (input.walk) {
      maxSpeed = KINEMATICS.SPEED_WALK_SILENT;
    }

    // Apply active tagging and landing recovery
    maxSpeed *= this.taggingFactor * this.landingSpeedFactor;

    // Recover tagging factor towards 1.0
    if (this.taggingFactor < 1.0) {
      this.taggingFactor += (1.0 - this.taggingFactor) * (1 - Math.exp(-4.2 * dt));
      if (this.taggingFactor > 0.99) this.taggingFactor = 1.0;
    }

    // Recover landing speed factor towards 1.0
    if (this.landingSpeedFactor < 1.0) {
      this.landingSpeedFactor += (1.0 - this.landingSpeedFactor) * (1 - Math.exp(-12.0 * dt));
      if (this.landingSpeedFactor > 0.99) this.landingSpeedFactor = 1.0;
    }

    // Relax step damping camera offset towards 0
    if (Math.abs(this.stepOffsetY) > 0.0001) {
      this.stepOffsetY += (0 - this.stepOffsetY) * (1 - Math.exp(-22.0 * dt));
      if (Math.abs(this.stepOffsetY) < 0.001) this.stepOffsetY = 0;
    }

    // Relax landing camera dip towards 0
    if (this.landingCameraDip > 0.0001) {
      this.landingCameraDip += (0 - this.landingCameraDip) * (1 - Math.exp(-18.0 * dt));
      if (this.landingCameraDip < 0.001) this.landingCameraDip = 0;
    }

    // Direction vector in local space
    let moveX = 0;
    let moveZ = 0;
    if (input.forward) moveZ -= 1;
    if (input.backward) moveZ += 1;
    if (input.left) moveX -= 1;
    if (input.right) moveX += 1;

    const length = Math.hypot(moveX, moveZ);
    let wishDirX = 0;
    let wishDirZ = 0;

    if (length > 0.0001) {
      const normX = moveX / length;
      const normZ = moveZ / length;

      const sinYaw = Math.sin(this.state.yaw);
      const cosYaw = Math.cos(this.state.yaw);

      wishDirX = normX * cosYaw + normZ * sinYaw;
      wishDirZ = -normX * sinYaw + normZ * cosYaw;
    }

    const wasGrounded = this.state.isGrounded;
    const prevVy = this.state.vy;
    const prevY = this.state.y;

    // Ground counter-strafing kinematics
    if (this.state.isGrounded) {
      const currentHozSpeed = Math.hypot(this.state.vx, this.state.vz);

      // Source-accurate ground friction with STOP_SPEED to eliminate exponential ice-skating tail
      if (currentHozSpeed > 0.0001) {
        const control = Math.max(currentHozSpeed, KINEMATICS.STOP_SPEED);
        const drop = control * KINEMATICS.FRICTION_GROUND * dt;
        const newSpeed = Math.max(0, currentHozSpeed - drop);
        const frictionRatio = newSpeed / currentHozSpeed;
        this.state.vx *= frictionRatio;
        this.state.vz *= frictionRatio;
      }

      // Ground acceleration
      if (length > 0.0001) {
        const currentSpeedInWishDir = this.state.vx * wishDirX + this.state.vz * wishDirZ;
        const addSpeed = maxSpeed - currentSpeedInWishDir;
        if (addSpeed > 0) {
          const accelSpeed = Math.min(addSpeed, KINEMATICS.ACCEL_GROUND * maxSpeed * dt);
          this.state.vx += accelSpeed * wishDirX;
          this.state.vz += accelSpeed * wishDirZ;
        }
      }

      // Jump
      if (input.jump) {
        this.state.vy = KINEMATICS.JUMP_VELOCITY;
        this.state.isGrounded = false;
        this.airEntryMaxSpeed = Math.max(weaponMaxSpeed * 1.25, Math.hypot(this.state.vx, this.state.vz));
      }
    } else {
      // Air acceleration (Quake/Source style air strafing, bounded to prevent infinite bhop speed exploits)
      if (length > 0.0001) {
        const currentSpeedInWishDir = this.state.vx * wishDirX + this.state.vz * wishDirZ;
        const addSpeed = KINEMATICS.MAX_AIR_WISH_SPEED - currentSpeedInWishDir;
        if (addSpeed > 0) {
          const accelSpeed = Math.min(addSpeed, KINEMATICS.ACCEL_AIR * maxSpeed * dt);
          this.state.vx += accelSpeed * wishDirX;
          this.state.vz += accelSpeed * wishDirZ;
          const airCap = Math.max(weaponMaxSpeed * 1.25, this.airEntryMaxSpeed);
          const airSpeed = Math.hypot(this.state.vx, this.state.vz);
          if (airSpeed > airCap) {
            const scale = airCap / airSpeed;
            this.state.vx *= scale;
            this.state.vz *= scale;
          }
        }
      }

      // Gravity
      this.state.vy -= KINEMATICS.GRAVITY * dt;
    }

    const currentHeight = this.actualCrouching ? KINEMATICS.CAPSULE_HEIGHT_CROUCH : KINEMATICS.CAPSULE_HEIGHT_STAND;
    const isAirTuck = !wasGrounded && this.actualCrouching;
    const tuckOffset = isAirTuck ? 0.55 : 0;

    // Horizontal movement integration with smooth wall sliding
    const horzRes = resolveHorizontalAABB(
      this.state.x,
      this.state.y,
      this.state.z,
      this.state.vx,
      this.state.vz,
      dt,
      this.radius,
      currentHeight,
      activeColliders,
      this.state.isGrounded,
      KINEMATICS.STEP_HEIGHT,
      bounds,
      isAirTuck,
      tuckOffset
    );

    // If auto-stepped up onto a riser, offset stepOffsetY so camera glides smoothly up instead of jumping
    if (horzRes.stepped && horzRes.y > prevY) {
      this.stepOffsetY = Math.max(-0.5, Math.min(0.5, this.stepOffsetY - (horzRes.y - prevY)));
    }

    this.state.x = horzRes.x;
    this.state.y = horzRes.y;
    this.state.z = horzRes.z;
    this.state.vx = horzRes.vx;
    this.state.vz = horzRes.vz;

    // Vertical Y movement with Ceiling & Landing checks
    let newY = this.state.y + this.state.vy * dt;
    this.state.isGrounded = false;

    // Upward ceiling collision
    if (this.state.vy > 0) {
      for (let i = 0; i < activeColliders.length; i++) {
        const b = activeColliders[i];
        if (
          this.state.x + this.radius > b.minX &&
          this.state.x - this.radius < b.maxX &&
          this.state.z + this.radius > b.minZ &&
          this.state.z - this.radius < b.maxZ
        ) {
          if (this.state.y + currentHeight <= b.minY && newY + currentHeight >= b.minY) {
            newY = b.minY - currentHeight;
            this.state.vy = 0;
          }
        }
      }
    }

    // Downward floor & crate top landing + Source-engine downhill ramp/stair grounding
    const allowDownStepSnap = wasGrounded && !input.jump && this.state.vy <= 0;
    const downSnapMargin = allowDownStepSnap ? KINEMATICS.STEP_HEIGHT : 0.15;

    let bestLandingY = -Infinity;
    for (let i = 0; i < activeColliders.length; i++) {
      const b = activeColliders[i];
      // Must be falling, walking on ground, or in mid-air tuck
      const effectivePrevY = this.state.y + tuckOffset;
      const effectiveNewY = newY + tuckOffset;
      const withinDownSnap =
        effectiveNewY <= b.maxY + downSnapMargin &&
        b.maxY <= effectivePrevY + (isAirTuck ? 0.40 : 0.05);
      if (this.state.vy <= 0 && effectivePrevY >= b.maxY - 0.40 && (withinDownSnap || newY <= b.maxY)) {
        // Player's horizontal foot circle must be firmly planted on the top face
        const cx = Math.max(b.minX, Math.min(this.state.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(this.state.z, b.maxZ));
        const dx = this.state.x - cx;
        const dz = this.state.z - cz;
        if ((dx * dx + dz * dz) <= (this.radius * this.radius)) {
          if (b.maxY > bestLandingY) {
            bestLandingY = b.maxY;
          }
        }
      }
    }

    // Floor plane (y = 0) fallback or smooth step-down onto y = 0
    if (newY <= 0 || (allowDownStepSnap && bestLandingY === -Infinity && newY <= KINEMATICS.STEP_HEIGHT)) {
      if (0 > bestLandingY) {
        bestLandingY = 0;
      }
    }

    if (bestLandingY > -Infinity) {
      // Guard upward crouch-tuck snap against overhead ceilings so head never clips through roofs
      const canSnap =
        bestLandingY <= this.state.y ||
        hasHeadClearance(this.state.x, bestLandingY, this.state.z, currentHeight, activeColliders);
      if (canSnap) {
        if (bestLandingY > newY + 0.05) {
          this.stepOffsetY = Math.max(-0.5, Math.min(0.5, this.stepOffsetY - (bestLandingY - newY)));
        } else if (allowDownStepSnap && bestLandingY < prevY - 0.02) {
          // Smooth camera glide when descending voxel stairs/ramps (CS2 Source-style step-down)
          this.stepOffsetY = Math.max(-0.5, Math.min(0.5, this.stepOffsetY + (prevY - bestLandingY)));
        }
        newY = bestLandingY;
        this.state.vy = 0;
        this.state.isGrounded = true;
      }
    }

    // Detect touchdown landing transition
    if (!wasGrounded && this.state.isGrounded) {
      if (prevVy < -3.5) {
        // Hard touchdown: apply brief speed damping and camera dip
        this.landingSpeedFactor = 0.82;
        this.landingCameraDip = Math.min(0.08, Math.abs(prevVy) * 0.012);
      }
    }

    this.state.y = newY;
  }

  public getHorizontalSpeed(): number {
    return Math.hypot(this.state.vx, this.state.vz);
  }

  public isPinpointAccurate(): boolean {
    return this.state.isGrounded && this.getHorizontalSpeed() <= KINEMATICS.PINPOINT_ACCURACY_THRESHOLD;
  }
}
