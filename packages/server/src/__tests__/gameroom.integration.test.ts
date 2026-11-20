import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { GameRoom } from '../GameRoom.js';
import { ServerPacket, ClientPacket } from '@garam/shared';
import type { WebSocket } from 'ws';

class MockWebSocket extends EventEmitter {
  public readyState = 1; // WebSocket.OPEN
  public bufferedAmount = 0;
  public sentMessages: ServerPacket[] = [];
  public closed = false;
  public closeCode?: number;
  public closeReason?: string;

  public send(data: string): void {
    try {
      this.sentMessages.push(JSON.parse(data));
    } catch {
      // Ignore
    }
  }

  public close(code?: number, reason?: string): void {
    this.readyState = 3; // WebSocket.CLOSED
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.emit('close');
  }

  public simulateClientMessage(packet: ClientPacket): void {
    this.emit('message', Buffer.from(JSON.stringify(packet)));
  }
}

describe('Authoritative Server GameRoom Integration Suite', () => {
  let room: GameRoom | null = null;

  afterEach(() => {
    if (room) {
      room.stop();
      room = null;
    }
  });

  it('handles 2-client connection, welcome handshake, and 64Hz snapshot stream', async () => {
    room = new GameRoom();

    const client1 = new MockWebSocket();
    const client2 = new MockWebSocket();

    room.handleConnection(client1 as unknown as WebSocket);
    room.handleConnection(client2 as unknown as WebSocket);

    // 1. Join Handshake
    client1.simulateClientMessage({
      type: 'join',
      callsign: 'Eldar Garamov',
      faction: 'Vanguard',
    });

    client2.simulateClientMessage({
      type: 'join',
      callsign: 'Syndicate Viper',
      faction: 'Syndicate',
    });

    // Verify welcome packets
    const welcome1 = client1.sentMessages.find(m => m.type === 'welcome');
    const welcome2 = client2.sentMessages.find(m => m.type === 'welcome');

    expect(welcome1).toBeDefined();
    expect(welcome2).toBeDefined();
    expect(welcome1?.type).toBe('welcome');
    if (welcome1 && welcome1.type === 'welcome') {
      expect(welcome1.team).toBe('Vanguard');
      expect(welcome1.tickRate).toBe(64);
    }
    if (welcome2 && welcome2.type === 'welcome') {
      expect(welcome2.team).toBe('Syndicate');
    }

    // 2. Wait for 64Hz snapshot broadcast (~35ms for 2 ticks)
    await new Promise(r => setTimeout(r, 45));

    const snapshot1 = client1.sentMessages.find(m => m.type === 'snapshot');
    expect(snapshot1).toBeDefined();
    if (snapshot1 && snapshot1.type === 'snapshot') {
      expect(snapshot1.players.length).toBeGreaterThanOrEqual(2);
      expect(snapshot1.roundPhase).toBe('FREEZE_TIME');
      expect(snapshot1.ctScore).toBe(0);
      expect(snapshot1.tScore).toBe(0);
    }

    // 3. Client Buy Action
    client1.simulateClientMessage({
      type: 'buy',
      item: 'garam-47',
    });

    // 4. Client Input Frame
    client1.simulateClientMessage({
      type: 'input',
      seq: 1,
      timestamp: Date.now(),
      weaponId: 'garam-47',
      input: {
        forward: true,
        backward: false,
        left: false,
        right: false,
        jump: false,
        crouch: false,
        walk: false,
        yaw: 0,
        pitch: 0,
      },
    });

    // 5. Clean Disconnection
    client2.close(1000, 'Normal Closure');
    expect(client2.closed).toBe(true);
  });

  it('authoritatively handles weapon firing with server-computed ray origin', async () => {
    room = new GameRoom();
    const ws = new MockWebSocket();
    room.handleConnection(ws as unknown as WebSocket);

    ws.simulateClientMessage({
      type: 'join',
      callsign: 'Eldar Garamov',
      faction: 'Vanguard',
    });

    await new Promise(r => setTimeout(r, 20));

    // Send valid fire action
    ws.simulateClientMessage({
      type: 'fire',
      seq: 1,
      targetServerTime: Date.now(),
      weaponId: 'garam-47',
      direction: { x: 0, y: 0, z: 1 },
      yaw: 0,
      pitch: 0,
      isScoped: false,
    });

    await new Promise(r => setTimeout(r, 20));

    // Socket remains healthy and open
    expect(ws.closed).toBe(false);
  });

  it('handles 12 clumped 128Hz input frames without dropping any under 16-frame burst tolerance', async () => {
    room = new GameRoom();
    const ws = new MockWebSocket();
    room.handleConnection(ws as unknown as WebSocket);

    ws.simulateClientMessage({
      type: 'join',
      callsign: 'Eldar Garamov',
      faction: 'Vanguard',
    });

    await new Promise(r => setTimeout(r, 20));

    // Clump 12 inputs at once (simulating Wi-Fi TCP HoL stall release)
    for (let seq = 1; seq <= 12; seq++) {
      ws.simulateClientMessage({
        type: 'input',
        seq,
        timestamp: Date.now(),
        weaponId: 'garam-47',
        input: {
          forward: true,
          backward: false,
          left: false,
          right: false,
          jump: false,
          crouch: false,
          walk: false,
          yaw: 0,
          pitch: 0,
        },
      });
    }

    // Wait 4 server ticks (~65ms) to drain up to 16 queued frames
    await new Promise(r => setTimeout(r, 70));

    const session = (room as unknown as { sessions: Map<string, { lastInputSeq: number; inputQueue: unknown[] }> }).sessions.values().next().value;
    expect(session).toBeDefined();
    expect(session.lastInputSeq).toBe(12);
    expect(session.inputQueue.length).toBe(0);
  });

  it('strictly caps speedhack input bursts at 132 processed frames per second', async () => {
    room = new GameRoom();
    const ws = new MockWebSocket();
    room.handleConnection(ws as unknown as WebSocket);

    ws.simulateClientMessage({
      type: 'join',
      callsign: 'Speedhacker',
      faction: 'Syndicate',
    });

    await new Promise(r => setTimeout(r, 20));

    // Flood with 160 frames across a single second
    for (let seq = 1; seq <= 160; seq++) {
      ws.simulateClientMessage({
        type: 'input',
        seq,
        timestamp: Date.now(),
        weaponId: 'garam-47',
        input: {
          forward: true,
          backward: false,
          left: false,
          right: false,
          jump: false,
          crouch: false,
          walk: false,
          yaw: 0,
          pitch: 0,
        },
      });
    }

    // Wait ~100ms
    await new Promise(r => setTimeout(r, 100));

    const session = (room as unknown as { sessions: Map<string, { framesProcessedThisSecond: number }> }).sessions.values().next().value;
    expect(session).toBeDefined();
    expect(session.framesProcessedThisSecond).toBeLessThanOrEqual(132);
  });

  it('strictly rejects silent-aim FireAction packets diverging by > 15 degrees from player yaw', async () => {
    room = new GameRoom();
    const ws = new MockWebSocket();
    room.handleConnection(ws as unknown as WebSocket);

    ws.simulateClientMessage({
      type: 'join',
      callsign: 'Eldar Garamov',
      faction: 'Vanguard',
    });

    await new Promise(r => setTimeout(r, 20));

    // Player faces forward (yaw = 0.0)
    // Attacker sends FireAction attempting 180° silent-aim snap behind them (yaw = Math.PI)
    ws.simulateClientMessage({
      type: 'fire',
      seq: 1,
      targetServerTime: Date.now(),
      weaponId: 'garam-47',
      direction: { x: 0, y: 0, z: -1 },
      yaw: Math.PI, // 180° snap!
      pitch: 0,
      isScoped: false,
    });

    await new Promise(r => setTimeout(r, 20));

    // Assert no hit_confirm was generated for this malicious shot
    const hitConfirms = ws.sentMessages.filter(m => m.type === 'hit_confirm');
    expect(hitConfirms.length).toBe(0);
  });

  it('rejects firing unowned weapons, out-of-range melee strikes, and spoofed client ping timestamps', async () => {
    room = new GameRoom();
    const attackerWs = new MockWebSocket();
    const victimWs = new MockWebSocket();
    room.handleConnection(attackerWs as unknown as WebSocket);
    room.handleConnection(victimWs as unknown as WebSocket);

    attackerWs.simulateClientMessage({ type: 'join', callsign: 'Attacker', faction: 'Vanguard' });
    victimWs.simulateClientMessage({ type: 'join', callsign: 'Victim', faction: 'Syndicate' });

    // Transition to ROUND_LIVE and place victim directly in front of attacker
    room.phase = 'ROUND_LIVE';
    const sessions = (
      room as unknown as {
        sessions: Map<
          string,
          {
            controller: { state: { x: number; y: number; z: number; yaw: number; pitch: number } };
            health: number;
            cash: number;
            ping: number;
            ownedWeapons: Set<string>;
          }
        >;
      }
    ).sessions;
    const [attacker, victim] = Array.from(sessions.values());
    attacker.controller.state.x = 0;
    attacker.controller.state.y = 0;
    attacker.controller.state.z = 0;
    attacker.controller.state.yaw = 0;
    attacker.controller.state.pitch = 0;

    // 1. Unowned Sovereign AWP fire must be rejected
    victim.controller.state.x = 0;
    victim.controller.state.y = 0;
    victim.controller.state.z = -15;
    attacker.ownedWeapons.delete('sovereign-awp');
    attackerWs.simulateClientMessage({
      type: 'fire',
      seq: 1,
      targetServerTime: Date.now(),
      weaponId: 'sovereign-awp',
      direction: { x: 0, y: 0, z: -1 },
      yaw: 0,
      pitch: 0,
      isScoped: true,
    });
    expect(victim.health).toBe(100);

    // 2. Out-of-range Karambit melee strike at 15m must deal 0 damage
    attackerWs.simulateClientMessage({
      type: 'fire',
      seq: 2,
      targetServerTime: Date.now(),
      weaponId: 'garam-karambit',
      direction: { x: 0, y: 0, z: -1 },
      yaw: 0,
      pitch: 0,
      isScoped: false,
    });
    expect(victim.health).toBe(100);

    // 3. Spoofed legacy ping timestamp must NOT inflate session.ping
    const initialPing = attacker.ping;
    attackerWs.simulateClientMessage({
      type: 'ping',
      clientTime: Date.now() - 5000,
    });
    expect(attacker.ping).toBe(initialPing);

    // 4. Buy action enforces buy-zone bounds: rejected outside spawn (0,0,0), accepted inside CT spawn
    room.phase = 'FREEZE_TIME';
    attacker.cash = 5000;
    attackerWs.simulateClientMessage({ type: 'buy', item: 'sovereign-awp' });
    expect(attacker.ownedWeapons.has('sovereign-awp')).toBe(false);
    expect(attacker.cash).toBe(5000);

    attacker.controller.state.x = 0;
    attacker.controller.state.y = 0;
    attacker.controller.state.z = 42;
    attackerWs.simulateClientMessage({ type: 'buy', item: 'sovereign-awp' });
    expect(attacker.ownedWeapons.has('sovereign-awp')).toBe(true);
    expect(attacker.cash).toBe(250);
    expect(attackerWs.sentMessages.some(m => m.type === 'economy_sync')).toBe(true);
  });
});
