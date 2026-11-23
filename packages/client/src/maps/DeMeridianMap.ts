/**
 * Backward-compatible re-export facade aliasing CS_OFFICE 3D map builder to legacy symbol names.
 */
export {
  type BotEntity,
  type MapBuildResult,
  type SurfaceMaterial,
  buildCsOfficeMap,
  buildCsOfficeMap as buildTacticalMeridianMap,
  buildCsOfficeMap as buildTacticalCitadelMap,
} from './CsOfficeMap.js';
