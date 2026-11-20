import { describe, it, expect } from 'vitest';
import {
  executeTacticalRaycast,
  hasLineOfSight,
  MapBlockCollider,
  TargetCollider,
  Ray,
  SmokeOccluder,
  WEAPONS
} from '../index.js';

describe('RaycastEngine & Ballistics', () => {
  it('concrete blocks are strictly impenetrable', () => {
    const wall: MapBlockCollider = {
      id: 'concrete_wall',
      name: 'Concrete Barrier',
      x: 0,
      y: 0,
      z: 5,
      w: 10,
      h: 4,
      d: 1.0,
      minX: -5,
      maxX: 5,
      minY: 0,
      maxY: 4,
      minZ: 4.5,
      maxZ: 5.5,
      material: 'CONCRETE',
    };

    const targetBehindWall: TargetCollider = {
      id: 'bot_target',
      name: 'Enemy',
      team: 'Syndicate',
      center: { x: 0, y: 0, z: 8 },
      armor: 100,
      hasHelmet: true,
      isDead: false,
    };

    const ray: Ray = {
      origin: { x: 0, y: 1.6, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
    };

    const hits = executeTacticalRaycast(
      ray,
      WEAPONS['garam-47'].damage,
      WEAPONS['garam-47'].armorPenetration,
      WEAPONS['garam-47'].penetrationPower,
      100,
      [wall],
      [targetBehindWall]
    );

    // Only wall hit; target behind concrete receives 0 damage
    expect(hits.length).toBe(1);
    expect(hits[0].material).toBe('CONCRETE');
    expect(hits.some(h => h.targetId === 'bot_target')).toBe(false);
  });

  it('thin wood crates allow wallbang penetration with damage attenuation', () => {
    const crate: MapBlockCollider = {
      id: 'wood_crate',
      name: 'Wood Crate',
      x: 0,
      y: 0,
      z: 4,
      w: 2,
      h: 2,
      d: 0.6,
      minX: -1,
      maxX: 1,
      minY: 0,
      maxY: 2,
      minZ: 3.7,
      maxZ: 4.3,
      material: 'WOOD_THIN',
    };

    const targetBehindCrate: TargetCollider = {
      id: 'bot_crate',
      name: 'Enemy Behind Crate',
      team: 'Syndicate',
      center: { x: 0, y: 0, z: 6 },
      armor: 100,
      hasHelmet: true,
      isDead: false,
    };

    const ray: Ray = {
      origin: { x: 0, y: 1.2, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
    };

    const hits = executeTacticalRaycast(
      ray,
      WEAPONS['garam-47'].damage,
      WEAPONS['garam-47'].armorPenetration,
      WEAPONS['garam-47'].penetrationPower,
      100,
      [crate],
      [targetBehindCrate]
    );

    // Both crate entry and target hit are present
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const targetHit = hits.find(h => h.targetId === 'bot_crate');
    expect(targetHit).toBeDefined();
    // Damage should be attenuated (less than raw 36 base damage)
    expect(targetHit!.awardedDamage).toBeLessThan(WEAPONS['garam-47'].damage);
    expect(targetHit!.awardedDamage).toBeGreaterThan(0);
  });

  it('5-zone hitboxes correctly apply headshot 4.0x multiplier', () => {
    const target: TargetCollider = {
      id: 'headshot_test',
      name: 'Test Dummy',
      team: 'Syndicate',
      center: { x: 0, y: 0, z: 5 },
      armor: 0,
      hasHelmet: false,
      isDead: false,
    };

    // Aim directly at head (head center is at y = 1.635)
    const ray: Ray = {
      origin: { x: 0, y: 1.635, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
    };

    const hits = executeTacticalRaycast(
      ray,
      30, // 30 raw damage
      0.775,
      200,
      50,
      [],
      [target]
    );

    const hit = hits.find(h => h.targetId === 'headshot_test');
    expect(hit).toBeDefined();
    expect(hit!.isHeadshot).toBe(true);
    expect(hit!.awardedDamage).toBe(120); // 30 * 4.0 = 120
  });

  it('registers downward vertical cylinder cap hits at steep pitch angles', () => {
    const target: TargetCollider = {
      id: 'vertical_cap_test',
      name: 'Below Player',
      team: 'Syndicate',
      center: { x: 0, y: 0, z: 3 },
      armor: 0,
      hasHelmet: false,
      isDead: false,
    };

    // Looking down from +3.5m platform onto target cylinder top cap
    const origin = { x: 0, y: 3.5, z: 1.0 };
    const toTarget = {
      x: 0 - origin.x,
      y: 1.75 - origin.y,
      z: 3 - origin.z,
    };
    const len = Math.hypot(toTarget.x, toTarget.y, toTarget.z);
    const direction = {
      x: toTarget.x / len,
      y: toTarget.y / len,
      z: toTarget.z / len,
    };

    const hits = executeTacticalRaycast(
      { origin, direction },
      WEAPONS['garam-47'].damage,
      WEAPONS['garam-47'].armorPenetration,
      WEAPONS['garam-47'].penetrationPower,
      50,
      [],
      [target]
    );

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].targetId).toBe('vertical_cap_test');
  });

  it('active smoke occluders block line of sight', () => {
    const eyeA = { x: 0, y: 1.6, z: 0 };
    const eyeB = { x: 0, y: 1.6, z: 10 };

    const clearLOS = hasLineOfSight(eyeA, eyeB, [], []);
    expect(clearLOS).toBe(true);

    const smoke: SmokeOccluder = {
      center: { x: 0, y: 1.5, z: 5 },
      radius: 4.8,
    };

    const blockedLOS = hasLineOfSight(eyeA, eyeB, [], [smoke]);
    expect(blockedLOS).toBe(false);
  });

  it('calculates realistic distance damage dropoff per 10m', () => {
    const targetNear: TargetCollider = {
      id: 'target_near',
      name: 'Near Target',
      team: 'Syndicate',
      center: { x: 0, y: 0, z: 10 },
      armor: 0,
      hasHelmet: false,
      isDead: false,
    };
    const targetFar: TargetCollider = {
      id: 'target_far',
      name: 'Far Target',
      team: 'Syndicate',
      center: { x: 0, y: 0, z: 50 },
      armor: 0,
      hasHelmet: false,
      isDead: false,
    };

    const rayNear: Ray = {
      origin: { x: 0, y: 1.3, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
    };
    const hitsNear = executeTacticalRaycast(
      rayNear,
      36, // Garam-47 base damage
      0.775,
      200,
      100,
      [],
      [targetNear],
      0.98
    );

    const hitsFar = executeTacticalRaycast(
      rayNear,
      36,
      0.775,
      200,
      100,
      [],
      [targetFar],
      0.98
    );

    expect(hitsNear[0].awardedDamage).toBeGreaterThan(hitsFar[0].awardedDamage);
    // At 10m: 36 * 0.98^1 = 35.28 -> 35
    // At 50m: 36 * 0.98^5 = 32.54 -> 33
    expect(hitsNear[0].awardedDamage).toBe(35);
    expect(hitsFar[0].awardedDamage).toBe(33);
  });

  it('accurately hits articulated bone hitboxes when provided', () => {
    const articulatedTarget: TargetCollider = {
      id: 'articulated_bot',
      name: 'Articulated Bot',
      team: 'Syndicate',
      center: { x: 5, y: 0, z: 10 },
      armor: 100,
      hasHelmet: true,
      isDead: false,
      hitboxes: {
        head: { x: 5.2, y: 1.72, z: 10.1 },
      },
    };

    // Aim directly at the articulated head position
    const toHead = {
      x: 5.2 - 0,
      y: 1.72 - 1.72,
      z: 10.1 - 0,
    };
    const len = Math.hypot(toHead.x, toHead.y, toHead.z);
    const ray: Ray = {
      origin: { x: 0, y: 1.72, z: 0 },
      direction: { x: toHead.x / len, y: toHead.y / len, z: toHead.z / len },
    };

    const hits = executeTacticalRaycast(
      ray,
      WEAPONS['garam-47'].damage,
      WEAPONS['garam-47'].armorPenetration,
      WEAPONS['garam-47'].penetrationPower,
      50,
      [],
      [articulatedTarget]
    );

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].hitZone).toBe('HEAD');
    expect(hits[0].isHeadshot).toBe(true);
  });

  it('Garam-47 penetrates 1.5m WOOD_THIN cover and awards lethal penetration damage (> 10 dmg)', () => {
    const crate: MapBlockCollider = {
      id: 'wood_crate_1',
      name: 'Site A Wood Crate',
      x: 0,
      y: 0,
      z: 5,
      w: 1.5,
      h: 2.0,
      d: 1.5,
      minX: -0.75,
      maxX: 0.75,
      minY: 0,
      maxY: 2.0,
      minZ: 4.25,
      maxZ: 5.75, // 1.5m thick along Z
      material: 'WOOD_THIN',
    };

    const target: TargetCollider = {
      id: 'enemy_behind_crate',
      name: 'Syndicate Defender',
      team: 'Syndicate',
      center: { x: 0, y: 0, z: 8 },
      armor: 0, // Unarmored target behind wood cover
      hasHelmet: false,
      isDead: false,
    };

    const ray: Ray = {
      origin: { x: 0, y: 1.35, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
    };

    const ak = WEAPONS['garam-47'];
    const hits = executeTacticalRaycast(
      ray,
      ak.damage,
      ak.armorPenetration,
      ak.penetrationPower,
      50,
      [crate],
      [target]
    );

    const targetHit = hits.find(h => h.targetId === 'enemy_behind_crate');
    expect(targetHit).toBeDefined();
    // With WOOD_THIN cost 10 and penPower 200, penFactor = 1.0:
    // Damage after 1.5m = 36 * 0.75 - 1.5 * 10 * 1.0 = 27 - 15 = 12 dmg > 10 dmg
    expect(targetHit?.awardedDamage).toBeGreaterThanOrEqual(10);
  });

  it('Desert Eagle 1-taps helmeted enemies up to 45m range with 0.87 damage dropoff', () => {
    const target: TargetCollider = {
      id: 'helmet_enemy_45m',
      name: 'Syndicate Sniper',
      team: 'Syndicate',
      center: { x: 0, y: 0, z: 45 },
      armor: 100,
      hasHelmet: true,
      isDead: false,
    };

    const deagle = WEAPONS['desert-eagle'];
    const ray: Ray = {
      origin: { x: 0, y: 1.66, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
    };

    const hits = executeTacticalRaycast(
      ray,
      deagle.damage,
      deagle.armorPenetration,
      deagle.penetrationPower,
      100,
      [],
      [target],
      deagle.damageDropoffPer10m
    );

    const headHit = hits.find(h => h.targetId === 'helmet_enemy_45m');
    expect(headHit).toBeDefined();
    expect(headHit?.hitZone).toBe('HEAD');
    expect(headHit?.awardedDamage).toBeGreaterThanOrEqual(100);
  });

  it('guarantees 100% pinpoint first-shot accuracy: sprayPattern[0] is strictly [0, 0] across all firearms', () => {
    const firearms = ['sovereign-awp', 'garam-47', 'vanguard-m4', 'desert-eagle'] as const;
    for (const id of firearms) {
      const wp = WEAPONS[id];
      expect(wp.sprayPattern.length).toBeGreaterThan(0);
      expect(wp.sprayPattern[0][0]).toBe(0);
      expect(wp.sprayPattern[0][1]).toBe(0);
    }
  });

  it('Sovereign AWP delivers lethal 1-shot chest kill at 30m and 60m with 0.0 vertical deflection', () => {
    const awp = WEAPONS['sovereign-awp'];
    expect(awp.sprayPattern[0]).toEqual([0, 0]);

    for (const dist of [30, 60]) {
      const target: TargetCollider = {
        id: `awp_target_${dist}m`,
        name: `Syndicate Defender @${dist}m`,
        team: 'Syndicate',
        center: { x: 0, y: 0, z: dist },
        armor: 100,
        hasHelmet: true,
        isDead: false,
      };

      // Ray aimed dead-center at chest (chest center is at y = 1.34) with 0.0 deflection
      const ray: Ray = {
        origin: { x: 0, y: 1.34, z: 0 },
        direction: { x: 0, y: 0, z: 1 },
      };

      const hits = executeTacticalRaycast(
        ray,
        awp.damage,
        awp.armorPenetration,
        awp.penetrationPower,
        100,
        [],
        [target],
        awp.damageDropoffPer10m
      );

      const chestHit = hits.find(h => h.targetId === `awp_target_${dist}m`);
      expect(chestHit).toBeDefined();
      expect(chestHit?.hitZone).toBe('CHEST');
      expect(chestHit?.awardedDamage).toBeGreaterThanOrEqual(100);
    }
  });

  it('Sovereign AWP fire rate is calibrated to 45 RPM yielding an exact 1.333s bolt cycle', () => {
    const awp = WEAPONS['sovereign-awp'];
    expect(awp.fireRateRpm).toBe(45);
    const boltCycleDuration = 60 / awp.fireRateRpm;
    expect(boltCycleDuration).toBeCloseTo(1.3333, 3);
  });

  it('100% silhouette coverage: registers low shin/boot hits down to y = 0.20m', () => {
    const target: TargetCollider = {
      id: 'standing_enemy',
      name: 'Peeking Shin',
      team: 'Syndicate',
      center: { x: 0, y: 0, z: 15 },
      armor: 100,
      hasHelmet: true,
      isDead: false,
    };

    const ray: Ray = {
      origin: { x: 0, y: 0.20, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
    };

    const hits = executeTacticalRaycast(
      ray,
      WEAPONS['garam-47'].damage,
      WEAPONS['garam-47'].armorPenetration,
      WEAPONS['garam-47'].penetrationPower,
      50,
      [],
      [target]
    );

    const hit = hits.find(h => h.targetId === 'standing_enemy');
    expect(hit).toBeDefined();
    expect(hit?.hitZone).toBe('LEGS');
  });

  it('100% silhouette coverage: registers outer peeking shoulder hits out to x = 0.40m', () => {
    const target: TargetCollider = {
      id: 'shoulder_enemy',
      name: 'Shoulder Peeker',
      team: 'Syndicate',
      center: { x: 0, y: 0, z: 20 },
      armor: 100,
      hasHelmet: true,
      isDead: false,
    };

    const ray: Ray = {
      origin: { x: 0.40, y: 1.30, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
    };

    const hits = executeTacticalRaycast(
      ray,
      WEAPONS['vanguard-m4'].damage,
      WEAPONS['vanguard-m4'].armorPenetration,
      WEAPONS['vanguard-m4'].penetrationPower,
      50,
      [],
      [target]
    );

    const hit = hits.find(h => h.targetId === 'shoulder_enemy');
    expect(hit).toBeDefined();
    expect(['ARMS', 'CHEST']).toContain(hit?.hitZone);
  });

  it('accurately hits crouched enemy headshot at y = 1.14m when isCrouched is true', () => {
    const crouchedTarget: TargetCollider = {
      id: 'crouched_enemy',
      name: 'Crouched Defender',
      team: 'Syndicate',
      center: { x: 0, y: 0, z: 25 },
      armor: 100,
      hasHelmet: true,
      isDead: false,
      isCrouched: true,
    };

    const ray: Ray = {
      origin: { x: 0, y: 1.14, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
    };

    const hits = executeTacticalRaycast(
      ray,
      WEAPONS['garam-47'].damage,
      WEAPONS['garam-47'].armorPenetration,
      WEAPONS['garam-47'].penetrationPower,
      50,
      [],
      [crouchedTarget]
    );

    const hit = hits.find(h => h.targetId === 'crouched_enemy');
    expect(hit).toBeDefined();
    expect(hit?.hitZone).toBe('HEAD');
    expect(hit?.isHeadshot).toBe(true);
  });
});
