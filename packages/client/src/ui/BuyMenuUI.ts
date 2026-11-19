import * as THREE from 'three';
import { EconomyManager } from '../match/EconomyManager.js';
import { InventoryManager, SlotNumber } from '../combat/InventoryManager.js';
import { ProceduralAudio } from '../audio/ProceduralAudio.js';
import { HUDManager } from './HUDManager.js';
import { WEAPONS } from '@garam/shared';

export interface BuyMenuUICallbacks {
  onTogglePointerLock: (lock: boolean) => void;
  onWeaponEquipped: (slot: SlotNumber) => void;
}

export class BuyMenuUI {
  private economy: EconomyManager;
  private inventory: InventoryManager;
  private audio: ProceduralAudio;
  private hud: HUDManager;
  private callbacks: BuyMenuUICallbacks;
  public isOpen = false;

  constructor(
    economy: EconomyManager,
    inventory: InventoryManager,
    audio: ProceduralAudio,
    hud: HUDManager,
    callbacks: BuyMenuUICallbacks
  ) {
    this.economy = economy;
    this.inventory = inventory;
    this.audio = audio;
    this.hud = hud;
    this.callbacks = callbacks;

    this.bindEvents();
  }

  public toggle(forceState?: boolean, phase = 'ROUND_LIVE', phaseTimer = 0, playerPos?: THREE.Vector3): void {
    const buyMenu = document.getElementById('buy-menu');
    if (!buyMenu) return;

    this.isOpen = forceState !== undefined ? forceState : buyMenu.style.display !== 'block';

    if (this.isOpen) {
      const check = playerPos
        ? this.economy.canBuy(phase as any, phaseTimer, playerPos)
        : { canBuy: true };

      const statusEl = document.getElementById('buy-zone-status');
      if (statusEl) {
        statusEl.innerText = check.canBuy ? 'BUY ZONE ACTIVE' : (check.reason || 'CANNOT BUY');
        statusEl.style.color = check.canBuy ? '#00ff88' : '#ff4444';
      }

      buyMenu.style.display = 'block';
      this.callbacks.onTogglePointerLock(false);
    } else {
      buyMenu.style.display = 'none';
      this.callbacks.onTogglePointerLock(true);
    }
  }

  public handleBuyByKey(key: number, phase = 'ROUND_LIVE', phaseTimer = 0, playerPos?: THREE.Vector3): void {
    const keyMap: Record<number, string> = {
      1: 'garam-47',
      2: 'vanguard-m4',
      3: 'sovereign-awp',
      4: 'desert-eagle',
      5: 'kevlar',
      6: 'kevlar-helmet',
      7: 'defuse-kit',
      8: 'smoke-grenade',
    };
    const item = keyMap[key];
    if (item) {
      this.executePurchase(item, phase, phaseTimer, playerPos);
    }
  }

  public executePurchase(item: string, phase = 'ROUND_LIVE', phaseTimer = 0, playerPos?: THREE.Vector3): void {
    if (playerPos) {
      const check = this.economy.canBuy(phase as any, phaseTimer, playerPos);
      if (!check.canBuy) {
        this.triggerRejectionCue(check.reason || 'OUTSIDE BUY ZONE');
        return;
      }
    }

    if (item === 'kevlar') {
      if (this.economy.armor >= 100) {
        this.triggerRejectionCue('ARMOR ALREADY FULL');
        return;
      }
      if (this.economy.spendCash(650)) {
        this.economy.armor = 100;
        this.hud.addKillfeed('Purchased Kevlar Vest ($650)');
        this.audio.playReload();
      } else {
        this.triggerRejectionCue('INSUFFICIENT FUNDS');
      }
      return;
    }

    if (item === 'kevlar-helmet') {
      if (this.economy.armor >= 100 && this.economy.hasHelmet) {
        this.triggerRejectionCue('HELMET ALREADY EQUIPPED');
        return;
      }
      if (this.economy.spendCash(1000)) {
        this.economy.armor = 100;
        this.economy.hasHelmet = true;
        this.hud.addKillfeed('Purchased Kevlar + Tactical Helmet ($1,000)');
        this.audio.playReload();
      } else {
        this.triggerRejectionCue('INSUFFICIENT FUNDS');
      }
      return;
    }

    if (item === 'defuse-kit') {
      if (this.economy.hasDefuseKit) {
        this.triggerRejectionCue('KIT ALREADY EQUIPPED');
        return;
      }
      if (this.economy.spendCash(400)) {
        this.economy.hasDefuseKit = true;
        this.hud.addKillfeed('Purchased Fast Defusal Kit ($400)');
        this.audio.playReload();
      } else {
        this.triggerRejectionCue('INSUFFICIENT FUNDS');
      }
      return;
    }

    if (item === 'smoke-grenade') {
      if (this.economy.spendCash(300)) {
        this.inventory.slots[4] = {
          weaponId: 'smoke-grenade',
          currentAmmo: 1,
          reserveAmmo: 0,
        };
        this.hud.addKillfeed('Purchased Tactical Smoke Grenade ($300)');
        this.audio.playReload();
      } else {
        this.triggerRejectionCue('INSUFFICIENT FUNDS');
      }
      return;
    }

    // Firearms
    if (WEAPONS[item]) {
      const def = WEAPONS[item];
      if (this.economy.spendCash(def.price)) {
        const slot = def.slot;
        this.inventory.slots[slot] = {
          weaponId: def.id,
          currentAmmo: def.magCapacity,
          reserveAmmo: def.reserveAmmo,
        };
        this.inventory.equipSlot(slot, true);
        this.callbacks.onWeaponEquipped(slot);
        this.hud.addKillfeed(`Requisitioned ${def.name} ($${def.price})`);
        this.audio.playReload();
      } else {
        this.triggerRejectionCue('INSUFFICIENT FUNDS');
      }
    }
  }

  private triggerRejectionCue(reason: string): void {
    this.audio.playBuyRejection();
    const statusEl = document.getElementById('buy-zone-status');
    if (statusEl) {
      statusEl.innerText = `REJECTED: ${reason.toUpperCase()}`;
      statusEl.style.color = '#ff3344';
      statusEl.style.transform = 'scale(1.05)';
      setTimeout(() => {
        if (statusEl) {
          statusEl.style.transform = 'scale(1.0)';
        }
      }, 200);
    }
    const cashEl = document.getElementById('hud-cash');
    if (cashEl) {
      cashEl.style.color = '#ff2233';
      setTimeout(() => {
        if (cashEl) cashEl.style.color = '';
      }, 350);
    }
  }

  private bindEvents(): void {
    const buyCloseBtn = document.getElementById('buy-close-btn');
    if (buyCloseBtn) {
      buyCloseBtn.addEventListener('click', () => this.toggle(false));
    }

    const practiceBtn = document.getElementById('practice-btn');
    if (practiceBtn) {
      practiceBtn.addEventListener('click', () => {
        this.economy.devPracticeMoney();
        this.hud.addKillfeed('🛠️ Practice Mode: $16,000 Cash Granted');
      });
    }

    const buyCards = document.querySelectorAll('.buy-card');
    buyCards.forEach((card) => {
      card.addEventListener('click', () => {
        const item = card.getAttribute('data-buy');
        if (item) {
          this.executePurchase(item);
        }
      });
    });
  }
}
