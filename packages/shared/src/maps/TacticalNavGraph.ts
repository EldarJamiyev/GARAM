import { Vec3, MapBlockCollider } from './DeCitadelData.js';
import { hasLineOfSight } from '../physics/RaycastEngine.js';

export interface NavNode {
  id: string;
  pos: Vec3;
  neighbors: string[];
  callout: string;
  isHighGround?: boolean;
  coverType?: 'LOW' | 'HIGH' | 'NONE';
}

/**
 * 32-Node Bidirectional Tactical Waypoint Graph covering all lanes and elevations of DE_CITADEL
 */
export const DE_CITADEL_NAV_GRAPH: Record<string, NavNode> = {
  // --- Vanguard CT Spawn Area (South) ---
  ct_spawn_mid: {
    id: 'ct_spawn_mid',
    pos: { x: 0, y: 0, z: 42 },
    neighbors: ['ct_spawn_left', 'ct_spawn_right', 'mid_courtyard_s'],
    callout: 'VANGUARD SPAWN',
  },
  ct_spawn_left: {
    id: 'ct_spawn_left',
    pos: { x: -14, y: 0, z: 40 },
    neighbors: ['ct_spawn_mid', 'ct_a_lane'],
    callout: 'VANGUARD SPAWN',
  },
  ct_spawn_right: {
    id: 'ct_spawn_right',
    pos: { x: 18, y: 0, z: 40 },
    neighbors: ['ct_spawn_mid', 'ct_b_lane'],
    callout: 'VANGUARD SPAWN',
  },

  // --- A Lane & Long ---
  ct_a_lane: {
    id: 'ct_a_lane',
    pos: { x: -28, y: 0, z: 28 },
    neighbors: ['ct_spawn_left', 'a_long_entry', 'mid_courtyard_s'],
    callout: 'A LONG',
  },
  a_long_entry: {
    id: 'a_long_entry',
    pos: { x: -48, y: 0, z: 18 },
    neighbors: ['ct_a_lane', 'a_long_mid'],
    callout: 'A LONG',
    coverType: 'HIGH',
  },
  a_long_mid: {
    id: 'a_long_mid',
    pos: { x: -50, y: 0, z: 0 },
    neighbors: ['a_long_entry', 'a_long_corner'],
    callout: 'A LONG',
  },
  a_long_corner: {
    id: 'a_long_corner',
    pos: { x: -50, y: 0, z: -22 },
    neighbors: ['a_long_mid', 'a_site_entry'],
    callout: 'A LONG',
    coverType: 'HIGH',
  },
  a_site_entry: {
    id: 'a_site_entry',
    pos: { x: -50, y: 0, z: -40 },
    neighbors: ['a_long_corner', 'a_site_courtyard', 't_a_flank'],
    callout: 'A SITE',
  },
  a_site_courtyard: {
    id: 'a_site_courtyard',
    pos: { x: -38, y: 0, z: -38 },
    neighbors: ['a_site_entry', 'a_site_crates'],
    callout: 'A SITE',
    coverType: 'HIGH',
  },

  // --- Bombsite A & Heaven (+3.5m) ---
  a_site_crates: {
    id: 'a_site_crates',
    pos: { x: -38, y: 0, z: -22 },
    neighbors: ['a_site_courtyard', 'a_site_center'],
    callout: 'A SITE',
    coverType: 'HIGH',
  },
  a_site_center: {
    id: 'a_site_center',
    pos: { x: -30, y: 0, z: -22 },
    neighbors: ['a_site_crates', 'a_connector_site'],
    callout: 'A SITE',
    coverType: 'LOW',
  },
  a_heaven_stairs_bottom: {
    id: 'a_heaven_stairs_bottom',
    pos: { x: -14, y: 0, z: -24.4 },
    neighbors: ['a_connector_mid', 'a_heaven_stairs_entry'],
    callout: 'A HEAVEN',
  },
  a_heaven_stairs_entry: {
    id: 'a_heaven_stairs_entry',
    pos: { x: -18, y: 0, z: -24.4 },
    neighbors: ['a_heaven_stairs_bottom', 'a_heaven_stairs_top'],
    callout: 'A HEAVEN',
  },
  a_heaven_stairs_top: {
    id: 'a_heaven_stairs_top',
    pos: { x: -18, y: 3.5, z: -35.6 },
    neighbors: ['a_heaven_stairs_entry', 'a_heaven_balcony'],
    callout: 'A HEAVEN',
    isHighGround: true,
    coverType: 'HIGH',
  },
  a_heaven_balcony: {
    id: 'a_heaven_balcony',
    pos: { x: -24, y: 3.5, z: -40.0 },
    neighbors: ['a_heaven_stairs_top'],
    callout: 'A HEAVEN',
    isHighGround: true,
    coverType: 'LOW',
  },

  // --- A Connector & Mid ---
  a_connector_site: {
    id: 'a_connector_site',
    pos: { x: -24, y: 0, z: -14 },
    neighbors: ['a_site_center', 'a_connector_corner'],
    callout: 'A CONNECTOR',
  },
  a_connector_corner: {
    id: 'a_connector_corner',
    pos: { x: -24, y: 0, z: -4 },
    neighbors: ['a_connector_site', 'a_connector_mid'],
    callout: 'A CONNECTOR',
  },
  a_connector_mid: {
    id: 'a_connector_mid',
    pos: { x: -12, y: 0, z: -4 },
    neighbors: ['a_connector_corner', 'mid_doors_n', 'a_heaven_stairs_bottom'],
    callout: 'A CONNECTOR',
    coverType: 'HIGH',
  },

  // --- Mid Courtyard & Double Doors ---
  mid_courtyard_s: {
    id: 'mid_courtyard_s',
    pos: { x: 0, y: 0, z: 24 },
    neighbors: ['ct_spawn_mid', 'ct_a_lane', 'ct_b_lane', 'mid_courtyard_n'],
    callout: 'MID COURTYARD',
  },
  mid_courtyard_n: {
    id: 'mid_courtyard_n',
    pos: { x: 3, y: 0, z: 8 },
    neighbors: ['mid_courtyard_s', 'mid_doors'],
    callout: 'MID COURTYARD',
  },
  mid_doors: {
    id: 'mid_doors',
    pos: { x: 3, y: 0, z: 0 },
    neighbors: ['mid_courtyard_n', 'mid_doors_n'],
    callout: 'MID DOORS',
    coverType: 'HIGH',
  },
  mid_doors_n: {
    id: 'mid_doors_n',
    pos: { x: 3, y: 0, z: -5 },
    neighbors: ['mid_doors', 't_mid', 'a_connector_mid', 'b_connector_entry'],
    callout: 'MID DOORS',
    coverType: 'HIGH',
  },
  t_mid: {
    id: 't_mid',
    pos: { x: 3, y: 0, z: -16 },
    neighbors: ['mid_doors_n', 't_mid_arch'],
    callout: 'T MID',
  },
  t_mid_arch: {
    id: 't_mid_arch',
    pos: { x: 0, y: 0, z: -28 },
    neighbors: ['t_mid', 't_spawn_mid'],
    callout: 'T MID',
    coverType: 'HIGH',
  },

  // --- Obsidian Syndicate T Spawn (North) ---
  t_spawn_mid: {
    id: 't_spawn_mid',
    pos: { x: 0, y: 0, z: -52 },
    neighbors: ['t_mid_arch', 't_spawn_a', 't_spawn_b'],
    callout: 'SYNDICATE SPAWN',
  },
  t_spawn_a: {
    id: 't_spawn_a',
    pos: { x: -24, y: 0, z: -52 },
    neighbors: ['t_spawn_mid', 't_a_flank'],
    callout: 'SYNDICATE SPAWN',
  },
  t_spawn_b: {
    id: 't_spawn_b',
    pos: { x: 24, y: 0, z: -52 },
    neighbors: ['t_spawn_mid'],
    callout: 'SYNDICATE SPAWN',
  },
  t_a_flank: {
    id: 't_a_flank',
    pos: { x: -50, y: 0, z: -52 },
    neighbors: ['t_spawn_a', 'a_site_entry'],
    callout: 'A SITE',
    coverType: 'HIGH',
  },

  // --- B Connector & Reactor Bombsite B ---
  b_connector_entry: {
    id: 'b_connector_entry',
    pos: { x: 14, y: 0, z: -5 },
    neighbors: ['mid_doors_n', 'b_connector_corner'],
    callout: 'B CONNECTOR',
    coverType: 'HIGH',
  },
  b_connector_corner: {
    id: 'b_connector_corner',
    pos: { x: 28, y: 0, z: -5 },
    neighbors: ['b_connector_entry', 'b_connector_hall'],
    callout: 'B CONNECTOR',
  },
  b_connector_hall: {
    id: 'b_connector_hall',
    pos: { x: 30, y: 0, z: -12 },
    neighbors: ['b_connector_corner', 'b_connector_site'],
    callout: 'B CONNECTOR',
  },
  b_connector_site: {
    id: 'b_connector_site',
    pos: { x: 30, y: 0, z: -18 },
    neighbors: ['b_connector_hall', 'b_site_center'],
    callout: 'B CONNECTOR',
  },
  b_site_center: {
    id: 'b_site_center',
    pos: { x: 30, y: 0, z: -24 },
    neighbors: ['b_connector_site', 'b_site_containers', 'b_tunnels_exit'],
    callout: 'B SITE',
    coverType: 'LOW',
  },
  b_site_containers: {
    id: 'b_site_containers',
    pos: { x: 22, y: 0, z: -24 },
    neighbors: ['b_site_center', 'b_site_back'],
    callout: 'B SITE',
    coverType: 'HIGH',
  },
  b_site_back: {
    id: 'b_site_back',
    pos: { x: 22, y: 0, z: -40 },
    neighbors: ['b_site_containers'],
    callout: 'B SITE',
    coverType: 'HIGH',
  },

  // --- Covered B Tunnels ---
  b_tunnels_exit: {
    id: 'b_tunnels_exit',
    pos: { x: 30, y: 0, z: -20.2 },
    neighbors: ['b_site_center', 'b_tunnels_north'],
    callout: 'B TUNNEL',
    coverType: 'HIGH',
  },
  b_tunnels_north: {
    id: 'b_tunnels_north',
    pos: { x: 44, y: 0, z: -20.2 },
    neighbors: ['b_tunnels_exit', 'b_tunnels_mid'],
    callout: 'B TUNNEL',
  },
  b_tunnels_mid: {
    id: 'b_tunnels_mid',
    pos: { x: 44, y: 0, z: 0 },
    neighbors: ['b_tunnels_north', 'b_tunnels_entry'],
    callout: 'B TUNNEL',
  },
  b_tunnels_entry: {
    id: 'b_tunnels_entry',
    pos: { x: 44, y: 0, z: 18 },
    neighbors: ['b_tunnels_mid', 'ct_b_lane'],
    callout: 'B TUNNEL',
  },
  ct_b_lane: {
    id: 'ct_b_lane',
    pos: { x: 28, y: 0, z: 28 },
    neighbors: ['ct_spawn_right', 'mid_courtyard_s', 'b_tunnels_entry'],
    callout: 'B TUNNEL',
  },
};

/**
 * Finds the closest NavNode to any arbitrary world position.
 * If `blocks` are provided, prioritizes nodes with unobstructed line of sight.
 */
export function findNearestNavNode(
  pos: Vec3,
  filter?: (node: NavNode) => boolean,
  blocks?: MapBlockCollider[]
): NavNode {
  let closest: NavNode | null = null;
  let minDistSq = Infinity;
  let closestWithLOS: NavNode | null = null;
  let minLOSDistSq = Infinity;

  const eyeA = { x: pos.x, y: pos.y + 1.2, z: pos.z };

  for (const key of Object.keys(DE_CITADEL_NAV_GRAPH)) {
    const node = DE_CITADEL_NAV_GRAPH[key];
    if (filter && !filter(node)) continue;

    const dx = node.pos.x - pos.x;
    const dy = (node.pos.y - pos.y) * 1.5; // Weight elevation slightly higher
    const dz = node.pos.z - pos.z;
    const dSq = dx * dx + dy * dy + dz * dz;

    if (dSq < minDistSq) {
      minDistSq = dSq;
      closest = node;
    }

    if (blocks && blocks.length > 0) {
      const eyeB = { x: node.pos.x, y: node.pos.y + 1.2, z: node.pos.z };
      if (hasLineOfSight(eyeA, eyeB, blocks, [])) {
        if (dSq < minLOSDistSq) {
          minLOSDistSq = dSq;
          closestWithLOS = node;
        }
      }
    }
  }

  return closestWithLOS || closest || DE_CITADEL_NAV_GRAPH['mid_courtyard_s'];
}

function dist3D(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Fast A* pathfinding across the connected tactical navigation graph
 * @param start Start world position
 * @param goal Goal world position
 * @param dynamicWeights Optional edge/node cost penalties (e.g. recent death zone or burning molotov)
 * @param blocks Optional map geometry blocks to ensure start and goal entry nodes have line of sight
 */
export function findPathAStar(
  start: Vec3,
  goal: Vec3,
  dynamicWeights?: Record<string, number>,
  blocks?: MapBlockCollider[]
): Vec3[] {
  const startNode = findNearestNavNode(start, undefined, blocks);
  const goalNode = findNearestNavNode(goal, undefined, blocks);

  if (startNode.id === goalNode.id) {
    if (
      blocks &&
      blocks.length > 0 &&
      !hasLineOfSight(
        { x: start.x, y: start.y + 1.2, z: start.z },
        { x: goal.x, y: goal.y + 1.2, z: goal.z },
        blocks,
        []
      )
    ) {
      return [
        { x: start.x, y: start.y, z: start.z },
        { x: startNode.pos.x, y: startNode.pos.y, z: startNode.pos.z },
        { x: goal.x, y: goal.y, z: goal.z },
      ];
    }
    return [
      { x: start.x, y: start.y, z: start.z },
      { x: goal.x, y: goal.y, z: goal.z },
    ];
  }

  const openSet: Set<string> = new Set([startNode.id]);
  const cameFrom: Map<string, string> = new Map();

  const gScore: Map<string, number> = new Map();
  gScore.set(startNode.id, 0);

  const fScore: Map<string, number> = new Map();
  fScore.set(startNode.id, dist3D(startNode.pos, goalNode.pos));

  while (openSet.size > 0) {
    let currentId = '';
    let lowestF = Infinity;

    for (const id of openSet) {
      const f = fScore.get(id) ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        currentId = id;
      }
    }

    if (currentId === goalNode.id) {
      // Reconstruct path
      const path: Vec3[] = [{ x: goal.x, y: goal.y, z: goal.z }];
      let curr = currentId;
      while (cameFrom.has(curr)) {
        path.unshift(DE_CITADEL_NAV_GRAPH[curr].pos);
        curr = cameFrom.get(curr)!;
      }
      path.unshift(DE_CITADEL_NAV_GRAPH[curr].pos);
      path.unshift({ x: start.x, y: start.y, z: start.z });
      return path;
    }

    openSet.delete(currentId);
    const currentNode = DE_CITADEL_NAV_GRAPH[currentId];
    if (!currentNode) continue;

    const currentG = gScore.get(currentId) ?? Infinity;

    for (const neighborId of currentNode.neighbors) {
      const neighbor = DE_CITADEL_NAV_GRAPH[neighborId];
      if (!neighbor) continue;

      const penalty = dynamicWeights?.[neighborId] ?? 0;
      const tentativeG = currentG + dist3D(currentNode.pos, neighbor.pos) + penalty;

      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        cameFrom.set(neighborId, currentId);
        gScore.set(neighborId, tentativeG);
        fScore.set(neighborId, tentativeG + dist3D(neighbor.pos, goalNode.pos));
        openSet.add(neighborId);
      }
    }
  }

  // Fallback: direct line from start to goal if no path found
  return [
    { x: start.x, y: start.y, z: start.z },
    startNode.pos,
    goalNode.pos,
    { x: goal.x, y: goal.y, z: goal.z },
  ];
}

/**
 * Tactical Team Strategy Archetypes for Syndicate (Attackers) & Vanguard (Defenders)
 */
export type SyndicateStrategy =
  | 'RUSH_A_LONG'
  | 'SPLIT_A_MID'
  | 'RUSH_B_TUNNELS'
  | 'MID_TO_B_SPLIT'
  | 'DEFAULT_PICKS_AND_LATE_EXEC';

export type VanguardStrategy =
  | 'STANDARD_2_1_2'
  | 'AGGRESSIVE_MID_CONTROL'
  | 'HEAVY_A_STACK'
  | 'RETAKE_ANCHOR';

export interface RoundStrategySelection {
  syndicate: SyndicateStrategy;
  vanguard: VanguardStrategy;
}

export function rollRandomStrategies(): RoundStrategySelection {
  const synStrategies: SyndicateStrategy[] = [
    'RUSH_A_LONG',
    'SPLIT_A_MID',
    'RUSH_B_TUNNELS',
    'MID_TO_B_SPLIT',
    'DEFAULT_PICKS_AND_LATE_EXEC',
  ];
  const vanStrategies: VanguardStrategy[] = [
    'STANDARD_2_1_2',
    'AGGRESSIVE_MID_CONTROL',
    'HEAVY_A_STACK',
    'RETAKE_ANCHOR',
  ];

  return {
    syndicate: synStrategies[Math.floor(Math.random() * synStrategies.length)],
    vanguard: vanStrategies[Math.floor(Math.random() * vanStrategies.length)],
  };
}
