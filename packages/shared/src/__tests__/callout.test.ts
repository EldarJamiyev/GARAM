import { describe, it, expect } from 'vitest';
import {
  getCalloutName,
  CALLOUT_ZONES,
  DE_MERIDIAN_DECK_Y,
  DE_MERIDIAN_UPPER_Y,
  SPAWN_POINTS,
  BOMBSITES,
} from '../maps/DeMeridianData.js';

describe('DE_MERIDIAN 3-Tier Zone Callouts', () => {
  it('defines all 20 named competitive callout zones across 3 elevation tiers', () => {
    const uniqueZones = new Set(CALLOUT_ZONES.map((z) => z.name));
    expect(uniqueZones.size).toBe(20);
    expect(uniqueZones.has('A PALACE')).toBe(true);
    expect(uniqueZones.has('A HEAVEN')).toBe(true);
    expect(uniqueZones.has('MID NEST')).toBe(true);
    expect(uniqueZones.has('B APARTMENTS')).toBe(true);
    expect(uniqueZones.has('SUNKEN AQUEDUCT')).toBe(true);
    expect(uniqueZones.has('A SITE SANCTUM')).toBe(true);
    expect(uniqueZones.has('B SITE FOUNDRY')).toBe(true);
    expect(uniqueZones.has('A CONNECTOR')).toBe(true);
    expect(uniqueZones.has('B SHORT')).toBe(true);
    expect(uniqueZones.has('VANGUARD SPAWN')).toBe(true);
    expect(uniqueZones.has('SYNDICATE SPAWN')).toBe(true);
  });

  it('accurately resolves Vanguard CT Spawn (North) and Syndicate T Spawn (South)', () => {
    expect(
      getCalloutName(SPAWN_POINTS.VANGUARD_CT.x, SPAWN_POINTS.VANGUARD_CT.y, SPAWN_POINTS.VANGUARD_CT.z)
    ).toBe('VANGUARD SPAWN');
    expect(
      getCalloutName(SPAWN_POINTS.OBSIDIAN_T.x, SPAWN_POINTS.OBSIDIAN_T.y, SPAWN_POINTS.OBSIDIAN_T.z)
    ).toBe('SYNDICATE SPAWN');
  });

  it('accurately resolves Bombsite A (The Sanctum) and Bombsite B (The Foundry)', () => {
    expect(getCalloutName(BOMBSITES.A.center.x, BOMBSITES.A.center.y, BOMBSITES.A.center.z)).toBe(
      'A SITE SANCTUM'
    );
    expect(getCalloutName(BOMBSITES.B.center.x, BOMBSITES.B.center.y, BOMBSITES.B.center.z)).toBe(
      'B SITE FOUNDRY'
    );
  });

  it('prioritizes Tier-2 Upper Overlooks (+4.9m) over Main Deck zones underneath', () => {
    expect(getCalloutName(-41.5, DE_MERIDIAN_UPPER_Y, 4)).toBe('A PALACE');
    expect(getCalloutName(-21.5, DE_MERIDIAN_UPPER_Y, -28.8)).toBe('A HEAVEN');
    expect(getCalloutName(0, DE_MERIDIAN_UPPER_Y, -16.8)).toBe('MID NEST');
    expect(getCalloutName(41.5, DE_MERIDIAN_UPPER_Y, -2)).toBe('B APARTMENTS');
  });

  it('distinguishes Tier-0 Sunken Aqueduct Underpass (y=0.0m) from Main Deck Mid Courtyard (y=2.1m)', () => {
    expect(getCalloutName(0, 0, 4)).toBe('SUNKEN AQUEDUCT');
    expect(getCalloutName(-8.5, DE_MERIDIAN_DECK_Y, 0)).toBe('MID COURTYARD');
    expect(getCalloutName(0, DE_MERIDIAN_DECK_Y, 23)).toBe('TOP MID');
  });

  it('accurately resolves choke points (A Main, A Connector, B Short, B Canal, B Market)', () => {
    expect(getCalloutName(-33.4, DE_MERIDIAN_DECK_Y, -6.5)).toBe('A MAIN');
    expect(getCalloutName(-13.0, DE_MERIDIAN_DECK_Y, -11.5)).toBe('A CONNECTOR');
    expect(getCalloutName(12.0, DE_MERIDIAN_DECK_Y, -8.0)).toBe('B SHORT');
    expect(getCalloutName(30.0, DE_MERIDIAN_DECK_Y, -6.5)).toBe('B CANAL');
    expect(getCalloutName(18.5, DE_MERIDIAN_DECK_Y, -30.5)).toBe('B MARKET');
  });
});
