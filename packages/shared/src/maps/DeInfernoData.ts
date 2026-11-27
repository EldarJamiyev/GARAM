import type { AABBCollider, LadderVolume, MapBounds } from '../physics/KinematicPlayerController.js';
import type { MapBlockCollider, CalloutZone, TacticalBotConfig } from './CsOfficeData.js';
import type { BreakableBlockSpec } from './DeNukeData.js';
import type { NavNode } from './TacticalNavGraph.js';

/**
 * DE_INFERNO (CS 1.6 Classic Mediterranean Cobblestone Compound)
 * Elevation Tiers (all y >= 0.0m):
 *   - Courtyard / Banana / Mid / B Fountain : y = 0.0m
 *   - T Ramp / Top Mid / A Bombsite         : y = 1.4m
 *   - Second Mid Apartments & Balcony       : y = 4.2m (staircases + ladder access)
 */
export const DE_INFERNO_BOUNDS: MapBounds = {
  minX: -44,
  maxX: 44,
  minZ: -38,
  maxZ: 38,
};

const M = 1.4; // Top Mid / A Site tier
const APT = 4.2; // Apartments upper floor
const WALL_H = 7.4;

function buildStairs(
  prefix: string,
  axis: 'x' | 'z',
  startCoord: number,
  endCoord: number,
  crossMin: number,
  crossMax: number,
  startY: number,
  endY: number,
  stepCount: number,
  theme: MapBlockCollider['theme'] = 'sanctum'
): MapBlockCollider[] {
  const steps: MapBlockCollider[] = [];
  const run = (endCoord - startCoord) / stepCount;
  const rise = (endY - startY) / stepCount;
  for (let i = 0; i < stepCount; i++) {
    const c0 = startCoord + i * run;
    const c1 = startCoord + (i + 1) * run;
    steps.push({
      id: `${prefix}_${i + 1}`,
      minX: axis === 'x' ? Math.min(c0, c1) : crossMin,
      maxX: axis === 'x' ? Math.max(c0, c1) : crossMax,
      minY: Number((startY + i * rise).toFixed(3)),
      maxY: Number((startY + (i + 1) * rise).toFixed(3)),
      minZ: axis === 'z' ? Math.min(c0, c1) : crossMin,
      maxZ: axis === 'z' ? Math.max(c0, c1) : crossMax,
      material: 'CONCRETE',
      theme,
    });
  }
  return steps;
}

export const DE_INFERNO_BLOCKS: MapBlockCollider[] = [
  // Outer Perimeter Walls
  { id: 'inf_perim_n', minX: -44, maxX: 44, minY: 0, maxY: WALL_H, minZ: -39, maxZ: -38, material: 'CONCRETE', theme: 'sanctum' },
  { id: 'inf_perim_s', minX: -44, maxX: 44, minY: 0, maxY: WALL_H, minZ: 38, maxZ: 39, material: 'CONCRETE', theme: 'sanctum' },
  { id: 'inf_perim_w', minX: -45, maxX: -44, minY: 0, maxY: WALL_H, minZ: -39, maxZ: 39, material: 'CONCRETE', theme: 'sanctum' },
  { id: 'inf_perim_e', minX: 44, maxX: 45, minY: 0, maxY: WALL_H, minZ: -39, maxZ: 39, material: 'CONCRETE', theme: 'sanctum' },

  // Elevated Mid / Bombsite A / CT Arch Terrace (y = 0 -> 1.4m)
  { id: 'inf_a_terrace', minX: 8, maxX: 44, minY: 0, maxY: M, minZ: -28, maxZ: 14, material: 'CONCRETE', theme: 'sanctum' },
  ...buildStairs('inf_mid_ramp', 'x', 2, 8, -4, 4, 0.0, M, 4, 'sanctum'),
  ...buildStairs('inf_ct_speed_ramp', 'z', 14, 18, 16, 26, M, 0.0, 4, 'sanctum'),

  // Apartments Upper Wing (z in [-36, -18], y = 4.2m) + Stairs from Second Mid (-12, -26)
  { id: 'inf_apt_floor', minX: -12, maxX: 18, minY: 3.8, maxY: APT, minZ: -36, maxZ: -20, material: 'WOOD_THIN', theme: 'wood' },
  ...buildStairs('inf_apt_stairs', 'x', -20, -12, -32, -26, 0.0, APT, 12, 'wood'),

  // Mid Central Divider separating Banana (North z>8) from Second Mid (South z<-10)
  { id: 'inf_mid_house_n', minX: -18, maxX: 6, minY: 0, maxY: WALL_H, minZ: 4.5, maxZ: 11.5, material: 'CONCRETE', theme: 'sanctum' },
  { id: 'inf_mid_house_s', minX: -20, maxX: -2, minY: 0, maxY: WALL_H, minZ: -18, maxZ: -5.5, material: 'CONCRETE', theme: 'sanctum' },

  // Banana Car / Half-Wall & Logs Cover
  { id: 'inf_banana_car', minX: -6, maxX: 0, minY: 0, maxY: 1.5, minZ: 18, maxZ: 22, material: 'METAL_SHEET', theme: 'metal' },
  { id: 'inf_banana_logs', minX: -20, maxX: -16, minY: 0, maxY: 1.2, minZ: 14, maxZ: 19, material: 'WOOD_THIN', theme: 'wood' },

  // Bombsite B Fountain, Spools & Newbox
  { id: 'inf_b_fountain', minX: 4, maxX: 9, minY: 0, maxY: 1.25, minZ: 24, maxZ: 29, material: 'CONCRETE', theme: 'sanctum' },
  { id: 'inf_b_spools', minX: 16, maxX: 19.5, minY: 0, maxY: 1.6, minZ: 27, maxZ: 31, material: 'WOOD_THIN', theme: 'wood' },
  { id: 'inf_b_newbox', minX: 2, maxX: 5, minY: 0, maxY: 1.8, minZ: 32, maxZ: 35, material: 'WOOD_THIN', theme: 'wood' },
  // Wall dividing B Church/CT from A Site except via CT Speed (x in [16,26])
  { id: 'inf_b_ct_wall_w', minX: -4, maxX: 16, minY: 0, maxY: WALL_H, minZ: 14, maxZ: 15.2, material: 'CONCRETE', theme: 'sanctum' },
  { id: 'inf_b_ct_wall_e', minX: 26, maxX: 44, minY: 0, maxY: WALL_H, minZ: 14, maxZ: 15.2, material: 'CONCRETE', theme: 'sanctum' },

  // Bombsite A Crates, Graveyard Pillar & Archway
  { id: 'inf_a_default_crate', minX: 20, maxX: 23.5, minY: M, maxY: M + 1.6, minZ: -9, maxZ: -5.5, material: 'WOOD_THIN', theme: 'wood' },
  { id: 'inf_a_quad_crate', minX: 14, maxX: 17, minY: M, maxY: M + 2.2, minZ: -3, maxZ: 0, material: 'WOOD_THIN', theme: 'wood' },
  { id: 'inf_a_pit_wall', minX: 26, maxX: 31, minY: M, maxY: M + 1.35, minZ: -20, maxZ: -19.2, material: 'CONCRETE', theme: 'sanctum' },
];

export const DE_INFERNO_COLLIDERS: AABBCollider[] = DE_INFERNO_BLOCKS.map((b) => ({
  minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY, minZ: b.minZ, maxZ: b.maxZ,
}));

export const DE_INFERNO_LADDERS: LadderVolume[] = [
  { id: 'inf_ladder_balcony', minX: 17.6, maxX: 18.6, minY: M, maxY: APT, minZ: -21.5, maxZ: -19.8, normalX: 1, normalZ: 0 },
];

export const DE_INFERNO_BREAKABLES: BreakableBlockSpec[] = [
  { id: 'inf_apt_glass', minX: 17.8, maxX: 18.1, minY: APT + 0.3, maxY: APT + 2.1, minZ: -25.0, maxZ: -22.5, health: 20, material: 'GLASS', label: 'GLASS' },
];

export const DE_INFERNO_BOMBSITES = {
  A: { center: { x: 21.5, y: M, z: -7.5 }, radius: 5.5 },
  B: { center: { x: 10.0, y: 0.0, z: 28.0 }, radius: 5.5 },
};

export const DE_INFERNO_SPAWN_POINTS = {
  VANGUARD_CT: { x: 34.0, y: M, z: 2.0 },
  OBSIDIAN_T: { x: -36.0, y: 0.0, z: 0.0 },
};

export const DE_INFERNO_SPAWN_ZONES = {
  VANGUARD_BUY_ZONE: { minX: 27, maxX: 43, minZ: -8, maxZ: 12 },
  SYNDICATE_BUY_ZONE: { minX: -43, maxX: -26, minZ: -12, maxZ: 12 },
};

export const DE_INFERNO_CALLOUT_ZONES: CalloutZone[] = [
  { name: 'CT SPAWN', minX: 26, maxX: 44, minZ: -4, maxZ: 14 },
  { name: 'T SPAWN', minX: -44, maxX: -25, minZ: -14, maxZ: 14 },
  { name: 'MIDDLE', minX: -24, maxX: 12, minZ: -6, maxZ: 5 },
  { name: 'SECOND MID', minX: -24, maxX: 6, minZ: -36, maxZ: -18 },
  { name: 'APARTMENTS', minX: -12, maxX: 18, minZ: -36, maxZ: -20, minY: APT - 0.5 },
  { name: 'BANANA', minX: -24, maxX: 4, minZ: 14, maxZ: 34 },
  { name: 'BOMBSITE B', minX: 0, maxX: 24, minZ: 20, maxZ: 38 },
  { name: 'BOMBSITE A', minX: 12, maxX: 32, minZ: -18, maxZ: 4 },
  { name: 'PIT', minX: 24, maxX: 42, minZ: -36, maxZ: -18 },
];

export function getInfernoCalloutName(x: number, y: number, z: number): string {
  for (const zDef of DE_INFERNO_CALLOUT_ZONES) {
    if (
      x >= zDef.minX && x <= zDef.maxX &&
      z >= zDef.minZ && z <= zDef.maxZ &&
      (zDef.minY === undefined || y >= zDef.minY)
    ) {
      return zDef.name;
    }
  }
  return 'VILLAGE';
}

export const DE_INFERNO_NAV_GRAPH: Record<string, NavNode> = {
  inf_t_spawn: { id: 'inf_t_spawn', pos: { x: -36, y: 0, z: 0 }, neighbors: ['inf_t_ramp', 'inf_second_mid', 'inf_banana_bot'], callout: 'T SPAWN', watchAngles: [Math.PI * 0.5] },
  inf_t_ramp: { id: 'inf_t_ramp', pos: { x: -20, y: 0, z: 0 }, neighbors: ['inf_t_spawn', 'inf_mid', 'inf_banana_bot'], callout: 'MIDDLE', watchAngles: [Math.PI * 0.5] },
  inf_mid: { id: 'inf_mid', pos: { x: -4, y: 0, z: 0 }, neighbors: ['inf_t_ramp', 'inf_top_mid'], callout: 'MIDDLE', isChoke: true, watchAngles: [Math.PI * 0.5, -Math.PI * 0.5] },
  inf_top_mid: { id: 'inf_top_mid', pos: { x: 10, y: M, z: 0 }, neighbors: ['inf_mid', 'inf_a_site', 'inf_ct_arch'], callout: 'BOMBSITE A', isChoke: true, watchAngles: [Math.PI * 0.5, -Math.PI * 0.5] },
  inf_a_site: { id: 'inf_a_site', pos: { x: 21, y: M, z: -7 }, neighbors: ['inf_top_mid', 'inf_ct_spawn', 'inf_pit'], callout: 'BOMBSITE A', watchAngles: [-Math.PI * 0.5, Math.PI] },
  inf_pit: { id: 'inf_pit', pos: { x: 30, y: M, z: -24 }, neighbors: ['inf_a_site', 'inf_ct_spawn'], callout: 'PIT', watchAngles: [0, -Math.PI * 0.5] },
  inf_ct_arch: { id: 'inf_ct_arch', pos: { x: 20, y: M, z: 10 }, neighbors: ['inf_top_mid', 'inf_ct_spawn', 'inf_b_ct_entry'], callout: 'CT SPAWN', isChoke: true, watchAngles: [Math.PI, 0] },
  inf_ct_spawn: { id: 'inf_ct_spawn', pos: { x: 34, y: M, z: 2 }, neighbors: ['inf_ct_arch', 'inf_a_site', 'inf_pit'], callout: 'CT SPAWN', watchAngles: [-Math.PI * 0.5] },
  inf_banana_bot: { id: 'inf_banana_bot', pos: { x: -18, y: 0, z: 22 }, neighbors: ['inf_t_spawn', 'inf_t_ramp', 'inf_banana_mid'], callout: 'BANANA', watchAngles: [Math.PI * 0.5] },
  inf_banana_mid: { id: 'inf_banana_mid', pos: { x: -4, y: 0, z: 26 }, neighbors: ['inf_banana_bot', 'inf_b_site'], callout: 'BANANA', isChoke: true, watchAngles: [Math.PI * 0.5] },
  inf_b_site: { id: 'inf_b_site', pos: { x: 11, y: 0, z: 27 }, neighbors: ['inf_banana_mid', 'inf_b_ct_entry'], callout: 'BOMBSITE B', watchAngles: [-Math.PI * 0.5, 0] },
  inf_b_ct_entry: { id: 'inf_b_ct_entry', pos: { x: 21, y: 0, z: 20 }, neighbors: ['inf_b_site', 'inf_ct_arch'], callout: 'BOMBSITE B', isChoke: true, watchAngles: [0, Math.PI] },
  inf_second_mid: { id: 'inf_second_mid', pos: { x: -24, y: 0, z: -28 }, neighbors: ['inf_t_spawn', 'inf_apts'], callout: 'SECOND MID', watchAngles: [Math.PI * 0.5] },
  inf_apts: { id: 'inf_apts', pos: { x: 6, y: APT, z: -28 }, neighbors: ['inf_second_mid'], callout: 'APARTMENTS', watchAngles: [Math.PI * 0.5] },
};

export const DE_INFERNO_BOTS: TacticalBotConfig[] = [
  { id: 'inf-ct-1', name: 'Vanguard-Maverick', team: 'Vanguard', waypoints: [{ x: 34, y: M, z: 2 }, { x: 21, y: M, z: -7 }, { x: 10, y: M, z: 0 }] },
  { id: 'inf-ct-2', name: 'Vanguard-Steel', team: 'Vanguard', waypoints: [{ x: 32, y: M, z: 6 }, { x: 21, y: 0, z: 20 }, { x: 11, y: 0, z: 27 }] },
  { id: 'inf-ct-3', name: 'Vanguard-Hawk', team: 'Vanguard', waypoints: [{ x: 36, y: M, z: -2 }, { x: 30, y: M, z: -24 }, { x: 21, y: M, z: -7 }] },
  { id: 'inf-ct-4', name: 'Vanguard-Aegis', team: 'Vanguard', waypoints: [{ x: 30, y: M, z: 4 }, { x: -4, y: 0, z: 26 }, { x: 11, y: 0, z: 27 }] },
  { id: 'inf-t-1', name: 'Syndicate-Viper', team: 'Syndicate', waypoints: [{ x: -36, y: 0, z: 0 }, { x: -4, y: 0, z: 0 }, { x: 21, y: M, z: -7 }] },
  { id: 'inf-t-2', name: 'Syndicate-Ghost', team: 'Syndicate', waypoints: [{ x: -34, y: 0, z: 6 }, { x: -4, y: 0, z: 26 }, { x: 11, y: 0, z: 27 }] },
  { id: 'inf-t-3', name: 'Syndicate-Razor', team: 'Syndicate', waypoints: [{ x: -38, y: 0, z: 4 }, { x: -18, y: 0, z: 22 }, { x: 11, y: 0, z: 27 }] },
  { id: 'inf-t-4', name: 'Syndicate-Titan', team: 'Syndicate', waypoints: [{ x: -35, y: 0, z: -6 }, { x: -24, y: 0, z: -28 }, { x: 6, y: APT, z: -28 }] },
  { id: 'inf-t-5', name: 'Syndicate-Nomad', team: 'Syndicate', waypoints: [{ x: -33, y: 0, z: -2 }, { x: 10, y: M, z: 0 }, { x: 21, y: M, z: -7 }] },
];
