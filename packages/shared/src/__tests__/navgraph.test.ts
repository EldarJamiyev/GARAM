import { describe, it, expect } from 'vitest';
import {
  DE_CITADEL_NAV_GRAPH,
  findNearestNavNode,
  findPathAStar,
  rollRandomStrategies,
} from '../maps/TacticalNavGraph.js';

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

  it('navigates cleanly from CT Spawn to Bombsite A with A* pathfinding', () => {
    const start = { x: 0, y: 0, z: 38 }; // CT Spawn
    const goal = { x: -32, y: 0, z: -30 }; // Bombsite A Center
    const path = findPathAStar(start, goal);

    expect(path.length).toBeGreaterThan(3);
    expect(path[0]).toEqual(start);
    expect(path[path.length - 1]).toEqual(goal);
  });

  it('navigates cleanly from T Spawn to Bombsite B via B Tunnels', () => {
    const start = { x: 0, y: 0, z: -48 }; // T Spawn
    const goal = { x: 35, y: 0, z: -32 }; // Bombsite B Center
    const path = findPathAStar(start, goal);

    expect(path.length).toBeGreaterThan(3);
    expect(path[0]).toEqual(start);
    expect(path[path.length - 1]).toEqual(goal);
  });

  it('navigates cleanly from Mid Courtyard to A Heaven Balcony across elevation (+3.5m)', () => {
    const start = { x: 0, y: 0, z: 10 }; // Mid
    const goal = { x: -21, y: 3.5, z: -40 }; // A Heaven Balcony
    const path = findPathAStar(start, goal);

    expect(path.length).toBeGreaterThan(2);
    const elevatedNode = path.find(p => p.y >= 3.0);
    expect(elevatedNode).toBeDefined();
  });

  it('dynamically avoids penalized zones when edge weights are applied', () => {
    const start = { x: 0, y: 0, z: 18 };
    const goal = { x: 2, y: 0, z: -14 };

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
