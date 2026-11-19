import { describe, it, expect } from 'vitest';
import { getCalloutName, CALLOUT_ZONES } from '../maps/DeCitadelData.js';

describe('DE_CITADEL Zone Callouts', () => {
  it('defines all 11 named competitive zones', () => {
    const uniqueZones = new Set(CALLOUT_ZONES.map(z => z.name));
    expect(uniqueZones.has('A SITE')).toBe(true);
    expect(uniqueZones.has('A HEAVEN')).toBe(true);
    expect(uniqueZones.has('A LONG')).toBe(true);
    expect(uniqueZones.has('A CONNECTOR')).toBe(true);
    expect(uniqueZones.has('MID COURTYARD')).toBe(true);
    expect(uniqueZones.has('MID DOORS')).toBe(true);
    expect(uniqueZones.has('T MID')).toBe(true);
    expect(uniqueZones.has('B CONNECTOR')).toBe(true);
    expect(uniqueZones.has('B TUNNELS')).toBe(true);
    expect(uniqueZones.has('B SITE')).toBe(true);
    expect(uniqueZones.has('VANGUARD SPAWN')).toBe(true);
    expect(uniqueZones.has('SYNDICATE SPAWN')).toBe(true);
  });

  it('accurately resolves Vanguard CT Spawn', () => {
    expect(getCalloutName(0, 0, 38)).toBe('VANGUARD SPAWN');
  });

  it('accurately resolves Obsidian Syndicate T Spawn', () => {
    expect(getCalloutName(0, 0, -48)).toBe('SYNDICATE SPAWN');
  });

  it('accurately resolves Bombsite A (Armory)', () => {
    expect(getCalloutName(-32, 0, -30)).toBe('A SITE');
  });

  it('accurately resolves Bombsite B (Reactor)', () => {
    expect(getCalloutName(35, 0, -32)).toBe('B SITE');
  });

  it('accurately resolves elevated A Heaven Platform (+3.5m)', () => {
    expect(getCalloutName(-22, 3.5, -40)).toBe('A HEAVEN');
  });

  it('accurately resolves Mid Double Doors choke point', () => {
    expect(getCalloutName(3.0, 0, 0)).toBe('MID DOORS');
  });

  it('accurately resolves Covered B Tunnels', () => {
    expect(getCalloutName(44, 0, -5)).toBe('B TUNNELS');
  });

  it('accurately resolves A Long lane', () => {
    expect(getCalloutName(-48, 0, 10)).toBe('A LONG');
  });
});
