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
}

function lerpAngle(a: number, b: number, alpha: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * alpha;
}

export class LagCompensation {
  private history: TickHistorySnapshot[] = [];
  private readonly MAX_HISTORY_TICKS = 64; // ~1000ms at 64 ticks
  public readonly MIN_LAG_COMPENSATION_MS = 64; // Base interpolation & jitter window (64ms)
  public readonly MAX_LAG_COMPENSATION_MS = 120; // Hard tournament ceiling (120ms max rewind)

  public recordSnapshot(tick: number, timestamp: number, targets: SnapshotTarget[]): void {
    const snapshot: TickHistorySnapshot = {
      tick,
      timestamp,
      targets: targets.map(t => ({ ...t })),
    };

    this.history.push(snapshot);
    if (this.history.length > this.MAX_HISTORY_TICKS) {
      this.history.shift();
    }
  }

  /**
   * Rewinds target hitboxes to the exact client perspective timestamp,
   * dynamically bounded by half-RTT (pingMs * 0.5) + interpolation buffer (46.875ms) + jitter margin (16ms),
   * clamped strictly to [64ms, 120ms],
   * with smooth linear interpolation between historical snapshots and posture/yaw fidelity.
   */
  public getRewoundTargets(serverNow: number, targetServerTime: number, pingMs?: number): TargetCollider[] {
    if (this.history.length === 0) return [];

    // Dynamically clamp rewind: half-RTT transit plus 46.875ms interpolation window + 16ms jitter margin
    // Clamped strictly to [MIN_LAG_COMPENSATION_MS (64ms), MAX_LAG_COMPENSATION_MS (120ms)]
    const dynamicMaxRewind = pingMs !== undefined
      ? Math.min(this.MAX_LAG_COMPENSATION_MS, Math.max(this.MIN_LAG_COMPENSATION_MS, Math.round(pingMs * 0.5 + 46.875 + 16)))
      : this.MIN_LAG_COMPENSATION_MS;

    const minAllowedTime = serverNow - dynamicMaxRewind;
    const targetTime = Math.max(minAllowedTime, Math.min(serverNow, targetServerTime));

    // Find two adjacent frames surrounding targetTime
    let older: TickHistorySnapshot | null = null;
    let newer: TickHistorySnapshot | null = null;

    for (let i = this.history.length - 1; i >= 0; i--) {
      const snap = this.history[i];
      if (snap.timestamp <= targetTime) {
        older = snap;
        newer = this.history[i + 1] || snap;
        break;
      }
    }

    if (!older) {
      older = this.history[0];
      newer = this.history[0];
    }
    if (!newer) {
      newer = older;
    }

    // Calculate interpolation factor alpha [0..1]
    const timeSpan = newer.timestamp - older.timestamp;
    const alpha = timeSpan > 0.0001
      ? Math.max(0, Math.min(1, (targetTime - older.timestamp) / timeSpan))
      : 0;

    const rewound: TargetCollider[] = [];

    // Map targets with interpolated coordinates, crouch state, and yaw
    for (const olderTarget of older.targets) {
      const newerTarget = newer.targets.find(t => t.id === olderTarget.id) || olderTarget;

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
