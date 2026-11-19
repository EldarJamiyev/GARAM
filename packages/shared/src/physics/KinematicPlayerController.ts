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

export class KinematicPlayerController {
  public state: PlayerState;
  public radius = 0.38;
  public readonly MAX_STEP_HEIGHT = 0.42; // Auto-step height for stairs and curbs

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
    this.state.isCrouching = input.crouch;
    this.state.isWalking = input.walk;

    // Smooth eye height interpolation (crouch peeking / standing)
    const targetEyeHeight = input.crouch ? KINEMATICS.EYE_HEIGHT_CROUCH : KINEMATICS.EYE_HEIGHT_STAND;
    this.state.currentEyeHeight += (targetEyeHeight - this.state.currentEyeHeight) * (1 - Math.exp(-KINEMATICS.CROUCH_LERP_SPEED * dt));

    // Target max speed determined by stance and weapon
    let maxSpeed = weaponMaxSpeed;
    if (input.crouch) {
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

    // Counter-strafing ground physics
    if (this.state.isGrounded) {
      const currentHozSpeed = Math.hypot(this.state.vx, this.state.vz);

      // Friction
      if (currentHozSpeed > 0.0001) {
        const drop = currentHozSpeed * KINEMATICS.FRICTION_GROUND * dt;
        const newSpeed = Math.max(0, currentHozSpeed - drop);
        const frictionRatio = newSpeed / currentHozSpeed;
        this.state.vx *= frictionRatio;
        this.state.vz *= frictionRatio;
      }

      // Acceleration
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

    // Target capsule height
    const targetHeight = input.crouch ? KINEMATICS.CAPSULE_HEIGHT_CROUCH : KINEMATICS.CAPSULE_HEIGHT_STAND;

    // 1. Resolve X movement with 0.42m Auto-Step
    let newX = this.state.x + this.state.vx * dt;
    let steppedY = this.state.y;

    for (const b of colliders) {
      if (this.intersectsBox(newX, steppedY, this.state.z, this.radius, targetHeight, b)) {
        const stepDiff = b.maxY - this.state.y;
        // Auto-step if curb/stair is <= 0.42m high and there is head clearance
        if (this.state.isGrounded && stepDiff > 0 && stepDiff <= this.MAX_STEP_HEIGHT && this.hasHeadClearance(newX, b.maxY, this.state.z, targetHeight, colliders, b)) {
          steppedY = b.maxY;
        } else {
          // Resolve wall collision sliding
          if (this.state.vx > 0) {
            newX = b.minX - this.radius;
          } else if (this.state.vx < 0) {
            newX = b.maxX + this.radius;
          }
          this.state.vx = 0;
        }
      }
    }
    this.state.x = newX;
    this.state.y = steppedY;

    // 2. Resolve Z movement with 0.42m Auto-Step
    let newZ = this.state.z + this.state.vz * dt;
    steppedY = this.state.y;

    for (const b of colliders) {
      if (this.intersectsBox(this.state.x, steppedY, newZ, this.radius, targetHeight, b)) {
        const stepDiff = b.maxY - this.state.y;
        if (this.state.isGrounded && stepDiff > 0 && stepDiff <= this.MAX_STEP_HEIGHT && this.hasHeadClearance(this.state.x, b.maxY, newZ, targetHeight, colliders, b)) {
          steppedY = b.maxY;
        } else {
          if (this.state.vz > 0) {
            newZ = b.minZ - this.radius;
          } else if (this.state.vz < 0) {
            newZ = b.maxZ + this.radius;
          }
          this.state.vz = 0;
        }
      }
    }
    this.state.z = newZ;
    this.state.y = steppedY;

    // 3. Resolve Y movement with Ground & Ceiling checks
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
          if (this.state.y + targetHeight <= b.minY && newY + targetHeight >= b.minY) {
            newY = b.minY - targetHeight;
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

  private hasHeadClearance(
    px: number,
    baseY: number,
    pz: number,
    height: number,
    colliders: AABBCollider[],
    ignoreBox: AABBCollider
  ): boolean {
    for (const b of colliders) {
      if (b === ignoreBox) continue;
      if (this.intersectsBox(px, baseY, pz, this.radius, height, b)) {
        return false;
      }
    }
    return true;
  }

  private intersectsBox(
    px: number,
    py: number,
    pz: number,
    r: number,
    h: number,
    b: AABBCollider
  ): boolean {
    const closestX = Math.max(b.minX, Math.min(px, b.maxX));
    const closestY = Math.max(b.minY, Math.min(py + h / 2, b.maxY));
    const closestZ = Math.max(b.minZ, Math.min(pz, b.maxZ));

    const distanceX = px - closestX;
    const distanceZ = pz - closestZ;

    // Vertical overlap check
    const yOverlap = (py < b.maxY) && (py + h > b.minY);
    if (!yOverlap) return false;

    return (distanceX * distanceX + distanceZ * distanceZ) < (r * r);
  }

  public getHorizontalSpeed(): number {
    return Math.hypot(this.state.vx, this.state.vz);
  }

  public isPinpointAccurate(): boolean {
    return this.state.isGrounded && this.getHorizontalSpeed() <= KINEMATICS.PINPOINT_ACCURACY_THRESHOLD;
  }
}
