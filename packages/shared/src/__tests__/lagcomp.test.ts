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

  it('accurately rewinds to exact boundary at 80ms latency', () => {
    const lagComp = new LagCompensation();
    const serverTime = 1080;

    lagComp.recordSnapshot(1, 1000, makeTargets(0, 0, 0));
    lagComp.recordSnapshot(2, 1080, makeTargets(10, 0, 20));

    // Client shot fired at 1000ms (exactly 80ms in the past)
    const targets = lagComp.getRewoundTargets(serverTime, 1000);
    expect(targets.length).toBe(1);
    expect(targets[0].center.x).toBeCloseTo(0, 1);
    expect(targets[0].center.z).toBeCloseTo(0, 1);
  });

  it('strictly clamps excessive latency (250ms) to the 80ms tournament cap', () => {
    const lagComp = new LagCompensation();
    const serverTime = 1250;

    lagComp.recordSnapshot(1, 1000, makeTargets(0, 0, 0));     // 250ms in past
    lagComp.recordSnapshot(2, 1170, makeTargets(10, 0, 0));    // 80ms in past (1250 - 80 = 1170)
    lagComp.recordSnapshot(3, 1250, makeTargets(20, 0, 0));    // Current server time

    // Client claims 250ms latency (timestamp 1000)
    const targets = lagComp.getRewoundTargets(serverTime, 1000);
    expect(targets.length).toBe(1);
    // Must clamp to 1170ms (80ms rewind cap), NOT 1000ms
    expect(targets[0].center.x).toBeCloseTo(10, 1);
  });
});
