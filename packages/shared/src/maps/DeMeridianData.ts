import type { AABBCollider, MapBounds } from '../physics/KinematicPlayerController.js';

export type SurfaceMaterial = 'CONCRETE' | 'WOOD_THIN' | 'DRYWALL' | 'METAL_SHEET';

export interface SurfaceMaterialProps {
  mu: number;
  cost: number;
  maxThickness: number;
  isImpenetrable: boolean;
}

export const SURFACE_MATERIALS: Record<SurfaceMaterial, SurfaceMaterialProps> = {
  CONCRETE: { mu: 0.0, cost: 999, maxThickness: 0, isImpenetrable: true },
  WOOD_THIN: { mu: 0.75, cost: 10, maxThickness: 2.0, isImpenetrable: false },
  DRYWALL: { mu: 0.70, cost: 12, maxThickness: 1.5, isImpenetrable: false },
  METAL_SHEET: { mu: 0.45, cost: 22, maxThickness: 1.0, isImpenetrable: false },
};

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MapBlockCollider {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  material: SurfaceMaterial;
  /** Visual architectural theme hint for procedural PBR material assignment */
  theme?: 'sanctum' | 'aqueduct' | 'foundry' | 'deck' | 'neutral';
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
 * DE_MERIDIAN — 94m × 90m Golden Figure-8 Competitive 5v5 Arena
 * Engine-safe 3-tier verticality (y >= 0 invariant):
 *  - Tier 0 (y = 0.0m): Sunken Aqueduct Underpass
 *  - Tier 1 (y = +2.1m): Main Map Deck (Sanctum A, Mid Courtyard, Foundry B)
 *  - Tier 2 (y = +4.9m): 4 Interconnected Overlooks (A Palace, A Heaven, Mid CT Nest, B Apartments)
 */
export const DE_MERIDIAN_BOUNDS: MapBounds = {
  minX: -47,
  maxX: 47,
  minZ: -45,
  maxZ: 45,
};

export const DE_MERIDIAN_DECK_Y = 2.1;
export const DE_MERIDIAN_UPPER_Y = 4.9;

function makeBox(
  id: string,
  cx: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  baseY = 0,
  material: SurfaceMaterial = 'CONCRETE',
  theme: MapBlockCollider['theme'] = 'neutral'
): MapBlockCollider {
  return {
    id,
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minY: baseY,
    maxY: baseY + h,
    minZ: cz - d / 2,
    maxZ: cz + d / 2,
    material,
    theme,
  };
}

function makeBoundsBox(
  id: string,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  material: SurfaceMaterial = 'CONCRETE',
  theme: MapBlockCollider['theme'] = 'neutral'
): MapBlockCollider {
  return { id, minX, maxX, minY, maxY, minZ, maxZ, material, theme };
}

function buildLinearStairs(opts: {
  idPrefix: string;
  steps: number;
  stepRise: number;
  stepRun: number;
  baseY: number;
  axis: 'x' | 'z';
  ascendDir: 1 | -1;
  startCoord: number;
  crossMin: number;
  crossMax: number;
  theme: MapBlockCollider['theme'];
}): MapBlockCollider[] {
  const result: MapBlockCollider[] = [];
  for (let i = 0; i < opts.steps; i++) {
    const h = (i + 1) * opts.stepRise;
    const c0 = opts.startCoord + opts.ascendDir * i * opts.stepRun;
    const c1 = opts.startCoord + opts.ascendDir * (i + 1) * opts.stepRun;
    const minC = Math.min(c0, c1);
    const maxC = Math.max(c0, c1);
    if (opts.axis === 'z') {
      result.push(
        makeBoundsBox(
          `${opts.idPrefix}_${i}`,
          opts.crossMin,
          opts.crossMax,
          opts.baseY,
          opts.baseY + h,
          minC,
          maxC,
          'CONCRETE',
          opts.theme
        )
      );
    } else {
      result.push(
        makeBoundsBox(
          `${opts.idPrefix}_${i}`,
          minC,
          maxC,
          opts.baseY,
          opts.baseY + h,
          opts.crossMin,
          opts.crossMax,
          'CONCRETE',
          opts.theme
        )
      );
    }
  }
  return result;
}

const DECK_Y = DE_MERIDIAN_DECK_Y;
const UPPER_Y = DE_MERIDIAN_UPPER_Y;

export const DE_MERIDIAN_BLOCKS: MapBlockCollider[] = [
  // =========================================================================
  // 1. MAIN MAP DECK FOUNDATION SLABS (y = 0.0 .. +2.1m, zero AABB overlaps)
  //    Frames the Sunken Aqueduct Underpass (x in [-3.5, 3.5], z in [-10, 20.8])
  //    and East Underpass Stair cutout (x in [3.5, 6.75], z in [-9.6, -6.4])
  // =========================================================================
  makeBoundsBox('deck_north', -47, 47, 0, DECK_Y, -45, -10.0, 'CONCRETE', 'deck'),
  makeBoundsBox('deck_south', -47, 47, 0, DECK_Y, 20.8, 45, 'CONCRETE', 'deck'),
  makeBoundsBox('deck_west', -47, -3.5, 0, DECK_Y, -10.0, 20.8, 'CONCRETE', 'deck'),
  makeBoundsBox('deck_east_outer', 6.75, 47, 0, DECK_Y, -10.0, 20.8, 'CONCRETE', 'deck'),
  makeBoundsBox('deck_east_underpass_south', 3.5, 6.75, 0, DECK_Y, -6.4, 20.8, 'CONCRETE', 'deck'),
  makeBoundsBox('deck_east_underpass_north', 3.5, 6.75, 0, DECK_Y, -10.0, -9.6, 'CONCRETE', 'deck'),

  // =========================================================================
  // 2. OUTER PERIMETER WALLS (94m × 90m airtight boundary above Deck)
  // =========================================================================
  makeBoundsBox('perimeter_north', -47, 47, DECK_Y, DECK_Y + 9.0, -45, -43.5, 'CONCRETE', 'neutral'),
  makeBoundsBox('perimeter_south', -47, 47, DECK_Y, DECK_Y + 9.0, 43.5, 45, 'CONCRETE', 'neutral'),
  makeBoundsBox('perimeter_west', -47, -45.5, DECK_Y, DECK_Y + 9.0, -43.5, 43.5, 'CONCRETE', 'sanctum'),
  makeBoundsBox('perimeter_east', 45.5, 47, DECK_Y, DECK_Y + 9.0, -43.5, 43.5, 'CONCRETE', 'foundry'),

  // =========================================================================
  // 3. NORTH CT SPAWN & ROTATION HALLS (Vanguard CT Spawn at 0, 2.1, -34)
  // =========================================================================
  makeBoundsBox('nw_corner_bldg', -45.5, -29.5, DECK_Y, DECK_Y + 7.2, -43.5, -33.5, 'CONCRETE', 'sanctum'),
  makeBoundsBox('ct_west_bldg', -28.5, -16.5, DECK_Y, DECK_Y + 6.8, -43.5, -37.5, 'CONCRETE', 'sanctum'),
  makeBoundsBox('ct_east_bldg', 17.0, 29.0, DECK_Y, DECK_Y + 6.8, -43.5, -37.5, 'CONCRETE', 'foundry'),
  makeBoundsBox('ne_corner_bldg', 30.5, 45.5, DECK_Y, DECK_Y + 7.2, -43.5, -33.5, 'CONCRETE', 'foundry'),

  // CT Spawn tactical cover block (north of spawn point)
  makeBoundsBox('ct_spawn_cover', -2.2, 2.2, DECK_Y, DECK_Y + 2.6, -38.4, -36.4, 'CONCRETE', 'aqueduct'),

  // Twin Mid-North concrete pillars separating CT-A / Mid Nest / CT-B lanes (3.5m arch behind Mid Nest)
  makeBoundsBox('ct_mid_west_pillar', -10.5, -7.0, DECK_Y, DECK_Y + 6.6, -30.0, -22.0, 'CONCRETE', 'sanctum'),
  makeBoundsBox('ct_mid_east_pillar', 7.0, 11.2, DECK_Y, DECK_Y + 6.6, -30.0, -22.0, 'CONCRETE', 'foundry'),

  // B Market wallbangable timber door panel (leaves clean 2.9m north & 2.4m south passages)
  makeBoundsBox('b_market_wood_door', 17.3, 17.7, DECK_Y, DECK_Y + 3.2, -34.6, -31.8, 'WOOD_THIN', 'foundry'),

  // =========================================================================
  // 4. BOMBSITE A — "THE SANCTUM" (North-West, Warm Travertine & Terracotta)
  // =========================================================================
  // A Heaven Elevated Overlook (y = +4.9m) + 1.10m head-glitch rail + East & West stairs
  makeBoundsBox('a_heaven_deck', -26.0, -17.0, DECK_Y, UPPER_Y, -31.0, -26.5, 'CONCRETE', 'sanctum'),
  makeBoundsBox('a_heaven_rail', -26.0, -17.0, UPPER_Y, UPPER_Y + 1.1, -26.75, -26.5, 'METAL_SHEET', 'sanctum'),
  ...buildLinearStairs({
    idPrefix: 'a_heaven_stairs',
    steps: 7,
    stepRise: 0.35,
    stepRun: 0.55,
    baseY: DECK_Y,
    axis: 'x',
    ascendDir: -1,
    startCoord: -13.15,
    crossMin: -30.6,
    crossMax: -26.9,
    theme: 'sanctum',
  }),
  ...buildLinearStairs({
    idPrefix: 'a_heaven_west_stairs',
    steps: 7,
    stepRise: 0.35,
    stepRun: 0.55,
    baseY: DECK_Y,
    axis: 'x',
    ascendDir: 1,
    startCoord: -29.85,
    crossMin: -30.6,
    crossMax: -27.2,
    theme: 'sanctum',
  }),

  // CT Ticket Booth (DRYWALL wallbangable cover north of A Heaven)
  makeBoundsBox('a_ct_ticket', -21.2, -18.2, DECK_Y, DECK_Y + 2.5, -34.6, -32.2, 'DRYWALL', 'sanctum'),

  // A Firebox (Molotov-flushable corner pocket)
  makeBoundsBox('a_firebox', -39.5, -36.5, DECK_Y, DECK_Y + 2.4, -26.5, -23.5, 'CONCRETE', 'sanctum'),

  // A Triple Stack (WOOD_THIN plant cover + 1.30m solo crouch-jumpable skill box)
  makeBoundsBox('a_triple_tall', -27.8, -25.4, DECK_Y, DECK_Y + 2.35, -19.8, -17.2, 'WOOD_THIN', 'sanctum'),
  makeBoundsBox('a_triple_jump', -30.4, -28.6, DECK_Y, DECK_Y + 1.3, -18.0, -16.4, 'WOOD_THIN', 'sanctum'),

  // A Tetris (1.30m solo crouch-jumpable box inside A Main exit)
  makeBoundsBox('a_tetris', -34.2, -32.2, DECK_Y, DECK_Y + 1.3, -12.0, -10.2, 'WOOD_THIN', 'sanctum'),

  // A Main Choke Wall (6.2m smokeable aperture at x in [-36.5, -30.3])
  makeBoundsBox('a_main_west_pillar', -38.5, -36.5, DECK_Y, DECK_Y + 6.4, -8.0, -5.0, 'CONCRETE', 'sanctum'),
  makeBoundsBox('a_main_mid_wall', -30.3, -16.0, DECK_Y, DECK_Y + 6.4, -8.0, -5.0, 'CONCRETE', 'sanctum'),

  // A Palace Elevated Overlook (y = +4.9m) + interior DRYWALL screen + South & North stairs
  makeBoundsBox('a_palace_deck', -45.5, -38.5, DECK_Y, UPPER_Y, -5.0, 15.0, 'CONCRETE', 'sanctum'),
  makeBoundsBox('a_palace_parapet', -45.5, -42.0, UPPER_Y, UPPER_Y + 1.05, -5.0, -4.75, 'CONCRETE', 'sanctum'),
  makeBoundsBox('a_palace_drywall', -38.5, -38.1, DECK_Y, DECK_Y + 5.8, -2.0, 12.5, 'DRYWALL', 'sanctum'),
  ...buildLinearStairs({
    idPrefix: 'a_palace_stairs',
    steps: 7,
    stepRise: 0.35,
    stepRun: 0.55,
    baseY: DECK_Y,
    axis: 'z',
    ascendDir: -1,
    startCoord: 18.85,
    crossMin: -44.8,
    crossMax: -39.2,
    theme: 'sanctum',
  }),
  ...buildLinearStairs({
    idPrefix: 'a_palace_north_stairs',
    steps: 7,
    stepRise: 0.35,
    stepRun: 0.55,
    baseY: DECK_Y,
    axis: 'z',
    ascendDir: 1,
    startCoord: -8.85,
    crossMin: -41.8,
    crossMax: -39.0,
    theme: 'sanctum',
  }),

  // =========================================================================
  // 5. MID — "THE SUNKEN AQUEDUCT" (3-Tier Center: y=0.0, y=+2.1, y=+4.9)
  // =========================================================================
  // CT Mid Sniper Nest ("Window", y = +4.9m) + 1.05m head-glitch sill (5.8m aperture) + West & East stairs
  makeBoundsBox('mid_nest_deck', -4.5, 4.5, DECK_Y, UPPER_Y, -19.5, -14.0, 'CONCRETE', 'aqueduct'),
  makeBoundsBox('mid_nest_sill', -2.9, 2.9, UPPER_Y, UPPER_Y + 1.05, -14.28, -14.0, 'METAL_SHEET', 'aqueduct'),
  makeBoundsBox('mid_nest_west_jamb', -4.5, -2.9, UPPER_Y, UPPER_Y + 3.4, -14.6, -14.0, 'CONCRETE', 'aqueduct'),
  makeBoundsBox('mid_nest_east_jamb', 2.9, 4.5, UPPER_Y, UPPER_Y + 3.4, -14.6, -14.0, 'CONCRETE', 'aqueduct'),
  ...buildLinearStairs({
    idPrefix: 'mid_nest_stairs',
    steps: 7,
    stepRise: 0.35,
    stepRun: 0.55,
    baseY: DECK_Y,
    axis: 'x',
    ascendDir: 1,
    startCoord: -8.35,
    crossMin: -18.5,
    crossMax: -15.0,
    theme: 'aqueduct',
  }),
  ...buildLinearStairs({
    idPrefix: 'mid_nest_east_stairs',
    steps: 7,
    stepRise: 0.35,
    stepRun: 0.55,
    baseY: DECK_Y,
    axis: 'x',
    ascendDir: -1,
    startCoord: 8.35,
    crossMin: -18.5,
    crossMax: -15.0,
    theme: 'aqueduct',
  }),

  // Sunken Aqueduct Underpass Stairs (y = 0.0 -> +2.1m, 5 steps × 0.35m + deck lip)
  ...buildLinearStairs({
    idPrefix: 'underpass_stairs_south',
    steps: 5,
    stepRise: 0.35,
    stepRun: 0.65,
    baseY: 0,
    axis: 'z',
    ascendDir: 1,
    startCoord: 17.55,
    crossMin: -3.5,
    crossMax: 3.5,
    theme: 'aqueduct',
  }),
  ...buildLinearStairs({
    idPrefix: 'underpass_stairs_east',
    steps: 5,
    stepRise: 0.35,
    stepRun: 0.65,
    baseY: 0,
    axis: 'x',
    ascendDir: 1,
    startCoord: 3.5,
    crossMin: -9.6,
    crossMax: -6.4,
    theme: 'aqueduct',
  }),

  // Mid lane framing walls (A Connector 6.0m north gap, B Short 5.8m north gap)
  makeBoundsBox('mid_west_wall', -15.0, -10.5, DECK_Y, DECK_Y + 6.2, -5.0, 4.5, 'CONCRETE', 'aqueduct'),
  makeBoundsBox('mid_east_wall', 10.5, 15.0, DECK_Y, DECK_Y + 6.2, -5.0, 4.5, 'CONCRETE', 'aqueduct'),
  makeBoundsBox('b_short_north_pier', 11.2, 15.0, DECK_Y, DECK_Y + 6.2, -13.6, -10.8, 'CONCRETE', 'foundry'),

  // Mid Courtyard & Top Mid cover props
  makeBoundsBox('mid_aqueduct_cart', 3.9, 6.2, DECK_Y, DECK_Y + 1.75, 4.5, 9.0, 'WOOD_THIN', 'aqueduct'),
  makeBoundsBox('mid_west_crate', -7.6, -5.8, DECK_Y, DECK_Y + 1.45, 1.8, 3.6, 'CONCRETE', 'aqueduct'),
  makeBoundsBox('top_mid_box', -6.2, -3.7, DECK_Y, DECK_Y + 1.85, 18.6, 21.2, 'WOOD_THIN', 'aqueduct'),

  // =========================================================================
  // 6. BOMBSITE B — "THE FOUNDRY" (North-East, Industrial Steel & Teal)
  // =========================================================================
  // B Foundry Steel Core (METAL_SHEET) & Forklift (METAL_SHEET)
  makeBoundsBox('b_foundry_core', 27.2, 30.2, DECK_Y, DECK_Y + 2.5, -19.4, -16.6, 'METAL_SHEET', 'foundry'),
  makeBoundsBox('b_forklift', 33.4, 35.8, DECK_Y, DECK_Y + 2.0, -15.2, -11.6, 'METAL_SHEET', 'foundry'),

  // B Control Booth (DRYWALL wallbangable cover & Molotov pocket)
  makeBoundsBox('b_control_booth', 20.5, 24.0, DECK_Y, DECK_Y + 2.5, -26.5, -23.5, 'DRYWALL', 'foundry'),

  // B Bench (1.30m solo crouch-jumpable skill box & Molotov pocket)
  makeBoundsBox('b_bench', 32.5, 36.5, DECK_Y, DECK_Y + 1.3, -31.0, -29.2, 'CONCRETE', 'foundry'),

  // B Lower Canal Choke Wall (6.0m smokeable aperture at x in [26.5, 32.5])
  makeBoundsBox('b_canal_west_wall', 15.5, 26.5, DECK_Y, DECK_Y + 6.4, -8.0, -5.0, 'CONCRETE', 'foundry'),
  makeBoundsBox('b_canal_east_wall', 32.5, 38.0, DECK_Y, DECK_Y + 6.4, -8.0, -5.0, 'CONCRETE', 'foundry'),
  makeBoundsBox('b_canal_box', 27.0, 29.4, DECK_Y, DECK_Y + 1.65, 2.0, 4.4, 'WOOD_THIN', 'foundry'),

  // B Apartments Elevated Overlook (y = +4.9m) + wallbangable WOOD_THIN shutter + South & North stairs
  makeBoundsBox('b_apps_deck', 38.0, 45.5, DECK_Y, UPPER_Y, -14.0, 14.0, 'CONCRETE', 'foundry'),
  makeBoundsBox('b_apps_shutter', 38.0, 38.4, UPPER_Y, UPPER_Y + 2.5, -13.5, -6.5, 'WOOD_THIN', 'foundry'),
  ...buildLinearStairs({
    idPrefix: 'b_apps_stairs',
    steps: 7,
    stepRise: 0.35,
    stepRun: 0.55,
    baseY: DECK_Y,
    axis: 'z',
    ascendDir: -1,
    startCoord: 17.85,
    crossMin: 38.8,
    crossMax: 44.8,
    theme: 'foundry',
  }),
  ...buildLinearStairs({
    idPrefix: 'b_apps_north_stairs',
    steps: 7,
    stepRise: 0.35,
    stepRun: 0.55,
    baseY: DECK_Y,
    axis: 'z',
    ascendDir: 1,
    startCoord: -17.85,
    crossMin: 39.2,
    crossMax: 42.4,
    theme: 'foundry',
  }),

  // =========================================================================
  // 7. SOUTHERN LANE DIVIDERS & SYNDICATE T SPAWN FRAMING (0% Empty Void)
  // =========================================================================
  makeBoundsBox('south_west_bldg', -31.0, -17.0, DECK_Y, DECK_Y + 6.6, 6.0, 22.0, 'CONCRETE', 'sanctum'),
  makeBoundsBox('south_east_bldg', 17.0, 31.0, DECK_Y, DECK_Y + 6.6, 6.0, 22.0, 'CONCRETE', 'foundry'),
  makeBoundsBox('t_lobby_west_box', -36.8, -34.2, DECK_Y, DECK_Y + 1.75, 7.0, 9.5, 'WOOD_THIN', 'sanctum'),
  makeBoundsBox('t_spawn_mid_wall', -6.5, 6.5, DECK_Y, DECK_Y + 3.9, 29.0, 32.5, 'CONCRETE', 'aqueduct'),
  makeBoundsBox('sw_corner_bldg', -45.5, -28.0, DECK_Y, DECK_Y + 6.8, 30.0, 43.5, 'CONCRETE', 'sanctum'),
  makeBoundsBox('se_corner_bldg', 28.0, 45.5, DECK_Y, DECK_Y + 6.8, 30.0, 43.5, 'CONCRETE', 'foundry'),

  // Low decorative side parapet along Aqueduct West edge (leaving drop zone z in [-5, +3] open!)
  makeBox('aqueduct_parapet_w_n', -3.7, -7.5, 0.4, 0.85, 4.6, DECK_Y, 'CONCRETE', 'aqueduct'),
  makeBox('aqueduct_parapet_w_s', -3.7, 10.5, 0.4, 0.85, 13.0, DECK_Y, 'CONCRETE', 'aqueduct'),
];

export const DE_MERIDIAN_COLLIDERS: AABBCollider[] = DE_MERIDIAN_BLOCKS.map((b) => ({
  minX: b.minX,
  maxX: b.maxX,
  minY: b.minY,
  maxY: b.maxY,
  minZ: b.minZ,
  maxZ: b.maxZ,
}));

export const BOMBSITES = {
  A: {
    id: 'A' as const,
    name: 'Bombsite A (The Sanctum)',
    center: { x: -29.5, y: DECK_Y, z: -21.0 },
    radius: 6.5,
  },
  B: {
    id: 'B' as const,
    name: 'Bombsite B (The Foundry)',
    center: { x: 29.5, y: DECK_Y, z: -21.0 },
    radius: 6.5,
  },
};

export const SPAWN_POINTS = {
  VANGUARD_CT: { x: 0, y: DECK_Y, z: -34.0 },
  OBSIDIAN_T: { x: 0, y: DECK_Y, z: 39.0 },
};

export const SPAWN_ZONES = {
  VANGUARD_BUY_ZONE: { minX: -17, maxX: 17, minZ: -44, maxZ: -26 },
  SYNDICATE_BUY_ZONE: { minX: -27, maxX: 27, minZ: 29, maxZ: 45 },
};

/**
 * 20 Elevation-Aware Tactical Callout Zones for DE_MERIDIAN
 * Checked top-down: Upper Overlooks (minY: 4.0) -> Sunken Aqueduct (maxY: 1.5) -> Main Deck
 */
export const CALLOUT_ZONES: CalloutZone[] = [
  // Tier 2 — Upper Overlooks (y >= 4.0m)
  { name: 'A PALACE', minX: -46, maxX: -38, minZ: -6, maxZ: 19, minY: 4.0 },
  { name: 'A HEAVEN', minX: -27, maxX: -13, minZ: -31.5, maxZ: -26, minY: 4.0 },
  { name: 'MID NEST', minX: -8.5, maxX: 5.0, minZ: -20, maxZ: -13.5, minY: 4.0 },
  { name: 'B APARTMENTS', minX: 37.5, maxX: 46, minZ: -14.5, maxZ: 18, minY: 4.0 },

  // Tier 0 — Sunken Aqueduct Underpass (y <= 1.5m)
  { name: 'SUNKEN AQUEDUCT', minX: -4.0, maxX: 7.0, minZ: -10.5, maxZ: 21.0, maxY: 1.5 },

  // Tier 1 — Main Deck Zones (y = +2.1m)
  { name: 'VANGUARD SPAWN', minX: -16.5, maxX: 16.5, minZ: -44, maxZ: -30 },
  { name: 'SYNDICATE SPAWN', minX: -28, maxX: 28, minZ: 30, maxZ: 45 },
  { name: 'CT TICKET', minX: -28, maxX: -11, minZ: -37.5, maxZ: -31 },
  { name: 'B MARKET', minX: 11, maxX: 29, minZ: -37.5, maxZ: -28.5 },
  { name: 'A FIREBOX', minX: -45.5, maxX: -36, minZ: -33.5, maxZ: -22 },
  { name: 'A SITE SANCTUM', minX: -45.5, maxX: -16, minZ: -33.5, maxZ: -8.0 },
  { name: 'A CONNECTOR', minX: -16.5, maxX: -6.5, minZ: -19.5, maxZ: -5.0 },
  { name: 'A MAIN', minX: -38.5, maxX: -29.5, minZ: -9.5, maxZ: 6.0 },
  { name: 'T-A LOBBY', minX: -45.5, maxX: -16.5, minZ: 6.0, maxZ: 30.0 },
  { name: 'B SITE FOUNDRY', minX: 15.5, maxX: 45.5, minZ: -33.5, maxZ: -8.0 },
  { name: 'B SHORT', minX: 6.5, maxX: 16.5, minZ: -19.5, maxZ: -5.0 },
  { name: 'B CANAL', minX: 24.0, maxX: 38.0, minZ: -9.5, maxZ: 6.0 },
  { name: 'T-B STAGING', minX: 16.5, maxX: 45.5, minZ: 6.0, maxZ: 30.0 },
  { name: 'MID COURTYARD', minX: -11.0, maxX: 11.0, minZ: -14.0, maxZ: 15.0 },
  { name: 'TOP MID', minX: -17.0, maxX: 17.0, minZ: 15.0, maxZ: 30.0 },
];

export function getCalloutName(x: number, y: number, z: number): string {
  for (const zDef of CALLOUT_ZONES) {
    if (x >= zDef.minX && x <= zDef.maxX && z >= zDef.minZ && z <= zDef.maxZ) {
      if (zDef.minY !== undefined && y < zDef.minY) continue;
      if (zDef.maxY !== undefined && y > zDef.maxY) continue;
      return zDef.name;
    }
  }
  return 'MERIDIAN SECTOR';
}

export const TACTICAL_BOTS: TacticalBotConfig[] = [
  // --- OBSIDIAN SYNDICATE (T — 5 Bots, South Spawn y = 2.1) ---
  {
    id: 'bot_syn_1',
    name: 'Viper',
    team: 'Syndicate',
    waypoints: [
      { x: -12, y: DECK_Y, z: 38 },
      { x: -33.5, y: DECK_Y, z: 16 },
      { x: -33.5, y: DECK_Y, z: -6.5 },
      { x: -31, y: DECK_Y, z: -21 },
    ],
  },
  {
    id: 'bot_syn_2',
    name: 'Specter',
    team: 'Syndicate',
    waypoints: [
      { x: -6, y: DECK_Y, z: 39 },
      { x: -12, y: DECK_Y, z: 25 },
      { x: -8, y: DECK_Y, z: 0 },
      { x: -13, y: DECK_Y, z: -11 },
    ],
  },
  {
    id: 'bot_syn_3',
    name: 'Kestrel',
    team: 'Syndicate',
    waypoints: [
      { x: 0, y: DECK_Y, z: 40 },
      { x: 0, y: DECK_Y, z: 24 },
      { x: 0, y: 0, z: 4 },
      { x: 13, y: DECK_Y, z: -8 },
    ],
  },
  {
    id: 'bot_syn_4',
    name: 'Ronin',
    team: 'Syndicate',
    waypoints: [
      { x: 6, y: DECK_Y, z: 39 },
      { x: 34, y: DECK_Y, z: 16 },
      { x: 30, y: DECK_Y, z: -6.5 },
      { x: 30, y: DECK_Y, z: -21 },
    ],
  },
  {
    id: 'bot_syn_5',
    name: 'Wraith',
    team: 'Syndicate',
    waypoints: [
      { x: 12, y: DECK_Y, z: 38 },
      { x: 42, y: DECK_Y, z: 22 },
      { x: 41.8, y: UPPER_Y, z: 4 },
      { x: 41.8, y: UPPER_Y, z: -12 },
    ],
  },
  // --- VANGUARD SECURITY (CT — 4 Bots + Local Player = 5v5, North Spawn y = 2.1) ---
  {
    id: 'bot_van_1',
    name: 'Aegis',
    team: 'Vanguard',
    waypoints: [
      { x: -10, y: DECK_Y, z: -34 },
      { x: -14, y: DECK_Y, z: -34 },
      { x: -24, y: DECK_Y, z: -35.5 },
      { x: -32, y: DECK_Y, z: -22 },
    ],
  },
  {
    id: 'bot_van_2',
    name: 'Sentinel',
    team: 'Vanguard',
    waypoints: [
      { x: -4.2, y: DECK_Y, z: -30.5 },
      { x: -12, y: DECK_Y, z: -28.8 },
      { x: -21, y: UPPER_Y, z: -28.8 },
      { x: -24, y: UPPER_Y, z: -28.8 },
    ],
  },
  {
    id: 'bot_van_3',
    name: 'Bastion',
    team: 'Vanguard',
    waypoints: [
      { x: 4.2, y: DECK_Y, z: -30.5 },
      { x: 5.2, y: DECK_Y, z: -20.7 },
      { x: 9.6, y: DECK_Y, z: -16.8 },
      { x: 0, y: UPPER_Y, z: -16.8 },
    ],
  },
  {
    id: 'bot_van_4',
    name: 'Paladin',
    team: 'Vanguard',
    waypoints: [
      { x: 10, y: DECK_Y, z: -34 },
      { x: 15, y: DECK_Y, z: -30.5 },
      { x: 25, y: DECK_Y, z: -29 },
      { x: 29.5, y: DECK_Y, z: -22.5 },
    ],
  },
];
