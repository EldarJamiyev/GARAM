import * as THREE from 'three';

export class PerfMonitor {
  public isVisible = false;

  private container: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;

  // Frame timing telemetry
  private frameTimes: number[] = [];
  private readonly MAX_FRAMES = 120;
  private lastUpdateTime = 0;
  private frameCount = 0;
  private currentFps = 60;
  private onePercentLow = 60;
  private avgFrameTimeMs = 16.6;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

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
    this.container.style.backdropFilter = 'blur(6px)';

    document.body.appendChild(this.container);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  public toggle(): void {
    this.isVisible = !this.isVisible;
    this.container.style.display = this.isVisible ? 'block' : 'none';
  }

  public recordFrame(dtMs: number, rttPingMs = -1, rxKbps = 0, txKbps = 0): void {
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > this.MAX_FRAMES) {
      this.frameTimes.shift();
    }

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastUpdateTime >= 250) {
      // Calculate average FPS
      const totalTime = this.frameTimes.reduce((acc, t) => acc + t, 0);
      this.avgFrameTimeMs = totalTime / this.frameTimes.length;
      this.currentFps = Math.round(1000 / Math.max(1, this.avgFrameTimeMs));

      // Calculate 1% Low FPS
      const sorted = [...this.frameTimes].sort((a, b) => b - a);
      const lowIndex = Math.max(0, Math.floor(sorted.length * 0.01));
      const slowestFrame = sorted[lowIndex] || this.avgFrameTimeMs;
      this.onePercentLow = Math.round(1000 / Math.max(1, slowestFrame));

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

    this.container.innerHTML = `
      <div style="color: ${fpsColor}; font-size: 13px; margin-bottom: 2px;">
        ${this.currentFps} FPS <span style="font-size: 10px; color: #8892a0;">(${this.avgFrameTimeMs.toFixed(1)}ms • 1% LOW: ${this.onePercentLow} FPS)</span>
      </div>
      <div style="color: #3b9eff; letter-spacing: 0.5px;">TICK: 128Hz FIXED KINEMATICS</div>
      <div style="color: #cbd5e1;">DRAW CALLS: ${calls} | TRIS: ${triangles.toLocaleString()}</div>
      <div style="color: #cbd5e1;">GEOMETRIES: ${geometries} | TEXTURES: ${textures}</div>
      <div style="color: #cbd5e1;">BANDWIDTH: ${netBandwidth}</div>
      <div style="color: #94a3b8;">SERVER RTT: <span style="color: #f59e0b;">${pingText}</span></div>
      <div style="color: #64748b; font-size: 9px; margin-top: 2px;">[F3] TOGGLE TELEMETRY</div>
    `;
  }
}
