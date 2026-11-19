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
    cost: 10,
    maxThickness: 2.2, // Allows crate corners, edges, and doors to penetrate cleanly
    isImpenetrable: false,
  },
  DRYWALL: {
    mu: 0.70,
    cost: 22,
    maxThickness: 1.5,
    isImpenetrable: false,
  },
  METAL_SHEET: {
    mu: 0.45,
    cost: 45,
    maxThickness: 1.2, // Allows grazing container edges and sheet metal
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

export const DE_CITADEL_BOUNDS = {
  minX: -58.5,
  maxX: 58.5,
  minZ: -58.5,
  maxZ: 58.5,
};

export interface BombsiteDef {
  id: 'A' | 'B';
  name: string;
  center: Vec3;
  radius: number;
}

export interface BuyZoneDef {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
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

// 120m x 120m DE_CITADEL Map Block Specification
export const DE_CITADEL_BLOCKS: MapBlockCollider[] = [
  // --- Outer Perimeter Walls (Impenetrable Concrete) ---
  makeBlock('wall_north', 'North Perimeter Wall', 0, 0, -60, 120, 9, 3, 'CONCRETE'),
  makeBlock('wall_south', 'South Perimeter Wall (CT Spawn)', 0, 0, 60, 120, 9, 3, 'CONCRETE'),
  makeBlock('wall_west', 'West Perimeter Wall (A Long)', -60, 0, 0, 3, 9, 120, 'CONCRETE'),
  makeBlock('wall_east', 'East Perimeter Wall (B Warehouse)', 60, 0, 0, 3, 9, 120, 'CONCRETE'),

  // --- Bombsite A: Armory Courtyard & A Heaven (+3.5m Elevation) ---
  makeBlock('site_a_back_wall', 'Armory Back Wall', -32, 0, -42, 28, 7, 3, 'CONCRETE'),
  makeBlock('site_a_long_wall', 'A Long Partition Wall', -44, 0, -25, 3, 6, 25, 'CONCRETE'),
  // A Heaven Balcony (+3.5m overlook)
  makeBlock('a_heaven_balcony', 'A Heaven Platform', -24, 0, -40, 8, 3.5, 10, 'CONCRETE'),
  makeBlock('a_heaven_railing', 'A Heaven Safety Railing', -20.2, 3.5, -40, 0.4, 1.1, 10, 'METAL_SHEET'),
  // A Heaven Walkable Stairs (10 steps, riser 0.35m each)
  makeBlock('a_stairs_1', 'A Stairs Step 1', -24, 0.0, -34.5, 3.6, 0.35, 1.1, 'CONCRETE'),
  makeBlock('a_stairs_2', 'A Stairs Step 2', -24, 0.35, -35.6, 3.6, 0.35, 1.1, 'CONCRETE'),
  makeBlock('a_stairs_3', 'A Stairs Step 3', -24, 0.70, -36.7, 3.6, 0.35, 1.1, 'CONCRETE'),
  makeBlock('a_stairs_4', 'A Stairs Step 4', -24, 1.05, -37.8, 3.6, 0.35, 1.1, 'CONCRETE'),
  makeBlock('a_stairs_5', 'A Stairs Step 5', -24, 1.40, -38.9, 3.6, 0.35, 1.1, 'CONCRETE'),
  makeBlock('a_stairs_6', 'A Stairs Step 6', -24, 1.75, -40.0, 3.6, 0.35, 1.1, 'CONCRETE'),
  makeBlock('a_stairs_7', 'A Stairs Step 7', -24, 2.10, -41.1, 3.6, 0.35, 1.1, 'CONCRETE'),
  makeBlock('a_stairs_8', 'A Stairs Step 8', -24, 2.45, -42.2, 3.6, 0.35, 1.1, 'CONCRETE'),
  makeBlock('a_stairs_9', 'A Stairs Step 9', -24, 2.80, -43.3, 3.6, 0.35, 1.1, 'CONCRETE'),
  makeBlock('a_stairs_10', 'A Stairs Step 10', -24, 3.15, -44.4, 3.6, 0.35, 1.1, 'CONCRETE'),
  // A Site Triple Stack Wood Crates (Wallbangable corners & edges)
  makeBlock('crate_a_low', 'A Site Wood Crate Low', -34, 0, -28, 3.2, 2.5, 3.2, 'WOOD_THIN'),
  makeBlock('crate_a_mid', 'A Site Wood Crate Mid', -30.5, 0, -28, 3.0, 1.80, 3.0, 'WOOD_THIN'),
  makeBlock('crate_a_high', 'A Site Wood Crate Top', -32.5, 2.2, -28, 2.5, 2.0, 2.5, 'WOOD_THIN'),
  makeBlock('site_a_catwalk', 'A Catwalk Ledge', -22, 0, -32, 4, 3.2, 14, 'CONCRETE'),

  // --- A Connector & B Connector (Mid to Sites) ---
  makeBlock('a_connector_wall', 'A Connector Partition', -18, 0, -14, 3, 6, 16, 'CONCRETE'),
  makeBlock('b_connector_wall', 'B Connector Partition', 22, 0, -14, 3, 6, 16, 'CONCRETE'),

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

  // --- Bombsite B: Reactor Vault & Covered B Tunnels ---
  makeBlock('site_b_back_wall', 'Reactor Back Wall', 35, 0, -45, 30, 8, 3, 'CONCRETE'),
  makeBlock('site_b_inner_wall', 'Reactor Inner Partition', 18, 0, -28, 3, 6, 20, 'CONCRETE'),
  // Covered B Tunnels (Concrete Roof for ceiling & crouch tests)
  makeBlock('b_tunnel_wall_l', 'B Tunnel West Wall', 40, 0, -10, 1.5, 4.2, 18, 'CONCRETE'),
  makeBlock('b_tunnel_wall_r', 'B Tunnel East Wall', 48, 0, -10, 1.5, 4.2, 18, 'CONCRETE'),
  makeBlock('b_tunnel_roof', 'B Tunnel Ceiling Roof', 44, 4.2, -10, 9.5, 0.6, 18, 'CONCRETE'),
  // Industrial Cargo Containers (Metal Sheet - Wallbangable across thin axes/edges)
  makeBlock('container_blue', 'B Site Blue Cargo Container', 32, 0, -34, 14, 4.2, 5.5, 'METAL_SHEET'),
  makeBlock('container_red', 'B Site Red Cargo Container', 37, 0, -25, 4.0, 4.2, 7.0, 'METAL_SHEET'),
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
    center: { x: -30, y: 0, z: -22 },
    radius: 6.0,
  },
  B: {
    id: 'B',
    name: 'Bombsite B (Reactor)',
    center: { x: 30, y: 0, z: -24 },
    radius: 6.0,
  },
};

export const SPAWN_POINTS = {
  VANGUARD_CT: { x: 0, y: 0, z: 38 },
  OBSIDIAN_T: { x: 0, y: 0, z: -48 },
};

export const SPAWN_ZONES = {
  VANGUARD_BUY_ZONE: {
    minX: -24,
    maxX: 24,
    minY: 0,
    maxY: 6,
    minZ: 24,
    maxZ: 58,
  },
  SYNDICATE_BUY_ZONE: {
    minX: -24,
    maxX: 24,
    minY: 0,
    maxY: 6,
    minZ: -58,
    maxZ: -32,
  },
};

export interface CalloutZone {
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY?: number;
  maxY?: number;
}

export const CALLOUT_ZONES: CalloutZone[] = [
  // Elevated zones checked first
  { name: 'A HEAVEN', minX: -28, maxX: -18, minZ: -46, maxZ: -34, minY: 2.0 },
  { name: 'A SITE', minX: -55, maxX: -16, minZ: -45, maxZ: -16 },
  { name: 'A LONG', minX: -55, maxX: -38, minZ: -16, maxZ: 28 },
  { name: 'A CONNECTOR', minX: -26, maxX: -10, minZ: -18, maxZ: -2 },
  { name: 'MID DOORS', minX: -4, maxX: 8, minZ: -4, maxZ: 4 },
  { name: 'MID COURTYARD', minX: -16, maxX: 16, minZ: -16, maxZ: 20 },
  { name: 'T MID', minX: -12, maxX: 12, minZ: -36, maxZ: -16 },
  { name: 'B CONNECTOR', minX: 10, maxX: 26, minZ: -18, maxZ: -2 },
  { name: 'B TUNNELS', minX: 36, maxX: 55, minZ: -20, maxZ: 26 },
  { name: 'B SITE', minX: 16, maxX: 55, minZ: -46, maxZ: -18 },
  { name: 'VANGUARD SPAWN', minX: -30, maxX: 30, minZ: 22, maxZ: 58 },
  { name: 'SYNDICATE SPAWN', minX: -30, maxX: 30, minZ: -58, maxZ: -34 },
];

export function getCalloutName(x: number, y: number, z: number): string {
  for (const zone of CALLOUT_ZONES) {
    if (
      x >= zone.minX &&
      x <= zone.maxX &&
      z >= zone.minZ &&
      z <= zone.maxZ &&
      (zone.minY === undefined || y >= zone.minY) &&
      (zone.maxY === undefined || y <= zone.maxY)
    ) {
      return zone.name;
    }
  }
  return 'DE_CITADEL';
}

// Full 5v5 Roster: 4 Vanguard AI allies (with player as 5th) + 5 Obsidian Syndicate AI enemies
export const TACTICAL_BOTS: BotSpawnDef[] = [
  // --- Vanguard Allies (CT) ---
  {
    id: 'bot_vanguard_1',
    name: 'Vanguard Alex',
    team: 'Vanguard',
    startPos: { x: 6, y: 0, z: 36 },
    waypoints: [
      { x: 8, y: 0, z: 18 },
      { x: 3, y: 0, z: 8 },
      { x: 8, y: 0, z: 12 },
    ],
  },
  {
    id: 'bot_vanguard_2',
    name: 'Vanguard Elena',
    team: 'Vanguard',
    startPos: { x: -6, y: 0, z: 36 },
    waypoints: [
      { x: -14, y: 0, z: 20 },
      { x: -24, y: 0, z: -4 },
      { x: -30, y: 0, z: -22 },
    ],
  },
  {
    id: 'bot_vanguard_3',
    name: 'Vanguard Marcus',
    team: 'Vanguard',
    startPos: { x: 12, y: 0, z: 40 },
    waypoints: [
      { x: 22, y: 0, z: 20 },
      { x: 30, y: 0, z: -12 },
      { x: 30, y: 0, z: -24 },
    ],
  },
  {
    id: 'bot_vanguard_4',
    name: 'Vanguard Dmitri',
    team: 'Vanguard',
    startPos: { x: -12, y: 0, z: 40 },
    waypoints: [
      { x: -4, y: 0, z: 16 },
      { x: 3, y: 0, z: 2 },
      { x: 0, y: 0, z: 14 },
    ],
  },

  // --- Obsidian Syndicate Enemies (T) ---
  {
    id: 'bot_syndicate_1',
    name: 'Syndicate Kaine',
    team: 'Syndicate',
    startPos: { x: 0, y: 0, z: -46 },
    waypoints: [
      { x: 2, y: 0, z: -25 },
      { x: 3, y: 0, z: -8 },
      { x: 3, y: 0, z: -4 },
    ],
  },
  {
    id: 'bot_syndicate_2',
    name: 'Syndicate Ghost',
    team: 'Syndicate',
    startPos: { x: -22, y: 0, z: -50 },
    waypoints: [
      { x: -34, y: 0, z: -38 },
      { x: -30, y: 0, z: -22 },
      { x: -38, y: 0, z: -22 },
    ],
  },
  {
    id: 'bot_syndicate_3',
    name: 'Syndicate Viper',
    team: 'Syndicate',
    startPos: { x: 10, y: 0, z: -48 },
    waypoints: [
      { x: 22, y: 0, z: -40 },
      { x: 30, y: 0, z: -24 },
      { x: 30, y: 0, z: -18 },
    ],
  },
  {
    id: 'bot_syndicate_4',
    name: 'Syndicate Jax',
    team: 'Syndicate',
    startPos: { x: -6, y: 0, z: -44 },
    waypoints: [
      { x: -12, y: 0, z: -30 },
      { x: -38, y: 0, z: -38 },
      { x: -30, y: 0, z: -22 },
    ],
  },
  {
    id: 'bot_syndicate_5',
    name: 'Syndicate Raven',
    team: 'Syndicate',
    startPos: { x: 6, y: 0, z: -44 },
    waypoints: [
      { x: 12, y: 0, z: -30 },
      { x: 30, y: 0, z: -24 },
      { x: 22, y: 0, z: -24 },
    ],
  },
];
