// Movement Constants (Source-Calibrated)
export const KINEMATICS = {
  FIXED_TICK_RATE: 128,
  FIXED_DT: 1 / 128, // 0.0078125s

  EYE_HEIGHT_STAND: 1.72,
  EYE_HEIGHT_CROUCH: 1.16,
  CROUCH_LERP_SPEED: 18.0,

  SPEED_KNIFE: 6.35,      // 250 units/s
  SPEED_PISTOL: 6.10,     // 240 units/s
  SPEED_RIFLE: 5.45,      // 215 units/s
  SPEED_AWP: 5.08,        // 200 units/s
  SPEED_WALK_SILENT: 3.30,// 130 units/s
  SPEED_CROUCH: 2.15,     // 85 units/s

  ACCEL_GROUND: 5.6,
  FRICTION_GROUND: 5.2,
  STOP_SPEED: 2.0,
  ACCEL_AIR: 12.0,
  MAX_AIR_WISH_SPEED: 0.76,

  JUMP_VELOCITY: 5.8,
  GRAVITY: 19.6,

  PINPOINT_ACCURACY_THRESHOLD: 0.38, // 15 units/s
  STEP_HEIGHT: 0.42,
  CAPSULE_RADIUS: 0.36,
  CAPSULE_HEIGHT_STAND: 1.80,
  CAPSULE_HEIGHT_CROUCH: 1.22,
};

// Hitbox Multipliers
export const HITBOX = {
  HEAD_MULTIPLIER: 4.0,
  CHEST_MULTIPLIER: 1.0,
  STOMACH_MULTIPLIER: 1.15,
  ARMS_MULTIPLIER: 0.75,
  LEGS_MULTIPLIER: 0.75,
  KEVLAR_DAMAGE_REDUCTION: 0.35,
};

// Material penetration profiles
export const MATERIALS = {
  WOOD_THIN: { resistance: 0.35, costPerMeter: 10, damageMultiplier: 0.75 },
  DRYWALL: { resistance: 0.30, costPerMeter: 22, damageMultiplier: 0.70 },
  METAL_SHEET: { resistance: 0.60, costPerMeter: 45, damageMultiplier: 0.45 },
  CONCRETE: { resistance: 1.0, costPerMeter: 9999, damageMultiplier: 0.0 },
};
