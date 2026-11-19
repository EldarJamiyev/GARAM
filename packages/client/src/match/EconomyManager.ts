import * as THREE from 'three';
import { ECONOMY, getLossBonus, SPAWN_ZONES } from '@garam/shared';

export class EconomyManager {
  public cash = ECONOMY.startingCash; // $800
  public armor = 100;
  public hasHelmet = true;
  public hasDefuseKit = false;

  constructor() {}

  public isInsideBuyZone(playerPos: THREE.Vector3): boolean {
    const bz = SPAWN_ZONES.VANGUARD_BUY_ZONE;
    return (
      playerPos.x >= bz.minX &&
      playerPos.x <= bz.maxX &&
      playerPos.z >= bz.minZ &&
      playerPos.z <= bz.maxZ
    );
  }

  public canBuy(roundPhase: string, roundTimer: number, playerPos: THREE.Vector3): { canBuy: boolean; reason?: string } {
    if (roundPhase === 'FREEZE_TIME') return { canBuy: true };

    if (roundPhase === 'ROUND_LIVE') {
      const elapsed = ECONOMY.roundLiveSec - roundTimer;
      if (elapsed > ECONOMY.buyWindowSec) {
        return { canBuy: false, reason: 'BUY WINDOW CLOSED (20s EXPIRED)' };
      }
      if (!this.isInsideBuyZone(playerPos)) {
        return { canBuy: false, reason: 'OUTSIDE BUY ZONE' };
      }
      return { canBuy: true };
    }

    return { canBuy: false, reason: 'BUYING NOT PERMITTED' };
  }

  public spendCash(amount: number): boolean {
    if (this.cash >= amount) {
      this.cash -= amount;
      return true;
    }
    return false;
  }

  public addCash(amount: number): void {
    this.cash = Math.min(ECONOMY.maxCash, this.cash + amount);
  }

  public awardRoundEndPayout(isWinner: boolean, lossStreak: number, isBombWin: boolean, isSyndicatePlantLoss = false): number {
    let payout = 0;
    if (isWinner) {
      payout = isBombWin ? ECONOMY.winCashBomb : ECONOMY.winCashElimination;
    } else {
      payout = getLossBonus(lossStreak);
      if (isSyndicatePlantLoss) {
        payout += ECONOMY.tLossBonusPostPlant;
      }
    }
    this.addCash(payout);
    return payout;
  }

  public devPracticeMoney(): void {
    this.cash = ECONOMY.maxCash;
    this.armor = 100;
    this.hasHelmet = true;
    this.hasDefuseKit = true;
  }
}
