import * as THREE from 'three';
import {
  ClientPacket,
  ServerPacket,
  NetOperatorState,
  NetRosterEntry,
  PlayerInput,
  KinematicPlayerController,
  AABBCollider,
  SpatialGrid,
  BinaryCodec,
  BinaryInputData,
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

export interface EconomySyncPayload {
  cash: number;
  ownedWeapons: string[];
  armor: number;
  hasHelmet: boolean;
  hasDefuseKit: boolean;
}

export interface UtilityEventPayload {
  id: string;
  utilityType: string;
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

export interface LocalStateSyncPayload {
  health: number;
  armor: number;
  hasHelmet?: boolean;
  hasDefuseKit?: boolean;
  activeWeapon: string;
  currentAmmo: number;
  reserveAmmo: number;
  isDead: boolean;
}

export interface NetworkClientCallbacks {
  onKillfeed?: (text: string) => void;
  onScoresUpdated?: (ct: number, t: number) => void;
  onEconomySync?: (payload: EconomySyncPayload) => void;
  onUtilityEvent?: (payload: UtilityEventPayload) => void;
  onLocalStateSync?: (payload: LocalStateSyncPayload) => void;
}

/**
 * Pure deterministic client-side prediction reconciliation.
 * Discards server-acknowledged inputs, replays unacknowledged frames from the authoritative
 * server state (preserving crouch/grounded/step kinematic invariants), and computes the
 * smooth visual offset if divergence exceeds 0.04m.
 */
export function reconcilePredictedState(
  localPlayer: KinematicPlayerController,
  serverState: Pick<NetOperatorState, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'isCrouching'>,
  lastAckSeq: number,
  unackInputs: UnackInput[],
  colliders: AABBCollider[],
  spatialGrid?: SpatialGrid
): ReconciliationResult {
  const remaining = unackInputs.filter((u) => u.seq > lastAckSeq);

  const prevX = localPlayer.state.x;
  const prevY = localPlayer.state.y;
  const prevZ = localPlayer.state.z;

  // Replay from authoritative server state through remaining unacknowledged inputs
  const replay = new KinematicPlayerController(serverState.x, serverState.y, serverState.z);
  const currentSnap = localPlayer.exportSnapshot();
  replay.importSnapshot({
    ...currentSnap,
    state: {
      ...currentSnap.state,
      x: serverState.x,
      y: serverState.y,
      z: serverState.z,
      vx: serverState.vx,
      vy: serverState.vy,
      vz: serverState.vz,
      isCrouching: serverState.isCrouching,
      isGrounded: serverState.y <= 0.02 && Math.abs(serverState.vy) < 0.05 ? true : currentSnap.state.isGrounded,
    },
    actualCrouching: serverState.isCrouching,
  });

  for (const frame of remaining) {
    replay.update(frame.input, frame.dt, frame.weaponSpeed, colliders, undefined, spatialGrid);
  }

  const dx = replay.state.x - prevX;
  const dy = replay.state.y - prevY;
  const dz = replay.state.z - prevZ;
  const errorMagnitude = Math.hypot(dx, dy, dz);

  if (errorMagnitude > 0.04) {
    const yaw = localPlayer.state.yaw;
    const pitch = localPlayer.state.pitch;
    const reconciled = replay.exportSnapshot();
    reconciled.state.yaw = yaw;
    reconciled.state.pitch = pitch;
    localPlayer.importSnapshot(reconciled);
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
  visibleInSnapshot: boolean;
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
  private fireSeq = 0;
  private pendingInputBatch: BinaryInputData[] = [];
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
  private spatialGrid?: SpatialGrid;
  private callbacks: NetworkClientCallbacks;

  constructor(
    scene: THREE.Scene,
    hud: HUDManager,
    colliders: AABBCollider[],
    callbacks?: NetworkClientCallbacks,
    spatialGrid?: SpatialGrid
  ) {
    this.scene = scene;
    this.hud = hud;
    this.colliders = colliders;
    this.spatialGrid = spatialGrid;
    this.callbacks = callbacks ?? {};
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
        this.pendingInputBatch.length = 0;
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
        this.pendingInputBatch.length = 0;
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
    this.flushInputBatch();
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
    this.pendingInputBatch.length = 0;
    this.rosterBySlot.clear();
    this.clearRemoteRigs();
  }

  private flushInputBatch(): void {
    if (this.pendingInputBatch.length === 0) return;
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingInputBatch.length = 0;
      return;
    }

    const encoded =
      this.pendingInputBatch.length === 1
        ? BinaryCodec.encodeInput(this.pendingInputBatch[0])
        : BinaryCodec.encodeInputBatch(this.pendingInputBatch);
    this.ws.send(encoded);
    this.txBytesAccum += encoded.byteLength;
    this.pendingInputBatch.length = 0;
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

    const inputCopy: PlayerInput = { ...input };
    this.unackInputs.push({
      seq: this.seq,
      input: inputCopy,
      dt,
      weaponSpeed,
      x: localPlayer.state.x,
      y: localPlayer.state.y,
      z: localPlayer.state.z,
    });

    if (this.unackInputs.length > 128) {
      this.unackInputs.shift();
    }

    // Batch 2x128Hz frames into 1x64Hz binary WebSocket frame (cuts packet rate by 50%)
    this.pendingInputBatch.push({
      seq: this.seq,
      timestamp: Math.floor(performance.now()),
      input: inputCopy,
      weaponId: activeWeaponId,
    });

    if (this.pendingInputBatch.length >= 2) {
      this.flushInputBatch();
    }
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

  public sendUtilityThrow(
    utilityType: string,
    mode: 'long' | 'medium' | 'short',
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    velocity: THREE.Vector3
  ): void {
    if (!this.isConnected) return;
    this.flushInputBatch();
    this.send({
      type: 'utility_throw',
      utilityType,
      mode,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      direction: { x: direction.x, y: direction.y, z: direction.z },
      velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
    });
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
    // Flush any queued movement input before firing so server position is current
    this.flushInputBatch();
    this.fireSeq++;
    const targetServerTime = this.getEstimatedServerTime() - this.INTERPOLATION_DELAY_MS;
    this.send({
      type: 'fire',
      seq: this.fireSeq,
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
      const activeRosterIds = new Set<string>();
      for (const entry of packet.entries) {
        this.rosterBySlot.set(entry.slot, entry);
        activeRosterIds.add(entry.id);
      }

      // Only GPU-dispose rigs when a player actually leaves the roster (not on PVS occlusion!)
      this.remotePlayers.forEach((rem, id) => {
        if (!activeRosterIds.has(id)) {
          this.scene.remove(rem.rig.root);
          rem.rig.dispose();
          this.remotePlayers.delete(id);
        }
      });
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
      this.callbacks.onKillfeed?.(text);
      return;
    }

    if (packet.type === 'economy_sync') {
      this.callbacks.onEconomySync?.({
        cash: packet.cash,
        ownedWeapons: packet.ownedWeapons,
        armor: packet.armor,
        hasHelmet: packet.hasHelmet,
        hasDefuseKit: packet.hasDefuseKit,
      });
      return;
    }

    if (packet.type === 'utility_event') {
      this.callbacks.onUtilityEvent?.({
        id: packet.id,
        utilityType: packet.utilityType,
        origin: packet.origin,
        direction: packet.direction,
        velocity: packet.velocity,
      });
      return;
    }

    if (packet.type === 'round_event') {
      if (packet.winner) {
        this.hud.showCenterBanner(`${packet.winner.toUpperCase()} WINS`, packet.reason || '', 4000);
      }
      this.callbacks.onScoresUpdated?.(packet.ctScore, packet.tScore);
      return;
    }

    if (packet.type === 'snapshot') {
      this.callbacks.onScoresUpdated?.(packet.ctScore, packet.tScore);
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
          this.callbacks.onLocalStateSync?.({
            health: p.health,
            armor: p.armor,
            hasHelmet: p.hasHelmet,
            hasDefuseKit: p.hasDefuseKit,
            activeWeapon: p.activeWeapon,
            currentAmmo: p.currentAmmo,
            reserveAmmo: p.reserveAmmo,
            isDead: p.isDead,
          });

          if (this.localPlayerRef) {
            const result = reconcilePredictedState(
              this.localPlayerRef,
              p,
              packet.lastAckSeq,
              this.unackInputs,
              this.colliders,
              this.spatialGrid
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
            visibleInSnapshot: true,
          };
          this.remotePlayers.set(resolvedId, remote);
        } else if (!remote.visibleInSnapshot) {
          // Snap immediately when re-appearing from PVS occlusion to prevent ghost-lerping through walls
          remote.currentPos.set(p.x, p.y, p.z);
          remote.currentYaw = p.yaw;
          remote.rig.root.position.set(p.x, p.y, p.z);
          remote.rig.root.rotation.y = p.yaw;
          remote.rig.root.visible = true;
          remote.visibleInSnapshot = true;
        }

        remote.name = resolvedName;
        remote.team = resolvedTeam;
        remote.targetPos.set(p.x, p.y, p.z);
        remote.targetYaw = p.yaw;
        remote.isDead = p.isDead;
        remote.health = p.health;
      }

      // Pool PVS-occluded rigs by hiding instead of destroying GPU buffers on every peek
      this.remotePlayers.forEach((rem, id) => {
        if (!presentIds.has(id)) {
          rem.visibleInSnapshot = false;
          rem.rig.root.visible = false;
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

    // Flush any single trailing input frame once per render tick so input latency stays minimal
    if (this.pendingInputBatch.length > 0) {
      this.flushInputBatch();
    }

    const alpha = 1 - Math.exp(-22 * dt);

    this.remotePlayers.forEach((rem) => {
      if (!rem.visibleInSnapshot) return;

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

