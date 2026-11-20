import { ClientPacket } from './Protocol.js';

const CALLSIGN_REGEX = /^[A-Za-z0-9 _\-[\]\.]{2,20}$/;
const WEAPON_ID_REGEX = /^[a-z0-9\-]{2,32}$/;

/**
 * Validates and sanitizes raw packets received from untrusted clients over WebSocket.
 * Rejects prototype pollution, infinite/NaN coordinates, oversized payloads, and invalid types.
 */
export function validateClientPacket(raw: unknown): ClientPacket | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }

  // Reject prototype pollution attempts
  if (
    Object.prototype.hasOwnProperty.call(raw, '__proto__') ||
    Object.prototype.hasOwnProperty.call(raw, 'constructor') ||
    Object.prototype.hasOwnProperty.call(raw, 'prototype')
  ) {
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
      if (typeof packet.seq !== 'number' || !Number.isInteger(packet.seq) || packet.seq < 0) {
        return null;
      }
      if (typeof packet.timestamp !== 'number' || !Number.isFinite(packet.timestamp) || packet.timestamp <= 0) {
        return null;
      }
      if (typeof packet.weaponId !== 'string' || !WEAPON_ID_REGEX.test(packet.weaponId)) {
        return null;
      }

      const input = packet.input;
      if (typeof input !== 'object' || input === null) return null;
      const inp = input as Record<string, unknown>;

      if (typeof inp.yaw !== 'number' || !Number.isFinite(inp.yaw)) return null;
      if (typeof inp.pitch !== 'number' || !Number.isFinite(inp.pitch)) return null;

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
          yaw: inp.yaw,
          pitch: inp.pitch,
        },
      };
    }

    case 'fire': {
      if (typeof packet.seq !== 'number' || !Number.isInteger(packet.seq) || packet.seq < 0) {
        return null;
      }
      if (typeof packet.targetServerTime !== 'number' || !Number.isFinite(packet.targetServerTime) || packet.targetServerTime <= 0) {
        return null;
      }
      if (typeof packet.weaponId !== 'string' || !WEAPON_ID_REGEX.test(packet.weaponId)) {
        return null;
      }
      if (typeof packet.yaw !== 'number' || !Number.isFinite(packet.yaw)) return null;
      if (typeof packet.pitch !== 'number' || !Number.isFinite(packet.pitch)) return null;

      const dir = packet.direction;
      if (typeof dir !== 'object' || dir === null) return null;
      const d = dir as Record<string, unknown>;
      if (typeof d.x !== 'number' || !Number.isFinite(d.x)) return null;
      if (typeof d.y !== 'number' || !Number.isFinite(d.y)) return null;
      if (typeof d.z !== 'number' || !Number.isFinite(d.z)) return null;

      return {
        type: 'fire',
        seq: packet.seq,
        targetServerTime: packet.targetServerTime,
        weaponId: packet.weaponId,
        direction: { x: d.x, y: d.y, z: d.z },
        yaw: packet.yaw,
        pitch: packet.pitch,
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
        if (typeof v !== 'object' || v === null) return null;
        const o = v as Record<string, unknown>;
        if (typeof o.x !== 'number' || !Number.isFinite(o.x)) return null;
        if (typeof o.y !== 'number' || !Number.isFinite(o.y)) return null;
        if (typeof o.z !== 'number' || !Number.isFinite(o.z)) return null;
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
      if (typeof packet.nonce !== 'number' || !Number.isInteger(packet.nonce) || packet.nonce < 0) {
        return null;
      }
      return { type: 'pong_challenge', nonce: packet.nonce };
    }

    default:
      return null;
  }
}
