/**
 * Clean-Room Event-Driven Tactical Bot Chatter Engine
 * Modeled after CS 1.6 BotChatter.db (Place + Phrase + Count + Priority + Cooldown gating).
 */

export type BotChatterEvent =
  | 'ENEMY_SPOTTED'
  | 'ENEMY_DOWN'
  | 'CLEAR'
  | 'NEED_BACKUP'
  | 'AFFIRMATIVE'
  | 'NEGATIVE'
  | 'PLANTING_BOMB'
  | 'DEFUSING_BOMB'
  | 'SPOTTED_BOMBER'
  | 'SPOTTED_LOOSE_BOMB'
  | 'HOSTAGES_TAKEN'
  | 'ESCORTING_HOSTAGES'
  | 'BLINDED'
  | 'ONE_ENEMY_LEFT'
  | 'WON_ROUND'
  | 'FOLLOWING_COMMANDER'
  | 'HOLDING_POSITION'
  | 'ON_MY_WAY'
  | 'SNIPER_WARNING';

export interface ChatterLineSpec {
  text: string;
  important: boolean;
  cooldownSec: number;
  radioEvent?: string;
}

export function buildBotChatterLine(
  event: BotChatterEvent,
  callout: string,
  enemyCount = 1,
  site?: 'A' | 'B' | null
): ChatterLineSpec {
  const loc = callout && callout !== 'ARENA' ? callout : 'this sector';
  switch (event) {
    case 'ENEMY_SPOTTED': {
      const countText =
        enemyCount >= 4
          ? 'Multiple hostiles pushing hard'
          : enemyCount === 3
            ? 'Three hostiles'
            : enemyCount === 2
              ? 'Two hostiles'
              : 'One enemy spotted';
      return { text: `${countText} at ${loc}!`, important: true, cooldownSec: 4.5, radioEvent: 'ct_enemys' };
    }
    case 'SPOTTED_BOMBER':
      return { text: `Eyes on the bomb carrier at ${loc}!`, important: true, cooldownSec: 6.0 };
    case 'SPOTTED_LOOSE_BOMB':
      return { text: `Bomb is down on the ground at ${loc}!`, important: true, cooldownSec: 7.0 };
    case 'ENEMY_DOWN':
      return { text: `Enemy neutralized at ${loc}.`, important: false, cooldownSec: 3.0, radioEvent: 'enemydown' };
    case 'CLEAR':
      return { text: `Sector clear at ${loc}.`, important: false, cooldownSec: 6.0, radioEvent: 'clear' };
    case 'NEED_BACKUP':
      return { text: `Taking fire at ${loc} — need backup!`, important: true, cooldownSec: 5.0, radioEvent: 'ct_backup' };
    case 'PLANTING_BOMB':
      return { text: `Cover me, planting Pulse Core at Site ${site || 'A'}!`, important: true, cooldownSec: 4.0, radioEvent: 'ct_coverme' };
    case 'DEFUSING_BOMB':
      return { text: `Defusing the Pulse Core now — cover me!`, important: true, cooldownSec: 4.0, radioEvent: 'ct_coverme' };
    case 'HOSTAGES_TAKEN':
      return { text: `They've got the hostages near ${loc}!`, important: true, cooldownSec: 5.0 };
    case 'ESCORTING_HOSTAGES':
      return { text: `Escorting hostages back to Courtyard rescue zone!`, important: true, cooldownSec: 5.0 };
    case 'BLINDED':
      return { text: `I'm flashed! Can't see!`, important: false, cooldownSec: 4.0 };
    case 'ONE_ENEMY_LEFT':
      return { text: `One hostile remaining!`, important: true, cooldownSec: 8.0 };
    case 'WON_ROUND':
      return { text: `Solid work, squad. Round secured.`, important: false, cooldownSec: 8.0 };
    case 'FOLLOWING_COMMANDER':
      return { text: `Lead the way, Commander. On your six.`, important: true, cooldownSec: 2.0, radioEvent: 'roger' };
    case 'HOLDING_POSITION':
      return { text: `Affirmative. Holding ${loc}.`, important: true, cooldownSec: 2.0, radioEvent: 'ct_inpos' };
    case 'ON_MY_WAY':
      return { text: `Roger, rotating to ${loc} now!`, important: true, cooldownSec: 2.5, radioEvent: 'ct_affirm' };
    case 'SNIPER_WARNING':
      return { text: `Watch out, sniper holding ${loc}!`, important: true, cooldownSec: 6.0 };
    case 'NEGATIVE':
      return { text: `Negative.`, important: true, cooldownSec: 2.0, radioEvent: 'negative' };
    case 'AFFIRMATIVE':
    default:
      return { text: `Affirmative, roger that.`, important: true, cooldownSec: 2.0, radioEvent: 'roger' };
  }
}
