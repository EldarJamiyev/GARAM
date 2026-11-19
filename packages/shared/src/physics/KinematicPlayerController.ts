import RAPIER from '@dimforge/rapier3d-compat';
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

export class KinematicPlayerController {
  public state: PlayerState;
  private currentSpeed: number = 0;

  constructor(startX = 0, startY = 2, startZ = 0) {
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

  public update(input: PlayerInput, dt: number, weaponMaxSpeed = KINEMATICS.SPEED_RIFLE): void {
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

      // Transform wish direction by camera yaw
      const sinYaw = Math.sin(this.state.yaw);
      const cosYaw = Math.cos(this.state.yaw);

      wishDirX = normX * cosYaw + normZ * sinYaw;
      wishDirZ = -normX * sinYaw + normZ * cosYaw;
    }

    // Horizontal speed & counter-strafing friction
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

      // Acceleration / Counter-strafe push
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

    // Integrate velocities into position
    this.state.x += this.state.vx * dt;
    this.state.y += this.state.vy * dt;
    this.state.z += this.state.vz * dt;

    // Floor contact simulation (y = 0 plane ground plane)
    if (this.state.y <= 0) {
      this.state.y = 0;
      this.state.vy = 0;
      this.state.isGrounded = true;
    }
  }

  public getHorizontalSpeed(): number {
    return Math.hypot(this.state.vx, this.state.vz);
  }

  public isPinpointAccurate(): boolean {
    return this.state.isGrounded && this.getHorizontalSpeed() <= KINEMATICS.PINPOINT_ACCURACY_THRESHOLD;
  }
}
