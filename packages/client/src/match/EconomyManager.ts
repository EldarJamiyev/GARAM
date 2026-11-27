import { ECONOMY, getLossBonus, SPAWN_ZONES, RebuySnapshot } from '@garam/shared';
import { settingsStore } from '../core/SettingsStore.js';
import type { UtilityType } from '../utility/UtilityManager.js';

export interface PosXZ {
  x: number;
  z: number;
}

export interface BuyZonesConfig {
  VANGUARD_BUY_ZONE: { minX: number; maxX: number; minZ: number; maxZ: number };
  SYNDICATE_BUY_ZONE: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export class EconomyManager {
  public cash = ECONOMY.startingCash; // $800
  public armor = 100;
  public hasHelmet = true;
  public hasDefuseKit = false;
  public hasNightVision = false;
  public practiceInfiniteUtility = false;
  public rebuySnapshot: RebuySnapshot = {
    primaryWeaponId: null,
    secondaryWeaponId: null,
    armorTier: 'none',
    hasDefuseKit: false,
    hasNightVision: false,
    utilities: [],
  };
  private spawnZones: BuyZonesConfig;

  public ownedUtilities: Record<UtilityType, number> = {
    'smoke-grenade': 1,
    'flashbang': 0,
    'he-grenade': 0,
    'molotov': 0,
  };

  constructor(spawnZones: BuyZonesConfig = SPAWN_ZONES) {
    this.spawnZones = spawnZones;
  }

  public setSpawnZones(spawnZones: BuyZonesConfig): void {
    this.spawnZones = spawnZones;
  }

  public isInsideBuyZone(playerPos: PosXZ, faction: 'Vanguard' | 'Syndicate' = settingsStore.settings.faction): boolean {
    const bz = faction === 'Syndicate' ? this.spawnZones.SYNDICATE_BUY_ZONE : this.spawnZones.VANGUARD_BUY_ZONE;
    return (
      playerPos.x >= bz.minX &&
      playerPos.x <= bz.maxX &&
      playerPos.z >= bz.minZ &&
      playerPos.z <= bz.maxZ
    );
  }

  public canBuy(
    roundPhase: string,
    roundTimer: number,
    playerPos: PosXZ,
    faction: 'Vanguard' | 'Syndicate' = settingsStore.settings.faction
  ): { canBuy: boolean; reason?: string } {
    if (roundPhase === 'FREEZE_TIME') return { canBuy: true };

    if (roundPhase === 'ROUND_LIVE') {
      const elapsed = ECONOMY.roundLiveSec - roundTimer;
      if (elapsed > ECONOMY.buyWindowSec) {
        return { canBuy: false, reason: 'BUY WINDOW CLOSED (20s EXPIRED)' };
      }
      if (!this.isInsideBuyZone(playerPos, faction)) {
        return { canBuy: false, reason: 'OUTSIDE BUY ZONE' };
      }
      return { canBuy: true };
    }

    return { canBuy: false, reason: 'BUYING NOT PERMITTED' };
  }

  public addUtility(type: UtilityType): void {
    const cap = type === 'flashbang' ? 2 : 1;
    this.ownedUtilities[type] = Math.min(cap, (this.ownedUtilities[type] || 0) + 1);
  }

  public hasUtility(type: UtilityType): boolean {
    return (this.ownedUtilities[type] || 0) > 0;
  }

  public consumeUtility(type: UtilityType): boolean {
    if ((this.ownedUtilities[type] || 0) <= 0) return false;
    this.ownedUtilities[type]--;
    return true;
  }

  public spendCash(amount: number): boolean {
    if (this.cash >= amount) {
      this.cash -= amount;
      return true;
    }
    return false;
  }

  public addCash(amount: number): void {
    this.cash = Math.min(ECONOMY.maxCash, this.cash + amount);
  }

  public awardRoundEndPayout(
    isWinner: boolean,
    lossStreak: number,
    isBombWin: boolean,
    isSyndicatePlantLoss = false
  ): number {
    let payout = 0;
    if (isWinner) {
      payout = isBombWin ? ECONOMY.winCashBomb : ECONOMY.winCashElimination;
    } else {
      payout = getLossBonus(lossStreak);
      if (isSyndicatePlantLoss) {
        payout += ECONOMY.tLossBonusPostPlant;
      }
    }
    this.addCash(payout);
    return payout;
  }

  public captureRebuySnapshot(primaryId: string | null, secondaryId: string | null): void {
    const utils: string[] = [];
    for (const [k, count] of Object.entries(this.ownedUtilities)) {
      for (let i = 0; i < count; i++) utils.push(k);
    }
    this.rebuySnapshot = {
      primaryWeaponId: primaryId,
      secondaryWeaponId: secondaryId,
      armorTier: this.hasHelmet && this.armor >= 100 ? 'kevlar-helmet' : this.armor >= 100 ? 'kevlar' : 'none',
      hasDefuseKit: this.hasDefuseKit,
      hasNightVision: this.hasNightVision,
      utilities: utils,
    };
  }

  public devPracticeMoney(): void {
    this.cash = ECONOMY.maxCash;
    this.armor = 100;
    this.hasHelmet = true;
    this.hasDefuseKit = true;
    this.hasNightVision = true;
    this.practiceInfiniteUtility = true;
    this.ownedUtilities = {
      'smoke-grenade': 1,
      'flashbang': 2,
      'he-grenade': 1,
      'molotov': 1,
    };
  }
}
