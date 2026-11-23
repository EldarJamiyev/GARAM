import { describe, it, expect } from 'vitest';
import { BotBrain, MatchSimulation, ECONOMY } from '../index.js';

describe('Shared MatchSimulation & Grandmaster BotBrain Suite', () => {
  it('correctly evaluates pistol round economy (Round 1 & 13)', () => {
    const ctCash = [800, 800, 800, 800, 800];
    const decisions = BotBrain.evaluateTeamEconomy(ctCash, 0, 1, true);

    expect(decisions.length).toBe(5);
    for (const d of decisions) {
      expect(d.ecoState).toBe('FORCE_BUY');
      expect(d.primaryWeaponId).toBe('usp-s');
      expect(d.buyArmor).toBe(true);
      expect(d.buyHelmet).toBe(false);
    }

    const tDecisions = BotBrain.evaluateTeamEconomy(ctCash, 0, 1, false);
    for (const d of tDecisions) {
      expect(d.primaryWeaponId).toBe('glock-18');
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

    const ctDecisions = BotBrain.evaluateTeamEconomy(cash, 1, 4, true);
    for (const d of ctDecisions) {
      expect(['vanguard-m4', 'm4a4', 'sovereign-awp']).toContain(d.primaryWeaponId);
    }
  });

  it('triggers eco save round when average cash < $2,400 with short loss streak', () => {
    const cash = [1800, 2100, 1900, 2400, 1500];
    const decisions = BotBrain.evaluateTeamEconomy(cash, 1, 5, true);

    for (const d of decisions) {
      expect(d.ecoState).toBe('ECO_SAVE');
      expect(['usp-s', 'desert-eagle']).toContain(d.primaryWeaponId);
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

    // End round (Round 1 pistol defuse loss: CS2 MR12 pistol min $1,900 + $800 post-plant bonus = $2,700)
    const end = sim.endRound('Vanguard', 'Pulse Core Defused');
    expect(end.winner).toBe('Vanguard');
    expect(end.ctScore).toBe(1);
    expect(end.tScore).toBe(0);
    expect(end.ctPayout).toBe(ECONOMY.winCashBomb);
    expect(end.tPayout).toBe(ECONOMY.lossBonusBase + ECONOMY.lossBonusStep + ECONOMY.tLossBonusPostPlant);
    expect(sim.roundsToWin).toBe(13); // MR12
  });

  it('enforces CS2 loss-streak ladder ($1,400 -> $1,900 -> $2,400) and decrements streak by 1 on win', () => {
    const sim = new MatchSimulation();
    sim.round = 2; // Gun round (non-pistol)
    // 1st consecutive loss (streak 0) -> $1,400
    const r1 = sim.endRound('Vanguard', 'Elimination');
    expect(r1.tPayout).toBe(1400);
    // 2nd consecutive loss (streak 1) -> $1,900
    const r2 = sim.endRound('Vanguard', 'Elimination');
    expect(r2.tPayout).toBe(1900);
    // 3rd consecutive loss (streak 2) -> $2,400
    const r3 = sim.endRound('Vanguard', 'Elimination');
    expect(r3.tPayout).toBe(2400);
    // Syndicate wins -> streak decrements by 1 (3 -> 2), next loss pays $2,400
    sim.endRound('Syndicate', 'Elimination');
    expect(sim.tLossStreak).toBe(2);
    const r5 = sim.endRound('Vanguard', 'Elimination');
    expect(r5.tPayout).toBe(2400);
  });

  it('swaps CT/T scores and resets loss streaks automatically at MR12 halftime (Round 12 -> Round 13)', () => {
    const sim = new MatchSimulation({ roundEndDuration: 1.0 });
    sim.round = ECONOMY.halfTimeRound; // Round 12
    sim.ctScore = 7;
    sim.tScore = 4;
    sim.ctLossStreak = 2;
    sim.tLossStreak = 3;

    const end12 = sim.endRound('Vanguard', 'Elimination');
    expect(end12.isHalftime).toBe(true);
    expect(sim.ctScore).toBe(8);
    expect(sim.tScore).toBe(4);

    // Advance past ROUND_END to enter Round 13
    sim.update(1.2);
    expect(sim.round).toBe(13);
    expect(sim.halftimeSwapped).toBe(true);
    expect(sim.ctScore).toBe(4);
    expect(sim.tScore).toBe(8);
    expect(sim.ctLossStreak).toBe(0);
    expect(sim.tLossStreak).toBe(0);
  });

  it('bounces grenades and detonates Molotovs cleanly on CS_OFFICE Courtyard (0m), Office Floor (1.4m), and Mezzanine (3.5m)', async () => {
    const { CS_OFFICE_BLOCKS, CS_OFFICE_FLOOR_Y, CS_OFFICE_UPPER_Y, SPAWN_POINTS, simulateGrenadeTrajectory, SpatialGrid } = await import('../index.js');
    const grid = new SpatialGrid(CS_OFFICE_BLOCKS, 6);

    // 1. Courtyard (CT Spawn, y = 0.0m): smoke bounces cleanly on ground >= 0.0m
    const courtyardSmoke = simulateGrenadeTrajectory(
      { x: SPAWN_POINTS.VANGUARD_CT.x, y: SPAWN_POINTS.VANGUARD_CT.y + 1.5, z: SPAWN_POINTS.VANGUARD_CT.z + 1.0 },
      { x: 0, y: 1.0, z: 3.0 },
      1.6,
      CS_OFFICE_BLOCKS,
      false,
      1 / 64,
      grid
    );
    expect(courtyardSmoke.bounces).toBeGreaterThanOrEqual(1);
    expect(courtyardSmoke.finalPos.y).toBeGreaterThanOrEqual(0.0);

    // 2. Main Office Floor (y = 1.4m): Molotov detonates right on y = 1.4m office floor slab
    const officeMolo = simulateGrenadeTrajectory(
      { x: 2.0, y: CS_OFFICE_FLOOR_Y + 1.5, z: 3.0 },
      { x: 0, y: -1.0, z: 2.0 },
      5.0,
      CS_OFFICE_BLOCKS,
      true,
      1 / 64,
      grid
    );
    expect(officeMolo.finalPos.y).toBeGreaterThanOrEqual(CS_OFFICE_FLOOR_Y);
    expect(officeMolo.finalPos.y).toBeLessThan(CS_OFFICE_FLOOR_Y + 0.4);

    // 3. Sniper Mezzanine Overlook (y = 3.5m): Molotov detonates cleanly on y = 3.5m slab
    const mezzMolo = simulateGrenadeTrajectory(
      { x: 0, y: CS_OFFICE_UPPER_Y + 1.2, z: -10.0 },
      { x: 0, y: -1.5, z: 0 },
      5.0,
      CS_OFFICE_BLOCKS,
      true,
      1 / 64,
      grid
    );
    expect(mezzMolo.finalPos.y).toBeGreaterThanOrEqual(CS_OFFICE_UPPER_Y);
    expect(mezzMolo.finalPos.y).toBeLessThan(CS_OFFICE_UPPER_Y + 0.4);
  });

  it('keeps CS_OFFICE Long Hall drywall wallbangable (DRYWALL) while preserving >= 2.5m walkable Paper Room doorway clearance', async () => {
    const { CS_OFFICE_BLOCKS } = await import('../index.js');
    const northWall = CS_OFFICE_BLOCKS.find((b) => b.id === 'long_wall_1');
    const southWall = CS_OFFICE_BLOCKS.find((b) => b.id === 'long_wall_2');

    expect(northWall).toBeDefined();
    expect(southWall).toBeDefined();
    expect(northWall!.material).toBe('DRYWALL');
    expect(southWall!.material).toBe('DRYWALL');

    // Paper Room doorway gap between long_wall_1.maxZ (0.0) and long_wall_2.minZ (5.5) must be >= 2.5m
    const doorGap = southWall!.minZ - northWall!.maxZ;
    expect(doorGap).toBeGreaterThanOrEqual(2.5);
  });
});


