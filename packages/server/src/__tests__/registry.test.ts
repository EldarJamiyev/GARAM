import { describe, it, expect, afterEach } from 'vitest';
import { RoomRegistry } from '../RoomRegistry.js';

describe('Authoritative RoomRegistry & Dynamic Lifecycle Suite', () => {
  let registry: RoomRegistry;

  afterEach(() => {
    if (registry) {
      registry.stopAll();
    }
  });

  it('initializes with default GRM-CITADEL competitive room', () => {
    registry = new RoomRegistry();
    expect(registry.getRoomCount()).toBe(1);
    expect(registry.get('GRM-CITADEL')).toBeDefined();
  });

  it('creates and caches named rooms case-insensitively', () => {
    registry = new RoomRegistry();
    const { room: r1, code: c1 } = registry.getOrCreate('grm-alpha');
    expect(c1).toBe('GRM-ALPHA');

    const { room: r2 } = registry.getOrCreate('GRM-ALPHA');
    expect(r2).toBe(r1);
    expect(registry.getRoomCount()).toBe(2);
  });

  it('generates unique GRM-XXX room codes', () => {
    registry = new RoomRegistry();
    const { room, code } = registry.createUniqueRoom();
    expect(code).toMatch(/^GRM-[A-Z0-9]{3}$/);
    expect(room).toBeDefined();
    expect(registry.get(code)).toBe(room);
  });

  it('reaps dynamic rooms after 60s idle while strictly protecting default GRM-CITADEL lobby', () => {
    registry = new RoomRegistry();
    const { code } = registry.getOrCreate('GRM-TEMP');
    expect(registry.getRoomCount()).toBe(2);

    const now = 1000000;
    // First pass at t=1000000: marks room empty
    registry.reapIdleRooms(now);
    expect(registry.getRoomCount()).toBe(2);

    // Second pass at t=1000030 (30s later): still within 60s window
    registry.reapIdleRooms(now + 30000);
    expect(registry.getRoomCount()).toBe(2);

    // Third pass at t=1000065 (65s later): reaps GRM-TEMP
    const reaped = registry.reapIdleRooms(now + 65000);
    expect(reaped).toContain('GRM-TEMP');
    expect(registry.getRoomCount()).toBe(1);
    expect(registry.get('GRM-CITADEL')).toBeDefined();
  });
});
