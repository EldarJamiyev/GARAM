import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { validateClientPacket } from '@garam/shared';
import { RoomRegistry } from './RoomRegistry.js';

const rawPort = process.env.GARAM_SERVER_PORT || process.env.WS_PORT || process.env.PORT;
const parsedPort = Number(rawPort);
const nginxPort = Number(process.env.NGINX_PORT);
const PORT =
  Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort !== nginxPort && parsedPort !== 3000
    ? parsedPort
    : 2567;
const MAX_CONNECTIONS = 32;
const MAX_CONNS_PER_IP = 3;
const TOKEN_BUCKET_CAPACITY = 240;
const TOKEN_BUCKET_REFILL_PER_SEC = 175;
const TRUSTED_PROXY_HOPS = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);

const ipConnCounts = new Map<string, number>();

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : []),
]);

const ALLOWED_DEV_PORTS = new Set(['', '80', '443', '3000', '4173', '5173', '2567']);

export function isPrivateOrLocalHost(hostname: string): boolean {
  const cleanHost = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (cleanHost === 'localhost' || cleanHost === '127.0.0.1' || cleanHost === '::1') return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanHost)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(cleanHost)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(cleanHost)) return true;
  // IPv6 ULA (fc00::/7) and Link-Local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/i.test(cleanHost) || /^fe[89ab][0-9a-f]:/i.test(cleanHost)) return true;
  return false;
}

export function isOriginAllowed(originHeader?: string): boolean {
  if (!originHeader) {
    return process.env.NODE_ENV !== 'production';
  }
  try {
    const originUrl = new URL(originHeader);
    if (ALLOWED_ORIGINS.has(originUrl.origin)) return true;
    if (isPrivateOrLocalHost(originUrl.hostname) && ALLOWED_DEV_PORTS.has(originUrl.port)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function getClientIp(req: http.IncomingMessage): string {
  if (process.env.TRUST_PROXY === 'true') {
    const flyClientIp = req.headers['fly-client-ip'];
    if (typeof flyClientIp === 'string' && flyClientIp.trim().length > 0) return flyClientIp.trim();
    const cfConnectingIp = req.headers['cf-connecting-ip'];
    if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim().length > 0) return cfConnectingIp.trim();
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const parts = forwarded
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (parts.length > 0) {
        // Select rightmost untrusted hop (prevents client-side X-Forwarded-For left-spoofing)
        const idx = Math.max(0, parts.length - TRUSTED_PROXY_HOPS);
        return parts[idx];
      }
    }
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

function decrementIpCount(clientIp: string): void {
  const remaining = (ipConnCounts.get(clientIp) || 1) - 1;
  if (remaining <= 0) {
    ipConnCounts.delete(clientIp);
  } else {
    ipConnCounts.set(clientIp, remaining);
  }
}

const roomRegistry = new RoomRegistry();
const gameRoom = roomRegistry.getOrCreate('GRM-CITADEL').room;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        activeClients: wss.clients.size,
        activeRooms: roomRegistry.getRoomCount(),
      })
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 2048, // 2KB hard cap against memory exhaustion
  perMessageDeflate: false, // Prevents zip-bomb CPU exhaustion
});

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const clientIp = getClientIp(req);
  const currentCount = ipConnCounts.get(clientIp) || 0;
  if (currentCount >= MAX_CONNS_PER_IP) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  if (wss.clients.size >= MAX_CONNECTIONS) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  // Reserve slot atomically BEFORE async handleUpgrade to eliminate TOCTOU race
  ipConnCounts.set(clientIp, currentCount + 1);
  let released = false;
  const releaseSlot = () => {
    if (released) return;
    released = true;
    decrementIpCount(clientIp);
  };

  socket.once('error', releaseSlot);

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.once('close', releaseSlot);
    ws.once('error', releaseSlot);
    wss.emit('connection', ws, req);
  });
});

interface MonitoredSocket extends WebSocket {
  isAlive?: boolean;
}

wss.on('connection', (ws: MonitoredSocket, req: http.IncomingMessage) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Smooth token-bucket rate limiter per socket (handles 128Hz bursts without false-positive disconnects)
  let tokens = TOKEN_BUCKET_CAPACITY;
  let lastRefillMs = Date.now();

  const rateLimitCheck = (): boolean => {
    const now = Date.now();
    const elapsedSec = Math.max(0, (now - lastRefillMs) / 1000);
    lastRefillMs = now;
    tokens = Math.min(TOKEN_BUCKET_CAPACITY, tokens + elapsedSec * TOKEN_BUCKET_REFILL_PER_SEC);
    if (tokens < 1) {
      ws.close(1008, 'Rate limit exceeded');
      return false;
    }
    tokens -= 1;
    return true;
  };

  // 5,000ms unauthenticated join timeout; room allocation is deferred until a validated `join` packet arrives
  let hasJoined = false;
  const joinTimer = setTimeout(() => {
    if (!hasJoined && ws.readyState === WebSocket.OPEN) {
      ws.close(4001, 'Join timeout');
    }
  }, 5000);

  const onJoined = () => {
    hasJoined = true;
    clearTimeout(joinTimer);
  };

  ws.once('close', () => {
    clearTimeout(joinTimer);
  });

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const roomCode = url.searchParams.get('room') || 'GRM-CITADEL';

  const onPendingMessage = (data: WebSocket.RawData) => {
    if (!rateLimitCheck()) return;
    try {
      const raw = JSON.parse(data.toString());
      const packet = validateClientPacket(raw);
      if (!packet || packet.type !== 'join') return;

      ws.off('message', onPendingMessage);
      onJoined();
      const { room } = roomRegistry.getOrCreate(roomCode);
      room.handleConnection(ws, rateLimitCheck, onJoined, packet);
    } catch {
      // Discard non-JSON or invalid pre-join frames
    }
  };

  ws.on('message', onPendingMessage);
});

// 15,000ms heartbeat reaper to terminate half-open sockets
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    const socket = client as MonitoredSocket;
    if (socket.isAlive === false) {
      return socket.terminate();
    }
    socket.isAlive = false;
    socket.ping();
  });
}, 15000);
heartbeatInterval.unref();

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(`[GARAM Server] HTTP/WS listen error on port ${PORT}:`, err.message);
});

server.listen(PORT, () => {
  console.log(`[GARAM Server] Authoritative 64-Tick Server running on ws://localhost:${PORT}`);
});

export { server, wss, gameRoom, roomRegistry };
