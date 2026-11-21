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
    weaponPreferences: ['garam-47', 'vanguard-m4', 'desert-eagle'],
    tacticalPatienceSec: 3.5,
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
    weaponPreferences: ['vanguard-m4', 'garam-47', 'desert-eagle'],
    tacticalPatienceSec: 6.0,
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
    weaponPreferences: ['sovereign-awp', 'desert-eagle', 'vanguard-m4'],
    tacticalPatienceSec: 7.5,
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
    weaponPreferences: ['vanguard-m4', 'desert-eagle'],
    tacticalPatienceSec: 4.5,
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
    weaponPreferences: ['vanguard-m4', 'garam-47'],
    tacticalPatienceSec: 5.0,
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
    weaponPreferences: ['sovereign-awp', 'desert-eagle', 'garam-47'],
    tacticalPatienceSec: 4.0,
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
    weaponPreferences: ['garam-47', 'desert-eagle'],
    tacticalPatienceSec: 6.5,
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
    weaponPreferences: ['garam-47', 'desert-eagle'],
    tacticalPatienceSec: 2.5,
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
    weaponPreferences: ['garam-47', 'vanguard-m4'],
    tacticalPatienceSec: 4.0,
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
    weaponPreferences: ['garam-47', 'desert-eagle'],
    tacticalPatienceSec: 3.0,
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
  // Normalize lookup key
  const key = botName.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const archKey of Object.keys(BOT_ARCHETYPES)) {
    if (key.includes(archKey)) {
      return scaleArchetypeToDifficulty(BOT_ARCHETYPES[archKey], globalDifficulty);
    }
  }

  // Fallback procedural archetype
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
    weaponPreferences: isVanguard ? ['vanguard-m4', 'garam-47'] : ['garam-47', 'vanguard-m4'],
    tacticalPatienceSec: 4.0,
  };

  return scaleArchetypeToDifficulty(fallback, globalDifficulty);
}

function scaleArchetypeToDifficulty(arch: BotArchetype, diff: BotDifficultyTier): BotArchetype {
  const scaled = { ...arch, difficulty: diff };
  if (diff === 'Recruit') {
    scaled.reactionTimeMs = Math.max(480, Math.round(arch.reactionTimeMs * 2.0));
    scaled.slewRateDegPerSec = Math.min(240, Math.round(arch.slewRateDegPerSec * 0.55));
    scaled.skill = Math.min(48, Math.round(arch.skill * 0.58));
  } else if (diff === 'Veteran') {
    // Prevent Sovereign/Elite named archetypes (e.g. Viper 145ms / Maverick 140ms) from retaining
    // inhuman reflexes on Veteran while keeping the procedural fallback (skill 75, reaction 280ms) intact.
    if (arch.reactionTimeMs < 280) {
      scaled.reactionTimeMs = Math.round(280 + (arch.reactionTimeMs - 140) * 0.45 + 35);
    } else {
      scaled.reactionTimeMs = Math.min(420, arch.reactionTimeMs);
    }
    scaled.slewRateDegPerSec = Math.min(420, Math.max(300, arch.slewRateDegPerSec));
    scaled.skill = Math.min(80, Math.max(64, arch.skill));
  } else if (diff === 'Elite') {
    scaled.reactionTimeMs = Math.max(210, Math.min(275, arch.reactionTimeMs < 210 ? 210 + Math.round((arch.reactionTimeMs - 140) * 0.4) : arch.reactionTimeMs));
    scaled.slewRateDegPerSec = Math.min(580, Math.max(480, arch.slewRateDegPerSec));
    scaled.skill = Math.min(91, Math.max(84, arch.skill));
  } else if (diff === 'Sovereign') {
    scaled.reactionTimeMs = Math.min(arch.reactionTimeMs, 155);
    scaled.slewRateDegPerSec = Math.max(arch.slewRateDegPerSec, 720);
    scaled.skill = Math.max(96, arch.skill);
  }
  return scaled;
}
