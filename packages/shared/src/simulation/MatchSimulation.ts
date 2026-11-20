import { ECONOMY, getLossBonus } from '../constants/economy.js';
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
  public phaseTimer: number = ECONOMY.freezeTimeSec;
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
  public readonly roundsToWin: number;
  public readonly freezeTimeDuration: number;
  public readonly roundLiveDuration: number;
  public readonly roundEndDuration: number;
  public readonly bombDetonateDuration: number;

  constructor(config: MatchSimulationConfig = {}) {
    this.maxRounds = config.maxRounds ?? ECONOMY.maxRounds;
    this.roundsToWin = Math.floor(this.maxRounds / 2) + 1; // MR12: 24/2 + 1 = 13
    this.freezeTimeDuration = config.freezeTimeDuration ?? ECONOMY.freezeTimeSec;
    this.roundLiveDuration = config.roundLiveDuration ?? ECONOMY.roundLiveSec; // 1:55
    this.roundEndDuration = config.roundEndDuration ?? ECONOMY.roundEndSec;
    this.bombDetonateDuration = config.bombDetonateDuration ?? ECONOMY.bombTimerSec;
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
    this.plantProgress = 1.0;
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
        if (this.ctScore >= this.roundsToWin || this.tScore >= this.roundsToWin) {
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
    const isPistolRound = this.round === 1 || this.round === ECONOMY.halfTimeRound + 1;
    const winBonus = reason.includes('Detonated') || reason.includes('Defused')
      ? ECONOMY.winCashBomb
      : ECONOMY.winCashElimination;

    let ctPayout: number;
    let tPayout: number;

    if (isVanguard) {
      this.ctScore++;
      ctPayout = winBonus;
      // CS2 MR12 loss bonus: calculate payout for current loss streak BEFORE incrementing (pistol starts at $1,900)
      const baseTLoss = getLossBonus(this.tLossStreak, isPistolRound);
      const postPlantBonus = this.isBombPlanted ? ECONOMY.tLossBonusPostPlant : 0;
      tPayout = baseTLoss + postPlantBonus;
      // CS2 MR12: winning decrements loss streak by 1 (not hard-reset to 0)
      this.ctLossStreak = Math.max(0, this.ctLossStreak - 1);
      this.tLossStreak = Math.min(4, (isPistolRound ? Math.max(1, this.tLossStreak) : this.tLossStreak) + 1);
    } else {
      this.tScore++;
      tPayout = winBonus;
      ctPayout = getLossBonus(this.ctLossStreak, isPistolRound);
      this.tLossStreak = Math.max(0, this.tLossStreak - 1);
      this.ctLossStreak = Math.min(4, (isPistolRound ? Math.max(1, this.ctLossStreak) : this.ctLossStreak) + 1);
    }

    this.phase = 'ROUND_END';
    this.phaseTimer = this.roundEndDuration;

    const isMatchComplete = this.ctScore >= this.roundsToWin || this.tScore >= this.roundsToWin;
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
