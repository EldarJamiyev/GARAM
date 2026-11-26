export type BotDifficulty = 'Recruit' | 'Veteran' | 'Elite' | 'Sovereign';
export type PlayerFaction = 'Vanguard' | 'Syndicate';
export type GameMode = 'offline' | 'multiplayer';
export type ActiveMapId = 'de_dust2' | 'cs_office';
export type GraphicsQuality = 'AUTO' | 'POTATO' | 'LOW' | 'MEDIUM' | 'HIGH';
export type QualityTier = 'POTATO' | 'LOW' | 'MEDIUM' | 'HIGH';

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
  callsign: string;
  faction: PlayerFaction;
  mapId: ActiveMapId;
  botDifficulty: BotDifficulty;
  graphicsQuality: GraphicsQuality;
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
  callsign: 'Eldar Garamov',
  faction: 'Vanguard',
  mapId: 'de_dust2',
  botDifficulty: 'Veteran',
  graphicsQuality: 'AUTO',
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

const STORAGE_KEY = 'garam_tactical_settings_v2';
const LEGACY_STORAGE_KEY = 'garam_tactical_settings_v1';
const VALID_GRAPHICS_QUALITIES: ReadonlySet<GraphicsQuality> = new Set([
  'AUTO',
  'POTATO',
  'LOW',
  'MEDIUM',
  'HIGH',
]);

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
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
          const parsed = JSON.parse(data) as Partial<UserSettings>;
          const rawQuality = parsed.graphicsQuality;
          const graphicsQuality: GraphicsQuality =
            rawQuality && VALID_GRAPHICS_QUALITIES.has(rawQuality) && rawQuality !== 'POTATO'
              ? rawQuality
              : 'AUTO';
          return {
            ...DEFAULT_SETTINGS,
            ...parsed,
            graphicsQuality,
            crosshair: { ...DEFAULT_SETTINGS.crosshair, ...(parsed.crosshair ?? {}) },
          };
        }
      }
    } catch {
      // Fallback to defaults when storage is blocked or unavailable
    }
    return { ...DEFAULT_SETTINGS, crosshair: { ...DEFAULT_SETTINGS.crosshair } };
  }

  public save(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
      }
    } catch {
      // Ignore storage quota / sandbox restrictions
    }
  }

  public update<K extends keyof UserSettings>(key: K, value: UserSettings[K]): void {
    this.settings[key] = value;
    this.save();
  }
}

export const settingsStore = SettingsStore.getInstance();
