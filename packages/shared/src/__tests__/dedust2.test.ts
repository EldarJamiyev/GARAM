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

  it('allows smooth 128Hz traversal through Lower Tunnel, Upper Tunnel, and B Doors while keeping all tunnel walls solid', () => {
    const grid = new SpatialGrid(DE_DUST2_BLOCKS, 6);
    const dt = 1 / 128;

    const walkPath = (pts: Array<{ x: number; y: number; z: number }>, ticks = 1800) => {
      const c = new KinematicPlayerController(pts[0].x, pts[0].y, pts[0].z);
      let pi = 1;
      let minY = pts[0].y;
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
        if (c.state.y < minY) minY = c.state.y;
      }
      return { c, minY, reachedEnd: pi >= pts.length };
    };

    const ramWall = (
      start: { x: number; y: number; z: number },
      yaw: number,
      crouch: boolean,
      jump: boolean,
      ticks = 320
    ) => {
      const c = new KinematicPlayerController(start.x, start.y, start.z);
      let minY = start.y;
      for (let i = 0; i < ticks; i++) {
        c.update(
          createIdleInput({ forward: true, yaw, crouch, jump: jump && i % 45 === 5 }),
          dt,
          5.45,
          DE_DUST2_COLLIDERS,
          DE_DUST2_BOUNDS,
          grid
        );
        if (c.state.y < minY) minY = c.state.y;
      }
      return { x: c.state.x, y: c.state.y, z: c.state.z, minY };
    };

    // 1. T-Outside -> Upper Tunnel -> B Site
    const upperToB = walkPath(
      [
        { x: -42.5, y: 4.875, z: -6.0 },
        { x: -42.5, y: 4.875, z: -15.5 },
        { x: -42.5, y: 5.75, z: -28.0 },
        { x: -50.5, y: 5.75, z: -32.0 },
        { x: -50.5, y: 5.75, z: -43.0 },
        { x: -50.5, y: 4.875, z: -49.0 },
        { x: -45.5, y: 4.875, z: -52.0 },
      ],
      2200
    );
    expect(upperToB.reachedEnd).toBe(true);
    expect(upperToB.c.state.z).toBeLessThan(-50.5);
    expect(upperToB.minY).toBeGreaterThanOrEqual(4.8);

    // 2. Mid -> Lower Tunnel -> Upper Tunnel
    const lowerToUpper = walkPath(
      [
        { x: -12.0, y: 1.625, z: -36.5 },
        { x: -16.5, y: 2.125, z: -36.5 },
        { x: -25.0, y: 2.125, z: -36.5 },
        { x: -27.5, y: 2.125, z: -35.0 },
        { x: -27.5, y: 3.5, z: -27.5 },
        { x: -35.0, y: 5.75, z: -28.0 },
        { x: -44.0, y: 5.75, z: -30.5 },
      ],
      2000
    );
    expect(lowerToUpper.reachedEnd).toBe(true);
    expect(lowerToUpper.c.state.x).toBeLessThan(-42.0);
    expect(lowerToUpper.c.state.y).toBeGreaterThanOrEqual(5.6);

    // 3. Mid-to-B -> B Doors -> B Site
    const bDoors = walkPath(
      [
        { x: -31.5, y: 4.875, z: -57.5 },
        { x: -32.5, y: 4.875, z: -56.0 },
        { x: -33.5, y: 4.875, z: -55.4 },
        { x: -35.5, y: 4.875, z: -55.0 },
        { x: -39.0, y: 4.875, z: -55.0 },
      ],
      1000
    );
    expect(bDoors.reachedEnd).toBe(true);
    expect(bDoors.c.state.x).toBeLessThan(-37.5);

    // 4. Lower & Upper Tunnel walls strictly block standing and crouch-jump breaches
    const lowerNorth = ramWall({ x: -21.0, y: 2.125, z: -36.5 }, 0, true, true);
    expect(lowerNorth.z).toBeGreaterThan(-39.1);
    expect(lowerNorth.minY).toBeGreaterThanOrEqual(2.1);

    const lowerNW = ramWall({ x: -27.0, y: 2.125, z: -36.5 }, Math.PI * 0.25, true, true);
    expect(lowerNW.z).toBeGreaterThan(-39.1);
    expect(lowerNW.minY).toBeGreaterThanOrEqual(2.1);

    const upperWest = ramWall({ x: -44.0, y: 5.75, z: -30.5 }, Math.PI * 0.5, true, true);
    expect(upperWest.x).toBeGreaterThan(-47.0);
    expect(upperWest.minY).toBeGreaterThanOrEqual(5.7);

    const upperSouth = ramWall({ x: -35.0, y: 5.75, z: -28.0 }, Math.PI, true, true);
    expect(upperSouth.z).toBeLessThan(-25.8);
    expect(upperSouth.minY).toBeGreaterThanOrEqual(5.7);

    const upperBExitWest = ramWall({ x: -50.5, y: 5.75, z: -40.0 }, Math.PI * 0.5, true, true);
    expect(upperBExitWest.x).toBeGreaterThan(-52.2);
    expect(upperBExitWest.minY).toBeGreaterThanOrEqual(5.7);

    const upperBExitEast = ramWall({ x: -50.5, y: 5.75, z: -40.0 }, -Math.PI * 0.5, true, true);
    expect(upperBExitEast.x).toBeLessThan(-48.8);
    expect(upperBExitEast.minY).toBeGreaterThanOrEqual(5.7);
  });

  it('guarantees zero void-fall leaks or skybox rooftop climbs across all Walk, Crouch, and Jump-Tuck reachable space', () => {
    const grid = new SpatialGrid(DE_DUST2_BLOCKS, 6);
    const STEP = 0.5;
    const R = KINEMATICS.CAPSULE_RADIUS;

    const findFloor = (x: number, y: number, z: number, maxUp: number) => {
      let best = -99;
      grid.queryAABB(x - R, x + R, z - R, z + R, (bi) => {
        const b = DE_DUST2_BLOCKS[bi];
        const cx = Math.max(b.minX, Math.min(x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
        if ((x - cx) * (x - cx) + (z - cz) * (z - cz) > R * R) return;
        if (b.maxY <= y + maxUp + 0.01 && b.maxY > best) best = b.maxY;
      });
      return best;
    };

    const hasClear = (x: number, y: number, z: number, h: number) => {
      let blocked = false;
      const rInner = R - 0.02;
      grid.queryAABB(x - rInner, x + rInner, z - rInner, z + rInner, (bi) => {
        const b = DE_DUST2_BLOCKS[bi];
        const cx = Math.max(b.minX, Math.min(x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
        if ((x - cx) * (x - cx) + (z - cz) * (z - cz) >= rInner * rInner) return;
        if (b.maxY > y + 0.05 && b.minY < y + h - 0.02) blocked = true;
      });
      return !blocked;
    };

    const runContainmentBfs = (maxUp: number, bodyH: number) => {
      const seeds = [DE_DUST2_SPAWN_POINTS.VANGUARD_CT, DE_DUST2_SPAWN_POINTS.OBSIDIAN_T];
      const visited = new Set<string>();
      const queue: Array<[number, number, number]> = [];
      for (const s of seeds) {
        const f = findFloor(s.x, s.y, s.z, maxUp);
        if (f > -50 && hasClear(s.x, f, s.z, bodyH)) {
          visited.add(`${Math.round(s.x / STEP)},${Math.round(f * 8)},${Math.round(s.z / STEP)}`);
          queue.push([s.x, f, s.z]);
        }
      }
      const dirs: ReadonlyArray<[number, number]> = [
        [STEP, 0],
        [-STEP, 0],
        [0, STEP],
        [0, -STEP],
      ];
      let voidFalls = 0;
      let highClimbs = 0;
      let head = 0;
      while (head < queue.length) {
        const [cx, cy, cz] = queue[head++];
        for (const [dx, dz] of dirs) {
          const nx = cx + dx;
          const nz = cz + dz;
          const nf = findFloor(nx, cy, nz, maxUp);
          if (nf < -0.5) {
            voidFalls++;
            continue;
          }
          if (nf - cy > maxUp) continue;
          if (!hasClear(nx, nf, nz, bodyH)) continue;
          const key = `${Math.round(nx / STEP)},${Math.round(nf * 8)},${Math.round(nz / STEP)}`;
          if (!visited.has(key)) {
            visited.add(key);
            queue.push([nx, nf, nz]);
            if (nf > 9.1 && cy <= 9.1) highClimbs++;
          }
        }
      }
      return { visited: visited.size, voidFalls, highClimbs };
    };

    const walk = runContainmentBfs(KINEMATICS.STEP_HEIGHT, KINEMATICS.CAPSULE_HEIGHT_STAND);
    expect(walk.visited).toBeGreaterThan(15000);
    expect(walk.voidFalls).toBe(0);
    expect(walk.highClimbs).toBe(0);

    const crouch = runContainmentBfs(KINEMATICS.STEP_HEIGHT, KINEMATICS.CAPSULE_HEIGHT_CROUCH);
    expect(crouch.visited).toBeGreaterThan(15000);
    expect(crouch.voidFalls).toBe(0);
    expect(crouch.highClimbs).toBe(0);

    const jumpTuck = runContainmentBfs(1.45, KINEMATICS.CAPSULE_HEIGHT_CROUCH);
    expect(jumpTuck.visited).toBeGreaterThan(15000);
    expect(jumpTuck.voidFalls).toBe(0);
    expect(jumpTuck.highClimbs).toBe(0);
  });
});

