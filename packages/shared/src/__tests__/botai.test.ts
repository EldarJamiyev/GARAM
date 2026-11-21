import { describe, it, expect } from 'vitest';
import {
  BotBrain,
  PerceptionConfig,
  meshYawToRaycastYaw,
  computeSpreadRayDirection,
  resolveBotArchetype,
} from '../index.js';

const VETERAN_PERCEPTION: PerceptionConfig = {
  halfFovDeg: 58,
  baseReactionMs: 360,
  peripheralPenaltyMs: 230,
  distancePenaltyMsPer10m: 42,
  surprisePenaltyMs: 165,
};

describe('Anti-Prefire Human Perception, Aim Alignment & Tactical Combat AI', () => {
  it('blocks 360-degree omniscient spotting: targets behind or outside FOV cone are NEVER spotted', () => {
    const botEye = { x: 0, y: 1.68, z: 0 };
    const botYaw = 0; // Facing +Z

    // Directly behind (-Z, 180° off-center)
    const behind = BotBrain.evaluateVisualPerception(
      botYaw,
      botEye,
      { x: 0, y: 1.68, z: -14 },
      true,
      VETERAN_PERCEPTION
    );
    expect(behind.spotted).toBe(false);
    expect(behind.offCenterDeg).toBeCloseTo(180, 1);

    // Side flank (+X, 90° off-center > 58° half-FOV)
    const flank = BotBrain.evaluateVisualPerception(
      botYaw,
      botEye,
      { x: 12, y: 1.68, z: 0 },
      true,
      VETERAN_PERCEPTION
    );
    expect(flank.spotted).toBe(false);

    // Blocked by wall or smoke (hasLos = false) even dead-center
    const occluded = BotBrain.evaluateVisualPerception(
      botYaw,
      botEye,
      { x: 0, y: 1.68, z: 10 },
      false,
      VETERAN_PERCEPTION
    );
    expect(occluded.spotted).toBe(false);
  });

  it('adds realistic peripheral angle, distance, and surprise reaction penalties inside FOV', () => {
    const botEye = { x: 0, y: 1.68, z: 0 };
    const botYaw = 0; // Facing +Z

    const centerClose = BotBrain.evaluateVisualPerception(
      botYaw,
      botEye,
      { x: 0, y: 1.68, z: 10 },
      true,
      VETERAN_PERCEPTION,
      false
    );
    expect(centerClose.spotted).toBe(true);
    expect(centerClose.offCenterDeg).toBeCloseTo(0, 1);
    expect(centerClose.effectiveReactionMs).toBe(360);

    // Peripheral 45° off-center target must take significantly longer to recognize
    const peripheral = BotBrain.evaluateVisualPerception(
      botYaw,
      botEye,
      { x: 10, y: 1.68, z: 10 },
      true,
      VETERAN_PERCEPTION,
      false
    );
    expect(peripheral.spotted).toBe(true);
    expect(peripheral.offCenterDeg).toBeCloseTo(45, 1);
    expect(peripheral.effectiveReactionMs).toBeGreaterThan(centerClose.effectiveReactionMs + 150);

    // Long range + unexpected appearance adds further human latency
    const farSurprise = BotBrain.evaluateVisualPerception(
      botYaw,
      botEye,
      { x: 0, y: 1.68, z: 40 },
      true,
      VETERAN_PERCEPTION,
      true
    );
    expect(farSurprise.spotted).toBe(true);
    expect(farSurprise.effectiveReactionMs).toBeGreaterThan(centerClose.effectiveReactionMs + 250);
  });

  it('strictly prevents prefiring before reaction time, before crosshair aligns, while blinded, or while full-sprinting', () => {
    const baseGate = {
      spotted: true,
      isReloading: false,
      ammo: 25,
      blindTimerSec: 0,
      visibleDurationMs: 420,
      effectiveReactionMs: 360,
      aimErrorDeg: 2.1,
      maxFireErrorDeg: 5.0,
      horizontalSpeed: 0.1,
      maxFireSpeed: 1.05,
      targetDistance: 16,
    };

    // Valid counter-strafed, reacted, aligned shot -> ALLOWED
    expect(BotBrain.canBotFire(baseGate)).toBe(true);

    // Frame-1 peek before reaction window elapses -> BLOCKED (ZERO PREFIRE)
    expect(BotBrain.canBotFire({ ...baseGate, visibleDurationMs: 120 })).toBe(false);

    // Crosshair still turning toward target (18° off) -> BLOCKED (no shooting out of side of head)
    expect(BotBrain.canBotFire({ ...baseGate, aimErrorDeg: 18 })).toBe(false);

    // Flashbanged -> BLOCKED
    expect(BotBrain.canBotFire({ ...baseGate, blindTimerSec: 1.2 })).toBe(false);

    // Full-speed running at mid-range -> BLOCKED (must counter-strafe first)
    expect(BotBrain.canBotFire({ ...baseGate, horizontalSpeed: 3.3, targetDistance: 18 })).toBe(false);

    // Emergency CQB (< 5.5m) allows defensive spray while strafing
    expect(BotBrain.canBotFire({ ...baseGate, horizontalSpeed: 2.8, targetDistance: 4.0 })).toBe(true);
  });

  it('slews aim smoothly without instant teleporting and maps meshYaw accurately to raycast direction', () => {
    // Bot facing +Z (0 rad), target at +X (PI/2 rad = 90°)
    const step1 = BotBrain.stepHumanAim({
      currentYaw: 0,
      currentPitch: 0,
      desiredYaw: Math.PI / 2,
      desiredPitch: 0.08,
      dt: 0.05,
      slewRateDegPerSec: 360, // max 18° per 50ms tick
    });
    expect(step1.totalErrorDeg).toBeGreaterThan(65);
    expect(step1.nextYaw).toBeGreaterThan(0);
    expect(step1.nextYaw).toBeLessThan(Math.PI / 3);

    // Verify +Z meshYaw -> -Z raycastYaw geometric identity across all 4 cardinal directions
    const cardinals = [
      { meshYaw: 0, expectedX: 0, expectedZ: 1 },
      { meshYaw: Math.PI / 2, expectedX: 1, expectedZ: 0 },
      { meshYaw: Math.PI, expectedX: 0, expectedZ: -1 },
      { meshYaw: -Math.PI / 2, expectedX: -1, expectedZ: 0 },
    ];
    for (const c of cardinals) {
      const rayDir = computeSpreadRayDirection(meshYawToRaycastYaw(c.meshYaw), 0, 0, 0);
      expect(rayDir.x).toBeCloseTo(c.expectedX, 5);
      expect(rayDir.z).toBeCloseTo(c.expectedZ, 5);
    }
  });

  it('targets realistic chest/torso heights for lower skill tiers instead of 100% forehead locks', () => {
    const feet = { x: 0, y: 0, z: 12 };
    const eye = { x: 0, y: 1.65, z: 12 };

    // Mid-roll (0.50) should aim at chest/upper-chest for Recruit & Veteran, NOT forehead
    const recruitPt = BotBrain.selectAimTargetPoint(feet, eye, false, 45, 0, 0.5);
    const veteranPt = BotBrain.selectAimTargetPoint(feet, eye, false, 76, 0, 0.5);
    const sovereignHeadRoll = BotBrain.selectAimTargetPoint(feet, eye, false, 98, 0, 0.2);

    expect(recruitPt.y).toBeLessThan(1.42);
    expect(veteranPt.y).toBeLessThan(1.45);
    expect(sovereignHeadRoll.y).toBeGreaterThan(1.6);
  });

  it('executes counter-strafed combat footwork and retreats to cover when reloading or critically wounded', () => {
    const botPos = { x: 0, y: 0, z: 0 };
    const enemyPos = { x: 0, y: 0, z: 16 };
    const coverPos = { x: -5, y: 0, z: -2 };

    // Reloading triggers immediate SEEK_COVER toward coverPos
    const reloadMove = BotBrain.evaluateCombatFootwork({
      botPos,
      enemyPos,
      healthRatio: 0.9,
      isReloading: true,
      isBlinded: false,
      skill: 80,
      aggression: 60,
      phaseTimer: 0.3,
      currentPhase: 'HOLD_FIRE',
      strafeSign: 1,
      nearbyCoverPos: coverPos,
      dt: 0.016,
    });
    expect(reloadMove.nextPhase).toBe('SEEK_COVER');
    expect(reloadMove.moveDirX).toBeLessThan(-0.5);
    expect(reloadMove.desiredSpeed).toBeGreaterThan(3.0);

    // Healthy duel alternates from HOLD_FIRE -> STRAFE_REPOSITION laterally when phase timer expires
    const strafeStep = BotBrain.evaluateCombatFootwork({
      botPos,
      enemyPos,
      healthRatio: 1.0,
      isReloading: false,
      isBlinded: false,
      skill: 85,
      aggression: 50,
      phaseTimer: 0.01,
      currentPhase: 'HOLD_FIRE',
      strafeSign: 1,
      nearbyCoverPos: coverPos,
      dt: 0.02,
    });
    expect(strafeStep.nextPhase).toBe('STRAFE_REPOSITION');
    expect(Math.abs(strafeStep.moveDirX)).toBeGreaterThan(0.8);
    expect(strafeStep.desiredSpeed).toBeGreaterThan(2.5);

    // Transition back from STRAFE_REPOSITION -> HOLD_FIRE brakes cleanly to 0 for pinpoint accuracy
    const counterStop = BotBrain.evaluateCombatFootwork({
      botPos,
      enemyPos,
      healthRatio: 1.0,
      isReloading: false,
      isBlinded: false,
      skill: 85,
      aggression: 50,
      phaseTimer: 0.01,
      currentPhase: 'STRAFE_REPOSITION',
      strafeSign: -1,
      nearbyCoverPos: coverPos,
      dt: 0.02,
    });
    expect(counterStop.nextPhase).toBe('HOLD_FIRE');
    expect(counterStop.desiredSpeed).toBe(0);
  });

  it('prevents head-on corridor deadlocks via lateral passing separation', () => {
    const res = BotBrain.computeCorridorSeparation(
      { x: 0, y: 0, z: 0 },
      0,
      1, // Walking straight +Z
      0,
      [{ x: 0, y: 0, z: 0.8 }] // Teammate directly ahead at 0.8m
    );
    // Must NEVER freeze to 0 speed; must steer laterally around teammate
    expect(res.speedMultiplier).toBeGreaterThanOrEqual(0.45);
    expect(Math.abs(res.dirX)).toBeGreaterThan(0.15);
  });

  it('enforces monotonic difficulty scaling even on Sovereign named archetypes like Viper & Maverick', () => {
    const recruitViper = resolveBotArchetype('bot_2', 'Syndicate Viper', 'Syndicate', 'Recruit');
    const veteranViper = resolveBotArchetype('bot_2', 'Syndicate Viper', 'Syndicate', 'Veteran');
    const eliteViper = resolveBotArchetype('bot_2', 'Syndicate Viper', 'Syndicate', 'Elite');
    const sovereignViper = resolveBotArchetype('bot_2', 'Syndicate Viper', 'Syndicate', 'Sovereign');

    // Reaction time strictly decreases from Recruit -> Veteran -> Elite -> Sovereign
    expect(recruitViper.reactionTimeMs).toBeGreaterThan(veteranViper.reactionTimeMs);
    expect(veteranViper.reactionTimeMs).toBeGreaterThan(eliteViper.reactionTimeMs);
    expect(eliteViper.reactionTimeMs).toBeGreaterThan(sovereignViper.reactionTimeMs);
    expect(veteranViper.reactionTimeMs).toBeGreaterThanOrEqual(280);

    // Skill strictly increases from Recruit -> Veteran -> Elite -> Sovereign
    expect(recruitViper.skill).toBeLessThan(veteranViper.skill);
    expect(veteranViper.skill).toBeLessThan(eliteViper.skill);
    expect(eliteViper.skill).toBeLessThan(sovereignViper.skill);
  });
});
