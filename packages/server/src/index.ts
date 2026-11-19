import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GameRoom } from './GameRoom.js';

const PORT = Number(process.env.PORT) || 2567;
const MAX_CONNECTIONS = 32;
const MAX_MESSAGES_PER_SEC = 150;

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : []),
]);

function isOriginAllowed(originHeader?: string): boolean {
  if (!originHeader) return true; // Allow non-browser clients, automated test suites, curl
  try {
    const originUrl = new URL(originHeader).origin;
    return ALLOWED_ORIGINS.has(originUrl);
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', activeClients: wss.clients.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 4096, // 4KB hard cap against memory exhaustion
  perMessageDeflate: false, // Prevents zip bomb CPU exhaustion
});

const gameRoom = new GameRoom();

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (origin && !isOriginAllowed(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  if (wss.clients.size >= MAX_CONNECTIONS) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws: WebSocket) => {
  // Token-bucket rate limiter per socket
  let messageCount = 0;
  let windowStart = Date.now();

  const rateLimitCheck = (): boolean => {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      messageCount = 0;
      windowStart = now;
    }
    messageCount++;
    if (messageCount > MAX_MESSAGES_PER_SEC) {
      console.warn(`[GARAM Security] Rate limit exceeded by socket. Terminating with code 1008.`);
      ws.close(1008, 'Rate limit exceeded');
      return false;
    }
    return true;
  };

  gameRoom.handleConnection(ws, rateLimitCheck);
});

server.listen(PORT, () => {
  console.log(`[GARAM Server] Authoritative 64-Tick Server running on ws://localhost:${PORT}`);
});

export { server, wss, gameRoom };
