import { describe, it, expect } from 'vitest';
import { BotBrain, MatchSimulation, ECONOMY } from '../index.js';

describe('Shared MatchSimulation & Grandmaster BotBrain Suite', () => {
  it('correctly evaluates pistol round economy (Round 1 & 13)', () => {
    const ctCash = [800, 800, 800, 800, 800];
    const decisions = BotBrain.evaluateTeamEconomy(ctCash, 0, 1, true);

    expect(decisions.length).toBe(5);
    for (const d of decisions) {
      expect(d.ecoState).toBe('FORCE_BUY');
      expect(d.primaryWeaponId).toBe('desert-eagle');
      expect(d.buyArmor).toBe(true);
      expect(d.buyHelmet).toBe(false);
    }
  });

  it('coordinates full team buys when average cash >= $4,200', () => {
    const cash = [4500, 5200, 4800, 6000, 4200];
    const decisions = BotBrain.evaluateTeamEconomy(cash, 1, 4, false);

    for (const d of decisions) {
      expect(d.ecoState).toBe('FULL_BUY');
      expect(['garam-47', 'sovereign-awp']).toContain(d.primaryWeaponId);
      expect(d.buyArmor).toBe(true);
      expect(d.buyHelmet).toBe(true);
    }
  });

  it('triggers eco save round when average cash < $2,400 with short loss streak', () => {
    const cash = [1800, 2100, 1900, 2400, 1500];
    const decisions = BotBrain.evaluateTeamEconomy(cash, 1, 5, true);

    for (const d of decisions) {
      expect(d.ecoState).toBe('ECO_SAVE');
      expect(d.primaryWeaponId).toBe('desert-eagle');
      expect(d.buyArmor).toBe(false);
      expect(d.buyHelmet).toBe(false);
    }
  });

  it('calculates anti-flash 180-degree escape angle when flashbang is in front visual cone', () => {
    const botPos = { x: 0, y: 1.6, z: 0 };
    const flashPosInFront = { x: 0, y: 1.6, z: -10 }; // Ahead along -Z forward vector
    const currentYaw = 0; // Looking along -Z

    const res = BotBrain.calculateAntiFlashYaw(currentYaw, flashPosInFront, botPos);
    expect(res.shouldTurn).toBe(true);
    // Turns ~180° away (PI)
    expect(Math.abs(Math.abs(res.targetYaw) - Math.PI)).toBeLessThan(0.01);

    // Flash behind bot along +Z
    const flashPosBehind = { x: 0, y: 1.6, z: 10 };
    const resBehind = BotBrain.calculateAntiFlashYaw(currentYaw, flashPosBehind, botPos);
    expect(resBehind.shouldTurn).toBe(false);
  });

  it('computes periodic jiggle-peek oscillation along peek direction', () => {
    const anchor = { x: 10, y: 0, z: 5 };
    const peekDir = { x: 1, y: 0, z: 0 }; // Strafe horizontally along X

    const p0 = BotBrain.computeJigglePeekOffset(anchor, peekDir, 0.0);
    expect(p0.x).toBeCloseTo(10.0, 2);

    // Peak of forward peek at 0.08s (quarter period of 0.32s)
    const pPeak = BotBrain.computeJigglePeekOffset(anchor, peekDir, 0.08);
    expect(pPeak.x).toBeCloseTo(10.60, 2);

    // Return to anchor at 0.16s (half period)
    const pHalf = BotBrain.computeJigglePeekOffset(anchor, peekDir, 0.16);
    expect(pHalf.x).toBeCloseTo(10.0, 2);
  });

  it('triggers fake defuse cable click and break-and-aim sequence', () => {
    const startTime = 1000;
    // At t=1000 (0s elapsed): actively defusing
    const s0 = BotBrain.evaluateFakeDefuse(startTime, 1000, 2);
    expect(s0.isFakeDefusing).toBe(true);
    expect(s0.shouldBreakAndAim).toBe(false);

    // At t=1450 (0.45s elapsed): break defuse and pre-aim
    const s1 = BotBrain.evaluateFakeDefuse(startTime, 1450, 2);
    expect(s1.isFakeDefusing).toBe(true);
    expect(s1.shouldBreakAndAim).toBe(true);
  });

  it('simulates competitive round lifecycle, payouts, bomb plant, and defuse', () => {
    const sim = new MatchSimulation({ freezeTimeDuration: 5.0, roundLiveDuration: 30.0 });
    expect(sim.phase).toBe('FREEZE_TIME');

    // Tick past freeze time
    sim.update(5.1);
    expect(sim.phase).toBe('ROUND_LIVE');

    // Arm bomb at Site A
    sim.armBomb('A', { x: -30, y: 0, z: -28 });
    expect(sim.isBombPlanted).toBe(true);
    expect(sim.bombSite).toBe('A');

    // Defuse with kit (5.0s requirement)
    const defuse1 = sim.stepDefuse(2.5, true);
    expect(defuse1.defused).toBe(false);
    expect(defuse1.progress).toBeCloseTo(0.5, 2);

    const defuse2 = sim.stepDefuse(2.6, true);
    expect(defuse2.defused).toBe(true);

    // End round
    const end = sim.endRound('Vanguard', 'Pulse Core Defused');
    expect(end.winner).toBe('Vanguard');
    expect(end.ctScore).toBe(1);
    expect(end.tScore).toBe(0);
    expect(end.ctPayout).toBe(ECONOMY.winCashBomb);
    expect(end.tPayout).toBe(ECONOMY.lossBonusBase + ECONOMY.lossBonusStep); // Loss streak 1: $1,900
  });
});
