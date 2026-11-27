import { describe, it, expect } from 'vitest';
import {
  WEAPONS,
  getMapDescriptor,
  isValidMapId,
  executeShotgunRaycast,
  isBlockedByTacticalShield,
  stepLadderMovement,
  computeAutoBuySequence,
  computeRebuySequence,
  evaluateHostageWinCondition,
  buildBotChatterLine,
  DE_NUKE_NAV_GRAPH,
  DE_INFERNO_NAV_GRAPH,
  FY_SNOW_NAV_GRAPH,
  DE_NUKE_LADDERS,
} from '../index.js';

describe('CS 1.6 Master Integration Pack Verification', () => {
  it('registers all 8 new CS 1.6 weapons + tactical shield with pinpoint sprayPattern[0]', () => {
    const ids = [
      'mp5-navy', 'clarion-famas', 'defender-galil', 'schmidt-scout',
      'p90', 'leone-m3', 'xm1014', 'dual-elites', 'tactical-shield',
    ];
    for (const id of ids) {
      const wp = WEAPONS[id];
      expect(wp, id).toBeDefined();
      if (wp.sprayPattern.length > 0) {
        expect(wp.sprayPattern[0]).toEqual([0, 0]);
      }
    }
    expect(WEAPONS['leone-m3'].pelletCount).toBe(9);
    expect(WEAPONS['xm1014'].pelletCount).toBe(6);
    expect(WEAPONS['schmidt-scout'].movementSpeed).toBeGreaterThanOrEqual(6.5);
  });

  it('registers de_nuke, de_inferno, fy_snow in MapRegistry with valid nav graphs & ladders', () => {
    for (const id of ['de_dust2', 'cs_office', 'de_nuke', 'de_inferno', 'fy_snow']) {
      expect(isValidMapId(id)).toBe(true);
      const desc = getMapDescriptor(id);
      expect(desc.colliders.length).toBeGreaterThan(5);
    }
    expect(DE_NUKE_LADDERS.length).toBe(4);
    expect(Object.keys(DE_NUKE_NAV_GRAPH).length).toBeGreaterThan(10);
    expect(Object.keys(DE_INFERNO_NAV_GRAPH).length).toBeGreaterThan(10);
    expect(Object.keys(FY_SNOW_NAV_GRAPH).length).toBeGreaterThanOrEqual(5);
  });

  it('computes multi-pellet shotgun fan and blocks frontal Tactical Shield hits except legs', () => {
    const outcomes = executeShotgunRaycast(
      { x: 0, y: 1.6, z: 0 }, 0, 0, 9, 0.068, 20, 0.5, 80, [], [], 0.65
    );
    expect(outcomes.length).toBe(9);
    expect(isBlockedByTacticalShield({ x: 0, y: 0, z: -1 }, Math.PI, true, 'CHEST')).toBe(true);
    expect(isBlockedByTacticalShield({ x: 0, y: 0, z: -1 }, Math.PI, true, 'LEGS')).toBe(false);
  });

  it('climbs ladder vertically on forward input without falling', () => {
    const state = {
      x: 18, y: 4.3, z: -13.2, vx: 0, vy: 0, vz: 0, yaw: Math.PI * 0.5, pitch: 0.6,
      isGrounded: false, isCrouching: false, isWalking: false, currentEyeHeight: 1.72,
    };
    const input = { forward: true, backward: false, left: false, right: false, jump: false, crouch: false, walk: false, yaw: Math.PI * 0.5, pitch: 0.6 };
    const stayed = stepLadderMovement(state, input, DE_NUKE_LADDERS[0], 1 / 64, [], { minX: -48, maxX: 48, minZ: -38, maxZ: 38 });
    expect(stayed).toBe(true);
    expect(state.y).toBeGreaterThan(4.3);
  });

  it('executes CS 1.6 AutoBuy, Rebuy, Hostage Win & BotChatter cleanly', () => {
    const buy = computeAutoBuySequence({
      faction: 'Vanguard', cash: 4800, currentPrimaryId: null, currentSecondaryId: 'usp-s',
      armor: 0, hasHelmet: false, hasDefuseKit: false, hasNightVision: false, ownedUtilities: {},
    });
    expect(buy).toContain('vanguard-m4');
    expect(buy).toContain('kevlar-helmet');
    expect(buy).toContain('defuse-kit');

    const rebuy = computeRebuySequence(
      { faction: 'Syndicate', cash: 3600, currentPrimaryId: null, currentSecondaryId: 'glock-18', armor: 0, hasHelmet: false, hasDefuseKit: false, hasNightVision: false, ownedUtilities: {} },
      { primaryWeaponId: 'garam-47', secondaryWeaponId: 'desert-eagle', armorTier: 'kevlar-helmet', hasDefuseKit: false, hasNightVision: false, utilities: ['smoke-grenade'] }
    );
    expect(rebuy[0]).toBe('garam-47');

    const win = evaluateHostageWinCondition([
      { id: 'h1', name: '1', pos: { x: 0, y: 0, z: 0 }, yaw: 0, health: 100, state: 'RESCUED', escortId: null },
      { id: 'h2', name: '2', pos: { x: 0, y: 0, z: 0 }, yaw: 0, health: 100, state: 'RESCUED', escortId: null },
      { id: 'h3', name: '3', pos: { x: 0, y: 0, z: 0 }, yaw: 0, health: 100, state: 'RESCUED', escortId: null },
      { id: 'h4', name: '4', pos: { x: 0, y: 0, z: 0 }, yaw: 0, health: 100, state: 'IDLE', escortId: null },
    ]);
    expect(win.isRoundOver).toBe(true);
    expect(win.winner).toBe('Vanguard');

    const chatter = buildBotChatterLine('ENEMY_SPOTTED', 'BANANA', 3);
    expect(chatter.text).toContain('BANANA');
  });
});
