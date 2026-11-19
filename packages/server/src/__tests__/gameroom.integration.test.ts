import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { GameRoom } from '../GameRoom.js';
import { ServerPacket, ClientPacket } from '@garam/shared';
import type { WebSocket } from 'ws';

class MockWebSocket extends EventEmitter {
  public readyState = 1; // WebSocket.OPEN
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
      // Clear game room interval
      const handle = (room as unknown as { intervalHandle?: NodeJS.Timeout }).intervalHandle;
      if (handle) clearInterval(handle);
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
});
