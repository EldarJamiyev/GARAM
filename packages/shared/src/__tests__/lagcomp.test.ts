import { describe, it, expect } from 'vitest';
import { LagCompensation, SnapshotTarget } from '../net/LagCompensation.js';

describe('LagCompensation Hitbox Rewind Engine', () => {
  function makeTargets(x: number, y: number, z: number): SnapshotTarget[] {
    return [
      {
        id: 'bot_target_1',
        name: 'Syndicate Enemy',
        team: 'Syndicate',
        x,
        y,
        z,
        armor: 100,
        hasHelmet: true,
        isDead: false,
      },
    ];
  }

  it('records tick snapshots and retrieves un-rewound state at 0ms latency', () => {
    const lagComp = new LagCompensation();
    const now = 1000;

    lagComp.recordSnapshot(1, now, makeTargets(10, 0, 20));

    const targets = lagComp.getRewoundTargets(now, now);
    expect(targets.length).toBe(1);
    expect(targets[0].center.x).toBeCloseTo(10, 2);
    expect(targets[0].center.z).toBeCloseTo(20, 2);
  });

  it('accurately interpolates between tick frames at 40ms latency', () => {
    const lagComp = new LagCompensation();
    const t0 = 1000;
    const t1 = 1050; // 50ms later

    lagComp.recordSnapshot(1, t0, makeTargets(0, 0, 0));
    lagComp.recordSnapshot(2, t1, makeTargets(10, 0, 20));

    // Request rewind to t = 1025 (halfway between t0 and t1, which is 25ms in past from t1)
    const targets = lagComp.getRewoundTargets(t1, 1025);
    expect(targets.length).toBe(1);
    expect(targets[0].center.x).toBeCloseTo(5.0, 1);
    expect(targets[0].center.z).toBeCloseTo(10.0, 1);
  });

  it('accurately rewinds to exact boundary at 64ms baseline latency', () => {
    const lagComp = new LagCompensation();
    const serverTime = 1064;

    lagComp.recordSnapshot(1, 1000, makeTargets(0, 0, 0));
    lagComp.recordSnapshot(2, 1064, makeTargets(10, 0, 20));

    // Client shot fired at 1000ms (exactly 64ms in the past)
    const targets = lagComp.getRewoundTargets(serverTime, 1000);
    expect(targets.length).toBe(1);
    expect(targets[0].center.x).toBeCloseTo(0, 1);
    expect(targets[0].center.z).toBeCloseTo(0, 1);
  });

  it('strictly clamps excessive latency (250ms) to the 64ms tournament baseline cap without ping', () => {
    const lagComp = new LagCompensation();
    const serverTime = 1250;

    lagComp.recordSnapshot(1, 1000, makeTargets(0, 0, 0));     // 250ms in past
    lagComp.recordSnapshot(2, 1186, makeTargets(10, 0, 0));    // 64ms in past (1250 - 64 = 1186)
    lagComp.recordSnapshot(3, 1250, makeTargets(20, 0, 0));    // Current server time

    // Client claims 250ms latency (timestamp 1000) without ping
    const targets = lagComp.getRewoundTargets(serverTime, 1000);
    expect(targets.length).toBe(1);
    // Must clamp to 1186ms (64ms rewind cap), NOT 1000ms
    expect(targets[0].center.x).toBeCloseTo(10, 1);
  });

  it('adaptively clamps rewind window using half-RTT to prevent corner kills', () => {
    const lagComp = new LagCompensation();
    const serverTime = 1250;

    // Ping is 60ms: dynamic rewind = min(120, max(64, round(30 + 46.875 + 16))) = 93ms
    lagComp.recordSnapshot(1, 1100, makeTargets(0, 0, 0));     // 150ms in past
    lagComp.recordSnapshot(2, 1165, makeTargets(10, 0, 0));    // 85ms in past (1250 - 85 = 1165)
    lagComp.recordSnapshot(3, 1250, makeTargets(30, 0, 0));    // Current server time

    // Client with 60ms ping aimed at frame from 85ms ago (within 93ms half-RTT budget)
    const targets = lagComp.getRewoundTargets(serverTime, 1165, 60);
    expect(targets.length).toBe(1);
    expect(targets[0].center.x).toBeCloseTo(10, 1);

    // 300ms ping is strictly clamped at 120ms max ceiling
    lagComp.recordSnapshot(4, 1130, makeTargets(15, 0, 0));    // 120ms in past (1250 - 120 = 1130)
    const clampedTargets = lagComp.getRewoundTargets(serverTime, 1000, 300);
    expect(clampedTargets.length).toBe(1);
    expect(clampedTargets[0].center.x).toBeCloseTo(15, 1);
  });

  it('is immune to client local OS clock skew (+150ms or -150ms drift)', () => {
    const lagComp = new LagCompensation();
    const serverNow = 10000;

    lagComp.recordSnapshot(1, 9900, makeTargets(5, 0, 0));
    lagComp.recordSnapshot(2, 10000, makeTargets(15, 0, 0));

    // Client OS clock has +150ms drift (Date.now() = 10150), but client uses server-synced time:
    // estimatedServerNow = Date.now() - 150 = 10000
    // targetServerTime = 10000 - 46.875 = 9953.125
    const syncedTargetTime = serverNow - 46.875;
    const targets = lagComp.getRewoundTargets(serverNow, syncedTargetTime, 30);
    expect(targets.length).toBe(1);
    // Position interpolated smoothly between 5 and 15
    expect(targets[0].center.x).toBeGreaterThan(5);
    expect(targets[0].center.x).toBeLessThan(15);
  });

  it('preserves isCrouched posture and shortest-arc yaw interpolation across +-PI during rewind', () => {
    const lagComp = new LagCompensation();
    const t0 = 2000;
    const t1 = 2040;

    lagComp.recordSnapshot(1, t0, [
      {
        id: 'crouch_yaw_target',
        name: 'Crouched Operator',
        team: 'Syndicate',
        x: 0,
        y: 0,
        z: 10,
        armor: 100,
        hasHelmet: true,
        isDead: false,
        isCrouched: true,
        yaw: Math.PI - 0.1,
      },
    ]);
    lagComp.recordSnapshot(2, t1, [
      {
        id: 'crouch_yaw_target',
        name: 'Crouched Operator',
        team: 'Syndicate',
        x: 2,
        y: 0,
        z: 10,
        armor: 100,
        hasHelmet: true,
        isDead: false,
        isCrouched: false,
        yaw: -Math.PI + 0.1,
      },
    ]);

    // At t = 2010 (alpha = 0.25 -> closer to t0 crouch=true, yaw near +PI)
    const early = lagComp.getRewoundTargets(t1, 2010);
    expect(early[0].isCrouched).toBe(true);
    expect(Math.abs(early[0].yaw!)).toBeGreaterThan(Math.PI - 0.15);

    // At t = 2020 (alpha = 0.5 -> shortest arc between +PI-0.1 and -PI+0.1 passes through +-PI, NOT 0!)
    const mid = lagComp.getRewoundTargets(t1, 2020);
    expect(Math.abs(Math.abs(mid[0].yaw!) - Math.PI)).toBeLessThan(0.05);
  });
});
