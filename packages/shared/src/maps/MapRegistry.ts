import { AABBCollider, MapBounds } from '../physics/KinematicPlayerController.js';
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

export type MapId = 'de_dust2' | 'cs_office';

export const DEFAULT_MAP_ID: MapId = 'de_dust2';

export interface MapBombsiteEntry {
  center: { x: number; y: number; z: number };
  radius: number;
}

export interface MapDescriptor {
  id: MapId;
  displayName: string;
  bounds: MapBounds;
  blocks: MapBlockCollider[];
  colliders: AABBCollider[];
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
    bounds: DE_DUST2_BOUNDS,
    blocks: DE_DUST2_BLOCKS,
    colliders: DE_DUST2_COLLIDERS,
    bombsites: DE_DUST2_BOMBSITES,
    spawnPoints: DE_DUST2_SPAWN_POINTS,
    spawnZones: DE_DUST2_SPAWN_ZONES,
    calloutZones: DE_DUST2_CALLOUT_ZONES,
    getCalloutName: getDust2CalloutName,
    tacticalBots: DE_DUST2_BOTS,
    isGlbArena: true,
    initialYaw: {
      Vanguard: -0.35,
      Syndicate: -Math.PI * 0.5,
    },
  },
  cs_office: {
    id: 'cs_office',
    displayName: 'CS_OFFICE (2-SITE)',
    bounds: CS_OFFICE_BOUNDS,
    blocks: CS_OFFICE_BLOCKS,
    colliders: CS_OFFICE_COLLIDERS,
    bombsites: BOMBSITES,
    spawnPoints: SPAWN_POINTS,
    spawnZones: SPAWN_ZONES,
    calloutZones: CALLOUT_ZONES,
    getCalloutName,
    tacticalBots: TACTICAL_BOTS,
    isGlbArena: false,
    initialYaw: {
      Vanguard: 0,
      Syndicate: Math.PI,
    },
  },
});

export function isValidMapId(value: unknown): value is MapId {
  return value === 'de_dust2' || value === 'cs_office';
}

export function getMapDescriptor(mapId?: string | null): MapDescriptor {
  if (isValidMapId(mapId)) {
    return MAP_REGISTRY[mapId];
  }
  return MAP_REGISTRY[DEFAULT_MAP_ID];
}
