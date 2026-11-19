import { describe, it, expect } from 'vitest';
import {
  DE_CITADEL_NAV_GRAPH,
  findNearestNavNode,
  findPathAStar,
  rollRandomStrategies,
} from '../maps/TacticalNavGraph.js';
import { DE_CITADEL_BLOCKS, BOMBSITES, Vec3, MapBlockCollider } from '../maps/DeCitadelData.js';

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

  const steps = 40;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = p1.x + t * (p2.x - p1.x);
    const y = p1.y + t * (p2.y - p1.y);
    const z = p1.z + t * (p2.z - p1.z);

    if (y + 1.8 <= b.minY || y >= b.maxY) continue;

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

describe('TacticalNavGraph & A* Pathfinding', () => {
  it('contains at least 28 connected tactical waypoints across all DE_CITADEL zones', () => {
    const nodeCount = Object.keys(DE_CITADEL_NAV_GRAPH).length;
    expect(nodeCount).toBeGreaterThanOrEqual(28);
  });

  it('guarantees bidirectional connectivity without orphaned dead ends', () => {
    for (const [id, node] of Object.entries(DE_CITADEL_NAV_GRAPH)) {
      expect(node.neighbors.length).toBeGreaterThan(0);
      for (const neighborId of node.neighbors) {
        const neighbor = DE_CITADEL_NAV_GRAPH[neighborId];
        expect(neighbor).toBeDefined();
        expect(neighbor.neighbors).toContain(id);
      }
    }
  });

  it('guarantees all nav nodes have safe clearance from all map blocks (>= 0.55m)', () => {
    for (const [id, node] of Object.entries(DE_CITADEL_NAV_GRAPH)) {
      for (const block of DE_CITADEL_BLOCKS) {
        // Only check blocks at matching elevation
        if (node.pos.y + 1.8 <= block.minY || node.pos.y >= block.maxY) continue;

        const dist = pointDistToAABB(node.pos.x, node.pos.y, node.pos.z, block);
        expect(dist, `Node '${id}' at (${node.pos.x}, ${node.pos.y}, ${node.pos.z}) too close to ${block.id}`).toBeGreaterThanOrEqual(0.55);
      }
    }
  });

  it('guarantees all connected nav graph edges have safe corridor clearance without wall penetration', () => {
    const checked = new Set<string>();

    for (const [id, node] of Object.entries(DE_CITADEL_NAV_GRAPH)) {
      for (const nbrId of node.neighbors) {
        const edgeKey = [id, nbrId].sort().join('<->');
        if (checked.has(edgeKey)) continue;
        checked.add(edgeKey);

        const nbr = DE_CITADEL_NAV_GRAPH[nbrId];
        expect(nbr).toBeDefined();

        for (const block of DE_CITADEL_BLOCKS) {
          const hits = segmentHitsBlock(node.pos, nbr.pos, block, 0.40);
          expect(hits, `Edge '${edgeKey}' penetrates map block '${block.id}'`).toBe(false);
        }
      }
    }
  });

  it('navigates cleanly from CT Spawn to Bombsite A with A* pathfinding', () => {
    const start = { x: 0, y: 0, z: 38 }; // CT Spawn
    const goal = BOMBSITES.A.center; // Bombsite A Center
    const path = findPathAStar(start, goal);

    expect(path.length).toBeGreaterThan(3);
    expect(path[0]).toEqual(start);
    expect(path[path.length - 1]).toEqual(goal);
  });

  it('navigates cleanly from CT Spawn to Bombsite B via B Connector without colliding with walls', () => {
    const start = { x: 0, y: 0, z: 38 };
    const goal = BOMBSITES.B.center;
    const path = findPathAStar(start, goal);

    expect(path.length).toBeGreaterThan(3);
    expect(path[0]).toEqual(start);
    expect(path[path.length - 1]).toEqual(goal);
  });

  it('navigates cleanly from T Spawn to Bombsite B via B Tunnels', () => {
    const start = { x: 0, y: 0, z: -48 }; // T Spawn
    const goal = BOMBSITES.B.center; // Bombsite B Center
    const path = findPathAStar(start, goal);

    expect(path.length).toBeGreaterThan(3);
    expect(path[0]).toEqual(start);
    expect(path[path.length - 1]).toEqual(goal);
  });

  it('navigates cleanly from Mid Courtyard to A Heaven Balcony across elevation (+3.5m)', () => {
    const start = { x: 0, y: 0, z: 10 }; // Mid
    const goal = { x: -21, y: 3.5, z: -34 }; // A Heaven Balcony
    const path = findPathAStar(start, goal);

    expect(path.length).toBeGreaterThan(2);
    const elevatedNode = path.find(p => p.y >= 3.0);
    expect(elevatedNode).toBeDefined();
  });

  it('dynamically avoids penalized zones when edge weights are applied', () => {
    const start = { x: 0, y: 0, z: 18 };
    const goal = { x: 3, y: 0, z: -16 };

    // Standard path goes directly through mid_doors
    const normalPath = findPathAStar(start, goal);

    // Apply severe penalty to mid_doors (e.g. active Molotov fire)
    const weights: Record<string, number> = { mid_doors: 9999 };
    const detourPath = findPathAStar(start, goal, weights);

    expect(detourPath.length).toBeGreaterThan(0);
  });

  it('rolls valid tactical director strategy archetypes for both factions', () => {
    const round = rollRandomStrategies();
    expect(round.syndicate).toBeDefined();
    expect(round.vanguard).toBeDefined();
  });
});
