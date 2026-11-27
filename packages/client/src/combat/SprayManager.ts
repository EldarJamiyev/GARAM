import * as THREE from 'three';
import { MapBlockCollider, SpatialGrid, executeTacticalRaycast } from '@garam/shared';
import { ProceduralAudio } from '../audio/ProceduralAudio.js';
import { HUDManager } from '../ui/HUDManager.js';

export type SprayEmblemId = 'sovereign' | 'target' | 'biohazard' | 'crown' | 'spade' | 'vanguard';

export class SprayManager {
  private scene: THREE.Scene;
  private audio: ProceduralAudio;
  private hud: HUDManager;
  private activeDecals: THREE.Mesh[] = [];
  private readonly MAX_DECALS = 16;
  private lastSprayMs = -99999;
  private readonly COOLDOWN_MS = 20000;
  private textures = new Map<SprayEmblemId, THREE.CanvasTexture>();

  constructor(scene: THREE.Scene, audio: ProceduralAudio, hud: HUDManager) {
    this.scene = scene;
    this.audio = audio;
    this.hud = hud;
  }

  private getSprayTexture(id: SprayEmblemId): THREE.CanvasTexture {
    const existing = this.textures.get(id);
    if (existing) return existing;

    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);

    const accent =
      id === 'biohazard'
        ? '#eab308'
        : id === 'vanguard'
          ? '#3b82f6'
          : id === 'target'
            ? '#ef4444'
            : id === 'crown'
              ? '#f59e0b'
              : '#f43f5e';

    ctx.strokeStyle = accent;
    ctx.fillStyle = accent;
    ctx.lineWidth = 10;

    ctx.beginPath();
    ctx.arc(128, 128, 102, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = '900 92px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyph =
      id === 'biohazard'
        ? '☣'
        : id === 'target'
          ? '⌖'
          : id === 'crown'
            ? '♛'
            : id === 'spade'
              ? '♠'
              : id === 'vanguard'
                ? '❖'
                : 'G';
    ctx.fillText(glyph, 128, 122);

    ctx.font = '800 22px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(id.toUpperCase(), 128, 202);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(id, tex);
    return tex;
  }

  public trySpray(
    camera: THREE.Camera,
    blocks: MapBlockCollider[],
    spatialGrid?: SpatialGrid,
    emblemId: SprayEmblemId = 'sovereign'
  ): { pos: THREE.Vector3; normal: THREE.Vector3 } | null {
    const now = performance.now();
    if (now - this.lastSprayMs < this.COOLDOWN_MS) {
      const rem = Math.ceil((this.COOLDOWN_MS - (now - this.lastSprayMs)) / 1000);
      this.hud.addRadioMessage(`Spray recharge: ${rem}s remaining`);
      return null;
    }

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const hits = executeTacticalRaycast(
      {
        origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        direction: { x: dir.x, y: dir.y, z: dir.z },
      },
      1,
      0,
      0,
      2.8,
      blocks,
      [],
      1.0,
      spatialGrid
    );
    if (hits.length === 0 || hits[0].targetId) return null;

    const h = hits[0];
    const pos = new THREE.Vector3(h.point.x, h.point.y, h.point.z);
    const norm = new THREE.Vector3(h.normal.x, h.normal.y, h.normal.z).normalize();
    this.spawnSprayAt(emblemId, pos, norm);
    this.lastSprayMs = now;
    this.audio.playSprayAerosol?.();
    return { pos, normal: norm };
  }

  public spawnSprayAt(emblemId: SprayEmblemId, pos: THREE.Vector3, normal: THREE.Vector3): void {
    const mat = new THREE.MeshBasicMaterial({
      map: this.getSprayTexture(emblemId),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), mat);
    mesh.position.copy(pos).addScaledVector(normal, 0.018);
    mesh.lookAt(pos.clone().add(normal));
    this.scene.add(mesh);
    this.activeDecals.push(mesh);

    if (this.activeDecals.length > this.MAX_DECALS) {
      const oldest = this.activeDecals.shift();
      if (oldest) {
        this.scene.remove(oldest);
        oldest.geometry.dispose();
        (oldest.material as THREE.Material).dispose();
      }
    }
  }

  public clearAll(): void {
    for (const m of this.activeDecals) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.activeDecals = [];
  }

  public dispose(): void {
    this.clearAll();
    this.textures.forEach((tex) => tex.dispose());
    this.textures.clear();
  }
}
