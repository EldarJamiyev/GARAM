import type { AABBCollider, LadderVolume, MapBounds } from '../physics/KinematicPlayerController.js';
import type { MapBlockCollider, CalloutZone, TacticalBotConfig, SurfaceMaterial } from './CsOfficeData.js';
import type { NavNode } from './TacticalNavGraph.js';

export interface BreakableBlockSpec {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  health: number;
  material: SurfaceMaterial;
  label: 'GLASS' | 'VENT';
}

/**
 * DE_NUKE (CS 1.6 Classic 2-Level Vertical Reactor Facility)
 * Elevation Tiers (all floors >= 0.0m for grenade bounce invariant):
 *   - Basement / B-Site Reactor Wing : y = 0.0m (Secret stairs, Ramp down, Bombsite B, Decon/Vents)
 *   - Upper Deck / Yard / A-Site     : y = 4.2m (T Spawn, Outside Yard, Lobby, Hut, Main, Bombsite A, Ramp Top, CT Spawn)
 *   - Heaven / Catwalk / Roof        : y = 7.2m (A Heaven Catwalk, Silo Catwalk, Roof Ladder)
 * All stair risers = 0.35m (strictly <= KINEMATICS.STEP_HEIGHT = 0.42m).
 * Includes 4 climbable CS 1.6 func_ladder volumes and 4 breakable vents/windows.
 */
export const DE_NUKE_BOUNDS: MapBounds = {
  minX: -48,
  maxX: 48,
  minZ: -38,
  maxZ: 38,
};

export const DE_NUKE_LOWER_Y = 0.0;
export const DE_NUKE_UPPER_Y = 4.2;
export const DE_NUKE_HEAVEN_Y = 7.2;

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
  theme: MapBlockCollider['theme'] = 'concrete'
): MapBlockCollider[] {
  const steps: MapBlockCollider[] = [];
  const totalSpan = endCoord - startCoord;
  const totalRise = endY - startY;
  const runPerStep = totalSpan / stepCount;
  const risePerStep = totalRise / stepCount;
  for (let i = 0; i < stepCount; i++) {
    const c0 = startCoord + i * runPerStep;
    const c1 = startCoord + (i + 1) * runPerStep;
    steps.push({
      id: `${prefix}_step_${i + 1}`,
      minX: axis === 'x' ? Math.min(c0, c1) : crossMin,
      maxX: axis === 'x' ? Math.max(c0, c1) : crossMax,
      minY: Number((startY + i * risePerStep).toFixed(3)),
      maxY: Number((startY + (i + 1) * risePerStep).toFixed(3)),
      minZ: axis === 'z' ? Math.min(c0, c1) : crossMin,
      maxZ: axis === 'z' ? Math.max(c0, c1) : crossMax,
      material: 'CONCRETE',
      theme,
    });
  }
  return steps;
}

const U = DE_NUKE_UPPER_Y; // 4.2m
const H = DE_NUKE_HEAVEN_Y; // 7.2m
const CEIL = 11.4;

export const DE_NUKE_BLOCKS: MapBlockCollider[] = [
  // 1. OUTER PERIMETER SHELL
  { id: 'nuke_perim_n', minX: -48, maxX: 48, minY: 0, maxY: CEIL, minZ: -39, maxZ: -38, material: 'CONCRETE', theme: 'concrete' },
  { id: 'nuke_perim_s', minX: -48, maxX: 48, minY: 0, maxY: CEIL, minZ: 38, maxZ: 39, material: 'CONCRETE', theme: 'concrete' },
  { id: 'nuke_perim_w', minX: -49, maxX: -48, minY: 0, maxY: CEIL, minZ: -39, maxZ: 39, material: 'CONCRETE', theme: 'concrete' },
  { id: 'nuke_perim_e', minX: 48, maxX: 49, minY: 0, maxY: CEIL, minZ: -39, maxZ: 39, material: 'CONCRETE', theme: 'concrete' },

  // 2. BASEMENT FLOOR (y = 0.0m already grounded; UPPER DECK SLABS y = 0.0 -> 4.2m around central B-Site void)
  { id: 'nuke_upper_t_west', minX: -48, maxX: -8, minY: 0, maxY: U, minZ: -38, maxZ: 12, material: 'CONCRETE', theme: 'concrete' },
  { id: 'nuke_upper_yard', minX: -48, maxX: 48, minY: 0, maxY: U, minZ: 12, maxZ: 38, material: 'CONCRETE', theme: 'concrete' },
  { id: 'nuke_upper_ct_east', minX: 16, maxX: 48, minY: 0, maxY: U, minZ: -38, maxZ: 12, material: 'CONCRETE', theme: 'concrete' },
  { id: 'nuke_a_site_deck', minX: -8, maxX: 16, minY: 3.6, maxY: U, minZ: -20, maxZ: 12, material: 'CONCRETE', theme: 'foundry' },
  { id: 'nuke_ramp_upper_land', minX: 16, maxX: 30, minY: 0, maxY: U, minZ: -38, maxZ: -20, material: 'CONCRETE', theme: 'concrete' },
  ...buildStairs('nuke_ramp_slope', 'x', 16, 2, -34, -22, U, 0.0, 12, 'concrete'),

  // Secret Tunnel Stairs
  ...buildStairs('nuke_secret_stairs', 'x', 36, 24, 24, 30, U, 0.0, 12, 'metal'),

  // 3. BOMBSITE A WALLS & SILO / HUT / MAIN
  { id: 'nuke_yard_wall_w', minX: -14, maxX: 10, minY: U, maxY: CEIL, minZ: 11.4, maxZ: 12.2, material: 'CONCRETE', theme: 'concrete' },
  { id: 'nuke_yard_wall_e', minX: 16, maxX: 24, minY: U, maxY: CEIL, minZ: 11.4, maxZ: 12.2, material: 'CONCRETE', theme: 'concrete' },
  { id: 'nuke_hut_north', minX: -8, maxX: -1, minY: U, maxY: U + 3.0, minZ: 3.6, maxZ: 4.1, material: 'WOOD_THIN', theme: 'wood' },
  { id: 'nuke_hut_south', minX: -8, maxX: -1, minY: U, maxY: U + 3.0, minZ: -6.2, maxZ: -5.7, material: 'WOOD_THIN', theme: 'wood' },
  { id: 'nuke_hut_roof', minX: -8, maxX: -1, minY: U + 2.8, maxY: U + 3.1, minZ: -6.2, maxZ: 4.1, material: 'WOOD_THIN', theme: 'wood' },
  { id: 'nuke_a_silo_1', minX: 1.5, maxX: 5.5, minY: U, maxY: U + 2.6, minZ: -5.5, maxZ: -1.5, material: 'METAL_SHEET', theme: 'metal' },
  { id: 'nuke_a_silo_2', minX: 1.5, maxX: 5.5, minY: U, maxY: U + 2.6, minZ: 2.0, maxZ: 6.0, material: 'METAL_SHEET', theme: 'metal' },
  { id: 'nuke_yard_redbox', minX: 4, maxX: 12, minY: U, maxY: U + 2.5, minZ: 22, maxZ: 26, material: 'METAL_SHEET', theme: 'metal' },
  { id: 'nuke_yard_silo', minX: -18, maxX: -12, minY: U, maxY: U + 3.6, minZ: 22, maxZ: 28, material: 'METAL_SHEET', theme: 'metal' },
  { id: 'nuke_heaven_deck', minX: 10, maxX: 18, minY: H - 0.3, maxY: H, minZ: -18, maxZ: 8, material: 'METAL_SHEET', theme: 'metal' },
  { id: 'nuke_yard_catwalk', minX: -20, maxX: 10, minY: H - 0.3, maxY: H, minZ: 12.2, maxZ: 16.0, material: 'METAL_SHEET', theme: 'metal' },

  // 4. BOMBSITE B REACTOR CORE & CONTAINMENT (y = 0.0m under A-Site)
  { id: 'nuke_b_reactor', minX: 2.0, maxX: 7.0, minY: 0, maxY: 2.8, minZ: -8.0, maxZ: -2.0, material: 'METAL_SHEET', theme: 'metal' },
  { id: 'nuke_b_crate_w', minX: -5.5, maxX: -2.5, minY: 0, maxY: 1.5, minZ: -12.0, maxZ: -9.0, material: 'METAL_SHEET', theme: 'metal' },
  { id: 'nuke_b_wall_w', minX: -8.2, maxX: -7.6, minY: 0, maxY: 3.6, minZ: -38, maxZ: 12, material: 'CONCRETE', theme: 'concrete' },
];

export const DE_NUKE_COLLIDERS: AABBCollider[] = DE_NUKE_BLOCKS.map((b) => ({
  minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY, minZ: b.minZ, maxZ: b.maxZ,
}));

export const DE_NUKE_LADDERS: LadderVolume[] = [
  { id: 'nuke_ladder_heaven', minX: 17.5, maxX: 18.6, minY: U, maxY: H, minZ: -14.0, maxZ: -12.4, normalX: 1, normalZ: 0 },
  { id: 'nuke_ladder_silo', minX: -12.2, maxX: -11.3, minY: U, maxY: H, minZ: 24.0, maxZ: 25.8, normalX: 1, normalZ: 0 },
  { id: 'nuke_ladder_vents', minX: -7.5, maxX: -6.2, minY: 0.0, maxY: U, minZ: 6.5, maxZ: 8.2, normalX: 1, normalZ: 0 },
  { id: 'nuke_ladder_t_roof', minX: -21.0, maxX: -19.8, minY: U, maxY: H, minZ: 11.4, maxZ: 12.6, normalX: -1, normalZ: 0 },
];

export const DE_NUKE_BREAKABLES: BreakableBlockSpec[] = [
  { id: 'nuke_vent_top', minX: -7.4, maxX: -6.2, minY: U - 0.1, maxY: U + 0.15, minZ: 6.5, maxZ: 8.2, health: 40, material: 'VENT_DUCT', label: 'VENT' },
  { id: 'nuke_vent_bot', minX: -6.2, maxX: -5.9, minY: 0.1, maxY: 1.5, minZ: 6.5, maxZ: 8.2, health: 40, material: 'VENT_DUCT', label: 'VENT' },
  { id: 'nuke_hut_window', minX: -1.1, maxX: -0.9, minY: U + 1.0, maxY: U + 2.2, minZ: -3.5, maxZ: -1.5, health: 15, material: 'GLASS', label: 'GLASS' },
  { id: 'nuke_heaven_glass', minX: 9.9, maxX: 10.1, minY: H + 0.2, maxY: H + 1.9, minZ: -4.0, maxZ: 2.0, health: 20, material: 'GLASS', label: 'GLASS' },
];

export const DE_NUKE_BOMBSITES = {
  A: { center: { x: 3.5, y: U, z: -1.0 }, radius: 5.5 },
  B: { center: { x: 4.5, y: 0.0, z: -5.0 }, radius: 5.5 },
};

export const DE_NUKE_SPAWN_POINTS = {
  VANGUARD_CT: { x: 36.0, y: U, z: -6.0 },
  OBSIDIAN_T: { x: -38.0, y: U, z: -10.0 },
};

export const DE_NUKE_SPAWN_ZONES = {
  VANGUARD_BUY_ZONE: { minX: 28, maxX: 46, minZ: -16, maxZ: 4 },
  SYNDICATE_BUY_ZONE: { minX: -46, maxX: -28, minZ: -20, maxZ: 2 },
};

export const DE_NUKE_CALLOUT_ZONES: CalloutZone[] = [
  { name: 'CT SPAWN', minX: 26, maxX: 48, minZ: -18, maxZ: 12, minY: U - 0.5 },
  { name: 'T SPAWN', minX: -48, maxX: -26, minZ: -26, maxZ: 12, minY: U - 0.5 },
  { name: 'OUTSIDE YARD', minX: -48, maxX: 48, minZ: 12, maxZ: 38, minY: U - 0.5 },
  { name: 'HEAVEN', minX: 9, maxX: 20, minZ: -20, maxZ: 10, minY: H - 0.8 },
  { name: 'LOBBY', minX: -26, maxX: -8, minZ: -14, maxZ: 12, minY: U - 0.5 },
  { name: 'HUT', minX: -8, maxX: -1, minZ: -6.5, maxZ: 4.5, minY: U - 0.5 },
  { name: 'BOMBSITE A', minX: -2, maxX: 16, minZ: -18, maxZ: 12, minY: U - 0.5, maxY: H - 0.5 },
  { name: 'RAMP', minX: 0, maxX: 30, minZ: -38, maxZ: -18 },
  { name: 'BOMBSITE B', minX: -8, maxX: 18, minZ: -20, maxZ: 12, minY: -0.5, maxY: 3.6 },
  { name: 'VENTS', minX: -8, maxX: -3, minZ: 4, maxZ: 12, minY: -0.5, maxY: U + 1.0 },
];

export function getNukeCalloutName(x: number, y: number, z: number): string {
  for (const zDef of DE_NUKE_CALLOUT_ZONES) {
    if (
      x >= zDef.minX && x <= zDef.maxX &&
      z >= zDef.minZ && z <= zDef.maxZ &&
      (zDef.minY === undefined || y >= zDef.minY) &&
      (zDef.maxY === undefined || y <= zDef.maxY)
    ) {
      return zDef.name;
    }
  }
  return 'FACILITY';
}

export const DE_NUKE_NAV_GRAPH: Record<string, NavNode> = {
  nuke_ct_spawn: { id: 'nuke_ct_spawn', pos: { x: 36, y: U, z: -6 }, neighbors: ['nuke_ct_main', 'nuke_ct_ramp', 'nuke_garage_yard'], callout: 'CT SPAWN', watchAngles: [-Math.PI * 0.5] },
  nuke_ct_main: { id: 'nuke_ct_main', pos: { x: 18, y: U, z: 4 }, neighbors: ['nuke_ct_spawn', 'nuke_a_site', 'nuke_yard_east'], callout: 'MAIN', isChoke: true, watchAngles: [Math.PI * 0.5, Math.PI] },
  nuke_ct_ramp: { id: 'nuke_ct_ramp', pos: { x: 22, y: U, z: -26 }, neighbors: ['nuke_ct_spawn', 'nuke_ramp_mid', 'nuke_a_site'], callout: 'RAMP', isChoke: true, watchAngles: [-Math.PI * 0.5] },
  nuke_ramp_mid: { id: 'nuke_ramp_mid', pos: { x: 10, y: 2.1, z: -28 }, neighbors: ['nuke_ct_ramp', 'nuke_b_site'], callout: 'RAMP', watchAngles: [-Math.PI * 0.5, Math.PI * 0.5] },
  nuke_b_site: { id: 'nuke_b_site', pos: { x: 0, y: 0.0, z: -5 }, neighbors: ['nuke_ramp_mid', 'nuke_b_decon', 'nuke_b_vents'], callout: 'BOMBSITE B', watchAngles: [0, Math.PI * 0.5] },
  nuke_b_decon: { id: 'nuke_b_decon', pos: { x: 10, y: 0.0, z: 4 }, neighbors: ['nuke_b_site', 'nuke_secret_bot'], callout: 'BOMBSITE B', watchAngles: [Math.PI] },
  nuke_secret_bot: { id: 'nuke_secret_bot', pos: { x: 22, y: 0.0, z: 26 }, neighbors: ['nuke_b_decon', 'nuke_garage_yard'], callout: 'SECRET', watchAngles: [-Math.PI * 0.5] },
  nuke_b_vents: { id: 'nuke_b_vents', pos: { x: -5, y: 0.0, z: 7 }, neighbors: ['nuke_b_site'], callout: 'VENTS', watchAngles: [Math.PI] },
  nuke_a_site: { id: 'nuke_a_site', pos: { x: 5, y: U, z: -1 }, neighbors: ['nuke_ct_main', 'nuke_ct_ramp', 'nuke_hut_door', 'nuke_squeaky'], callout: 'BOMBSITE A', watchAngles: [-Math.PI * 0.5, Math.PI] },
  nuke_hut_door: { id: 'nuke_hut_door', pos: { x: -4, y: U, z: -1 }, neighbors: ['nuke_a_site', 'nuke_lobby'], callout: 'HUT', isChoke: true, watchAngles: [Math.PI * 0.5] },
  nuke_squeaky: { id: 'nuke_squeaky', pos: { x: -4, y: U, z: -12 }, neighbors: ['nuke_a_site', 'nuke_lobby'], callout: 'LOBBY', isChoke: true, watchAngles: [Math.PI * 0.5] },
  nuke_lobby: { id: 'nuke_lobby', pos: { x: -16, y: U, z: -4 }, neighbors: ['nuke_hut_door', 'nuke_squeaky', 'nuke_t_spawn', 'nuke_yard_west'], callout: 'LOBBY', watchAngles: [Math.PI * 0.5] },
  nuke_t_spawn: { id: 'nuke_t_spawn', pos: { x: -36, y: U, z: -10 }, neighbors: ['nuke_lobby', 'nuke_yard_west'], callout: 'T SPAWN', watchAngles: [Math.PI * 0.5, 0] },
  nuke_yard_west: { id: 'nuke_yard_west', pos: { x: -24, y: U, z: 24 }, neighbors: ['nuke_t_spawn', 'nuke_lobby', 'nuke_yard_mid'], callout: 'OUTSIDE YARD', watchAngles: [Math.PI * 0.5] },
  nuke_yard_mid: { id: 'nuke_yard_mid', pos: { x: 0, y: U, z: 24 }, neighbors: ['nuke_yard_west', 'nuke_yard_east'], callout: 'OUTSIDE YARD', isChoke: true, watchAngles: [Math.PI * 0.5, -Math.PI * 0.5] },
  nuke_yard_east: { id: 'nuke_yard_east', pos: { x: 16, y: U, z: 22 }, neighbors: ['nuke_yard_mid', 'nuke_ct_main', 'nuke_garage_yard'], callout: 'OUTSIDE YARD', watchAngles: [-Math.PI * 0.5] },
  nuke_garage_yard: { id: 'nuke_garage_yard', pos: { x: 34, y: U, z: 24 }, neighbors: ['nuke_yard_east', 'nuke_ct_spawn', 'nuke_secret_bot'], callout: 'GARAGE', watchAngles: [-Math.PI * 0.5] },
};

export const DE_NUKE_BOTS: TacticalBotConfig[] = [
  { id: 'nuke-ct-1', name: 'Vanguard-Maverick', team: 'Vanguard', waypoints: [{ x: 36, y: U, z: -6 }, { x: 5, y: U, z: -1 }, { x: -4, y: U, z: -1 }] },
  { id: 'nuke-ct-2', name: 'Vanguard-Steel', team: 'Vanguard', waypoints: [{ x: 34, y: U, z: -3 }, { x: 22, y: U, z: -26 }, { x: 0, y: 0, z: -5 }] },
  { id: 'nuke-ct-3', name: 'Vanguard-Hawk', team: 'Vanguard', waypoints: [{ x: 32, y: U, z: 2 }, { x: 18, y: U, z: 22 }, { x: 0, y: U, z: 24 }] },
  { id: 'nuke-ct-4', name: 'Vanguard-Aegis', team: 'Vanguard', waypoints: [{ x: 35, y: U, z: -9 }, { x: 18, y: U, z: 4 }, { x: 5, y: U, z: -1 }] },
  { id: 'nuke-t-1', name: 'Syndicate-Viper', team: 'Syndicate', waypoints: [{ x: -38, y: U, z: -10 }, { x: -16, y: U, z: -4 }, { x: 5, y: U, z: -1 }] },
  { id: 'nuke-t-2', name: 'Syndicate-Ghost', team: 'Syndicate', waypoints: [{ x: -36, y: U, z: -4 }, { x: -24, y: U, z: 24 }, { x: 16, y: U, z: 22 }] },
  { id: 'nuke-t-3', name: 'Syndicate-Razor', team: 'Syndicate', waypoints: [{ x: -34, y: U, z: -14 }, { x: -4, y: U, z: -12 }, { x: 5, y: U, z: -1 }] },
  { id: 'nuke-t-4', name: 'Syndicate-Titan', team: 'Syndicate', waypoints: [{ x: -39, y: U, z: -6 }, { x: 0, y: U, z: 24 }, { x: 34, y: U, z: 24 }] },
  { id: 'nuke-t-5', name: 'Syndicate-Nomad', team: 'Syndicate', waypoints: [{ x: -35, y: U, z: -8 }, { x: 10, y: 2.1, z: -28 }, { x: 0, y: 0, z: -5 }] },
];
