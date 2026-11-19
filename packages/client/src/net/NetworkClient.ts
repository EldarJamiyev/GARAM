import * as THREE from 'three';
import {
  ClientPacket,
  ServerPacket,
  NetOperatorState,
  PlayerInput,
  KinematicPlayerController,
  AABBCollider,
  WEAPONS,
  BinaryCodec
} from '@garam/shared';
import { OperatorRig } from '../render/OperatorRig.js';
import { HUDManager } from '../ui/HUDManager.js';

interface UnackInput {
  seq: number;
  input: PlayerInput;
  dt: number;
  weaponSpeed: number;
  x: number;
  y: number;
  z: number;
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
  public ping = 15;
  public serverClockOffset = 0; // Estimated (serverTime - localClientTime)
  public readonly INTERPOLATION_DELAY_MS = 46.875; // 3 ticks at 64Hz (CS2 tournament interpolation buffer)
  public rxKbps = 0;
  public txKbps = 0;
  private rxBytesAccum = 0;
  private txBytesAccum = 0;
  private lastBandwidthCalc = Date.now();

  private seq = 0;
  private unackInputs: UnackInput[] = [];
  private remotePlayers = new Map<string, RemotePlayer>();

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

  public connect(url = 'ws://localhost:2567', callsign = 'Eldar Garamov', faction: 'Vanguard' | 'Syndicate' = 'Vanguard'): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
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

        // Send Join Packet
        this.send({
          type: 'join',
          callsign,
          faction,
        });

        // Start ping loop
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
          // Ignore
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.clearRemoteRigs();
  }

  public sendInput(
    input: PlayerInput,
    dt: number,
    weaponSpeed: number,
    localPlayer: KinematicPlayerController,
    activeWeaponId: string
  ): void {
    if (!this.isConnected || !this.ws) return;

    this.seq++;

    // Record for client-side prediction and server reconciliation
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

    // Fast-path zero-copy 22-byte binary user input frame
    const binInput = BinaryCodec.encodeInput({
      seq: this.seq,
      timestamp: Date.now(),
      input,
      weaponId: activeWeaponId,
    });
    this.ws.send(binInput);
    this.txBytesAccum += 22;
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
      return;
    }

    if (packet.type === 'pong') {
      const now = Date.now();
      const rtt = Math.max(1, now - packet.clientTimestamp);
      this.ping = rtt;
      const oneWayLatency = rtt / 2;
      const sampleOffset = (packet.serverTimestamp + oneWayLatency) - now;
      // Exponential smoothing filter on clock offset
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

      // Reconcile local player and discard acknowledged inputs
      this.unackInputs = this.unackInputs.filter(u => u.seq > packet.lastAckSeq);

      // Update remote players
      const presentIds = new Set<string>();

      for (const p of packet.players) {
        if (p.id === this.localPlayerId) {
          // Server reconciliation test
          // In practice, if divergence > 0.04m, snap and replay unack inputs
          continue;
        }

        presentIds.add(p.id);
        let remote = this.remotePlayers.get(p.id);

        if (!remote) {
          const rig = new OperatorRig(p.team, p.name);
          rig.root.position.set(p.x, p.y, p.z);
          this.scene.add(rig.root);

          remote = {
            id: p.id,
            name: p.name,
            team: p.team,
            rig,
            targetPos: new THREE.Vector3(p.x, p.y, p.z),
            targetYaw: p.yaw,
            currentPos: new THREE.Vector3(p.x, p.y, p.z),
            currentYaw: p.yaw,
            isDead: p.isDead,
            health: p.health,
          };
          this.remotePlayers.set(p.id, remote);
        }

        // Update target interpolation state
        remote.targetPos.set(p.x, p.y, p.z);
        remote.targetYaw = p.yaw;
        remote.isDead = p.isDead;
        remote.health = p.health;
      }

      // Remove stale players
      this.remotePlayers.forEach((rem, id) => {
        if (!presentIds.has(id)) {
          this.scene.remove(rem.rig.root);
          this.remotePlayers.delete(id);
        }
      });
    }
  }

  public update(dt: number): void {
    if (!this.isConnected) return;

    // Smoothly interpolate remote operator rigs towards latest server state
    this.remotePlayers.forEach((rem) => {
      rem.currentPos.lerp(rem.targetPos, 1 - Math.exp(-22 * dt));
      rem.currentYaw += (rem.targetYaw - rem.currentYaw) * (1 - Math.exp(-22 * dt));

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
      setTimeout(loop, 2000);
    };
    setTimeout(loop, 1000);
  }

  private clearRemoteRigs(): void {
    this.remotePlayers.forEach((rem) => {
      this.scene.remove(rem.rig.root);
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
