export type BotDifficulty = 'Recruit' | 'Veteran' | 'Elite' | 'Sovereign';
export type PlayerFaction = 'Vanguard' | 'Syndicate';
export type GameMode = 'offline' | 'multiplayer';

export interface CrosshairConfig {
  thickness: number;
  length: number;
  gap: number;
  outline: boolean;
  centerDot: boolean;
  dynamicSpread: boolean;
  color: string;
}

export interface UserSettings {
  faction: PlayerFaction;
  botDifficulty: BotDifficulty;
  mouseSensitivity: number;
  scopedSensitivityMultiplier: number;
  masterVolume: number;
  fov: number;
  gameMode: GameMode;
  multiplayerHost: string;
  crosshair: CrosshairConfig;
  followRecoil: boolean;
  showHitboxes: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  faction: 'Vanguard',
  botDifficulty: 'Veteran',
  mouseSensitivity: 2.2,
  scopedSensitivityMultiplier: 0.8,
  masterVolume: 0.85,
  fov: 90,
  gameMode: 'offline',
  multiplayerHost: 'ws://localhost:2567',
  followRecoil: false,
  showHitboxes: false,
  crosshair: {
    thickness: 2,
    length: 8,
    gap: 4,
    outline: true,
    centerDot: false,
    dynamicSpread: true,
    color: '#00ff66',
  },
};

const STORAGE_KEY = 'garam_tactical_settings_v1';

export class SettingsStore {
  private static instance: SettingsStore;
  public settings: UserSettings;
  public sandboxWeaponOverrides: Record<string, Partial<Record<string, number>>> = {};

  private constructor() {
    this.settings = this.load();
  }

  public static getInstance(): SettingsStore {
    if (!SettingsStore.instance) {
      SettingsStore.instance = new SettingsStore();
    }
    return SettingsStore.instance;
  }

  private load(): UserSettings {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
      }
    } catch (e) {
      console.warn('[SettingsStore] Failed to load localStorage settings, using defaults');
    }
    return { ...DEFAULT_SETTINGS };
  }

  public save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (e) {
      console.warn('[SettingsStore] Failed to save settings to localStorage');
    }
  }

  public update<K extends keyof UserSettings>(key: K, value: UserSettings[K]): void {
    this.settings[key] = value;
    this.save();
  }
}

export const settingsStore = SettingsStore.getInstance();
