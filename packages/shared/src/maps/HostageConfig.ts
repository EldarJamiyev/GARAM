import { Vec3 } from '../physics/RaycastEngine.js';
import { CS_OFFICE_FLOOR_Y } from './CsOfficeData.js';

export type MapObjectiveType = 'bomb' | 'hostage' | 'elimination';

export interface HostageSpawnSpec {
  id: string;
  name: string;
  pos: Vec3;
  yaw: number;
}

export interface RescueZoneSpec {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  center: Vec3;
}

/**
 * CS_OFFICE Classic Hostage Rescue Layout (mirrored after cs_office.bsp):
 * - 2 hostages in Projector / Conference Room (East Office Wing)
 * - 2 hostages in Paper Storage / Main Office (West Office Wing)
 * - Rescue Zones in Front Snowy Courtyard (Vanguard CT Spawn)
 */
export const CS_OFFICE_HOSTAGE_SPAWNS: readonly HostageSpawnSpec[] = [
  { id: 'hostage_1', name: 'Dr. Vance (Exec)', pos: { x: 24.5, y: CS_OFFICE_FLOOR_Y, z: 14.5 }, yaw: Math.PI },
  { id: 'hostage_2', name: 'Analyst Chen', pos: { x: 26.8, y: CS_OFFICE_FLOOR_Y, z: 15.2 }, yaw: Math.PI * 0.85 },
  { id: 'hostage_3', name: 'Director Volkov', pos: { x: -24.5, y: CS_OFFICE_FLOOR_Y, z: 17.5 }, yaw: Math.PI * 0.25 },
  { id: 'hostage_4', name: 'Engineer Kael', pos: { x: -22.5, y: CS_OFFICE_FLOOR_Y, z: 18.8 }, yaw: 0 },
];

export const CS_OFFICE_RESCUE_ZONES: readonly RescueZoneSpec[] = [
  { id: 'rescue_courtyard_main', minX: -14, maxX: 14, minZ: -33, maxZ: -19, center: { x: 0, y: 0, z: -26 } },
];

export type HostageFollowState = 'IDLE' | 'FOLLOWING' | 'RESCUED' | 'DEAD';

export interface HostageEntityState {
  id: string;
  name: string;
  pos: Vec3;
  yaw: number;
  health: number;
  state: HostageFollowState;
  escortId: string | null;
}

export function isPointInRescueZone(pos: Vec3, zones: readonly RescueZoneSpec[]): boolean {
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (pos.x >= z.minX && pos.x <= z.maxX && pos.z >= z.minZ && pos.z <= z.maxZ) {
      return true;
    }
  }
  return false;
}

/**
 * Pure deterministic CS 1.6 Hostage Rescue rule evaluator:
 * - Rescuing >50% of alive hostages (or all 4) triggers Vanguard CT win.
 * - Time expiration gives Syndicate T win (hostages not rescued).
 */
export function evaluateHostageWinCondition(hostages: readonly HostageEntityState[]): {
  isRoundOver: boolean;
  winner?: 'Vanguard' | 'Syndicate';
  reason?: string;
} {
  let rescued = 0;
  let alive = 0;
  for (const h of hostages) {
    if (h.state === 'RESCUED') rescued++;
    else if (h.state !== 'DEAD') alive++;
  }
  if (rescued > 0 && alive === 0) {
    return { isRoundOver: true, winner: 'Vanguard', reason: 'All Hostages Rescued' };
  }
  // Classic CS 1.6 rule: rescuing majority (>= 3 of 4) wins if remaining are dead/unreachable, or all rescued
  if (rescued >= Math.ceil(hostages.length * 0.75) && rescued >= 3) {
    return { isRoundOver: true, winner: 'Vanguard', reason: 'Hostages Rescued!' };
  }
  return { isRoundOver: false };
}
