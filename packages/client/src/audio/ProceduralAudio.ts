import * as THREE from 'three';
import { MapBlockCollider, intersectRayAABB } from '@garam/shared';

export type SurfaceMaterialType = 'CONCRETE' | 'WOOD_THIN' | 'METAL_SHEET';

export class ProceduralAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterVolume = 0.85;

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      // Master Chain: Audio Nodes -> masterGain -> compressor -> destination
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-18, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(12, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(6, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.2, this.ctx.currentTime);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);

      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    }
  }

  /**
   * Synchronizes Web Audio 3D AudioListener with the camera transform every frame
   */
  public updateListener(camera: THREE.Camera): void {
    if (!this.ctx) return;

    const p = camera.position;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const up = camera.up;

    const listener = this.ctx.listener;
    if (listener.positionX) {
      listener.positionX.setValueAtTime(p.x, this.ctx.currentTime);
      listener.positionY.setValueAtTime(p.y, this.ctx.currentTime);
      listener.positionZ.setValueAtTime(p.z, this.ctx.currentTime);
      listener.forwardX.setValueAtTime(forward.x, this.ctx.currentTime);
      listener.forwardY.setValueAtTime(forward.y, this.ctx.currentTime);
      listener.forwardZ.setValueAtTime(forward.z, this.ctx.currentTime);
      listener.upX.setValueAtTime(up.x, this.ctx.currentTime);
      listener.upY.setValueAtTime(up.y, this.ctx.currentTime);
      listener.upZ.setValueAtTime(up.z, this.ctx.currentTime);
    } else {
      // Legacy fallback
      listener.setPosition(p.x, p.y, p.z);
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /**
   * Calculates wall occlusion between source and listener
   */
  private getWallOcclusionFilter(
    sourcePos: THREE.Vector3,
    listenerPos: THREE.Vector3,
    blocks: MapBlockCollider[]
  ): { cutoffHz: number; gainReduction: number } {
    const dir = new THREE.Vector3().subVectors(listenerPos, sourcePos);
    const dist = dir.length();
    if (dist < 0.1) return { cutoffHz: 20000, gainReduction: 1.0 };
    dir.normalize();

    const ray = {
      origin: { x: sourcePos.x, y: sourcePos.y, z: sourcePos.z },
      direction: { x: dir.x, y: dir.y, z: dir.z },
    };

    let walls = 0;
    for (const b of blocks) {
      const res = intersectRayAABB(ray, b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ);
      if (res.hit && res.tNear > 0.05 && res.tNear < dist - 0.05) {
        walls++;
        if (walls >= 2) break;
      }
    }

    if (walls === 0) return { cutoffHz: 20000, gainReduction: 1.0 };
    if (walls === 1) return { cutoffHz: 750, gainReduction: 0.55 };
    return { cutoffHz: 320, gainReduction: 0.25 };
  }

  /**
   * Creates an HRTF spatial panner + occlusion filter node chain
   */
  private createSpatialRoute(
    worldPos: THREE.Vector3,
    listenerPos?: THREE.Vector3,
    blocks: MapBlockCollider[] = []
  ): { input: AudioNode; output: AudioNode } {
    this.initContext();
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3.0;
    panner.maxDistance = 85.0;
    panner.rolloffFactor = 1.15;
    panner.coneInnerAngle = 360;

    if (panner.positionX) {
      panner.positionX.setValueAtTime(worldPos.x, t);
      panner.positionY.setValueAtTime(worldPos.y, t);
      panner.positionZ.setValueAtTime(worldPos.z, t);
    } else {
      panner.setPosition(worldPos.x, worldPos.y, worldPos.z);
    }

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';

    const occlusion = listenerPos
      ? this.getWallOcclusionFilter(worldPos, listenerPos, blocks)
      : { cutoffHz: 20000, gainReduction: 1.0 };

    filter.frequency.setValueAtTime(occlusion.cutoffHz, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(occlusion.gainReduction, t);

    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterGain!);

    return { input: filter, output: panner };
  }

  // --- Gunfire DSP ---
  public playGunshot(weaponType = 'garam-47', worldPos?: THREE.Vector3, listenerPos?: THREE.Vector3, blocks: MapBlockCollider[] = []): void {
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const isSuppressed = weaponType === 'vanguard-m4';
    const isAWP = weaponType === 'sovereign-awp';
    const isDeagle = weaponType === 'desert-eagle';

    const destinationNode = worldPos
      ? this.createSpatialRoute(worldPos, listenerPos, blocks).input
      : this.masterGain!;

    // 1. Sub-bass punch oscillator
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();

    osc.type = isAWP ? 'sawtooth' : 'triangle';
    const startFreq = isAWP ? 180 : isDeagle ? 150 : isSuppressed ? 90 : 130;
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(25, t + (isAWP ? 0.25 : 0.09));

    const peakGain = isAWP ? 1.0 : isDeagle ? 0.9 : isSuppressed ? 0.35 : 0.8;
    oscGain.gain.setValueAtTime(peakGain, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + (isAWP ? 0.28 : 0.16));

    osc.connect(oscGain);
    oscGain.connect(destinationNode);
    osc.start(t);
    osc.stop(t + (isAWP ? 0.28 : 0.16));

    // 2. High-frequency gunpowder blast & crack
    const dur = isAWP ? 0.35 : isSuppressed ? 0.04 : 0.14;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = isAWP ? 'lowpass' : 'bandpass';
    filter.frequency.setValueAtTime(isSuppressed ? 700 : isAWP ? 2600 : 1800, t);
    filter.Q.setValueAtTime(isAWP ? 1.2 : 2.5, t);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(isAWP ? 0.9 : peakGain * 0.8, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(destinationNode);
    whiteNoise.start(t);
    whiteNoise.stop(t + dur);
  }

  // --- Tactical Foley Suite ---
  public playFootstep(surface: SurfaceMaterialType = 'CONCRETE', worldPos?: THREE.Vector3, listenerPos?: THREE.Vector3, blocks: MapBlockCollider[] = []): void {
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const destinationNode = worldPos
      ? this.createSpatialRoute(worldPos, listenerPos, blocks).input
      : this.masterGain!;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    if (surface === 'METAL_SHEET') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.08);
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    } else if (surface === 'WOOD_THIN') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(50, t + 0.06);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    } else {
      // CONCRETE (Crisp low thud)
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.05);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    }

    osc.connect(gain);
    gain.connect(destinationNode);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  public playReload(): void {
    this.playMagOut();
    setTimeout(() => this.playMagIn(), 450);
    setTimeout(() => this.playBoltRack(), 950);
  }

  public playMagOut(): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  public playMagIn(): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    gain.gain.setValueAtTime(0.45, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  public playBoltRack(): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(650, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.10);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  public playDryFire(): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.03);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.04);
  }

  public playHeadshotDink(): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2600, t);
    osc.frequency.exponentialRampToValueAtTime(1100, t + 0.18);
    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  public playKnifeSlash(): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(700, t);
    osc.frequency.exponentialRampToValueAtTime(250, t + 0.08);
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  public playBombBeep(worldPos?: THREE.Vector3, listenerPos?: THREE.Vector3, blocks: MapBlockCollider[] = []): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dest = worldPos
      ? this.createSpatialRoute(worldPos, listenerPos, blocks).input
      : this.masterGain!;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1800, t);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  public playGrenadeExplosion(worldPos?: THREE.Vector3, listenerPos?: THREE.Vector3, blocks: MapBlockCollider[] = []): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dest = worldPos
      ? this.createSpatialRoute(worldPos, listenerPos, blocks).input
      : this.masterGain!;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(20, t + 0.6);
    gain.gain.setValueAtTime(1.0, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(t);
    osc.stop(t + 0.7);
  }

  public playSmokeDeploy(): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const bufferSize = Math.floor(this.ctx.sampleRate * 1.2);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + 1.2);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 1.2);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    noise.start(t);
    noise.stop(t + 1.2);
  }

  public playFlashbangDetonate(): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(450, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.15);
    gain.gain.setValueAtTime(0.8, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.2);

    const ring = this.ctx.createOscillator();
    const ringGain = this.ctx.createGain();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(3400, t);
    ringGain.gain.setValueAtTime(0.35, t);
    ringGain.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
    ring.connect(ringGain);
    ringGain.connect(this.masterGain!);
    ring.start(t);
    ring.stop(t + 2.5);
  }
}
