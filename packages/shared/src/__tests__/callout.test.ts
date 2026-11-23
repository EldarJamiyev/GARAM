import { describe, it, expect } from 'vitest';
import {
  getCalloutName,
  CALLOUT_ZONES,
  CS_OFFICE_FLOOR_Y,
  CS_OFFICE_UPPER_Y,
  SPAWN_POINTS,
  BOMBSITES,
} from '../maps/CsOfficeData.js';

describe('CS_OFFICE 3-Tier Zone Callouts', () => {
  it('defines all 18 named competitive CS_OFFICE callout zones across 3 elevation tiers', () => {
    const uniqueZones = new Set(CALLOUT_ZONES.map((z) => z.name));
    expect(uniqueZones.size).toBeGreaterThanOrEqual(16);
    expect(uniqueZones.has('CT COURTYARD')).toBe(true);
    expect(uniqueZones.has('GARAGE')).toBe(true);
    expect(uniqueZones.has('FRONT HALL')).toBe(true);
    expect(uniqueZones.has('LONG HALL')).toBe(true);
    expect(uniqueZones.has('PAPER ROOM')).toBe(true);
    expect(uniqueZones.has('PROJECTOR ROOM')).toBe(true);
    expect(uniqueZones.has('CONFERENCE HALL')).toBe(true);
    expect(uniqueZones.has('MAIN HALL')).toBe(true);
    expect(uniqueZones.has('STORAGE')).toBe(true);
    expect(uniqueZones.has('KITCHEN')).toBe(true);
    expect(uniqueZones.has('BACK WAY')).toBe(true);
    expect(uniqueZones.has('SIDE HALL')).toBe(true);
    expect(uniqueZones.has('SNIPER WINDOW')).toBe(true);
    expect(uniqueZones.has('T BACK OFFICE')).toBe(true);
  });

  it('accurately resolves Vanguard CT Courtyard and Syndicate T Back Office spawns', () => {
    expect(
      getCalloutName(SPAWN_POINTS.VANGUARD_CT.x, SPAWN_POINTS.VANGUARD_CT.y, SPAWN_POINTS.VANGUARD_CT.z)
    ).toBe('CT COURTYARD');
    expect(
      getCalloutName(SPAWN_POINTS.OBSIDIAN_T.x, SPAWN_POINTS.OBSIDIAN_T.y, SPAWN_POINTS.OBSIDIAN_T.z)
    ).toBe('T BACK OFFICE');
  });

  it('accurately resolves Bombsite A (Projector Room) and Bombsite B (Paper Room)', () => {
    expect(getCalloutName(BOMBSITES.A.center.x, BOMBSITES.A.center.y, BOMBSITES.A.center.z)).toBe(
      'PROJECTOR ROOM'
    );
    expect(getCalloutName(BOMBSITES.B.center.x, BOMBSITES.B.center.y, BOMBSITES.B.center.z)).toBe(
      'PAPER ROOM'
    );
  });

  it('prioritizes Tier-2 Sniper Window Mezzanine (+3.5m) over Front Hall underneath', () => {
    expect(getCalloutName(0, CS_OFFICE_UPPER_Y, -10.0)).toBe('SNIPER WINDOW');
    expect(getCalloutName(0, CS_OFFICE_FLOOR_Y, -10.0)).toBe('FRONT HALL');
  });

  it('accurately resolves Garage, Long Hall, Main Hall, Kitchen, Back Way, and Storage', () => {
    expect(getCalloutName(22, 0, -24)).toBe('GARAGE');
    expect(getCalloutName(-30, CS_OFFICE_FLOOR_Y, 4)).toBe('LONG HALL');
    expect(getCalloutName(2, CS_OFFICE_FLOOR_Y, 6)).toBe('MAIN HALL');
    expect(getCalloutName(24, CS_OFFICE_FLOOR_Y, 20)).toBe('KITCHEN');
    expect(getCalloutName(-18, CS_OFFICE_FLOOR_Y, 20)).toBe('BACK WAY');
    expect(getCalloutName(28, CS_OFFICE_FLOOR_Y, -6)).toBe('STORAGE');
  });
});
