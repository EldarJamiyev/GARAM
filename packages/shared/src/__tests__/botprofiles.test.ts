import { describe, it, expect } from 'vitest';
import { resolveBotArchetype, BOT_ARCHETYPES } from '../ai/BotProfiles.js';

describe('Clean-Room Tactical Bot Archetypes & Personality Engine', () => {
  it('correctly resolves known Vanguard and Syndicate named archetypes', () => {
    const maverick = resolveBotArchetype('bot_1', 'Eldar "Maverick" Garamov', 'Vanguard', 'Sovereign');
    expect(maverick.id).toBe('maverick');
    expect(maverick.faction).toBe('Vanguard');
    expect(maverick.preferredRole).toBe('entry');
    expect(maverick.skill).toBe(98);
    expect(maverick.reactionTimeMs).toBe(140);
    expect(maverick.weaponPreferences).toContain('garam-47');

    const viper = resolveBotArchetype('bot_2', 'Syndicate Viper', 'Syndicate', 'Sovereign');
    expect(viper.id).toBe('viper');
    expect(viper.faction).toBe('Syndicate');
    expect(viper.weaponPreferences[0]).toBe('sovereign-awp');
    expect(viper.reactionTimeMs).toBe(145);

    const steel = resolveBotArchetype('bot_3', 'Vanguard Steel', 'Vanguard', 'Elite');
    expect(steel.id).toBe('steel');
    expect(steel.preferredRole).toBe('anchor');
    expect(steel.teamwork).toBe(96);
  });

  it('correctly scales reaction time, slew rate, and skill across difficulty tiers', () => {
    // Recruit tier scales down reaction speed and skill
    const recruitRazor = resolveBotArchetype('bot_4', 'Syndicate Razor', 'Syndicate', 'Recruit');
    expect(recruitRazor.difficulty).toBe('Recruit');
    expect(recruitRazor.reactionTimeMs).toBeGreaterThanOrEqual(380);
    expect(recruitRazor.slewRateDegPerSec).toBeLessThanOrEqual(288);
    expect(recruitRazor.skill).toBeLessThanOrEqual(60);

    // Sovereign tier achieves competitive esports reaction windows
    const sovereignRazor = resolveBotArchetype('bot_4', 'Syndicate Razor', 'Syndicate', 'Sovereign');
    expect(sovereignRazor.difficulty).toBe('Sovereign');
    expect(sovereignRazor.reactionTimeMs).toBeLessThanOrEqual(155);
    expect(sovereignRazor.slewRateDegPerSec).toBe(720);
    expect(sovereignRazor.skill).toBeGreaterThanOrEqual(96);
  });

  it('generates a stable procedural fallback archetype for unknown bot names', () => {
    const unknownBot = resolveBotArchetype('bot_99', 'Combat Drone 01', 'Vanguard', 'Veteran');
    expect(unknownBot.id).toBe('bot_99');
    expect(unknownBot.faction).toBe('Vanguard');
    expect(unknownBot.skill).toBe(75);
    expect(unknownBot.reactionTimeMs).toBe(280);
    expect(unknownBot.weaponPreferences.length).toBeGreaterThan(0);
  });
});
