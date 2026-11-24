import * as THREE from 'three';
import {
  MapBlockCollider,
  BOMBSITES,
  CS_OFFICE_BOUNDS,
  MapBounds,
  SmokeOccluder,
  SpatialGrid,
  hasLineOfSight,
} from '@garam/shared';
import { BotEntity } from '../maps/CsOfficeMap.js';
import { settingsStore } from '../core/SettingsStore.js';

interface SpottedRecord {
  x: number;
  z: number;
  lastSeen: number;
}

export interface RadarBombsitesConfig {
  A: { center: { x: number; z: number }; radius: number };
  B?: { center: { x: number; z: number }; radius: number };
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
  private mapScale = 2.6;
  private spottedEnemies: Map<string, SpottedRecord> = new Map();
  private bakedFloorCanvas: HTMLCanvasElement | null = null;
  private hideVoxelOverlayWhenBaked = false;
  private bombsites: RadarBombsitesConfig = BOMBSITES;
  private bakeBounds = {
    minX: CS_OFFICE_BOUNDS.minX - 2,
    maxX: CS_OFFICE_BOUNDS.maxX + 2,
    minZ: CS_OFFICE_BOUNDS.minZ - 2,
    maxZ: CS_OFFICE_BOUNDS.maxZ + 2,
  };

  public configureMap(bounds: MapBounds, bombsites: RadarBombsitesConfig, isGlbMap = false): void {
    this.bakeBounds = {
      minX: bounds.minX - 2,
      maxX: bounds.maxX + 2,
      minZ: bounds.minZ - 2,
      maxZ: bounds.maxZ + 2,
    };
    this.bombsites = bombsites;
    this.hideVoxelOverlayWhenBaked = isGlbMap;
    this.mapScale = isGlbMap ? 2.45 : 2.9;
  }

  constructor() {
    let el = document.getElementById('tactical-radar') as HTMLCanvasElement | null;
    if (!el) {
      el = document.createElement('canvas');
      el.id = 'tactical-radar';
      el.width = this.size;
      el.height = this.size;

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

  /**
   * 1-frame orthographic top-down bake of CS_OFFICE floorplan at map boot (hiding ceiling/roof meshes
   * & dynamic operator rigs so the minimap displays an exact architectural overview).
   */
  public bakeFromScene(renderer: THREE.WebGLRenderer, worldScene: THREE.Scene): void {
    try {
      const texSize = 512;
      const { minX, maxX, minZ, maxZ } = this.bakeBounds;
      const cx = (minX + maxX) * 0.5;
      const cz = (minZ + maxZ) * 0.5;
      const halfW = (maxX - minX) * 0.5;
      const halfH = (maxZ - minZ) * 0.5;

      const orthoCam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 1, 90);
      orthoCam.position.set(cx, 48, cz);
      orthoCam.up.set(0, 0, -1); // -Z (North) points UP on baked image
      orthoCam.lookAt(cx, 0, cz);
      orthoCam.updateMatrixWorld();

      const hidden: THREE.Object3D[] = [];
      worldScene.traverse((obj) => {
        if (
          obj.visible &&
          (obj.userData?.isOfficeRoof || obj.userData?.isOperatorRig || obj.userData?.isSkyBackdrop)
        ) {
          obj.visible = false;
          hidden.push(obj);
        }
      });

      const rt = new THREE.WebGLRenderTarget(texSize, texSize, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
      });

      const prevTarget = renderer.getRenderTarget();
      const prevFog = worldScene.fog;
      worldScene.fog = null;

      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(worldScene, orthoCam);
      renderer.setRenderTarget(prevTarget);
      worldScene.fog = prevFog;

      for (const obj of hidden) obj.visible = true;

      const pixels = new Uint8Array(texSize * texSize * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, texSize, texSize, pixels);
      rt.dispose();

      const off = document.createElement('canvas');
      off.width = texSize;
      off.height = texSize;
      const offCtx = off.getContext('2d');
      if (!offCtx) return;

      const img = offCtx.createImageData(texSize, texSize);
      // Flip WebGL bottom-up rows to Canvas top-down
      for (let y = 0; y < texSize; y++) {
        const srcRow = (texSize - 1 - y) * texSize * 4;
        const dstRow = y * texSize * 4;
        for (let x = 0; x < texSize * 4; x++) {
          img.data[dstRow + x] = pixels[srcRow + x];
        }
      }
      offCtx.putImageData(img, 0, 0);
      this.bakedFloorCanvas = off;
    } catch {
      // Fallback cleanly to crisp vector floorplan rendering
      this.bakedFloorCanvas = null;
    }
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

    // Deep tactical slate radar backdrop
    ctx.fillStyle = 'rgba(10, 15, 24, 0.94)';
    ctx.fillRect(0, 0, this.size, this.size);

    // Rotate map relative to player facing direction (player always looks UP)
    ctx.save();
    ctx.translate(half, half);
    const radarRot = computeRadarRotationRad(playerYaw);
    ctx.rotate(radarRot);

    const s = this.mapScale;

    // 0. Composite Baked Top-Down Floorplan (if available)
    if (this.bakedFloorCanvas) {
      const { minX, maxX, minZ, maxZ } = this.bakeBounds;
      const dx = (minX - playerX) * s;
      const dy = (minZ - playerZ) * s;
      const dw = (maxX - minX) * s;
      const dh = (maxZ - minZ) * s;
      ctx.save();
      ctx.globalAlpha = this.hideVoxelOverlayWhenBaked ? 0.92 : 0.62;
      ctx.drawImage(this.bakedFloorCanvas, dx, dy, dw, dh);
      ctx.restore();
    } else {
      // Crisp vector fallback: arena footprint
      const { minX, maxX, minZ, maxZ } = this.bakeBounds;
      ctx.fillStyle = 'rgba(66, 82, 102, 0.35)';
      ctx.fillRect((minX - playerX) * s, (minZ - playerZ) * s, (maxX - minX) * s, (maxZ - minZ) * s);
    }

    // 1. Tactical Wall / Cover Outlines (skipped on GLB maps once crisp top-down PBR bake is ready)
    if (!this.bakedFloorCanvas || !this.hideVoxelOverlayWhenBaked) {
      for (const b of blocks) {
        if (b.id.startsWith('deck_')) continue;
        if (this.hideVoxelOverlayWhenBaked && b.maxY - b.minY < 0.8) continue;

        const rx = (b.minX - playerX) * s;
        const ry = (b.minZ - playerZ) * s;
        const rw = (b.maxX - b.minX) * s;
        const rh = (b.maxZ - b.minZ) * s;

        if (b.id.includes('_stairs_')) {
          ctx.fillStyle = 'rgba(234, 179, 8, 0.35)';
          ctx.fillRect(rx, ry, rw, rh);
          continue;
        }

        if (b.id === 'sniper_mezz_deck') {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.32)';
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.92)';
          ctx.lineWidth = 1.2;
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
        } else if (b.material === 'DRYWALL') {
          ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
          ctx.fillRect(rx, ry, rw, rh);
        } else if (b.material === 'WOOD_THIN') {
          ctx.fillStyle = 'rgba(196, 134, 72, 0.68)';
          ctx.fillRect(rx, ry, rw, rh);
        } else if (b.material === 'METAL_SHEET') {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.62)';
          ctx.fillRect(rx, ry, rw, rh);
        } else {
          ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.48)';
          ctx.lineWidth = 0.8;
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
        }
      }
    }

    // 2. Active Bombsite Zones
    const drawSite = (site: { center: { x: number; z: number }; radius: number }, label: string, hex: string) => {
      const sx = (site.center.x - playerX) * s;
      const sy = (site.center.z - playerZ) * s;
      ctx.fillStyle = label === 'A' ? 'rgba(249, 115, 22, 0.22)' : 'rgba(56, 189, 248, 0.22)';
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
    drawSite(this.bombsites.A, 'A', '#fb923c');
    if (this.bombsites.B) {
      drawSite(this.bombsites.B, 'B', '#38bdf8');
    }

    // 3. Active Smoke Clouds on Radar
    for (const sm of smokeOccluders) {
      const sx = (sm.center.x - playerX) * s;
      const sy = (sm.center.z - playerZ) * s;
      ctx.fillStyle = 'rgba(220, 228, 238, 0.56)';
      ctx.beginPath();
      ctx.arc(sx, sy, sm.radius * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Armed Bomb Pulse Marker
    if (isBombPlanted && bombPos) {
      const bx = (bombPos.x - playerX) * s;
      const by = (bombPos.z - playerZ) * s;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.015);
      ctx.fillStyle = `rgba(255, 30, 30, ${0.4 + pulse * 0.6})`;
      ctx.beginPath();
      ctx.arc(bx, by, 5 + pulse * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Allied Teammates & Smoke-Respecting LOS Enemy Spotting
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

    // 6. Local Player Center Marker & 90° FOV Cone
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
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
