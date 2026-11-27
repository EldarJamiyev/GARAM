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

  it('allows smooth 128Hz kinematic traversal through Long Doors, Mid Double Doors, A Ramp, A Long, and Short Stairs', () => {
    const grid = new SpatialGrid(DE_DUST2_BLOCKS, 6);
    const dt = 1 / 128;

    const walkPath = (pts: Array<{ x: number; y: number; z: number }>, ticks = 800) => {
      const c = new KinematicPlayerController(pts[0].x, pts[0].y, pts[0].z);
      let pi = 1;
      for (let i = 0; i < ticks && pi < pts.length; i++) {
        const t = pts[pi];
        const rx = t.x - c.state.x;
        const rz = t.z - c.state.z;
        if (Math.hypot(rx, rz) < 0.6) {
          pi++;
          continue;
        }
        const yaw = Math.atan2(-rx, -rz);
        c.update(
          createIdleInput({ forward: true, yaw }),
          dt,
          5.45,
          DE_DUST2_COLLIDERS,
          DE_DUST2_BOUNDS,
          grid
        );
      }
      return c;
    };

    // 1. Walk standing cleanly through Long Double Doors
    const longDoors = walkPath([
      { x: 15.4, y: 4.875, z: -5.0 },
      { x: 15.6, y: 4.875, z: -6.5 },
      { x: 16.8, y: 4.875, z: -7.7 },
      { x: 17.2, y: 4.875, z: -10.5 },
    ]);
    expect(longDoors.state.z).toBeLessThan(-9.5);

    // 2. Walk standing cleanly through Mid Double Doors
    const midDoors = walkPath([
      { x: -9.6, y: 1.625, z: -39.2 },
      { x: -9.2, y: 1.625, z: -40.8 },
      { x: -10.8, y: 1.625, z: -42.2 },
      { x: -10.8, y: 1.625, z: -44.0 },
    ]);
    expect(midDoors.state.z).toBeLessThan(-43.0);

    // 3. Walk East up CT Ramp from ramp_bot -> ramp_top
    const rampRunner = walkPath([DE_DUST2_NAV_GRAPH.ramp_bot.pos, DE_DUST2_NAV_GRAPH.ramp_top.pos], 700);
    expect(rampRunner.state.x).toBeGreaterThan(25.5);
    expect(rampRunner.state.y).toBeGreaterThanOrEqual(4.75);

    // 4. Walk North down A Long from barrels -> long_corner
    const longRunner = walkPath([DE_DUST2_NAV_GRAPH.barrels.pos, DE_DUST2_NAV_GRAPH.long_corner.pos], 700);
    expect(longRunner.state.z).toBeLessThan(-46.5);
    expect(longRunner.state.y).toBeCloseTo(4.875, 1);

    // 5. Walk North up Short Stairs from stairs_bot -> stairs_top
    const stairsRunner = walkPath([DE_DUST2_NAV_GRAPH.stairs_bot.pos, DE_DUST2_NAV_GRAPH.stairs_top.pos], 700);
    expect(stairsRunner.state.z).toBeLessThan(-46.0);
    expect(stairsRunner.state.y).toBeGreaterThanOrEqual(7.15);

    // 6. Callouts resolve accurately
    expect(getDust2CalloutName(2.96, 1.625, -56.24)).toBe('CT SPAWN');
    expect(getDust2CalloutName(DE_DUST2_BOMBSITES.A.center.x, DE_DUST2_BOMBSITES.A.center.y, DE_DUST2_BOMBSITES.A.center.z)).toBe('A SITE');
    expect(getDust2CalloutName(DE_DUST2_NAV_GRAPH.long_4.pos.x, DE_DUST2_NAV_GRAPH.long_4.pos.y, DE_DUST2_NAV_GRAPH.long_4.pos.z)).toBe('A LONG');
    expect(getDust2CalloutName(DE_DUST2_NAV_GRAPH.short_plat.pos.x, DE_DUST2_NAV_GRAPH.short_plat.pos.y, DE_DUST2_NAV_GRAPH.short_plat.pos.z)).toBe('A SHORT');
  });

  it('maintains continuous grounded contact while descending voxel ramps on DE_DUST2 with bidirectional stepOffsetY damping', () => {
    const grid = new SpatialGrid(DE_DUST2_BLOCKS, 6);
    const dt = 1 / 128;

    // Descend CT Ramp West from ramp_top toward CT Spawn
    const start = DE_DUST2_NAV_GRAPH.ramp_top.pos;
    const descender = new KinematicPlayerController(start.x, start.y, start.z);
    let airborneTicks = 0;
    let sawPositiveStepDownOffset = false;

    for (let i = 0; i < 520; i++) {
      descender.update(
        createIdleInput({ forward: true, yaw: Math.PI * 0.5 }),
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

    expect(descender.state.x).toBeLessThan(14.5);
    expect(descender.state.y).toBeLessThan(2.5);
    expect(airborneTicks).toBe(0);
    expect(sawPositiveStepDownOffset).toBe(true);
  });

  it('supports grenade throws into Dust 2 Pit/A Long and deflects smoothly up low voxel ramp steps', () => {
    const grid = new SpatialGrid(DE_DUST2_BLOCKS, 6);

    // Throw South from A Long barrels toward Long Pit
    const start = DE_DUST2_NAV_GRAPH.barrels.pos;
    const traj = simulateGrenadeTrajectory(
      { x: start.x, y: start.y + 1.6, z: start.z },
      { x: 0, y: 2.0, z: 12.0 },
      1.2,
      DE_DUST2_BLOCKS,
      false,
      1 / 64,
      grid,
      DE_DUST2_BOUNDS
    );
    expect(traj.finalPos.z).toBeGreaterThan(start.z + 8);

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
