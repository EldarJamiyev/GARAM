import * as THREE from 'three';
import {
  MapBlockCollider,
  BOMBSITES,
  SmokeOccluder,
  hasLineOfSight,
  SpatialGrid,
} from '@garam/shared';
import { BotEntity } from '../maps/DeCitadelMap.js';
import { settingsStore } from '../core/SettingsStore.js';

interface SpottedEnemyMarker {
  botId: string;
  x: number;
  z: number;
  timestamp: number;
}

/**
 * Computes canvas 2D rotation angle (radians) so player's look direction always points UP on radar.
 * In Three.js right-handed coordinates (+X right, -Z forward at yaw=0, +yaw = turn left):
 * Rotating world-relative (dx, dz) by +playerYaw maps forward (-sin(yaw), -cos(yaw)) -> (0, -1) (UP).
 */
export function computeRadarRotationRad(playerYaw: number): number {
  return playerYaw;
}

export class RadarRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private spottedMarkers: Map<string, SpottedEnemyMarker> = new Map();
  private lastSpotCheckMs = 0;
  private readonly RADAR_SIZE = 185;
  private readonly MAP_SCALE = 1.6; // World units to radar pixels

  constructor() {
    let el = document.getElementById('tactical-radar') as HTMLCanvasElement | null;
    if (!el) {
      el = document.createElement('canvas');
      el.id = 'tactical-radar';
      el.width = this.RADAR_SIZE;
      el.height = this.RADAR_SIZE;
      el.style.position = 'absolute';
      el.style.top = '18px';
      el.style.left = '18px';
      el.style.borderRadius = '50%';
      el.style.border = '2px solid rgba(59, 158, 255, 0.45)';
      el.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.75), inset 0 0 15px rgba(0, 0, 0, 0.8)';
      el.style.background = 'rgba(6, 10, 16, 0.92)';
      el.style.zIndex = '40';
      el.style.pointerEvents = 'none';

      const overlay = document.getElementById('ui-overlay');
      if (overlay) {
        overlay.appendChild(el);
      } else {
        document.body.appendChild(el);
      }
    }

    this.canvas = el;
    const context = el.getContext('2d');
    if (!context) {
      throw new Error('Failed to initialize 2D context for Tactical Radar');
    }
    this.ctx = context;
  }

  public clearSpotted(): void {
    this.spottedMarkers.clear();
  }

  public update(
    playerPos: THREE.Vector3,
    playerYaw: number,
    blocks: MapBlockCollider[],
    bots: BotEntity[],
    smokeOccluders: SmokeOccluder[],
    bombPos: THREE.Vector3 | null,
    isBombArmed: boolean,
    spatialGrid?: SpatialGrid
  ): void {
    const ctx = this.ctx;
    const center = this.RADAR_SIZE / 2;
    const now = performance.now();
    const localTeam = settingsStore.settings.faction;

    ctx.clearRect(0, 0, this.RADAR_SIZE, this.RADAR_SIZE);

    // Save clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, center - 2, 0, Math.PI * 2);
    ctx.clip();

    // Radar compass grid rings
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center, center, 35, 0, Math.PI * 2);
    ctx.arc(center, center, 65, 0, Math.PI * 2);
    ctx.stroke();

    // Rotate map around player yaw (Player forward = radar UP)
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(computeRadarRotationRad(playerYaw));

    // World to Radar relative coordinates
    const toRadar = (wx: number, wz: number) => ({
      x: (wx - playerPos.x) * this.MAP_SCALE,
      y: (wz - playerPos.z) * this.MAP_SCALE,
    });

    // 1. Draw Map Block Colliders
    ctx.fillStyle = 'rgba(65, 95, 125, 0.45)';
    ctx.strokeStyle = 'rgba(59, 158, 255, 0.55)';
    ctx.lineWidth = 1.2;

    for (const b of blocks) {
      const p = toRadar(b.x, b.z);
      const rw = b.w * this.MAP_SCALE;
      const rd = b.d * this.MAP_SCALE;

      ctx.fillRect(p.x - rw / 2, p.y - rd / 2, rw, rd);
      ctx.strokeRect(p.x - rw / 2, p.y - rd / 2, rw, rd);
    }

    // 2. Bombsites A & B
    const aPos = toRadar(BOMBSITES.A.center.x, BOMBSITES.A.center.z);
    ctx.strokeStyle = '#ff3344';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(aPos.x, aPos.y, BOMBSITES.A.radius * this.MAP_SCALE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ff3344';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('A', aPos.x, aPos.y + 4);

    const bPos = toRadar(BOMBSITES.B.center.x, BOMBSITES.B.center.z);
    ctx.strokeStyle = '#3b9eff';
    ctx.beginPath();
    ctx.arc(bPos.x, bPos.y, BOMBSITES.B.radius * this.MAP_SCALE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#3b9eff';
    ctx.fillText('B', bPos.x, bPos.y + 4);

    // 3. Active Smoke Cloud Rings
    for (const s of smokeOccluders) {
      const sp = toRadar(s.center.x, s.center.z);
      ctx.fillStyle = 'rgba(180, 190, 200, 0.32)';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, s.radius * this.MAP_SCALE, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Pulse Core Bomb Marker
    if (bombPos) {
      const bp = toRadar(bombPos.x, bombPos.z);
      const pulse = Math.sin(now * 0.01) * 2 + 5;
      ctx.fillStyle = isBombArmed ? '#ff2233' : '#ffcc00';
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Bot Entities (Allies always visible; enemies gated by LOS + smoke occlusion)
    const shouldCheckSpots = now - this.lastSpotCheckMs >= 120;
    if (shouldCheckSpots) {
      this.lastSpotCheckMs = now;
    }

    const playerEye = { x: playerPos.x, y: playerPos.y + 1.55, z: playerPos.z };

    for (const bot of bots) {
      if (bot.isDead) {
        this.spottedMarkers.delete(bot.id);
        continue;
      }

      const bp = toRadar(bot.mesh.position.x, bot.mesh.position.z);

      if (bot.team === localTeam) {
        // Ally (Always visible in Blue)
        ctx.fillStyle = '#3b9eff';
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (shouldCheckSpots) {
        const dx = bot.mesh.position.x - playerPos.x;
        const dz = bot.mesh.position.z - playerPos.z;
        const distSq = dx * dx + dz * dz;
        const enemyEye = {
          x: bot.mesh.position.x,
          y: bot.mesh.position.y + 1.5,
          z: bot.mesh.position.z,
        };

        let isSpotted = false;

        // Direct player LOS (smoke-occluded) within 55m
        if (distSq <= 55 * 55 && hasLineOfSight(playerEye, enemyEye, blocks, smokeOccluders, spatialGrid)) {
          isSpotted = true;
        }

        // Shared teammate LOS within 42m
        if (!isSpotted) {
          for (const ally of bots) {
            if (ally.isDead || ally.team !== localTeam) continue;
            const adx = bot.mesh.position.x - ally.mesh.position.x;
            const adz = bot.mesh.position.z - ally.mesh.position.z;
            if (adx * adx + adz * adz <= 42 * 42) {
              const allyEye = {
                x: ally.mesh.position.x,
                y: ally.mesh.position.y + 1.5,
                z: ally.mesh.position.z,
              };
              if (hasLineOfSight(allyEye, enemyEye, blocks, smokeOccluders, spatialGrid)) {
                isSpotted = true;
                break;
              }
            }
          }
        }

        if (isSpotted) {
          this.spottedMarkers.set(bot.id, {
            botId: bot.id,
            x: bot.mesh.position.x,
            z: bot.mesh.position.z,
            timestamp: now,
          });
        }
      }
    }

    // Render spotted enemies (red fading over 2.5s)
    this.spottedMarkers.forEach((marker, id) => {
      const age = (now - marker.timestamp) / 1000;
      if (age > 2.5) {
        this.spottedMarkers.delete(id);
        return;
      }

      const ep = toRadar(marker.x, marker.z);
      const alpha = Math.max(0.2, 1 - age / 2.5);
      ctx.fillStyle = `rgba(255, 45, 65, ${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(ep.x, ep.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore(); // Undo map rotation

    // 6. Player Center Arrow & 115 deg Vision Cone
    ctx.fillStyle = 'rgba(0, 255, 136, 0.16)';
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, 42, -Math.PI / 2 - 0.9, -Math.PI / 2 + 0.9);
    ctx.closePath();
    ctx.fill();

    // Player arrow pointing UP
    ctx.fillStyle = '#00ff88';
    ctx.beginPath();
    ctx.moveTo(center, center - 6);
    ctx.lineTo(center - 5, center + 5);
    ctx.lineTo(center, center + 3);
    ctx.lineTo(center + 5, center + 5);
    ctx.closePath();
    ctx.fill();

    ctx.restore(); // Undo circular clip
  }
}

