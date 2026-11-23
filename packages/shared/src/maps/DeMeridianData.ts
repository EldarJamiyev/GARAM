/**
 * Backward-compatible re-export facade aliasing CS_OFFICE to legacy DE_MERIDIAN symbol names.
 * All active geometry, spawns, bombsites, callouts, and bots come from CsOfficeData.ts.
 */
export type { AABBCollider, MapBounds } from '../physics/KinematicPlayerController.js';
export {
  type SurfaceMaterial,
  type SurfaceMaterialProps,
  SURFACE_MATERIALS,
  type Vec3,
  type MapBlockCollider,
  type CalloutZone,
  type TacticalBotConfig,
  CS_OFFICE_BOUNDS,
  CS_OFFICE_COURTYARD_Y,
  CS_OFFICE_FLOOR_Y,
  CS_OFFICE_UPPER_Y,
  CS_OFFICE_BLOCKS,
  CS_OFFICE_COLLIDERS,
  CS_OFFICE_BOUNDS as DE_MERIDIAN_BOUNDS,
  CS_OFFICE_FLOOR_Y as DE_MERIDIAN_DECK_Y,
  CS_OFFICE_UPPER_Y as DE_MERIDIAN_UPPER_Y,
  CS_OFFICE_BLOCKS as DE_MERIDIAN_BLOCKS,
  CS_OFFICE_COLLIDERS as DE_MERIDIAN_COLLIDERS,
  BOMBSITES,
  SPAWN_POINTS,
  SPAWN_ZONES,
  CALLOUT_ZONES,
  getCalloutName,
  TACTICAL_BOTS,
} from './CsOfficeData.js';
