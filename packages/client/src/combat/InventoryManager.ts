import { WEAPONS, WeaponDef } from '@garam/shared';

export interface WeaponSlotState {
  weaponId: string;
  currentAmmo: number;
  reserveAmmo: number;
}

export type SlotNumber = 1 | 2 | 3 | 4 | 5;

export class InventoryManager {
  // Slots: 1: Primary, 2: Secondary, 3: Melee, 4: Utility, 5: Bomb
  public slots: Record<SlotNumber, WeaponSlotState | null> = {
    1: { weaponId: 'garam-47', currentAmmo: 30, reserveAmmo: 90 },
    2: { weaponId: 'desert-eagle', currentAmmo: 7, reserveAmmo: 35 },
    3: { weaponId: 'garam-karambit', currentAmmo: 1, reserveAmmo: 0 },
    4: null,
    5: null,
  };

  public activeSlot: SlotNumber = 1;
  public previousSlot: SlotNumber = 2;

  // Timers
  public isReloading = false;
  public reloadRemaining = 0;
  public reloadDuration = 0;

  public boltCycleRemaining = 0;
  public isSemiTriggerReleased = true;

  constructor() {
    // Default loadout: Garam-47, Desert Eagle, Karambit
  }

  public getActiveWeapon(): WeaponDef {
    const slotState = this.slots[this.activeSlot];
    if (slotState && WEAPONS[slotState.weaponId]) {
      return WEAPONS[slotState.weaponId];
    }
    // Fallback to knife
    return WEAPONS['garam-karambit'];
  }

  public getActiveSlotState(): WeaponSlotState {
    let slotState = this.slots[this.activeSlot];
    if (!slotState) {
      this.activeSlot = 3;
      slotState = this.slots[3]!;
    }
    return slotState;
  }

  public equipSlot(slot: SlotNumber): boolean {
    if (slot === this.activeSlot || !this.slots[slot]) return false;

    this.previousSlot = this.activeSlot;
    this.activeSlot = slot;
    this.cancelReload();
    this.boltCycleRemaining = 0;
    this.isSemiTriggerReleased = true;
    return true;
  }

  public quickSwitch(): boolean {
    if (this.slots[this.previousSlot]) {
      return this.equipSlot(this.previousSlot);
    }
    // Fallback to secondary or melee
    if (this.activeSlot === 1 && this.slots[2]) return this.equipSlot(2);
    if (this.slots[1]) return this.equipSlot(1);
    return false;
  }

  public cycleNext(): void {
    const order: SlotNumber[] = [1, 2, 3, 4, 5];
    const currentIndex = order.indexOf(this.activeSlot);
    for (let i = 1; i < order.length; i++) {
      const nextSlot = order[(currentIndex + i) % order.length];
      if (this.slots[nextSlot]) {
        this.equipSlot(nextSlot);
        break;
      }
    }
  }

  public cyclePrev(): void {
    const order: SlotNumber[] = [1, 2, 3, 4, 5];
    const currentIndex = order.indexOf(this.activeSlot);
    for (let i = 1; i < order.length; i++) {
      const prevSlot = order[(currentIndex - i + order.length) % order.length];
      if (this.slots[prevSlot]) {
        this.equipSlot(prevSlot);
        break;
      }
    }
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

    // Semi-auto click requirement
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
      this.boltCycleRemaining = 1.15; // 1.15s AWP bolt cycle
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
    this.isReloading = false;
    this.reloadRemaining = 0;
    this.reloadDuration = 0;
  }

  public update(dt: number): { reloadCompleted: boolean } {
    let reloadCompleted = false;

    // Bolt cycle tick
    if (this.boltCycleRemaining > 0) {
      this.boltCycleRemaining = Math.max(0, this.boltCycleRemaining - dt);
    }

    // Reload tick
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
}
