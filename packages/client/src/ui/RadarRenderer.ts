import * as THREE from 'three';
import {
  MapBlockCollider,
  BOMBSITES,
  SmokeOccluder,
  SpatialGrid,
  hasLineOfSight,
} from '@garam/shared';
import { BotEntity } from '../maps/DeMeridianMap.js';
import { settingsStore } from '../core/SettingsStore.js';

interface SpottedRecord {
  x: number;
  z: number;
  lastSeen: number;
}

/**
 * Pure rotation mapping Three.js player yaw (where forward is (-sin(yaw), -cos(yaw)))
 * to Canvas 2D ctx.rotate(angle) so player forward always points UP (0, -1).
 */
export function computeRadarRotationRad(playerYaw: number): number {
  return playerYaw;
}

export class RadarRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size = 185;
  private readonly MAP_SCALE = 2.8; // Pixels per meter tuned for CS2 ~88% radar coverage on DE_MERIDIAN
  private spottedEnemies: Map<string, SpottedRecord> = new Map();

  constructor() {
    let el = document.getElementById('tactical-radar') as HTMLCanvasElement | null;
    if (!el) {
      el = document.createElement('canvas');
      el.id = 'tactical-radar';
      el.width = this.size;
      el.height = this.size;
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
    this.size = el.width;
  }

  public markEnemySpotted(botId: string, x: number, z: number): void {
    this.spottedEnemies.set(botId, { x, z, lastSeen: performance.now() });
  }

  public clearSpotted(): void {
    this.spottedEnemies.clear();
  }

  public update(
    playerPos: THREE.Vector3,
    playerYaw: number,
    blocks: MapBlockCollider[],
    bots: BotEntity[],
    smokeOccluders: SmokeOccluder[],
    bombPos: THREE.Vector3 | null,
    isBombPlanted: boolean,
    spatialGrid?: SpatialGrid
  ): void {
    const ctx = this.ctx;
    const half = this.size / 2;
    const now = performance.now();
    const playerX = playerPos.x;
    const playerZ = playerPos.z;
    const playerTeam = settingsStore.settings.faction;

    ctx.clearRect(0, 0, this.size, this.size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 2, 0, Math.PI * 2);
    ctx.clip();

    // Deep slate radar backdrop
    ctx.fillStyle = 'rgba(11, 15, 22, 0.92)';
    ctx.fillRect(0, 0, this.size, this.size);

    // Subtle polar grid
    ctx.strokeStyle = 'rgba(59, 158, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(half, half, half * 0.45, 0, Math.PI * 2);
    ctx.arc(half, half, half * 0.8, 0, Math.PI * 2);
    ctx.stroke();

    // Rotate map relative to player facing direction (player always looks UP)
    ctx.save();
    ctx.translate(half, half);
    const radarRot = computeRadarRotationRad(playerYaw);
    ctx.rotate(radarRot);

    const s = this.MAP_SCALE;

    // 0. Render Walkable Main Deck Footprint (Warm Sandstone Courtyard Fill)
    ctx.fillStyle = 'rgba(74, 62, 50, 0.42)';
    for (const b of blocks) {
      if (!b.id.startsWith('deck_')) continue;
      const rx = (b.minX - playerX) * s;
      const ry = (b.minZ - playerZ) * s;
      const rw = (b.maxX - b.minX) * s;
      const rh = (b.maxZ - b.minZ) * s;
      ctx.fillRect(rx, ry, rw, rh);
    }

    // 1. Sunken Aqueduct Underpass (y = 0.0m) in dashed teal
    const upX = (-3.5 - playerX) * s;
    const upY = (-10.0 - playerZ) * s;
    ctx.save();
    ctx.fillStyle = 'rgba(20, 184, 166, 0.22)';
    ctx.strokeStyle = 'rgba(20, 184, 166, 0.85)';
    ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(upX, upY, 7.0 * s, 30.8 * s);
    ctx.strokeRect(upX, upY, 7.0 * s, 30.8 * s);
    ctx.restore();

    // 2. Render 3-Tier Map Geometry (skip deck_* foundation slabs so walkable floor stays legible)
    for (const b of blocks) {
      if (b.id.startsWith('deck_')) continue;

      const rx = (b.minX - playerX) * s;
      const ry = (b.minZ - playerZ) * s;
      const rw = (b.maxX - b.minX) * s;
      const rh = (b.maxZ - b.minZ) * s;

      if (b.id.includes('_stairs_')) {
        ctx.fillStyle = 'rgba(234, 179, 8, 0.34)';
        ctx.fillRect(rx, ry, rw, rh);
        continue;
      }

      const isUpperOverlook =
        b.minY >= 4.0 ||
        b.id === 'a_palace_deck' ||
        b.id === 'a_heaven_deck' ||
        b.id === 'mid_nest_deck' ||
        b.id === 'b_apps_deck';

      if (isUpperOverlook) {
        ctx.fillStyle = 'rgba(217, 119, 6, 0.42)';
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.92)';
        ctx.lineWidth = 1.1;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
      } else if (b.material === 'WOOD_THIN') {
        ctx.fillStyle = 'rgba(180, 115, 55, 0.65)';
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.7)';
        ctx.lineWidth = 0.8;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
      } else if (b.material === 'DRYWALL') {
        ctx.fillStyle = 'rgba(147, 51, 234, 0.55)';
        ctx.strokeStyle = 'rgba(192, 132, 252, 0.85)';
        ctx.lineWidth = 0.8;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
      } else if (b.material === 'METAL_SHEET') {
        ctx.fillStyle = 'rgba(14, 116, 144, 0.65)';
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.lineWidth = 0.8;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
      } else {
        ctx.fillStyle = 'rgba(58, 76, 98, 0.68)';
        ctx.strokeStyle = 'rgba(115, 152, 194, 0.42)';
        ctx.lineWidth = 0.75;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
      }
    }

    // 3. Bombsite A (Sanctum) & B (Foundry) Zones
    const drawSite = (site: { center: { x: number; z: number }; radius: number }, label: string, hex: string) => {
      const sx = (site.center.x - playerX) * s;
      const sy = (site.center.z - playerZ) * s;
      ctx.fillStyle = label === 'A' ? 'rgba(217, 72, 59, 0.22)' : 'rgba(39, 163, 184, 0.22)';
      ctx.strokeStyle = hex;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(sx, sy, site.radius * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-radarRot);
      ctx.fillStyle = hex;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    };
    drawSite(BOMBSITES.A, 'A', '#ff6454');
    drawSite(BOMBSITES.B, 'B', '#38bdf8');

    // 4. Active Smoke Clouds on Radar
    for (const sm of smokeOccluders) {
      const sx = (sm.center.x - playerX) * s;
      const sy = (sm.center.z - playerZ) * s;
      ctx.fillStyle = 'rgba(205, 214, 224, 0.48)';
      ctx.beginPath();
      ctx.arc(sx, sy, sm.radius * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Armed Bomb Pulse Marker
    if (isBombPlanted && bombPos) {
      const bx = (bombPos.x - playerX) * s;
      const by = (bombPos.z - playerZ) * s;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.015);
      ctx.fillStyle = `rgba(255, 30, 30, ${0.4 + pulse * 0.6})`;
      ctx.beginPath();
      ctx.arc(bx, by, 5 + pulse * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. Allied Teammates & Smoke-Respecting LOS Enemy Spotting
    const eyeA = { x: playerPos.x, y: playerPos.y + 1.65, z: playerPos.z };
    for (const bot of bots) {
      if (bot.isDead) continue;

      if (bot.team === playerTeam) {
        const tx = (bot.mesh.position.x - playerX) * s;
        const ty = (bot.mesh.position.z - playerZ) * s;
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(tx, ty, 3.8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const eyeB = { x: bot.mesh.position.x, y: bot.mesh.position.y + 1.65, z: bot.mesh.position.z };
        if (hasLineOfSight(eyeA, eyeB, blocks, smokeOccluders, spatialGrid)) {
          this.spottedEnemies.set(bot.id, { x: bot.mesh.position.x, z: bot.mesh.position.z, lastSeen: now });
        }
        const rec = this.spottedEnemies.get(bot.id);
        if (rec && now - rec.lastSeen < 2500) {
          const alpha = 1 - (now - rec.lastSeen) / 2500;
          const ex = (rec.x - playerX) * s;
          const ey = (rec.z - playerZ) * s;
          ctx.fillStyle = `rgba(255, 65, 65, ${alpha})`;
          ctx.beginPath();
          ctx.arc(ex, ey, 4.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.restore(); // End map rotation

    // 7. Local Player Center Marker & 90° FOV Cone
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.moveTo(half, half);
    ctx.arc(half, half, 42, -Math.PI * 0.75, -Math.PI * 0.25);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(half, half - 6);
    ctx.lineTo(half + 4.5, half + 4.5);
    ctx.lineTo(half, half + 2.5);
    ctx.lineTo(half - 4.5, half + 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }
}
