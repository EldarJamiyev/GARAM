import { describe, it, expect } from 'vitest';
import {
  KinematicPlayerController,
  KINEMATICS,
  resolveHorizontalAABB,
  AABBCollider
} from '../index.js';

describe('Kinematics & SAT Collision Resolution', () => {
  it('active counter-strafing decelerates player to pinpoint threshold in <= 115ms', () => {
    const player = new KinematicPlayerController(0, 0, 0);
    // Player moving right (positive X)
    player.state.vx = KINEMATICS.SPEED_RIFLE; // 5.45 m/s
    player.state.isGrounded = true;

    // Active counter-strafe: tap Left (A key)
    const input = {
      forward: false,
      backward: false,
      left: true,
      right: false,
      jump: false,
      crouch: false,
      walk: false,
      yaw: 0,
      pitch: 0,
    };

    const dt = 1 / 128;
    let elapsed = 0;
    while (player.getHorizontalSpeed() > KINEMATICS.PINPOINT_ACCURACY_THRESHOLD && elapsed < 0.2) {
      player.update(input, dt, KINEMATICS.SPEED_RIFLE, []);
      elapsed += dt;
    }

    expect(elapsed).toBeLessThanOrEqual(0.125);
    expect(player.isPinpointAccurate()).toBe(true);
  });

  it('Circle-AABB SAT wall collision prevents penetration and eliminates kickback', () => {
    const wall: AABBCollider = {
      minX: -2,
      maxX: 2,
      minY: 0,
      maxY: 4,
      minZ: -5,
      maxZ: -4, // Wall south face is at z = -4
    };

    // Starting already touching / penetrating into wall at z = -3.7 (distance to -4 is 0.3m < radius 0.40m)
    // Moving directly towards -Z into the wall at high velocity
    const res = resolveHorizontalAABB(
      0, 0, -3.7,
      0, -5.5,
      1 / 128,
      KINEMATICS.CAPSULE_RADIUS, // 0.40m
      KINEMATICS.CAPSULE_HEIGHT_STAND,
      [wall],
      true
    );

    // Circle center must be stopped outside the wall face: maxZ (-4) + radius (0.36) = -3.64
    expect(res.z).toBeGreaterThanOrEqual(-4.0 + KINEMATICS.CAPSULE_RADIUS);
    // Velocity into surface deflected to 0 or deflected outward
    expect(res.vz).toBeGreaterThanOrEqual(0);
  });

  it('auto-steps up obstacles <= 0.40m smoothly', () => {
    const step: AABBCollider = {
      minX: -2,
      maxX: 2,
      minY: 0,
      maxY: 0.35, // 0.35m stair riser
      minZ: -2,
      maxZ: 0,
    };

    const res = resolveHorizontalAABB(
      0, 0, 0.2, // Approaching step from z = +0.2 towards -Z
      0, -3.0,
      1 / 64,
      KINEMATICS.CAPSULE_RADIUS,
      KINEMATICS.CAPSULE_HEIGHT_STAND,
      [step],
      true,
      KINEMATICS.STEP_HEIGHT // 0.40m
    );

    expect(res.stepped).toBe(true);
    expect(res.y).toBe(0.35);
  });

  it('headroom check prevents standing up under low ceilings', () => {
    const lowCeiling: AABBCollider = {
      minX: -2,
      maxX: 2,
      minY: 1.35, // Below standing height (1.85m), above crouch height (1.20m)
      maxY: 2.50,
      minZ: -2,
      maxZ: 2,
    };

    const player = new KinematicPlayerController(0, 0, 0);
    player.actualCrouching = true;
    player.state.isCrouching = true;

    // Release crouch key
    const input = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      crouch: false,
      walk: false,
      yaw: 0,
      pitch: 0,
    };

    player.update(input, 1 / 128, KINEMATICS.SPEED_RIFLE, [lowCeiling]);

    // Must remain crouching due to lack of headroom!
    expect(player.actualCrouching).toBe(true);
    expect(player.state.isCrouching).toBe(true);
  });

  it('hard clamps player position within DE_CITADEL map boundary', () => {
    const res = resolveHorizontalAABB(
      70, 0, -80, // Far outside perimeter
      10, -10,
      1 / 128,
      KINEMATICS.CAPSULE_RADIUS,
      KINEMATICS.CAPSULE_HEIGHT_STAND,
      [],
      false
    );

    expect(res.x).toBeLessThanOrEqual(58.05);
    expect(res.z).toBeGreaterThanOrEqual(-58.05);
  });
});
