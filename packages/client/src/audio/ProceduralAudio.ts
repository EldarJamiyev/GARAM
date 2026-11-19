export class ProceduralAudio {
  private ctx: AudioContext | null = null;

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public playGunshot(weaponType = 'garam-47'): void {
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const isSuppressed = weaponType === 'vanguard-m4';
    const isAWP = weaponType === 'sovereign-awp';
    const isDeagle = weaponType === 'desert-eagle';

    // 1. Sub-bass punch oscillator (Heavy cinematic kick)
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
    oscGain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + (isAWP ? 0.28 : 0.16));

    // 2. High-frequency gunpowder blast & crack
    const dur = isAWP ? 0.35 : isSuppressed ? 0.04 : 0.14;
    const bufferSize = this.ctx.sampleRate * dur;
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
    noiseGain.connect(this.ctx.destination);

    whiteNoise.start(t);
  }

  public playHeadshotDink(): void {
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Sharp metallic ring cue (3400Hz)
    osc.type = 'sine';
    osc.frequency.setValueAtTime(3400, t);
    osc.frequency.exponentialRampToValueAtTime(2900, t + 0.35);

    gain.gain.setValueAtTime(0.85, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.35);
  }

  public playFootstep(): void {
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(25, t + 0.07);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.07);
  }

  public playBombBeep(): void {
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, t);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.08);
  }

  public playGrenadeExplosion(): void {
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(20, t + 0.6);

    gain.gain.setValueAtTime(1.0, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.7);
  }
}
