import { describe, it, expect } from 'vitest';
import { validateClientPacket } from '../index.js';

describe('Authoritative Server Security & Input Sanitization', () => {
  it('strictly rejects prototype pollution attempts', () => {
    const maliciousPayload = JSON.parse('{"type":"join","callsign":"Hacker","faction":"Vanguard","__proto__":{"isAdmin":true}}');
    expect(validateClientPacket(maliciousPayload)).toBeNull();

    const constructorPayload = {
      type: 'join',
      callsign: 'Hacker',
      faction: 'Vanguard',
      constructor: { name: 'attacker' },
    };
    expect(validateClientPacket(constructorPayload)).toBeNull();
  });

  it('rejects XSS and malicious callsign strings', () => {
    // Malicious script tags
    expect(validateClientPacket({
      type: 'join',
      callsign: '<script>alert(1)</script>',
      faction: 'Vanguard',
    })).toBeNull();

    // Oversized callsign
    expect(validateClientPacket({
      type: 'join',
      callsign: 'A'.repeat(50),
      faction: 'Vanguard',
    })).toBeNull();

    // Invalid characters
    expect(validateClientPacket({
      type: 'join',
      callsign: 'Eldar; DROP TABLE',
      faction: 'Vanguard',
    })).toBeNull();

    // Valid callsigns pass
    const valid = validateClientPacket({
      type: 'join',
      callsign: 'Eldar Garamov',
      faction: 'Vanguard',
    });
    expect(valid).not.toBeNull();
    expect(valid?.type).toBe('join');
    if (valid && valid.type === 'join') {
      expect(valid.callsign).toBe('Eldar Garamov');
    }
  });

  it('rejects NaN, Infinity, and malformed numeric coordinates in input packets', () => {
    // NaN yaw
    expect(validateClientPacket({
      type: 'input',
      seq: 1,
      timestamp: Date.now(),
      weaponId: 'garam-47',
      input: {
        forward: true,
        backward: false,
        left: false,
        right: false,
        jump: false,
        crouch: false,
        walk: false,
        yaw: NaN,
        pitch: 0.1,
      },
    })).toBeNull();

    // Infinity pitch
    expect(validateClientPacket({
      type: 'input',
      seq: 2,
      timestamp: Date.now(),
      weaponId: 'garam-47',
      input: {
        forward: true,
        backward: false,
        left: false,
        right: false,
        jump: false,
        crouch: false,
        walk: false,
        yaw: 0.5,
        pitch: Infinity,
      },
    })).toBeNull();

    // Negative sequence number
    expect(validateClientPacket({
      type: 'input',
      seq: -5,
      timestamp: Date.now(),
      weaponId: 'garam-47',
      input: {
        forward: true,
        backward: false,
        left: false,
        right: false,
        jump: false,
        crouch: false,
        walk: false,
        yaw: 0.5,
        pitch: 0.1,
      },
    })).toBeNull();
  });

  it('validates fire packets and rejects NaN or invalid direction components', () => {
    // Invalid direction with NaN
    expect(validateClientPacket({
      type: 'fire',
      seq: 1,
      targetServerTime: 1000,
      weaponId: 'garam-47',
      direction: { x: NaN, y: 0, z: 1 },
      yaw: 0,
      pitch: 0,
    })).toBeNull();

    // Valid fire packet
    const validFire = validateClientPacket({
      type: 'fire',
      seq: 12,
      targetServerTime: 125000,
      weaponId: 'garam-47',
      direction: { x: 0, y: 0, z: -1 },
      yaw: 0,
      pitch: 0,
      isScoped: false,
    });

    expect(validFire).not.toBeNull();
    expect(validFire?.type).toBe('fire');
    if (validFire && validFire.type === 'fire') {
      expect(validFire.seq).toBe(12);
      expect(validFire.weaponId).toBe('garam-47');
      expect(validFire.direction.z).toBe(-1);
    }
  });

  it('validates buy and ping packets', () => {
    expect(validateClientPacket({ type: 'buy', item: 'garam-47' })).toEqual({
      type: 'buy',
      item: 'garam-47',
    });

    // Malicious SQL injection in buy item
    expect(validateClientPacket({ type: 'buy', item: "garam-47'; DELETE FROM weapons;--" })).toBeNull();

    // Valid ping
    const ping = validateClientPacket({ type: 'ping', timestamp: 123456789 });
    expect(ping).toEqual({ type: 'ping', timestamp: 123456789 });
  });
});
