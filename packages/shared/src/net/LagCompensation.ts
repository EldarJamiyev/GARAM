import { TargetCollider } from '../physics/RaycastEngine.js';

export interface SnapshotTarget {
  id: string;
  name: string;
  team: 'Vanguard' | 'Syndicate';
  x: number;
  y: number;
  z: number;
  armor: number;
  hasHelmet: boolean;
  isDead: boolean;
  isCrouched?: boolean;
  yaw?: number;
}

export interface TickHistorySnapshot {
  tick: number;
  timestamp: number; // Server wall clock time in ms
  targets: SnapshotTarget[];
  targetMap: Map<string, SnapshotTarget>;
}

function lerpAngle(a: number, b: number, alpha: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * alpha;
}

export class LagCompensation {
  private readonly MAX_HISTORY_TICKS = 64; // ~1000ms at 64 ticks
  private ring: Array<TickHistorySnapshot | null> = new Array(64).fill(null);
  private writeIndex = 0;
  private count = 0;

  public readonly MIN_LAG_COMPENSATION_MS = 64; // Base interpolation & jitter window (64ms)
  public readonly MAX_LAG_COMPENSATION_MS = 120; // Hard tournament ceiling (120ms max rewind)

  public recordSnapshot(tick: number, timestamp: number, targets: SnapshotTarget[]): void {
    const clonedTargets: SnapshotTarget[] = new Array(targets.length);
    const targetMap = new Map<string, SnapshotTarget>();

    for (let i = 0; i < targets.length; i++) {
      const copy: SnapshotTarget = { ...targets[i] };
      clonedTargets[i] = copy;
      targetMap.set(copy.id, copy);
    }

    this.ring[this.writeIndex] = {
      tick,
      timestamp,
      targets: clonedTargets,
      targetMap,
    };

    this.writeIndex = (this.writeIndex + 1) % this.MAX_HISTORY_TICKS;
    if (this.count < this.MAX_HISTORY_TICKS) {
      this.count++;
    }
  }

  /**
   * Rewinds target hitboxes to the exact client perspective timestamp,
   * dynamically bounded by half-RTT (rttMs * 0.5) + interpolation buffer (46.875ms) + jitter margin (16ms),
   * clamped strictly to [64ms, 120ms],
   * with smooth linear interpolation between historical snapshots and posture/yaw fidelity.
   */
  public getRewoundTargets(serverNow: number, targetServerTime: number, rttMs?: number): TargetCollider[] {
    if (this.count === 0) return [];

    // Dynamically clamp rewind: half-RTT transit plus 46.875ms interpolation window + 16ms jitter margin
    // Clamped strictly to [MIN_LAG_COMPENSATION_MS (64ms), MAX_LAG_COMPENSATION_MS (120ms)]
    const dynamicMaxRewind = rttMs !== undefined
      ? Math.min(this.MAX_LAG_COMPENSATION_MS, Math.max(this.MIN_LAG_COMPENSATION_MS, Math.round(rttMs * 0.5 + 46.875 + 16)))
      : this.MIN_LAG_COMPENSATION_MS;

    const minAllowedTime = serverNow - dynamicMaxRewind;
    const targetTime = Math.max(minAllowedTime, Math.min(serverNow, targetServerTime));

    // Find tightest bracketing snapshots surrounding targetTime (handles both monotonic and out-of-order entries)
    let older: TickHistorySnapshot | null = null;
    let newer: TickHistorySnapshot | null = null;
    let earliest: TickHistorySnapshot | null = null;

    for (let i = 0; i < this.count; i++) {
      const idx = (this.writeIndex - 1 - i + this.MAX_HISTORY_TICKS) % this.MAX_HISTORY_TICKS;
      const snap = this.ring[idx];
      if (!snap) continue;

      if (!earliest || snap.timestamp < earliest.timestamp) {
        earliest = snap;
      }
      if (snap.timestamp <= targetTime) {
        if (!older || snap.timestamp > older.timestamp) {
          older = snap;
        }
      }
      if (snap.timestamp >= targetTime) {
        if (!newer || snap.timestamp < newer.timestamp) {
          newer = snap;
        }
      }
    }

    if (!older) {
      older = earliest;
    }
    if (!older) return [];
    if (!newer) {
      newer = older;
    }

    // Calculate interpolation factor alpha [0..1]
    const timeSpan = newer.timestamp - older.timestamp;
    const alpha = timeSpan > 0.0001
      ? Math.max(0, Math.min(1, (targetTime - older.timestamp) / timeSpan))
      : 0;

    const rewound: TargetCollider[] = [];
    const olderTargets = older.targets;
    const newerMap = newer.targetMap;

    // Map targets with interpolated coordinates, crouch state, and yaw (O(1) targetMap lookup)
    for (let i = 0; i < olderTargets.length; i++) {
      const olderTarget = olderTargets[i];
      const newerTarget = newerMap.get(olderTarget.id) ?? olderTarget;

      const interpX = olderTarget.x + (newerTarget.x - olderTarget.x) * alpha;
      const interpY = olderTarget.y + (newerTarget.y - olderTarget.y) * alpha;
      const interpZ = olderTarget.z + (newerTarget.z - olderTarget.z) * alpha;
      const interpYaw = lerpAngle(olderTarget.yaw ?? 0, newerTarget.yaw ?? 0, alpha);
      const isCrouched = alpha >= 0.5 ? Boolean(newerTarget.isCrouched) : Boolean(olderTarget.isCrouched);

      rewound.push({
        id: olderTarget.id,
        name: olderTarget.name,
        team: olderTarget.team,
        center: { x: interpX, y: interpY, z: interpZ },
        armor: olderTarget.armor,
        hasHelmet: olderTarget.hasHelmet,
        isDead: olderTarget.isDead,
        isCrouched,
        yaw: interpYaw,
      });
    }

    return rewound;
  }
}
