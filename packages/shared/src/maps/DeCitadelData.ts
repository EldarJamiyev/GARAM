/**
 * Backward-compatible re-export facade aliasing DE_MERIDIAN to legacy DE_CITADEL symbol names.
 * All geometry, spawns, bombsites, callouts, and bots are sourced from DeMeridianData.ts.
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
  DE_MERIDIAN_BOUNDS,
  DE_MERIDIAN_DECK_Y,
  DE_MERIDIAN_UPPER_Y,
  DE_MERIDIAN_BLOCKS,
  DE_MERIDIAN_COLLIDERS,
  DE_MERIDIAN_BOUNDS as DE_CITADEL_BOUNDS,
  DE_MERIDIAN_BLOCKS as DE_CITADEL_BLOCKS,
  DE_MERIDIAN_COLLIDERS as DE_CITADEL_COLLIDERS,
  BOMBSITES,
  SPAWN_POINTS,
  SPAWN_ZONES,
  CALLOUT_ZONES,
  getCalloutName,
  TACTICAL_BOTS,
} from './DeMeridianData.js';
