export type SurfaceMaterial = 'CONCRETE' | 'WOOD_THIN' | 'DRYWALL' | 'METAL_SHEET';

export interface MaterialProperties {
  mu: number;            // Damage multiplier after penetration (e.g. 0.75)
  cost: number;          // Damage lost per meter of thickness (e.g. 18 dmg/m)
  maxThickness: number;  // Maximum wall thickness (in meters) that can be penetrated
  isImpenetrable: boolean;
}

export const SURFACE_MATERIALS: Record<SurfaceMaterial, MaterialProperties> = {
  CONCRETE: {
    mu: 0.0,
    cost: Infinity,
    maxThickness: 0.0,
    isImpenetrable: true,
  },
  WOOD_THIN: {
    mu: 0.75,
    cost: 18,
    maxThickness: 0.65,
    isImpenetrable: false,
  },
  DRYWALL: {
    mu: 0.70,
    cost: 22,
    maxThickness: 0.50,
    isImpenetrable: false,
  },
  METAL_SHEET: {
    mu: 0.45,
    cost: 45,
    maxThickness: 0.25,
    isImpenetrable: false,
  },
};

export interface MapBlockCollider {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  material: SurfaceMaterial;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BombsiteDef {
  id: 'A' | 'B';
  name: string;
  center: Vec3;
  radius: number;
}

export interface BotSpawnDef {
  id: string;
  name: string;
  team: 'Vanguard' | 'Syndicate';
  startPos: Vec3;
  waypoints: Vec3[];
}

function makeBlock(
  id: string,
  name: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: SurfaceMaterial
): MapBlockCollider {
  return {
    id,
    name,
    x,
    y,
    z,
    w,
    h,
    d,
    minX: x - w / 2,
    maxX: x + w / 2,
    minY: y,
    maxY: y + h,
    minZ: z - d / 2,
    maxZ: z + d / 2,
    material,
  };
}

// 120m x 120m DE_CITADEL Map Specification
export const DE_CITADEL_BLOCKS: MapBlockCollider[] = [
  // --- Outer Perimeter Walls (Impenetrable Concrete) ---
  makeBlock('wall_north', 'North Perimeter Wall', 0, 0, -60, 120, 9, 3, 'CONCRETE'),
  makeBlock('wall_south', 'South Perimeter Wall (CT Spawn)', 0, 0, 60, 120, 9, 3, 'CONCRETE'),
  makeBlock('wall_west', 'West Perimeter Wall (A Long)', -60, 0, 0, 3, 9, 120, 'CONCRETE'),
  makeBlock('wall_east', 'East Perimeter Wall (B Warehouse)', 60, 0, 0, 3, 9, 120, 'CONCRETE'),

  // --- Bombsite A: Armory Courtyard ---
  makeBlock('site_a_back_wall', 'Armory Back Wall', -32, 0, -42, 28, 7, 3, 'CONCRETE'),
  makeBlock('site_a_long_wall', 'A Long Partition Wall', -44, 0, -25, 3, 6, 25, 'CONCRETE'),
  // A Site Triple Stack Wood Crates (Wallbangable!)
  makeBlock('crate_a_low', 'A Site Wood Crate Low', -34, 0, -28, 3.2, 2.5, 3.2, 'WOOD_THIN'),
  makeBlock('crate_a_mid', 'A Site Wood Crate Mid', -30.5, 0, -28, 3.0, 2.0, 3.0, 'WOOD_THIN'),
  makeBlock('crate_a_high', 'A Site Wood Crate Top', -32.5, 2.2, -28, 2.5, 2.0, 2.5, 'WOOD_THIN'),
  makeBlock('site_a_catwalk', 'A Catwalk Ledge', -22, 0, -32, 4, 3.2, 14, 'CONCRETE'),

  // --- Mid: Double Doors & Archway Choke Point ---
  makeBlock('mid_wall_west', 'Mid West Wall', -12, 0, 0, 22, 7, 3, 'CONCRETE'),
  makeBlock('mid_wall_east', 'Mid East Wall', 20, 0, 0, 26, 7, 3, 'CONCRETE'),
  // Mid Door Frame (Concrete pillars) + Wooden Door Planks (Wallbangable!)
  makeBlock('mid_pillar_left', 'Mid Door Pillar Left', -1.5, 0, 0, 1.2, 7, 3.5, 'CONCRETE'),
  makeBlock('mid_pillar_right', 'Mid Door Pillar Right', 7.5, 0, 0, 1.2, 7, 3.5, 'CONCRETE'),
  makeBlock('mid_door_left', 'Mid Wooden Door Left (Wallbangable)', 0.8, 0, 0, 3.2, 5.5, 0.35, 'WOOD_THIN'),
  makeBlock('mid_door_right', 'Mid Wooden Door Right (Wallbangable)', 5.2, 0, 0, 3.2, 5.5, 0.35, 'WOOD_THIN'),
  makeBlock('mid_door_lintel', 'Mid Overhead Hazard Lintel', 3.0, 6.2, 0, 9.0, 0.8, 3.5, 'METAL_SHEET'),
  makeBlock('mid_crate_connector', 'Mid Connector Crate', 12, 0, 14, 4, 3, 4, 'WOOD_THIN'),
  makeBlock('mid_pallets', 'Mid Pallets Stack', -8, 0, 18, 3.5, 1.8, 3.5, 'WOOD_THIN'),

  // --- Bombsite B: Reactor Vault ---
  makeBlock('site_b_back_wall', 'Reactor Back Wall', 35, 0, -45, 30, 8, 3, 'CONCRETE'),
  makeBlock('site_b_inner_wall', 'Reactor Inner Partition', 18, 0, -28, 3, 6, 20, 'CONCRETE'),
  // Industrial Cargo Containers (Metal Sheet - Wallbangable with high penetration!)
  makeBlock('container_blue', 'B Site Blue Cargo Container', 32, 0, -32, 14, 4.2, 5.5, 'METAL_SHEET'),
  makeBlock('container_red', 'B Site Red Cargo Container', 42, 0, -20, 5.5, 4.2, 14, 'METAL_SHEET'),
  makeBlock('crate_b_stack', 'B Site Staging Crates', 26, 0, -18, 4.0, 3.0, 4.0, 'WOOD_THIN'),
  makeBlock('crate_b_corner', 'B Site Dark Corner Crate', 48, 0, -38, 3.2, 2.5, 3.2, 'WOOD_THIN'),

  // --- CT Spawn & T Spawn Cover Props ---
  makeBlock('ct_barrier_1', 'CT Spawn Low Cover', -6, 0, 30, 8, 1.5, 1.5, 'CONCRETE'),
  makeBlock('ct_barrier_2', 'CT Spawn Right Cover', 10, 0, 32, 6, 1.5, 1.5, 'CONCRETE'),
  makeBlock('t_barrier_1', 'T Spawn Left Guard', -12, 0, -48, 10, 2.2, 2.2, 'CONCRETE'),
  makeBlock('t_barrier_2', 'T Spawn Right Guard', 14, 0, -46, 10, 2.2, 2.2, 'CONCRETE'),
];

export const BOMBSITES: Record<'A' | 'B', BombsiteDef> = {
  A: {
    id: 'A',
    name: 'Bombsite A (Armory)',
    center: { x: -32, y: 0, z: -30 },
    radius: 6.0,
  },
  B: {
    id: 'B',
    name: 'Bombsite B (Reactor)',
    center: { x: 35, y: 0, z: -32 },
    radius: 6.0,
  },
};

export const SPAWN_POINTS = {
  VANGUARD_CT: { x: 0, y: 0, z: 38 },
  OBSIDIAN_T: { x: 0, y: 0, z: -48 },
};

export const TACTICAL_BOTS: BotSpawnDef[] = [
  {
    id: 'bot_syndicate_1',
    name: 'Syndicate Kaine',
    team: 'Syndicate',
    startPos: { x: 3, y: 0, z: -20 },
    waypoints: [
      { x: 3, y: 0, z: -4 },
      { x: 6, y: 0, z: 2 },
      { x: 1, y: 0, z: -12 },
      { x: 4, y: 0, z: -22 },
    ],
  },
  {
    id: 'bot_syndicate_2',
    name: 'Syndicate Ghost',
    team: 'Syndicate',
    startPos: { x: -30, y: 0, z: -38 },
    waypoints: [
      { x: -32, y: 0, z: -24 },
      { x: -26, y: 0, z: -18 },
      { x: -36, y: 0, z: -28 },
    ],
  },
  {
    id: 'bot_syndicate_3',
    name: 'Syndicate Viper',
    team: 'Syndicate',
    startPos: { x: 36, y: 0, z: -38 },
    waypoints: [
      { x: 34, y: 0, z: -22 },
      { x: 42, y: 0, z: -16 },
      { x: 28, y: 0, z: -25 },
    ],
  },
  {
    id: 'bot_vanguard_1',
    name: 'Vanguard Alex',
    team: 'Vanguard',
    startPos: { x: 12, y: 0, z: 22 },
    waypoints: [
      { x: 10, y: 0, z: 8 },
      { x: 3, y: 0, z: 5 },
      { x: 14, y: 0, z: 18 },
    ],
  },
];
