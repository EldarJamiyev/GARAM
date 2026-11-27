import * as THREE from 'three';
import { GraphicsQuality, QualityTier, FpsLimit } from './SettingsStore.js';

const TIER_LADDER: QualityTier[] = ['POTATO', 'LOW', 'MEDIUM', 'HIGH'];

export class PerfMonitor {
  public isVisible = false;

  private container: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;

  // Frame timing telemetry (zero-alloc ring buffer)
  private readonly MAX_FRAMES = 120;
  private frameTimes = new Float64Array(120);
  private sortScratch = new Float64Array(120);
  private frameWriteIdx = 0;
  private frameCount = 0;
  private lastUpdateTime = 0;
  private currentFps = 60;
  private onePercentLow = 60;
  private p95FrameTimeMs = 16.6;
  private avgFrameTimeMs = 16.6;

  // Adaptive quality governor state (AUTO mode)
  private qualitySetting: GraphicsQuality = 'AUTO';
  private activeTier: QualityTier = 'HIGH';
  private activeDpr = 1.0;
  private fpsLimit: FpsLimit = 'VSYNC';
  private slowAccumSec = 0;
  private fastAccumSec = 0;
  private isSoftwareGl = false;
  public onAdaptiveTierChanged?: (tier: QualityTier) => void;

  constructor(renderer: THREE.WebGLRenderer, isSoftwareGl = false) {
    this.renderer = renderer;
    this.isSoftwareGl = isSoftwareGl;
    this.activeTier = isSoftwareGl ? 'LOW' : 'HIGH';

    this.container = document.createElement('div');
    this.container.id = 'garam-perf-monitor';
    this.container.style.position = 'fixed';
    this.container.style.top = '12px';
    this.container.style.left = '12px';
    this.container.style.padding = '8px 14px';
    this.container.style.background = 'rgba(10, 14, 20, 0.90)';
    this.container.style.border = '1px solid rgba(59, 158, 255, 0.4)';
    this.container.style.borderRadius = '6px';
    this.container.style.fontFamily = "'Courier New', Courier, monospace";
    this.container.style.fontSize = '11px';
    this.container.style.fontWeight = '700';
    this.container.style.lineHeight = '1.5';
    this.container.style.color = '#00ff88';
    this.container.style.boxShadow = '0 4px 18px rgba(0, 0, 0, 0.7)';
    this.container.style.pointerEvents = 'none';
    this.container.style.zIndex = '9999';
    this.container.style.display = 'none';

    document.body.appendChild(this.container);

    const swBanner = typeof document !== 'undefined' ? document.getElementById('software-webgl-banner') : null;
    if (swBanner) {
      swBanner.style.display = isSoftwareGl ? 'block' : 'none';
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  public setQualityState(setting: GraphicsQuality, activeTier: QualityTier, dpr: number): void {
    this.qualitySetting = setting;
    this.activeTier = activeTier;
    this.activeDpr = dpr;
    this.slowAccumSec = 0;
    this.fastAccumSec = 0;
  }

  public setFpsLimitState(limit: FpsLimit): void {
    this.fpsLimit = limit;
  }

  public toggle(): void {
    this.isVisible = !this.isVisible;
    this.container.style.display = this.isVisible ? 'block' : 'none';
    document.body.classList.toggle('perf-open', this.isVisible);
    if (this.isVisible) {
      this.renderText(-1, 0, 0);
    }
  }

  public recordFrame(dtMs: number, rttPingMs = -1, rxKbps = 0, txKbps = 0): void {
    this.frameTimes[this.frameWriteIdx] = dtMs;
    this.frameWriteIdx = (this.frameWriteIdx + 1) % this.MAX_FRAMES;
    if (this.frameCount < this.MAX_FRAMES) this.frameCount++;

    const now = performance.now();
    const elapsedMs = now - this.lastUpdateTime;
    if (elapsedMs >= 250 && this.frameCount > 0) {
      const n = this.frameCount;
      let totalTime = 0;
      for (let i = 0; i < n; i++) {
        const t = this.frameTimes[i];
        totalTime += t;
        this.sortScratch[i] = t;
      }
      this.avgFrameTimeMs = totalTime / n;
      this.currentFps = Math.round(1000 / Math.max(0.1, this.avgFrameTimeMs));

      const sorted = this.sortScratch.subarray(0, n).sort();
      const lowIndex = Math.max(0, n - 1 - Math.floor(n * 0.01));
      const p95Index = Math.max(0, n - 1 - Math.floor(n * 0.05));
      const slowestFrame = sorted[lowIndex] || this.avgFrameTimeMs;
      this.p95FrameTimeMs = sorted[p95Index] || this.avgFrameTimeMs;
      this.onePercentLow = Math.round(1000 / Math.max(0.1, slowestFrame));

      // Adaptive p95 frame-time governor when user selected AUTO quality (hardware GPU only)
      if (this.qualitySetting === 'AUTO' && !this.isSoftwareGl && n >= 30) {
        const dtSec = Math.min(0.5, elapsedMs / 1000);
        const curIdx = TIER_LADDER.indexOf(this.activeTier);
        if (this.p95FrameTimeMs > 22.0 && curIdx > 0) {
          this.slowAccumSec += dtSec;
          this.fastAccumSec = 0;
          if (this.slowAccumSec >= 3.0) {
            this.slowAccumSec = 0;
            this.activeTier = TIER_LADDER[curIdx - 1];
            this.onAdaptiveTierChanged?.(this.activeTier);
          }
        } else if (this.p95FrameTimeMs < 12.0 && curIdx < TIER_LADDER.length - 1) {
          this.fastAccumSec += dtSec;
          this.slowAccumSec = 0;
          if (this.fastAccumSec >= 8.0) {
            this.fastAccumSec = 0;
            this.activeTier = TIER_LADDER[curIdx + 1];
            this.onAdaptiveTierChanged?.(this.activeTier);
          }
        } else {
          this.slowAccumSec = Math.max(0, this.slowAccumSec - dtSec * 0.5);
          this.fastAccumSec = Math.max(0, this.fastAccumSec - dtSec * 0.5);
        }
      }

      this.lastUpdateTime = now;

      if (this.isVisible) {
        this.renderText(rttPingMs, rxKbps, txKbps);
      }
    }
  }

  private renderText(rttPingMs: number, rxKbps = 0, txKbps = 0): void {
    const info = this.renderer.info;
    const calls = info.render.calls;
    const triangles = info.render.triangles;
    const geometries = info.memory.geometries;
    const textures = info.memory.textures;

    const fpsColor = this.currentFps >= 58 ? '#00ff88' : this.currentFps >= 45 ? '#ffaa00' : '#ff334b';
    const pingText = rttPingMs >= 0 ? `${rttPingMs} ms` : 'OFFLINE (LOCAL)';
    const netBandwidth = rttPingMs >= 0
      ? `RX <span style="color: #00ff88;">${rxKbps.toFixed(1)} kbps</span> | TX <span style="color: #3b9eff;">${txKbps.toFixed(1)} kbps</span>`
      : 'LOCAL LOOPBACK';
    const qualityLabel =
      this.qualitySetting === 'AUTO'
        ? `AUTO -> ${this.activeTier} (DPR ${this.activeDpr.toFixed(2)})`
        : `${this.activeTier} (DPR ${this.activeDpr.toFixed(2)})`;

    const pacingLabel = this.fpsLimit === 'UNLIMITED' ? 'UNLIMITED' : this.fpsLimit === 'VSYNC' ? 'VSYNC' : `${this.fpsLimit} FPS`;

    this.container.innerHTML = `
      <div style="color: ${fpsColor}; font-size: 13px; margin-bottom: 2px;">
        ${this.currentFps} FPS <span style="font-size: 10px; color: #8892a0;">(${this.avgFrameTimeMs.toFixed(1)}ms • p95: ${this.p95FrameTimeMs.toFixed(1)}ms • 1% LOW: ${this.onePercentLow})</span>
      </div>
      <div style="color: #3b9eff; letter-spacing: 0.5px;">TICK: 128Hz | PACE: ${pacingLabel} | ${qualityLabel}</div>
      <div style="color: #cbd5e1;">DRAW CALLS: ${calls} | TRIS: ${triangles.toLocaleString()}</div>
      <div style="color: #cbd5e1;">GEOMETRIES: ${geometries} | TEXTURES: ${textures}</div>
      <div style="color: #cbd5e1;">BANDWIDTH: ${netBandwidth}</div>
      <div style="color: #94a3b8;">SERVER RTT: <span style="color: #f59e0b;">${pingText}</span></div>
      <div style="color: #64748b; font-size: 9px; margin-top: 2px;">[F3] TOGGLE TELEMETRY</div>
    `;
  }
}
