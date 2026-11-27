import * as THREE from 'three';
import { MapBlockCollider, intersectRayAABB } from '@garam/shared';

export type SurfaceMaterialType = 'CONCRETE' | 'WOOD_THIN' | 'METAL_SHEET';

const _listenerForward = new THREE.Vector3();
const _occDir = new THREE.Vector3();

const WEAPON_SAMPLE_MAP: Record<string, { url: string; volume: number }> = {
  'garam-47': { url: '/audio/ak47_shot.mp3', volume: 0.84 },
  'vanguard-m4': { url: '/audio/m4_suppressed.mp3', volume: 0.72 },
  'm4a4': { url: '/audio/m4a4_shot.mp3', volume: 0.80 },
  'mp9': { url: '/audio/mp9_shot.mp3', volume: 0.76 },
  'desert-eagle': { url: '/audio/deagle_shot.mp3', volume: 0.85 },
  'usp-s': { url: '/audio/usps_shot.mp3', volume: 0.68 },
  'glock-18': { url: '/audio/glock18_shot.mp3', volume: 0.74 },
  'sovereign-awp': { url: '/audio/awp_shot.mp3', volume: 0.95 },
};

export class ProceduralAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private masterVolume = 0.85;
  private audioBufferCache: Map<string, AudioBuffer> = new Map();
  private rawSampleCache: Map<string, ArrayBuffer> = new Map();
  private decodingSamples: Set<string> = new Set();
  private sharedNoiseBuffer: AudioBuffer | null = null;
  private activeSpatialVoices: Array<{
    panner: PannerNode;
    gain: GainNode;
    filter: BiquadFilterNode;
    dist: number;
    endTime: number;
  }> = [];
  private activeReloadNodes: Array<{ osc: OscillatorNode; gain: GainNode }> = [];

  constructor() {
    // Pre-fetch ElevenLabs synthesized tactical audio bytes without creating an AudioContext before user gesture
    this.prefetchRawAudio('/audio/ak47_shot.mp3');
    this.prefetchRawAudio('/audio/m4_suppressed.mp3');
    this.prefetchRawAudio('/audio/m4a4_shot.mp3');
    this.prefetchRawAudio('/audio/mp9_shot.mp3');
    this.prefetchRawAudio('/audio/deagle_shot.mp3');
    this.prefetchRawAudio('/audio/usps_shot.mp3');
    this.prefetchRawAudio('/audio/glock18_shot.mp3');
    this.prefetchRawAudio('/audio/awp_shot.mp3');
    this.prefetchRawAudio('/audio/headshot_dink.mp3');
    this.prefetchRawAudio('/audio/c4_beep.mp3');
    this.prefetchRawAudio('/audio/knife_draw.mp3');
    this.prefetchRawAudio('/audio/low_ammo_click.mp3');
  }

  private async prefetchRawAudio(url: string): Promise<void> {
    if (this.rawSampleCache.has(url) || this.audioBufferCache.has(url)) return;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const arrayBuf = await res.arrayBuffer();
      this.rawSampleCache.set(url, arrayBuf);
      if (this.ctx) {
        void this.decodeCachedSample(url);
      }
    } catch {
      // Graceful procedural synthesis fallback
    }
  }

  private async decodeCachedSample(url: string): Promise<AudioBuffer | null> {
    if (this.audioBufferCache.has(url)) return this.audioBufferCache.get(url)!;
    if (!this.ctx || this.decodingSamples.has(url)) return null;
    const raw = this.rawSampleCache.get(url);
    if (!raw) return null;

    this.decodingSamples.add(url);
    try {
      const decoded = await this.ctx.decodeAudioData(raw.slice(0));
      let finalBuffer = decoded;

      // Downmix multi-channel audio to mono for pin-point HRTF panning and phase clarity
      if (decoded.numberOfChannels > 1) {
        const monoBuf = this.ctx.createBuffer(1, decoded.length, decoded.sampleRate);
        const monoData = monoBuf.getChannelData(0);
        const numChannels = decoded.numberOfChannels;
        for (let c = 0; c < numChannels; c++) {
          const chData = decoded.getChannelData(c);
          for (let i = 0; i < decoded.length; i++) {
            monoData[i] += chData[i] / numChannels;
          }
        }
        finalBuffer = monoBuf;
      }

      this.audioBufferCache.set(url, finalBuffer);
      this.rawSampleCache.delete(url);
      return finalBuffer;
    } catch {
      return null;
    } finally {
      this.decodingSamples.delete(url);
    }
  }

  public async preloadAudio(url: string): Promise<AudioBuffer | null> {
    if (this.audioBufferCache.has(url)) return this.audioBufferCache.get(url)!;
    await this.prefetchRawAudio(url);
    if (this.ctx) {
      return this.decodeCachedSample(url);
    }
    return null;
  }

  private playCachedBuffer(url: string, volume = 0.5, destination?: AudioNode): boolean {
    const buf = this.audioBufferCache.get(url);
    if (!buf || !this.ctx || !this.masterGain) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    src.connect(gain);
    gain.connect(destination || this.masterGain);
    src.onended = () => {
      try {
        src.disconnect();
        gain.disconnect();
      } catch {}
    };
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

      // Decode any prefetched MP3 samples now that AudioContext is initialized after user interaction
      for (const url of this.rawSampleCache.keys()) {
        void this.decodeCachedSample(url);
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
   * and cleanly reaps expired spatial voice nodes without JS timer allocations.
   */
  public updateListener(camera: THREE.Camera): void {
    if (!this.ctx) return;

    const p = camera.position;
    camera.getWorldDirection(_listenerForward);
    const up = camera.up;

    const listener = this.ctx.listener;
    if (listener.positionX) {
      listener.positionX.setValueAtTime(p.x, this.ctx.currentTime);
      listener.positionY.setValueAtTime(p.y, this.ctx.currentTime);
      listener.positionZ.setValueAtTime(p.z, this.ctx.currentTime);
      listener.forwardX.setValueAtTime(_listenerForward.x, this.ctx.currentTime);
      listener.forwardY.setValueAtTime(_listenerForward.y, this.ctx.currentTime);
      listener.forwardZ.setValueAtTime(_listenerForward.z, this.ctx.currentTime);
      listener.upX.setValueAtTime(up.x, this.ctx.currentTime);
      listener.upY.setValueAtTime(up.y, this.ctx.currentTime);
      listener.upZ.setValueAtTime(up.z, this.ctx.currentTime);
    } else {
      listener.setPosition(p.x, p.y, p.z);
      listener.setOrientation(_listenerForward.x, _listenerForward.y, _listenerForward.z, up.x, up.y, up.z);
    }

    const now = this.ctx.currentTime;
    for (let i = this.activeSpatialVoices.length - 1; i >= 0; i--) {
      const v = this.activeSpatialVoices[i];
      if (now >= v.endTime) {
        this.activeSpatialVoices.splice(i, 1);
        try {
          v.filter.disconnect();
          v.gain.disconnect();
          v.panner.disconnect();
        } catch {}
      }
    }
  }

  private getWallOcclusionFilter(
    sourcePos: THREE.Vector3,
    listenerPos: THREE.Vector3,
    blocks: MapBlockCollider[]
  ): { cutoffHz: number; gainReduction: number } {
    _occDir.subVectors(listenerPos, sourcePos);
    const dist = _occDir.length();
    if (dist < 0.1) return { cutoffHz: 20000, gainReduction: 1.0 };
    _occDir.divideScalar(dist);

    const ray = {
      origin: { x: sourcePos.x, y: sourcePos.y, z: sourcePos.z },
      direction: { x: _occDir.x, y: _occDir.y, z: _occDir.z },
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
   * Creates an HRTF/equalpower spatial panner + occlusion filter node chain
   * with voice limiting and dynamic distance tiering.
   */
  private createSpatialRoute(
    worldPos: THREE.Vector3,
    listenerPos?: THREE.Vector3,
    blocks: MapBlockCollider[] = []
  ): { input: AudioNode; output: AudioNode } {
    this.initContext();
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    const dist = listenerPos ? worldPos.distanceTo(listenerPos) : 0;

    // Spatial Voice Budget: Cap active 3D voices at 20
    if (this.activeSpatialVoices.length >= 20) {
      let maxDist = -1;
      let maxIdx = -1;
      for (let i = 0; i < this.activeSpatialVoices.length; i++) {
        if (this.activeSpatialVoices[i].dist > maxDist) {
          maxDist = this.activeSpatialVoices[i].dist;
          maxIdx = i;
        }
      }
      if (maxIdx >= 0) {
        const evicted = this.activeSpatialVoices.splice(maxIdx, 1)[0];
        try {
          evicted.filter.disconnect();
          evicted.gain.disconnect();
          evicted.panner.disconnect();
        } catch {}
      }
    }

    const panner = ctx.createPanner();
    // Closest voices use realistic HRTF; distant voices use efficient equalpower
    panner.panningModel = dist <= 28.0 ? 'HRTF' : 'equalpower';
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

    const voiceEntry = { panner, gain, filter, dist, endTime: t + 3.5 };
    this.activeSpatialVoices.push(voiceEntry);

    return { input: filter, output: panner };
  }

  // --- Gunfire DSP ---
  public playGunshot(weaponType = 'garam-47', worldPos?: THREE.Vector3, listenerPos?: THREE.Vector3, blocks: MapBlockCollider[] = []): void {
    this.initContext();
    if (!this.ctx) return;

    const destinationNode = worldPos
      ? this.createSpatialRoute(worldPos, listenerPos, blocks).input
      : this.masterGain!;

    // Use studio-synthesized ElevenLabs MP3 sample when loaded (routed through spatial/occlusion chain)
    const sample = WEAPON_SAMPLE_MAP[weaponType];
    if (sample && this.playCachedBuffer(sample.url, sample.volume, destinationNode)) {
      return;
    }

    const t = this.ctx.currentTime;
    const isSuppressed = weaponType === 'vanguard-m4' || weaponType === 'usp-s';
    const isUSPS = weaponType === 'usp-s';
    const isGlock = weaponType === 'glock-18';
    const isMP9 = weaponType === 'mp9';
    const isM4A4 = weaponType === 'm4a4';
    const isAWP = weaponType === 'sovereign-awp';
    const isDeagle = weaponType === 'desert-eagle';

    // 1. Sub-bass punch oscillator
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();

    osc.type = isAWP ? 'sawtooth' : isMP9 ? 'square' : 'triangle';
    const startFreq = isAWP
      ? 180
      : isDeagle
        ? 150
        : isUSPS
          ? 110
          : isSuppressed
            ? 90
            : isMP9
              ? 165
              : isGlock
                ? 175
                : isM4A4
                  ? 145
                  : 130;
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + (isAWP ? 0.25 : isMP9 ? 0.055 : isGlock ? 0.065 : 0.09));

    const peakGain = isAWP
      ? 1.0
      : isDeagle
        ? 0.9
        : isUSPS
          ? 0.28
          : isSuppressed
            ? 0.35
            : isMP9
              ? 0.56
              : isGlock
                ? 0.52
                : isM4A4
                  ? 0.78
                  : 0.8;
    const oscDecay = isAWP ? 0.28 : isUSPS ? 0.07 : isMP9 ? 0.08 : isGlock ? 0.095 : 0.16;
    oscGain.gain.setValueAtTime(peakGain, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + oscDecay);

    osc.connect(oscGain);
    oscGain.connect(destinationNode);
    osc.start(t);
    osc.stop(t + oscDecay);

    // 2. High-frequency gunpowder blast & crack (Zero-allocation via shared noise buffer)
    const dur = isAWP ? 0.35 : isUSPS ? 0.032 : isSuppressed ? 0.04 : isMP9 ? 0.075 : isGlock ? 0.085 : 0.14;
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
    filter.frequency.setValueAtTime(
      isUSPS ? 1150 : isSuppressed ? 700 : isAWP ? 2600 : isMP9 ? 2350 : isGlock ? 2200 : isM4A4 ? 2100 : 1800,
      t
    );
    filter.Q.setValueAtTime(isAWP ? 1.2 : isUSPS ? 3.2 : 2.5, t);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(isAWP ? 0.9 : peakGain * 0.8, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(destinationNode);

    const offset = Math.random() * Math.max(0, 2.0 - dur);
    whiteNoise.start(t, offset);
    whiteNoise.stop(t + dur);

    // 3. Crisp mechanical hammer / bolt-carrier slap transient
    const clickOsc = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();
    clickOsc.type = 'square';
    clickOsc.frequency.setValueAtTime(
      isUSPS ? 1900 : isSuppressed ? 1600 : isAWP ? 4200 : isMP9 ? 3800 : isM4A4 ? 3600 : 3400,
      t
    );
    clickOsc.frequency.exponentialRampToValueAtTime(380, t + 0.024);
    clickGain.gain.setValueAtTime(isSuppressed ? 0.16 : isMP9 || isGlock ? 0.34 : 0.48, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.028);
    clickOsc.connect(clickGain);
    clickGain.connect(destinationNode);
    clickOsc.start(t);
    clickOsc.stop(t + 0.028);

    // 4. Outdoor supersonic canyon crack tail for unsuppressed high-caliber rifles
    if (!isSuppressed && !isGlock && this.sharedNoiseBuffer) {
      const tail = this.ctx.createBufferSource();
      tail.buffer = this.sharedNoiseBuffer;
      const tailFilter = this.ctx.createBiquadFilter();
      tailFilter.type = 'bandpass';
      tailFilter.frequency.setValueAtTime(isAWP ? 950 : isMP9 ? 1600 : 1250, t + 0.03);
      tailFilter.frequency.exponentialRampToValueAtTime(320, t + (isAWP ? 0.52 : isMP9 ? 0.18 : 0.28));
      tailFilter.Q.setValueAtTime(1.4, t + 0.03);
      const tailGain = this.ctx.createGain();
      tailGain.gain.setValueAtTime(isAWP ? 0.36 : isMP9 ? 0.14 : 0.22, t + 0.025);
      tailGain.gain.exponentialRampToValueAtTime(0.001, t + (isAWP ? 0.54 : isMP9 ? 0.19 : 0.30));
      tail.connect(tailFilter);
      tailFilter.connect(tailGain);
      tailGain.connect(destinationNode);
      tail.start(t + 0.025, Math.random() * 1.2);
      tail.stop(t + (isAWP ? 0.54 : isMP9 ? 0.19 : 0.30));
    }
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

    // Subtle limestone gravel / boot tread friction transient
    if (this.sharedNoiseBuffer) {
      const grit = this.ctx.createBufferSource();
      grit.buffer = this.sharedNoiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(
        surface === 'METAL_SHEET' ? 2400 : surface === 'WOOD_THIN' ? 1150 : 1750,
        t
      );
      filter.Q.setValueAtTime(2.6, t);
      const gGain = this.ctx.createGain();
      gGain.gain.setValueAtTime(0.085, t);
      gGain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
      grit.connect(filter);
      filter.connect(gGain);
      gGain.connect(destinationNode);
      grit.start(t, Math.random() * 1.6);
      grit.stop(t + 0.055);
    }
  }

  public cancelReloadAudio(): void {
    if (this.activeReloadNodes.length === 0) return;
    for (const node of this.activeReloadNodes) {
      try {
        node.osc.stop();
        node.osc.disconnect();
        node.gain.disconnect();
      } catch {}
    }
    this.activeReloadNodes = [];
  }

  public playReload(isEmpty = false): void {
    this.cancelReloadAudio();
    this.playMagOut();
    this.playMagIn(0.45);
    if (isEmpty) {
      this.playBoltRack(0.95);
    }
  }

  private registerReloadNode(osc: OscillatorNode, gain: GainNode): void {
    const entry = { osc, gain };
    this.activeReloadNodes.push(entry);
    osc.onended = () => {
      const idx = this.activeReloadNodes.indexOf(entry);
      if (idx !== -1) this.activeReloadNodes.splice(idx, 1);
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {}
    };
  }

  public playMagOut(): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(145, t + 0.085);
    gain.gain.setValueAtTime(0.32, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.095);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    this.registerReloadNode(osc, gain);
    osc.start(t);
    osc.stop(t + 0.095);

    // Metallic magazine catch latch click
    const latch = this.ctx.createOscillator();
    const lGain = this.ctx.createGain();
    latch.type = 'square';
    latch.frequency.setValueAtTime(2150, t);
    latch.frequency.exponentialRampToValueAtTime(720, t + 0.025);
    lGain.gain.setValueAtTime(0.14, t);
    lGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    latch.connect(lGain);
    lGain.connect(this.masterGain!);
    this.registerReloadNode(latch, lGain);
    latch.start(t);
    latch.stop(t + 0.03);
  }

  public playMagIn(delaySeconds = 0): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delaySeconds;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(195, t);
    osc.frequency.exponentialRampToValueAtTime(58, t + 0.12);
    gain.gain.setValueAtTime(0.46, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    this.registerReloadNode(osc, gain);
    osc.start(t);
    osc.stop(t + 0.14);

    // Crisp magazine lock-in snap
    const snap = this.ctx.createOscillator();
    const sGain = this.ctx.createGain();
    snap.type = 'triangle';
    snap.frequency.setValueAtTime(1680, t + 0.035);
    snap.frequency.exponentialRampToValueAtTime(540, t + 0.075);
    sGain.gain.setValueAtTime(0.22, t + 0.035);
    sGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    snap.connect(sGain);
    sGain.connect(this.masterGain!);
    this.registerReloadNode(snap, sGain);
    snap.start(t + 0.035);
    snap.stop(t + 0.08);
  }

  public playBoltRack(delaySeconds = 0): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delaySeconds;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(680, t);
    osc.frequency.exponentialRampToValueAtTime(240, t + 0.075);
    gain.gain.setValueAtTime(0.36, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    this.registerReloadNode(osc, gain);
    osc.start(t);
    osc.stop(t + 0.085);

    // Bolt carrier forward return slam
    const slam = this.ctx.createOscillator();
    const slGain = this.ctx.createGain();
    slam.type = 'square';
    slam.frequency.setValueAtTime(1420, t + 0.085);
    slam.frequency.exponentialRampToValueAtTime(310, t + 0.145);
    slGain.gain.setValueAtTime(0.28, t + 0.085);
    slGain.gain.exponentialRampToValueAtTime(0.001, t + 0.155);
    slam.connect(slGain);
    slGain.connect(this.masterGain!);
    this.registerReloadNode(slam, slGain);
    slam.start(t + 0.085);
    slam.stop(t + 0.155);
  }

  public playBodyHitCrunch(worldPos?: THREE.Vector3, listenerPos?: THREE.Vector3, blocks: MapBlockCollider[] = []): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dest = worldPos
      ? this.createSpatialRoute(worldPos, listenerPos, blocks).input
      : this.masterGain!;

    // Low fleshy impact thump
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    oscGain.gain.setValueAtTime(0.55, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(oscGain);
    oscGain.connect(dest);
    osc.start(t);
    osc.stop(t + 0.09);

    // Kevlar crunch grit
    const noise = this.ctx.createBufferSource();
    if (this.sharedNoiseBuffer) {
      noise.buffer = this.sharedNoiseBuffer;
    }
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(950, t);
    filter.Q.setValueAtTime(3.0, t);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.3, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(dest);
    noise.start(t, Math.random() * 1.5);
    noise.stop(t + 0.07);
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
    if (this.playCachedBuffer('/audio/headshot_dink.mp3', 0.82)) return;
    const t = this.ctx.currentTime;

    // Dual-harmonic CS2 metallic helmet dink + crunch confirm
    const freqs = [2850, 4420];
    for (let i = 0; i < freqs.length; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freqs[i], t);
      osc.frequency.exponentialRampToValueAtTime(freqs[i] * 0.48, t + 0.16);
      gain.gain.setValueAtTime(i === 0 ? 0.52 : 0.34, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.21);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.21);
    }
  }

  /**
   * CS2 ascending harmonic kill chime scaling across round kills 1..5,
   * with a crisp upper shimmer on headshot eliminations.
   */
  public playKillChime(killIndex: number, isHeadshot: boolean): void {
    this.initContext();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const scaleHz = [523.25, 659.25, 783.99, 987.77, 1174.66];
    const idx = Math.max(0, Math.min(scaleHz.length - 1, Math.round(killIndex) - 1));
    const baseFreq = scaleHz[idx];

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.02, t + 0.16);
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.23);

    if (isHeadshot) {
      const shimmer = this.ctx.createOscillator();
      const sGain = this.ctx.createGain();
      shimmer.type = 'triangle';
      shimmer.frequency.setValueAtTime(baseFreq * 2.0, t + 0.025);
      shimmer.frequency.exponentialRampToValueAtTime(baseFreq * 2.5, t + 0.19);
      sGain.gain.setValueAtTime(0.14, t + 0.025);
      sGain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      shimmer.connect(sGain);
      sGain.connect(this.masterGain);
      shimmer.start(t + 0.025);
      shimmer.stop(t + 0.25);
    }
  }

  public playShellClink(delaySeconds = 0.42): void {
    this.initContext();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime + delaySeconds;
    const baseFreq = 5200 + Math.random() * 1400;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.72, t + 0.045);
    gain.gain.setValueAtTime(0.055, t);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.055);
  }

  public playSurfaceImpact(
    surface: SurfaceMaterialType,
    worldPos?: THREE.Vector3,
    listenerPos?: THREE.Vector3,
    blocks: MapBlockCollider[] = []
  ): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dest = worldPos
      ? this.createSpatialRoute(worldPos, listenerPos, blocks).input
      : this.masterGain!;

    if (surface === 'METAL_SHEET') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(2100 + Math.random() * 700, t);
      osc.frequency.exponentialRampToValueAtTime(680, t + 0.11);
      gain.gain.setValueAtTime(0.24, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(t);
      osc.stop(t + 0.12);
      return;
    }

    if (this.sharedNoiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.sharedNoiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(surface === 'WOOD_THIN' ? 780 : 1450, t);
      filter.Q.setValueAtTime(surface === 'WOOD_THIN' ? 2.4 : 1.6, t);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      src.start(t, Math.random() * 1.5);
      src.stop(t + 0.065);
    }
  }

  public playKnifeSlash(): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(760, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.095);
    gain.gain.setValueAtTime(0.32, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.105);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.105);

    // High-velocity Karambit blade air-whip + subtle steel ring
    if (this.sharedNoiseBuffer) {
      const whip = this.ctx.createBufferSource();
      whip.buffer = this.sharedNoiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2650, t);
      filter.frequency.exponentialRampToValueAtTime(920, t + 0.11);
      filter.Q.setValueAtTime(3.2, t);
      const wGain = this.ctx.createGain();
      wGain.gain.setValueAtTime(0.24, t);
      wGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      whip.connect(filter);
      filter.connect(wGain);
      wGain.connect(this.masterGain!);
      whip.start(t, Math.random() * 1.5);
      whip.stop(t + 0.12);
    }
  }

  public playBombBeep(worldPos?: THREE.Vector3, listenerPos?: THREE.Vector3, blocks: MapBlockCollider[] = []): void {
    this.initContext();
    if (!this.ctx) return;
    const dest = worldPos
      ? this.createSpatialRoute(worldPos, listenerPos, blocks).input
      : this.masterGain!;
    if (this.playCachedBuffer('/audio/c4_beep.mp3', 0.58, dest)) return;

    const t = this.ctx.currentTime;
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

  /**
   * Tactical military headset radio squelch & chirp (clean-room Web Audio DSP)
   */
  public playRadioChirp(): void {
    this.initContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // Dual-tone radio frequency handshake tone
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2400, t);
    osc.frequency.exponentialRampToValueAtTime(1600, t + 0.045);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.05);

    // Subtle radio static squelch click
    const noise = this.ctx.createBufferSource();
    if (this.sharedNoiseBuffer) {
      noise.buffer = this.sharedNoiseBuffer;
    }
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2800, t);
    filter.Q.setValueAtTime(3.5, t);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.12, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain!);
    noise.start(t, Math.random() * 1.5);
    noise.stop(t + 0.04);
  }
}
