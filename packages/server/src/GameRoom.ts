import { randomBytes } from 'crypto';
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
  computeDeterministicShotDirection,
  stepGrenadePhysics,
  computeHEDamage,
  computeMolotovTickDamage,
  Ray,
  SmokeOccluder,
  SpatialGrid,
  BinaryCodec,
  BINARY_MAGIC,
  BINARY_TYPE_INPUT,
  BINARY_TYPE_INPUT_BATCH,
  ClientPacket,
  ServerPacket,
  NetOperatorState,
  NetRosterEntry,
  NetBombState,
  validateClientPacket,
  BotBrain,
  MatchSimulation,
  RoundEndResult,
  Vec3,
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

interface ServerMolotovZone {
  id: string;
  center: Vec3;
  radius: number;
  expiresAt: number;
  ownerId: string;
  ownerName: string;
  ownerTeam: 'Vanguard' | 'Syndicate';
}

interface ServerProjectile {
  id: string;
  utilityType: string;
  ownerId: string;
  ownerName: string;
  ownerTeam: 'Vanguard' | 'Syndicate';
  pos: Vec3;
  vel: Vec3;
  fuseRemaining: number;
  detonateOnGround: boolean;
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
  lastShotTimeByWeapon: Map<string, number>;
  deployCompleteAt: number;
  consecutiveShots: number;
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
  ping: number; // Full server-measured RTT in ms (used directly by LagCompensation)
  pendingPingNonce: number;
  pendingPingSentAt: number;
  lastPingSentAt: number;
  plantDefuseAction: 'none' | 'plant' | 'defuse';
  inputQueue: QueuedInput[];
  framesProcessedThisSecond: number;
  currentSecondBucket: number;
  useBinary: boolean;
  recentlyVisibleEnemies: Map<string, number>;
  stalledTicks: number;
  burnDamageAccum: number;
}

interface ServerBot {
  id: string;
  entitySlot: number;
  name: string;
  team: 'Vanguard' | 'Syndicate';
  active: boolean; // Deactivated when a human player takes over a 5v5 team slot
  controller: KinematicPlayerController;
  health: number;
  armor: number;
  hasHelmet: boolean;
  isDead: boolean;
  kills: number;
  deaths: number;
  waypointIndex: number;
  waypoints: Array<{ x: number; y: number; z: number }>;
  burnDamageAccum: number;
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
const MAX_STALLED_TICKS = 128; // ~2s consecutive backpressure stall disconnects slow consumer
const WEAPON_DEPLOY_MS = 180;

const UTILITY_PRICES: Record<string, number> = {
  'smoke-grenade': ECONOMY.prices.smokeGrenade,
  'flashbang': 200,
  'he-grenade': 300,
  'molotov': 400,
};

function generateSecureId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

export class GameRoom {
  private sessions = new Map<string, HumanSession>();
  private bots: ServerBot[] = [];
  private lagComp = new LagCompensation();
  private activeSmokes: ServerSmokeVolume[] = [];
  private activeProjectiles: ServerProjectile[] = [];
  private activeMolotovs: ServerMolotovZone[] = [];

  // Bomb Plant / Defuse Ownership Mutexes
  private activePlanterId: string | null = null;
  private activeDefuserId: string | null = null;

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
        active: true,
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
        burnDamageAccum: 0,
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
        active: true,
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
        burnDamageAccum: 0,
      });
    }
  }

  private rebalanceTeamBots(): void {
    for (const team of ['Vanguard', 'Syndicate'] as const) {
      let humanCount = 0;
      this.sessions.forEach((s) => {
        if (s.team === team) humanCount++;
      });
      const desiredBots = Math.max(0, 5 - humanCount);
      let enabled = 0;
      for (const b of this.bots) {
        if (b.team !== team) continue;
        if (enabled < desiredBots) {
          b.active = true;
          enabled++;
        } else {
          b.active = false;
        }
      }
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
      if (!b.active) continue;
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
    onJoined?: () => void,
    initialJoinPacket?: Extract<ClientPacket, { type: 'join' }>
  ): void {
    const sessionId = generateSecureId('player');

    if (initialJoinPacket) {
      this.processClientPacket(sessionId, initialJoinPacket, ws);
    }

    ws.on('message', (data) => {
      if (rateLimitCheck && !rateLimitCheck()) {
        return;
      }

      // Fast-path binary user input decoding (0x02 single frame OR 0x03 batched 64Hz frames)
      if (Buffer.isBuffer(data) && data.length >= 3 && data[0] === BINARY_MAGIC) {
        if (data[1] === BINARY_TYPE_INPUT && data.length === 22) {
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
        } else if (data[1] === BINARY_TYPE_INPUT_BATCH) {
          const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
          const decodedBatch = BinaryCodec.decodeInputBatch(ab);
          if (decodedBatch) {
            const session = this.sessions.get(sessionId);
            if (session) {
              session.useBinary = true;
              for (let i = 0; i < decodedBatch.length; i++) {
                if (session.inputQueue.length >= 16) break;
                const frame = decodedBatch[i];
                session.inputQueue.push({
                  seq: frame.seq,
                  input: frame.input,
                  weaponId: frame.weaponId,
                });
              }
            }
            return;
          }
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
      if (this.activePlanterId === sessionId) {
        this.activePlanterId = null;
        this.matchSim.plantProgress = 0;
      }
      if (this.activeDefuserId === sessionId) {
        this.activeDefuserId = null;
        this.matchSim.defuseProgress = 0;
      }
      this.sessions.delete(sessionId);
      // Prune departed player ID from all remaining PVS hysteresis maps
      this.sessions.forEach((other) => {
        other.recentlyVisibleEnemies.delete(sessionId);
      });
      this.rebalanceTeamBots();
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
      let teamIndex = 0;
      this.sessions.forEach((existing) => {
        if (existing.team === team) teamIndex++;
      });
      const spawnOffsetX = ((teamIndex % 5) - 2) * 2;
      const controller = new KinematicPlayerController(spawn.x + spawnOffsetX, spawn.y, spawn.z);
      const entitySlot = this.allocateEntitySlot();
      const startingWeapon = 'garam-47';
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
        lastShotTimeByWeapon: new Map(),
        deployCompleteAt: 0,
        consecutiveShots: 0,
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
        ping: 30, // Initial RTT estimate (ms) until pong_challenge calibrates
        pendingPingNonce: 0,
        pendingPingSentAt: 0,
        lastPingSentAt: now,
        plantDefuseAction: 'none',
        inputQueue: [],
        framesProcessedThisSecond: 0,
        currentSecondBucket: Math.floor(now / 1000),
        useBinary: false,
        recentlyVisibleEnemies: new Map(),
        stalledTicks: 0,
        burnDamageAccum: 0,
      };

      this.sessions.set(sessionId, session);
      this.rebalanceTeamBots();

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
        // Store full measured RTT (ms) so LagCompensation computes exact half-RTT (rtt * 0.5)
        const rtt = Math.max(2, now - session.pendingPingSentAt);
        session.ping = Math.max(2, Math.min(500, Math.round(rtt)));
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
    // Block duplicate purchase of already-owned weapon
    if (session.ownedWeapons.has(weapon.id)) return;

    // Enforce competitive 1-primary / 1-secondary slot replacement
    if (weapon.slot === 1 || weapon.slot === 2) {
      for (const existingId of Array.from(session.ownedWeapons)) {
        const existingDef = WEAPONS[existingId];
        if (existingDef && existingDef.slot === weapon.slot) {
          session.ownedWeapons.delete(existingId);
        }
      }
    }

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
    _now: number
  ): void {
    if (session.isDead || this.matchSim.phase !== 'ROUND_LIVE') return;
    const count = session.ownedUtilities.get(packet.utilityType) ?? 0;
    if (count <= 0) return;
    session.ownedUtilities.set(packet.utilityType, count - 1);

    // Clamp throw origin to authoritative player eye position (prevent remote teleport throws)
    const eyeHeight = session.controller.state.isCrouching
      ? KINEMATICS.EYE_HEIGHT_CROUCH
      : KINEMATICS.EYE_HEIGHT_STAND;
    const origin: Vec3 = {
      x: session.controller.state.x,
      y: session.controller.state.y + eyeHeight,
      z: session.controller.state.z,
    };

    const dirLen = Math.hypot(packet.direction.x, packet.direction.y, packet.direction.z);
    if (dirLen < 1e-4) return;
    const direction: Vec3 = {
      x: packet.direction.x / dirLen,
      y: packet.direction.y / dirLen,
      z: packet.direction.z / dirLen,
    };

    const speed = packet.mode === 'long' ? 18 : packet.mode === 'medium' ? 11 : 5;
    const velocity: Vec3 = {
      x: direction.x * speed,
      y: direction.y * speed + 2.5,
      z: direction.z * speed,
    };

    const utilId = generateSecureId('util');

    // Queue authoritative physics-simulated grenade projectile (bounces off DE_CITADEL_BLOCKS, never clips walls!)
    const fuseSec =
      packet.utilityType === 'smoke-grenade'
        ? 1.5
        : packet.utilityType === 'he-grenade'
          ? 1.6
          : packet.utilityType === 'molotov'
            ? 2.2
            : 1.4;

    this.activeProjectiles.push({
      id: utilId,
      utilityType: packet.utilityType,
      ownerId: session.id,
      ownerName: session.name,
      ownerTeam: session.team,
      pos: { ...origin },
      vel: { ...velocity },
      fuseRemaining: fuseSec,
      detonateOnGround: packet.utilityType === 'molotov',
    });

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
      this.releasePlantDefuseLock(session);
      return;
    }
    if (action === 'cancel') {
      // Only the owning planter or defuser may cancel progress (blocks cross-team cancel griefing)
      this.releasePlantDefuseLock(session);
      return;
    }
    if (action === 'plant' && session.team === 'Syndicate' && !this.matchSim.isBombPlanted) {
      if (this.activePlanterId && this.activePlanterId !== session.id) return;
      this.activePlanterId = session.id;
      session.plantDefuseAction = 'plant';
    } else if (action === 'defuse' && session.team === 'Vanguard' && this.matchSim.isBombPlanted) {
      if (this.activeDefuserId && this.activeDefuserId !== session.id) return;
      this.activeDefuserId = session.id;
      session.plantDefuseAction = 'defuse';
    }
  }

  private releasePlantDefuseLock(session: HumanSession): void {
    session.plantDefuseAction = 'none';
    if (this.activePlanterId === session.id) {
      this.activePlanterId = null;
      if (!this.matchSim.isBombPlanted) {
        this.matchSim.plantProgress = 0;
      }
    }
    if (this.activeDefuserId === session.id) {
      this.activeDefuserId = null;
      this.matchSim.defuseProgress = 0;
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

    // Enforce weapon-switch deploy delay if player switched weapons via fire packet
    if (session.activeWeaponId !== weapon.id) {
      session.activeWeaponId = weapon.id;
      session.isReloading = false;
      session.consecutiveShots = 0;
      session.deployCompleteAt = now + WEAPON_DEPLOY_MS;
      this.syncSessionActiveAmmo(session);
      return;
    }
    if (now < session.deployCompleteAt) return;
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
    const lastWeaponShot = session.lastShotTimeByWeapon.get(weapon.id) ?? 0;
    if (now - lastWeaponShot < fireIntervalMs * 0.9) return;

    // Decay consecutive spray shot counter based on weapon recovery time
    const recoveryMs = (session.controller.state.isCrouching ? weapon.recoveryTimeCrouch : weapon.recoveryTimeStand) * 1000;
    const elapsedSinceLastShot = now - lastWeaponShot;
    if (lastWeaponShot === 0 || elapsedSinceLastShot >= recoveryMs * 1.15) {
      session.consecutiveShots = 0;
    } else if (elapsedSinceLastShot > fireIntervalMs * 1.25) {
      const decaySteps = Math.floor((elapsedSinceLastShot - fireIntervalMs) / Math.max(40, recoveryMs * 0.25));
      session.consecutiveShots = Math.max(0, session.consecutiveShots - decaySteps);
    }

    const ammo = session.weaponAmmo.get(weapon.id);
    if (weapon.category !== 'melee') {
      if (!ammo || ammo.current <= 0) return;
      ammo.current--;
      session.currentAmmo = ammo.current;
    }

    session.lastShotTime = now;
    session.lastShotTimeByWeapon.set(weapon.id, now);

    // Dynamically bounded lag-compensated hitbox rewind using server-measured full RTT
    const rewoundTargets = this.lagComp.getRewoundTargets(now, packet.targetServerTime, session.ping);

    const eyeHeight = session.controller.state.isCrouching
      ? KINEMATICS.EYE_HEIGHT_CROUCH
      : KINEMATICS.EYE_HEIGHT_STAND;
    const origin = {
      x: session.controller.state.x,
      y: session.controller.state.y + eyeHeight,
      z: session.controller.state.z,
    };

    // Deterministic server-authoritative spread + spray pattern calculation (untrusted packet.direction ignored!)
    const speed = session.controller.getHorizontalSpeed();
    const shotSeed = ((this.tick * 2654435761) ^ (packet.seq * 40503) ^ (session.entitySlot * 97)) >>> 0;
    const { direction } = computeDeterministicShotDirection(
      packet.yaw,
      packet.pitch,
      weapon,
      speed,
      session.controller.state.isGrounded,
      session.controller.state.isCrouching,
      session.isScoped,
      session.consecutiveShots,
      shotSeed
    );
    session.consecutiveShots++;

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

    const allowCollateral = weapon.penetrationPower >= 250;

    for (const hit of hits) {
      if (!hit.targetId) continue;

      const victimHuman = this.sessions.get(hit.targetId);
      const victimBot = this.bots.find((b) => b.active && b.id === hit.targetId);

      if (victimHuman && !victimHuman.isDead && victimHuman.team !== session.team) {
        this.applyDamageToHuman(
          victimHuman,
          hit.awardedDamage,
          hit.armorDamage,
          weapon.taggingPower,
          session.id,
          session.name,
          weapon.name,
          weapon.killReward,
          !!hit.isHeadshot
        );
        if (!allowCollateral) break;
      } else if (victimBot && !victimBot.isDead && victimBot.team !== session.team) {
        this.applyDamageToBot(
          victimBot,
          hit.awardedDamage,
          hit.armorDamage,
          weapon.taggingPower,
          session.id,
          session.name,
          weapon.name,
          weapon.killReward,
          !!hit.isHeadshot
        );
        if (!allowCollateral) break;
      }
    }
  }

  private applyDamageToHuman(
    victim: HumanSession,
    healthDamage: number,
    armorDamage: number,
    taggingPower: number,
    attackerId: string,
    attackerName: string,
    weaponName: string,
    killReward: number,
    isHeadshot: boolean
  ): void {
    if (victim.isDead || healthDamage <= 0) return;
    victim.health = Math.max(0, victim.health - healthDamage);
    victim.armor = Math.max(0, victim.armor - armorDamage);
    if (taggingPower < 1.0) {
      victim.controller.applyTagging(taggingPower);
    }

    const attacker = this.sessions.get(attackerId);
    if (attacker) {
      this.sendToSession(attacker.id, {
        type: 'hit_confirm',
        targetId: victim.id,
        damage: healthDamage,
        isHeadshot,
        victimHealth: victim.health,
      });
    }

    if (victim.health <= 0) {
      victim.isDead = true;
      this.releasePlantDefuseLock(victim);
      victim.deaths++;
      if (attacker) {
        attacker.kills++;
        attacker.cash = Math.min(ECONOMY.maxCash, attacker.cash + killReward);
        this.sendEconomySync(attacker);
      }
      this.broadcast({
        type: 'kill_event',
        killerId: attackerId,
        killerName: attackerName,
        victimId: victim.id,
        victimName: victim.name,
        weaponName,
        headshot: isHeadshot,
        reward: killReward,
      });
      this.checkTeamElimination();
    }
  }

  private applyDamageToBot(
    victim: ServerBot,
    healthDamage: number,
    armorDamage: number,
    taggingPower: number,
    attackerId: string,
    attackerName: string,
    weaponName: string,
    killReward: number,
    isHeadshot: boolean
  ): void {
    if (!victim.active || victim.isDead || healthDamage <= 0) return;
    victim.health = Math.max(0, victim.health - healthDamage);
    victim.armor = Math.max(0, victim.armor - armorDamage);
    if (taggingPower < 1.0) {
      victim.controller.applyTagging(taggingPower);
    }

    const attacker = this.sessions.get(attackerId);
    if (attacker) {
      this.sendToSession(attacker.id, {
        type: 'hit_confirm',
        targetId: victim.id,
        damage: healthDamage,
        isHeadshot,
        victimHealth: victim.health,
      });
    }

    if (victim.health <= 0) {
      victim.isDead = true;
      victim.deaths++;
      if (attacker) {
        attacker.kills++;
        attacker.cash = Math.min(ECONOMY.maxCash, attacker.cash + killReward);
        this.sendEconomySync(attacker);
      }
      this.broadcast({
        type: 'kill_event',
        killerId: attackerId,
        killerName: attackerName,
        victimId: victim.id,
        victimName: victim.name,
        weaponName,
        headshot: isHeadshot,
        reward: killReward,
      });
      this.checkTeamElimination();
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
      if (b.active && !b.isDead) {
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

  private updateProjectilesAndZones(now: number): void {
    // 1. Step flying grenade projectiles against static DE_CITADEL_BLOCKS
    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const proj = this.activeProjectiles[i];
      const stepRes = stepGrenadePhysics(
        proj.pos,
        proj.vel,
        this.TICK_DT,
        DE_CITADEL_BLOCKS,
        0.08,
        0.45,
        15.5,
        this.spatialGrid
      );
      proj.fuseRemaining -= this.TICK_DT;

      const shouldDetonate = proj.fuseRemaining <= 0 || (proj.detonateOnGround && stepRes.hitGround);
      if (!shouldDetonate) continue;

      this.activeProjectiles.splice(i, 1);

      if (proj.utilityType === 'smoke-grenade') {
        this.activeSmokes.push({
          id: proj.id,
          center: { x: proj.pos.x, y: Math.max(0.5, proj.pos.y + 1.2), z: proj.pos.z },
          radius: 4.2,
          expiresAt: now + 18000,
        });
      } else if (proj.utilityType === 'molotov') {
        this.activeMolotovs.push({
          id: proj.id,
          center: { x: proj.pos.x, y: proj.pos.y, z: proj.pos.z },
          radius: 3.2,
          expiresAt: now + 7000,
          ownerId: proj.ownerId,
          ownerName: proj.ownerName,
          ownerTeam: proj.ownerTeam,
        });
      } else if (proj.utilityType === 'he-grenade') {
        this.detonateHE(proj);
      }
    }

    // 2. Step active Molotov burn zones (40 DPS)
    for (let i = this.activeMolotovs.length - 1; i >= 0; i--) {
      const zone = this.activeMolotovs[i];
      if (zone.expiresAt <= now) {
        this.activeMolotovs.splice(i, 1);
        continue;
      }

      // Smoke extinguishes overlapping Molotov fire
      const extinguished = this.activeSmokes.some((sm) => {
        const d = Math.hypot(sm.center.x - zone.center.x, sm.center.z - zone.center.z);
        return d < sm.radius + zone.radius * 0.5;
      });
      if (extinguished) {
        this.activeMolotovs.splice(i, 1);
        continue;
      }

      this.sessions.forEach((s) => {
        if (s.isDead) return;
        const dmg = computeMolotovTickDamage(zone.center, zone.radius, s.controller.state, this.TICK_DT, s.armor);
        if (dmg.healthDamage > 0) {
          s.burnDamageAccum += dmg.healthDamage;
          if (s.burnDamageAccum >= 4) {
            const apply = Math.floor(s.burnDamageAccum);
            s.burnDamageAccum -= apply;
            this.applyDamageToHuman(
              s,
              apply,
              Math.round(dmg.armorDamage),
              1.0,
              zone.ownerId,
              zone.ownerName,
              'Incendiary Molotov',
              300,
              false
            );
          }
        }
      });

      for (const b of this.bots) {
        if (!b.active || b.isDead) continue;
        const dmg = computeMolotovTickDamage(zone.center, zone.radius, b.controller.state, this.TICK_DT, b.armor);
        if (dmg.healthDamage > 0) {
          b.burnDamageAccum += dmg.healthDamage;
          if (b.burnDamageAccum >= 4) {
            const apply = Math.floor(b.burnDamageAccum);
            b.burnDamageAccum -= apply;
            this.applyDamageToBot(
              b,
              apply,
              Math.round(dmg.armorDamage),
              1.0,
              zone.ownerId,
              zone.ownerName,
              'Incendiary Molotov',
              300,
              false
            );
          }
        }
      }
    }
  }

  private detonateHE(proj: ServerProjectile): void {
    this.sessions.forEach((s) => {
      if (s.isDead) return;
      const dmg = computeHEDamage(proj.pos, s.controller.state, s.armor, DE_CITADEL_BLOCKS, this.spatialGrid);
      if (dmg.healthDamage > 0) {
        this.applyDamageToHuman(
          s,
          dmg.healthDamage,
          dmg.armorDamage,
          0.75,
          proj.ownerId,
          proj.ownerName,
          'High Explosive Grenade',
          300,
          false
        );
      }
    });

    for (const b of this.bots) {
      if (!b.active || b.isDead) continue;
      const dmg = computeHEDamage(proj.pos, b.controller.state, b.armor, DE_CITADEL_BLOCKS, this.spatialGrid);
      if (dmg.healthDamage > 0) {
        this.applyDamageToBot(
          b,
          dmg.healthDamage,
          dmg.armorDamage,
          0.75,
          proj.ownerId,
          proj.ownerName,
          'High Explosive Grenade',
          300,
          false
        );
      }
    }
  }

  private updateServerBots(): void {
    if (this.matchSim.phase !== 'ROUND_LIVE') return;

    for (const b of this.bots) {
      if (!b.active || b.isDead || b.waypoints.length === 0) continue;

      const wp = b.waypoints[b.waypointIndex % b.waypoints.length];
      const dx = wp.x - b.controller.state.x;
      const dz = wp.z - b.controller.state.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 1.8) {
        b.waypointIndex = (b.waypointIndex + 1) % b.waypoints.length;
        continue;
      }

      const yaw = Math.atan2(-dx, -dz);
      const botInput: PlayerInput = {
        forward: true,
        backward: false,
        left: false,
        right: false,
        jump: false,
        crouch: false,
        walk: false,
        yaw,
        pitch: 0,
      };

      b.controller.update(
        botInput,
        this.TICK_DT,
        KINEMATICS.SPEED_RIFLE * 0.85,
        STATIC_COLLIDERS as AABBCollider[],
        undefined,
        this.spatialGrid
      );
    }
  }

  private tickAuthoritative(): void {
    this.tick++;
    const now = Date.now();

    // Prune expired smoke volumes
    if (this.activeSmokes.length > 0) {
      this.activeSmokes = this.activeSmokes.filter((sm) => sm.expiresAt > now);
    }

    // Step authoritative grenade trajectories, HE blasts, and Molotov fire zones
    this.updateProjectilesAndZones(now);

    // Step active bots along tactical waypoints during ROUND_LIVE
    this.updateServerBots();

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
        const frame = s.inputQueue.shift()!;
        // Always advance lastInputSeq even if rate-clamped so client reconciliation never stalls
        s.lastInputSeq = frame.seq;

        if (s.framesProcessedThisSecond >= 132) {
          drained++;
          continue;
        }

        if (s.ownedWeapons.has(frame.weaponId)) {
          if (s.activeWeaponId !== frame.weaponId) {
            s.activeWeaponId = frame.weaponId;
            s.isReloading = false;
            s.consecutiveShots = 0;
            s.deployCompleteAt = now + WEAPON_DEPLOY_MS;
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
          STATIC_COLLIDERS as AABBCollider[],
          undefined,
          this.spatialGrid
        );

        s.framesProcessedThisSecond++;
        drained++;
      }

      // Plant / Defuse progress (strictly guarded by ownership mutexes)
      if (!s.isDead && this.matchSim.phase === 'ROUND_LIVE') {
        if (s.plantDefuseAction === 'plant' && this.activePlanterId === s.id && !this.matchSim.isBombPlanted) {
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
              this.activePlanterId = null;
            }
          } else {
            this.releasePlantDefuseLock(s);
          }
        } else if (
          s.plantDefuseAction === 'defuse' &&
          this.activeDefuserId === s.id &&
          this.matchSim.isBombPlanted &&
          this.matchSim.bombPos
        ) {
          const dist = Math.hypot(
            s.controller.state.x - this.matchSim.bombPos.x,
            s.controller.state.z - this.matchSim.bombPos.z
          );
          if (dist <= 3.0) {
            const def = this.matchSim.stepDefuse(this.TICK_DT, s.hasDefuseKit);
            if (def.defused) {
              s.plantDefuseAction = 'none';
              this.activeDefuserId = null;
              s.cash = Math.min(ECONOMY.maxCash, s.cash + ECONOMY.defuseBonus);
              const res = this.matchSim.endRound('Vanguard', 'Pulse Core Defused');
              this.applyRoundEnd(res);
            }
          } else {
            this.releasePlantDefuseLock(s);
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
      if (b.active && !b.isDead) {
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
      if (!b.active) continue;
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

    // Broadcast snapshots with PVS Fog-of-War + Smoke Occlusion filtering + slow-consumer strike disconnect
    this.sessions.forEach((s) => {
      if (!s.ws || s.ws.readyState !== WebSocket.OPEN) return;
      if ((s.ws.bufferedAmount ?? 0) > SNAPSHOT_BACKPRESSURE_BYTES) {
        s.stalledTicks++;
        if (s.stalledTicks > MAX_STALLED_TICKS) {
          s.ws.close(1008, 'Backpressure timeout');
        }
        return;
      }
      s.stalledTicks = 0;

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
    this.activePlanterId = null;
    this.activeDefuserId = null;

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
    const eyeA = {
      x: sPos.x,
      y: sPos.y + (sPos.isCrouching ? KINEMATICS.EYE_HEIGHT_CROUCH : KINEMATICS.EYE_HEIGHT_STAND),
      z: sPos.z,
    };
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
    this.activeProjectiles = [];
    this.activeMolotovs = [];
    this.activePlanterId = null;
    this.activeDefuserId = null;

    const isHalftimeReset = this.matchSim.round === ECONOMY.halfTimeRound + 1;

    let vgHumanIdx = 0;
    let synHumanIdx = 0;

    this.sessions.forEach((s) => {
      if (isHalftimeReset) {
        // MR12 Halftime Side-Swap & Pistol Round Economy Reset
        s.team = s.team === 'Vanguard' ? 'Syndicate' : 'Vanguard';
        s.cash = ECONOMY.startingCash;
        s.armor = 0;
        s.hasHelmet = false;
        s.hasDefuseKit = false;
        s.ownedWeapons = new Set(['desert-eagle', 'garam-karambit']);
        s.activeWeaponId = 'desert-eagle';
        s.ownedUtilities.clear();
      }

      s.isDead = false;
      s.health = 100;
      s.isReloading = false;
      s.consecutiveShots = 0;
      s.plantDefuseAction = 'none';
      s.burnDamageAccum = 0;

      const isSyn = s.team === 'Syndicate';
      const spawn = isSyn ? SPAWN_POINTS.OBSIDIAN_T : SPAWN_POINTS.VANGUARD_CT;
      const laneIdx = isSyn ? synHumanIdx++ : vgHumanIdx++;
      s.controller.state.x = spawn.x + ((laneIdx % 5) - 2) * 2;
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
      if (isHalftimeReset) {
        this.sendEconomySync(s);
      }
    });

    if (isHalftimeReset) {
      this.rebalanceTeamBots();
      this.broadcastRoster();
    }

    const synBots = this.bots.filter((b) => b.team === 'Syndicate');
    const vgBots = this.bots.filter((b) => b.team === 'Vanguard');
    const synBuys = BotBrain.evaluateTeamEconomy(
      synBots.map(() => (isHalftimeReset ? ECONOMY.startingCash : 4500)),
      this.matchSim.tLossStreak,
      this.matchSim.round,
      false
    );
    const vgBuys = BotBrain.evaluateTeamEconomy(
      vgBots.map(() => (isHalftimeReset ? ECONOMY.startingCash : 4500)),
      this.matchSim.ctLossStreak,
      this.matchSim.round,
      true
    );

    let synIdx = 0;
    let vgIdx = 0;
    for (const b of this.bots) {
      b.isDead = false;
      b.health = 100;
      b.burnDamageAccum = 0;
      b.waypointIndex = 0;
      const isVg = b.team === 'Vanguard';
      const idx = isVg ? vgIdx++ : synIdx++;
      const decision = isVg ? vgBuys[idx] : synBuys[idx];
      if (decision) {
        b.armor = decision.buyArmor ? 100 : 0;
        b.hasHelmet = decision.buyHelmet;
      } else {
        b.armor = 100;
        b.hasHelmet = true;
      }
      const spawn = b.team === 'Syndicate' ? SPAWN_POINTS.OBSIDIAN_T : SPAWN_POINTS.VANGUARD_CT;
      b.controller.state.x = spawn.x + ((idx % 5) - 2) * 2;
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
