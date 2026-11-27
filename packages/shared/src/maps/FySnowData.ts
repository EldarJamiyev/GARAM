import type { AABBCollider, MapBounds } from '../physics/KinematicPlayerController.js';
import type { MapBlockCollider, CalloutZone, TacticalBotConfig, Vec3 } from './CsOfficeData.js';
import type { NavNode } from './TacticalNavGraph.js';

export interface FloorWeaponSpawnSpec {
  id: string;
  weaponId: string;
  pos: Vec3;
}

/**
 * FY_SNOW (CS 1.6 Iconic Symmetrical Winter Aim Arena)
 * 42m x 42m fast-paced arena with 4 tactical snow-topped concrete pillars
 * and classic floor weapon spawns along both spawn baselines!
 */
export const FY_SNOW_BOUNDS: MapBounds = {
  minX: -21,
  maxX: 21,
  minZ: -21,
  maxZ: 21,
};

const W = 5.5;
export const FY_SNOW_BLOCKS: MapBlockCollider[] = [
  { id: 'snow_perim_n', minX: -21, maxX: 21, minY: 0, maxY: W, minZ: -22, maxZ: -21, material: 'CONCRETE', theme: 'snow' },
  { id: 'snow_perim_s', minX: -21, maxX: 21, minY: 0, maxY: W, minZ: 21, maxZ: 22, material: 'CONCRETE', theme: 'snow' },
  { id: 'snow_perim_w', minX: -22, maxX: -21, minY: 0, maxY: W, minZ: -22, maxZ: 22, material: 'CONCRETE', theme: 'snow' },
  { id: 'snow_perim_e', minX: 21, maxX: 22, minY: 0, maxY: W, minZ: -22, maxZ: 22, material: 'CONCRETE', theme: 'snow' },
  // 4 Symmetrical Bunker Pillars
  { id: 'snow_pillar_nw', minX: -12, maxX: -6, minY: 0, maxY: 4.0, minZ: -11, maxZ: -5, material: 'CONCRETE', theme: 'concrete' },
  { id: 'snow_pillar_ne', minX: 6, maxX: 12, minY: 0, maxY: 4.0, minZ: -11, maxZ: -5, material: 'CONCRETE', theme: 'concrete' },
  { id: 'snow_pillar_sw', minX: -12, maxX: -6, minY: 0, maxY: 4.0, minZ: 5, maxZ: 11, material: 'CONCRETE', theme: 'concrete' },
  { id: 'snow_pillar_se', minX: 6, maxX: 12, minY: 0, maxY: 4.0, minZ: 5, maxZ: 11, material: 'CONCRETE', theme: 'concrete' },
  // Low central snow crates
  { id: 'snow_mid_box_w', minX: -4.5, maxX: -2.0, minY: 0, maxY: 1.4, minZ: -1.5, maxZ: 1.5, material: 'WOOD_THIN', theme: 'wood' },
  { id: 'snow_mid_box_e', minX: 2.0, maxX: 4.5, minY: 0, maxY: 1.4, minZ: -1.5, maxZ: 1.5, material: 'WOOD_THIN', theme: 'wood' },
];

export const FY_SNOW_COLLIDERS: AABBCollider[] = FY_SNOW_BLOCKS.map((b) => ({
  minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY, minZ: b.minZ, maxZ: b.maxZ,
}));

export const FY_SNOW_FLOOR_WEAPONS: FloorWeaponSpawnSpec[] = [
  { id: 'fys_ct_m4', weaponId: 'm4a4', pos: { x: -8, y: 0.25, z: -17.5 } },
  { id: 'fys_ct_awp', weaponId: 'sovereign-awp', pos: { x: 0, y: 0.25, z: -17.5 } },
  { id: 'fys_ct_mp5', weaponId: 'mp5-navy', pos: { x: 8, y: 0.25, z: -17.5 } },
  { id: 'fys_ct_scout', weaponId: 'schmidt-scout', pos: { x: -3.5, y: 0.25, z: -15.5 } },
  { id: 'fys_t_ak', weaponId: 'garam-47', pos: { x: -8, y: 0.25, z: 17.5 } },
  { id: 'fys_t_awp', weaponId: 'sovereign-awp', pos: { x: 0, y: 0.25, z: 17.5 } },
  { id: 'fys_t_p90', weaponId: 'p90', pos: { x: 8, y: 0.25, z: 17.5 } },
  { id: 'fys_t_m3', weaponId: 'leone-m3', pos: { x: 3.5, y: 0.25, z: 15.5 } },
];

export const FY_SNOW_BOMBSITES = {
  A: { center: { x: -999, y: 0, z: -999 }, radius: 1 },
  B: { center: { x: -999, y: 0, z: -999 }, radius: 1 },
};

export const FY_SNOW_SPAWN_POINTS = {
  VANGUARD_CT: { x: 0.0, y: 0.0, z: -16.0 },
  OBSIDIAN_T: { x: 0.0, y: 0.0, z: 16.0 },
};

export const FY_SNOW_SPAWN_ZONES = {
  VANGUARD_BUY_ZONE: { minX: -20, maxX: 20, minZ: -20, maxZ: -11 },
  SYNDICATE_BUY_ZONE: { minX: -20, maxX: 20, minZ: 11, maxZ: 20 },
};

export const FY_SNOW_CALLOUT_ZONES: CalloutZone[] = [
  { name: 'CT SNOW BASE', minX: -21, maxX: 21, minZ: -21, maxZ: -10 },
  { name: 'T SNOW BASE', minX: -21, maxX: 21, minZ: 10, maxZ: 21 },
  { name: 'ICE MID', minX: -21, maxX: 21, minZ: -10, maxZ: 10 },
];

export function getSnowCalloutName(x: number, _y: number, z: number): string {
  for (const zDef of FY_SNOW_CALLOUT_ZONES) {
    if (x >= zDef.minX && x <= zDef.maxX && z >= zDef.minZ && z <= zDef.maxZ) return zDef.name;
  }
  return 'ICE ARENA';
}

export const FY_SNOW_NAV_GRAPH: Record<string, NavNode> = {
  snow_ct: { id: 'snow_ct', pos: { x: 0, y: 0, z: -15 }, neighbors: ['snow_w_lane', 'snow_mid', 'snow_e_lane'], callout: 'CT SNOW BASE', watchAngles: [Math.PI] },
  snow_t: { id: 'snow_t', pos: { x: 0, y: 0, z: 15 }, neighbors: ['snow_w_lane', 'snow_mid', 'snow_e_lane'], callout: 'T SNOW BASE', watchAngles: [0] },
  snow_w_lane: { id: 'snow_w_lane', pos: { x: -16, y: 0, z: 0 }, neighbors: ['snow_ct', 'snow_t', 'snow_mid'], callout: 'ICE MID', watchAngles: [0, Math.PI] },
  snow_mid: { id: 'snow_mid', pos: { x: 0, y: 0, z: 0 }, neighbors: ['snow_ct', 'snow_t', 'snow_w_lane', 'snow_e_lane'], callout: 'ICE MID', isChoke: true, watchAngles: [0, Math.PI] },
  snow_e_lane: { id: 'snow_e_lane', pos: { x: 16, y: 0, z: 0 }, neighbors: ['snow_ct', 'snow_t', 'snow_mid'], callout: 'ICE MID', watchAngles: [0, Math.PI] },
};

export const FY_SNOW_BOTS: TacticalBotConfig[] = [
  { id: 'snow-ct-1', name: 'Vanguard-Maverick', team: 'Vanguard', waypoints: [{ x: -15, y: 0, z: -15 }, { x: -16, y: 0, z: 0 }, { x: 0, y: 0, z: 15 }] },
  { id: 'snow-ct-2', name: 'Vanguard-Steel', team: 'Vanguard', waypoints: [{ x: 15, y: 0, z: -15 }, { x: 16, y: 0, z: 0 }, { x: 0, y: 0, z: 15 }] },
  { id: 'snow-ct-3', name: 'Vanguard-Hawk', team: 'Vanguard', waypoints: [{ x: -4, y: 0, z: -14 }, { x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 15 }] },
  { id: 'snow-ct-4', name: 'Vanguard-Aegis', team: 'Vanguard', waypoints: [{ x: 4, y: 0, z: -14 }, { x: 16, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }] },
  { id: 'snow-t-1', name: 'Syndicate-Viper', team: 'Syndicate', waypoints: [{ x: -15, y: 0, z: 15 }, { x: -16, y: 0, z: 0 }, { x: 0, y: 0, z: -15 }] },
  { id: 'snow-t-2', name: 'Syndicate-Ghost', team: 'Syndicate', waypoints: [{ x: 15, y: 0, z: 15 }, { x: 16, y: 0, z: 0 }, { x: 0, y: 0, z: -15 }] },
  { id: 'snow-t-3', name: 'Syndicate-Razor', team: 'Syndicate', waypoints: [{ x: -4, y: 0, z: 14 }, { x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -15 }] },
  { id: 'snow-t-4', name: 'Syndicate-Titan', team: 'Syndicate', waypoints: [{ x: 4, y: 0, z: 14 }, { x: -16, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }] },
  { id: 'snow-t-5', name: 'Syndicate-Nomad', team: 'Syndicate', waypoints: [{ x: 10, y: 0, z: 15 }, { x: 16, y: 0, z: 0 }, { x: 0, y: 0, z: -15 }] },
];
