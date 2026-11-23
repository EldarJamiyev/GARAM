import { AABBCollider, MapBounds } from '../physics/KinematicPlayerController.js';

export type SurfaceMaterial = 'CONCRETE' | 'WOOD_THIN' | 'DRYWALL' | 'METAL_SHEET';

export interface SurfaceMaterialProps {
  /** Attenuation factor mu (higher = easier to penetrate) */
  mu: number;
  /** Damage attenuation cost per meter of material thickness */
  cost: number;
  /** Maximum penetrable thickness in meters */
  maxThickness: number;
  /** True for impenetrable concrete/perimeter walls */
  isImpenetrable: boolean;
}

export const SURFACE_MATERIALS: Record<SurfaceMaterial, SurfaceMaterialProps> = {
  CONCRETE: { mu: 0.0, cost: 999, maxThickness: 0.0, isImpenetrable: true },
  WOOD_THIN: { mu: 0.75, cost: 10, maxThickness: 2.2, isImpenetrable: false },
  DRYWALL: { mu: 0.70, cost: 18, maxThickness: 1.5, isImpenetrable: false },
  METAL_SHEET: { mu: 0.45, cost: 36, maxThickness: 1.2, isImpenetrable: false },
};

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MapBlockCollider extends AABBCollider {
  id: string;
  material: SurfaceMaterial;
  /** Visual material theme for CS_OFFICE Real-Light architectural rendering */
  theme?: 'snow' | 'brick' | 'office_floor' | 'drywall' | 'garage' | 'wood' | 'metal' | 'concrete' | 'sanctum' | 'foundry' | 'aqueduct';
}

export interface CalloutZone {
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY?: number;
  maxY?: number;
}

export interface TacticalBotConfig {
  id: string;
  name: string;
  team: 'Vanguard' | 'Syndicate';
  waypoints: Vec3[];
}

/**
 * CS_OFFICE (Real-Light Edition) — 3-Elevation Competitive Tactical Map
 *  - Tier 0 (y = 0.0m): Snowy Front Courtyard & Garage (Vanguard CT Spawn)
 *  - Tier 1 (y = 1.4m): Main Office Complex (Front Hall, Long Hall, Paper Room B, Projector/Conference A, Main Hall, Kitchen, Storage, Back Way, Syndicate T Spawn)
 *  - Tier 2 (y = 3.5m): Sniper Window Mezzanine Overlook
 *
 * All stair risers strictly 0.35m (<= KINEMATICS.STEP_HEIGHT = 0.42m), zero AABB overlap.
 * All floors strictly y >= 0.0m (grenade bounce invariant).
 */
export const CS_OFFICE_BOUNDS: MapBounds = {
  minX: -38,
  maxX: 38,
  minZ: -34,
  maxZ: 38,
};

export const CS_OFFICE_COURTYARD_Y = 0.0;
export const CS_OFFICE_FLOOR_Y = 1.4;
export const CS_OFFICE_UPPER_Y = 3.5;

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
    const minC = Math.min(c0, c1);
    const maxC = Math.max(c0, c1);
    const stepTop = Number((startY + (i + 1) * risePerStep).toFixed(3));
    const stepBot = Number((startY + i * risePerStep).toFixed(3));

    steps.push({
      id: `${prefix}_stairs_${i + 1}`,
      minX: axis === 'x' ? minC : crossMin,
      maxX: axis === 'x' ? maxC : crossMax,
      minY: stepBot,
      maxY: stepTop,
      minZ: axis === 'z' ? minC : crossMin,
      maxZ: axis === 'z' ? maxC : crossMax,
      material: 'CONCRETE',
      theme,
    });
  }
  return steps;
}

const F = CS_OFFICE_FLOOR_Y; // 1.4m
const U = CS_OFFICE_UPPER_Y; // 3.5m
const WALL_TOP = 5.6;

export const CS_OFFICE_BLOCKS: MapBlockCollider[] = [
  // =========================================================================
  // 1. OUTER CONCRETE PERIMETER (Impenetrable Brick/Concrete Shell)
  // =========================================================================
  { id: 'perim_north', minX: -38, maxX: 38, minY: 0, maxY: WALL_TOP, minZ: -35, maxZ: -34, material: 'CONCRETE', theme: 'brick' },
  { id: 'perim_south', minX: -38, maxX: 38, minY: 0, maxY: WALL_TOP, minZ: 38, maxZ: 39, material: 'CONCRETE', theme: 'brick' },
  { id: 'perim_west', minX: -39, maxX: -38, minY: 0, maxY: WALL_TOP, minZ: -35, maxZ: 39, material: 'CONCRETE', theme: 'brick' },
  { id: 'perim_east', minX: 38, maxX: 39, minY: 0, maxY: WALL_TOP, minZ: -35, maxZ: 39, material: 'CONCRETE', theme: 'brick' },

  // =========================================================================
  // 2. MAIN OFFICE INTERIOR FLOOR SLAB (y = 0.0 -> 1.4m, z in [-12, 38])
  // =========================================================================
  { id: 'deck_office_main', minX: -38, maxX: 38, minY: 0.0, maxY: F, minZ: -12, maxZ: 38, material: 'CONCRETE', theme: 'office_floor' },

  // =========================================================================
  // 3. THREE STAIRCASES: SNOW COURTYARD & GARAGE (0.0m) -> OFFICE FLOOR (1.4m)
  //    4 steps x 0.35m rise (strictly <= 0.42m STEP_HEIGHT), z in [-16, -12]
  // =========================================================================
  ...buildStairs('long_entry', 'z', -16, -12, -33, -27, 0.0, F, 4, 'concrete'),
  ...buildStairs('front_entry', 'z', -16, -12, -5, 5, 0.0, F, 4, 'concrete'),
  ...buildStairs('garage_entry', 'z', -16, -12, 23, 29, 0.0, F, 4, 'garage'),

  // =========================================================================
  // 4. EXTERIOR OFFICE FRONT FACADE (z in [-12.6, -12.0])
  //    3 Wide Entry Portals aligned with stairs: [-33,-27], [-5,5], [23,29]
  // =========================================================================
  { id: 'facade_west_end', minX: -38, maxX: -33, minY: 0, maxY: WALL_TOP, minZ: -12.6, maxZ: -12.0, material: 'CONCRETE', theme: 'brick' },
  { id: 'facade_west_mid', minX: -27, maxX: -5, minY: 0, maxY: WALL_TOP, minZ: -12.6, maxZ: -12.0, material: 'CONCRETE', theme: 'brick' },
  { id: 'facade_east_mid', minX: 5, maxX: 23, minY: 0, maxY: WALL_TOP, minZ: -12.6, maxZ: -12.0, material: 'CONCRETE', theme: 'brick' },
  { id: 'facade_east_end', minX: 29, maxX: 38, minY: 0, maxY: WALL_TOP, minZ: -12.6, maxZ: -12.0, material: 'CONCRETE', theme: 'brick' },

  // =========================================================================
  // 5. SNOW COURTYARD & GARAGE COVER (Tier 0, y = 0.0m, z in [-34, -12.6])
  // =========================================================================
  // Courtyard / Garage dividing concrete wall (x in [14.0, 15.0]) with wide bay opening z in [-30, -21]
  { id: 'garage_div_north', minX: 14.0, maxX: 15.0, minY: 0, maxY: WALL_TOP, minZ: -34, maxZ: -30, material: 'CONCRETE', theme: 'garage' },
  { id: 'garage_div_south', minX: 14.0, maxX: 15.0, minY: 0, maxY: WALL_TOP, minZ: -21, maxZ: -12.6, material: 'CONCRETE', theme: 'garage' },
  // Iconic CS_OFFICE Blue Delivery Van (METAL_SHEET — penetrable by rifles!)
  { id: 'courtyard_van', minX: -19.5, maxX: -14.5, minY: 0, maxY: 2.45, minZ: -28.0, maxZ: -22.0, material: 'METAL_SHEET', theme: 'metal' },
  // Snow Courtyard Timber Shipping Crates (WOOD_THIN)
  { id: 'courtyard_crates', minX: 6.5, maxX: 9.8, minY: 0, maxY: 1.85, minZ: -26.5, maxZ: -23.5, material: 'WOOD_THIN', theme: 'wood' },
  // Courtyard Metal Dumpster near West Entry (METAL_SHEET)
  { id: 'courtyard_dumpster', minX: -35.5, maxX: -33.2, minY: 0, maxY: 1.55, minZ: -24.5, maxZ: -21.5, material: 'METAL_SHEET', theme: 'metal' },
  // Garage Tool Pillar & Metal Shutter Partition
  { id: 'garage_pillar', minX: 24.5, maxX: 27.0, minY: 0, maxY: WALL_TOP, minZ: -26.5, maxZ: -24.0, material: 'CONCRETE', theme: 'garage' },
  { id: 'garage_crates', minX: 32.5, maxX: 35.8, minY: 0, maxY: 1.75, minZ: -22.5, maxZ: -19.5, material: 'WOOD_THIN', theme: 'wood' },

  // =========================================================================
  // 6. SNIPER WINDOW MEZZANINE OVERLOOK (Tier 2, y = 3.5m) & INTERIOR STAIRS
  //    Platform: x in [-7, 7], z in [-11.5, -8.5], y in [3.3, 3.5] (1.90m clear headroom)
  //    West Stairs: x in [-13, -7], East Stairs: x in [7, 13], 6 x 0.35m steps
  // =========================================================================
  { id: 'sniper_mezz_deck', minX: -7, maxX: 7, minY: 3.3, maxY: U, minZ: -11.5, maxZ: -8.5, material: 'CONCRETE', theme: 'office_floor' },
  ...buildStairs('mezz_west', 'x', -13, -7, -11.2, -8.8, F, U, 6, 'wood'),
  ...buildStairs('mezz_east', 'x', 13, 7, -11.2, -8.8, F, U, 6, 'wood'),

  // =========================================================================
  // 7. INTERIOR OFFICE DRYWALL PARTITIONS (Wallbangable CS_OFFICE Drywall!)
  // =========================================================================
  // A. Long Hall East Wall (x in [-24.6, -24.0], separating Long Hall from Front/Paper/Back)
  //    Openings: [-11,-6.5] (Front entry), [0, 5.5] (Paper Room B door), [18, 24] (Back Way)
  { id: 'long_wall_1', minX: -24.6, maxX: -24.0, minY: F, maxY: WALL_TOP, minZ: -6.5, maxZ: 0.0, material: 'DRYWALL', theme: 'drywall' },
  { id: 'long_wall_2', minX: -24.6, maxX: -24.0, minY: F, maxY: WALL_TOP, minZ: 5.5, maxZ: 18.0, material: 'DRYWALL', theme: 'drywall' },
  { id: 'long_wall_3', minX: -24.6, maxX: -24.0, minY: F, maxY: WALL_TOP, minZ: 24.0, maxZ: 31.0, material: 'DRYWALL', theme: 'drywall' },

  // B. Front Hall / Interior Divider (z in [-3.6, -3.0])
  //    Openings: [-17,-11] (Paper North), [-2.5, 2.5] (Main Hall Center), [16, 21] (Conference North)
  { id: 'front_div_w', minX: -24.0, maxX: -17.0, minY: F, maxY: WALL_TOP, minZ: -3.6, maxZ: -3.0, material: 'DRYWALL', theme: 'drywall' },
  { id: 'front_div_cl', minX: -11.0, maxX: -2.5, minY: F, maxY: WALL_TOP, minZ: -3.6, maxZ: -3.0, material: 'DRYWALL', theme: 'drywall' },
  { id: 'front_div_cr', minX: 2.5, maxX: 16.0, minY: F, maxY: WALL_TOP, minZ: -3.6, maxZ: -3.0, material: 'DRYWALL', theme: 'drywall' },
  { id: 'front_div_e', minX: 21.0, maxX: 23.0, minY: F, maxY: WALL_TOP, minZ: -3.6, maxZ: -3.0, material: 'DRYWALL', theme: 'drywall' },

  // C. Paper Room (Bombsite B) / Main Hall Wall (x in [-6.6, -6.0])
  //    Opening: z in [2.5, 8.0] (Paper Connector to Main Hall)
  { id: 'paper_east_n', minX: -6.6, maxX: -6.0, minY: F, maxY: WALL_TOP, minZ: -3.0, maxZ: 2.5, material: 'DRYWALL', theme: 'drywall' },
  { id: 'paper_east_s', minX: -6.6, maxX: -6.0, minY: F, maxY: WALL_TOP, minZ: 8.0, maxZ: 15.0, material: 'DRYWALL', theme: 'drywall' },

  // D. Paper Room South Wall (z in [14.4, 15.0]) — Opening x in [-17.5, -11.5] to Back Way
  { id: 'paper_south_w', minX: -24.0, maxX: -17.5, minY: F, maxY: WALL_TOP, minZ: 14.4, maxZ: 15.0, material: 'DRYWALL', theme: 'drywall' },
  { id: 'paper_south_e', minX: -11.5, maxX: -6.0, minY: F, maxY: WALL_TOP, minZ: 14.4, maxZ: 15.0, material: 'DRYWALL', theme: 'drywall' },

  // E. Main Hall / Projector-Conference (Bombsite A) Wall (x in [11.4, 12.0])
  //    Openings: z in [2.0, 8.0] (Main -> Conference), z in [16.5, 22.0] (Main -> Kitchen)
  { id: 'conf_west_n', minX: 11.4, maxX: 12.0, minY: F, maxY: WALL_TOP, minZ: -3.0, maxZ: 2.0, material: 'DRYWALL', theme: 'drywall' },
  { id: 'conf_west_m', minX: 11.4, maxX: 12.0, minY: F, maxY: WALL_TOP, minZ: 8.0, maxZ: 16.5, material: 'DRYWALL', theme: 'drywall' },
  { id: 'conf_west_s', minX: 11.4, maxX: 12.0, minY: F, maxY: WALL_TOP, minZ: 22.0, maxZ: 28.0, material: 'DRYWALL', theme: 'drywall' },

  // F. Conference / Kitchen South Wall (z in [13.4, 14.0]) — Opening x in [21.5, 27.5]
  { id: 'conf_south_w', minX: 12.0, maxX: 21.5, minY: F, maxY: WALL_TOP, minZ: 13.4, maxZ: 14.0, material: 'DRYWALL', theme: 'drywall' },
  { id: 'conf_south_e', minX: 27.5, maxX: 38.0, minY: F, maxY: WALL_TOP, minZ: 13.4, maxZ: 14.0, material: 'DRYWALL', theme: 'drywall' },

  // G. T Back Office / Main Hall Divider (z in [25.0, 25.6])
  //    Openings: x in [-16, -9] (West Back Office), x in [0, 7] (Center T Exit), x in [21, 28] (Kitchen T Exit)
  { id: 't_div_w', minX: -24.0, maxX: -16.0, minY: F, maxY: WALL_TOP, minZ: 25.0, maxZ: 25.6, material: 'DRYWALL', theme: 'drywall' },
  { id: 't_div_m', minX: -9.0, maxX: 0.0, minY: F, maxY: WALL_TOP, minZ: 25.0, maxZ: 25.6, material: 'DRYWALL', theme: 'drywall' },
  { id: 't_div_e', minX: 7.0, maxX: 21.0, minY: F, maxY: WALL_TOP, minZ: 25.0, maxZ: 25.6, material: 'DRYWALL', theme: 'drywall' },
  { id: 't_div_far_e', minX: 28.0, maxX: 38.0, minY: F, maxY: WALL_TOP, minZ: 25.0, maxZ: 25.6, material: 'DRYWALL', theme: 'drywall' },

  // =========================================================================
  // 8. TACTICAL OFFICE COVER PROPS (Desks, Paper Stacks, Filing Cabinets, Vending)
  // =========================================================================
  // Front Hall Wooden Reception Desk (WOOD_THIN, offset west of central lane)
  { id: 'reception_desk', minX: -6.4, maxX: -2.2, minY: F, maxY: F + 1.15, minZ: -6.6, maxZ: -5.3, material: 'WOOD_THIN', theme: 'wood' },

  // Long Hall Office Copier & Partition Cover
  { id: 'long_hall_copier', minX: -36.0, maxX: -33.6, minY: F, maxY: F + 1.45, minZ: 2.0, maxZ: 5.0, material: 'METAL_SHEET', theme: 'metal' },
  { id: 'long_hall_desk', minX: -36.0, maxX: -33.8, minY: F, maxY: F + 1.15, minZ: 14.0, maxZ: 17.5, material: 'WOOD_THIN', theme: 'wood' },

  // Bombsite B (Paper Room) Iconic Stacked Copy Paper Crates (WOOD_THIN) & Cubicle Wall
  { id: 'paper_stack_center', minX: -19.2, maxX: -16.8, minY: F, maxY: F + 1.6, minZ: 3.8, maxZ: 6.4, material: 'WOOD_THIN', theme: 'wood' },
  { id: 'paper_cubicle_wall', minX: -11.2, maxX: -10.5, minY: F, maxY: F + 1.75, minZ: 7.5, maxZ: 11.2, material: 'DRYWALL', theme: 'drywall' },

  // Main Hall Central Office Island Desk, Structural Sightline Pillar & Soda Vending Machine
  { id: 'main_hall_island', minX: 1.0, maxX: 4.8, minY: F, maxY: F + 1.1, minZ: 8.5, maxZ: 10.6, material: 'WOOD_THIN', theme: 'wood' },
  { id: 'main_hall_pillar', minX: 0.6, maxX: 4.8, minY: F, maxY: WALL_TOP, minZ: 9.2, maxZ: 10.0, material: 'CONCRETE', theme: 'drywall' },
  { id: 'main_hall_vending', minX: -5.8, maxX: -4.0, minY: F, maxY: F + 2.1, minZ: 16.2, maxZ: 18.2, material: 'METAL_SHEET', theme: 'metal' },

  // Bombsite A (Projector / Conference Room) Conference Table & Metal Filing Cabinets
  { id: 'conf_table', minX: 22.0, maxX: 27.2, minY: F, maxY: F + 1.05, minZ: 3.2, maxZ: 5.4, material: 'WOOD_THIN', theme: 'wood' },
  { id: 'conf_cabinets', minX: 34.5, maxX: 37.0, minY: F, maxY: F + 1.85, minZ: 1.0, maxZ: 5.0, material: 'METAL_SHEET', theme: 'metal' },
  { id: 'storage_rack', minX: 34.2, maxX: 37.0, minY: F, maxY: F + 2.1, minZ: -9.0, maxZ: -6.2, material: 'METAL_SHEET', theme: 'metal' },

  // Kitchen Counter & Back Office Executive Desk
  { id: 'kitchen_counter', minX: 14.5, maxX: 18.5, minY: F, maxY: F + 1.15, minZ: 18.2, maxZ: 20.0, material: 'WOOD_THIN', theme: 'wood' },
  { id: 't_spawn_desk', minX: -3.5, maxX: 1.5, minY: F, maxY: F + 1.1, minZ: 28.5, maxZ: 30.2, material: 'WOOD_THIN', theme: 'wood' },
];

export const CS_OFFICE_COLLIDERS: AABBCollider[] = CS_OFFICE_BLOCKS;

export const BOMBSITES = {
  A: {
    name: 'A' as const,
    center: { x: 22.5, y: F, z: -1.5 },
    radius: 5.5,
  },
  B: {
    name: 'B' as const,
    center: { x: -14.5, y: F, z: 2.5 },
    radius: 5.5,
  },
};

export const SPAWN_POINTS = {
  /** Vanguard (CT) Spawn — Snowy Front Courtyard facing South (+Z) into Office */
  VANGUARD_CT: { x: 0.0, y: 0.0, z: -18.5 },
  /** Syndicate (T) Spawn — South Back Office facing North (-Z) */
  OBSIDIAN_T: { x: 0.0, y: F, z: 36.2 },
};

export const SPAWN_ZONES = {
  VANGUARD_BUY_ZONE: { minX: -24, maxX: 28, minZ: -33, maxZ: -17 },
  SYNDICATE_BUY_ZONE: { minX: -24, maxX: 28, minZ: 27, maxZ: 37 },
};

/**
 * 18 Distinct Competitive CS_OFFICE Callout Zones across all 3 elevation tiers
 */
export const CALLOUT_ZONES: CalloutZone[] = [
  // Tier 2 Overlook (+3.5m) checked first
  { name: 'SNIPER WINDOW', minX: -13, maxX: 13, minZ: -12, maxZ: -7, minY: 2.8, maxY: 6.5 },

  // Tier 0 Outdoor Courtyard & Garage (y = 0.0m)
  { name: 'GARAGE', minX: 14.5, maxX: 38, minZ: -34, maxZ: -12, minY: -0.5, maxY: 3.5 },
  { name: 'CT COURTYARD', minX: -38, maxX: 14.5, minZ: -34, maxZ: -16, minY: -0.5, maxY: 3.5 },
  { name: 'FRONT STAIRS', minX: -7, maxX: 7, minZ: -16.5, maxZ: -11.5, minY: -0.5, maxY: 3.5 },
  { name: 'GARAGE STAIRS', minX: 21, maxX: 31, minZ: -16.5, maxZ: -11.5, minY: -0.5, maxY: 3.5 },

  // Tier 1 Indoor CS_OFFICE Rooms (y = 1.4m)
  { name: 'PROJECTOR ROOM', minX: 12, maxX: 38, minZ: -3, maxZ: 6.5 },
  { name: 'CONFERENCE HALL', minX: 12, maxX: 38, minZ: 6.5, maxZ: 14 },
  { name: 'PAPER ROOM', minX: -24, maxX: -6, minZ: -3, maxZ: 14.5 },
  { name: 'LONG HALL', minX: -38, maxX: -24, minZ: -16, maxZ: 26 },
  { name: 'STORAGE', minX: 22, maxX: 38, minZ: -12, maxZ: -3 },
  { name: 'SIDE HALL', minX: 12, maxX: 22, minZ: -12, maxZ: -3 },
  { name: 'RECEPTION', minX: -6, maxX: 6, minZ: -7.5, maxZ: -3 },
  { name: 'FRONT HALL', minX: -24, maxX: 12, minZ: -12, maxZ: -3 },
  { name: 'MAIN HALL', minX: -6, maxX: 12, minZ: -3, maxZ: 25 },
  { name: 'KITCHEN', minX: 12, maxX: 38, minZ: 14, maxZ: 25 },
  { name: 'BACK WAY', minX: -38, maxX: -6, minZ: 14.5, maxZ: 25 },
  { name: 'T BACK OFFICE', minX: -38, maxX: 38, minZ: 25, maxZ: 38 },
  { name: 'OFFICE COMPLEX', minX: -38, maxX: 38, minZ: -34, maxZ: 38 },
];

export function getCalloutName(x: number, y: number, z: number): string {
  for (const zone of CALLOUT_ZONES) {
    if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) {
      if (zone.minY !== undefined && y < zone.minY) continue;
      if (zone.maxY !== undefined && y > zone.maxY) continue;
      return zone.name;
    }
  }
  return 'OFFICE COMPLEX';
}

/**
 * 9 Tactical Bots (4 Vanguard CTs + 5 Syndicate Ts) forming full 5v5 on CS_OFFICE
 * Every spawn coordinate has >= 1.5m wall clearance and solid floor support.
 */
export const TACTICAL_BOTS: TacticalBotConfig[] = [
  // 4 Allied Vanguard Defenders (Snowy Courtyard & Garage)
  {
    id: 'van-alpha',
    name: 'Vanguard-Alpha',
    team: 'Vanguard',
    waypoints: [
      { x: 18.0, y: 0.0, z: -25.0 },
      { x: 26.0, y: F, z: -8.0 },
      { x: 24.5, y: F, z: 0.5 },
    ],
  },
  {
    id: 'van-bravo',
    name: 'Vanguard-Bravo',
    team: 'Vanguard',
    waypoints: [
      { x: 3.0, y: 0.0, z: -21.0 },
      { x: 0.0, y: F, z: -10.0 },
      { x: 18.5, y: F, z: 0.0 },
    ],
  },
  {
    id: 'van-charlie',
    name: 'Vanguard-Charlie',
    team: 'Vanguard',
    waypoints: [
      { x: -8.0, y: 0.0, z: -21.0 },
      { x: 0.0, y: F, z: -2.0 },
      { x: 2.0, y: F, z: 4.0 },
    ],
  },
  {
    id: 'van-delta',
    name: 'Vanguard-Delta',
    team: 'Vanguard',
    waypoints: [
      { x: -24.0, y: 0.0, z: -21.0 },
      { x: -30.0, y: F, z: -8.0 },
      { x: -14.5, y: F, z: 2.5 },
    ],
  },

  // 5 Enemy Syndicate Attackers (South Back Office)
  {
    id: 'syn-1',
    name: 'Syndicate-Viper',
    team: 'Syndicate',
    waypoints: [
      { x: -12.0, y: F, z: 33.5 },
      { x: -30.0, y: F, z: 21.0 },
      { x: -14.5, y: F, z: 2.5 },
    ],
  },
  {
    id: 'syn-2',
    name: 'Syndicate-Specter',
    team: 'Syndicate',
    waypoints: [
      { x: -5.0, y: F, z: 34.5 },
      { x: -14.5, y: F, z: 19.5 },
      { x: -14.5, y: F, z: 2.5 },
    ],
  },
  {
    id: 'syn-3',
    name: 'Syndicate-Kobra',
    team: 'Syndicate',
    waypoints: [
      { x: 4.0, y: F, z: 34.5 },
      { x: 3.5, y: F, z: 21.0 },
      { x: 3.5, y: F, z: 4.0 },
    ],
  },
  {
    id: 'syn-4',
    name: 'Syndicate-Reaper',
    team: 'Syndicate',
    waypoints: [
      { x: 14.0, y: F, z: 33.5 },
      { x: 24.5, y: F, z: 21.0 },
      { x: 24.5, y: F, z: 0.5 },
    ],
  },
  {
    id: 'syn-5',
    name: 'Syndicate-Nomad',
    team: 'Syndicate',
    waypoints: [
      { x: 24.0, y: F, z: 33.5 },
      { x: 24.5, y: F, z: 18.0 },
      { x: 24.5, y: F, z: 8.5 },
    ],
  },
];
