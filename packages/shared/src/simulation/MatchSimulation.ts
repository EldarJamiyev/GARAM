import { ECONOMY } from '../constants/economy.js';
import { Vec3 } from '../physics/RaycastEngine.js';

export type MatchPhase = 'FREEZE_TIME' | 'ROUND_LIVE' | 'ROUND_END' | 'MATCH_OVER';

export interface RoundEndResult {
  winner: 'Vanguard' | 'Syndicate';
  reason: string;
  ctScore: number;
  tScore: number;
  ctPayout: number;
  tPayout: number;
  isMatchComplete: boolean;
}

export interface MatchSimulationConfig {
  maxRounds?: number;
  freezeTimeDuration?: number;
  roundLiveDuration?: number;
  roundEndDuration?: number;
  bombDetonateDuration?: number;
}

/**
 * Headless, deterministic 5v5 competitive match simulation kernel.
 * Shares 100% mathematical parity across Node.js server and offline client.
 */
export class MatchSimulation {
  public phase: MatchPhase = 'FREEZE_TIME';
  public round = 1;
  public phaseTimer = 10.0;
  public ctScore = 0;
  public tScore = 0;
  public ctLossStreak = 0;
  public tLossStreak = 0;

  // Bomb State
  public isBombPlanted = false;
  public bombSite: 'A' | 'B' | null = null;
  public bombPos: Vec3 | null = null;
  public bombTimer = 0;
  public plantProgress = 0;
  public defuseProgress = 0;

  public readonly maxRounds: number;
  public readonly freezeTimeDuration: number;
  public readonly roundLiveDuration: number;
  public readonly roundEndDuration: number;
  public readonly bombDetonateDuration: number;

  constructor(config: MatchSimulationConfig = {}) {
    this.maxRounds = config.maxRounds ?? 24;
    this.freezeTimeDuration = config.freezeTimeDuration ?? 10.0;
    this.roundLiveDuration = config.roundLiveDuration ?? 115.0; // 1:55
    this.roundEndDuration = config.roundEndDuration ?? 5.0;
    this.bombDetonateDuration = config.bombDetonateDuration ?? 40.0;
    this.phaseTimer = this.freezeTimeDuration;
  }

  public resetMatch(): void {
    this.phase = 'FREEZE_TIME';
    this.round = 1;
    this.phaseTimer = this.freezeTimeDuration;
    this.ctScore = 0;
    this.tScore = 0;
    this.ctLossStreak = 0;
    this.tLossStreak = 0;
    this.resetBomb();
  }

  public resetBomb(): void {
    this.isBombPlanted = false;
    this.bombSite = null;
    this.bombPos = null;
    this.bombTimer = 0;
    this.plantProgress = 0;
    this.defuseProgress = 0;
  }

  public startRound(): void {
    this.phase = 'ROUND_LIVE';
    this.phaseTimer = this.roundLiveDuration;
    this.resetBomb();
  }

  public armBomb(site: 'A' | 'B', pos: Vec3): void {
    this.isBombPlanted = true;
    this.bombSite = site;
    this.bombPos = { ...pos };
    this.bombTimer = this.bombDetonateDuration;
  }

  public stepDefuse(dt: number, hasKit: boolean): { defused: boolean; progress: number } {
    if (!this.isBombPlanted) return { defused: false, progress: 0 };

    const totalTime = hasKit ? 5.0 : 10.0;
    this.defuseProgress = Math.min(1.0, this.defuseProgress + dt / totalTime);

    if (this.defuseProgress >= 1.0) {
      return { defused: true, progress: 1.0 };
    }
    return { defused: false, progress: this.defuseProgress };
  }

  public update(dt: number): RoundEndResult | null {
    if (this.phase === 'MATCH_OVER') return null;

    this.phaseTimer = Math.max(0, this.phaseTimer - dt);

    if (this.isBombPlanted) {
      this.bombTimer = Math.max(0, this.bombTimer - dt);
      if (this.bombTimer <= 0 && this.phase === 'ROUND_LIVE') {
        // Bomb detonated! Syndicate Victory
        return this.endRound('Syndicate', 'Pulse Core Detonated');
      }
    }

    if (this.phaseTimer <= 0) {
      if (this.phase === 'FREEZE_TIME') {
        this.startRound();
      } else if (this.phase === 'ROUND_LIVE') {
        if (!this.isBombPlanted) {
          // Time expired with no plant: Vanguard Defenders win
          return this.endRound('Vanguard', 'Time Expired — Sites Defended');
        }
      } else if (this.phase === 'ROUND_END') {
        this.round++;
        const targetRoundsToWin = Math.ceil(this.maxRounds / 2);
        if (this.ctScore >= targetRoundsToWin || this.tScore >= targetRoundsToWin) {
          this.phase = 'MATCH_OVER';
        } else {
          this.phase = 'FREEZE_TIME';
          this.phaseTimer = this.freezeTimeDuration;
          this.resetBomb();
        }
      }
    }

    return null;
  }

  public endRound(winner: 'Vanguard' | 'Syndicate', reason: string): RoundEndResult {
    const isVanguard = winner === 'Vanguard';
    if (isVanguard) {
      this.ctScore++;
      this.ctLossStreak = 0;
      this.tLossStreak = Math.min(4, this.tLossStreak + 1);
    } else {
      this.tScore++;
      this.tLossStreak = 0;
      this.ctLossStreak = Math.min(4, this.ctLossStreak + 1);
    }

    const ctLossBonus = ECONOMY.lossBonusBase + this.ctLossStreak * ECONOMY.lossBonusStep;
    const tLossBonus = ECONOMY.lossBonusBase + this.tLossStreak * ECONOMY.lossBonusStep;

    const winBonus = reason.includes('Detonated') || reason.includes('Defused') ? ECONOMY.winCashBomb : ECONOMY.winCashElimination;
    const ctPayout = isVanguard ? winBonus : Math.min(ECONOMY.lossBonusMax, ctLossBonus);
    const tPayout = !isVanguard ? winBonus : Math.min(ECONOMY.lossBonusMax, tLossBonus);

    this.phase = 'ROUND_END';
    this.phaseTimer = this.roundEndDuration;

    const targetWins = Math.ceil(this.maxRounds / 2);
    const isMatchComplete = this.ctScore >= targetWins || this.tScore >= targetWins;
    if (isMatchComplete) {
      this.phase = 'MATCH_OVER';
    }

    return {
      winner,
      reason,
      ctScore: this.ctScore,
      tScore: this.tScore,
      ctPayout,
      tPayout,
      isMatchComplete,
    };
  }
}
