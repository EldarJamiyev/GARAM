import { settingsStore, BotDifficulty, PlayerFaction, GameMode, GraphicsQuality } from '../core/SettingsStore.js';

export interface LobbyUICallbacks {
  onDeploy: () => void;
  onCustomizer: () => void;
  onSensitivityChanged: (val: number) => void;
  onFovChanged: (val: number) => void;
  onVolumeChanged: (val: number) => void;
  onDifficultyChanged: (diff: BotDifficulty) => void;
  onModeChanged?: (mode: GameMode) => void;
  onFactionChanged?: (faction: PlayerFaction) => void;
  onQualityChanged?: (quality: GraphicsQuality) => void;
}

export class LobbyUI {
  private callbacks: LobbyUICallbacks;

  constructor(callbacks: LobbyUICallbacks) {
    this.callbacks = callbacks;
    this.bindEvents();
  }

  private bindEvents(): void {
    // Auto-detect ws:// vs wss:// and LAN host IP for multiplayer connection
    const urlInput = document.getElementById('server-url-input') as HTMLInputElement | null;
    if (urlInput) {
      const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      if (
        window.location.hostname &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'
      ) {
        urlInput.value = `${wsProto}://${window.location.hostname}:2567`;
      } else {
        urlInput.value = `${wsProto}://localhost:2567`;
      }
      urlInput.addEventListener('click', (e) => e.stopPropagation());
    }

    const callsignInput = document.getElementById('player-callsign-input') as HTMLInputElement | null;
    if (callsignInput) {
      callsignInput.value = settingsStore.settings.callsign || 'Eldar Garamov';
      callsignInput.addEventListener('click', (e) => e.stopPropagation());
      callsignInput.addEventListener('input', (e) => {
        e.stopPropagation();
        const cleaned = callsignInput.value.trim().slice(0, 24);
        if (cleaned.length > 0) {
          settingsStore.update('callsign', cleaned);
        }
      });
    }

    // 1. Faction Selector (hydrate active button from settingsStore)
    const factionBtns = document.querySelectorAll('#faction-selector .lobby-btn');
    factionBtns.forEach((btn) => {
      const btnFaction = btn.getAttribute('data-faction') as PlayerFaction | null;
      btn.classList.toggle('active', btnFaction === settingsStore.settings.faction);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        factionBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const faction = btn.getAttribute('data-faction') as PlayerFaction | null;
        if (faction) {
          settingsStore.update('faction', faction);
          this.callbacks.onFactionChanged?.(faction);
        }
      });
    });

    // 2. Difficulty Tier Selector (hydrate active button from settingsStore)
    const diffBtns = document.querySelectorAll('#diff-selector .lobby-btn');
    diffBtns.forEach((btn) => {
      const btnDiff = btn.getAttribute('data-diff') as BotDifficulty | null;
      btn.classList.toggle('active', btnDiff === settingsStore.settings.botDifficulty);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        diffBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const diff = btn.getAttribute('data-diff') as BotDifficulty | null;
        if (diff) {
          settingsStore.update('botDifficulty', diff);
          this.callbacks.onDifficultyChanged(diff);
        }
      });
    });

    // 3. Game Mode Selector (hydrate active button + panel from settingsStore)
    const modeBtns = document.querySelectorAll('#mode-selector .lobby-btn');
    const mpPanel = document.getElementById('multiplayer-config-panel');
    if (mpPanel) {
      mpPanel.style.display = settingsStore.settings.gameMode === 'multiplayer' ? 'block' : 'none';
    }
    modeBtns.forEach((btn) => {
      const btnMode = btn.getAttribute('data-mode') as GameMode | null;
      btn.classList.toggle('active', btnMode === settingsStore.settings.gameMode);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        modeBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.getAttribute('data-mode') as GameMode | null;
        if (mode) {
          settingsStore.update('gameMode', mode);
          if (mpPanel) {
            mpPanel.style.display = mode === 'multiplayer' ? 'block' : 'none';
          }
          this.callbacks.onModeChanged?.(mode);
        }
      });
    });

    // 3b. Graphics Quality Selector
    const qualityBtns = document.querySelectorAll('#quality-selector .lobby-btn');
    qualityBtns.forEach((btn) => {
      const btnQuality = btn.getAttribute('data-quality') as GraphicsQuality | null;
      btn.classList.toggle('active', btnQuality === settingsStore.settings.graphicsQuality);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        qualityBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const q = btn.getAttribute('data-quality') as GraphicsQuality | null;
        if (q) {
          settingsStore.update('graphicsQuality', q);
          this.callbacks.onQualityChanged?.(q);
        }
      });
    });

    // 4. Master Volume Slider
    const volSlider = document.getElementById('vol-slider') as HTMLInputElement | null;
    const volVal = document.getElementById('vol-val');
    if (volSlider && volVal) {
      volSlider.value = Math.round(settingsStore.settings.masterVolume * 100).toString();
      volVal.textContent = `${volSlider.value}%`;
      volSlider.addEventListener('click', (e) => e.stopPropagation());
      volSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = parseInt(volSlider.value, 10);
        volVal.textContent = `${val}%`;
        const ratio = val / 100;
        settingsStore.update('masterVolume', ratio);
        this.callbacks.onVolumeChanged(ratio);
      });
    }

    // 5. Mouse Sensitivity Slider
    const sensSlider = document.getElementById('sens-slider') as HTMLInputElement | null;
    const sensVal = document.getElementById('sens-val');
    if (sensSlider && sensVal) {
      sensSlider.value = settingsStore.settings.mouseSensitivity.toString();
      sensVal.textContent = settingsStore.settings.mouseSensitivity.toFixed(1);
      sensSlider.addEventListener('click', (e) => e.stopPropagation());
      sensSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = parseFloat(sensSlider.value);
        sensVal.textContent = val.toFixed(1);
        settingsStore.update('mouseSensitivity', val);
        this.callbacks.onSensitivityChanged(val);
      });
    }

    // 6. Scoped Sensitivity Multiplier Slider
    const scopedSlider = document.getElementById('scoped-sens-slider') as HTMLInputElement | null;
    const scopedVal = document.getElementById('scoped-sens-val');
    if (scopedSlider && scopedVal) {
      scopedSlider.value = settingsStore.settings.scopedSensitivityMultiplier.toString();
      scopedVal.textContent = `${settingsStore.settings.scopedSensitivityMultiplier.toFixed(2)}x`;
      scopedSlider.addEventListener('click', (e) => e.stopPropagation());
      scopedSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = parseFloat(scopedSlider.value);
        scopedVal.textContent = `${val.toFixed(2)}x`;
        settingsStore.update('scopedSensitivityMultiplier', val);
      });
    }

    // 7. FOV Slider
    const fovSlider = document.getElementById('fov-slider') as HTMLInputElement | null;
    const fovVal = document.getElementById('fov-val');
    if (fovSlider && fovVal) {
      fovSlider.value = settingsStore.settings.fov.toString();
      fovVal.textContent = `${settingsStore.settings.fov}°`;
      fovSlider.addEventListener('click', (e) => e.stopPropagation());
      fovSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = parseInt(fovSlider.value, 10);
        fovVal.textContent = `${val}°`;
        settingsStore.update('fov', val);
        this.callbacks.onFovChanged(val);
      });
    }

    // 8. Customizer Button
    const custBtn = document.getElementById('open-customizer-btn');
    if (custBtn) {
      custBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onCustomizer();
      });
    }

    // 9. Deploy Button
    const spawnBtn = document.getElementById('spawn-btn');
    if (spawnBtn) {
      spawnBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onDeploy();
      });
    }
  }
}

