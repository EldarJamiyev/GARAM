import { WEAPONS, WeaponDef } from '@garam/shared';
import { settingsStore } from '../core/SettingsStore.js';

export interface WeaponSlotState {
  weaponId: string;
  currentAmmo: number;
  reserveAmmo: number;
}

export type SlotNumber = 1 | 2 | 3 | 4 | 5;

export class InventoryManager {
  // Slots:
  // 1: Primary (Rifle/Sniper)
  // 2: Secondary (Pistol)
  // 3: Melee (Karambit)
  // 4: Utility (Smoke Grenade)
  // 5: Bomb (Pulse Core)
  public slots: Record<SlotNumber, WeaponSlotState | null> = {
    1: { weaponId: 'garam-47', currentAmmo: 30, reserveAmmo: 90 },
    2: { weaponId: 'desert-eagle', currentAmmo: 7, reserveAmmo: 35 },
    3: { weaponId: 'garam-karambit', currentAmmo: 1, reserveAmmo: 0 },
    4: null, // Must be bought or picked up!
    5: null, // Assigned to Syndicate carrier
  };

  public activeSlot: SlotNumber = 1;
  public previousSlot: SlotNumber = 2;

  // Timers
  public isReloading = false;
  public reloadRemaining = 0;
  public reloadDuration = 0;

  public boltCycleRemaining = 0;
  public isSemiTriggerReleased = true;

  public onReloadCancelled?: () => void;

  constructor() {
    // Default loadout
  }

  public getActiveWeapon(): WeaponDef {
    const slotState = this.slots[this.activeSlot];
    const baseDef = (slotState && WEAPONS[slotState.weaponId])
      ? WEAPONS[slotState.weaponId]
      : WEAPONS['garam-karambit'];

    // In offline mode, overlay user sandbox overrides without mutating immutable WEAPONS singleton
    if (settingsStore.settings.gameMode === 'offline' && settingsStore.sandboxWeaponOverrides[baseDef.id]) {
      return { ...baseDef, ...settingsStore.sandboxWeaponOverrides[baseDef.id] };
    }
    return baseDef;
  }

  public getActiveSlotState(): WeaponSlotState {
    let slotState = this.slots[this.activeSlot];
    if (!slotState) {
      this.activeSlot = 3;
      slotState = this.slots[3]!;
    }
    return slotState;
  }

  public hasSlot(slot: SlotNumber): boolean {
    return this.slots[slot] !== null;
  }

  public equipSlot(slot: SlotNumber, force = false): boolean {
    if ((slot === this.activeSlot && !force) || !this.slots[slot]) return false;

    this.previousSlot = this.activeSlot;
    this.activeSlot = slot;
    this.cancelReload();
    this.boltCycleRemaining = 0;
    this.isSemiTriggerReleased = true;
    return true;
  }

  public quickSwitch(): boolean {
    if (this.slots[this.previousSlot] && this.previousSlot !== this.activeSlot) {
      return this.equipSlot(this.previousSlot);
    }
    if (this.activeSlot === 1 && this.slots[2]) return this.equipSlot(2);
    if (this.slots[1]) return this.equipSlot(1);
    if (this.slots[3]) return this.equipSlot(3);
    return false;
  }

  public cycleNext(): boolean {
    const order: SlotNumber[] = [1, 2, 3, 4, 5];
    const currentIndex = order.indexOf(this.activeSlot);
    for (let i = 1; i < order.length; i++) {
      const nextSlot = order[(currentIndex + i) % order.length];
      if (this.slots[nextSlot]) {
        return this.equipSlot(nextSlot);
      }
    }
    return false;
  }

  public cyclePrev(): boolean {
    const order: SlotNumber[] = [1, 2, 3, 4, 5];
    const currentIndex = order.indexOf(this.activeSlot);
    for (let i = 1; i < order.length; i++) {
      const prevSlot = order[(currentIndex - i + order.length) % order.length];
      if (this.slots[prevSlot]) {
        return this.equipSlot(prevSlot);
      }
    }
    return false;
  }

  public buyWeapon(weaponId: string): void {
    const def = WEAPONS[weaponId];
    if (!def) return;

    const slot = def.slot as SlotNumber;
    this.slots[slot] = {
      weaponId: def.id,
      currentAmmo: def.magCapacity,
      reserveAmmo: def.reserveAmmo,
    };
    this.equipSlot(slot);
  }

  public addUtility(utilityId: string): void {
    this.slots[4] = {
      weaponId: utilityId,
      currentAmmo: 1,
      reserveAmmo: 0,
    };
  }

  public consumeUtility(): boolean {
    if (this.slots[4]) {
      this.slots[4] = null;
      // Switch back to primary or secondary
      if (this.slots[1]) {
        this.equipSlot(1);
      } else if (this.slots[2]) {
        this.equipSlot(2);
      } else {
        this.equipSlot(3);
      }
      return true;
    }
    return false;
  }

  public setBombCarrier(isCarrier: boolean): void {
    if (isCarrier) {
      this.slots[5] = {
        weaponId: 'pulse-core',
        currentAmmo: 1,
        reserveAmmo: 0,
      };
    } else {
      this.slots[5] = null;
      if (this.activeSlot === 5) {
        this.equipSlot(1);
      }
    }
  }

  public canFire(now: number, isMouseDown: boolean): { canFire: boolean; reason?: string } {
    if (this.isReloading) {
      return { canFire: false, reason: 'reloading' };
    }

    if (this.boltCycleRemaining > 0) {
      return { canFire: false, reason: 'bolt_cycle' };
    }

    const weapon = this.getActiveWeapon();
    const state = this.getActiveSlotState();

    if (weapon.category !== 'melee' && state.currentAmmo <= 0) {
      return { canFire: false, reason: 'out_of_ammo' };
    }

    if (weapon.fireMode === 'semi' && !this.isSemiTriggerReleased) {
      return { canFire: false, reason: 'semi_held' };
    }

    return { canFire: true };
  }

  public onFireExecuted(now: number): void {
    const weapon = this.getActiveWeapon();
    const state = this.getActiveSlotState();

    if (weapon.category !== 'melee') {
      state.currentAmmo = Math.max(0, state.currentAmmo - 1);
    }

    if (weapon.fireMode === 'semi') {
      this.isSemiTriggerReleased = false;
    }

    if (weapon.fireMode === 'bolt') {
      this.boltCycleRemaining = 60 / weapon.fireRateRpm; // Driven authoritatively by weapon fireRateRpm
    }
  }

  public onMouseUp(): void {
    this.isSemiTriggerReleased = true;
  }

  public startReload(): boolean {
    const weapon = this.getActiveWeapon();
    const state = this.getActiveSlotState();

    if (weapon.category === 'melee') return false;
    if (this.isReloading) return false;
    if (state.currentAmmo >= weapon.magCapacity) return false;
    if (state.reserveAmmo <= 0) return false;

    this.isReloading = true;
    this.reloadDuration = weapon.reloadTime;
    this.reloadRemaining = weapon.reloadTime;
    return true;
  }

  public cancelReload(): void {
    if (this.isReloading) {
      this.isReloading = false;
      this.reloadRemaining = 0;
      this.reloadDuration = 0;
      if (this.onReloadCancelled) {
        this.onReloadCancelled();
      }
    }
  }

  public update(dt: number): { reloadCompleted: boolean } {
    let reloadCompleted = false;

    if (this.boltCycleRemaining > 0) {
      this.boltCycleRemaining = Math.max(0, this.boltCycleRemaining - dt);
    }

    if (this.isReloading) {
      this.reloadRemaining -= dt;
      if (this.reloadRemaining <= 0) {
        this.isReloading = false;
        const weapon = this.getActiveWeapon();
        const state = this.getActiveSlotState();
        const needed = weapon.magCapacity - state.currentAmmo;
        const transfer = Math.min(needed, state.reserveAmmo);
        state.currentAmmo += transfer;
        state.reserveAmmo -= transfer;
        reloadCompleted = true;
      }
    }

    return { reloadCompleted };
  }

  public resetToPistolRound(): void {
    this.slots[1] = null;
    this.slots[2] = { weaponId: 'desert-eagle', currentAmmo: 7, reserveAmmo: 35 };
    this.slots[3] = { weaponId: 'garam-karambit', currentAmmo: 1, reserveAmmo: 0 };
    this.slots[4] = null;
    this.slots[5] = null;
    this.equipSlot(2);
  }
}
