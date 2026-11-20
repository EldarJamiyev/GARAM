import { PlayerInput } from '../physics/KinematicPlayerController.js';
import { NetOperatorState, NetBombState } from './Protocol.js';

export const BINARY_MAGIC = 0x47; // 'G'
export const BINARY_TYPE_SNAPSHOT = 0x01;
export const BINARY_TYPE_INPUT = 0x02;

export const WEAPON_TO_INDEX: Record<string, number> = {
  'garam-47': 0,
  'vanguard-m4': 1,
  'sovereign-awp': 2,
  'desert-eagle': 3,
  'garam-karambit': 4,
  'smoke-grenade': 5,
  'flashbang': 6,
  'he-grenade': 7,
  'molotov': 8,
};

export const INDEX_TO_WEAPON: string[] = [
  'garam-47',
  'vanguard-m4',
  'sovereign-awp',
  'desert-eagle',
  'garam-karambit',
  'smoke-grenade',
  'flashbang',
  'he-grenade',
  'molotov',
];

export interface BinarySnapshotData {
  tick: number;
  serverTimestamp: number;
  lastAckSeq: number;
  roundPhase: 'FREEZE_TIME' | 'ROUND_LIVE' | 'ROUND_END';
  roundTime: number;
  ctScore: number;
  tScore: number;
  bomb: NetBombState;
  players: NetOperatorState[];
}

export interface BinaryInputData {
  seq: number;
  timestamp: number;
  input: PlayerInput;
  weaponId: string;
}

const SNAPSHOT_HEADER_BYTES = 36;
const SNAPSHOT_PLAYER_STRIDE = 29;
const MAX_SNAPSHOT_PLAYERS = 16;

export class BinaryCodec {
  // Pre-allocated static scratch buffers to achieve 0 runtime GC allocations during network ticks
  private static readonly SNAPSHOT_BUFFER = new ArrayBuffer(640);
  private static readonly SNAPSHOT_VIEW = new DataView(BinaryCodec.SNAPSHOT_BUFFER);

  private static readonly INPUT_BUFFER = new ArrayBuffer(22);
  private static readonly INPUT_VIEW = new DataView(BinaryCodec.INPUT_BUFFER);

  /**
   * Encodes a 64Hz server state snapshot into a compact zero-copy binary buffer (36 + 29*N bytes).
   */
  public static encodeSnapshot(snap: BinarySnapshotData): ArrayBuffer {
    const view = BinaryCodec.SNAPSHOT_VIEW;

    view.setUint8(0, BINARY_MAGIC);
    view.setUint8(1, BINARY_TYPE_SNAPSHOT);
    view.setUint32(2, snap.tick, true);
    view.setFloat64(6, snap.serverTimestamp, true);
    view.setUint32(14, snap.lastAckSeq, true);

    const phaseId = snap.roundPhase === 'FREEZE_TIME' ? 0 : snap.roundPhase === 'ROUND_LIVE' ? 1 : 2;
    view.setUint8(18, phaseId);
    view.setUint16(19, Math.max(0, Math.min(65535, Math.round(snap.roundTime))), true);
    view.setUint8(21, snap.ctScore & 0xff);
    view.setUint8(22, snap.tScore & 0xff);

    // Bomb State (12 bytes: planted, site, xyz, timeRemaining, plantProgress, defuseProgress)
    view.setUint8(23, snap.bomb.isPlanted ? 1 : 0);
    view.setUint8(24, snap.bomb.site === 'A' ? 1 : snap.bomb.site === 'B' ? 2 : 0);
    view.setInt16(25, Math.round(snap.bomb.x * 10), true);
    view.setInt16(27, Math.round(snap.bomb.y * 10), true);
    view.setInt16(29, Math.round(snap.bomb.z * 10), true);
    view.setUint16(31, Math.round(Math.max(0, snap.bomb.timeRemaining) * 10), true);
    view.setUint8(33, Math.max(0, Math.min(255, Math.round(snap.bomb.plantProgress * 255))));
    view.setUint8(34, Math.max(0, Math.min(255, Math.round(snap.bomb.defuseProgress * 255))));

    const count = Math.min(MAX_SNAPSHOT_PLAYERS, snap.players.length);
    view.setUint8(35, count);

    let offset = SNAPSHOT_HEADER_BYTES;

    for (let i = 0; i < count; i++) {
      const p = snap.players[i];

      // Authoritative collision-free entitySlot (0..255), falling back to unique index i
      const slot =
        typeof p.entitySlot === 'number' && Number.isInteger(p.entitySlot) && p.entitySlot >= 0 && p.entitySlot <= 255
          ? p.entitySlot
          : i;
      view.setUint8(offset, slot);
      view.setUint8(offset + 1, p.team === 'Vanguard' ? 0 : 1);

      let flags = 0;
      if (p.isDead) flags |= 1 << 0;
      if (p.hasHelmet) flags |= 1 << 1;
      if (p.hasDefuseKit) flags |= 1 << 2;
      if (p.isScoped) flags |= 1 << 3;
      if (p.isReloading) flags |= 1 << 4;
      if (p.isCrouching) flags |= 1 << 5;
      view.setUint8(offset + 2, flags);

      view.setUint8(offset + 3, Math.max(0, Math.min(100, Math.round(p.health))));
      view.setUint8(offset + 4, Math.max(0, Math.min(100, Math.round(p.armor))));
      const weaponName = p.activeWeapon || (p as unknown as { activeWeaponId?: string }).activeWeaponId || 'garam-47';
      view.setUint8(offset + 5, WEAPON_TO_INDEX[weaponName] ?? 0);

      // Quantized Position (x, z: 2cm resolution, y: 1cm resolution)
      view.setInt16(offset + 6, Math.round(p.x * 50), true);
      view.setInt16(offset + 8, Math.round(p.y * 100), true);
      view.setInt16(offset + 10, Math.round(p.z * 50), true);

      // Quantized Velocity (1cm/s resolution)
      view.setInt16(offset + 12, Math.round(p.vx * 100), true);
      view.setInt16(offset + 14, Math.round(p.vy * 100), true);
      view.setInt16(offset + 16, Math.round(p.vz * 100), true);

      // Quantized Angles: Yaw packed into overflow-proof Uint16 [0..65535], Pitch clamped to Int16 [-32767..32767]
      const safeYaw = Number.isFinite(p.yaw) ? p.yaw : 0;
      const safePitch = Number.isFinite(p.pitch) ? p.pitch : 0;
      const wrappedYaw = ((safeYaw % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      const quantizedYaw = Math.max(0, Math.min(65535, Math.round(((wrappedYaw + Math.PI) / (Math.PI * 2)) * 65535)));
      const normPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, safePitch));
      const quantizedPitch = Math.max(-32767, Math.min(32767, Math.round((normPitch / (Math.PI / 2)) * 32767)));

      view.setUint16(offset + 18, quantizedYaw, true);
      view.setInt16(offset + 20, quantizedPitch, true);

      view.setUint8(offset + 22, p.kills & 0xff);
      view.setUint8(offset + 23, p.deaths & 0xff);
      view.setUint16(offset + 24, Math.max(0, Math.min(65535, Math.round(p.ping))), true);

      // Live ammo state (uint8 mag + uint16 reserve)
      view.setUint8(offset + 26, Math.max(0, Math.min(255, Math.round(p.currentAmmo))));
      view.setUint16(offset + 27, Math.max(0, Math.min(65535, Math.round(p.reserveAmmo))), true);

      offset += SNAPSHOT_PLAYER_STRIDE;
    }

    return BinaryCodec.SNAPSHOT_BUFFER.slice(0, offset);
  }

  /**
   * Decodes a binary state snapshot back into a strongly-typed snapshot packet.
   */
  public static decodeSnapshot(buffer: ArrayBuffer | ArrayBufferLike): BinarySnapshotData | null {
    if (!buffer || buffer.byteLength < SNAPSHOT_HEADER_BYTES) return null;
    const view = new DataView(buffer as ArrayBuffer);

    if (view.getUint8(0) !== BINARY_MAGIC || view.getUint8(1) !== BINARY_TYPE_SNAPSHOT) {
      return null;
    }

    const tick = view.getUint32(2, true);
    const serverTimestamp = view.getFloat64(6, true);
    const lastAckSeq = view.getUint32(14, true);

    const phaseId = view.getUint8(18);
    const roundPhase = phaseId === 0 ? 'FREEZE_TIME' : phaseId === 1 ? 'ROUND_LIVE' : 'ROUND_END';
    const roundTime = view.getUint16(19, true);
    const ctScore = view.getUint8(21);
    const tScore = view.getUint8(22);

    const isPlanted = view.getUint8(23) === 1;
    const siteId = view.getUint8(24);
    const site = siteId === 1 ? 'A' : siteId === 2 ? 'B' : null;
    const bombX = view.getInt16(25, true) / 10;
    const bombY = view.getInt16(27, true) / 10;
    const bombZ = view.getInt16(29, true) / 10;
    const timeRemaining = view.getUint16(31, true) / 10;
    const plantProgress = view.getUint8(33) / 255;
    const defuseProgress = view.getUint8(34) / 255;

    const count = view.getUint8(35);
    if (count > MAX_SNAPSHOT_PLAYERS || buffer.byteLength < SNAPSHOT_HEADER_BYTES + count * SNAPSHOT_PLAYER_STRIDE) {
      return null;
    }

    const players: NetOperatorState[] = [];
    let offset = SNAPSHOT_HEADER_BYTES;

    for (let i = 0; i < count; i++) {
      if (offset + SNAPSHOT_PLAYER_STRIDE > buffer.byteLength) break;

      const slot = view.getUint8(offset);
      const teamId = view.getUint8(offset + 1);
      const team: 'Vanguard' | 'Syndicate' = teamId === 0 ? 'Vanguard' : 'Syndicate';
      const flags = view.getUint8(offset + 2);

      const isDead = (flags & (1 << 0)) !== 0;
      const hasHelmet = (flags & (1 << 1)) !== 0;
      const hasDefuseKit = (flags & (1 << 2)) !== 0;
      const isScoped = (flags & (1 << 3)) !== 0;
      const isReloading = (flags & (1 << 4)) !== 0;
      const isCrouching = (flags & (1 << 5)) !== 0;

      const health = view.getUint8(offset + 3);
      const armor = view.getUint8(offset + 4);
      const weaponIdx = view.getUint8(offset + 5);
      const activeWeapon = INDEX_TO_WEAPON[weaponIdx] || 'garam-47';

      const x = view.getInt16(offset + 6, true) / 50;
      const y = view.getInt16(offset + 8, true) / 100;
      const z = view.getInt16(offset + 10, true) / 50;

      const vx = view.getInt16(offset + 12, true) / 100;
      const vy = view.getInt16(offset + 14, true) / 100;
      const vz = view.getInt16(offset + 16, true) / 100;

      const rawYaw = view.getUint16(offset + 18, true);
      const yaw = (rawYaw / 65535) * (Math.PI * 2) - Math.PI;

      const rawPitch = view.getInt16(offset + 20, true);
      const pitch = (Math.max(-32767, Math.min(32767, rawPitch)) / 32767) * (Math.PI / 2);

      const kills = view.getUint8(offset + 22);
      const deaths = view.getUint8(offset + 23);
      const ping = view.getUint16(offset + 24, true);

      const currentAmmo = view.getUint8(offset + 26);
      const reserveAmmo = view.getUint16(offset + 27, true);

      players.push({
        id: `slot_${slot}`,
        entitySlot: slot,
        name: `Operator ${slot + 1}`,
        team,
        x,
        y,
        z,
        vx,
        vy,
        vz,
        yaw,
        pitch,
        health,
        armor,
        hasHelmet,
        hasDefuseKit,
        activeWeapon,
        currentAmmo,
        reserveAmmo,
        isScoped,
        isReloading,
        isCrouching,
        isDead,
        kills,
        deaths,
        ping,
      });

      offset += SNAPSHOT_PLAYER_STRIDE;
    }

    return {
      tick,
      serverTimestamp,
      lastAckSeq,
      roundPhase,
      roundTime,
      ctScore,
      tScore,
      bomb: {
        isPlanted,
        site,
        x: bombX,
        y: bombY,
        z: bombZ,
        plantProgress,
        defuseProgress,
        timeRemaining,
      },
      players,
    };
  }

  /**
   * Encodes a 128Hz client user input frame into an exact 22-byte binary packet.
   */
  public static encodeInput(data: BinaryInputData): ArrayBuffer {
    const view = BinaryCodec.INPUT_VIEW;

    view.setUint8(0, BINARY_MAGIC);
    view.setUint8(1, BINARY_TYPE_INPUT);
    view.setUint32(2, data.seq >>> 0, true);
    // Unsigned monotonic relative millisecond timestamp (mod 2^32, ~49.7 days wrap)
    view.setUint32(6, Math.max(0, Math.floor(data.timestamp)) >>> 0, true);

    let bits = 0;
    if (data.input.forward) bits |= 1 << 0;
    if (data.input.backward) bits |= 1 << 1;
    if (data.input.left) bits |= 1 << 2;
    if (data.input.right) bits |= 1 << 3;
    if (data.input.jump) bits |= 1 << 4;
    if (data.input.crouch) bits |= 1 << 5;
    if (data.input.walk) bits |= 1 << 6;

    view.setUint16(10, bits, true);
    view.setUint8(12, WEAPON_TO_INDEX[data.weaponId] ?? 0);
    view.setFloat32(13, data.input.yaw, true);
    view.setFloat32(17, data.input.pitch, true);
    view.setUint8(21, 0); // reserved

    return BinaryCodec.INPUT_BUFFER.slice(0, 22);
  }

  /**
   * Decodes a 22-byte binary client input frame on the authoritative server.
   */
  public static decodeInput(buffer: ArrayBuffer | ArrayBufferLike): BinaryInputData | null {
    if (!buffer || buffer.byteLength !== 22) return null;
    const view = new DataView(buffer as ArrayBuffer);

    if (view.getUint8(0) !== BINARY_MAGIC || view.getUint8(1) !== BINARY_TYPE_INPUT) {
      return null;
    }

    const seq = view.getUint32(2, true);
    const timestamp = view.getUint32(6, true);
    const bits = view.getUint16(10, true);

    const forward = (bits & (1 << 0)) !== 0;
    const backward = (bits & (1 << 1)) !== 0;
    const left = (bits & (1 << 2)) !== 0;
    const right = (bits & (1 << 3)) !== 0;
    const jump = (bits & (1 << 4)) !== 0;
    const crouch = (bits & (1 << 5)) !== 0;
    const walk = (bits & (1 << 6)) !== 0;

    const weaponIdx = view.getUint8(12);
    const weaponId = INDEX_TO_WEAPON[weaponIdx] || 'garam-47';

    const rawYaw = view.getFloat32(13, true);
    const rawPitch = view.getFloat32(17, true);
    const yaw = Number.isFinite(rawYaw) ? rawYaw : 0;
    const pitch = Number.isFinite(rawPitch) ? Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rawPitch)) : 0;

    return {
      seq,
      timestamp,
      weaponId,
      input: {
        forward,
        backward,
        left,
        right,
        jump,
        crouch,
        walk,
        yaw,
        pitch,
      },
    };
  }
}
