import * as THREE from 'three';
import { MapBlockCollider, intersectRayAABB } from '@garam/shared';

export type SurfaceMaterialType = 'CONCRETE' | 'WOOD_THIN' | 'METAL_SHEET';

export class ProceduralAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private masterVolume = 0.85;
  private audioBufferCache: Map<string, AudioBuffer> = new Map();
  private sharedNoiseBuffer: AudioBuffer | null = null;

  constructor() {
    // Preload ElevenLabs synthesized tactical audio (non-blocking)
    this.preloadAudio('/audio/knife_draw.mp3');
    this.preloadAudio('/audio/low_ammo_click.mp3');
    this.preloadAudio('/audio/m4_suppressed.mp3');
    this.preloadAudio('/audio/deagle_shot.mp3');
    this.preloadAudio('/audio/awp_shot.mp3');
  }

  public async preloadAudio(url: string): Promise<AudioBuffer | null> {
    if (this.audioBufferCache.has(url)) return this.audioBufferCache.get(url)!;
    this.initContext();
    if (!this.ctx) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const arrayBuf = await res.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(arrayBuf);
      this.audioBufferCache.set(url, decoded);
      return decoded;
    } catch {
      return null;
    }
  }

  private playCachedBuffer(url: string, volume = 0.5): boolean {
    const buf = this.audioBufferCache.get(url);
    if (!buf || !this.ctx || !this.masterGain) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    src.connect(gain);
    gain.connect(this.masterGain);
    src.start();
    return true;
  }

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

      // Procedural synthetic 0.38s concrete room impulse response for enclosed spaces
      const rate = this.ctx.sampleRate;
      const length = Math.floor(rate * 0.38);
      const impulse = this.ctx.createBuffer(2, length, rate);
      for (let channel = 0; channel < 2; channel++) {
        const channelData = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) {
          const t = i / rate;
          channelData[i] = (Math.random() * 2 - 1) * Math.exp(-t * 9.5);
        }
      }
      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.buffer = impulse;
      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.setValueAtTime(0.05, this.ctx.currentTime); // Default dry outdoor slapback

      this.masterGain.connect(this.compressor);
      this.masterGain.connect(this.reverbNode);
      this.reverbNode.connect(this.reverbGain);
      this.reverbGain.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);

      // Pre-allocate a single shared 2.0s white noise buffer for zero-allocation audio synthesis
      const noiseRate = this.ctx.sampleRate;
      const noiseLength = Math.floor(noiseRate * 2.0);
      this.sharedNoiseBuffer = this.ctx.createBuffer(1, noiseLength, noiseRate);
      const noiseData = this.sharedNoiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseLength; i++) {
        noiseData[i] = Math.random() * 2 - 1;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Adjusts acoustic reverb tail based on player location (enclosed indoor tunnels vs open courtyard)
   */
  public setIndoorZone(isIndoor: boolean): void {
    if (this.ctx && this.reverbGain) {
      this.reverbGain.gain.setTargetAtTime(isIndoor ? 0.38 : 0.05, this.ctx.currentTime, 0.12);
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

    // 2. High-frequency gunpowder blast & crack (Zero-allocation via shared noise buffer)
    const dur = isAWP ? 0.35 : isSuppressed ? 0.04 : 0.14;
    const whiteNoise = this.ctx.createBufferSource();
    if (this.sharedNoiseBuffer) {
      whiteNoise.buffer = this.sharedNoiseBuffer;
    } else {
      const bufferSize = Math.floor(this.ctx.sampleRate * dur);
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      whiteNoise.buffer = noiseBuffer;
    }

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

    const offset = Math.random() * Math.max(0, 2.0 - dur);
    whiteNoise.start(t, offset);
    whiteNoise.stop(t + dur);

    // 3. Crisp mechanical hammer / bolt action transient click
    const clickOsc = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();
    clickOsc.type = 'square';
    clickOsc.frequency.setValueAtTime(isSuppressed ? 1600 : isAWP ? 4200 : 3200, t);
    clickOsc.frequency.exponentialRampToValueAtTime(400, t + 0.02);
    clickGain.gain.setValueAtTime(isSuppressed ? 0.15 : 0.45, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
    clickOsc.connect(clickGain);
    clickGain.connect(destinationNode);
    clickOsc.start(t);
    clickOsc.stop(t + 0.025);
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
    const noise = this.ctx.createBufferSource();
    if (this.sharedNoiseBuffer) {
      noise.buffer = this.sharedNoiseBuffer;
    } else {
      const bufferSize = Math.floor(this.ctx.sampleRate * 1.2);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      noise.buffer = buffer;
    }
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
    const offset = Math.random() * Math.max(0, 2.0 - 1.2);
    noise.start(t, offset);
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

  public playKnifeDraw(): void {
    if (this.playCachedBuffer('/audio/knife_draw.mp3', 0.6)) return;
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // Resonant metallic ring
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2200, t);
    osc.frequency.exponentialRampToValueAtTime(3200, t + 0.12);
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.42);

    // Subtle blade-swish air friction (zero-allocation)
    const noise = this.ctx.createBufferSource();
    if (this.sharedNoiseBuffer) {
      noise.buffer = this.sharedNoiseBuffer;
    } else {
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.15);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      noise.buffer = buffer;
    }
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2400, t);
    filter.Q.setValueAtTime(4.0, t);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.2, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain!);
    const offset = Math.random() * Math.max(0, 2.0 - 0.15);
    noise.start(t, offset);
    noise.stop(t + 0.15);
  }

  public playLowAmmoClick(): void {
    if (this.playCachedBuffer('/audio/low_ammo_click.mp3', 0.5)) return;
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2600, t);
    osc.frequency.exponentialRampToValueAtTime(1400, t + 0.035);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.04);
  }

  public playBuyRejection(): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Double error tone
    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, t + i * 0.08);

      gain.gain.setValueAtTime(0.2, t + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.05);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t + i * 0.08);
      osc.stop(t + i * 0.08 + 0.05);
    }
  }

  public playWeaponPickup(): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(1400, t + 0.08);

    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}
