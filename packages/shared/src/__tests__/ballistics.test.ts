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
});
