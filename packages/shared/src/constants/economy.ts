export interface EconomyConfig {
  maxRounds: number;
  roundsToWin: number;
  halfTimeRound: number;
  startingCash: number;
  maxCash: number;
  freezeTimeSec: number;
  buyWindowSec: number;
  roundLiveSec: number;
  bombTimerSec: number;
  roundEndSec: number;
  plantTimeSec: number;
  defuseTimeSecNormal: number;
  defuseTimeSecKit: number;
  winCashElimination: number;
  winCashBomb: number;
  lossBonusBase: number;
  lossBonusStep: number;
  lossBonusMax: number;
  tLossBonusPostPlant: number;
  prices: {
    kevlar: number;
    helmet: number;
    kevlarHelmetCombo: number;
    defuseKit: number;
    smokeGrenade: number;
  };
}

export const ECONOMY: EconomyConfig = {
  maxRounds: 24,
  roundsToWin: 13,
  halfTimeRound: 12,
  startingCash: 800,
  maxCash: 16000,
  freezeTimeSec: 8,
  buyWindowSec: 20,
  roundLiveSec: 115, // 01:55 combat clock
  bombTimerSec: 40,
  roundEndSec: 5,
  plantTimeSec: 3.2,
  defuseTimeSecNormal: 10.0,
  defuseTimeSecKit: 5.0,
  winCashElimination: 3250,
  winCashBomb: 3500,
  lossBonusBase: 1400,
  lossBonusStep: 500,
  lossBonusMax: 3400, // $1400, $1900, $2400, $2900, $3400 (streak 0..4)
  tLossBonusPostPlant: 800,
  prices: {
    kevlar: 650,
    helmet: 350,
    kevlarHelmetCombo: 1000,
    defuseKit: 400,
    smokeGrenade: 300,
  },
};

export function getLossBonus(lossStreak: number, isPistolLoss = false): number {
  if (isPistolLoss && lossStreak <= 1) {
    return ECONOMY.lossBonusBase + ECONOMY.lossBonusStep; // $1,900 minimum in MR12 to prevent CT starvation
  }
  const clampedStreak = Math.max(0, Math.min(4, lossStreak));
  return ECONOMY.lossBonusBase + clampedStreak * ECONOMY.lossBonusStep;
}
