import { ClientPacket } from './Protocol.js';

const CALLSIGN_REGEX = /^[A-Za-z0-9 _\-[\]\.]{2,20}$/;
const WEAPON_ID_REGEX = /^[a-z0-9\-]{2,32}$/;
const MAX_UINT32 = 0xFFFFFFFF;
const MAX_YAW_ABS = 1e5;
const MAX_PITCH_ABS = Math.PI / 2 + 0.1;
const MAX_VEC_ABS = 500;

function hasPrototypePollutionKey(value: unknown, depth = 0): boolean {
  if (depth > 5 || typeof value !== 'object' || value === null) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(value, '__proto__') ||
    Object.prototype.hasOwnProperty.call(value, 'constructor') ||
    Object.prototype.hasOwnProperty.call(value, 'prototype')
  ) {
    return true;
  }
  const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  for (let i = 0; i < entries.length; i++) {
    const child = entries[i];
    if (typeof child === 'object' && child !== null) {
      if (hasPrototypePollutionKey(child, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

function isValidSeq(seq: unknown): seq is number {
  return typeof seq === 'number' && Number.isInteger(seq) && seq >= 0 && seq <= MAX_UINT32;
}

function isValidAngles(yaw: unknown, pitch: unknown): boolean {
  return (
    typeof yaw === 'number' &&
    Number.isFinite(yaw) &&
    Math.abs(yaw) <= MAX_YAW_ABS &&
    typeof pitch === 'number' &&
    Number.isFinite(pitch) &&
    Math.abs(pitch) <= MAX_PITCH_ABS
  );
}

/**
 * Validates and sanitizes raw packets received from untrusted clients over WebSocket.
 * Rejects nested prototype pollution, infinite/NaN/out-of-bounds coordinates, oversized payloads, and invalid types.
 */
export function validateClientPacket(raw: unknown): ClientPacket | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }

  // Recursively reject prototype pollution attempts at any nested depth
  if (hasPrototypePollutionKey(raw)) {
    return null;
  }

  const packet = raw as Record<string, unknown>;
  const type = packet.type;
  if (typeof type !== 'string') return null;

  switch (type) {
    case 'join': {
      if (typeof packet.callsign !== 'string') return null;
      const trimmed = packet.callsign.trim();
      if (!CALLSIGN_REGEX.test(trimmed)) return null;

      const faction = packet.faction;
      if (faction !== 'Vanguard' && faction !== 'Syndicate') return null;

      return {
        type: 'join',
        callsign: trimmed,
        faction,
      };
    }

    case 'input': {
      if (!isValidSeq(packet.seq)) {
        return null;
      }
      if (typeof packet.timestamp !== 'number' || !Number.isFinite(packet.timestamp) || packet.timestamp <= 0) {
        return null;
      }
      if (typeof packet.weaponId !== 'string' || !WEAPON_ID_REGEX.test(packet.weaponId)) {
        return null;
      }

      const input = packet.input;
      if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
      const inp = input as Record<string, unknown>;

      if (!isValidAngles(inp.yaw, inp.pitch)) return null;

      return {
        type: 'input',
        seq: packet.seq,
        timestamp: packet.timestamp,
        weaponId: packet.weaponId,
        input: {
          forward: Boolean(inp.forward),
          backward: Boolean(inp.backward),
          left: Boolean(inp.left),
          right: Boolean(inp.right),
          jump: Boolean(inp.jump),
          crouch: Boolean(inp.crouch),
          walk: Boolean(inp.walk),
          yaw: inp.yaw as number,
          pitch: inp.pitch as number,
        },
      };
    }

    case 'fire': {
      if (!isValidSeq(packet.seq)) {
        return null;
      }
      if (
        typeof packet.targetServerTime !== 'number' ||
        !Number.isFinite(packet.targetServerTime) ||
        packet.targetServerTime <= 0
      ) {
        return null;
      }
      if (typeof packet.weaponId !== 'string' || !WEAPON_ID_REGEX.test(packet.weaponId)) {
        return null;
      }
      if (!isValidAngles(packet.yaw, packet.pitch)) return null;

      const dir = packet.direction;
      if (typeof dir !== 'object' || dir === null || Array.isArray(dir)) return null;
      const d = dir as Record<string, unknown>;
      if (typeof d.x !== 'number' || !Number.isFinite(d.x) || Math.abs(d.x) > MAX_VEC_ABS) return null;
      if (typeof d.y !== 'number' || !Number.isFinite(d.y) || Math.abs(d.y) > MAX_VEC_ABS) return null;
      if (typeof d.z !== 'number' || !Number.isFinite(d.z) || Math.abs(d.z) > MAX_VEC_ABS) return null;

      return {
        type: 'fire',
        seq: packet.seq,
        targetServerTime: packet.targetServerTime,
        weaponId: packet.weaponId,
        direction: { x: d.x, y: d.y, z: d.z },
        yaw: packet.yaw as number,
        pitch: packet.pitch as number,
        isSecondaryMelee: packet.isSecondaryMelee ? true : false,
        isScoped: packet.isScoped ? true : false,
      };
    }

    case 'reload':
      return { type: 'reload' };

    case 'buy': {
      if (typeof packet.item !== 'string' || !/^[a-z0-9_\-]{2,32}$/.test(packet.item)) {
        return null;
      }
      return { type: 'buy', item: packet.item };
    }

    case 'utility_throw': {
      if (typeof packet.utilityType !== 'string' || !WEAPON_ID_REGEX.test(packet.utilityType)) {
        return null;
      }
      if (packet.mode !== 'long' && packet.mode !== 'medium' && packet.mode !== 'short') {
        return null;
      }

      const checkVec = (v: unknown): { x: number; y: number; z: number } | null => {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
        const o = v as Record<string, unknown>;
        if (typeof o.x !== 'number' || !Number.isFinite(o.x) || Math.abs(o.x) > MAX_VEC_ABS) return null;
        if (typeof o.y !== 'number' || !Number.isFinite(o.y) || Math.abs(o.y) > MAX_VEC_ABS) return null;
        if (typeof o.z !== 'number' || !Number.isFinite(o.z) || Math.abs(o.z) > MAX_VEC_ABS) return null;
        return { x: o.x, y: o.y, z: o.z };
      };

      const origin = checkVec(packet.origin);
      const direction = checkVec(packet.direction);
      const velocity = checkVec(packet.velocity);
      if (!origin || !direction || !velocity) return null;

      return {
        type: 'utility_throw',
        utilityType: packet.utilityType,
        mode: packet.mode,
        origin,
        direction,
        velocity,
      };
    }

    case 'plant_defuse': {
      if (packet.action !== 'plant' && packet.action !== 'defuse' && packet.action !== 'cancel') {
        return null;
      }
      return { type: 'plant_defuse', action: packet.action };
    }

    case 'ping': {
      if (typeof packet.timestamp !== 'number' || !Number.isFinite(packet.timestamp)) {
        return null;
      }
      return { type: 'ping', timestamp: packet.timestamp };
    }

    case 'pong_challenge': {
      if (!isValidSeq(packet.nonce)) {
        return null;
      }
      return { type: 'pong_challenge', nonce: packet.nonce };
    }

    default:
      return null;
  }
}
