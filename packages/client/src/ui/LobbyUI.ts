import { settingsStore, BotDifficulty, PlayerFaction, GameMode } from '../core/SettingsStore.js';
import { ProceduralAudio } from '../audio/ProceduralAudio.js';

export interface LobbyUICallbacks {
  onDeploy: () => void;
  onCustomizer: () => void;
  onSensitivityChanged: (val: number) => void;
  onFovChanged: (val: number) => void;
  onVolumeChanged: (val: number) => void;
  onDifficultyChanged: (diff: BotDifficulty) => void;
  onModeChanged?: (mode: GameMode) => void;
  onFactionChanged?: (faction: PlayerFaction) => void;
}

export class LobbyUI {
  private callbacks: LobbyUICallbacks;

  constructor(callbacks: LobbyUICallbacks) {
    this.callbacks = callbacks;
    this.bindEvents();
  }

  private bindEvents(): void {
    // Auto-detect LAN host IP for multiplayer connection
    const urlInput = document.getElementById('server-url-input') as HTMLInputElement;
    if (urlInput && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      urlInput.value = `ws://${window.location.hostname}:2567`;
    }

    // 1. Faction Selector
    const factionBtns = document.querySelectorAll('#faction-selector .lobby-btn');
    factionBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        factionBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const faction = btn.getAttribute('data-faction') as PlayerFaction;
        if (faction) {
          settingsStore.update('faction', faction);
          this.callbacks.onFactionChanged?.(faction);
        }
      });
    });

    // 2. Difficulty Tier Selector
    const diffBtns = document.querySelectorAll('#diff-selector .lobby-btn');
    diffBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        diffBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const diff = btn.getAttribute('data-diff') as BotDifficulty;
        if (diff) {
          settingsStore.update('botDifficulty', diff);
          this.callbacks.onDifficultyChanged(diff);
        }
      });
    });

    // 3. Game Mode Selector
    const modeBtns = document.querySelectorAll('#mode-selector .lobby-btn');
    const mpPanel = document.getElementById('multiplayer-config-panel');
    modeBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        modeBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.getAttribute('data-mode') as GameMode;
        if (mode) {
          settingsStore.update('gameMode', mode);
          if (mpPanel) {
            mpPanel.style.display = mode === 'multiplayer' ? 'block' : 'none';
          }
          this.callbacks.onModeChanged?.(mode);
        }
      });
    });

    // 4. Master Volume Slider
    const volSlider = document.getElementById('vol-slider') as HTMLInputElement;
    const volVal = document.getElementById('vol-val');
    if (volSlider && volVal) {
      volSlider.value = Math.round(settingsStore.settings.masterVolume * 100).toString();
      volVal.innerText = `${volSlider.value}%`;
      volSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = parseInt(volSlider.value, 10);
        volVal.innerText = `${val}%`;
        const ratio = val / 100;
        settingsStore.update('masterVolume', ratio);
        this.callbacks.onVolumeChanged(ratio);
      });
    }

    // 5. Mouse Sensitivity Slider
    const sensSlider = document.getElementById('sens-slider') as HTMLInputElement;
    const sensVal = document.getElementById('sens-val');
    if (sensSlider && sensVal) {
      sensSlider.value = settingsStore.settings.mouseSensitivity.toString();
      sensVal.innerText = settingsStore.settings.mouseSensitivity.toFixed(1);
      sensSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = parseFloat(sensSlider.value);
        sensVal.innerText = val.toFixed(1);
        settingsStore.update('mouseSensitivity', val);
        this.callbacks.onSensitivityChanged(val);
      });
    }

    // 6. Scoped Sensitivity Multiplier Slider
    const scopedSlider = document.getElementById('scoped-sens-slider') as HTMLInputElement;
    const scopedVal = document.getElementById('scoped-sens-val');
    if (scopedSlider && scopedVal) {
      scopedSlider.value = settingsStore.settings.scopedSensitivityMultiplier.toString();
      scopedVal.innerText = `${settingsStore.settings.scopedSensitivityMultiplier.toFixed(2)}x`;
      scopedSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = parseFloat(scopedSlider.value);
        scopedVal.innerText = `${val.toFixed(2)}x`;
        settingsStore.update('scopedSensitivityMultiplier', val);
      });
    }

    // 7. FOV Slider
    const fovSlider = document.getElementById('fov-slider') as HTMLInputElement;
    const fovVal = document.getElementById('fov-val');
    if (fovSlider && fovVal) {
      fovSlider.value = settingsStore.settings.fov.toString();
      fovVal.innerText = `${settingsStore.settings.fov}°`;
      fovSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = parseInt(fovSlider.value, 10);
        fovVal.innerText = `${val}°`;
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
      spawnBtn.addEventListener('click', () => {
        this.callbacks.onDeploy();
      });
    }
  }
}
