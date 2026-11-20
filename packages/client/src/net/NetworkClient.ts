import * as THREE from 'three';
import {
  ClientPacket,
  ServerPacket,
  NetOperatorState,
  NetRosterEntry,
  PlayerInput,
  KinematicPlayerController,
  AABBCollider,
  BinaryCodec,
} from '@garam/shared';
import { OperatorRig } from '../render/OperatorRig.js';
import { HUDManager } from '../ui/HUDManager.js';

export interface UnackInput {
  seq: number;
  input: PlayerInput;
  dt: number;
  weaponSpeed: number;
  x: number;
  y: number;
  z: number;
}

export interface ReconciliationResult {
  corrected: boolean;
  errorMagnitude: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  remainingInputs: UnackInput[];
}

/**
 * Pure deterministic client-side prediction reconciliation.
 * Discards server-acknowledged inputs, replays unacknowledged frames from the authoritative
 * server state, and computes the smooth visual offset if divergence exceeds 0.04m.
 */
export function reconcilePredictedState(
  localPlayer: KinematicPlayerController,
  serverState: Pick<NetOperatorState, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'isCrouching'>,
  lastAckSeq: number,
  unackInputs: UnackInput[],
  colliders: AABBCollider[]
): ReconciliationResult {
  const remaining = unackInputs.filter((u) => u.seq > lastAckSeq);

  const prevX = localPlayer.state.x;
  const prevY = localPlayer.state.y;
  const prevZ = localPlayer.state.z;

  // Replay from authoritative server state through remaining unacknowledged inputs
  const replay = new KinematicPlayerController(serverState.x, serverState.y, serverState.z);
  replay.state.vx = serverState.vx;
  replay.state.vy = serverState.vy;
  replay.state.vz = serverState.vz;
  replay.state.isCrouching = serverState.isCrouching;
  replay.state.yaw = localPlayer.state.yaw;
  replay.state.pitch = localPlayer.state.pitch;

  for (const frame of remaining) {
    replay.update(frame.input, frame.dt, frame.weaponSpeed, colliders);
  }

  const dx = replay.state.x - prevX;
  const dy = replay.state.y - prevY;
  const dz = replay.state.z - prevZ;
  const errorMagnitude = Math.hypot(dx, dy, dz);

  if (errorMagnitude > 0.04) {
    localPlayer.state.x = replay.state.x;
    localPlayer.state.y = replay.state.y;
    localPlayer.state.z = replay.state.z;
    localPlayer.state.vx = replay.state.vx;
    localPlayer.state.vy = replay.state.vy;
    localPlayer.state.vz = replay.state.vz;
    return {
      corrected: true,
      errorMagnitude,
      offsetX: prevX - replay.state.x,
      offsetY: prevY - replay.state.y,
      offsetZ: prevZ - replay.state.z,
      remainingInputs: remaining,
    };
  }

  return {
    corrected: false,
    errorMagnitude,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    remainingInputs: remaining,
  };
}

interface RemotePlayer {
  id: string;
  name: string;
  team: 'Vanguard' | 'Syndicate';
  rig: OperatorRig;
  targetPos: THREE.Vector3;
  targetYaw: number;
  currentPos: THREE.Vector3;
  currentYaw: number;
  isDead: boolean;
  health: number;
}

export class NetworkClient {
  private ws: WebSocket | null = null;
  public isConnected = false;
  public localPlayerId = '';
  public localEntitySlot = -1;
  public ping = 15;
  public serverClockOffset = 0;
  public readonly INTERPOLATION_DELAY_MS = 46.875; // 3 ticks at 64Hz
  public rxKbps = 0;
  public txKbps = 0;
  private rxBytesAccum = 0;
  private txBytesAccum = 0;
  private lastBandwidthCalc = Date.now();

  private seq = 0;
  private unackInputs: UnackInput[] = [];
  private remotePlayers = new Map<string, RemotePlayer>();
  private rosterBySlot = new Map<number, NetRosterEntry>();
  private localPlayerRef: KinematicPlayerController | null = null;
  private pingTimerHandle: number | null = null;

  // Exponentially smoothed reconciliation camera offset (80ms decay)
  public predictionErrorOffset = new THREE.Vector3();

  private scene: THREE.Scene;
  private hud: HUDManager;
  private colliders: AABBCollider[];
  private onKillfeedCallback?: (text: string) => void;
  private onScoresUpdated?: (ct: number, t: number) => void;

  constructor(
    scene: THREE.Scene,
    hud: HUDManager,
    colliders: AABBCollider[],
    callbacks?: {
      onKillfeed?: (text: string) => void;
      onScoresUpdated?: (ct: number, t: number) => void;
    }
  ) {
    this.scene = scene;
    this.hud = hud;
    this.colliders = colliders;
    this.onKillfeedCallback = callbacks?.onKillfeed;
    this.onScoresUpdated = callbacks?.onScoresUpdated;
  }

  public bindLocalPlayer(controller: KinematicPlayerController): void {
    this.localPlayerRef = controller;
  }

  public connect(
    url = 'ws://localhost:2567',
    callsign = 'Operator',
    faction: 'Vanguard' | 'Syndicate' = 'Vanguard'
  ): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.pingTimerHandle !== null) {
      window.clearTimeout(this.pingTimerHandle);
      this.pingTimerHandle = null;
    }

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.ws!.binaryType = 'arraybuffer';
        const statusBadge = document.getElementById('server-status-badge');
        if (statusBadge) {
          statusBadge.innerText = '● CONNECTED (64-TICK)';
          statusBadge.style.color = '#00ff88';
        }

        this.send({
          type: 'join',
          callsign,
          faction,
        });

        this.startPingLoop();
      };

      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.rxBytesAccum += event.data.byteLength;
          const binarySnap = BinaryCodec.decodeSnapshot(event.data);
          if (binarySnap) {
            this.handleServerPacket({
              type: 'snapshot',
              tick: binarySnap.tick,
              serverTimestamp: binarySnap.serverTimestamp,
              lastAckSeq: binarySnap.lastAckSeq,
              players: binarySnap.players,
              bomb: binarySnap.bomb,
              roundPhase: binarySnap.roundPhase,
              roundTime: binarySnap.roundTime,
              ctScore: binarySnap.ctScore,
              tScore: binarySnap.tScore,
            });
            return;
          }
        }

        try {
          if (typeof event.data === 'string') {
            this.rxBytesAccum += event.data.length;
            const packet = JSON.parse(event.data) as ServerPacket;
            this.handleServerPacket(packet);
          }
        } catch {
          // Ignore malformed server payload
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.localEntitySlot = -1;
        this.rosterBySlot.clear();
        if (this.pingTimerHandle !== null) {
          window.clearTimeout(this.pingTimerHandle);
          this.pingTimerHandle = null;
        }
        const statusBadge = document.getElementById('server-status-badge');
        if (statusBadge) {
          statusBadge.innerText = '● OFFLINE';
          statusBadge.style.color = '#ff4444';
        }
        this.clearRemoteRigs();
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        const statusBadge = document.getElementById('server-status-badge');
        if (statusBadge) {
          statusBadge.innerText = '● CONNECTION FAILED';
          statusBadge.style.color = '#ff4444';
        }
      };
    } catch {
      this.isConnected = false;
    }
  }

  public disconnect(): void {
    if (this.pingTimerHandle !== null) {
      window.clearTimeout(this.pingTimerHandle);
      this.pingTimerHandle = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.localEntitySlot = -1;
    this.rosterBySlot.clear();
    this.clearRemoteRigs();
  }

  public sendInput(
    input: PlayerInput,
    dt: number,
    weaponSpeed: number,
    localPlayer: KinematicPlayerController,
    activeWeaponId: string
  ): void {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.localPlayerRef = localPlayer;
    this.seq++;

    this.unackInputs.push({
      seq: this.seq,
      input: { ...input },
      dt,
      weaponSpeed,
      x: localPlayer.state.x,
      y: localPlayer.state.y,
      z: localPlayer.state.z,
    });

    if (this.unackInputs.length > 128) {
      this.unackInputs.shift();
    }

    const binInput = BinaryCodec.encodeInput({
      seq: this.seq,
      timestamp: Math.floor(performance.now()),
      input,
      weaponId: activeWeaponId,
    });
    this.ws.send(binInput);
    this.txBytesAccum += 22;
  }

  public sendBuy(item: string): void {
    if (!this.isConnected) return;
    this.send({ type: 'buy', item });
  }

  public sendReload(): void {
    if (!this.isConnected) return;
    this.send({ type: 'reload' });
  }

  public sendPlantDefuse(action: 'plant' | 'defuse' | 'cancel'): void {
    if (!this.isConnected) return;
    this.send({ type: 'plant_defuse', action });
  }

  public updateBandwidthTelemetry(): void {
    const now = Date.now();
    const elapsed = (now - this.lastBandwidthCalc) / 1000;
    if (elapsed >= 0.5) {
      this.rxKbps = (this.rxBytesAccum * 8) / (elapsed * 1000);
      this.txKbps = (this.txBytesAccum * 8) / (elapsed * 1000);
      this.rxBytesAccum = 0;
      this.txBytesAccum = 0;
      this.lastBandwidthCalc = now;
    }
  }

  public getEstimatedServerTime(): number {
    return Date.now() + this.serverClockOffset;
  }

  public sendFire(
    direction: THREE.Vector3,
    weaponId: string,
    yaw: number,
    pitch: number,
    isSecondaryMelee = false,
    isScoped = false
  ): void {
    if (!this.isConnected) return;
    this.seq++;
    const targetServerTime = this.getEstimatedServerTime() - this.INTERPOLATION_DELAY_MS;
    this.send({
      type: 'fire',
      seq: this.seq,
      targetServerTime,
      weaponId,
      direction: { x: direction.x, y: direction.y, z: direction.z },
      yaw,
      pitch,
      isSecondaryMelee,
      isScoped,
    });
  }

  private handleServerPacket(packet: ServerPacket): void {
    if (packet.type === 'welcome') {
      this.localPlayerId = packet.playerId;
      this.localEntitySlot = packet.entitySlot;
      return;
    }

    if (packet.type === 'roster_sync') {
      this.rosterBySlot.clear();
      for (const entry of packet.entries) {
        this.rosterBySlot.set(entry.slot, entry);
      }
      return;
    }

    if (packet.type === 'ping_challenge') {
      this.send({ type: 'pong_challenge', nonce: packet.nonce });
      return;
    }

    if (packet.type === 'pong') {
      const now = Date.now();
      const rtt = Math.max(1, now - packet.clientTimestamp);
      this.ping = rtt;
      const oneWayLatency = rtt / 2;
      const sampleOffset = packet.serverTimestamp + oneWayLatency - now;
      this.serverClockOffset += (sampleOffset - this.serverClockOffset) * 0.25;
      return;
    }

    if (packet.type === 'hit_confirm') {
      this.hud.triggerHitmarker(packet.isHeadshot);
      return;
    }

    if (packet.type === 'kill_event') {
      const icon = packet.headshot ? '🎯 [HEADSHOT] ' : '💀 ';
      const text = `${icon}${packet.killerName} [${packet.weaponName}] ${packet.victimName} (+$${packet.reward})`;
      this.onKillfeedCallback?.(text);
      return;
    }

    if (packet.type === 'round_event') {
      if (packet.winner) {
        this.hud.showCenterBanner(`${packet.winner.toUpperCase()} WINS`, packet.reason || '', 4000);
      }
      this.onScoresUpdated?.(packet.ctScore, packet.tScore);
      return;
    }

    if (packet.type === 'snapshot') {
      this.onScoresUpdated?.(packet.ctScore, packet.tScore);
      this.hud.updateRoundTimer(packet.roundTime, packet.bomb.isPlanted);

      const presentIds = new Set<string>();

      for (const p of packet.players) {
        const rosterEntry = p.entitySlot !== undefined ? this.rosterBySlot.get(p.entitySlot) : undefined;
        const resolvedId = rosterEntry ? rosterEntry.id : p.id;
        const resolvedName = rosterEntry ? rosterEntry.name : p.name;
        const resolvedTeam = rosterEntry ? rosterEntry.team : p.team;

        // Authoritative local player identification (immune to binary slot_<n> aliasing!)
        const isLocalPlayer =
          resolvedId === this.localPlayerId ||
          (p.entitySlot !== undefined && this.localEntitySlot >= 0 && p.entitySlot === this.localEntitySlot);

        if (isLocalPlayer) {
          if (this.localPlayerRef) {
            const result = reconcilePredictedState(
              this.localPlayerRef,
              p,
              packet.lastAckSeq,
              this.unackInputs,
              this.colliders
            );
            this.unackInputs = result.remainingInputs;
            if (result.corrected) {
              this.predictionErrorOffset.x += result.offsetX;
              this.predictionErrorOffset.y += result.offsetY;
              this.predictionErrorOffset.z += result.offsetZ;
            }
          } else {
            this.unackInputs = this.unackInputs.filter((u) => u.seq > packet.lastAckSeq);
          }
          continue;
        }

        presentIds.add(resolvedId);
        let remote = this.remotePlayers.get(resolvedId);

        if (!remote) {
          const rig = new OperatorRig(resolvedTeam, resolvedName);
          rig.root.position.set(p.x, p.y, p.z);
          this.scene.add(rig.root);

          remote = {
            id: resolvedId,
            name: resolvedName,
            team: resolvedTeam,
            rig,
            targetPos: new THREE.Vector3(p.x, p.y, p.z),
            targetYaw: p.yaw,
            currentPos: new THREE.Vector3(p.x, p.y, p.z),
            currentYaw: p.yaw,
            isDead: p.isDead,
            health: p.health,
          };
          this.remotePlayers.set(resolvedId, remote);
        }

        remote.name = resolvedName;
        remote.team = resolvedTeam;
        remote.targetPos.set(p.x, p.y, p.z);
        remote.targetYaw = p.yaw;
        remote.isDead = p.isDead;
        remote.health = p.health;
      }

      // Remove & GPU-dispose stale remote players
      this.remotePlayers.forEach((rem, id) => {
        if (!presentIds.has(id)) {
          this.scene.remove(rem.rig.root);
          rem.rig.dispose();
          this.remotePlayers.delete(id);
        }
      });
    }
  }

  public update(dt: number): void {
    // Exponentially decay visual prediction reconciliation error over ~80ms
    if (this.predictionErrorOffset.lengthSq() > 1e-6) {
      const decay = Math.exp(-dt / 0.08);
      this.predictionErrorOffset.multiplyScalar(decay);
      if (this.predictionErrorOffset.lengthSq() < 1e-6) {
        this.predictionErrorOffset.set(0, 0, 0);
      }
    }

    if (!this.isConnected) return;

    const alpha = 1 - Math.exp(-22 * dt);

    this.remotePlayers.forEach((rem) => {
      rem.currentPos.lerp(rem.targetPos, alpha);

      // Shortest-arc circular yaw interpolation (eliminates 360° spin across +/- PI)
      const yawDelta = Math.atan2(
        Math.sin(rem.targetYaw - rem.currentYaw),
        Math.cos(rem.targetYaw - rem.currentYaw)
      );
      rem.currentYaw += yawDelta * alpha;

      rem.rig.root.position.copy(rem.currentPos);
      rem.rig.root.rotation.y = rem.currentYaw;

      const speed = rem.currentPos.distanceTo(rem.targetPos) / Math.max(0.001, dt);
      rem.rig.update(dt, {
        isMoving: speed > 0.5,
        speed,
        isDead: rem.isDead,
        healthRatio: rem.health / 100,
        team: rem.team,
        name: rem.name,
      });
    });
  }

  private startPingLoop(): void {
    const loop = () => {
      if (!this.isConnected || !this.ws) return;
      this.send({ type: 'ping', timestamp: Date.now() });
      this.pingTimerHandle = window.setTimeout(loop, 2000);
    };
    this.pingTimerHandle = window.setTimeout(loop, 1000);
  }

  private clearRemoteRigs(): void {
    this.remotePlayers.forEach((rem) => {
      this.scene.remove(rem.rig.root);
      rem.rig.dispose();
    });
    this.remotePlayers.clear();
  }

  private send(packet: ClientPacket): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msg = JSON.stringify(packet);
      this.txBytesAccum += msg.length;
      this.ws.send(msg);
    }
  }
}
