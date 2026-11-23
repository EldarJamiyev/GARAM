import { Vec3 } from '../physics/RaycastEngine.js';

export type TacticalState =
  | 'PATROL'
  | 'ENGAGE'
  | 'SEEK_COVER'
  | 'JIGGLE_PEEK'
  | 'PLANT'
  | 'DEFUSE'
  | 'FLEE_BOMB';

export type TeamEcoState = 'FULL_BUY' | 'FORCE_BUY' | 'ECO_SAVE';

export interface EcoDecision {
  ecoState: TeamEcoState;
  primaryWeaponId: string;
  buyArmor: boolean;
  buyHelmet: boolean;
  buyDefuseKit: boolean;
}

export type CombatFootworkPhase = 'HOLD_FIRE' | 'STRAFE_REPOSITION' | 'SEEK_COVER' | 'ADVANCE_PRESSURE';

export interface PerceptionConfig {
  /** Half horizontal field-of-view in degrees (strict human cap <= 55° -> 110° full cone). */
  halfFovDeg: number;
  /** Foveal sharp-focus half-angle in degrees (default 32°). Beyond this is peripheral vision. */
  fovealHalfFovDeg?: number;
  /** Base visual reaction time in ms for a target dead-center at close-mid range. */
  baseReactionMs: number;
  /** Additional human recognition delay (ms) at the edge of peripheral vision. */
  peripheralPenaltyMs: number;
  /** Extra ms per 10 meters beyond 10m range. */
  distancePenaltyMsPer10m: number;
  /** Extra surprise/acquisition delay (ms) when target newly appears while bot is moving or turning. */
  surprisePenaltyMs: number;
  /** Continuous exposure confirmation window (ms, e.g. 60-110ms) before reaction completes. */
  exposureConfirmMs?: number;
  /** Optional Gaussian reaction jitter (ms, typically ±35ms) sampled per target appearance. */
  reactionJitterMs?: number;
}

export type VisionZone = 'FOVEAL' | 'PERIPHERAL' | 'OUTSIDE';

export interface PerceptionResult {
  spotted: boolean;
  visionZone: VisionZone;
  offCenterDeg: number;
  distance: number;
  effectiveReactionMs: number;
}

export interface HumanAimParams {
  currentYaw: number;
  currentPitch: number;
  desiredYaw: number;
  desiredPitch: number;
  dt: number;
  slewRateDegPerSec: number;
  /** Optional subtle human sway offset in radians. */
  swayYawRad?: number;
  swayPitchRad?: number;
}

export interface HumanAimResult {
  nextYaw: number;
  nextPitch: number;
  yawErrorDeg: number;
  pitchErrorDeg: number;
  totalErrorDeg: number;
}

export interface FireGateParams {
  spotted: boolean;
  isReloading: boolean;
  ammo: number;
  blindTimerSec: number;
  visibleDurationMs: number;
  effectiveReactionMs: number;
  aimErrorDeg: number;
  maxFireErrorDeg: number;
  horizontalSpeed: number;
  maxFireSpeed: number;
  targetDistance: number;
}

export interface CombatFootworkParams {
  botPos: Vec3;
  enemyPos: Vec3;
  healthRatio: number;
  isReloading: boolean;
  isBlinded: boolean;
  skill: number;
  aggression: number;
  phaseTimer: number;
  currentPhase: CombatFootworkPhase;
  strafeSign: number;
  nearbyCoverPos: Vec3 | null;
  dt: number;
}

export interface CombatFootworkResult {
  nextPhase: CombatFootworkPhase;
  nextPhaseTimer: number;
  nextStrafeSign: number;
  moveDirX: number;
  moveDirZ: number;
  desiredSpeed: number;
  shouldCrouch: boolean;
}

export interface CorridorSeparationResult {
  dirX: number;
  dirZ: number;
  speedMultiplier: number;
}

/** Wraps an angle in radians cleanly to (-PI, PI]. */
export function normalizeAngleRad(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Converts a +Z-forward Three.js mesh yaw (`atan2(dx, dz)`) to the -Z-forward
 * raycast yaw expected by `computeSpreadRayDirection` (`atan2(-dx, -dz)`).
 */
export function meshYawToRaycastYaw(meshYaw: number): number {
  return normalizeAngleRad(meshYaw + Math.PI);
}

/**
 * Pure, deterministic tactical AI decision kernel for competitive CS2 bot simulation.
 * Zero DOM and zero Three.js dependencies.
 */
export class BotBrain {
  /**
   * Deterministic Gaussian-like human reaction jitter in milliseconds (clamped to [-clampMs, +clampMs]).
   * Prevents robotic identical-frame reactions across bots.
   */
  public static computeGaussianJitterMs(seed: number, stdDevMs = 24, clampMs = 35): number {
    // Sum of 3 deterministic uniform hashes -> approximate Gaussian distribution (Irwin-Hall)
    const u1 = Math.abs(Math.sin(seed * 12.9898 + 1.234) * 43758.5453) % 1;
    const u2 = Math.abs(Math.sin(seed * 78.233 + 5.678) * 24634.6345) % 1;
    const u3 = Math.abs(Math.sin(seed * 37.719 + 9.012) * 19283.7465) % 1;
    const z = (u1 + u2 + u3 - 1.5) * 1.65;
    return Math.round(Math.max(-clampMs, Math.min(clampMs, z * stdDevMs)));
  }

  /**
   * Evaluates team-wide economy coordination according to competitive CS2 ladder rules
   * across the full 9-weapon CS2 arsenal (USP-S, Glock-18, Deagle, MP9, M4A1-S, M4A4, Garam-47, AWP).
   */
  public static evaluateTeamEconomy(
    teamCash: number[],
    lossStreak: number,
    roundNumber: number,
    isVanguard: boolean
  ): EcoDecision[] {
    const avgCash = teamCash.reduce((a, b) => a + b, 0) / Math.max(1, teamCash.length);

    // Round 1 (Pistols) or Halftime Pistol (Round 13): default sidearm + Kevlar vest
    if (roundNumber === 1 || roundNumber === 13) {
      return teamCash.map((cash) => ({
        ecoState: 'FORCE_BUY' as TeamEcoState,
        primaryWeaponId: isVanguard ? 'usp-s' : 'glock-18',
        buyArmor: cash >= 650,
        buyHelmet: false,
        buyDefuseKit: isVanguard && cash >= 1050,
      }));
    }

    let teamEcoState: TeamEcoState = 'FULL_BUY';
    if (avgCash >= 4200) {
      teamEcoState = 'FULL_BUY';
    } else if (avgCash < 2400 && lossStreak <= 1) {
      teamEcoState = 'ECO_SAVE';
    } else {
      teamEcoState = 'FORCE_BUY';
    }

    return teamCash.map((cash, idx) => {
      if (teamEcoState === 'FULL_BUY') {
        const ctRifle = idx % 2 === 0 ? 'vanguard-m4' : 'm4a4';
        const rifle = isVanguard ? ctRifle : 'garam-47';
        const isAwpSlot = idx === 2 || (idx === 0 && !isVanguard);
        const primary = cash >= 5750 && isAwpSlot ? 'sovereign-awp' : rifle;
        return {
          ecoState: 'FULL_BUY',
          primaryWeaponId: primary,
          buyArmor: cash >= 650,
          buyHelmet: cash >= 1000,
          buyDefuseKit: isVanguard && cash >= 1350,
        };
      } else if (teamEcoState === 'FORCE_BUY') {
        let primary = 'desert-eagle';
        if (cash >= 3100) {
          primary = isVanguard ? (idx % 2 === 0 ? 'vanguard-m4' : 'm4a4') : 'garam-47';
        } else if (cash >= 1900) {
          primary = 'mp9';
        }
        return {
          ecoState: 'FORCE_BUY',
          primaryWeaponId: primary,
          buyArmor: cash >= 650,
          buyHelmet: cash >= 1000,
          buyDefuseKit: isVanguard && cash >= 1300,
        };
      } else {
        // ECO_SAVE: preserve cash for next round full buy
        return {
          ecoState: 'ECO_SAVE',
          primaryWeaponId: cash >= 2150 ? 'desert-eagle' : isVanguard ? 'usp-s' : 'glock-18',
          buyArmor: false,
          buyHelmet: false,
          buyDefuseKit: false,
        };
      }
    });
  }

  /**
   * Anti-flash dodge: calculates 180° escape yaw when an incoming flashbang is spotted.
   * Note: Uses -Z forward yaw convention (yaw = 0 faces -Z) for compatibility with existing callers/tests.
   */
  public static calculateAntiFlashYaw(currentYaw: number, flashPos: Vec3, botPos: Vec3): { shouldTurn: boolean; targetYaw: number } {
    const dx = flashPos.x - botPos.x;
    const dz = flashPos.z - botPos.z;
    const angleToFlash = Math.atan2(-dx, -dz);

    const delta = Math.abs(Math.atan2(Math.sin(angleToFlash - currentYaw), Math.cos(angleToFlash - currentYaw)));
    // If flash is within front 120° visual cone (0.6 * PI), turn 180° away
    if (delta < 0.6 * Math.PI) {
      const turnAwayYaw = (currentYaw + Math.PI) % (Math.PI * 2);
      return { shouldTurn: true, targetYaw: turnAwayYaw };
    }

    return { shouldTurn: false, targetYaw: currentYaw };
  }

  /**
   * Human visual perception gate (+Z mesh-forward convention: yaw = atan2(dx, dz)).
   * Enforces strict foveal (<= 32°) vs peripheral (32°–halfFovDeg) vision cones:
   *  - Targets outside halfFovDeg are NEVER spotted (zero 360° omniscience).
   *  - Peripheral targets suffer a 1.45× reaction multiplier + 90ms recognition surcharge.
   *  - Exposure confirmation window & human Gaussian jitter prevent robotic frame-0 prefires.
   */
  public static evaluateVisualPerception(
    botMeshYaw: number,
    botEye: Vec3,
    targetEye: Vec3,
    hasLos: boolean,
    config: PerceptionConfig,
    wasMovingOrUnexpected = false
  ): PerceptionResult {
    const dx = targetEye.x - botEye.x;
    const dy = targetEye.y - botEye.y;
    const dz = targetEye.z - botEye.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (!hasLos || distance < 0.001) {
      return {
        spotted: false,
        visionZone: 'OUTSIDE',
        offCenterDeg: 180,
        distance,
        effectiveReactionMs: Infinity,
      };
    }

    const angleToTarget = Math.atan2(dx, dz);
    const deltaRad = Math.abs(normalizeAngleRad(angleToTarget - botMeshYaw));
    const offCenterDeg = (deltaRad * 180) / Math.PI;

    // Close-quarters shoulder bump (< 1.8m) grants modest peripheral awareness; otherwise strict cone
    const effectiveHalfFov = distance < 1.8 ? Math.min(72, config.halfFovDeg + 15) : config.halfFovDeg;
    if (offCenterDeg > effectiveHalfFov) {
      return {
        spotted: false,
        visionZone: 'OUTSIDE',
        offCenterDeg,
        distance,
        effectiveReactionMs: Infinity,
      };
    }

    const fovealDeg = config.fovealHalfFovDeg ?? 32;
    const isPeripheral = offCenterDeg > fovealDeg;
    const visionZone: VisionZone = isPeripheral ? 'PERIPHERAL' : 'FOVEAL';

    const peripheralRatio = Math.min(1, offCenterDeg / Math.max(1, config.halfFovDeg));
    const anglePenaltyMs =
      peripheralRatio * peripheralRatio * config.peripheralPenaltyMs +
      peripheralRatio * (config.peripheralPenaltyMs * 0.35);

    const baseWithZone = isPeripheral
      ? config.baseReactionMs * 1.45 + 90 + anglePenaltyMs * 0.45
      : config.baseReactionMs + anglePenaltyMs;

    const distMs = Math.max(0, (distance - 10) / 10) * config.distancePenaltyMsPer10m;
    const surpriseMs = wasMovingOrUnexpected ? config.surprisePenaltyMs : 0;
    const exposureMs = config.exposureConfirmMs ?? 0;
    const jitterMs = config.reactionJitterMs ?? 0;

    return {
      spotted: true,
      visionZone,
      offCenterDeg,
      distance,
      effectiveReactionMs: Math.max(140, Math.round(baseWithZone + distMs + surpriseMs + exposureMs + jitterMs)),
    };
  }

  /**
   * Smooth, human-grade aim slewing with ease-out deceleration near the target.
   * Eliminates robotic snapping while computing exact remaining angular error in degrees.
   */
  public static stepHumanAim(params: HumanAimParams): HumanAimResult {
    const { currentYaw, currentPitch, desiredYaw, desiredPitch, dt, slewRateDegPerSec } = params;
    const swayYaw = params.swayYawRad ?? 0;
    const swayPitch = params.swayPitchRad ?? 0;

    const targetYaw = normalizeAngleRad(desiredYaw + swayYaw);
    const targetPitch = Math.max(-1.15, Math.min(1.15, desiredPitch + swayPitch));

    const yawDiff = normalizeAngleRad(targetYaw - currentYaw);
    const pitchDiff = targetPitch - currentPitch;

    const maxStepRad = ((slewRateDegPerSec * Math.PI) / 180) * Math.max(0, dt);

    // Human ease-out: fast flick for large angles, smooth fine-correction within 10°
    const yawEase = Math.min(1, Math.abs(yawDiff) / 0.14 + 0.22);
    const pitchEase = Math.min(1, Math.abs(pitchDiff) / 0.12 + 0.25);

    const yawStep = Math.sign(yawDiff) * Math.min(Math.abs(yawDiff), maxStepRad * yawEase);
    const pitchStep = Math.sign(pitchDiff) * Math.min(Math.abs(pitchDiff), maxStepRad * 0.75 * pitchEase);

    const nextYaw = normalizeAngleRad(currentYaw + yawStep);
    const nextPitch = Math.max(-1.15, Math.min(1.15, currentPitch + pitchStep));

    // Measure error against the TRUE desired target (excluding sway)
    const remainingYawRad = Math.abs(normalizeAngleRad(desiredYaw - nextYaw));
    const remainingPitchRad = Math.abs(desiredPitch - nextPitch);
    const yawErrorDeg = (remainingYawRad * 180) / Math.PI;
    const pitchErrorDeg = (remainingPitchRad * 180) / Math.PI;

    return {
      nextYaw,
      nextPitch,
      yawErrorDeg,
      pitchErrorDeg,
      totalErrorDeg: Math.hypot(yawErrorDeg, pitchErrorDeg),
    };
  }

  /**
   * Strict anti-prefire firing gate. A bot is NEVER permitted to pull the trigger unless:
   *  1. The target is currently spotted inside its FOV & LOS,
   *  2. It is neither blinded nor reloading nor empty,
   *  3. Continuous visual confirmation time has surpassed effectiveReactionMs,
   *  4. Its actual crosshair is aligned within maxFireErrorDeg, and
   *  5. It has counter-strafed below maxFireSpeed (except emergency close-quarters < 5.5m).
   */
  public static canBotFire(params: FireGateParams): boolean {
    if (!params.spotted) return false;
    if (params.isReloading || params.ammo <= 0) return false;
    if (params.blindTimerSec > 0) return false;
    if (params.visibleDurationMs < params.effectiveReactionMs) return false;
    if (params.aimErrorDeg > params.maxFireErrorDeg) return false;

    const isEmergencyCqb = params.targetDistance < 5.5;
    if (!isEmergencyCqb && params.horizontalSpeed > params.maxFireSpeed) {
      return false;
    }

    return true;
  }

  /**
   * Selects a realistic target height (chest/upper-torso/head) scaled by skill & burst index.
   * Stops bots from locking 100% onto the player's forehead on every single bullet.
   */
  public static selectAimTargetPoint(
    targetFeet: Vec3,
    targetEye: Vec3,
    isCrouched: boolean,
    skill: number,
    burstShotIndex: number,
    roll01: number
  ): Vec3 {
    const chestY = targetFeet.y + (isCrouched ? 0.84 : 1.26);
    const upperChestY = targetFeet.y + (isCrouched ? 0.96 : 1.40);
    const headY = targetEye.y + 0.02;

    // Realistic headshot calibration probability on opening shot
    let headProb = 0.08;
    if (skill >= 94) headProb = 0.44;
    else if (skill >= 84) headProb = 0.28;
    else if (skill >= 66) headProb = 0.16;

    // Pull down slightly toward upper chest during sustained spray (shot 2+)
    if (burstShotIndex >= 2) {
      headProb *= 0.45;
    }

    let aimY: number;
    if (roll01 < headProb) {
      aimY = headY;
    } else if (skill >= 80) {
      aimY = upperChestY;
    } else {
      aimY = chestY + (roll01 - 0.5) * 0.14;
    }

    return {
      x: targetFeet.x,
      y: aimY,
      z: targetFeet.z,
    };
  }

  /**
   * CS2-caliber tactical combat footwork state machine:
   *  - Retreats to nearby HIGH cover when reloading, flashed, or critically wounded (< 35% HP).
   *  - Alternates crisp counter-strafed firing stops (HOLD_FIRE) with lateral strafe steps (STRAFE_REPOSITION)
   *    so bots never freeze like statues in the open and never run-and-gun laser beams.
   */
  public static evaluateCombatFootwork(params: CombatFootworkParams): CombatFootworkResult {
    const {
      botPos,
      enemyPos,
      healthRatio,
      isReloading,
      isBlinded,
      skill,
      aggression,
      nearbyCoverPos,
      dt,
    } = params;

    let phase = params.currentPhase;
    let timer = params.phaseTimer - dt;
    let strafeSign = params.strafeSign === 0 ? 1 : params.strafeSign;

    const toEnemyX = enemyPos.x - botPos.x;
    const toEnemyZ = enemyPos.z - botPos.z;
    const dist = Math.hypot(toEnemyX, toEnemyZ) || 1;
    const dirX = toEnemyX / dist;
    const dirZ = toEnemyZ / dist;
    // Perpendicular strafe axis
    const perpX = -dirZ;
    const perpZ = dirX;

    // 1. Tactical survival priority: seek cover when blinded, reloading, or critical HP
    const needsCover = isBlinded || isReloading || (healthRatio < 0.36 && skill >= 55);
    if (needsCover && nearbyCoverPos) {
      const toCovX = nearbyCoverPos.x - botPos.x;
      const toCovZ = nearbyCoverPos.z - botPos.z;
      const covDist = Math.hypot(toCovX, toCovZ);
      if (covDist > 0.85) {
        return {
          nextPhase: 'SEEK_COVER',
          nextPhaseTimer: 0.4,
          nextStrafeSign: strafeSign,
          moveDirX: toCovX / covDist,
          moveDirZ: toCovZ / covDist,
          desiredSpeed: 3.7,
          shouldCrouch: false,
        };
      }
      // Already behind cover: hold tight & crouch until reload/flash completes
      return {
        nextPhase: 'SEEK_COVER',
        nextPhaseTimer: 0.25,
        nextStrafeSign: strafeSign,
        moveDirX: 0,
        moveDirZ: 0,
        desiredSpeed: 0,
        shouldCrouch: isReloading || healthRatio < 0.36,
      };
    }

    // If blinded without cover nearby, strafe evasively away from enemy sightline
    if (isBlinded) {
      return {
        nextPhase: 'SEEK_COVER',
        nextPhaseTimer: 0.35,
        nextStrafeSign: strafeSign,
        moveDirX: -dirX * 0.6 + perpX * strafeSign * 0.8,
        moveDirZ: -dirZ * 0.6 + perpZ * strafeSign * 0.8,
        desiredSpeed: 3.2,
        shouldCrouch: false,
      };
    }

    // 2. Active gunfight counter-strafe rhythm
    if (phase === 'SEEK_COVER' || timer <= 0) {
      if (phase === 'HOLD_FIRE') {
        // After completing a stationary burst, micro-strafe laterally (or advance if far & aggressive)
        strafeSign = -strafeSign;
        if (dist > 28 && aggression >= 65 && healthRatio > 0.6) {
          phase = 'ADVANCE_PRESSURE';
          timer = 0.42;
        } else {
          phase = 'STRAFE_REPOSITION';
          // Higher-skill bots execute snappier counter-strafe windows
          timer = skill >= 85 ? 0.30 : skill >= 65 ? 0.38 : 0.48;
        }
      } else {
        // Counter-strafe to full stop for an accurate burst window
        phase = 'HOLD_FIRE';
        timer = skill >= 85 ? 0.48 : skill >= 65 ? 0.58 : 0.72;
      }
    }

    if (phase === 'HOLD_FIRE') {
      const shouldCrouch = skill >= 82 && dist > 10 && dist < 24 && timer < 0.22;
      return {
        nextPhase: 'HOLD_FIRE',
        nextPhaseTimer: timer,
        nextStrafeSign: strafeSign,
        moveDirX: 0,
        moveDirZ: 0,
        desiredSpeed: 0,
        shouldCrouch,
      };
    }

    if (phase === 'ADVANCE_PRESSURE') {
      const mx = dirX * 0.75 + perpX * strafeSign * 0.66;
      const mz = dirZ * 0.75 + perpZ * strafeSign * 0.66;
      const len = Math.hypot(mx, mz) || 1;
      return {
        nextPhase: 'ADVANCE_PRESSURE',
        nextPhaseTimer: timer,
        nextStrafeSign: strafeSign,
        moveDirX: mx / len,
        moveDirZ: mz / len,
        desiredSpeed: 3.1,
        shouldCrouch: false,
      };
    }

    // STRAFE_REPOSITION: crisp lateral strafe (slightly backing off if enemy is right in face)
    const backBias = dist < 6.5 ? -0.35 : 0;
    const mx = perpX * strafeSign + dirX * backBias;
    const mz = perpZ * strafeSign + dirZ * backBias;
    const len = Math.hypot(mx, mz) || 1;
    return {
      nextPhase: 'STRAFE_REPOSITION',
      nextPhaseTimer: timer,
      nextStrafeSign: strafeSign,
      moveDirX: mx / len,
      moveDirZ: mz / len,
      desiredSpeed: skill >= 85 ? 3.25 : 2.75,
      shouldCrouch: false,
    };
  }

  /**
   * Smooth lateral corridor separation that prevents two bots from deadlocking
   * face-to-face (`speed = 0`) in doorways and narrow lanes.
   */
  public static computeCorridorSeparation(
    botPos: Vec3,
    desiredDirX: number,
    desiredDirZ: number,
    botIndex: number,
    otherPositions: ReadonlyArray<Vec3>
  ): CorridorSeparationResult {
    let dirX = desiredDirX;
    let dirZ = desiredDirZ;
    let speedMultiplier = 1.0;

    for (let i = 0; i < otherPositions.length; i++) {
      const other = otherPositions[i];
      const dx = botPos.x - other.x;
      const dz = botPos.z - other.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= 1.75 || dist < 0.001) continue;

      const pushX = dx / dist;
      const pushZ = dz / dist;
      const weight = (1.75 - dist) / 1.75;

      // Always add a deterministic right-hand passing tangent so head-on bots smoothly pass
      const passSign = (botIndex % 2 === 0 ? 1 : -1);
      const tanX = -pushZ * passSign;
      const tanZ = pushX * passSign;

      dirX += (pushX * 0.9 + tanX * 0.65) * weight;
      dirZ += (pushZ * 0.9 + tanZ * 0.65) * weight;

      // Gently yield speed when directly behind a teammate without ever freezing to 0.0
      const toOtherX = -pushX;
      const toOtherZ = -pushZ;
      const dotHeading = toOtherX * desiredDirX + toOtherZ * desiredDirZ;
      if (dotHeading > 0.72 && dist < 1.35) {
        speedMultiplier = Math.min(speedMultiplier, Math.max(0.45, dist / 1.35));
      }
    }

    const len = Math.hypot(dirX, dirZ);
    if (len > 0.001) {
      dirX /= len;
      dirZ /= len;
    }

    return { dirX, dirZ, speedMultiplier };
  }

  /**
   * CS2 Pro Jiggle-Peek calculation: computes counter-strafed shoulder-bait position.
   * Oscillates along the peek vector with rapid 0.32s periods.
   */
  public static computeJigglePeekOffset(
    anchorPos: Vec3,
    peekDir: Vec3,
    elapsedSeconds: number,
    amplitude = 0.60
  ): Vec3 {
    // Sharp sinusoidal strafe cycle: 0.32s full period
    const cycle = Math.sin((elapsedSeconds / 0.32) * Math.PI * 2);
    return {
      x: anchorPos.x + peekDir.x * cycle * amplitude,
      y: anchorPos.y,
      z: anchorPos.z + peekDir.z * cycle * amplitude,
    };
  }

  /**
   * Fake-defuse tactical sequence: tap defuse for 0.42s to trigger defuse cable audio,
   * then release defuse and pre-aim anticipated enemy push angle.
   */
  public static evaluateFakeDefuse(
    startTimeOrElapsed: number,
    currentTimeOrEnemies: number,
    enemiesAlive = 1
  ): { isFakeDefusing: boolean; shouldBreakAndAim: boolean } {
    let elapsed = startTimeOrElapsed;
    let enemies = currentTimeOrEnemies;
    if (arguments.length >= 3) {
      const rawDiff = currentTimeOrEnemies - startTimeOrElapsed;
      elapsed = rawDiff > 50 ? rawDiff / 1000 : rawDiff;
      enemies = enemiesAlive;
    }

    if (enemies <= 0) {
      return { isFakeDefusing: false, shouldBreakAndAim: false };
    }

    if (elapsed >= 0.42 && elapsed <= 0.55) {
      // Break defuse and pre-aim
      return { isFakeDefusing: true, shouldBreakAndAim: true };
    }

    return { isFakeDefusing: true, shouldBreakAndAim: false };
  }
}
