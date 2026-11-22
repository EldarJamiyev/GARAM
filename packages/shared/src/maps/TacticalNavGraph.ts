import {
  Vec3,
  MapBlockCollider,
  DE_MERIDIAN_DECK_Y,
  DE_MERIDIAN_UPPER_Y,
} from './DeMeridianData.js';
import { hasLineOfSight } from '../physics/RaycastEngine.js';

export interface NavNode {
  id: string;
  pos: Vec3;
  neighbors: string[];
  callout: string;
  isHighGround?: boolean;
  coverType?: 'LOW' | 'HIGH' | 'NONE';
}

const DECK = DE_MERIDIAN_DECK_Y;
const UPPER = DE_MERIDIAN_UPPER_Y;

/**
 * 46-Node Fully Bidirectional Tactical Waypoint Graph covering all 3 vertical tiers of DE_MERIDIAN:
 *  - Tier 0 (y = 0.0m): Sunken Aqueduct Underpass
 *  - Tier 1 (y = +2.1m): Main Map Deck (Sanctum A, Mid Courtyard, Foundry B, CT/T Spawns)
 *  - Tier 2 (y = +4.9m): 4 Interconnected Overlooks (A Palace, A Heaven, Mid CT Nest, B Apartments)
 * Zero dead-end nodes (every node has degree >= 2).
 */
export const DE_MERIDIAN_NAV_GRAPH: Record<string, NavNode> = {
  // =========================================================================
  // 1. VANGUARD CT SPAWN & NORTH ROTATION HALLS (6 nodes)
  // =========================================================================
  ct_spawn_mid: {
    id: 'ct_spawn_mid',
    pos: { x: 0, y: DECK, z: -34.0 },
    neighbors: ['ct_spawn_west', 'ct_spawn_east', 'ct_mid_west_entry', 'ct_mid_east_entry'],
    callout: 'VANGUARD SPAWN',
    coverType: 'HIGH',
  },
  ct_spawn_west: {
    id: 'ct_spawn_west',
    pos: { x: -13.5, y: DECK, z: -34.5 },
    neighbors: ['ct_spawn_mid', 'ct_ticket_lane', 'a_heaven_stairs_e_bot'],
    callout: 'CT TICKET',
    coverType: 'HIGH',
  },
  ct_ticket_lane: {
    id: 'ct_ticket_lane',
    pos: { x: -24.0, y: DECK, z: -35.8 },
    neighbors: ['ct_spawn_west', 'a_site_back'],
    callout: 'CT TICKET',
    coverType: 'HIGH',
  },
  ct_spawn_east: {
    id: 'ct_spawn_east',
    pos: { x: 14.0, y: DECK, z: -35.8 },
    neighbors: ['ct_spawn_mid', 'b_market_north'],
    callout: 'B MARKET',
    coverType: 'HIGH',
  },
  b_market_north: {
    id: 'b_market_north',
    pos: { x: 20.0, y: DECK, z: -36.3 },
    neighbors: ['ct_spawn_east', 'b_market_south'],
    callout: 'B MARKET',
    coverType: 'HIGH',
  },
  b_market_south: {
    id: 'b_market_south',
    pos: { x: 19.0, y: DECK, z: -30.0 },
    neighbors: ['b_market_north', 'b_site_north', 'b_site_west'],
    callout: 'B MARKET',
    coverType: 'HIGH',
  },

  // =========================================================================
  // 2. BOMBSITE A — "THE SANCTUM" & A HEAVEN (8 nodes)
  // =========================================================================
  a_site_back: {
    id: 'a_site_back',
    pos: { x: -32.8, y: DECK, z: -31.0 },
    neighbors: ['ct_ticket_lane', 'a_heaven_stairs_w_bot', 'a_site_firebox', 'a_site_center'],
    callout: 'A SITE SANCTUM',
    coverType: 'HIGH',
  },
  a_site_firebox: {
    id: 'a_site_firebox',
    pos: { x: -42.5, y: DECK, z: -28.5 },
    neighbors: ['a_site_back', 'a_site_west_drop'],
    callout: 'A FIREBOX',
    coverType: 'HIGH',
  },
  a_site_west_drop: {
    id: 'a_site_west_drop',
    pos: { x: -41.2, y: DECK, z: -12.5 },
    neighbors: ['a_site_firebox', 'a_palace_stairs_n_bot', 'a_main_choke', 'a_site_center'],
    callout: 'A SITE SANCTUM',
    coverType: 'HIGH',
  },
  a_site_center: {
    id: 'a_site_center',
    pos: { x: -30.5, y: DECK, z: -22.8 },
    neighbors: ['a_site_back', 'a_site_west_drop', 'a_site_triple'],
    callout: 'A SITE SANCTUM',
    coverType: 'LOW',
  },
  a_site_triple: {
    id: 'a_site_triple',
    pos: { x: -21.5, y: DECK, z: -22.2 },
    neighbors: ['a_site_center', 'a_conn_north'],
    callout: 'A SITE SANCTUM',
    coverType: 'HIGH',
  },
  a_heaven_stairs_e_bot: {
    id: 'a_heaven_stairs_e_bot',
    pos: { x: -11.8, y: DECK, z: -28.8 },
    neighbors: ['ct_spawn_west', 'a_conn_north', 'a_heaven_balcony'],
    callout: 'A SITE SANCTUM',
    coverType: 'HIGH',
  },
  a_heaven_balcony: {
    id: 'a_heaven_balcony',
    pos: { x: -21.5, y: UPPER, z: -28.8 },
    neighbors: ['a_heaven_stairs_e_bot', 'a_heaven_stairs_w_bot'],
    callout: 'A HEAVEN',
    isHighGround: true,
    coverType: 'HIGH',
  },
  a_heaven_stairs_w_bot: {
    id: 'a_heaven_stairs_w_bot',
    pos: { x: -30.8, y: DECK, z: -28.8 },
    neighbors: ['a_heaven_balcony', 'a_site_back'],
    callout: 'A SITE SANCTUM',
    coverType: 'HIGH',
  },

  // =========================================================================
  // 3. A PALACE (+4.9m) & A MAIN (6 nodes)
  // =========================================================================
  a_palace_stairs_n_bot: {
    id: 'a_palace_stairs_n_bot',
    pos: { x: -40.4, y: DECK, z: -9.8 },
    neighbors: ['a_site_west_drop', 'a_palace_balcony'],
    callout: 'A SITE SANCTUM',
    coverType: 'HIGH',
  },
  a_palace_balcony: {
    id: 'a_palace_balcony',
    pos: { x: -40.4, y: UPPER, z: -2.5 },
    neighbors: ['a_palace_stairs_n_bot', 'a_palace_top'],
    callout: 'A PALACE',
    isHighGround: true,
    coverType: 'HIGH',
  },
  a_palace_top: {
    id: 'a_palace_top',
    pos: { x: -41.8, y: UPPER, z: 13.5 },
    neighbors: ['a_palace_balcony', 'a_palace_stairs_s_bot'],
    callout: 'A PALACE',
    isHighGround: true,
    coverType: 'HIGH',
  },
  a_palace_stairs_s_bot: {
    id: 'a_palace_stairs_s_bot',
    pos: { x: -41.8, y: DECK, z: 20.4 },
    neighbors: ['a_palace_top', 't_a_lobby'],
    callout: 'T-A LOBBY',
    coverType: 'HIGH',
  },
  a_main_choke: {
    id: 'a_main_choke',
    pos: { x: -33.4, y: DECK, z: -6.5 },
    neighbors: ['a_site_west_drop', 'a_main_south'],
    callout: 'A MAIN',
    coverType: 'HIGH',
  },
  a_main_south: {
    id: 'a_main_south',
    pos: { x: -33.4, y: DECK, z: 3.0 },
    neighbors: ['a_main_choke', 't_a_lobby'],
    callout: 'A MAIN',
    coverType: 'HIGH',
  },

  // =========================================================================
  // 4. A CONNECTOR, MID NEST (+4.9m), MID COURTYARD & SUNKEN AQUEDUCT (12 nodes)
  // =========================================================================
  a_conn_north: {
    id: 'a_conn_north',
    pos: { x: -12.0, y: DECK, z: -13.5 },
    neighbors: ['a_site_triple', 'a_heaven_stairs_e_bot', 'mid_nest_stairs_w_bot', 'mid_courtyard_nw'],
    callout: 'A CONNECTOR',
    coverType: 'HIGH',
  },
  ct_mid_west_entry: {
    id: 'ct_mid_west_entry',
    pos: { x: -5.2, y: DECK, z: -20.7 },
    neighbors: ['ct_spawn_mid', 'ct_mid_west_turn'],
    callout: 'A CONNECTOR',
    coverType: 'HIGH',
  },
  ct_mid_west_turn: {
    id: 'ct_mid_west_turn',
    pos: { x: -9.6, y: DECK, z: -20.7 },
    neighbors: ['ct_mid_west_entry', 'mid_nest_stairs_w_bot'],
    callout: 'A CONNECTOR',
    coverType: 'HIGH',
  },
  mid_nest_stairs_w_bot: {
    id: 'mid_nest_stairs_w_bot',
    pos: { x: -9.6, y: DECK, z: -16.8 },
    neighbors: ['ct_mid_west_turn', 'a_conn_north', 'mid_nest_center'],
    callout: 'A CONNECTOR',
    coverType: 'HIGH',
  },
  mid_nest_center: {
    id: 'mid_nest_center',
    pos: { x: 0.0, y: UPPER, z: -16.8 },
    neighbors: ['mid_nest_stairs_w_bot', 'mid_nest_stairs_e_bot'],
    callout: 'MID NEST',
    isHighGround: true,
    coverType: 'HIGH',
  },
  mid_nest_stairs_e_bot: {
    id: 'mid_nest_stairs_e_bot',
    pos: { x: 9.6, y: DECK, z: -16.8 },
    neighbors: ['mid_nest_center', 'ct_mid_east_turn', 'b_short_arch'],
    callout: 'B SHORT',
    coverType: 'HIGH',
  },
  ct_mid_east_turn: {
    id: 'ct_mid_east_turn',
    pos: { x: 9.6, y: DECK, z: -20.7 },
    neighbors: ['ct_mid_east_entry', 'mid_nest_stairs_e_bot'],
    callout: 'B SHORT',
    coverType: 'HIGH',
  },
  ct_mid_east_entry: {
    id: 'ct_mid_east_entry',
    pos: { x: 5.2, y: DECK, z: -20.7 },
    neighbors: ['ct_spawn_mid', 'ct_mid_east_turn'],
    callout: 'B SHORT',
    coverType: 'HIGH',
  },
  mid_courtyard_nw: {
    id: 'mid_courtyard_nw',
    pos: { x: -9.0, y: DECK, z: -6.2 },
    neighbors: ['a_conn_north', 'top_mid_west'],
    callout: 'MID COURTYARD',
    coverType: 'HIGH',
  },
  mid_courtyard_e: {
    id: 'mid_courtyard_e',
    pos: { x: 8.4, y: DECK, z: 2.5 },
    neighbors: ['b_short_arch', 'top_mid_east'],
    callout: 'MID COURTYARD',
    coverType: 'HIGH',
  },
  underpass_north: {
    id: 'underpass_north',
    pos: { x: 0.0, y: 0.0, z: -8.0 },
    neighbors: ['underpass_south', 'b_short_arch'],
    callout: 'SUNKEN AQUEDUCT',
    coverType: 'HIGH',
  },
  underpass_south: {
    id: 'underpass_south',
    pos: { x: 0.0, y: 0.0, z: 15.8 },
    neighbors: ['underpass_north', 'top_mid_center'],
    callout: 'SUNKEN AQUEDUCT',
    coverType: 'HIGH',
  },

  // =========================================================================
  // 5. BOMBSITE B — "THE FOUNDRY", B SHORT, B CANAL & B APPS (10 nodes)
  // =========================================================================
  b_short_arch: {
    id: 'b_short_arch',
    pos: { x: 8.6, y: DECK, z: -8.0 },
    neighbors: ['mid_nest_stairs_e_bot', 'underpass_north', 'mid_courtyard_e', 'b_short_exit'],
    callout: 'B SHORT',
    coverType: 'HIGH',
  },
  b_short_exit: {
    id: 'b_short_exit',
    pos: { x: 16.6, y: DECK, z: -9.4 },
    neighbors: ['b_short_arch', 'b_site_west'],
    callout: 'B SHORT',
    coverType: 'HIGH',
  },
  b_site_west: {
    id: 'b_site_west',
    pos: { x: 18.2, y: DECK, z: -14.5 },
    neighbors: ['b_short_exit', 'b_market_south', 'b_canal_choke'],
    callout: 'B SITE FOUNDRY',
    coverType: 'HIGH',
  },
  b_site_north: {
    id: 'b_site_north',
    pos: { x: 26.5, y: DECK, z: -28.0 },
    neighbors: ['b_market_south', 'b_site_bench', 'b_site_center'],
    callout: 'B SITE FOUNDRY',
    coverType: 'HIGH',
  },
  b_site_bench: {
    id: 'b_site_bench',
    pos: { x: 38.5, y: DECK, z: -28.0 },
    neighbors: ['b_site_north', 'b_site_east'],
    callout: 'B SITE FOUNDRY',
    coverType: 'HIGH',
  },
  b_site_center: {
    id: 'b_site_center',
    pos: { x: 31.8, y: DECK, z: -22.5 },
    neighbors: ['b_site_north', 'b_site_east', 'b_canal_choke'],
    callout: 'B SITE FOUNDRY',
    coverType: 'LOW',
  },
  b_site_east: {
    id: 'b_site_east',
    pos: { x: 40.8, y: DECK, z: -20.0 },
    neighbors: ['b_site_bench', 'b_site_center', 'b_apps_north'],
    callout: 'B SITE FOUNDRY',
    coverType: 'HIGH',
  },
  b_apps_north: {
    id: 'b_apps_north',
    pos: { x: 41.2, y: UPPER, z: -11.5 },
    neighbors: ['b_site_east', 'b_apps_south'],
    callout: 'B APARTMENTS',
    isHighGround: true,
    coverType: 'HIGH',
  },
  b_apps_south: {
    id: 'b_apps_south',
    pos: { x: 41.8, y: UPPER, z: 12.5 },
    neighbors: ['b_apps_north', 'b_apps_stairs_s_bot'],
    callout: 'B APARTMENTS',
    isHighGround: true,
    coverType: 'HIGH',
  },
  b_apps_stairs_s_bot: {
    id: 'b_apps_stairs_s_bot',
    pos: { x: 41.8, y: DECK, z: 19.4 },
    neighbors: ['b_apps_south', 't_b_staging'],
    callout: 'T-B STAGING',
    coverType: 'HIGH',
  },

  // =========================================================================
  // 6. B CANAL, TOP MID & SYNDICATE T SPAWN (9 nodes -> Total: 51 nodes)
  // =========================================================================
  b_canal_choke: {
    id: 'b_canal_choke',
    pos: { x: 31.4, y: DECK, z: -6.5 },
    neighbors: ['b_site_west', 'b_site_center', 't_b_staging'],
    callout: 'B CANAL',
    coverType: 'HIGH',
  },
  t_a_lobby: {
    id: 't_a_lobby',
    pos: { x: -33.8, y: DECK, z: 25.5 },
    neighbors: ['a_main_south', 'a_palace_stairs_s_bot', 'top_mid_west', 't_spawn_west'],
    callout: 'T-A LOBBY',
    coverType: 'HIGH',
  },
  top_mid_west: {
    id: 'top_mid_west',
    pos: { x: -9.5, y: DECK, z: 24.5 },
    neighbors: ['mid_courtyard_nw', 't_a_lobby', 'top_mid_center', 't_spawn_west'],
    callout: 'TOP MID',
    coverType: 'HIGH',
  },
  top_mid_center: {
    id: 'top_mid_center',
    pos: { x: 0.0, y: DECK, z: 23.0 },
    neighbors: ['underpass_south', 'top_mid_west', 'top_mid_east'],
    callout: 'TOP MID',
    coverType: 'LOW',
  },
  top_mid_east: {
    id: 'top_mid_east',
    pos: { x: 10.5, y: DECK, z: 24.5 },
    neighbors: ['mid_courtyard_e', 'top_mid_center', 't_b_staging', 't_spawn_east'],
    callout: 'TOP MID',
    coverType: 'HIGH',
  },
  t_b_staging: {
    id: 't_b_staging',
    pos: { x: 33.8, y: DECK, z: 25.5 },
    neighbors: ['b_canal_choke', 'b_apps_stairs_s_bot', 'top_mid_east', 't_spawn_east'],
    callout: 'T-B STAGING',
    coverType: 'HIGH',
  },
  t_spawn_west: {
    id: 't_spawn_west',
    pos: { x: -13.5, y: DECK, z: 35.0 },
    neighbors: ['t_spawn_mid', 'top_mid_west', 't_a_lobby'],
    callout: 'SYNDICATE SPAWN',
    coverType: 'HIGH',
  },
  t_spawn_east: {
    id: 't_spawn_east',
    pos: { x: 13.5, y: DECK, z: 35.0 },
    neighbors: ['t_spawn_mid', 'top_mid_east', 't_b_staging'],
    callout: 'SYNDICATE SPAWN',
    coverType: 'HIGH',
  },
  t_spawn_mid: {
    id: 't_spawn_mid',
    pos: { x: 0.0, y: DECK, z: 38.5 },
    neighbors: ['t_spawn_west', 't_spawn_east'],
    callout: 'SYNDICATE SPAWN',
    coverType: 'HIGH',
  },
};

/**
 * Backward-compatible alias for DE_MERIDIAN_NAV_GRAPH
 */
export const DE_CITADEL_NAV_GRAPH = DE_MERIDIAN_NAV_GRAPH;

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

  for (const key of Object.keys(DE_MERIDIAN_NAV_GRAPH)) {
    const node = DE_MERIDIAN_NAV_GRAPH[key];
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

  return closestWithLOS || closest || DE_MERIDIAN_NAV_GRAPH['top_mid_center'];
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
      const path: Vec3[] = [{ x: goal.x, y: goal.y, z: goal.z }];
      let curr = currentId;
      while (cameFrom.has(curr)) {
        path.unshift(DE_MERIDIAN_NAV_GRAPH[curr].pos);
        curr = cameFrom.get(curr)!;
      }
      path.unshift(DE_MERIDIAN_NAV_GRAPH[curr].pos);
      path.unshift({ x: start.x, y: start.y, z: start.z });
      return path;
    }

    openSet.delete(currentId);
    const currentNode = DE_MERIDIAN_NAV_GRAPH[currentId];
    if (!currentNode) continue;

    const currentG = gScore.get(currentId) ?? Infinity;

    for (const neighborId of currentNode.neighbors) {
      const neighbor = DE_MERIDIAN_NAV_GRAPH[neighborId];
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
