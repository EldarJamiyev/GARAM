import { KINEMATICS } from '../constants/kinematics.js';

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
  maxStep = KINEMATICS.STEP_HEIGHT
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
      for (const b of colliders) {
        // Vertical height check
        if (curY >= b.maxY || curY + height <= b.minY) continue;

        // Check if player can step up onto obstacle (only if moving towards it and grounded)
        const stepDiff = b.maxY - curY;
        if (canStep && stepDiff > 0 && stepDiff <= maxStep) {
          const cx = Math.max(b.minX, Math.min(curX, b.maxX));
          const cz = Math.max(b.minZ, Math.min(curZ, b.maxZ));
          const dx = curX - cx;
          const dz = curZ - cz;
          if ((dx * dx + dz * dz) < (radius * radius)) {
            if (hasHeadClearance(curX, b.maxY, curZ, height, colliders, b)) {
              curY = b.maxY;
              didStep = true;
              // Continue checking other colliders at the new elevation
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

  // Hard clamp against DE_CITADEL map perimeter (120m x 120m arena with walls at +/-58.5)
  curX = Math.max(-58.05, Math.min(58.05, curX));
  curZ = Math.max(-58.05, Math.min(58.05, curZ));

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
  public radius = KINEMATICS.CAPSULE_RADIUS;
  public actualCrouching = false;

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
  }

  public update(
    input: PlayerInput,
    dt: number,
    weaponMaxSpeed = KINEMATICS.SPEED_RIFLE,
    colliders: AABBCollider[] = []
  ): void {
    this.state.yaw = input.yaw;
    this.state.pitch = input.pitch;
    this.state.isWalking = input.walk;

    // Headroom check when uncrouching
    if (input.crouch) {
      this.actualCrouching = true;
    } else if (this.actualCrouching) {
      // Check ceiling clearance before expanding to standing height
      if (hasHeadClearance(this.state.x, this.state.y, this.state.z, KINEMATICS.CAPSULE_HEIGHT_STAND, colliders)) {
        this.actualCrouching = false;
      }
    }
    this.state.isCrouching = this.actualCrouching;

    // Eye height interpolation
    const targetEyeHeight = this.actualCrouching ? KINEMATICS.EYE_HEIGHT_CROUCH : KINEMATICS.EYE_HEIGHT_STAND;
    this.state.currentEyeHeight += (targetEyeHeight - this.state.currentEyeHeight) * (1 - Math.exp(-KINEMATICS.CROUCH_LERP_SPEED * dt));

    // Stance speed
    let maxSpeed = weaponMaxSpeed;
    if (this.actualCrouching) {
      maxSpeed = KINEMATICS.SPEED_CROUCH;
    } else if (input.walk) {
      maxSpeed = KINEMATICS.SPEED_WALK_SILENT;
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

    // Ground counter-strafing kinematics
    if (this.state.isGrounded) {
      const currentHozSpeed = Math.hypot(this.state.vx, this.state.vz);

      // Source-accurate ground friction
      if (currentHozSpeed > 0.0001) {
        const drop = currentHozSpeed * KINEMATICS.FRICTION_GROUND * dt;
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
      }
    } else {
      // Air acceleration (Quake/Source style air strafing)
      if (length > 0.0001) {
        const currentSpeedInWishDir = this.state.vx * wishDirX + this.state.vz * wishDirZ;
        const addSpeed = KINEMATICS.MAX_AIR_WISH_SPEED - currentSpeedInWishDir;
        if (addSpeed > 0) {
          const accelSpeed = Math.min(addSpeed, KINEMATICS.ACCEL_AIR * maxSpeed * dt);
          this.state.vx += accelSpeed * wishDirX;
          this.state.vz += accelSpeed * wishDirZ;
        }
      }

      // Gravity
      this.state.vy -= KINEMATICS.GRAVITY * dt;
    }

    const currentHeight = this.actualCrouching ? KINEMATICS.CAPSULE_HEIGHT_CROUCH : KINEMATICS.CAPSULE_HEIGHT_STAND;

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
      colliders,
      this.state.isGrounded,
      KINEMATICS.STEP_HEIGHT
    );

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
      for (const b of colliders) {
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

    // Downward floor & crate top landing
    if (newY <= 0) {
      newY = 0;
      this.state.vy = 0;
      this.state.isGrounded = true;
    }

    for (const b of colliders) {
      // Must be falling or standing (vy <= 0)
      if (this.state.vy <= 0 && this.state.y >= b.maxY - 0.40 && newY <= b.maxY) {
        // Player's horizontal foot circle must be firmly planted on the top face
        const cx = Math.max(b.minX, Math.min(this.state.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(this.state.z, b.maxZ));
        const dx = this.state.x - cx;
        const dz = this.state.z - cz;
        if ((dx * dx + dz * dz) <= (this.radius * this.radius * 0.75)) {
          newY = b.maxY;
          this.state.vy = 0;
          this.state.isGrounded = true;
        }
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
