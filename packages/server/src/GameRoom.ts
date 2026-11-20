import { WebSocket } from 'ws';
import {
  DE_CITADEL_BLOCKS,
  SPAWN_POINTS,
  BOMBSITES,
  WEAPONS,
  ECONOMY,
  KINEMATICS,
  KinematicPlayerController,
  PlayerInput,
  AABBCollider,
  executeTacticalRaycast,
  hasLineOfSight,
  computeSpreadRayDirection,
  Ray,
  SmokeOccluder,
  SpatialGrid,
  BinaryCodec,
  ClientPacket,
  ServerPacket,
  NetOperatorState,
  NetRosterEntry,
  NetBombState,
  validateClientPacket,
  BotBrain,
  MatchSimulation,
  RoundEndResult,
} from '@garam/shared';
import { LagCompensation, SnapshotTarget } from './LagCompensation.js';

interface QueuedInput {
  seq: number;
  input: PlayerInput;
  weaponId: string;
}

interface WeaponAmmoState {
  current: number;
  reserve: number;
}

interface ServerSmokeVolume extends SmokeOccluder {
  id: string;
  expiresAt: number;
}

interface HumanSession {
  id: string;
  entitySlot: number;
  ws: WebSocket;
  name: string;
  team: 'Vanguard' | 'Syndicate';
  controller: KinematicPlayerController;
  lastInputSeq: number;
  lastShotTime: number;
  health: number;
  armor: number;
  hasHelmet: boolean;
  hasDefuseKit: boolean;
  cash: number;
  activeWeaponId: string;
  ownedWeapons: Set<string>;
  weaponAmmo: Map<string, WeaponAmmoState>;
  ownedUtilities: Map<string, number>;
  currentAmmo: number;
  reserveAmmo: number;
  isScoped: boolean;
  isReloading: boolean;
  reloadCompleteAt: number;
  isDead: boolean;
  kills: number;
  deaths: number;
  ping: number;
  pendingPingNonce: number;
  pendingPingSentAt: number;
  lastPingSentAt: number;
  plantDefuseAction: 'none' | 'plant' | 'defuse';
  inputQueue: QueuedInput[];
  framesProcessedThisSecond: number;
  currentSecondBucket: number;
  useBinary: boolean;
  recentlyVisibleEnemies: Map<string, number>;
}

interface ServerBot {
  id: string;
  entitySlot: number;
  name: string;
  team: 'Vanguard' | 'Syndicate';
  controller: KinematicPlayerController;
  health: number;
  armor: number;
  hasHelmet: boolean;
  isDead: boolean;
  kills: number;
  deaths: number;
  waypointIndex: number;
  waypoints: Array<{ x: number; y: number; z: number }>;
}

// Pre-allocated, frozen static map AABBs (zero per-input / per-tick allocations)
const STATIC_COLLIDERS: readonly AABBCollider[] = Object.freeze(
  DE_CITADEL_BLOCKS.map((b) =>
    Object.freeze({
      minX: b.minX,
      maxX: b.maxX,
      minY: b.minY,
      maxY: b.maxY,
      minZ: b.minZ,
      maxZ: b.maxZ,
    })
  )
);

const MELEE_MAX_RANGE = 2.4;
const MAX_BACKPRESSURE_BYTES = 65536;
const SNAPSHOT_BACKPRESSURE_BYTES = 32768;

const UTILITY_PRICES: Record<string, number> = {
  'smoke-grenade': ECONOMY.prices.smokeGrenade,
  'flashbang': 200,
  'he-grenade': 300,
  'molotov': 400,
};

export class GameRoom {
  private sessions = new Map<string, HumanSession>();
  private bots: ServerBot[] = [];
  private lagComp = new LagCompensation();
  private activeSmokes: ServerSmokeVolume[] = [];

  // 64-Tick Authoritative Loop
  private tick = 0;
  private readonly TICK_RATE = 64;
  private readonly TICK_DT = 1 / 64;
  private isRunning = false;
  private loopTimeoutHandle: NodeJS.Timeout | null = null;
  private pingNonceCounter = 1;

  // Single Source of Truth: Unified MatchSimulation
  public matchSim = new MatchSimulation();

  // Mirrored public getters/state for external inspection & snapshots
  public get round(): number {
    return this.matchSim.round;
  }
  public get phase(): 'FREEZE_TIME' | 'ROUND_LIVE' | 'ROUND_END' {
    return this.matchSim.phase === 'MATCH_OVER' ? 'ROUND_END' : this.matchSim.phase;
  }
  public set phase(value: 'FREEZE_TIME' | 'ROUND_LIVE' | 'ROUND_END') {
    this.matchSim.phase = value;
  }
  public get phaseTimer(): number {
    return this.matchSim.phaseTimer;
  }
  public set phaseTimer(value: number) {
    this.matchSim.phaseTimer = value;
  }
  public get ctScore(): number {
    return this.matchSim.ctScore;
  }
  public get tScore(): number {
    return this.matchSim.tScore;
  }
  public get ctLossStreak(): number {
    return this.matchSim.ctLossStreak;
  }
  public get tLossStreak(): number {
    return this.matchSim.tLossStreak;
  }

  public get bomb(): NetBombState {
    return {
      isPlanted: this.matchSim.isBombPlanted,
      site: this.matchSim.bombSite,
      x: this.matchSim.bombPos?.x ?? 0,
      y: this.matchSim.bombPos?.y ?? 0,
      z: this.matchSim.bombPos?.z ?? 0,
      plantProgress: this.matchSim.plantProgress,
      defuseProgress: this.matchSim.defuseProgress,
      timeRemaining: this.matchSim.bombTimer,
    };
  }

  private spatialGrid = new SpatialGrid(DE_CITADEL_BLOCKS, 10);

  constructor() {
    this.initDefaultBots();
    this.startLoop();
  }

  private initDefaultBots(): void {
    const vanguardNames = ['Steel', 'Hawk', 'Aegis', 'Sentinel', 'Atlas'];
    const syndicateNames = ['Razor', 'Ghost', 'Viper', 'Titan', 'Nomad'];

    for (let i = 0; i < 5; i++) {
      const vCtrl = new KinematicPlayerController(
        SPAWN_POINTS.VANGUARD_CT.x + (i - 2) * 2,
        0,
        SPAWN_POINTS.VANGUARD_CT.z
      );
      this.bots.push({
        id: `bot_ct_${i}`,
        entitySlot: i,
        name: `Vanguard ${vanguardNames[i]}`,
        team: 'Vanguard',
        controller: vCtrl,
        health: 100,
        armor: 100,
        hasHelmet: true,
        isDead: false,
        kills: 0,
        deaths: 0,
        waypointIndex: 0,
        waypoints: [
          { x: -32, y: 0, z: -30 },
          { x: 0, y: 0, z: 0 },
          { x: 35, y: 0, z: -32 },
        ],
      });

      const sCtrl = new KinematicPlayerController(
        SPAWN_POINTS.OBSIDIAN_T.x + (i - 2) * 2,
        0,
        SPAWN_POINTS.OBSIDIAN_T.z
      );
      this.bots.push({
        id: `bot_t_${i}`,
        entitySlot: 5 + i,
        name: `Syndicate ${syndicateNames[i]}`,
        team: 'Syndicate',
        controller: sCtrl,
        health: 100,
        armor: 100,
        hasHelmet: true,
        isDead: false,
        kills: 0,
        deaths: 0,
        waypointIndex: 0,
        waypoints: [
          { x: 0, y: 0, z: 0 },
          { x: -32, y: 0, z: -30 },
          { x: 35, y: 0, z: -32 },
        ],
      });
    }
  }

  private allocateEntitySlot(): number {
    const used = new Set<number>();
    for (const b of this.bots) used.add(b.entitySlot);
    this.sessions.forEach((s) => used.add(s.entitySlot));
    for (let slot = 10; slot < 255; slot++) {
      if (!used.has(slot)) return slot;
    }
    return 15;
  }

  private buildRosterEntries(): NetRosterEntry[] {
    const entries: NetRosterEntry[] = [];
    for (const b of this.bots) {
      entries.push({ slot: b.entitySlot, id: b.id, name: b.name, team: b.team });
    }
    this.sessions.forEach((s) => {
      entries.push({ slot: s.entitySlot, id: s.id, name: s.name, team: s.team });
    });
    return entries;
  }

  private broadcastRoster(): void {
    this.broadcast({
      type: 'roster_sync',
      entries: this.buildRosterEntries(),
    });
  }

  public getPlayerCount(): number {
    return this.sessions.size;
  }

  public handleConnection(
    ws: WebSocket,
    rateLimitCheck?: () => boolean,
    onJoined?: () => void
  ): void {
    const sessionId = `player_${Math.random().toString(36).substring(2, 9)}`;

    ws.on('message', (data) => {
      if (rateLimitCheck && !rateLimitCheck()) {
        return;
      }

      // Fast-path 22-byte zero-allocation binary user input decoding
      if (Buffer.isBuffer(data) && data.length === 22 && data[0] === 0x47 && data[1] === 0x02) {
        const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const decodedInput = BinaryCodec.decodeInput(ab);
        if (decodedInput) {
          const session = this.sessions.get(sessionId);
          if (session) {
            session.useBinary = true;
            if (session.inputQueue.length < 16) {
              session.inputQueue.push({
                seq: decodedInput.seq,
                input: decodedInput.input,
                weaponId: decodedInput.weaponId,
              });
            }
          }
          return;
        }
      }

      try {
        const raw = JSON.parse(data.toString());
        const packet = validateClientPacket(raw);
        if (!packet) {
          return;
        }
        if (packet.type === 'join' && !this.sessions.has(sessionId) && onJoined) {
          onJoined();
        }
        this.processClientPacket(sessionId, packet, ws);
      } catch {
        // Discard malformed packet
      }
    });

    ws.on('close', () => {
      this.handleDisconnection(sessionId);
    });
  }

  private handleDisconnection(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) {
      this.sessions.delete(sessionId);
      this.broadcastRoster();
    }
  }

  private createDefaultAmmoMap(): Map<string, WeaponAmmoState> {
    const map = new Map<string, WeaponAmmoState>();
    for (const [id, def] of Object.entries(WEAPONS)) {
      map.set(id, { current: def.magCapacity, reserve: def.reserveAmmo });
    }
    return map;
  }

  private syncSessionActiveAmmo(session: HumanSession): void {
    const ammo = session.weaponAmmo.get(session.activeWeaponId);
    if (ammo) {
      session.currentAmmo = ammo.current;
      session.reserveAmmo = ammo.reserve;
    }
  }

  private isInBuyWindowAndZone(session: HumanSession): boolean {
    const phaseOk =
      this.matchSim.phase === 'FREEZE_TIME' ||
      (this.matchSim.phase === 'ROUND_LIVE' &&
        this.matchSim.phaseTimer >= this.matchSim.roundLiveDuration - ECONOMY.buyWindowSec);
    if (!phaseOk) return false;
    const spawn = session.team === 'Syndicate' ? SPAWN_POINTS.OBSIDIAN_T : SPAWN_POINTS.VANGUARD_CT;
    const dx = session.controller.state.x - spawn.x;
    const dz = session.controller.state.z - spawn.z;
    return dx * dx + dz * dz <= 16 * 16;
  }

  private processClientPacket(sessionId: string, packet: ClientPacket, ws: WebSocket): void {
    const now = Date.now();

    if (packet.type === 'join') {
      if (this.sessions.has(sessionId)) return;
      const team = packet.faction || 'Vanguard';
      const spawn = team === 'Syndicate' ? SPAWN_POINTS.OBSIDIAN_T : SPAWN_POINTS.VANGUARD_CT;
      const controller = new KinematicPlayerController(spawn.x, spawn.y, spawn.z);
      const entitySlot = this.allocateEntitySlot();
      const startingWeapon = team === 'Vanguard' ? 'garam-47' : 'garam-47';
      const weaponAmmo = this.createDefaultAmmoMap();
      const startAmmo = weaponAmmo.get(startingWeapon)!;

      const session: HumanSession = {
        id: sessionId,
        entitySlot,
        ws,
        name: packet.callsign || 'Operator',
        team,
        controller,
        lastInputSeq: 0,
        lastShotTime: 0,
        health: 100,
        armor: 100,
        hasHelmet: true,
        hasDefuseKit: team === 'Vanguard',
        cash: ECONOMY.startingCash,
        activeWeaponId: startingWeapon,
        ownedWeapons: new Set(['garam-47', 'desert-eagle', 'garam-karambit']),
        weaponAmmo,
        ownedUtilities: new Map([
          ['smoke-grenade', 1],
          ['flashbang', 1],
          ['he-grenade', 1],
          ['molotov', 1],
        ]),
        currentAmmo: startAmmo.current,
        reserveAmmo: startAmmo.reserve,
        isScoped: false,
        isReloading: false,
        reloadCompleteAt: 0,
        isDead: false,
        kills: 0,
        deaths: 0,
        ping: 15,
        pendingPingNonce: 0,
        pendingPingSentAt: 0,
        lastPingSentAt: now,
        plantDefuseAction: 'none',
        inputQueue: [],
        framesProcessedThisSecond: 0,
        currentSecondBucket: Math.floor(now / 1000),
        useBinary: false,
        recentlyVisibleEnemies: new Map(),
      };

      this.sessions.set(sessionId, session);

      this.sendToSession(sessionId, {
        type: 'welcome',
        playerId: sessionId,
        entitySlot,
        team,
        tickRate: this.TICK_RATE,
        cash: session.cash,
      });

      this.sendEconomySync(session);
      this.broadcastRoster();
      this.issuePingChallenge(session, now);
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (packet.type === 'ping') {
      // Echo client timestamp for clock synchronization only — NEVER mutate session.ping from untrusted client timestamps!
      this.sendToSession(sessionId, {
        type: 'pong',
        clientTimestamp: packet.timestamp,
        serverTimestamp: now,
      });
      return;
    }

    if (packet.type === 'pong_challenge') {
      if (session.pendingPingNonce > 0 && packet.nonce === session.pendingPingNonce) {
        const rtt = Math.max(2, now - session.pendingPingSentAt);
        session.ping = Math.max(1, Math.min(250, Math.round(rtt / 2)));
        session.pendingPingNonce = 0;
      }
      return;
    }

    if (packet.type === 'input') {
      if (session.inputQueue.length < 16) {
        session.inputQueue.push({
          seq: packet.seq,
          input: packet.input,
          weaponId: packet.weaponId,
        });
      }
      return;
    }

    if (packet.type === 'buy') {
      this.handleBuy(session, packet.item);
      return;
    }

    if (packet.type === 'reload') {
      this.handleReload(session, now);
      return;
    }

    if (packet.type === 'utility_throw') {
      this.handleUtilityThrow(session, packet, now);
      return;
    }

    if (packet.type === 'plant_defuse') {
      this.handlePlantDefuse(session, packet.action);
      return;
    }

    if (packet.type === 'fire') {
      this.handleFire(session, packet, now);
    }
  }

  private issuePingChallenge(session: HumanSession, now: number): void {
    const nonce = this.pingNonceCounter++;
    session.pendingPingNonce = nonce;
    session.pendingPingSentAt = now;
    session.lastPingSentAt = now;
    this.sendToSession(session.id, { type: 'ping_challenge', nonce });
  }

  private sendEconomySync(session: HumanSession): void {
    this.sendToSession(session.id, {
      type: 'economy_sync',
      cash: session.cash,
      ownedWeapons: Array.from(session.ownedWeapons),
      armor: session.armor,
      hasHelmet: session.hasHelmet,
      hasDefuseKit: session.hasDefuseKit,
    });
  }

  private handleBuy(session: HumanSession, item: string): void {
    if (session.isDead || !this.isInBuyWindowAndZone(session)) return;

    if (item === 'kevlar') {
      if (session.armor >= 100 || session.cash < ECONOMY.prices.kevlar) return;
      session.cash -= ECONOMY.prices.kevlar;
      session.armor = 100;
      this.sendEconomySync(session);
      return;
    }

    if (item === 'kevlar_helmet' || item === 'helmet') {
      const cost = session.armor >= 100 ? ECONOMY.prices.helmet : ECONOMY.prices.kevlarHelmetCombo;
      if ((session.armor >= 100 && session.hasHelmet) || session.cash < cost) return;
      session.cash -= cost;
      session.armor = 100;
      session.hasHelmet = true;
      this.sendEconomySync(session);
      return;
    }

    if (item === 'defuse_kit') {
      if (session.team !== 'Vanguard' || session.hasDefuseKit || session.cash < ECONOMY.prices.defuseKit) return;
      session.cash -= ECONOMY.prices.defuseKit;
      session.hasDefuseKit = true;
      this.sendEconomySync(session);
      return;
    }

    if (item in UTILITY_PRICES) {
      const price = UTILITY_PRICES[item];
      const currentCount = session.ownedUtilities.get(item) ?? 0;
      const cap = item === 'flashbang' ? 2 : 1;
      if (currentCount >= cap || session.cash < price) return;
      session.cash -= price;
      session.ownedUtilities.set(item, currentCount + 1);
      this.sendEconomySync(session);
      return;
    }

    const weapon = WEAPONS[item];
    if (!weapon || weapon.price <= 0 || session.cash < weapon.price) return;
    session.cash -= weapon.price;
    session.ownedWeapons.add(weapon.id);
    session.weaponAmmo.set(weapon.id, { current: weapon.magCapacity, reserve: weapon.reserveAmmo });
    session.activeWeaponId = weapon.id;
    session.isReloading = false;
    this.syncSessionActiveAmmo(session);
    this.sendEconomySync(session);
  }

  private handleReload(session: HumanSession, now: number): void {
    if (session.isDead || session.isReloading) return;
    const weapon = WEAPONS[session.activeWeaponId];
    if (!weapon || weapon.category === 'melee') return;
    const ammo = session.weaponAmmo.get(weapon.id);
    if (!ammo || ammo.current >= weapon.magCapacity || ammo.reserve <= 0) return;
    session.isReloading = true;
    session.reloadCompleteAt = now + Math.round(weapon.reloadTime * 1000);
  }

  private handleUtilityThrow(
    session: HumanSession,
    packet: Extract<ClientPacket, { type: 'utility_throw' }>,
    now: number
  ): void {
    if (session.isDead || this.matchSim.phase !== 'ROUND_LIVE') return;
    const count = session.ownedUtilities.get(packet.utilityType) ?? 0;
    if (count <= 0) return;
    session.ownedUtilities.set(packet.utilityType, count - 1);

    // Clamp throw origin to authoritative player eye position (prevent remote teleport throws)
    const eyeHeight = session.controller.state.isCrouching
      ? KINEMATICS.EYE_HEIGHT_CROUCH
      : KINEMATICS.EYE_HEIGHT_STAND;
    const origin = {
      x: session.controller.state.x,
      y: session.controller.state.y + eyeHeight,
      z: session.controller.state.z,
    };

    const dirLen = Math.hypot(packet.direction.x, packet.direction.y, packet.direction.z);
    if (dirLen < 1e-4) return;
    const direction = {
      x: packet.direction.x / dirLen,
      y: packet.direction.y / dirLen,
      z: packet.direction.z / dirLen,
    };

    const speed = packet.mode === 'long' ? 18 : packet.mode === 'medium' ? 11 : 5;
    const velocity = {
      x: direction.x * speed,
      y: direction.y * speed + 2.5,
      z: direction.z * speed,
    };

    const utilId = `util_${now}_${Math.random().toString(36).slice(2, 6)}`;

    // Track server-side smoke occluder volumes for PVS + LOS occlusion
    if (packet.utilityType === 'smoke-grenade') {
      const landDist = Math.min(24, speed * 0.9);
      this.activeSmokes.push({
        id: utilId,
        center: {
          x: origin.x + direction.x * landDist,
          y: Math.max(0.5, session.controller.state.y + 1.4),
          z: origin.z + direction.z * landDist,
        },
        radius: 4.2,
        expiresAt: now + 18000,
      });
    }

    this.broadcast({
      type: 'utility_event',
      id: utilId,
      utilityType: packet.utilityType,
      origin,
      direction,
      velocity,
    });
  }

  private handlePlantDefuse(session: HumanSession, action: 'plant' | 'defuse' | 'cancel'): void {
    if (session.isDead || this.matchSim.phase !== 'ROUND_LIVE') {
      session.plantDefuseAction = 'none';
      return;
    }
    if (action === 'cancel') {
      session.plantDefuseAction = 'none';
      this.matchSim.plantProgress = 0;
      this.matchSim.defuseProgress = 0;
      return;
    }
    if (action === 'plant' && session.team === 'Syndicate' && !this.matchSim.isBombPlanted) {
      session.plantDefuseAction = 'plant';
    } else if (action === 'defuse' && session.team === 'Vanguard' && this.matchSim.isBombPlanted) {
      session.plantDefuseAction = 'defuse';
    }
  }

  private getBombSiteAt(x: number, z: number): 'A' | 'B' | null {
    const dA = Math.hypot(x - BOMBSITES.A.center.x, z - BOMBSITES.A.center.z);
    if (dA <= BOMBSITES.A.radius) return 'A';
    const dB = Math.hypot(x - BOMBSITES.B.center.x, z - BOMBSITES.B.center.z);
    if (dB <= BOMBSITES.B.radius) return 'B';
    return null;
  }

  private handleFire(
    session: HumanSession,
    packet: Extract<ClientPacket, { type: 'fire' }>,
    now: number
  ): void {
    if (session.isDead || this.matchSim.phase !== 'ROUND_LIVE') return;

    // Weapon ownership validation (prevents firing unowned AWP on round 1)
    if (!session.ownedWeapons.has(packet.weaponId)) {
      return;
    }

    const weapon = WEAPONS[packet.weaponId];
    if (!weapon) return;
    session.activeWeaponId = weapon.id;
    this.syncSessionActiveAmmo(session);

    // Silent-Aim Angle Guard: reject FireAction if yaw OR pitch diverges by > 15° (0.26 rad)
    const yawDelta = Math.abs(
      Math.atan2(
        Math.sin(packet.yaw - session.controller.state.yaw),
        Math.cos(packet.yaw - session.controller.state.yaw)
      )
    );
    const pitchDelta = Math.abs(packet.pitch - session.controller.state.pitch);
    if (yawDelta > 0.26 || pitchDelta > 0.26) {
      return;
    }

    if (session.isReloading) return;

    session.isScoped = !!packet.isScoped;
    const fireIntervalMs = (60 / weapon.fireRateRpm) * 1000;
    if (now - session.lastShotTime < fireIntervalMs * 0.9) return;

    const ammo = session.weaponAmmo.get(weapon.id);
    if (weapon.category !== 'melee') {
      if (!ammo || ammo.current <= 0) return;
      ammo.current--;
      session.currentAmmo = ammo.current;
    }

    session.lastShotTime = now;

    // Dynamically bounded lag-compensated hitbox rewind with server-measured ping
    const rewoundTargets = this.lagComp.getRewoundTargets(now, packet.targetServerTime, session.ping);

    const eyeHeight = session.controller.state.isCrouching
      ? KINEMATICS.EYE_HEIGHT_CROUCH
      : KINEMATICS.EYE_HEIGHT_STAND;
    const origin = {
      x: session.controller.state.x,
      y: session.controller.state.y + eyeHeight,
      z: session.controller.state.z,
    };

    // Direction computed strictly server-side from validated (yaw, pitch) — untrusted packet.direction ignored!
    const direction = computeSpreadRayDirection(packet.yaw, packet.pitch, 0, 0);
    const ray: Ray = { origin, direction };

    const baseDmg = packet.isSecondaryMelee && weapon.id === 'garam-karambit' ? 90 : weapon.damage;
    const maxDistance = weapon.category === 'melee' ? MELEE_MAX_RANGE : 250;

    const hits = executeTacticalRaycast(
      ray,
      baseDmg,
      weapon.armorPenetration,
      weapon.penetrationPower,
      maxDistance,
      DE_CITADEL_BLOCKS,
      rewoundTargets,
      weapon.damageDropoffPer10m,
      this.spatialGrid,
      weapon.headDamageMultiplier
    );

    for (const hit of hits) {
      if (!hit.targetId) continue;

      const victimHuman = this.sessions.get(hit.targetId);
      const victimBot = this.bots.find((b) => b.id === hit.targetId);

      if (victimHuman && !victimHuman.isDead && victimHuman.team !== session.team) {
        victimHuman.health = Math.max(0, victimHuman.health - hit.awardedDamage);
        victimHuman.armor = Math.max(0, victimHuman.armor - hit.armorDamage);
        victimHuman.controller.applyTagging(weapon.taggingPower);

        this.sendToSession(session.id, {
          type: 'hit_confirm',
          targetId: victimHuman.id,
          damage: hit.awardedDamage,
          isHeadshot: !!hit.isHeadshot,
          victimHealth: victimHuman.health,
        });

        if (victimHuman.health <= 0) {
          victimHuman.isDead = true;
          victimHuman.plantDefuseAction = 'none';
          victimHuman.deaths++;
          session.kills++;
          session.cash = Math.min(ECONOMY.maxCash, session.cash + weapon.killReward);
          this.sendEconomySync(session);
          this.broadcast({
            type: 'kill_event',
            killerId: session.id,
            killerName: session.name,
            victimId: victimHuman.id,
            victimName: victimHuman.name,
            weaponName: weapon.name,
            headshot: !!hit.isHeadshot,
            reward: weapon.killReward,
          });
          this.checkTeamElimination();
        }
        break;
      } else if (victimBot && !victimBot.isDead && victimBot.team !== session.team) {
        victimBot.health = Math.max(0, victimBot.health - hit.awardedDamage);
        victimBot.armor = Math.max(0, victimBot.armor - hit.armorDamage);
        victimBot.controller.applyTagging(weapon.taggingPower);

        this.sendToSession(session.id, {
          type: 'hit_confirm',
          targetId: victimBot.id,
          damage: hit.awardedDamage,
          isHeadshot: !!hit.isHeadshot,
          victimHealth: victimBot.health,
        });

        if (victimBot.health <= 0) {
          victimBot.isDead = true;
          victimBot.deaths++;
          session.kills++;
          session.cash = Math.min(ECONOMY.maxCash, session.cash + weapon.killReward);
          this.sendEconomySync(session);
          this.broadcast({
            type: 'kill_event',
            killerId: session.id,
            killerName: session.name,
            victimId: victimBot.id,
            victimName: victimBot.name,
            weaponName: weapon.name,
            headshot: !!hit.isHeadshot,
            reward: weapon.killReward,
          });
          this.checkTeamElimination();
        }
        break;
      }
    }
  }

  private checkTeamElimination(): void {
    if (this.matchSim.phase !== 'ROUND_LIVE') return;

    let vanguardAlive = 0;
    let syndicateAlive = 0;

    this.sessions.forEach((s) => {
      if (!s.isDead) {
        if (s.team === 'Vanguard') vanguardAlive++;
        else syndicateAlive++;
      }
    });
    for (const b of this.bots) {
      if (!b.isDead) {
        if (b.team === 'Vanguard') vanguardAlive++;
        else syndicateAlive++;
      }
    }

    if (vanguardAlive === 0) {
      const res = this.matchSim.endRound('Syndicate', 'Vanguard Team Eliminated');
      this.applyRoundEnd(res);
    } else if (syndicateAlive === 0 && !this.matchSim.isBombPlanted) {
      const res = this.matchSim.endRound('Vanguard', 'Syndicate Team Eliminated');
      this.applyRoundEnd(res);
    }
  }

  public stop(): void {
    this.isRunning = false;
    if (this.loopTimeoutHandle) {
      clearTimeout(this.loopTimeoutHandle);
      this.loopTimeoutHandle = null;
    }
  }

  private startLoop(): void {
    this.isRunning = true;
    const tickIntervalNs = BigInt(Math.round(1e9 / this.TICK_RATE));
    let nextTickNs = process.hrtime.bigint();

    const tickStep = () => {
      if (!this.isRunning) return;

      const nowNs = process.hrtime.bigint();
      if (nowNs >= nextTickNs) {
        this.tickAuthoritative();
        nextTickNs += tickIntervalNs;

        if (nowNs - nextTickNs > tickIntervalNs * 2n) {
          nextTickNs = nowNs + tickIntervalNs;
        }
      }

      const diffNs = nextTickNs - process.hrtime.bigint();
      const delayMs = diffNs > 1_000_000n ? Math.max(0, Number(diffNs / 1_000_000n)) : 0;
      this.loopTimeoutHandle = setTimeout(tickStep, delayMs);
    };

    tickStep();
  }

  private tickAuthoritative(): void {
    this.tick++;
    const now = Date.now();

    // Prune expired smoke volumes
    if (this.activeSmokes.length > 0) {
      this.activeSmokes = this.activeSmokes.filter((sm) => sm.expiresAt > now);
    }

    // 0. Drain queued inputs, handle reloads, ping challenges, and plant/defuse timers
    const secondBucket = Math.floor(now / 1000);
    const freezeMovement = this.matchSim.phase === 'FREEZE_TIME';

    this.sessions.forEach((s) => {
      if (s.currentSecondBucket !== secondBucket) {
        s.currentSecondBucket = secondBucket;
        s.framesProcessedThisSecond = 0;
      }

      // Periodic server-initiated RTT challenge every 2,000ms
      if (now - s.lastPingSentAt >= 2000) {
        this.issuePingChallenge(s, now);
      }

      // Finish pending reload
      if (s.isReloading && now >= s.reloadCompleteAt) {
        const weapon = WEAPONS[s.activeWeaponId];
        const ammo = weapon ? s.weaponAmmo.get(weapon.id) : undefined;
        if (weapon && ammo) {
          const needed = weapon.magCapacity - ammo.current;
          const transfer = Math.min(needed, ammo.reserve);
          ammo.current += transfer;
          ammo.reserve -= transfer;
          s.currentAmmo = ammo.current;
          s.reserveAmmo = ammo.reserve;
        }
        s.isReloading = false;
      }

      let drained = 0;
      while (s.inputQueue.length > 0 && drained < 4) {
        if (s.framesProcessedThisSecond >= 132) {
          s.inputQueue.shift();
          drained++;
          continue;
        }

        const frame = s.inputQueue.shift()!;
        s.lastInputSeq = frame.seq;

        if (s.ownedWeapons.has(frame.weaponId)) {
          if (s.activeWeaponId !== frame.weaponId) {
            s.activeWeaponId = frame.weaponId;
            s.isReloading = false;
            this.syncSessionActiveAmmo(s);
          }
        }

        const weapon = WEAPONS[s.activeWeaponId] || WEAPONS['garam-47'];
        const effectiveInput: PlayerInput = freezeMovement
          ? {
              forward: false,
              backward: false,
              left: false,
              right: false,
              jump: false,
              crouch: frame.input.crouch,
              walk: false,
              yaw: frame.input.yaw,
              pitch: frame.input.pitch,
            }
          : frame.input;

        s.controller.update(
          effectiveInput,
          KINEMATICS.FIXED_DT,
          weapon.movementSpeed,
          STATIC_COLLIDERS as AABBCollider[]
        );

        s.framesProcessedThisSecond++;
        drained++;
      }

      // Plant / Defuse progress
      if (!s.isDead && this.matchSim.phase === 'ROUND_LIVE') {
        if (s.plantDefuseAction === 'plant' && !this.matchSim.isBombPlanted) {
          const site = this.getBombSiteAt(s.controller.state.x, s.controller.state.z);
          if (site) {
            this.matchSim.plantProgress = Math.min(
              1.0,
              this.matchSim.plantProgress + this.TICK_DT / ECONOMY.plantTimeSec
            );
            if (this.matchSim.plantProgress >= 1.0) {
              this.matchSim.armBomb(site, {
                x: s.controller.state.x,
                y: s.controller.state.y,
                z: s.controller.state.z,
              });
              s.plantDefuseAction = 'none';
            }
          } else {
            s.plantDefuseAction = 'none';
            this.matchSim.plantProgress = 0;
          }
        } else if (s.plantDefuseAction === 'defuse' && this.matchSim.isBombPlanted && this.matchSim.bombPos) {
          const dist = Math.hypot(
            s.controller.state.x - this.matchSim.bombPos.x,
            s.controller.state.z - this.matchSim.bombPos.z
          );
          if (dist <= 3.0) {
            const def = this.matchSim.stepDefuse(this.TICK_DT, s.hasDefuseKit);
            if (def.defused) {
              s.plantDefuseAction = 'none';
              s.cash = Math.min(ECONOMY.maxCash, s.cash + ECONOMY.defuseBonus);
              const res = this.matchSim.endRound('Vanguard', 'Pulse Core Defused');
              this.applyRoundEnd(res);
            }
          } else {
            s.plantDefuseAction = 'none';
            this.matchSim.defuseProgress = 0;
          }
        }
      }
    });

    // 1. Update Unified MatchSimulation
    const prevPhase = this.matchSim.phase;
    const prevRound = this.matchSim.round;
    const roundResult = this.matchSim.update(this.TICK_DT);
    if (roundResult) {
      this.applyRoundEnd(roundResult);
    } else if (prevPhase === 'ROUND_END' && this.matchSim.phase === 'FREEZE_TIME' && this.matchSim.round > prevRound) {
      this.resetRound();
    }

    // 2. Snapshot target hitboxes (including crouched state & yaw) for lag compensation
    const snapshotTargets: SnapshotTarget[] = [];
    this.sessions.forEach((s) => {
      if (!s.isDead) {
        snapshotTargets.push({
          id: s.id,
          name: s.name,
          team: s.team,
          x: s.controller.state.x,
          y: s.controller.state.y,
          z: s.controller.state.z,
          armor: s.armor,
          hasHelmet: s.hasHelmet,
          isDead: s.isDead,
          isCrouched: s.controller.state.isCrouching,
          yaw: s.controller.state.yaw,
        });
      }
    });
    for (const b of this.bots) {
      if (!b.isDead) {
        snapshotTargets.push({
          id: b.id,
          name: b.name,
          team: b.team,
          x: b.controller.state.x,
          y: b.controller.state.y,
          z: b.controller.state.z,
          armor: b.armor,
          hasHelmet: b.hasHelmet,
          isDead: b.isDead,
          isCrouched: b.controller.state.isCrouching,
          yaw: b.controller.state.yaw,
        });
      }
    }

    this.lagComp.recordSnapshot(this.tick, now, snapshotTargets);

    // 3. Assemble authoritative 64-tick state snapshot
    const playerStates: NetOperatorState[] = [];
    this.sessions.forEach((s) => {
      playerStates.push({
        id: s.id,
        entitySlot: s.entitySlot,
        name: s.name,
        team: s.team,
        x: s.controller.state.x,
        y: s.controller.state.y,
        z: s.controller.state.z,
        vx: s.controller.state.vx,
        vy: s.controller.state.vy,
        vz: s.controller.state.vz,
        yaw: s.controller.state.yaw,
        pitch: s.controller.state.pitch,
        health: s.health,
        armor: s.armor,
        hasHelmet: s.hasHelmet,
        hasDefuseKit: s.hasDefuseKit,
        activeWeapon: s.activeWeaponId,
        currentAmmo: s.currentAmmo,
        reserveAmmo: s.reserveAmmo,
        isScoped: s.isScoped,
        isReloading: s.isReloading,
        isCrouching: s.controller.state.isCrouching,
        isDead: s.isDead,
        ping: s.ping,
        kills: s.kills,
        deaths: s.deaths,
      });
    });

    for (const b of this.bots) {
      playerStates.push({
        id: b.id,
        entitySlot: b.entitySlot,
        name: b.name,
        team: b.team,
        x: b.controller.state.x,
        y: b.controller.state.y,
        z: b.controller.state.z,
        vx: b.controller.state.vx,
        vy: b.controller.state.vy,
        vz: b.controller.state.vz,
        yaw: b.controller.state.yaw,
        pitch: 0,
        health: b.health,
        armor: b.armor,
        hasHelmet: b.hasHelmet,
        hasDefuseKit: false,
        activeWeapon: 'garam-47',
        currentAmmo: 30,
        reserveAmmo: 90,
        isScoped: false,
        isReloading: false,
        isCrouching: b.controller.state.isCrouching,
        isDead: b.isDead,
        ping: 0,
        kills: b.kills,
        deaths: b.deaths,
      });
    }

    const currentBomb = this.bomb;

    // Broadcast snapshots with PVS Fog-of-War + Smoke Occlusion filtering
    this.sessions.forEach((s) => {
      if (!s.ws || s.ws.readyState !== WebSocket.OPEN) return;
      if ((s.ws.bufferedAmount ?? 0) > SNAPSHOT_BACKPRESSURE_BYTES) return;

      const visiblePlayers = this.filterPlayersForSession(s, playerStates);

      if (s.useBinary) {
        const ab = BinaryCodec.encodeSnapshot({
          tick: this.tick,
          serverTimestamp: now,
          lastAckSeq: s.lastInputSeq,
          roundPhase: this.phase,
          roundTime: Math.ceil(this.phaseTimer),
          ctScore: this.ctScore,
          tScore: this.tScore,
          bomb: currentBomb,
          players: visiblePlayers,
        });
        s.ws.send(Buffer.from(ab));
      } else {
        const snapPacket: ServerPacket = {
          type: 'snapshot',
          tick: this.tick,
          serverTimestamp: now,
          lastAckSeq: s.lastInputSeq,
          players: visiblePlayers,
          bomb: currentBomb,
          roundPhase: this.phase,
          roundTime: Math.ceil(this.phaseTimer),
          ctScore: this.ctScore,
          tScore: this.tScore,
        };
        s.ws.send(JSON.stringify(snapPacket));
      }
    });
  }

  private applyRoundEnd(result: RoundEndResult): void {
    this.sessions.forEach((s) => {
      const payout = s.team === 'Vanguard' ? result.ctPayout : result.tPayout;
      s.cash = Math.min(ECONOMY.maxCash, s.cash + payout);
      s.plantDefuseAction = 'none';
      this.sendEconomySync(s);
    });

    this.broadcast({
      type: 'round_event',
      phase: result.isMatchComplete ? 'MATCH_OVER' : 'ROUND_END',
      round: this.matchSim.round,
      winner: result.winner,
      reason: result.reason,
      ctScore: result.ctScore,
      tScore: result.tScore,
    });
  }

  /**
   * PVS (Potentially Visible Set) Anti-Wallhack Filter with live smoke occlusion.
   */
  private filterPlayersForSession(session: HumanSession, allPlayers: NetOperatorState[]): NetOperatorState[] {
    const sPos = session.controller.state;
    const eyeA = { x: sPos.x, y: sPos.y + (sPos.isCrouching ? 1.10 : 1.65), z: sPos.z };
    const now = Date.now();

    return allPlayers.filter((p) => {
      if (p.id === session.id || p.team === session.team) return true;
      if (p.isDead) return true;

      // Close-proximity audio radius (26m)
      const dx = p.x - sPos.x;
      const dy = p.y - sPos.y;
      const dz = p.z - sPos.z;
      if (dx * dx + dy * dy + dz * dz <= 676) {
        session.recentlyVisibleEnemies.set(p.id, now);
        return true;
      }

      // 350ms jiggle-peek hysteresis buffer
      const lastSeen = session.recentlyVisibleEnemies.get(p.id) || 0;
      if (now - lastSeen < 350) {
        return true;
      }

      // 4-point silhouette probe with live activeSmokes occlusion
      const cosYaw = Math.cos(p.yaw);
      const sinYaw = Math.sin(p.yaw);
      const headY = p.isCrouching ? 1.14 : 1.66;
      const shoulderY = p.isCrouching ? 0.85 : 1.35;
      const torsoY = p.isCrouching ? 0.60 : 1.10;

      const probePoints = [
        { x: p.x, y: p.y + headY, z: p.z },
        { x: p.x - 0.40 * cosYaw, y: p.y + shoulderY, z: p.z + 0.40 * sinYaw },
        { x: p.x + 0.40 * cosYaw, y: p.y + shoulderY, z: p.z - 0.40 * sinYaw },
        { x: p.x, y: p.y + torsoY, z: p.z },
      ];

      for (const pt of probePoints) {
        if (hasLineOfSight(eyeA, pt, DE_CITADEL_BLOCKS, this.activeSmokes, this.spatialGrid)) {
          session.recentlyVisibleEnemies.set(p.id, now);
          return true;
        }
      }

      return false;
    });
  }

  private resetRound(): void {
    this.activeSmokes = [];

    this.sessions.forEach((s) => {
      s.isDead = false;
      s.health = 100;
      s.isReloading = false;
      s.plantDefuseAction = 'none';
      const spawn = s.team === 'Syndicate' ? SPAWN_POINTS.OBSIDIAN_T : SPAWN_POINTS.VANGUARD_CT;
      s.controller.state.x = spawn.x;
      s.controller.state.y = spawn.y;
      s.controller.state.z = spawn.z;
      s.controller.state.vx = 0;
      s.controller.state.vy = 0;
      s.controller.state.vz = 0;
      // Refill ammo for owned weapons
      s.ownedWeapons.forEach((wId) => {
        const def = WEAPONS[wId];
        if (def) {
          s.weaponAmmo.set(wId, { current: def.magCapacity, reserve: def.reserveAmmo });
        }
      });
      this.syncSessionActiveAmmo(s);
    });

    const synBots = this.bots.filter((b) => b.team === 'Syndicate');
    const vgBots = this.bots.filter((b) => b.team === 'Vanguard');
    const synBuys = BotBrain.evaluateTeamEconomy(
      synBots.map(() => 4500),
      this.matchSim.tLossStreak,
      this.matchSim.round,
      false
    );
    const vgBuys = BotBrain.evaluateTeamEconomy(
      vgBots.map(() => 4500),
      this.matchSim.ctLossStreak,
      this.matchSim.round,
      true
    );

    let synIdx = 0;
    let vgIdx = 0;
    for (const b of this.bots) {
      b.isDead = false;
      b.health = 100;
      const isVg = b.team === 'Vanguard';
      const decision = isVg ? vgBuys[vgIdx++] : synBuys[synIdx++];
      if (decision) {
        b.armor = decision.buyArmor ? 100 : 0;
        b.hasHelmet = decision.buyHelmet;
      } else {
        b.armor = 100;
        b.hasHelmet = true;
      }
      const spawn = b.team === 'Syndicate' ? SPAWN_POINTS.OBSIDIAN_T : SPAWN_POINTS.VANGUARD_CT;
      b.controller.state.x = spawn.x;
      b.controller.state.y = spawn.y;
      b.controller.state.z = spawn.z;
      b.controller.state.vx = 0;
      b.controller.state.vy = 0;
      b.controller.state.vz = 0;
    }
  }

  private sendToSession(sessionId: string, packet: ServerPacket): void {
    const s = this.sessions.get(sessionId);
    if (s && s.ws && s.ws.readyState === WebSocket.OPEN && (s.ws.bufferedAmount ?? 0) <= MAX_BACKPRESSURE_BYTES) {
      s.ws.send(JSON.stringify(packet));
    }
  }

  private broadcast(packet: ServerPacket): void {
    const json = JSON.stringify(packet);
    this.sessions.forEach((s) => {
      if (s.ws && s.ws.readyState === WebSocket.OPEN && (s.ws.bufferedAmount ?? 0) <= MAX_BACKPRESSURE_BYTES) {
        s.ws.send(json);
      }
    });
  }
}
