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

  it('bounces grenades and detonates Molotovs cleanly on DE_MERIDIAN y=2.1m Main Deck and y=4.9m Overlooks', async () => {
    const { DE_CITADEL_BLOCKS, SPAWN_POINTS, simulateGrenadeTrajectory, SpatialGrid } = await import('../index.js');
    const grid = new SpatialGrid(DE_CITADEL_BLOCKS, 10);

    // 1. Main Deck (CT Spawn, y = 2.1m): smoke bounces on top of deck slab and never sinks to y = 0.08
    const mainDeckSmoke = simulateGrenadeTrajectory(
      { x: SPAWN_POINTS.VANGUARD_CT.x, y: SPAWN_POINTS.VANGUARD_CT.y + 1.5, z: SPAWN_POINTS.VANGUARD_CT.z + 2.0 },
      { x: 0, y: 1.0, z: 3.5 },
      1.6,
      DE_CITADEL_BLOCKS,
      false,
      1 / 64,
      grid
    );
    expect(mainDeckSmoke.bounces).toBeGreaterThanOrEqual(1);
    expect(mainDeckSmoke.finalPos.y).toBeGreaterThanOrEqual(2.1);

    // 2. Main Deck Molotov: detonates right on y = 2.1m deck surface (hitGround = true)
    const mainDeckMolo = simulateGrenadeTrajectory(
      { x: -25, y: 2.1 + 1.5, z: -20 },
      { x: 0, y: -1.0, z: 2.0 },
      5.0,
      DE_CITADEL_BLOCKS,
      true,
      1 / 64,
      grid
    );
    expect(mainDeckMolo.finalPos.y).toBeGreaterThanOrEqual(2.1);
    expect(mainDeckMolo.finalPos.y).toBeLessThan(2.5);

    // 3. Upper Overlook (A Heaven, y = 4.9m, around x=-21, z=-28): Molotov detonates on y = 4.9m slab
    const heavenMolo = simulateGrenadeTrajectory(
      { x: -21, y: 4.9 + 1.2, z: -28 },
      { x: 0, y: -1.5, z: 0 },
      5.0,
      DE_CITADEL_BLOCKS,
      true,
      1 / 64,
      grid
    );
    expect(heavenMolo.finalPos.y).toBeGreaterThanOrEqual(4.9);
    expect(heavenMolo.finalPos.y).toBeLessThan(5.3);
  });

  it('keeps B Market wood door wallbangable (WOOD_THIN) while preserving >= 1.8m walkable doorway clearance', async () => {
    const { DE_CITADEL_BLOCKS } = await import('../index.js');
    const door = DE_CITADEL_BLOCKS.find((b) => b.id === 'b_market_wood_door');
    const northWall = DE_CITADEL_BLOCKS.find((b) => b.id === 'ct_east_bldg');
    const southBooth = DE_CITADEL_BLOCKS.find((b) => b.id === 'b_control_booth');

    expect(door).toBeDefined();
    expect(door!.material).toBe('WOOD_THIN');
    expect(northWall).toBeDefined();
    expect(southBooth).toBeDefined();

    // Gap north of door leaf (between ct_east_bldg.maxZ and door.minZ) and south of door leaf must both be >= 1.8m
    const northGap = door!.minZ - northWall!.maxZ;
    const southGap = southBooth!.minZ - door!.maxZ;
    expect(northGap).toBeGreaterThanOrEqual(1.8);
    expect(southGap).toBeGreaterThanOrEqual(1.8);
  });
});


