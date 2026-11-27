import * as THREE from 'three';

export class ProceduralAudioCS16 {
  public static playWeaponSynth(
    ctx: AudioContext,
    dest: AudioNode,
    noiseBuffer: AudioBuffer,
    weaponId: string,
    isSilenced = true
  ): boolean {
    const t = ctx.currentTime;
    const playNoiseBurst = (dur: number, freq: number, q: number, gainPeak: number, type: BiquadFilterType = 'bandpass') => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.setValueAtTime(freq, t);
      filter.Q.setValueAtTime(q, t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(gainPeak, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      src.start(t);
      src.stop(t + dur + 0.02);
    };

    const playPunch = (startHz: number, endHz: number, dur: number, vol: number, wave: OscillatorType = 'triangle') => {
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.setValueAtTime(startHz, t);
      osc.frequency.exponentialRampToValueAtTime(endHz, t + dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    };

    switch (weaponId) {
      case 'mp5-navy':
        playPunch(210, 58, 0.08, 0.42);
        playNoiseBurst(0.11, 1850, 1.4, 0.48);
        return true;
      case 'p90':
        playPunch(245, 72, 0.065, 0.36);
        playNoiseBurst(0.09, 2400, 1.8, 0.42);
        return true;
      case 'clarion-famas':
        playPunch(175, 48, 0.11, 0.48, 'sawtooth');
        playNoiseBurst(0.16, 1650, 1.1, 0.56);
        return true;
      case 'defender-galil':
        playPunch(155, 44, 0.13, 0.52, 'sawtooth');
        playNoiseBurst(0.19, 1380, 0.9, 0.62);
        return true;
      case 'schmidt-scout':
        playPunch(320, 42, 0.22, 0.68, 'sawtooth');
        playNoiseBurst(0.32, 2100, 0.7, 0.78, 'lowpass');
        return true;
      case 'leone-m3':
        playPunch(125, 28, 0.26, 0.85, 'sine');
        playNoiseBurst(0.36, 980, 0.55, 0.92, 'lowpass');
        // Signature pump-action rack clack at +0.26s
        setTimeout(() => {
          if (ctx.state === 'running') {
            const nt = ctx.currentTime;
            const o = ctx.createOscillator();
            o.type = 'square';
            o.frequency.setValueAtTime(520, nt);
            o.frequency.setValueAtTime(760, nt + 0.07);
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.14, nt);
            g.gain.exponentialRampToValueAtTime(0.001, nt + 0.14);
            o.connect(g);
            g.connect(dest);
            o.start(nt);
            o.stop(nt + 0.15);
          }
        }, 260);
        return true;
      case 'xm1014':
        playPunch(135, 32, 0.20, 0.78, 'sine');
        playNoiseBurst(0.28, 1120, 0.6, 0.84, 'lowpass');
        return true;
      case 'dual-elites':
        playPunch(260, 62, 0.09, 0.44);
        playNoiseBurst(0.12, 2100, 1.2, 0.50);
        return true;
      case 'vanguard-m4':
        if (!isSilenced) {
          playPunch(185, 45, 0.14, 0.58, 'sawtooth');
          playNoiseBurst(0.22, 1650, 0.85, 0.72);
          return true;
        }
        return false;
      case 'usp-s':
        if (!isSilenced) {
          playPunch(240, 56, 0.10, 0.50);
          playNoiseBurst(0.14, 1950, 1.0, 0.58);
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  public static playSurfaceFootstep(
    ctx: AudioContext,
    dest: AudioNode,
    noiseBuffer: AudioBuffer,
    surface: string
  ): void {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    if (surface === 'SNOW') {
      // Crisp 1.6 snow crunch (highpass + rapid mid crackle)
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(3400 + Math.random() * 500, t);
      filter.Q.setValueAtTime(1.4, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    } else if (surface === 'LADDER') {
      // Metallic ladder rung tap (pl_ladder1..4)
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(620 + Math.random() * 140, t);
      osc.frequency.exponentialRampToValueAtTime(240, t + 0.06);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.18, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc.connect(og);
      og.connect(dest);
      osc.start(t);
      osc.stop(t + 0.08);
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(1800, t);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    } else if (surface === 'METAL_SHEET' || surface === 'VENT_DUCT') {
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(surface === 'VENT_DUCT' ? 420 : 980, t);
      filter.Q.setValueAtTime(4.5, t);
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    } else if (surface === 'WOOD_THIN') {
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(520, t);
      gain.gain.setValueAtTime(0.24, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    } else {
      // Concrete / Tile default crisp heel tap
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(750 + Math.random() * 180, t);
      filter.Q.setValueAtTime(1.2, t);
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    }

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(t);
    src.stop(t + 0.16);
  }

  public static playBulletWhiz(ctx: AudioContext, dest: AudioNode, noiseBuffer: AudioBuffer, distMeters: number): void {
    const t = ctx.currentTime;
    const vol = THREE.MathUtils.clamp(1.0 - distMeters / 2.2, 0.08, 0.45);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(3600, t);
    filter.frequency.exponentialRampToValueAtTime(720, t + 0.13); // Doppler sweep
    filter.Q.setValueAtTime(3.2, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + 0.15);
  }

  public static playFlashTinnitus(ctx: AudioContext, dest: AudioNode, durationSec: number): void {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(3920, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0008, t + Math.max(0.8, durationSec));
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + Math.max(0.85, durationSec + 0.05));
  }

  public static playGlassShatter(ctx: AudioContext, dest: AudioNode, noiseBuffer: AudioBuffer): void {
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const delay = i * 0.045;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(2200 + Math.random() * 2400, t + delay);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.14, t + delay);
      og.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.09);
      osc.connect(og);
      og.connect(dest);
      osc.start(t + delay);
      osc.stop(t + delay + 0.10);
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.setValueAtTime(2800, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + 0.36);
  }

  public static playSprayAerosol(ctx: AudioContext, dest: AudioNode, noiseBuffer: AudioBuffer): void {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(4200, t);
    f.Q.setValueAtTime(1.5, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.24, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + 0.36);
  }

  public static playSilencerToggle(ctx: AudioContext, dest: AudioNode, attach: boolean): void {
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      const base = attach ? 420 + i * 110 : 720 - i * 110;
      osc.frequency.setValueAtTime(base, t + i * 0.14);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.11, t + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.14 + 0.08);
      osc.connect(g);
      g.connect(dest);
      osc.start(t + i * 0.14);
      osc.stop(t + i * 0.14 + 0.09);
    }
  }

  public static playNvgToggle(ctx: AudioContext, dest: AudioNode, active: boolean): void {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(active ? 550 : 2100, t);
    osc.frequency.exponentialRampToValueAtTime(active ? 2800 : 380, t + 0.24);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + 0.28);
  }

  public static playShieldRicochet(ctx: AudioContext, dest: AudioNode): void {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1450 + Math.random() * 400, t);
    osc.frequency.exponentialRampToValueAtTime(620, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  public static playRadioClick(
    ctx: AudioContext,
    dest: AudioNode,
    noiseBuffer: AudioBuffer,
    voiceText?: string,
    voicePitch = 1.0
  ): void {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(2200, t);
    f.Q.setValueAtTime(3.0, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + 0.07);

    if (voiceText && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        if (window.speechSynthesis.speaking) return; // Avoid chatter overlap queue
        const utt = new SpeechSynthesisUtterance(voiceText);
        utt.rate = 1.15;
        utt.pitch = Math.max(0.75, Math.min(1.35, voicePitch));
        utt.volume = 0.55;
        window.speechSynthesis.speak(utt);
      } catch {
        // Speech synthesis unavailable in headless/restricted contexts
      }
    }
  }
}
