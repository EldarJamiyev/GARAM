import { describe, it, expect } from 'vitest';
import { ECONOMY, getLossBonus, WEAPONS } from '../index.js';

describe('Competitive MR12 Economy System', () => {
  it('correctly calculates round win, defuse bonus, and progressive loss streak payouts', () => {
    expect(ECONOMY.winCashElimination).toBe(3250);
    expect(ECONOMY.winCashBomb).toBe(3500);
    expect(ECONOMY.defuseBonus).toBe(250);
    expect(ECONOMY.prices.defuseKit).toBe(300);
    expect(WEAPONS['vanguard-m4'].price).toBe(2750);

    // Consecutive loss ladder: Base $1400, Step $500, Max $3400
    expect(ECONOMY.lossBonusBase).toBe(1400);
    expect(ECONOMY.lossBonusBase + ECONOMY.lossBonusStep * 1).toBe(1900);
    expect(ECONOMY.lossBonusBase + ECONOMY.lossBonusStep * 2).toBe(2400);
    expect(ECONOMY.lossBonusBase + ECONOMY.lossBonusStep * 3).toBe(2900);
    expect(ECONOMY.lossBonusMax).toBe(3400);
  });

  it('awards MR12 $1900 loss bonus after pistol round loss to prevent CT starvation', () => {
    // Round 1 or 13 lost: streak starts at 1 ($1,900)
    expect(getLossBonus(0, true)).toBe(1900);
    expect(getLossBonus(1, true)).toBe(1900);
    expect(getLossBonus(2, false)).toBe(2400);
  });

  it('post-plant loss bonus adds +$800 for terrorists', () => {
    expect(ECONOMY.tLossBonusPostPlant).toBe(800);
    const totalPayout = ECONOMY.lossBonusBase + ECONOMY.tLossBonusPostPlant;
    expect(totalPayout).toBe(2200); // $1400 + $800 = $2200
  });

  it('cash cap is strictly clamped to $16,000 max', () => {
    expect(ECONOMY.maxCash).toBe(16000);
    let cash = 15000;
    cash = Math.min(ECONOMY.maxCash, cash + ECONOMY.winCashElimination);
    expect(cash).toBe(16000);
  });

  it('halftime resets economy to starting cash of $800', () => {
    expect(ECONOMY.startingCash).toBe(800);
    expect(ECONOMY.halfTimeRound).toBe(12);
  });
});
