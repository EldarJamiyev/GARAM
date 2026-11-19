import { WebSocket } from 'ws';
import {
  DE_CITADEL_BLOCKS,
  SPAWN_POINTS,
  WEAPONS,
  ECONOMY,
  KINEMATICS,
  KinematicPlayerController,
  PlayerInput,
  executeTacticalRaycast,
  TargetCollider,
  Ray,
  ClientPacket,
  ServerPacket,
  NetOperatorState,
  NetBombState,
  validateClientPacket
} from '@garam/shared';
import { LagCompensation, SnapshotTarget } from './LagCompensation.js';

interface HumanSession {
  id: string;
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
  currentAmmo: number;
  reserveAmmo: number;
  isScoped: boolean;
  isReloading: boolean;
  isDead: boolean;
  kills: number;
  deaths: number;
  ping: number;
  simBudgetMs: number;
}

interface ServerBot {
  id: string;
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

export class GameRoom {
  private sessions = new Map<string, HumanSession>();
  private bots: ServerBot[] = [];
  private lagComp = new LagCompensation();

  // 64-Tick Authoritative Loop
  private tick = 0;
  private readonly TICK_RATE = 64;
  private readonly TICK_DT = 1 / 64;
  private intervalHandle: NodeJS.Timeout | null = null;

  // MR12 Match State
  public round = 1;
  public phase: 'FREEZE_TIME' | 'ROUND_LIVE' | 'ROUND_END' = 'FREEZE_TIME';
  public phaseTimer = 10.0;
  public ctScore = 0;
  public tScore = 0;
  public ctLossStreak = 0;
  public tLossStreak = 0;

  // Bomb State
  public bomb: NetBombState = {
    isPlanted: false,
    site: null,
    x: 0,
    y: 0,
    z: 0,
    plantProgress: 0,
    defuseProgress: 0,
    timeRemaining: 0,
  };

  constructor() {
    this.initDefaultBots();
    this.startLoop();
  }

  private initDefaultBots(): void {
    const vanguardNames = ['Atlas', 'Bravo', 'Cipher', 'Delta', 'Echo'];
    const syndicateNames = ['Viper', 'Ghost', 'Kodiak', 'Nyx', 'Ronin'];

    for (let i = 0; i < 5; i++) {
      const vCtrl = new KinematicPlayerController(SPAWN_POINTS.VANGUARD_CT.x + (i - 2) * 2, 0, SPAWN_POINTS.VANGUARD_CT.z);
      this.bots.push({
        id: `bot_ct_${i}`,
        name: `Bot ${vanguardNames[i]}`,
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

      const sCtrl = new KinematicPlayerController(SPAWN_POINTS.OBSIDIAN_T.x + (i - 2) * 2, 0, SPAWN_POINTS.OBSIDIAN_T.z);
      this.bots.push({
        id: `bot_t_${i}`,
        name: `Bot ${syndicateNames[i]}`,
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

  public handleConnection(ws: WebSocket, rateLimitCheck?: () => boolean): void {
    const sessionId = `player_${Math.random().toString(36).substring(2, 9)}`;

    ws.on('message', (data) => {
      if (rateLimitCheck && !rateLimitCheck()) {
        return;
      }

      try {
        const raw = JSON.parse(data.toString());
        const packet = validateClientPacket(raw);
        if (!packet) {
          // Discard invalid / malicious / prototype-polluted packet
          return;
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
      console.log(`[GARAM Server] Player departed: ${s.name} (${sessionId}). Active: ${this.sessions.size}`);
    }
  }

  private processClientPacket(sessionId: string, packet: ClientPacket, ws: WebSocket): void {
    const now = Date.now();

    if (packet.type === 'join') {
      const team = packet.faction || 'Vanguard';
      const spawn = team === 'Syndicate' ? SPAWN_POINTS.OBSIDIAN_T : SPAWN_POINTS.VANGUARD_CT;
      const controller = new KinematicPlayerController(spawn.x, spawn.y, spawn.z);

      const session: HumanSession = {
        id: sessionId,
        ws,
        name: packet.callsign || 'Eldar Garamov',
        team,
        controller,
        lastInputSeq: 0,
        lastShotTime: 0,
        health: 100,
        armor: 100,
        hasHelmet: true,
        hasDefuseKit: team === 'Vanguard',
        cash: 800,
        activeWeaponId: 'garam-47',
        currentAmmo: 30,
        reserveAmmo: 90,
        isScoped: false,
        isReloading: false,
        isDead: false,
        kills: 0,
        deaths: 0,
        ping: 15,
        simBudgetMs: 46.875,
      };

      this.sessions.set(sessionId, session);

      // Welcome packet
      this.sendToSession(sessionId, {
        type: 'welcome',
        playerId: sessionId,
        team,
        tickRate: this.TICK_RATE,
      });

      console.log(`[GARAM Server] Player joined room: ${session.name} [${team}]`);
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (packet.type === 'ping') {
      session.ping = Math.max(1, Math.round((now - packet.timestamp) / 2));
      this.sendToSession(sessionId, {
        type: 'pong',
        clientTimestamp: packet.timestamp,
        serverTimestamp: now,
      });
      return;
    }

    if (packet.type === 'input') {
      // Simulation time budget check: prevent time-dilation / input burst speedhacks
      const stepCostMs = KINEMATICS.FIXED_DT * 1000; // 7.8125ms
      if (session.simBudgetMs < stepCostMs * 0.5) {
        return;
      }
      session.simBudgetMs -= stepCostMs;
      session.lastInputSeq = packet.seq;
      const weapon = WEAPONS[packet.weaponId] || WEAPONS['garam-47'];

      // Run 128Hz fixed kinematic step on server for 100% mathematical parity
      session.controller.update(
        packet.input,
        KINEMATICS.FIXED_DT,
        weapon.movementSpeed,
        DE_CITADEL_BLOCKS.map(b => ({
          minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY, minZ: b.minZ, maxZ: b.maxZ
        }))
      );
      return;
    }

    if (packet.type === 'fire') {
      if (session.isDead) return;
      const weapon = WEAPONS[packet.weaponId] || WEAPONS[session.activeWeaponId];
      if (!weapon) return;

      const fireIntervalMs = (60 / weapon.fireRateRpm) * 1000;
      if (now - session.lastShotTime < fireIntervalMs * 0.9) return;
      if (session.currentAmmo <= 0 && weapon.category !== 'melee') return;

      session.lastShotTime = now;
      if (weapon.category !== 'melee') session.currentAmmo--;

      // Dynamically bounded lag-compensated hitbox rewind with clock skew immunity
      const rewoundTargets = this.lagComp.getRewoundTargets(now, packet.targetServerTime, session.ping);

      // Ray origin is strictly computed on server from authoritative player controller state
      const eyeHeight = session.controller.state.isCrouching
        ? KINEMATICS.EYE_HEIGHT_CROUCH
        : KINEMATICS.EYE_HEIGHT_STAND;
      const origin = {
        x: session.controller.state.x,
        y: session.controller.state.y + eyeHeight,
        z: session.controller.state.z,
      };

      // Server normalizes direction vector
      const dirLen = Math.hypot(packet.direction.x, packet.direction.y, packet.direction.z);
      if (dirLen < 0.0001 || !Number.isFinite(dirLen)) return;
      const direction = {
        x: packet.direction.x / dirLen,
        y: packet.direction.y / dirLen,
        z: packet.direction.z / dirLen,
      };

      const ray: Ray = {
        origin,
        direction,
      };

      const baseDmg = packet.isSecondaryMelee && weapon.id === 'garam-karambit' ? 90 : weapon.damage;

      const hits = executeTacticalRaycast(
        ray,
        baseDmg,
        weapon.armorPenetration,
        weapon.penetrationPower,
        250,
        DE_CITADEL_BLOCKS,
        rewoundTargets
      );

      for (const hit of hits) {
        if (hit.targetId) {
          // Check if victim is human or bot
          const victimHuman = this.sessions.get(hit.targetId);
          const victimBot = this.bots.find(b => b.id === hit.targetId);

          if (victimHuman && !victimHuman.isDead && victimHuman.team !== session.team) {
            victimHuman.health = Math.max(0, victimHuman.health - hit.awardedDamage);
            this.sendToSession(sessionId, {
              type: 'hit_confirm',
              targetId: victimHuman.id,
              damage: hit.awardedDamage,
              isHeadshot: !!hit.isHeadshot,
              victimHealth: victimHuman.health,
            });

            if (victimHuman.health <= 0) {
              victimHuman.isDead = true;
              victimHuman.deaths++;
              session.kills++;
              session.cash = Math.min(ECONOMY.maxCash, session.cash + weapon.killReward);
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
            }
            break;
          } else if (victimBot && !victimBot.isDead && victimBot.team !== session.team) {
            victimBot.health = Math.max(0, victimBot.health - hit.awardedDamage);
            this.sendToSession(sessionId, {
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
            }
            break;
          }
        }
      }
    }
  }

  private startLoop(): void {
    this.intervalHandle = setInterval(() => {
      this.tick++;
      const now = Date.now();

      // Replenish simulation time budget per connected player (cap 46.875ms, i.e. 3 ticks)
      this.sessions.forEach(s => {
        s.simBudgetMs = Math.min(46.875, s.simBudgetMs + this.TICK_DT * 1000);
      });

      // 1. Update Match Timers
      this.updateMatchState();

      // 2. Snapshot target hitboxes for 80ms lag compensation
      const snapshotTargets: SnapshotTarget[] = [];
      this.sessions.forEach(s => {
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
          });
        }
      });
      this.bots.forEach(b => {
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
          });
        }
      });

      this.lagComp.recordSnapshot(this.tick, now, snapshotTargets);

      // 3. Assemble and broadcast authoritative 64-tick state snapshot
      const playerStates: NetOperatorState[] = [];
      this.sessions.forEach(s => {
        playerStates.push({
          id: s.id,
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

      this.bots.forEach(b => {
        playerStates.push({
          id: b.id,
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
          activeWeapon: 'garam-47',
          currentAmmo: 30,
          reserveAmmo: 90,
          isScoped: false,
          isReloading: false,
          isCrouching: false,
          isDead: b.isDead,
          ping: 0,
          kills: b.kills,
          deaths: b.deaths,
        });
      });

      // Broadcast snapshots to connected clients with their last acknowledged input sequence
      this.sessions.forEach(s => {
        const snapPacket: ServerPacket = {
          type: 'snapshot',
          tick: this.tick,
          serverTimestamp: now,
          lastAckSeq: s.lastInputSeq,
          players: playerStates,
          bomb: this.bomb,
          roundPhase: this.phase,
          roundTime: Math.ceil(this.phaseTimer),
          ctScore: this.ctScore,
          tScore: this.tScore,
        };
        if (s.ws && s.ws.readyState === WebSocket.OPEN) {
          s.ws.send(JSON.stringify(snapPacket));
        }
      });
    }, 1000 / this.TICK_RATE);
  }

  private updateMatchState(): void {
    this.phaseTimer = Math.max(0, this.phaseTimer - this.TICK_DT);

    if (this.phaseTimer <= 0) {
      if (this.phase === 'FREEZE_TIME') {
        this.phase = 'ROUND_LIVE';
        this.phaseTimer = 115.0; // 1:55
      } else if (this.phase === 'ROUND_LIVE') {
        // Round timed out -> Vanguard Defenders win!
        this.ctScore++;
        this.phase = 'ROUND_END';
        this.phaseTimer = 5.0;
        this.broadcast({
          type: 'round_event',
          phase: 'ROUND_END',
          round: this.round,
          winner: 'Vanguard',
          reason: 'Time Ran Out — Vanguard Defended Sites',
          ctScore: this.ctScore,
          tScore: this.tScore,
        });
      } else if (this.phase === 'ROUND_END') {
        this.round++;
        this.phase = 'FREEZE_TIME';
        this.phaseTimer = 10.0;
        this.resetRound();
      }
    }
  }

  private resetRound(): void {
    this.sessions.forEach(s => {
      s.isDead = false;
      s.health = 100;
      s.armor = 100;
      const spawn = s.team === 'Syndicate' ? SPAWN_POINTS.OBSIDIAN_T : SPAWN_POINTS.VANGUARD_CT;
      s.controller.state.x = spawn.x;
      s.controller.state.y = spawn.y;
      s.controller.state.z = spawn.z;
    });

    this.bots.forEach(b => {
      b.isDead = false;
      b.health = 100;
      b.armor = 100;
      const spawn = b.team === 'Syndicate' ? SPAWN_POINTS.OBSIDIAN_T : SPAWN_POINTS.VANGUARD_CT;
      b.controller.state.x = spawn.x;
      b.controller.state.y = spawn.y;
      b.controller.state.z = spawn.z;
    });
  }

  private sendToSession(sessionId: string, packet: ServerPacket): void {
    const s = this.sessions.get(sessionId);
    if (s && s.ws && s.ws.readyState === WebSocket.OPEN) {
      s.ws.send(JSON.stringify(packet));
    }
  }

  private broadcast(packet: ServerPacket): void {
    const json = JSON.stringify(packet);
    this.sessions.forEach(s => {
      if (s.ws && s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(json);
      }
    });
  }
}
