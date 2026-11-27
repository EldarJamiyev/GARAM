import { WEAPONS } from '../constants/weapons.js';
import { ECONOMY } from '../constants/economy.js';

/**
 * CS 1.6 autobuy.txt & rebuy.txt priority automation kernel.
 */
export const AUTOBUY_PRIORITY_VANGUARD: readonly string[] = [
  'vanguard-m4',
  'm4a4',
  'clarion-famas',
  'p90',
  'mp5-navy',
  'mp9',
  'primammo',
  'secammo',
  'defuse-kit',
  'kevlar-helmet',
  'kevlar',
];

export const AUTOBUY_PRIORITY_SYNDICATE: readonly string[] = [
  'garam-47',
  'defender-galil',
  'p90',
  'mp5-navy',
  'primammo',
  'secammo',
  'kevlar-helmet',
  'kevlar',
];

export type RebuyCategory =
  | 'PrimaryWeapon'
  | 'PrimaryAmmo'
  | 'Defuser'
  | 'Armor'
  | 'HEGrenade'
  | 'Flashbang'
  | 'SmokeGrenade'
  | 'Molotov'
  | 'SecondaryWeapon'
  | 'SecondaryAmmo'
  | 'NightVision';

export const DEFAULT_REBUY_ORDER: readonly RebuyCategory[] = [
  'PrimaryWeapon',
  'PrimaryAmmo',
  'Defuser',
  'Armor',
  'HEGrenade',
  'Flashbang',
  'SmokeGrenade',
  'Molotov',
  'SecondaryWeapon',
  'SecondaryAmmo',
  'NightVision',
];

export interface RebuySnapshot {
  primaryWeaponId: string | null;
  secondaryWeaponId: string | null;
  armorTier: 'none' | 'kevlar' | 'kevlar-helmet';
  hasDefuseKit: boolean;
  hasNightVision: boolean;
  utilities: string[];
}

export interface BuyPlanContext {
  faction: 'Vanguard' | 'Syndicate';
  cash: number;
  currentPrimaryId: string | null;
  currentSecondaryId: string | null;
  armor: number;
  hasHelmet: boolean;
  hasDefuseKit: boolean;
  hasNightVision: boolean;
  ownedUtilities: Record<string, number>;
}

/**
 * Computes deterministic ordered purchase item IDs for [F1] AutoBuy.
 */
export function computeAutoBuySequence(ctx: BuyPlanContext): string[] {
  const plan: string[] = [];
  let cashLeft = ctx.cash;
  let hasPrimary = Boolean(ctx.currentPrimaryId);
  let armor = ctx.armor;
  let hasHelmet = ctx.hasHelmet;
  let hasKit = ctx.hasDefuseKit;

  const list = ctx.faction === 'Vanguard' ? AUTOBUY_PRIORITY_VANGUARD : AUTOBUY_PRIORITY_SYNDICATE;

  for (const token of list) {
    if (token === 'primammo' || token === 'secammo') {
      plan.push(token);
      continue;
    }
    if (token === 'defuse-kit') {
      if (ctx.faction === 'Vanguard' && !hasKit && cashLeft >= ECONOMY.prices.defuseKit) {
        plan.push('defuse-kit');
        cashLeft -= ECONOMY.prices.defuseKit;
        hasKit = true;
      }
      continue;
    }
    if (token === 'kevlar-helmet') {
      if (!(armor >= 100 && hasHelmet) && cashLeft >= ECONOMY.prices.kevlarHelmetCombo) {
        plan.push('kevlar-helmet');
        cashLeft -= ECONOMY.prices.kevlarHelmetCombo;
        armor = 100;
        hasHelmet = true;
      }
      continue;
    }
    if (token === 'kevlar') {
      if (armor < 100 && cashLeft >= ECONOMY.prices.kevlar) {
        plan.push('kevlar');
        cashLeft -= ECONOMY.prices.kevlar;
        armor = 100;
      }
      continue;
    }
    const def = WEAPONS[token];
    if (def && def.slot === 1 && !hasPrimary && cashLeft >= def.price) {
      plan.push(def.id);
      cashLeft -= def.price;
      hasPrimary = true;
    }
  }
  return plan;
}

/**
 * Computes deterministic ordered purchase item IDs for [F4] Rebuy.
 */
export function computeRebuySequence(ctx: BuyPlanContext, snap: RebuySnapshot): string[] {
  const plan: string[] = [];
  let cashLeft = ctx.cash;
  let armor = ctx.armor;
  let hasHelmet = ctx.hasHelmet;
  let hasKit = ctx.hasDefuseKit;
  let hasNvg = ctx.hasNightVision;

  for (const cat of DEFAULT_REBUY_ORDER) {
    if (cat === 'PrimaryWeapon' && snap.primaryWeaponId && ctx.currentPrimaryId !== snap.primaryWeaponId) {
      const def = WEAPONS[snap.primaryWeaponId];
      if (def && cashLeft >= def.price) {
        plan.push(def.id);
        cashLeft -= def.price;
      }
    } else if (cat === 'PrimaryAmmo') {
      plan.push('primammo');
    } else if (cat === 'SecondaryWeapon' && snap.secondaryWeaponId && ctx.currentSecondaryId !== snap.secondaryWeaponId) {
      const def = WEAPONS[snap.secondaryWeaponId];
      if (def && cashLeft >= def.price) {
        plan.push(def.id);
        cashLeft -= def.price;
      }
    } else if (cat === 'SecondaryAmmo') {
      plan.push('secammo');
    } else if (cat === 'Defuser' && ctx.faction === 'Vanguard' && snap.hasDefuseKit && !hasKit) {
      if (cashLeft >= ECONOMY.prices.defuseKit) {
        plan.push('defuse-kit');
        cashLeft -= ECONOMY.prices.defuseKit;
        hasKit = true;
      }
    } else if (cat === 'Armor' && snap.armorTier !== 'none') {
      if (snap.armorTier === 'kevlar-helmet' && !(armor >= 100 && hasHelmet) && cashLeft >= 1000) {
        plan.push('kevlar-helmet');
        cashLeft -= 1000;
        armor = 100;
        hasHelmet = true;
      } else if (armor < 100 && cashLeft >= 650) {
        plan.push('kevlar');
        cashLeft -= 650;
        armor = 100;
      }
    } else if (cat === 'HEGrenade' && snap.utilities.includes('he-grenade') && (ctx.ownedUtilities['he-grenade'] || 0) < 1 && cashLeft >= 300) {
      plan.push('he-grenade');
      cashLeft -= 300;
    } else if (cat === 'Flashbang' && snap.utilities.includes('flashbang') && (ctx.ownedUtilities['flashbang'] || 0) < 2 && cashLeft >= 200) {
      plan.push('flashbang');
      cashLeft -= 200;
    } else if (cat === 'SmokeGrenade' && snap.utilities.includes('smoke-grenade') && (ctx.ownedUtilities['smoke-grenade'] || 0) < 1 && cashLeft >= 300) {
      plan.push('smoke-grenade');
      cashLeft -= 300;
    } else if (cat === 'Molotov' && snap.utilities.includes('molotov') && (ctx.ownedUtilities['molotov'] || 0) < 1 && cashLeft >= 400) {
      plan.push('molotov');
      cashLeft -= 400;
    } else if (cat === 'NightVision' && snap.hasNightVision && !hasNvg && cashLeft >= 1250) {
      plan.push('nvg');
      cashLeft -= 1250;
      hasNvg = true;
    }
  }
  return plan;
}
