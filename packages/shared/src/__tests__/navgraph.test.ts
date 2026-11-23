import { describe, it, expect } from 'vitest';
import {
  CS_OFFICE_NAV_GRAPH,
  findNearestNavNode,
  findPathAStar,
  rollRandomStrategies,
} from '../maps/TacticalNavGraph.js';
import {
  CS_OFFICE_BLOCKS,
  CS_OFFICE_FLOOR_Y,
  CS_OFFICE_UPPER_Y,
  BOMBSITES,
  SPAWN_POINTS,
  Vec3,
  MapBlockCollider,
} from '../maps/CsOfficeData.js';
import { KINEMATICS } from '../constants/kinematics.js';
import { hasLineOfSight } from '../physics/RaycastEngine.js';

function pointDistToAABB(px: number, py: number, pz: number, b: MapBlockCollider): number {
  const dx = Math.max(b.minX - px, 0, px - b.maxX);
  const dy = Math.max(b.minY - py, 0, py - b.maxY);
  const dz = Math.max(b.minZ - pz, 0, pz - b.maxZ);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function segmentHitsBlock(
  p1: Vec3,
  p2: Vec3,
  b: MapBlockCollider,
  radius = 0.40
): boolean {
  if (p1.y + 1.8 <= b.minY || p1.y >= b.maxY) {
    if (p2.y + 1.8 <= b.minY || p2.y >= b.maxY) {
      return false;
    }
  }

  const isElevationTransition = Math.abs(p1.y - p2.y) > 0.5;
  const steps = 60;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = p1.x + t * (p2.x - p1.x);
    const y = p1.y + t * (p2.y - p1.y);
    const z = p1.z + t * (p2.z - p1.z);

    if (y + 1.8 <= b.minY || y >= b.maxY) continue;
    if (b.id.includes('_stairs_')) continue;
    if (isElevationTransition && (b.id.endsWith('_deck') || b.id.startsWith('deck_'))) continue;
    if (b.maxY - y <= 0.45) continue;

    const minX = b.minX - radius;
    const maxX = b.maxX + radius;
    const minZ = b.minZ - radius;
    const maxZ = b.maxZ + radius;

    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
      return true;
    }
  }
  return false;
}

function pathLengthMeters(path: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    const dz = path[i].z - path[i - 1].z;
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total;
}

describe('CS_OFFICE TacticalNavGraph, 3-Tier Geometry & Competitive Telemetry', () => {
  it('contains 50-64 connected tactical waypoints across all 3 elevation tiers with watchAngles & retreatNodeIds', () => {
    const nodes = Object.values(CS_OFFICE_NAV_GRAPH);
    expect(nodes.length).toBeGreaterThanOrEqual(50);
    expect(nodes.length).toBeLessThanOrEqual(64);
    expect(nodes.some((n) => n.pos.y === 0)).toBe(true);
    expect(nodes.some((n) => Math.abs(n.pos.y - CS_OFFICE_FLOOR_Y) < 0.05)).toBe(true);
    expect(nodes.some((n) => Math.abs(n.pos.y - CS_OFFICE_UPPER_Y) < 0.05)).toBe(true);
    expect(nodes.every((n) => Array.isArray(n.watchAngles) && n.watchAngles.length >= 1)).toBe(true);
    expect(nodes.every((n) => Array.isArray(n.retreatNodeIds) && n.retreatNodeIds.length >= 1)).toBe(true);
  });

  it('guarantees bidirectional connectivity, single connected component, and zero dead-end nodes', () => {
    const ids = Object.keys(CS_OFFICE_NAV_GRAPH);
    for (const [id, node] of Object.entries(CS_OFFICE_NAV_GRAPH)) {
      expect(node.neighbors.length, `Node '${id}' is a dead-end`).toBeGreaterThanOrEqual(2);
      for (const neighborId of node.neighbors) {
        const neighbor = CS_OFFICE_NAV_GRAPH[neighborId];
        expect(neighbor, `Missing neighbor '${neighborId}' from '${id}'`).toBeDefined();
        expect(neighbor.neighbors, `Edge ${id} -> ${neighborId} is not symmetric`).toContain(id);
      }
    }

    const visited = new Set<string>(['ct_spawn_mid']);
    const queue = ['ct_spawn_mid'];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const nbr of CS_OFFICE_NAV_GRAPH[curr].neighbors) {
        if (!visited.has(nbr)) {
          visited.add(nbr);
          queue.push(nbr);
        }
      }
    }
    expect(visited.size).toBe(ids.length);
  });

  it('guarantees all nav nodes have safe clearance from all map blocks (>= 0.55m)', () => {
    for (const [id, node] of Object.entries(CS_OFFICE_NAV_GRAPH)) {
      for (const block of CS_OFFICE_BLOCKS) {
        if (node.pos.y + 1.8 <= block.minY || node.pos.y >= block.maxY) continue;
        const dist = pointDistToAABB(node.pos.x, node.pos.y, node.pos.z, block);
        expect(
          dist,
          `Node '${id}' at (${node.pos.x}, ${node.pos.y}, ${node.pos.z}) too close to ${block.id}`
        ).toBeGreaterThanOrEqual(0.55);
      }
    }
  });

  it('guarantees all connected nav graph edges have safe corridor clearance without wall penetration', () => {
    const checked = new Set<string>();

    for (const [id, node] of Object.entries(CS_OFFICE_NAV_GRAPH)) {
      for (const nbrId of node.neighbors) {
        const edgeKey = [id, nbrId].sort().join('<->');
        if (checked.has(edgeKey)) continue;
        checked.add(edgeKey);

        const nbr = CS_OFFICE_NAV_GRAPH[nbrId];
        expect(nbr).toBeDefined();

        for (const block of CS_OFFICE_BLOCKS) {
          const hits = segmentHitsBlock(node.pos, nbr.pos, block, 0.40);
          expect(hits, `Edge '${edgeKey}' penetrates map block '${block.id}'`).toBe(false);
        }
      }
    }
  });

  it('enforces balanced CS_OFFICE CT setup timing leads on Sites A (Projector) & B (Paper)', () => {
    const ctToA = pathLengthMeters(findPathAStar(SPAWN_POINTS.VANGUARD_CT, BOMBSITES.A.center)) / KINEMATICS.SPEED_KNIFE;
    const tToA = pathLengthMeters(findPathAStar(SPAWN_POINTS.OBSIDIAN_T, BOMBSITES.A.center)) / KINEMATICS.SPEED_KNIFE;
    const ctLeadA = tToA - ctToA;

    const ctToB = pathLengthMeters(findPathAStar(SPAWN_POINTS.VANGUARD_CT, BOMBSITES.B.center)) / KINEMATICS.SPEED_KNIFE;
    const tToB = pathLengthMeters(findPathAStar(SPAWN_POINTS.OBSIDIAN_T, BOMBSITES.B.center)) / KINEMATICS.SPEED_KNIFE;
    const ctLeadB = tToB - ctToB;

    expect(ctLeadA).toBeGreaterThanOrEqual(1.2);
    expect(ctLeadA).toBeLessThanOrEqual(7.5);
    expect(ctLeadB).toBeGreaterThanOrEqual(1.2);
    expect(ctLeadB).toBeLessThanOrEqual(7.5);

    const ctToMain =
      pathLengthMeters(findPathAStar(SPAWN_POINTS.VANGUARD_CT, CS_OFFICE_NAV_GRAPH['main_hall_north'].pos)) /
      KINEMATICS.SPEED_KNIFE;
    const tToMain =
      pathLengthMeters(findPathAStar(SPAWN_POINTS.OBSIDIAN_T, CS_OFFICE_NAV_GRAPH['main_hall_south'].pos)) /
      KINEMATICS.SPEED_KNIFE;
    expect(Math.abs(ctToMain - tToMain)).toBeLessThanOrEqual(3.0);
  });

  it('activates all 4 ballistic penetration materials (CONCRETE, WOOD_THIN, DRYWALL, METAL_SHEET)', () => {
    const materials = new Set(CS_OFFICE_BLOCKS.map((b) => b.material));
    expect(materials.has('CONCRETE')).toBe(true);
    expect(materials.has('WOOD_THIN')).toBe(true);
    expect(materials.has('DRYWALL')).toBe(true);
    expect(materials.has('METAL_SHEET')).toBe(true);
  });

  it('navigates cleanly across all 3 elevation tiers (Courtyard 0m -> Office 1.4m -> Sniper Mezzanine 3.5m)', () => {
    const courtyardToMezz = findPathAStar(
      CS_OFFICE_NAV_GRAPH['ct_spawn_mid'].pos,
      CS_OFFICE_NAV_GRAPH['sniper_mezz_center'].pos
    );
    expect(courtyardToMezz.some((p) => p.y === 0)).toBe(true);
    expect(courtyardToMezz.some((p) => Math.abs(p.y - CS_OFFICE_FLOOR_Y) < 0.05)).toBe(true);
    expect(courtyardToMezz.some((p) => Math.abs(p.y - CS_OFFICE_UPPER_Y) < 0.05)).toBe(true);
  });

  it('dynamically avoids penalized zones when edge weights are applied', () => {
    const start = SPAWN_POINTS.OBSIDIAN_T;
    const goal = BOMBSITES.B.center;
    const weights: Record<string, number> = { paper_south_door: 9999 };
    const detourPath = findPathAStar(start, goal, weights);
    expect(detourPath.length).toBeGreaterThan(2);
    expect(detourPath.some((p) => Math.abs(p.x + 14.5) < 0.5 && Math.abs(p.z - 16.5) < 0.5)).toBe(false);
  });

  it('rolls valid tactical director strategy archetypes for both factions', () => {
    const round = rollRandomStrategies();
    expect(round.syndicate).toBeDefined();
    expect(round.vanguard).toBeDefined();
  });

  it('resolves nearest nav node with direct line-of-sight across interior office drywall partitions', () => {
    const posMain = { x: 2.0, y: CS_OFFICE_FLOOR_Y, z: 3.0 };
    const nearestWithLOS = findNearestNavNode(posMain, undefined, CS_OFFICE_BLOCKS);
    const eyeA = { x: posMain.x, y: posMain.y + 1.2, z: posMain.z };
    const eyeB = { x: nearestWithLOS.pos.x, y: nearestWithLOS.pos.y + 1.2, z: nearestWithLOS.pos.z };
    expect(hasLineOfSight(eyeA, eyeB, CS_OFFICE_BLOCKS, [])).toBe(true);
  });

  it('guarantees zero 3D AABB overlap between any stairs and adjacent architectural blocks', () => {
    const stairs = CS_OFFICE_BLOCKS.filter((b) => b.id.includes('_stairs_'));
    const nonStairs = CS_OFFICE_BLOCKS.filter((b) => !b.id.includes('_stairs_'));
    expect(stairs.length).toBeGreaterThanOrEqual(20);

    const overlaps3D = (a: MapBlockCollider, b: MapBlockCollider): boolean => {
      const eps = 1e-4;
      return (
        a.minX < b.maxX - eps &&
        a.maxX > b.minX + eps &&
        a.minY < b.maxY - eps &&
        a.maxY > b.minY + eps &&
        a.minZ < b.maxZ - eps &&
        a.maxZ > b.minZ + eps
      );
    };

    for (const step of stairs) {
      for (const other of nonStairs) {
        expect(overlaps3D(step, other), `${step.id} overlaps ${other.id}`).toBe(false);
      }
    }
  });

  it('guarantees 100% of elevated NavNodes rest on solid walkable map block surfaces', () => {
    const elevatedNodes = Object.entries(CS_OFFICE_NAV_GRAPH).filter(([, n]) => n.pos.y > 0.1);
    expect(elevatedNodes.length).toBeGreaterThan(35);

    for (const [id, node] of elevatedNodes) {
      const supportingBlock = CS_OFFICE_BLOCKS.find(
        (b) =>
          node.pos.x >= b.minX &&
          node.pos.x <= b.maxX &&
          node.pos.z >= b.minZ &&
          node.pos.z <= b.maxZ &&
          Math.abs(b.maxY - node.pos.y) <= 0.15
      );
      expect(
        supportingBlock,
        `Elevated NavNode '${id}' at (${node.pos.x}, ${node.pos.y}, ${node.pos.z}) is floating in mid-air`
      ).toBeDefined();
    }
  });
});
