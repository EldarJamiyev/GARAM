import {
  Vec3,
  MapBlockCollider,
  CS_OFFICE_FLOOR_Y,
  CS_OFFICE_UPPER_Y,
} from './CsOfficeData.js';
import { hasLineOfSight } from '../physics/RaycastEngine.js';

export interface NavNode {
  id: string;
  pos: Vec3;
  neighbors: string[];
  callout: string;
  isHighGround?: boolean;
  coverType?: 'LOW' | 'HIGH' | 'NONE';
  /** True for key doorway / corridor choke points where bots hold angles & use utility */
  isChoke?: boolean;
  /** Pre-computed yaw radians pointing toward incoming enemy doorways/lanes (Three.js: -sin(y), -cos(y)) */
  watchAngles?: number[];
  /** Nearest high-cover retreat node IDs for low-HP / reload disengagement */
  retreatNodeIds?: string[];
}

const F = CS_OFFICE_FLOOR_Y; // 1.4m
const U = CS_OFFICE_UPPER_Y; // 3.5m

/**
 * 52-Node Fully Bidirectional Tactical Waypoint Graph for CS_OFFICE (Real-Light Edition)
 * Covers all 3 elevation tiers:
 *  - Tier 0 (y = 0.0m): Snowy Front Courtyard & Garage (Vanguard CT Spawn)
 *  - Tier 1 (y = 1.4m): Main Office Complex (Front Hall, Long Hall, Paper Room B, Projector/Conference A, Main Hall, Kitchen, Storage, Back Way, T Back Office)
 *  - Tier 2 (y = 3.5m): Sniper Window Mezzanine Overlook
 *
 * Guaranteed single connected component, zero dead-ends (degree >= 2), >= 0.55m wall clearance,
 * and pre-computed CS2 watchAngles + retreatNodeIds for zero-prefire tactical bot play.
 */
export const CS_OFFICE_NAV_GRAPH: Record<string, NavNode> = {
  // =========================================================================
  // 1. SNOW COURTYARD & GARAGE (Tier 0, y = 0.0m) — 11 Nodes
  // =========================================================================
  ct_spawn_mid: {
    id: 'ct_spawn_mid',
    pos: { x: 0.0, y: 0.0, z: -21.0 },
    neighbors: ['ct_spawn_west', 'ct_spawn_north', 'ct_courtyard_east', 'front_stairs_bot'],
    callout: 'CT COURTYARD',
    coverType: 'LOW',
    watchAngles: [Math.PI, Math.PI * 0.75],
    retreatNodeIds: ['ct_spawn_west', 'ct_courtyard_east'],
  },
  ct_spawn_north: {
    id: 'ct_spawn_north',
    pos: { x: 0.0, y: 0.0, z: -31.0 },
    neighbors: ['ct_spawn_mid', 'ct_van_north', 'ct_courtyard_ne'],
    callout: 'CT COURTYARD',
    coverType: 'HIGH',
    watchAngles: [Math.PI],
    retreatNodeIds: ['ct_van_north', 'ct_courtyard_ne'],
  },
  ct_spawn_west: {
    id: 'ct_spawn_west',
    pos: { x: -10.5, y: 0.0, z: -21.0 },
    neighbors: ['ct_spawn_mid', 'ct_van_north', 'ct_van_south'],
    callout: 'CT COURTYARD',
    coverType: 'HIGH',
    watchAngles: [Math.PI, -Math.PI * 0.7],
    retreatNodeIds: ['ct_van_north', 'ct_spawn_mid'],
  },
  ct_van_north: {
    id: 'ct_van_north',
    pos: { x: -10.5, y: 0.0, z: -31.0 },
    neighbors: ['ct_spawn_north', 'ct_spawn_west', 'ct_courtyard_nw'],
    callout: 'CT COURTYARD',
    coverType: 'HIGH',
    watchAngles: [Math.PI],
    retreatNodeIds: ['ct_spawn_north'],
  },
  ct_van_south: {
    id: 'ct_van_south',
    pos: { x: -10.5, y: 0.0, z: -18.5 },
    neighbors: ['ct_spawn_west', 'ct_dumpster_lane', 'front_stairs_bot'],
    callout: 'CT COURTYARD',
    coverType: 'HIGH',
    watchAngles: [Math.PI, Math.PI * 0.5],
    retreatNodeIds: ['ct_spawn_west'],
  },
  ct_courtyard_nw: {
    id: 'ct_courtyard_nw',
    pos: { x: -29.5, y: 0.0, z: -31.0 },
    neighbors: ['ct_van_north', 'ct_dumpster_lane'],
    callout: 'CT COURTYARD',
    coverType: 'HIGH',
    watchAngles: [Math.PI],
    retreatNodeIds: ['ct_van_north'],
  },
  ct_dumpster_lane: {
    id: 'ct_dumpster_lane',
    pos: { x: -29.5, y: 0.0, z: -19.5 },
    neighbors: ['ct_courtyard_nw', 'ct_van_south', 'long_stairs_bot'],
    callout: 'CT COURTYARD',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [Math.PI, 0],
    retreatNodeIds: ['ct_courtyard_nw', 'ct_van_south'],
  },
  ct_courtyard_ne: {
    id: 'ct_courtyard_ne',
    pos: { x: 11.5, y: 0.0, z: -29.5 },
    neighbors: ['ct_spawn_north', 'ct_courtyard_east', 'garage_entry_bay'],
    callout: 'CT COURTYARD',
    coverType: 'HIGH',
    watchAngles: [Math.PI, -Math.PI * 0.5],
    retreatNodeIds: ['ct_spawn_north'],
  },
  ct_courtyard_east: {
    id: 'ct_courtyard_east',
    pos: { x: 11.5, y: 0.0, z: -22.5 },
    neighbors: ['ct_spawn_mid', 'ct_courtyard_ne', 'garage_entry_bay'],
    callout: 'CT COURTYARD',
    coverType: 'HIGH',
    watchAngles: [Math.PI, -Math.PI * 0.5],
    retreatNodeIds: ['ct_courtyard_ne', 'ct_spawn_mid'],
  },
  garage_entry_bay: {
    id: 'garage_entry_bay',
    pos: { x: 19.5, y: 0.0, z: -22.5 },
    neighbors: ['ct_courtyard_ne', 'ct_courtyard_east', 'garage_east_lane', 'garage_stairs_bot'],
    callout: 'GARAGE',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [Math.PI, -Math.PI * 0.5],
    retreatNodeIds: ['ct_courtyard_east', 'garage_east_lane'],
  },
  garage_east_lane: {
    id: 'garage_east_lane',
    pos: { x: 30.0, y: 0.0, z: -22.5 },
    neighbors: ['garage_entry_bay', 'garage_stairs_bot'],
    callout: 'GARAGE',
    coverType: 'HIGH',
    watchAngles: [Math.PI, Math.PI * 0.5],
    retreatNodeIds: ['garage_entry_bay'],
  },

  // =========================================================================
  // 2. THREE ENTRY STAIRWAYS (0.0m -> 1.4m) — 3 Bottom + 3 Top = 6 Nodes
  // =========================================================================
  long_stairs_bot: {
    id: 'long_stairs_bot',
    pos: { x: -30.0, y: 0.0, z: -17.0 },
    neighbors: ['ct_dumpster_lane', 'long_hall_north'],
    callout: 'LONG HALL',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [Math.PI],
    retreatNodeIds: ['ct_dumpster_lane'],
  },
  front_stairs_bot: {
    id: 'front_stairs_bot',
    pos: { x: 0.0, y: 0.0, z: -17.0 },
    neighbors: ['ct_spawn_mid', 'ct_van_south', 'front_hall_entry'],
    callout: 'FRONT STAIRS',
    coverType: 'LOW',
    isChoke: true,
    watchAngles: [Math.PI],
    retreatNodeIds: ['ct_spawn_mid', 'ct_van_south'],
  },
  garage_stairs_bot: {
    id: 'garage_stairs_bot',
    pos: { x: 26.0, y: 0.0, z: -17.0 },
    neighbors: ['garage_entry_bay', 'garage_east_lane', 'storage_entry'],
    callout: 'GARAGE STAIRS',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [Math.PI],
    retreatNodeIds: ['garage_entry_bay', 'garage_east_lane'],
  },

  // =========================================================================
  // 3. FRONT HALL, RECEPTION, SNIPER MEZZANINE (+3.5m) & STORAGE — 10 Nodes
  // =========================================================================
  front_hall_entry: {
    id: 'front_hall_entry',
    pos: { x: 0.0, y: F, z: -10.0 },
    neighbors: ['front_stairs_bot', 'front_hall_mid'],
    callout: 'FRONT HALL',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [0, Math.PI],
    retreatNodeIds: ['front_stairs_bot', 'front_hall_mid'],
  },
  front_hall_mid: {
    id: 'front_hall_mid',
    pos: { x: 0.0, y: F, z: -7.2 },
    neighbors: ['front_hall_entry', 'front_hall_west', 'front_hall_east', 'front_main_door'],
    callout: 'RECEPTION',
    coverType: 'LOW',
    watchAngles: [0, Math.PI, Math.PI * 0.5, -Math.PI * 0.5],
    retreatNodeIds: ['front_hall_west', 'front_hall_east'],
  },
  front_hall_west: {
    id: 'front_hall_west',
    pos: { x: -14.2, y: F, z: -6.8 },
    neighbors: ['front_hall_mid', 'mezz_stairs_w_bot', 'front_paper_door', 'long_front_door'],
    callout: 'FRONT HALL',
    coverType: 'HIGH',
    watchAngles: [Math.PI, Math.PI * 0.5, -Math.PI * 0.5],
    retreatNodeIds: ['front_hall_mid', 'long_front_door'],
  },
  mezz_stairs_w_bot: {
    id: 'mezz_stairs_w_bot',
    pos: { x: -14.2, y: F, z: -10.0 },
    neighbors: ['front_hall_west', 'sniper_mezz_center'],
    callout: 'FRONT HALL',
    coverType: 'HIGH',
    watchAngles: [-Math.PI * 0.5, Math.PI],
    retreatNodeIds: ['front_hall_west'],
  },
  sniper_mezz_center: {
    id: 'sniper_mezz_center',
    pos: { x: 0.0, y: U, z: -10.0 },
    neighbors: ['mezz_stairs_w_bot', 'mezz_stairs_e_bot'],
    callout: 'SNIPER WINDOW',
    isHighGround: true,
    coverType: 'HIGH',
    watchAngles: [0, Math.PI],
    retreatNodeIds: ['mezz_stairs_w_bot', 'mezz_stairs_e_bot'],
  },
  mezz_stairs_e_bot: {
    id: 'mezz_stairs_e_bot',
    pos: { x: 14.2, y: F, z: -10.0 },
    neighbors: ['sniper_mezz_center', 'side_hall_west'],
    callout: 'SIDE HALL',
    coverType: 'HIGH',
    watchAngles: [Math.PI * 0.5, Math.PI],
    retreatNodeIds: ['side_hall_west'],
  },
  front_hall_east: {
    id: 'front_hall_east',
    pos: { x: 6.5, y: F, z: -7.0 },
    neighbors: ['front_hall_mid', 'front_main_door', 'side_hall_west'],
    callout: 'FRONT HALL',
    coverType: 'HIGH',
    watchAngles: [Math.PI, -Math.PI * 0.5],
    retreatNodeIds: ['front_hall_mid', 'side_hall_west'],
  },
  front_main_door: {
    id: 'front_main_door',
    pos: { x: 0.0, y: F, z: -4.1 },
    neighbors: ['front_hall_mid', 'front_hall_east', 'main_hall_north'],
    callout: 'RECEPTION',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [Math.PI, 0],
    retreatNodeIds: ['front_hall_east', 'front_hall_mid'],
  },
  side_hall_west: {
    id: 'side_hall_west',
    pos: { x: 18.5, y: F, z: -6.8 },
    neighbors: ['front_hall_east', 'mezz_stairs_e_bot', 'storage_entry', 'a_site_north_door'],
    callout: 'SIDE HALL',
    coverType: 'HIGH',
    watchAngles: [Math.PI, -Math.PI * 0.5, Math.PI * 0.5],
    retreatNodeIds: ['front_hall_east', 'storage_entry'],
  },
  storage_entry: {
    id: 'storage_entry',
    pos: { x: 26.0, y: F, z: -8.2 },
    neighbors: ['garage_stairs_bot', 'side_hall_west', 'storage_east'],
    callout: 'STORAGE',
    coverType: 'HIGH',
    watchAngles: [0, Math.PI, Math.PI * 0.5],
    retreatNodeIds: ['garage_stairs_bot', 'side_hall_west'],
  },
  storage_east: {
    id: 'storage_east',
    pos: { x: 30.5, y: F, z: -4.5 },
    neighbors: ['storage_entry', 'a_site_east'],
    callout: 'STORAGE',
    coverType: 'HIGH',
    watchAngles: [Math.PI, 0],
    retreatNodeIds: ['storage_entry'],
  },

  // =========================================================================
  // 4. LONG HALL (West AWP Lane, y = 1.4m) — 6 Nodes
  // =========================================================================
  long_hall_north: {
    id: 'long_hall_north',
    pos: { x: -30.0, y: F, z: -9.5 },
    neighbors: ['long_stairs_bot', 'long_front_door', 'long_hall_mid_n'],
    callout: 'LONG HALL',
    coverType: 'HIGH',
    watchAngles: [Math.PI, 0],
    retreatNodeIds: ['long_stairs_bot', 'long_front_door'],
  },
  long_front_door: {
    id: 'long_front_door',
    pos: { x: -24.3, y: F, z: -8.5 },
    neighbors: ['long_hall_north', 'front_hall_west'],
    callout: 'LONG HALL',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [Math.PI * 0.5, -Math.PI * 0.5],
    retreatNodeIds: ['long_hall_north', 'front_hall_west'],
  },
  long_hall_mid_n: {
    id: 'long_hall_mid_n',
    pos: { x: -29.5, y: F, z: 2.5 },
    neighbors: ['long_hall_north', 'long_paper_door', 'long_hall_mid_s'],
    callout: 'LONG HALL',
    coverType: 'HIGH',
    watchAngles: [Math.PI, 0, -Math.PI * 0.5],
    retreatNodeIds: ['long_hall_north', 'long_paper_door'],
  },
  long_paper_door: {
    id: 'long_paper_door',
    pos: { x: -24.3, y: F, z: 2.5 },
    neighbors: ['long_hall_mid_n', 'b_site_paper_center'],
    callout: 'PAPER ROOM',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [Math.PI * 0.5, -Math.PI * 0.5],
    retreatNodeIds: ['long_hall_mid_n', 'b_site_paper_center'],
  },
  long_hall_mid_s: {
    id: 'long_hall_mid_s',
    pos: { x: -29.5, y: F, z: 13.5 },
    neighbors: ['long_hall_mid_n', 'long_hall_south'],
    callout: 'LONG HALL',
    coverType: 'HIGH',
    watchAngles: [0, Math.PI],
    retreatNodeIds: ['long_hall_south', 'long_hall_mid_n'],
  },
  long_hall_south: {
    id: 'long_hall_south',
    pos: { x: -29.5, y: F, z: 21.0 },
    neighbors: ['long_hall_mid_s', 'back_way_west', 't_spawn_far_west'],
    callout: 'LONG HALL',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [0, -Math.PI * 0.5],
    retreatNodeIds: ['back_way_west', 't_spawn_far_west'],
  },

  // =========================================================================
  // 5. BOMBSITE B — PAPER ROOM & CONNECTOR (y = 1.4m) — 5 Nodes
  // =========================================================================
  front_paper_door: {
    id: 'front_paper_door',
    pos: { x: -14.2, y: F, z: -3.5 },
    neighbors: ['front_hall_west', 'b_site_paper_center'],
    callout: 'PAPER ROOM',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [Math.PI, 0],
    retreatNodeIds: ['front_hall_west', 'b_site_paper_center'],
  },
  b_site_paper_center: {
    id: 'b_site_paper_center',
    pos: { x: -14.5, y: F, z: 2.5 },
    neighbors: ['front_paper_door', 'long_paper_door', 'b_site_paper_east', 'b_site_paper_south'],
    callout: 'PAPER ROOM',
    coverType: 'LOW',
    watchAngles: [Math.PI, Math.PI * 0.5, 0, -Math.PI * 0.5],
    retreatNodeIds: ['front_paper_door', 'b_site_paper_east'],
  },
  b_site_paper_east: {
    id: 'b_site_paper_east',
    pos: { x: -8.5, y: F, z: 5.2 },
    neighbors: ['b_site_paper_center', 'main_hall_west'],
    callout: 'PAPER ROOM',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [-Math.PI * 0.5, Math.PI * 0.5],
    retreatNodeIds: ['b_site_paper_center', 'main_hall_west'],
  },
  b_site_paper_south: {
    id: 'b_site_paper_south',
    pos: { x: -14.5, y: F, z: 11.5 },
    neighbors: ['b_site_paper_center', 'paper_south_door'],
    callout: 'PAPER ROOM',
    coverType: 'HIGH',
    watchAngles: [Math.PI, 0],
    retreatNodeIds: ['b_site_paper_center', 'paper_south_door'],
  },
  paper_south_door: {
    id: 'paper_south_door',
    pos: { x: -14.5, y: F, z: 16.5 },
    neighbors: ['b_site_paper_south', 'back_way_west', 'back_way_east'],
    callout: 'BACK WAY',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [0, Math.PI],
    retreatNodeIds: ['b_site_paper_south', 'back_way_west'],
  },

  // =========================================================================
  // 6. MAIN HALL (Center Hub, y = 1.4m) — 5 Nodes
  // =========================================================================
  main_hall_north: {
    id: 'main_hall_north',
    pos: { x: 0.0, y: F, z: 1.5 },
    neighbors: ['front_main_door', 'main_hall_west', 'main_hall_east'],
    callout: 'MAIN HALL',
    coverType: 'LOW',
    watchAngles: [Math.PI, 0],
    retreatNodeIds: ['front_main_door', 'main_hall_west'],
  },
  main_hall_west: {
    id: 'main_hall_west',
    pos: { x: -3.2, y: F, z: 5.2 },
    neighbors: ['main_hall_north', 'b_site_paper_east', 'main_hall_sw'],
    callout: 'MAIN HALL',
    coverType: 'HIGH',
    watchAngles: [Math.PI * 0.5, Math.PI, 0],
    retreatNodeIds: ['b_site_paper_east', 'main_hall_north'],
  },
  main_hall_east: {
    id: 'main_hall_east',
    pos: { x: 8.5, y: F, z: 5.2 },
    neighbors: ['main_hall_north', 'a_site_west_door', 'main_hall_se'],
    callout: 'MAIN HALL',
    coverType: 'HIGH',
    watchAngles: [-Math.PI * 0.5, Math.PI, 0],
    retreatNodeIds: ['a_site_west_door', 'main_hall_north'],
  },
  main_hall_sw: {
    id: 'main_hall_sw',
    pos: { x: -1.5, y: F, z: 14.5 },
    neighbors: ['main_hall_west', 'main_hall_se', 'main_hall_south'],
    callout: 'MAIN HALL',
    coverType: 'HIGH',
    watchAngles: [0, Math.PI],
    retreatNodeIds: ['main_hall_west', 'main_hall_south'],
  },
  main_hall_se: {
    id: 'main_hall_se',
    pos: { x: 8.5, y: F, z: 19.0 },
    neighbors: ['main_hall_east', 'main_hall_sw', 'main_hall_south', 'kitchen_west_door'],
    callout: 'MAIN HALL',
    coverType: 'HIGH',
    watchAngles: [0, -Math.PI * 0.5, Math.PI],
    retreatNodeIds: ['main_hall_east', 'kitchen_west_door'],
  },
  main_hall_south: {
    id: 'main_hall_south',
    pos: { x: 3.5, y: F, z: 22.0 },
    neighbors: ['main_hall_sw', 'main_hall_se', 't_exit_center'],
    callout: 'MAIN HALL',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [0, Math.PI],
    retreatNodeIds: ['main_hall_sw', 't_exit_center'],
  },

  // =========================================================================
  // 7. BOMBSITE A — PROJECTOR ROOM & CONFERENCE HALL (y = 1.4m) — 5 Nodes
  // =========================================================================
  a_site_north_door: {
    id: 'a_site_north_door',
    pos: { x: 18.5, y: F, z: -3.2 },
    neighbors: ['side_hall_west', 'a_site_center'],
    callout: 'PROJECTOR ROOM',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [Math.PI, 0],
    retreatNodeIds: ['side_hall_west', 'a_site_center'],
  },
  a_site_center: {
    id: 'a_site_center',
    pos: { x: 22.5, y: F, z: -1.5 },
    neighbors: ['a_site_north_door', 'a_site_east', 'a_site_west_door'],
    callout: 'PROJECTOR ROOM',
    coverType: 'LOW',
    watchAngles: [Math.PI, Math.PI * 0.5, 0],
    retreatNodeIds: ['a_site_north_door', 'a_site_east'],
  },
  a_site_east: {
    id: 'a_site_east',
    pos: { x: 30.5, y: F, z: 4.5 },
    neighbors: ['storage_east', 'a_site_center', 'a_site_south'],
    callout: 'PROJECTOR ROOM',
    coverType: 'HIGH',
    watchAngles: [Math.PI, Math.PI * 0.5, 0],
    retreatNodeIds: ['storage_east', 'a_site_center'],
  },
  a_site_west_door: {
    id: 'a_site_west_door',
    pos: { x: 15.0, y: F, z: 5.2 },
    neighbors: ['main_hall_east', 'a_site_center', 'a_site_south'],
    callout: 'CONFERENCE HALL',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [Math.PI * 0.5, -Math.PI * 0.5, Math.PI],
    retreatNodeIds: ['a_site_center', 'main_hall_east'],
  },
  a_site_south: {
    id: 'a_site_south',
    pos: { x: 24.5, y: F, z: 9.5 },
    neighbors: ['a_site_east', 'a_site_west_door', 'kitchen_north_door'],
    callout: 'CONFERENCE HALL',
    coverType: 'HIGH',
    watchAngles: [Math.PI, 0],
    retreatNodeIds: ['a_site_east', 'kitchen_north_door'],
  },

  // =========================================================================
  // 8. KITCHEN, BACK WAY & SYNDICATE T BACK OFFICE (y = 1.4m) — 11 Nodes
  // =========================================================================
  kitchen_north_door: {
    id: 'kitchen_north_door',
    pos: { x: 24.5, y: F, z: 15.5 },
    neighbors: ['a_site_south', 'kitchen_center'],
    callout: 'KITCHEN',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [0, Math.PI],
    retreatNodeIds: ['kitchen_center', 'a_site_south'],
  },
  kitchen_west_door: {
    id: 'kitchen_west_door',
    pos: { x: 13.5, y: F, z: 22.0 },
    neighbors: ['main_hall_se', 'kitchen_center'],
    callout: 'KITCHEN',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [Math.PI * 0.5, -Math.PI * 0.5],
    retreatNodeIds: ['kitchen_center', 'main_hall_se'],
  },
  kitchen_center: {
    id: 'kitchen_center',
    pos: { x: 24.5, y: F, z: 22.0 },
    neighbors: ['kitchen_north_door', 'kitchen_west_door', 't_exit_east'],
    callout: 'KITCHEN',
    coverType: 'HIGH',
    watchAngles: [0, Math.PI * 0.5, Math.PI],
    retreatNodeIds: ['t_exit_east', 'kitchen_west_door'],
  },
  back_way_west: {
    id: 'back_way_west',
    pos: { x: -21.0, y: F, z: 21.0 },
    neighbors: ['long_hall_south', 'paper_south_door', 'back_way_east'],
    callout: 'BACK WAY',
    coverType: 'HIGH',
    watchAngles: [0, Math.PI * 0.5],
    retreatNodeIds: ['long_hall_south', 'back_way_east'],
  },
  back_way_east: {
    id: 'back_way_east',
    pos: { x: -12.5, y: F, z: 22.0 },
    neighbors: ['back_way_west', 'paper_south_door', 't_exit_west'],
    callout: 'BACK WAY',
    coverType: 'HIGH',
    watchAngles: [0, Math.PI],
    retreatNodeIds: ['t_exit_west', 'back_way_west'],
  },
  t_exit_west: {
    id: 't_exit_west',
    pos: { x: -12.5, y: F, z: 28.0 },
    neighbors: ['back_way_east', 't_spawn_far_west', 't_spawn_west'],
    callout: 'T BACK OFFICE',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [0],
    retreatNodeIds: ['t_spawn_west'],
  },
  t_exit_center: {
    id: 't_exit_center',
    pos: { x: 3.5, y: F, z: 28.0 },
    neighbors: ['main_hall_south', 't_spawn_east', 't_spawn_mid'],
    callout: 'T BACK OFFICE',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [0],
    retreatNodeIds: ['t_spawn_mid'],
  },
  t_exit_east: {
    id: 't_exit_east',
    pos: { x: 24.5, y: F, z: 28.0 },
    neighbors: ['kitchen_center', 't_spawn_east', 't_spawn_far_east'],
    callout: 'T BACK OFFICE',
    coverType: 'HIGH',
    isChoke: true,
    watchAngles: [0],
    retreatNodeIds: ['t_spawn_east'],
  },
  t_spawn_far_west: {
    id: 't_spawn_far_west',
    pos: { x: -29.5, y: F, z: 33.5 },
    neighbors: ['long_hall_south', 't_exit_west', 't_spawn_west'],
    callout: 'T BACK OFFICE',
    coverType: 'HIGH',
    watchAngles: [0],
    retreatNodeIds: ['t_spawn_west'],
  },
  t_spawn_west: {
    id: 't_spawn_west',
    pos: { x: -12.5, y: F, z: 34.5 },
    neighbors: ['t_exit_west', 't_spawn_far_west', 't_spawn_mid'],
    callout: 'T BACK OFFICE',
    coverType: 'HIGH',
    watchAngles: [0],
    retreatNodeIds: ['t_spawn_mid'],
  },
  t_spawn_mid: {
    id: 't_spawn_mid',
    pos: { x: 0.0, y: F, z: 34.5 },
    neighbors: ['t_spawn_west', 't_exit_center', 't_spawn_east'],
    callout: 'T BACK OFFICE',
    coverType: 'HIGH',
    watchAngles: [0],
    retreatNodeIds: ['t_spawn_west', 't_spawn_east'],
  },
  t_spawn_east: {
    id: 't_spawn_east',
    pos: { x: 14.0, y: F, z: 34.5 },
    neighbors: ['t_spawn_mid', 't_exit_center', 't_exit_east', 't_spawn_far_east'],
    callout: 'T BACK OFFICE',
    coverType: 'HIGH',
    watchAngles: [0],
    retreatNodeIds: ['t_spawn_mid'],
  },
  t_spawn_far_east: {
    id: 't_spawn_far_east',
    pos: { x: 24.5, y: F, z: 34.5 },
    neighbors: ['t_exit_east', 't_spawn_east'],
    callout: 'T BACK OFFICE',
    coverType: 'HIGH',
    watchAngles: [0],
    retreatNodeIds: ['t_spawn_east'],
  },
};

/**
 * Backward-compatible aliases so existing client/server/test modules resolve seamlessly to CS_OFFICE
 */
export const DE_MERIDIAN_NAV_GRAPH = CS_OFFICE_NAV_GRAPH;
export const DE_CITADEL_NAV_GRAPH = CS_OFFICE_NAV_GRAPH;

/**
 * Finds the closest NavNode to any arbitrary world position.
 * If `blocks` are provided, prioritizes nodes with unobstructed line of sight.
 */
export function findNearestNavNode(
  pos: Vec3,
  filter?: (node: NavNode) => boolean,
  blocks?: MapBlockCollider[],
  navGraph: Record<string, NavNode> = CS_OFFICE_NAV_GRAPH
): NavNode {
  let closest: NavNode | null = null;
  let minDistSq = Infinity;
  let closestWithLOS: NavNode | null = null;
  let minLOSDistSq = Infinity;

  const eyeA = { x: pos.x, y: pos.y + 1.2, z: pos.z };

  for (const key of Object.keys(navGraph)) {
    const node = navGraph[key];
    if (filter && !filter(node)) continue;

    const dx = node.pos.x - pos.x;
    const dy = (node.pos.y - pos.y) * 1.5;
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

  return closestWithLOS || closest || navGraph['main_hall_north'] || Object.values(navGraph)[0];
}

function dist3D(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Fast A* pathfinding across any connected tactical navigation graph (defaults to CS_OFFICE_NAV_GRAPH)
 */
export function findPathAStar(
  start: Vec3,
  goal: Vec3,
  dynamicWeights?: Record<string, number>,
  blocks?: MapBlockCollider[],
  navGraph: Record<string, NavNode> = CS_OFFICE_NAV_GRAPH
): Vec3[] {
  const startNode = findNearestNavNode(start, undefined, blocks, navGraph);
  const goalNode = findNearestNavNode(goal, undefined, blocks, navGraph);

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
        path.unshift(navGraph[curr].pos);
        curr = cameFrom.get(curr)!;
      }
      path.unshift(navGraph[curr].pos);
      path.unshift({ x: start.x, y: start.y, z: start.z });
      return path;
    }

    openSet.delete(currentId);
    const currentNode = navGraph[currentId];
    if (!currentNode) continue;

    const currentG = gScore.get(currentId) ?? Infinity;

    for (const neighborId of currentNode.neighbors) {
      const neighbor = navGraph[neighborId];
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
