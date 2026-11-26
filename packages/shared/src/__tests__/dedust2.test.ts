import { describe, it, expect } from 'vitest';
import {
  DE_DUST2_BLOCKS,
  DE_DUST2_COLLIDERS,
  DE_DUST2_BOUNDS,
  DE_DUST2_SPAWN_POINTS,
  DE_DUST2_BOMBSITES,
  DE_DUST2_NAV_GRAPH,
  DE_DUST2_BOTS,
  getDust2CalloutName,
  findPathAStar,
  KinematicPlayerController,
  SpatialGrid,
  KINEMATICS,
  hasHeadClearance,
  stepGrenadePhysics,
  simulateGrenadeTrajectory,
  PlayerInput,
} from '../index.js';

function createIdleInput(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    crouch: false,
    walk: false,
    yaw: 0,
    pitch: 0,
    ...overrides,
  };
}

describe('DE_DUST2 Real GLB Watertight Colliders & Tactical Navigation', () => {
  it('exports valid watertight SAT colliders with CONCRETE, WOOD_THIN, and METAL_SHEET materials', () => {
    expect(DE_DUST2_BLOCKS.length).toBeGreaterThan(500);
    const mats = new Set(DE_DUST2_BLOCKS.map((b) => b.material));
    expect(mats.has('CONCRETE')).toBe(true);
    expect(mats.has('WOOD_THIN')).toBe(true);
    expect(mats.has('METAL_SHEET')).toBe(true);

    for (const b of DE_DUST2_BLOCKS) {
      expect(b.maxX).toBeGreaterThan(b.minX);
      expect(b.maxY).toBeGreaterThan(b.minY);
      expect(b.maxZ).toBeGreaterThan(b.minZ);
    }
  });

  it('grounds CT/T player spawns and all 9 tactical bots on solid floors with full standing headroom', () => {
    const checkGrounded = (label: string, pos: { x: number; y: number; z: number }) => {
      const hasFloor = DE_DUST2_COLLIDERS.some(
        (b) =>
          pos.x >= b.minX - 0.3 &&
          pos.x <= b.maxX + 0.3 &&
          pos.z >= b.minZ - 0.3 &&
          pos.z <= b.maxZ + 0.3 &&
          b.maxY <= pos.y + 0.12 &&
          b.maxY >= pos.y - 0.35
      );
      expect(hasFloor, `${label} missing solid floor support`).toBe(true);

      const clear = hasHeadClearance(
        pos.x,
        pos.y + 0.05,
        pos.z,
        KINEMATICS.CAPSULE_HEIGHT_STAND - 0.05,
        DE_DUST2_COLLIDERS
      );
      expect(clear, `${label} blocked inside collider`).toBe(true);
    };

    checkGrounded('VANGUARD_CT', DE_DUST2_SPAWN_POINTS.VANGUARD_CT);
    checkGrounded('OBSIDIAN_T', DE_DUST2_SPAWN_POINTS.OBSIDIAN_T);
    for (const bot of DE_DUST2_BOTS) {
      checkGrounded(bot.id, bot.waypoints[0]);
    }
  });

  it('forms a single connected bidirectional NavGraph with valid A* routes across Long, Ramp, and Short', () => {
    const keys = Object.keys(DE_DUST2_NAV_GRAPH);
    expect(keys.length).toBeGreaterThanOrEqual(25);

    const visited = new Set<string>();
    const queue = [keys[0]];
    visited.add(keys[0]);

    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = DE_DUST2_NAV_GRAPH[id];
      for (const nId of node.neighbors) {
        expect(DE_DUST2_NAV_GRAPH[nId], `Missing neighbor ${nId}`).toBeDefined();
        expect(DE_DUST2_NAV_GRAPH[nId].neighbors).toContain(id);
        if (!visited.has(nId)) {
          visited.add(nId);
          queue.push(nId);
        }
      }
    }
    expect(visited.size).toBe(keys.length);

    const ctToT = findPathAStar(
      DE_DUST2_SPAWN_POINTS.VANGUARD_CT,
      DE_DUST2_SPAWN_POINTS.OBSIDIAN_T,
      undefined,
      DE_DUST2_BLOCKS,
      DE_DUST2_NAV_GRAPH
    );
    expect(ctToT.length).toBeGreaterThan(4);

    const siteToShort = findPathAStar(
      DE_DUST2_BOMBSITES.A.center,
      DE_DUST2_NAV_GRAPH['short_t'].pos,
      undefined,
      DE_DUST2_BLOCKS,
      DE_DUST2_NAV_GRAPH
    );
    expect(siteToShort.length).toBeGreaterThan(3);
  });

  it('allows smooth 128Hz kinematic traversal up A Ramp, down A Long, and up Short Stairs', () => {
    const grid = new SpatialGrid(DE_DUST2_BLOCKS, 6);
    const dt = 1 / 128;

    // 1. Walk North up A Ramp from (13, 0, 27) -> A Site (y = 3.5)
    const rampRunner = new KinematicPlayerController(13, 0, 27);
    for (let i = 0; i < 420; i++) {
      rampRunner.update(createIdleInput({ forward: true, yaw: 0 }), dt, 5.45, DE_DUST2_COLLIDERS, DE_DUST2_BOUNDS, grid);
    }
    expect(rampRunner.state.z).toBeLessThan(15);
    expect(rampRunner.state.y).toBeGreaterThanOrEqual(3.25);

    // 2. Walk East down A Long from T Spawn (-61, 3.5, -10) -> Long Doors without clipping bounds
    const longRunner = new KinematicPlayerController(-61, 3.5, -10);
    for (let i = 0; i < 320; i++) {
      longRunner.update(
        createIdleInput({ forward: true, yaw: -Math.PI * 0.5 }),
        dt,
        5.45,
        DE_DUST2_COLLIDERS,
        DE_DUST2_BOUNDS,
        grid
      );
    }
    expect(longRunner.state.x).toBeGreaterThan(-52);
    expect(longRunner.state.y).toBeCloseTo(3.5, 1);

    // 3. Walk West up Short Stairs from (-3, 3.5, 8.5) -> Short Catwalk (y = 6.0)
    const stairsRunner = new KinematicPlayerController(-3, 3.5, 8.5);
    for (let i = 0; i < 320; i++) {
      stairsRunner.update(
        createIdleInput({ forward: true, yaw: Math.PI * 0.5 }),
        dt,
        5.45,
        DE_DUST2_COLLIDERS,
        DE_DUST2_BOUNDS,
        grid
      );
    }
    expect(stairsRunner.state.x).toBeLessThan(-9);
    expect(stairsRunner.state.y).toBeGreaterThanOrEqual(5.75);

    // 4. Callouts resolve accurately
    expect(getDust2CalloutName(6, 0, 36)).toBe('CT SPAWN');
    expect(getDust2CalloutName(1, 3.5, -1)).toBe('A SITE');
    expect(getDust2CalloutName(-40, 3.5, -9)).toBe('A LONG');
    expect(getDust2CalloutName(-24, 6.0, 8.5)).toBe('A SHORT');
  });

  it('maintains continuous grounded contact while descending voxel ramps on DE_DUST2 with bidirectional stepOffsetY damping', () => {
    const grid = new SpatialGrid(DE_DUST2_BLOCKS, 6);
    const dt = 1 / 128;

    // Descend A Ramp from top (13, 3.5, 13) South toward CT Spawn (13, 0, 27)
    const descender = new KinematicPlayerController(13, 3.5, 13);
    let airborneTicks = 0;
    let sawPositiveStepDownOffset = false;

    for (let i = 0; i < 360; i++) {
      descender.update(
        createIdleInput({ forward: true, yaw: Math.PI }),
        dt,
        5.45,
        DE_DUST2_COLLIDERS,
        DE_DUST2_BOUNDS,
        grid
      );
      if (i > 4 && !descender.state.isGrounded) {
        airborneTicks++;
      }
      if (descender.stepOffsetY > 0.02) {
        sawPositiveStepDownOffset = true;
      }
    }

    expect(descender.state.z).toBeGreaterThan(22);
    expect(descender.state.y).toBeLessThan(1.0);
    expect(airborneTicks).toBe(0);
    expect(sawPositiveStepDownOffset).toBe(true);
  });

  it('supports grenade throws into Dust 2 Pit/A Long beyond x=-46.8 and deflects smoothly up low voxel ramp steps', () => {
    const grid = new SpatialGrid(DE_DUST2_BLOCKS, 6);

    // Throw West from A Long (-45, 5.2, -10) toward Pit / T Spawn (-58, ...)
    const traj = simulateGrenadeTrajectory(
      { x: -45, y: 5.2, z: -10 },
      { x: -12, y: 2.0, z: 0 },
      1.2,
      DE_DUST2_BLOCKS,
      false,
      1 / 64,
      grid,
      DE_DUST2_BOUNDS
    );
    expect(traj.finalPos.x).toBeLessThan(-50);

    // Low 0.25m voxel ramp step should deflect grenade upward/forward rather than rebounding backwards
    const rampStep = {
      minX: 1.0,
      maxX: 2.0,
      minY: 0.0,
      maxY: 0.25,
      minZ: -2.0,
      maxZ: 2.0,
      material: 'CONCRETE' as const,
    };
    const pos = { x: 0.94, y: 0.14, z: 0 };
    const vel = { x: 8.0, y: -0.5, z: 0 };
    const res = stepGrenadePhysics(pos, vel, 1 / 64, [rampStep], 0.08, 0.45, 15.5, undefined, DE_DUST2_BOUNDS);
    expect(res.bounced).toBe(true);
    expect(vel.x).toBeGreaterThan(0); // Continues up the ramp instead of bouncing backward
    expect(vel.y).toBeGreaterThan(0); // Deflected cleanly upward along the ramp slope
  });
});
