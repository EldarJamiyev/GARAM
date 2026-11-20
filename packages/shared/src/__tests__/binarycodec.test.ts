import { describe, it, expect } from 'vitest';
import {
  BinaryCodec,
  BINARY_MAGIC,
  BINARY_TYPE_SNAPSHOT,
  BINARY_TYPE_INPUT,
  BinarySnapshotData,
  BinaryInputData,
} from '../net/BinaryCodec.js';

describe('Zero-Copy Binary Codec (306B Snapshot & 22B Input)', () => {
  it('encodes and decodes 64Hz state snapshots with 10 players under 300 bytes', () => {
    const mockSnapshot: BinarySnapshotData = {
      tick: 12845,
      serverTimestamp: 1732000000123.45,
      lastAckSeq: 450,
      roundPhase: 'ROUND_LIVE',
      roundTime: 87,
      ctScore: 7,
      tScore: 5,
      bomb: {
        isPlanted: true,
        site: 'A',
        x: -30.5,
        y: 0.0,
        z: -28.2,
        plantProgress: 1.0,
        defuseProgress: 0.4,
        timeRemaining: 24.5,
      },
      players: Array.from({ length: 10 }, (_, i) => ({
        id: `player_${i}`,
        name: `Operator ${i + 1}`,
        team: i < 5 ? ('Vanguard' as const) : ('Syndicate' as const),
        x: -25.4 + i * 2.0,
        y: 0.15,
        z: 14.8 - i * 1.5,
        vx: 3.25,
        vy: -0.5,
        vz: 1.1,
        yaw: 1.25,
        pitch: -0.15,
        health: 85 - i * 5,
        armor: 100,
        hasHelmet: true,
        hasDefuseKit: i === 0,
        activeWeapon: i === 2 ? 'sovereign-awp' : 'garam-47',
        currentAmmo: 28,
        reserveAmmo: 90,
        isScoped: i === 2,
        isReloading: false,
        isCrouching: i === 1,
        isDead: i === 9,
        kills: 3,
        deaths: 1,
        ping: 25 + i * 2,
      })),
    };

    const encoded = BinaryCodec.encodeSnapshot(mockSnapshot);
    expect(encoded.byteLength).toBeLessThanOrEqual(306);
    expect(encoded.byteLength).toBe(34 + 10 * 26); // 294 bytes!

    const decoded = BinaryCodec.decodeSnapshot(encoded);
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(decoded.tick).toBe(12845);
    expect(decoded.serverTimestamp).toBeCloseTo(1732000000123.45, 1);
    expect(decoded.lastAckSeq).toBe(450);
    expect(decoded.roundPhase).toBe('ROUND_LIVE');
    expect(decoded.roundTime).toBe(87);
    expect(decoded.ctScore).toBe(7);
    expect(decoded.tScore).toBe(5);

    // Bomb state parity
    expect(decoded.bomb.isPlanted).toBe(true);
    expect(decoded.bomb.site).toBe('A');
    expect(decoded.bomb.x).toBeCloseTo(-30.5, 1);
    expect(decoded.bomb.z).toBeCloseTo(-28.2, 1);
    expect(decoded.bomb.timeRemaining).toBeCloseTo(24.5, 1);

    // Player state parity
    expect(decoded.players.length).toBe(10);
    const p0 = decoded.players[0];
    expect(p0.team).toBe('Vanguard');
    expect(p0.health).toBe(85);
    expect(p0.hasDefuseKit).toBe(true);
    expect(p0.x).toBeCloseTo(-25.4, 1);
    expect(p0.y).toBeCloseTo(0.15, 2);
    expect(p0.yaw).toBeCloseTo(1.25, 2);

    const p2 = decoded.players[2];
    expect(p2.activeWeapon).toBe('sovereign-awp');
    expect(p2.isScoped).toBe(true);
  });

  it('encodes and decodes 128Hz client inputs into exact 22-byte binary packets', () => {
    const mockInput: BinaryInputData = {
      seq: 9812,
      timestamp: 456789,
      weaponId: 'sovereign-awp',
      input: {
        forward: true,
        backward: false,
        left: false,
        right: true,
        jump: true,
        crouch: false,
        walk: false,
        yaw: 2.14,
        pitch: -0.45,
      },
    };

    const encoded = BinaryCodec.encodeInput(mockInput);
    expect(encoded.byteLength).toBe(22);

    const decoded = BinaryCodec.decodeInput(encoded);
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(decoded.seq).toBe(9812);
    expect(decoded.weaponId).toBe('sovereign-awp');
    expect(decoded.input.forward).toBe(true);
    expect(decoded.input.right).toBe(true);
    expect(decoded.input.jump).toBe(true);
    expect(decoded.input.backward).toBe(false);
    expect(decoded.input.crouch).toBe(false);
    expect(decoded.input.yaw).toBeCloseTo(2.14, 4);
    expect(decoded.input.pitch).toBeCloseTo(-0.45, 4);
  });

  it('safely rejects truncated, empty, or corrupted binary packets', () => {
    const invalidBuf = new ArrayBuffer(10);
    expect(BinaryCodec.decodeSnapshot(invalidBuf)).toBeNull();
    expect(BinaryCodec.decodeInput(invalidBuf)).toBeNull();

    const badMagicBuf = new ArrayBuffer(34);
    new DataView(badMagicBuf).setUint8(0, 0x00);
    expect(BinaryCodec.decodeSnapshot(badMagicBuf)).toBeNull();

    // Fuzz all buffer lengths from 0 to 21 bytes -> must return null with zero throws
    for (let len = 0; len < 22; len++) {
      const fuzzed = new ArrayBuffer(len);
      expect(BinaryCodec.decodeInput(fuzzed)).toBeNull();
    }
  });
});
