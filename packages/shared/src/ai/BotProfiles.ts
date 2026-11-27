/**
 * GARAM: ZERO HOUR — Clean-Room Tactical Bot Archetypes & Personality Engine
 * Inspired by high-level tactical FPS bot design; 100% clean-room TypeScript kernel implementation.
 */

export type BotDifficultyTier = 'Recruit' | 'Veteran' | 'Elite' | 'Sovereign';
export type TacticalRole = 'entry' | 'support' | 'lurker' | 'anchor' | 'rotator';

export interface BotArchetype {
  id: string;
  name: string;
  callsign: string;
  faction: 'Vanguard' | 'Syndicate';
  difficulty: BotDifficultyTier;
  skill: number; // 0 to 100 (Aim accuracy & recoil control)
  aggression: number; // 0 to 100 (Push frequency vs passive holding)
  reactionTimeMs: number; // 130ms to 540ms
  slewRateDegPerSec: number; // 220 to 720 deg/s
  teamwork: number; // 0 to 100 (Propensity to rotate, cover bomb, yield defuse)
  preferredRole: TacticalRole;
  weaponPreferences: string[];
  tacticalPatienceSec: number; // Angle-holding duration before repositioning
  voicePitch: number; // 0.80 to 1.25 (maps directly to CS 1.6 BotProfile.db VoicePitch / 100)
  attackDelayMs: number; // 0 to 400ms hesitation delay for lower skill bots
}

export const BOT_ARCHETYPES: Record<string, BotArchetype> = {
  // --- VANGUARD CT SPECIALISTS ---
  'maverick': {
    id: 'maverick',
    name: 'Eldar "Maverick" Garamov',
    callsign: 'Vanguard-1',
    faction: 'Vanguard',
    difficulty: 'Sovereign',
    skill: 98,
    aggression: 85,
    reactionTimeMs: 140,
    slewRateDegPerSec: 720,
    teamwork: 90,
    preferredRole: 'entry',
    weaponPreferences: ['garam-47', 'm4a4', 'vanguard-m4', 'clarion-famas', 'mp5-navy', 'usp-s'],
    tacticalPatienceSec: 3.5,
    voicePitch: 0.96,
    attackDelayMs: 0,
  },
  'steel': {
    id: 'steel',
    name: 'Vanguard Steel',
    callsign: 'Vanguard-2',
    faction: 'Vanguard',
    difficulty: 'Elite',
    skill: 88,
    aggression: 45,
    reactionTimeMs: 200,
    slewRateDegPerSec: 540,
    teamwork: 96,
    preferredRole: 'anchor',
    weaponPreferences: ['m4a4', 'vanguard-m4', 'clarion-famas', 'mp5-navy', 'usp-s'],
    tacticalPatienceSec: 6.0,
    voicePitch: 0.88,
    attackDelayMs: 20,
  },
  'hawk': {
    id: 'hawk',
    name: 'Vanguard Hawk',
    callsign: 'Vanguard-3',
    faction: 'Vanguard',
    difficulty: 'Sovereign',
    skill: 95,
    aggression: 35,
    reactionTimeMs: 155,
    slewRateDegPerSec: 640,
    teamwork: 85,
    preferredRole: 'rotator',
    weaponPreferences: ['sovereign-awp', 'schmidt-scout', 'usp-s', 'desert-eagle', 'vanguard-m4'],
    tacticalPatienceSec: 7.5,
    voicePitch: 1.04,
    attackDelayMs: 0,
  },
  'aegis': {
    id: 'aegis',
    name: 'Vanguard Aegis',
    callsign: 'Vanguard-4',
    faction: 'Vanguard',
    difficulty: 'Veteran',
    skill: 82,
    aggression: 55,
    reactionTimeMs: 250,
    slewRateDegPerSec: 420,
    teamwork: 92,
    preferredRole: 'support',
    weaponPreferences: ['vanguard-m4', 'm4a4', 'p90', 'mp5-navy', 'usp-s'],
    tacticalPatienceSec: 4.5,
    voicePitch: 0.92,
    attackDelayMs: 45,
  },
  'sentinel': {
    id: 'sentinel',
    name: 'Vanguard Sentinel',
    callsign: 'Vanguard-5',
    faction: 'Vanguard',
    difficulty: 'Veteran',
    skill: 80,
    aggression: 50,
    reactionTimeMs: 260,
    slewRateDegPerSec: 400,
    teamwork: 88,
    preferredRole: 'anchor',
    weaponPreferences: ['m4a4', 'clarion-famas', 'leone-m3', 'mp9', 'usp-s'],
    tacticalPatienceSec: 5.0,
    voicePitch: 1.00,
    attackDelayMs: 60,
  },
  'cliffe': {
    id: 'cliffe',
    name: 'Vanguard Cliffe',
    callsign: 'Vanguard-6',
    faction: 'Vanguard',
    difficulty: 'Sovereign',
    skill: 97,
    aggression: 82,
    reactionTimeMs: 150,
    slewRateDegPerSec: 690,
    teamwork: 92,
    preferredRole: 'entry',
    weaponPreferences: ['m4a4', 'clarion-famas', 'mp5-navy', 'usp-s'],
    tacticalPatienceSec: 3.8,
    voicePitch: 0.95,
    attackDelayMs: 0,
  },
  'minh': {
    id: 'minh',
    name: 'Vanguard Minh',
    callsign: 'Vanguard-7',
    faction: 'Vanguard',
    difficulty: 'Elite',
    skill: 92,
    aggression: 88,
    reactionTimeMs: 175,
    slewRateDegPerSec: 610,
    teamwork: 88,
    preferredRole: 'rotator',
    weaponPreferences: ['p90', 'mp5-navy', 'mp9', 'usp-s'],
    tacticalPatienceSec: 3.0,
    voicePitch: 1.05,
    attackDelayMs: 0,
  },

  // --- SYNDICATE T INFILTRATORS ---
  'viper': {
    id: 'viper',
    name: 'Syndicate Viper',
    callsign: 'Syndicate-1',
    faction: 'Syndicate',
    difficulty: 'Sovereign',
    skill: 96,
    aggression: 75,
    reactionTimeMs: 145,
    slewRateDegPerSec: 720,
    teamwork: 70,
    preferredRole: 'entry',
    weaponPreferences: ['sovereign-awp', 'schmidt-scout', 'garam-47', 'desert-eagle', 'glock-18'],
    tacticalPatienceSec: 4.0,
    voicePitch: 1.08,
    attackDelayMs: 0,
  },
  'ghost': {
    id: 'ghost',
    name: 'Syndicate Ghost',
    callsign: 'Syndicate-2',
    faction: 'Syndicate',
    difficulty: 'Elite',
    skill: 90,
    aggression: 85,
    reactionTimeMs: 185,
    slewRateDegPerSec: 580,
    teamwork: 40,
    preferredRole: 'lurker',
    weaponPreferences: ['garam-47', 'defender-galil', 'mp5-navy', 'dual-elites', 'glock-18'],
    tacticalPatienceSec: 6.5,
    voicePitch: 0.94,
    attackDelayMs: 15,
  },
  'razor': {
    id: 'razor',
    name: 'Syndicate Razor',
    callsign: 'Syndicate-3',
    faction: 'Syndicate',
    difficulty: 'Veteran',
    skill: 86,
    aggression: 92,
    reactionTimeMs: 210,
    slewRateDegPerSec: 480,
    teamwork: 65,
    preferredRole: 'entry',
    weaponPreferences: ['garam-47', 'p90', 'xm1014', 'glock-18'],
    tacticalPatienceSec: 2.5,
    voicePitch: 1.12,
    attackDelayMs: 35,
  },
  'titan': {
    id: 'titan',
    name: 'Syndicate Titan',
    callsign: 'Syndicate-4',
    faction: 'Syndicate',
    difficulty: 'Veteran',
    skill: 83,
    aggression: 70,
    reactionTimeMs: 270,
    slewRateDegPerSec: 410,
    teamwork: 88,
    preferredRole: 'support',
    weaponPreferences: ['garam-47', 'defender-galil', 'leone-m3', 'glock-18'],
    tacticalPatienceSec: 4.0,
    voicePitch: 0.84,
    attackDelayMs: 55,
  },
  'nomad': {
    id: 'nomad',
    name: 'Syndicate Nomad',
    callsign: 'Syndicate-5',
    faction: 'Syndicate',
    difficulty: 'Recruit',
    skill: 68,
    aggression: 55,
    reactionTimeMs: 380,
    slewRateDegPerSec: 280,
    teamwork: 60,
    preferredRole: 'rotator',
    weaponPreferences: ['defender-galil', 'mp5-navy', 'dual-elites', 'glock-18'],
    tacticalPatienceSec: 3.0,
    voicePitch: 1.18,
    attackDelayMs: 180,
  },
  'zed': {
    id: 'zed',
    name: 'Syndicate Zed',
    callsign: 'Syndicate-6',
    faction: 'Syndicate',
    difficulty: 'Sovereign',
    skill: 96,
    aggression: 60,
    reactionTimeMs: 155,
    slewRateDegPerSec: 660,
    teamwork: 80,
    preferredRole: 'anchor',
    weaponPreferences: ['sovereign-awp', 'schmidt-scout', 'garam-47', 'desert-eagle'],
    tacticalPatienceSec: 6.5,
    voicePitch: 1.05,
    attackDelayMs: 0,
  },
  'rock': {
    id: 'rock',
    name: 'Syndicate Rock',
    callsign: 'Syndicate-7',
    faction: 'Syndicate',
    difficulty: 'Elite',
    skill: 89,
    aggression: 90,
    reactionTimeMs: 195,
    slewRateDegPerSec: 540,
    teamwork: 75,
    preferredRole: 'entry',
    weaponPreferences: ['xm1014', 'leone-m3', 'defender-galil', 'dual-elites'],
    tacticalPatienceSec: 2.8,
    voicePitch: 0.80,
    attackDelayMs: 0,
  },
};

/**
 * Resolves a dynamic bot archetype scaled to match the global difficulty tier setting
 */
export function resolveBotArchetype(
  botId: string,
  botName: string,
  faction: 'Vanguard' | 'Syndicate',
  globalDifficulty: BotDifficultyTier = 'Veteran'
): BotArchetype {
  const key = botName.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const archKey of Object.keys(BOT_ARCHETYPES)) {
    if (key.includes(archKey)) {
      return scaleArchetypeToDifficulty(BOT_ARCHETYPES[archKey], globalDifficulty);
    }
  }

  const isVanguard = faction === 'Vanguard';
  const fallback: BotArchetype = {
    id: botId,
    name: botName,
    callsign: `${faction}-${botId.slice(-2)}`,
    faction,
    difficulty: globalDifficulty,
    skill: 75,
    aggression: isVanguard ? 50 : 70,
    reactionTimeMs: 280,
    slewRateDegPerSec: 400,
    teamwork: isVanguard ? 85 : 70,
    preferredRole: isVanguard ? 'anchor' : 'entry',
    weaponPreferences: isVanguard
      ? ['m4a4', 'vanguard-m4', 'clarion-famas', 'mp5-navy', 'usp-s']
      : ['garam-47', 'defender-galil', 'p90', 'mp5-navy', 'glock-18'],
    tacticalPatienceSec: 4.0,
    voicePitch: 1.0,
    attackDelayMs: 50,
  };

  return scaleArchetypeToDifficulty(fallback, globalDifficulty);
}

function scaleArchetypeToDifficulty(arch: BotArchetype, diff: BotDifficultyTier): BotArchetype {
  const scaled = { ...arch, difficulty: diff };
  if (diff === 'Recruit') {
    scaled.reactionTimeMs = Math.max(480, Math.round(arch.reactionTimeMs * 2.0));
    scaled.slewRateDegPerSec = Math.min(240, Math.round(arch.slewRateDegPerSec * 0.55));
    scaled.skill = Math.min(48, Math.round(arch.skill * 0.58));
    scaled.attackDelayMs = Math.max(220, arch.attackDelayMs);
  } else if (diff === 'Veteran') {
    if (arch.reactionTimeMs < 280) {
      scaled.reactionTimeMs = Math.round(280 + (arch.reactionTimeMs - 140) * 0.45 + 35);
    } else {
      scaled.reactionTimeMs = Math.min(420, arch.reactionTimeMs);
    }
    scaled.slewRateDegPerSec = Math.min(420, Math.max(300, arch.slewRateDegPerSec));
    scaled.skill = Math.min(80, Math.max(64, arch.skill));
    scaled.attackDelayMs = Math.min(120, Math.max(30, arch.attackDelayMs));
  } else if (diff === 'Elite') {
    scaled.reactionTimeMs = Math.max(
      210,
      Math.min(275, arch.reactionTimeMs < 210 ? 210 + Math.round((arch.reactionTimeMs - 140) * 0.4) : arch.reactionTimeMs)
    );
    scaled.slewRateDegPerSec = Math.min(580, Math.max(480, arch.slewRateDegPerSec));
    scaled.skill = Math.min(91, Math.max(84, arch.skill));
    scaled.attackDelayMs = Math.min(40, arch.attackDelayMs);
  } else if (diff === 'Sovereign') {
    scaled.reactionTimeMs = Math.min(arch.reactionTimeMs, 155);
    scaled.slewRateDegPerSec = Math.max(arch.slewRateDegPerSec, 720);
    scaled.skill = Math.max(96, arch.skill);
    scaled.attackDelayMs = 0;
  }
  return scaled;
}
