import { AABBCollider, LadderVolume, MapBounds } from '../physics/KinematicPlayerController.js';
import {
  MapBlockCollider,
  CalloutZone,
  TacticalBotConfig,
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
import type { BreakableBlockSpec } from './DeNukeData.js';
import type { FloorWeaponSpawnSpec } from './FySnowData.js';
import type {
  HostageSpawnSpec,
  MapObjectiveType,
  RescueZoneSpec,
} from './HostageConfig.js';

export type MapId = 'de_dust2';

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
});

export function isValidMapId(value: unknown): value is MapId {
  return value === 'de_dust2';
}

export function getMapDescriptor(mapId?: string | null): MapDescriptor {
  if (isValidMapId(mapId)) {
    return MAP_REGISTRY[mapId];
  }
  return MAP_REGISTRY[DEFAULT_MAP_ID];
}
