import { WebSocketServer, WebSocket } from 'ws';

const PORT = 2567;
const wss = new WebSocketServer({ port: PORT });

console.log(`[GARAM Server] Authoritative 64-Tick Server listening on ws://localhost:${PORT}`);

interface ClientState {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
}

const clients = new Map<string, { ws: WebSocket; state: ClientState }>();

wss.on('connection', (ws) => {
  const id = `player_${Math.random().toString(36).substring(2, 9)}`;
  const state: ClientState = {
    id,
    x: 0,
    y: 0,
    z: 30,
    yaw: 0,
    pitch: 0,
    health: 100,
  };

  clients.set(id, { ws, state });
  console.log(`[GARAM Server] Player connected: ${id} (Total: ${clients.size})`);

  ws.send(JSON.stringify({ type: 'init', id, state }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'input') {
        state.x = msg.x;
        state.y = msg.y;
        state.z = msg.z;
        state.yaw = msg.yaw;
        state.pitch = msg.pitch;
      }
    } catch {
      // Ignore invalid packet
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    console.log(`[GARAM Server] Player disconnected: ${id} (Total: ${clients.size})`);
  });
});

// 64-Tick broadcast loop (15.625ms)
setInterval(() => {
  if (clients.size === 0) return;

  const playerList: ClientState[] = [];
  clients.forEach((c) => playerList.push(c.state));

  const packet = JSON.stringify({ type: 'state', players: playerList, timestamp: Date.now() });
  clients.forEach((c) => {
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(packet);
    }
  });
}, 1000 / 64);
