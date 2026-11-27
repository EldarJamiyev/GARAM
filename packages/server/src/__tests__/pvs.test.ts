import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { GameRoom } from '../GameRoom.js';
import { ClientPacket, ServerPacket } from '@garam/shared';
import type { WebSocket } from 'ws';

class MockWebSocket extends EventEmitter {
  public readyState = 1; // WebSocket.OPEN
  public sentMessages: ServerPacket[] = [];
  public bufferedAmount = 0;

  public send(data: string | Buffer): void {
    try {
      this.sentMessages.push(JSON.parse(data.toString()));
    } catch {
      // Ignore
    }
  }

  public simulateClientMessage(packet: ClientPacket): void {
    this.emit('message', Buffer.from(JSON.stringify(packet)));
  }
}

describe('PVS (Potentially Visible Set) Anti-Wallhack Filtering', () => {
  let room: GameRoom;

  afterEach(() => {
    if (room) {
      room.stop();
    }
  });

  it('culls completely obstructed distant enemies behind concrete walls from client snapshots', () => {
    room = new GameRoom();
    const ctSpawn = room.getMapDescriptor().spawnPoints.VANGUARD_CT;

    const client = new MockWebSocket();
    room.handleConnection(client as unknown as WebSocket);

    // Join Vanguard CT Defender
    client.simulateClientMessage({
      type: 'join',
      callsign: 'CT Defender',
      faction: 'Vanguard',
    });

    // Run 1 authoritative tick
    (room as any).tickAuthoritative();

    const snaps = client.sentMessages.filter(m => m.type === 'snapshot');
    expect(snaps.length).toBeGreaterThan(0);
    const latestSnap = snaps[snaps.length - 1];

    // Check that Vanguard team players/bots are present
    const vanguardPlayers = latestSnap.players.filter((p: any) => p.team === 'Vanguard');
    expect(vanguardPlayers.length).toBeGreaterThanOrEqual(1);

    // Distant Syndicate enemies across the map behind concrete walls (> 45m away)
    // should be culled by PVS
    const distantEnemies = latestSnap.players.filter((p: any) => {
      if (p.team === 'Vanguard') return false;
      const dist = Math.hypot(p.x - ctSpawn.x, p.z - ctSpawn.z);
      return dist > 45;
    });

    expect(distantEnemies.length).toBe(0);
  });
});
