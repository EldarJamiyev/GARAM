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
 * Used identically for both player and AI bots to prevent clipping through walls.
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

  // Integrate movement with substeps for high velocity stability
  const moveDist = Math.hypot(vx * dt, vz * dt);
  const numSteps = Math.max(1, Math.min(4, Math.ceil(moveDist / (radius * 0.5))));
  const subDt = dt / numSteps;

  for (let s = 0; s < numSteps; s++) {
    // 1. Move X
    let targetX = curX + outVx * subDt;
    for (const b of colliders) {
      if (testCapsuleAABBOverlap(targetX, curY, curZ, radius, height, b)) {
        const stepDiff = b.maxY - curY;
        if (canStep && stepDiff > 0 && stepDiff <= maxStep && hasHeadClearance(targetX, b.maxY, curZ, height, colliders, b)) {
          curY = b.maxY;
          curX = targetX;
          didStep = true;
        } else {
          // Slide along wall plane without bouncy kickback
          if (outVx > 0) {
            targetX = Math.min(targetX, b.minX - radius);
          } else if (outVx < 0) {
            targetX = Math.max(targetX, b.maxX + radius);
          }
          outVx = 0;
        }
      }
    }
    curX = targetX;

    // 2. Move Z
    let targetZ = curZ + outVz * subDt;
    for (const b of colliders) {
      if (testCapsuleAABBOverlap(curX, curY, targetZ, radius, height, b)) {
        const stepDiff = b.maxY - curY;
        if (canStep && stepDiff > 0 && stepDiff <= maxStep && hasHeadClearance(curX, b.maxY, targetZ, height, colliders, b)) {
          curY = b.maxY;
          curZ = targetZ;
          didStep = true;
        } else {
          if (outVz > 0) {
            targetZ = Math.min(targetZ, b.minZ - radius);
          } else if (outVz < 0) {
            targetZ = Math.max(targetZ, b.maxZ + radius);
          }
          outVz = 0;
        }
      }
    }
    curZ = targetZ;
  }

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
      if (
        this.state.x + this.radius > b.minX &&
        this.state.x - this.radius < b.maxX &&
        this.state.z + this.radius > b.minZ &&
        this.state.z - this.radius < b.maxZ
      ) {
        if (this.state.vy <= 0 && this.state.y >= b.maxY - 0.45 && newY <= b.maxY) {
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
