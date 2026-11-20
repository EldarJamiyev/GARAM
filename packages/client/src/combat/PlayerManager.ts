import * as THREE from 'three';
import { WEAPONS, SPAWN_POINTS, KinematicPlayerController, MapBlockCollider } from '@garam/shared';
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
  onUtilityThrow?: (
    type: UtilityType,
    mode: ThrowMode,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    velocity: THREE.Vector3
  ) => void;
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
  private _spawnPos = new THREE.Vector3();
  private _playerVel = new THREE.Vector3();
  private _dropDir = new THREE.Vector3(0, 0, 1);

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

  /**
   * Apply damage to the local player.
   * When armorAlreadyApplied is true (e.g., from executeTacticalRaycast), dmg is already
   * post-armor awardedDamage and armorDamage is subtracted directly — preventing double-armor halving.
   */
  public damagePlayer(
    dmg: number,
    attackerPos: THREE.Vector3 | null,
    cameraPos: THREE.Vector3,
    inputYaw: number,
    bots: BotEntity[],
    armorAlreadyApplied = false,
    armorDamage = 0
  ): void {
    if (this.playerHealth <= 0) return;

    this.player.applyTagging(0.58);

    if (attackerPos) {
      const angle = Math.atan2(attackerPos.x - cameraPos.x, attackerPos.z - cameraPos.z) + inputYaw;
      this.hud.triggerDamageIndicator(angle);
    }

    if (armorAlreadyApplied) {
      this.economy.armor = Math.max(0, this.economy.armor - Math.round(armorDamage));
      this.playerHealth = Math.max(0, this.playerHealth - Math.round(dmg));
    } else if (this.economy.armor > 0) {
      const absorbed = Math.round(dmg * 0.35);
      this.economy.armor = Math.max(0, this.economy.armor - absorbed);
      this.playerHealth = Math.max(0, this.playerHealth - Math.max(1, Math.round(dmg - absorbed)));
    } else {
      this.playerHealth = Math.max(0, this.playerHealth - Math.round(dmg));
    }

    if (this.playerHealth <= 0) {
      this.deaths++;
      const callsign = settingsStore.settings.callsign || 'Operator';
      const playerTeam = settingsStore.settings.faction;
      this.hud.addKillfeed(`💀 ${callsign} was eliminated`);
      this.combatReport.show();

      const livingAllies = bots.filter((b) => b.team === playerTeam && !b.isDead);
      if (livingAllies.length > 0) {
        this.spectator.startDeathCam(attackerPos);
      }
      // Note: RoundManager checks living team count (including player) to end the round cleanly
    }
  }

  public handleDropActiveWeapon(worldCamera: THREE.Camera): void {
    const slot = this.inventory.activeSlot;
    if (slot !== 1 && slot !== 2) return;

    const state = this.inventory.slots[slot];
    if (!state) return;

    worldCamera.getWorldDirection(this._forward);
    this._spawnPos.copy(worldCamera.position).addScaledVector(this._forward, 0.8);
    this.droppedWeapons.dropWeapon(
      state.weaponId,
      state.currentAmmo,
      state.reserveAmmo,
      this._spawnPos,
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
    this._spawnPos.copy(worldCamera.position).addScaledVector(this._forward, 0.4);
    this._playerVel.set(this.player.state.vx, this.player.state.vy, this.player.state.vz);

    this.utilityManager.throwGrenade(type, this._spawnPos, this._forward, this._playerVel, mode);
    this.callbacks.onUtilityThrow?.(type, mode, this._spawnPos, this._forward, this._playerVel);
    if (!this.economy.practiceInfiniteUtility) {
      this.economy.consumeUtility(type);
    }
    this.inventory.slots[4] = null;
    this.inventory.equipSlot(1) || this.inventory.equipSlot(2) || this.inventory.equipSlot(3);
    this.callbacks.onSyncActiveWeapon();
  }

  public handleQuickUtility(type: 'smoke' | 'flash' | 'he' | 'molotov'): void {
    const utilityMap: Record<'smoke' | 'flash' | 'he' | 'molotov', UtilityType> = {
      smoke: 'smoke-grenade',
      flash: 'flashbang',
      he: 'he-grenade',
      molotov: 'molotov',
    };
    const utilId = utilityMap[type];
    if (!this.economy.practiceInfiniteUtility && !this.economy.hasUtility(utilId)) {
      this.hud.showCenterBanner('NO UTILITY OWNED', `Buy ${utilId.toUpperCase()} in Buy Menu [B]`, 1400);
      return;
    }
    this.inventory.slots[4] = { weaponId: utilId, currentAmmo: 1, reserveAmmo: 0 };
    this.inventory.equipSlot(4, true);
    this.callbacks.onSyncActiveWeapon();
  }

  public respawnAllBots(bots: BotEntity[]): void {
    for (const bot of bots) {
      bot.isDead = false;
      bot.health = bot.maxHealth;
      bot.armor = 100;
      bot.mesh.visible = true;
      if (bot.patrolWaypoints.length > 0) {
        bot.waypointIndex = 0;
        bot.patrolTarget = bot.patrolWaypoints[0];
        bot.mesh.position.set(bot.patrolTarget.x, 0, bot.patrolTarget.z);
      }
    }
  }

  public handlePlayerKill(
    killerName: string,
    victimBot: BotEntity,
    headshot: boolean,
    weaponName: string,
    reward: number,
    bots: BotEntity[]
  ): void {
    this.kills++;
    this.economy.addCash(reward);
    victimBot.isDead = true;
    this.droppedWeapons.dropWeapon('garam-47', 30, 90, victimBot.mesh.position, this._dropDir);
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
    blocks: MapBlockCollider[],
    cameraPos: THREE.Vector3,
    bots: BotEntity[],
    armorDamage = 0
  ): void {
    this.audio.playGunshot('garam-47', shooter.mesh.position, cameraPos, blocks);
    // dmg from BotAISystem is already post-armor awardedDamage from executeTacticalRaycast
    victim.armor = Math.max(0, victim.armor - Math.round(armorDamage));
    victim.health = Math.max(0, victim.health - Math.round(dmg));

    if (victim.health <= 0 && !victim.isDead) {
      victim.isDead = true;
      shooter.kills++;
      victim.deaths++;
      this.droppedWeapons.dropWeapon('garam-47', 30, 90, victim.mesh.position, this._dropDir);
      const killfeedText = CombatReportManager.formatKillfeedEntry(
        shooter.name,
        victim.name,
        'Garam-47',
        isHeadshot,
        penetrated > 0
      );
      this.hud.addKillfeed(killfeedText);
      this.hud.updateScoreboard(this.kills, this.deaths, this.economy.cash, bots);
    }
  }
}
