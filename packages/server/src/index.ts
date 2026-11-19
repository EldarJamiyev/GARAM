import { WebSocketServer } from 'ws';
import { GameRoom } from './GameRoom.js';

const PORT = 2567;
const wss = new WebSocketServer({ port: PORT });
const gameRoom = new GameRoom();

console.log(`[GARAM Server] Authoritative 64-Tick Server running on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  gameRoom.handleConnection(ws);
});
