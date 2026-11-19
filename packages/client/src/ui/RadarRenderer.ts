import * as THREE from 'three';
import { MapBlockCollider, BOMBSITES, SmokeOccluder } from '@garam/shared';
import { BotEntity } from '../maps/DeCitadelMap.js';

interface SpottedEnemyMarker {
  botId: string;
  x: number;
  z: number;
  timestamp: number;
}

export class RadarRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private spottedMarkers: Map<string, SpottedEnemyMarker> = new Map();
  private readonly RADAR_SIZE = 185;
  private readonly MAP_SCALE = 1.6; // World units to radar pixels

  constructor() {
    let el = document.getElementById('tactical-radar') as HTMLCanvasElement;
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
      el.style.background = 'rgba(6, 10, 16, 0.88)';
      el.style.backdropFilter = 'blur(10px)';
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
    this.ctx = el.getContext('2d')!;
  }

  public update(
    playerPos: THREE.Vector3,
    playerYaw: number,
    blocks: MapBlockCollider[],
    bots: BotEntity[],
    smokeOccluders: SmokeOccluder[],
    bombPos: THREE.Vector3 | null,
    isBombArmed: boolean
  ): void {
    const ctx = this.ctx;
    const center = this.RADAR_SIZE / 2;
    const now = performance.now();

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
    ctx.rotate(-playerYaw - Math.PI);

    // World to Radar relative coordinates
    const toRadar = (wx: number, wz: number) => {
      const rx = (wx - playerPos.x) * this.MAP_SCALE;
      const rz = (wz - playerPos.z) * this.MAP_SCALE;
      return { x: rx, y: rz };
    };

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
      ctx.fillStyle = 'rgba(180, 190, 200, 0.28)';
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

    // 5. Bot Entities
    for (const bot of bots) {
      if (bot.isDead) continue;
      const bp = toRadar(bot.mesh.position.x, bot.mesh.position.z);

      if (bot.team === 'Vanguard') {
        // Ally (Always visible in Blue)
        ctx.fillStyle = '#3b9eff';
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Enemy (Visible when in range or firing)
        const dist = playerPos.distanceTo(bot.mesh.position);
        if (dist <= 38) {
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
      ctx.fillStyle = `rgba(255, 45, 65, ${alpha})`;
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
