import * as THREE from 'three';
import { WEAPONS, SPAWN_POINTS, KinematicPlayerController } from '@garam/shared';
import { settingsStore } from '../core/SettingsStore.js';
import { InventoryManager } from './InventoryManager.js';
import { DroppedWeaponManager } from './DroppedWeaponManager.js';
import { UtilityManager, UtilityType, ThrowMode } from '../utility/UtilityManager.js';
import { ProceduralAudio } from '../audio/ProceduralAudio.js';
import { HUDManager } from '../ui/HUDManager.js';
import { CombatReportManager } from '../ui/CombatReportManager.js';
import { SpectatorManager } from '../match/SpectatorManager.js';
import { EconomyManager } from '../match/EconomyManager.js';
import { BotEntity } from '../maps/DeCitadelMap.js';

export interface PlayerManagerCallbacks {
  onSyncActiveWeapon: () => void;
}

export class PlayerManager {
  public playerHealth = 100;
  public kills = 0;
  public deaths = 0;

  private player: KinematicPlayerController;
  private inventory: InventoryManager;
  private economy: EconomyManager;
  private droppedWeapons: DroppedWeaponManager;
  private utilityManager: UtilityManager;
  private audio: ProceduralAudio;
  private hud: HUDManager;
  private combatReport: CombatReportManager;
  private spectator: SpectatorManager;
  private callbacks: PlayerManagerCallbacks;

  private _forward = new THREE.Vector3();

  constructor(
    player: KinematicPlayerController,
    inventory: InventoryManager,
    economy: EconomyManager,
    droppedWeapons: DroppedWeaponManager,
    utilityManager: UtilityManager,
    audio: ProceduralAudio,
    hud: HUDManager,
    combatReport: CombatReportManager,
    spectator: SpectatorManager,
    callbacks: PlayerManagerCallbacks
  ) {
    this.player = player;
    this.inventory = inventory;
    this.economy = economy;
    this.droppedWeapons = droppedWeapons;
    this.utilityManager = utilityManager;
    this.audio = audio;
    this.hud = hud;
    this.combatReport = combatReport;
    this.spectator = spectator;
    this.callbacks = callbacks;
  }

  public reset(spawnPos: { x: number; y: number; z: number }): void {
    this.player.state.x = spawnPos.x;
    this.player.state.y = spawnPos.y;
    this.player.state.z = spawnPos.z;
    this.player.state.vx = 0;
    this.player.state.vy = 0;
    this.player.state.vz = 0;
    this.playerHealth = 100;
    this.economy.armor = 100;
  }

  public damagePlayer(dmg: number, attackerPos: THREE.Vector3 | null, cameraPos: THREE.Vector3, inputYaw: number, bots: BotEntity[]): void {
    this.player.applyTagging(0.58);

    if (attackerPos) {
      const angle = Math.atan2(attackerPos.x - cameraPos.x, attackerPos.z - cameraPos.z) + inputYaw;
      this.hud.triggerDamageIndicator(angle);
    }

    if (this.economy.armor > 0) {
      this.economy.armor = Math.max(0, this.economy.armor - Math.round(dmg * 0.5));
      this.playerHealth = Math.max(0, this.playerHealth - Math.round(dmg * 0.5));
    } else {
      this.playerHealth = Math.max(0, this.playerHealth - dmg);
    }

    if (this.playerHealth <= 0) {
      this.deaths++;
      this.hud.addKillfeed('💀 Eldar Garamov was eliminated');
      this.combatReport.show();

      const livingAllies = bots.filter((b) => b.team === 'Vanguard' && !b.isDead);
      if (livingAllies.length > 0) {
        this.spectator.startDeathCam(attackerPos);
      } else {
        const spawn = settingsStore.settings.faction === 'Syndicate' ? SPAWN_POINTS.OBSIDIAN_T : SPAWN_POINTS.VANGUARD_CT;
        this.player.state.x = spawn.x;
        this.player.state.z = spawn.z;
        this.playerHealth = 100;
        this.economy.armor = 100;
      }
    }
  }

  public handleDropActiveWeapon(worldCamera: THREE.Camera): void {
    const slot = this.inventory.activeSlot;
    if (slot !== 1 && slot !== 2) return;

    const state = this.inventory.slots[slot];
    if (!state) return;

    worldCamera.getWorldDirection(this._forward);
    this.droppedWeapons.dropWeapon(
      state.weaponId,
      state.currentAmmo,
      state.reserveAmmo,
      worldCamera.position.clone().addScaledVector(this._forward, 0.8),
      this._forward
    );

    this.inventory.slots[slot] = null;
    this.inventory.equipSlot(3);
    this.callbacks.onSyncActiveWeapon();
    this.audio.playReload();
    this.hud.addKillfeed(`Dropped ${WEAPONS[state.weaponId]?.name || 'Weapon'}`);
  }

  public equipDroppedWeapon(dropped: { weaponId: string; currentAmmo: number; reserveAmmo: number }): boolean {
    const def = WEAPONS[dropped.weaponId];
    if (!def) return false;

    const slot = def.slot;
    this.inventory.slots[slot] = {
      weaponId: def.id,
      currentAmmo: dropped.currentAmmo,
      reserveAmmo: dropped.reserveAmmo,
    };
    this.inventory.equipSlot(slot, true);
    this.callbacks.onSyncActiveWeapon();
    this.audio.playWeaponPickup();
    this.hud.addKillfeed(`Looted ${def.name}`);
    return true;
  }

  public throwUtilityGrenade(mode: ThrowMode, worldCamera: THREE.Camera): void {
    const active = this.inventory.getActiveWeapon();
    const type = active.id as UtilityType;
    worldCamera.getWorldDirection(this._forward);
    const spawnPos = worldCamera.position.clone().addScaledVector(this._forward, 0.4);
    const playerVel = new THREE.Vector3(this.player.state.vx, this.player.state.vy, this.player.state.vz);

    this.utilityManager.throwGrenade(type, spawnPos, this._forward, playerVel, mode);
    this.inventory.slots[4] = null;
    this.inventory.equipSlot(3);
    this.callbacks.onSyncActiveWeapon();
  }

  public handleQuickUtility(type: 'smoke' | 'flash' | 'he' | 'molotov'): void {
    const utilityMap: Record<string, string> = {
      smoke: 'smoke-grenade',
      flash: 'flashbang',
      he: 'he-grenade',
      molotov: 'molotov',
    };
    this.inventory.slots[4] = { weaponId: utilityMap[type], currentAmmo: 1, reserveAmmo: 0 };
    this.inventory.equipSlot(4);
    this.callbacks.onSyncActiveWeapon();
  }

  public respawnAllBots(bots: BotEntity[]): void {
    for (const bot of bots) {
      bot.isDead = false;
      bot.health = bot.maxHealth;
      bot.armor = 100;
      if (bot.patrolWaypoints.length > 0) {
        bot.waypointIndex = 0;
        bot.patrolTarget = bot.patrolWaypoints[0];
        bot.mesh.position.set(bot.patrolTarget.x, 0, bot.patrolTarget.z);
      }
    }
  }

  public handlePlayerKill(killerName: string, victimBot: BotEntity, headshot: boolean, weaponName: string, reward: number, bots: BotEntity[]): void {
    this.kills++;
    this.economy.addCash(reward);
    victimBot.isDead = true;
    this.droppedWeapons.dropWeapon('garam-47', 30, 90, victimBot.mesh.position, new THREE.Vector3(0, 0, 1));
    const text = CombatReportManager.formatKillfeedEntry(killerName, victimBot.name, weaponName, headshot);
    this.hud.addKillfeed(text);
    this.hud.updateScoreboard(this.kills, this.deaths, this.economy.cash, bots);
  }

  public handleBotDamagedByBot(
    shooter: BotEntity,
    victim: BotEntity,
    dmg: number,
    isHeadshot: boolean,
    penetrated: number,
    blocks: any[],
    cameraPos: THREE.Vector3,
    bots: BotEntity[]
  ): void {
    this.audio.playGunshot('garam-47', shooter.mesh.position, cameraPos, blocks);
    if (victim.armor > 0) {
      victim.armor = Math.max(0, victim.armor - Math.round(dmg * 0.5));
      victim.health = Math.max(0, victim.health - Math.round(dmg * 0.5));
    } else {
      victim.health = Math.max(0, victim.health - dmg);
    }
    if (victim.health <= 0 && !victim.isDead) {
      victim.isDead = true;
      shooter.kills++;
      victim.deaths++;
      this.droppedWeapons.dropWeapon('garam-47', 30, 90, victim.mesh.position, new THREE.Vector3(0, 0, 1));
      const killfeedText = CombatReportManager.formatKillfeedEntry(shooter.name, victim.name, 'Garam-47', isHeadshot, penetrated > 0);
      this.hud.addKillfeed(killfeedText);
      this.hud.updateScoreboard(this.kills, this.deaths, this.economy.cash, bots);
    }
  }
}
