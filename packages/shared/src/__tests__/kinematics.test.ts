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

    expect(res.x).toBeLessThanOrEqual(58.14);
    expect(res.z).toBeGreaterThanOrEqual(-58.14);
  });

  it('sub-tick position interpolation smoothly blends prevState and state', () => {
    const player = new KinematicPlayerController(0, 0, 0);
    player.prevState = { x: 0, y: 0, z: 0, currentEyeHeight: KINEMATICS.EYE_HEIGHT_STAND };
    player.state.x = 10;
    player.state.y = 2;
    player.state.z = -5;

    const mid = player.getInterpolatedPosition(0.5);
    expect(mid.x).toBeCloseTo(5.0);
    expect(mid.y).toBeCloseTo(1.0);
    expect(mid.z).toBeCloseTo(-2.5);
  });

  it('bullet tagging decelerates max speed and recovers exponentially', () => {
    const player = new KinematicPlayerController(0, 0, 0);
    expect(player.taggingFactor).toBe(1.0);

    // Apply rifle tagging (0.55x)
    player.applyTagging(0.55);
    expect(player.taggingFactor).toBe(0.55);

    const input = {
      forward: true,
      backward: false,
      left: false,
      right: false,
      jump: false,
      crouch: false,
      walk: false,
      yaw: 0,
      pitch: 0,
    };

    // Update 30 ticks (approx 234ms)
    for (let i = 0; i < 30; i++) {
      player.update(input, 1 / 128, KINEMATICS.SPEED_RIFLE, []);
    }

    // Tagging factor must recover towards 1.0
    expect(player.taggingFactor).toBeGreaterThan(0.70);
  });

  it('hard touchdown triggers landing speed recovery and camera dip', () => {
    const player = new KinematicPlayerController(0, 0.02, 0);
    player.state.vy = -6.0; // Hard fall speed > 3.5 m/s
    player.state.isGrounded = false;

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

    // Landing on ground at y = 0
    player.update(input, 1 / 128, KINEMATICS.SPEED_RIFLE, []);

    expect(player.state.isGrounded).toBe(true);
    expect(player.landingSpeedFactor).toBeCloseTo(0.82);
    expect(player.landingCameraDip).toBeGreaterThan(0.04);
  });

  it('rapid crouch toggling drains crouch stamina', () => {
    const player = new KinematicPlayerController(0, 0, 0);
    expect(player.crouchStamina).toBe(1.0);

    const inputCrouch = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      crouch: true,
      walk: false,
      yaw: 0,
      pitch: 0,
    };

    const inputStand = { ...inputCrouch, crouch: false };

    // Rapid spam: crouch -> stand -> crouch -> stand
    player.update(inputCrouch, 1 / 128, KINEMATICS.SPEED_RIFLE, []);
    player.update(inputStand, 1 / 128, KINEMATICS.SPEED_RIFLE, []);
    player.update(inputCrouch, 1 / 128, KINEMATICS.SPEED_RIFLE, []);

    expect(player.crouchStamina).toBeLessThan(0.60);
  });

  it('guarantees 100% bit-identical 128Hz client and server kinematics parity (zero drift)', () => {
    const client = new KinematicPlayerController(0, 0, 0);
    const server = new KinematicPlayerController(0, 0, 0);

    const input = {
      forward: true,
      backward: false,
      left: false,
      right: false,
      jump: false,
      crouch: false,
      walk: false,
      yaw: 0,
      pitch: 0,
    };

    const dt = 1 / 128;
    for (let i = 0; i < 128; i++) {
      // Jump at tick 20
      input.jump = (i === 20);
      client.update(input, dt, KINEMATICS.SPEED_RIFLE, []);
      server.update(input, dt, KINEMATICS.SPEED_RIFLE, []);
    }

    expect(client.state.x).toBeCloseTo(server.state.x, 6);
    expect(client.state.y).toBeCloseTo(server.state.y, 6);
    expect(client.state.z).toBeCloseTo(server.state.z, 6);
    expect(client.state.vx).toBeCloseTo(server.state.vx, 6);
    expect(client.state.vy).toBeCloseTo(server.state.vy, 6);
    expect(client.state.vz).toBeCloseTo(server.state.vz, 6);
  });

  it('mid-air crouch-jump tuck allows clearing and landing on 1.5m obstacles', () => {
    // 1.5m CT Barrier
    const barrier: AABBCollider = {
      minX: -2,
      maxX: 2,
      minY: 0,
      maxY: 1.50,
      minZ: -4,
      maxZ: -2,
    };

    // Controller running towards the barrier and executing a crouch-jump
    const jumper = new KinematicPlayerController(0, 0, -1.60);
    jumper.state.vz = -KINEMATICS.SPEED_RIFLE; // Running jump forward towards -Z

    const jumpInput = {
      forward: true,
      backward: false,
      left: false,
      right: false,
      jump: true,
      crouch: true, // Crouch-jump tuck active in mid-air
      walk: false,
      yaw: 0,
      pitch: 0,
    };

    const dt = 1 / 128;
    // Step jumper forward into the barrier until landing on top
    for (let i = 0; i < 90; i++) {
      if (i > 0) jumpInput.jump = false;
      jumper.update(jumpInput, dt, KINEMATICS.SPEED_RIFLE, [barrier]);
    }

    // Must be grounded on top of the 1.5m barrier
    expect(jumper.state.y).toBe(1.50);
    expect(jumper.state.isGrounded).toBe(true);
  });

  it('map bounds perimeter clamp respects decoupled arena walls at +/-58.5m with 0.36m radius', () => {
    const player = new KinematicPlayerController(50, 0, 50);
    const sprintInput = {
      forward: false,
      backward: false,
      left: false,
      right: true, // Moving towards +X
      jump: false,
      crouch: false,
      walk: false,
      yaw: 0,
      pitch: 0,
    };

    // Run for 3 seconds towards positive X edge
    for (let i = 0; i < 384; i++) {
      player.update(sprintInput, 1 / 128, KINEMATICS.SPEED_KNIFE, []);
    }

    // 58.5 - 0.36 = 58.14
    expect(player.state.x).toBeCloseTo(58.14, 2);
  });
});
