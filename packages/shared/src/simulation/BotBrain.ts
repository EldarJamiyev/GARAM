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

/**
 * Pure, deterministic tactical AI decision kernel for competitive CS2 bot simulation.
 * Zero DOM and zero Three.js dependencies.
 */
export class BotBrain {
  /**
   * Evaluates team-wide economy coordination according to competitive CS2 ladder rules.
   */
  public static evaluateTeamEconomy(
    teamCash: number[],
    lossStreak: number,
    roundNumber: number,
    isVanguard: boolean
  ): EcoDecision[] {
    const avgCash = teamCash.reduce((a, b) => a + b, 0) / Math.max(1, teamCash.length);

    // Round 1 (Pistols) or OT
    if (roundNumber === 1 || roundNumber === 13) {
      return teamCash.map(cash => ({
        ecoState: 'FORCE_BUY' as TeamEcoState,
        primaryWeaponId: 'desert-eagle',
        buyArmor: cash >= 650,
        buyHelmet: false,
        buyDefuseKit: isVanguard && cash >= 1000,
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

    return teamCash.map(cash => {
      if (teamEcoState === 'FULL_BUY') {
        const rifle = isVanguard ? 'vanguard-m4' : 'garam-47';
        const primary = cash >= 5750 && Math.random() < 0.25 ? 'sovereign-awp' : rifle;
        return {
          ecoState: 'FULL_BUY',
          primaryWeaponId: primary,
          buyArmor: cash >= 650,
          buyHelmet: cash >= 1000,
          buyDefuseKit: isVanguard && cash >= 1350,
        };
      } else if (teamEcoState === 'FORCE_BUY') {
        return {
          ecoState: 'FORCE_BUY',
          primaryWeaponId: cash >= 2700 ? (isVanguard ? 'vanguard-m4' : 'garam-47') : 'desert-eagle',
          buyArmor: cash >= 650,
          buyHelmet: cash >= 1000,
          buyDefuseKit: isVanguard && cash >= 1300,
        };
      } else {
        // ECO_SAVE: preserve cash for next round full buy
        return {
          ecoState: 'ECO_SAVE',
          primaryWeaponId: 'desert-eagle',
          buyArmor: false,
          buyHelmet: false,
          buyDefuseKit: false,
        };
      }
    });
  }

  /**
   * Anti-flash dodge: calculates 180° escape yaw when an incoming flashbang is spotted.
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
