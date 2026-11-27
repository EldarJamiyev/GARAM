import { AABBCollider, LadderVolume, MapBounds } from '../physics/KinematicPlayerController.js';
import {
  MapBlockCollider,
  CalloutZone,
  TacticalBotConfig,
  CS_OFFICE_BOUNDS,
  CS_OFFICE_BLOCKS,
  CS_OFFICE_COLLIDERS,
  BOMBSITES,
  SPAWN_POINTS,
  SPAWN_ZONES,
  CALLOUT_ZONES,
  getCalloutName,
  TACTICAL_BOTS,
} from './CsOfficeData.js';
import {
  DE_DUST2_BOUNDS,
  DE_DUST2_BLOCKS,
  DE_DUST2_COLLIDERS,
  DE_DUST2_BOMBSITES,
  DE_DUST2_SPAWN_POINTS,
  DE_DUST2_SPAWN_ZONES,
  DE_DUST2_CALLOUT_ZONES,
  getDust2CalloutName,
  DE_DUST2_BOTS,
} from './DeDust2Data.js';
import {
  DE_NUKE_BOUNDS,
  DE_NUKE_BLOCKS,
  DE_NUKE_COLLIDERS,
  DE_NUKE_LADDERS,
  DE_NUKE_BREAKABLES,
  DE_NUKE_BOMBSITES,
  DE_NUKE_SPAWN_POINTS,
  DE_NUKE_SPAWN_ZONES,
  DE_NUKE_CALLOUT_ZONES,
  getNukeCalloutName,
  DE_NUKE_BOTS,
  BreakableBlockSpec,
} from './DeNukeData.js';
import {
  DE_INFERNO_BOUNDS,
  DE_INFERNO_BLOCKS,
  DE_INFERNO_COLLIDERS,
  DE_INFERNO_LADDERS,
  DE_INFERNO_BREAKABLES,
  DE_INFERNO_BOMBSITES,
  DE_INFERNO_SPAWN_POINTS,
  DE_INFERNO_SPAWN_ZONES,
  DE_INFERNO_CALLOUT_ZONES,
  getInfernoCalloutName,
  DE_INFERNO_BOTS,
} from './DeInfernoData.js';
import {
  FY_SNOW_BOUNDS,
  FY_SNOW_BLOCKS,
  FY_SNOW_COLLIDERS,
  FY_SNOW_FLOOR_WEAPONS,
  FY_SNOW_BOMBSITES,
  FY_SNOW_SPAWN_POINTS,
  FY_SNOW_SPAWN_ZONES,
  FY_SNOW_CALLOUT_ZONES,
  getSnowCalloutName,
  FY_SNOW_BOTS,
  FloorWeaponSpawnSpec,
} from './FySnowData.js';
import {
  CS_OFFICE_HOSTAGE_SPAWNS,
  CS_OFFICE_RESCUE_ZONES,
  HostageSpawnSpec,
  MapObjectiveType,
  RescueZoneSpec,
} from './HostageConfig.js';

export type MapId = 'de_dust2' | 'cs_office' | 'de_nuke' | 'de_inferno' | 'fy_snow';

export const DEFAULT_MAP_ID: MapId = 'de_dust2';

export interface MapBombsiteEntry {
  center: { x: number; y: number; z: number };
  radius: number;
}

export interface MapDescriptor {
  id: MapId;
  displayName: string;
  objectiveType: MapObjectiveType;
  bounds: MapBounds;
  blocks: MapBlockCollider[];
  colliders: AABBCollider[];
  ladders: readonly LadderVolume[];
  breakables: readonly BreakableBlockSpec[];
  hostageSpawns: readonly HostageSpawnSpec[];
  rescueZones: readonly RescueZoneSpec[];
  floorWeaponSpawns: readonly FloorWeaponSpawnSpec[];
  bombsites: {
    A: MapBombsiteEntry;
    B: MapBombsiteEntry;
  };
  spawnPoints: {
    VANGUARD_CT: { x: number; y: number; z: number };
    OBSIDIAN_T: { x: number; y: number; z: number };
  };
  spawnZones: {
    VANGUARD_BUY_ZONE: { minX: number; maxX: number; minZ: number; maxZ: number };
    SYNDICATE_BUY_ZONE: { minX: number; maxX: number; minZ: number; maxZ: number };
  };
  calloutZones: CalloutZone[];
  getCalloutName: (x: number, y: number, z: number) => string;
  tacticalBots: TacticalBotConfig[];
  isGlbArena: boolean;
  initialYaw: {
    Vanguard: number;
    Syndicate: number;
  };
}

export const MAP_REGISTRY: Readonly<Record<MapId, MapDescriptor>> = Object.freeze({
  de_dust2: {
    id: 'de_dust2',
    displayName: 'DE_DUST2 (A-SITE)',
    objectiveType: 'bomb',
    bounds: DE_DUST2_BOUNDS,
    blocks: DE_DUST2_BLOCKS,
    colliders: DE_DUST2_COLLIDERS,
    ladders: [],
    breakables: [],
    hostageSpawns: [],
    rescueZones: [],
    floorWeaponSpawns: [],
    bombsites: DE_DUST2_BOMBSITES,
    spawnPoints: DE_DUST2_SPAWN_POINTS,
    spawnZones: DE_DUST2_SPAWN_ZONES,
    calloutZones: DE_DUST2_CALLOUT_ZONES,
    getCalloutName: getDust2CalloutName,
    tacticalBots: DE_DUST2_BOTS,
    isGlbArena: true,
    initialYaw: { Vanguard: -0.35, Syndicate: -Math.PI * 0.5 },
  },
  cs_office: {
    id: 'cs_office',
    displayName: 'CS_OFFICE (2-SITE / HOSTAGES)',
    objectiveType: 'bomb', // Client toggleable to 'hostage' via csOfficeObjective setting!
    bounds: CS_OFFICE_BOUNDS,
    blocks: CS_OFFICE_BLOCKS,
    colliders: CS_OFFICE_COLLIDERS,
    ladders: [
      { id: 'office_garage_ladder', minX: 29.0, maxX: 30.2, minY: 0.0, maxY: 3.5, minZ: -17.5, maxZ: -16.2, normalX: -1, normalZ: 0 },
    ],
    breakables: [
      { id: 'office_window_1', minX: -12.0, maxX: -8.0, minY: 2.2, maxY: 3.8, minZ: -12.4, maxZ: -12.1, health: 20, material: 'GLASS', label: 'GLASS' },
      { id: 'office_window_2', minX: 8.0, maxX: 12.0, minY: 2.2, maxY: 3.8, minZ: -12.4, maxZ: -12.1, health: 20, material: 'GLASS', label: 'GLASS' },
    ],
    hostageSpawns: CS_OFFICE_HOSTAGE_SPAWNS,
    rescueZones: CS_OFFICE_RESCUE_ZONES,
    floorWeaponSpawns: [],
    bombsites: BOMBSITES,
    spawnPoints: SPAWN_POINTS,
    spawnZones: SPAWN_ZONES,
    calloutZones: CALLOUT_ZONES,
    getCalloutName,
    tacticalBots: TACTICAL_BOTS,
    isGlbArena: false,
    initialYaw: { Vanguard: 0, Syndicate: Math.PI },
  },
  de_nuke: {
    id: 'de_nuke',
    displayName: 'DE_NUKE (A/B VERTICAL)',
    objectiveType: 'bomb',
    bounds: DE_NUKE_BOUNDS,
    blocks: DE_NUKE_BLOCKS,
    colliders: DE_NUKE_COLLIDERS,
    ladders: DE_NUKE_LADDERS,
    breakables: DE_NUKE_BREAKABLES,
    hostageSpawns: [],
    rescueZones: [],
    floorWeaponSpawns: [],
    bombsites: DE_NUKE_BOMBSITES,
    spawnPoints: DE_NUKE_SPAWN_POINTS,
    spawnZones: DE_NUKE_SPAWN_ZONES,
    calloutZones: DE_NUKE_CALLOUT_ZONES,
    getCalloutName: getNukeCalloutName,
    tacticalBots: DE_NUKE_BOTS,
    isGlbArena: false,
    initialYaw: { Vanguard: Math.PI * 0.5, Syndicate: -Math.PI * 0.5 },
  },
  de_inferno: {
    id: 'de_inferno',
    displayName: 'DE_INFERNO (2-SITE)',
    objectiveType: 'bomb',
    bounds: DE_INFERNO_BOUNDS,
    blocks: DE_INFERNO_BLOCKS,
    colliders: DE_INFERNO_COLLIDERS,
    ladders: DE_INFERNO_LADDERS,
    breakables: DE_INFERNO_BREAKABLES,
    hostageSpawns: [],
    rescueZones: [],
    floorWeaponSpawns: [],
    bombsites: DE_INFERNO_BOMBSITES,
    spawnPoints: DE_INFERNO_SPAWN_POINTS,
    spawnZones: DE_INFERNO_SPAWN_ZONES,
    calloutZones: DE_INFERNO_CALLOUT_ZONES,
    getCalloutName: getInfernoCalloutName,
    tacticalBots: DE_INFERNO_BOTS,
    isGlbArena: false,
    initialYaw: { Vanguard: Math.PI * 0.5, Syndicate: -Math.PI * 0.5 },
  },
  fy_snow: {
    id: 'fy_snow',
    displayName: 'FY_SNOW (WINTER AIM ARENA)',
    objectiveType: 'elimination',
    bounds: FY_SNOW_BOUNDS,
    blocks: FY_SNOW_BLOCKS,
    colliders: FY_SNOW_COLLIDERS,
    ladders: [],
    breakables: [],
    hostageSpawns: [],
    rescueZones: [],
    floorWeaponSpawns: FY_SNOW_FLOOR_WEAPONS,
    bombsites: FY_SNOW_BOMBSITES,
    spawnPoints: FY_SNOW_SPAWN_POINTS,
    spawnZones: FY_SNOW_SPAWN_ZONES,
    calloutZones: FY_SNOW_CALLOUT_ZONES,
    getCalloutName: getSnowCalloutName,
    tacticalBots: FY_SNOW_BOTS,
    isGlbArena: false,
    initialYaw: { Vanguard: Math.PI, Syndicate: 0 },
  },
});

export function isValidMapId(value: unknown): value is MapId {
  return (
    value === 'de_dust2' ||
    value === 'cs_office' ||
    value === 'de_nuke' ||
    value === 'de_inferno' ||
    value === 'fy_snow'
  );
}

export function getMapDescriptor(mapId?: string | null): MapDescriptor {
  if (isValidMapId(mapId)) {
    return MAP_REGISTRY[mapId];
  }
  return MAP_REGISTRY[DEFAULT_MAP_ID];
}
