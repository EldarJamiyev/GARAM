import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GameRoom } from './GameRoom.js';
import { RoomRegistry } from './RoomRegistry.js';

const PORT = Number(process.env.PORT) || 2567;
const MAX_CONNECTIONS = 32;
const MAX_CONNS_PER_IP = 3;
const MAX_MESSAGES_PER_SEC = 150;

const ipConnCounts = new Map<string, number>();

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : []),
]);

export function isPrivateOrLocalHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  // 10.0.0.0 - 10.255.255.255
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  // 172.16.0.0 - 172.31.255.255
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  // 192.168.0.0 - 192.168.255.255
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

export function isOriginAllowed(originHeader?: string): boolean {
  if (!originHeader) return true; // Allow non-browser clients, automated test suites, curl
  try {
    const originUrl = new URL(originHeader);
    if (ALLOWED_ORIGINS.has(originUrl.origin)) return true;
    if (isPrivateOrLocalHost(originUrl.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

function getClientIp(req: http.IncomingMessage): string {
  if (process.env.TRUST_PROXY === 'true') {
    const flyClientIp = req.headers['fly-client-ip'];
    if (typeof flyClientIp === 'string') return flyClientIp.trim();
    const cfConnectingIp = req.headers['cf-connecting-ip'];
    if (typeof cfConnectingIp === 'string') return cfConnectingIp.trim();
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

const roomRegistry = new RoomRegistry();
const gameRoom = roomRegistry.getOrCreate('GRM-CITADEL').room;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      activeClients: wss.clients.size,
      activeRooms: roomRegistry.getRoomCount(),
    }));
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

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (origin && !isOriginAllowed(origin)) {
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

  wss.handleUpgrade(req, socket, head, (ws) => {
    ipConnCounts.set(clientIp, currentCount + 1);
    ws.on('close', () => {
      const remaining = (ipConnCounts.get(clientIp) || 1) - 1;
      if (remaining <= 0) {
        ipConnCounts.delete(clientIp);
      } else {
        ipConnCounts.set(clientIp, remaining);
      }
    });
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

  // 5,000ms unauthenticated join timeout
  let hasJoined = false;
  const joinTimer = setTimeout(() => {
    if (!hasJoined && ws.readyState === WebSocket.OPEN) {
      console.warn('[GARAM Security] Socket failed to transmit valid join packet in 5000ms. Closing with 4001.');
      ws.close(4001, 'Join timeout');
    }
  }, 5000);

  const originalOn = ws.on.bind(ws);
  ws.on = function (event: string, listener: (...args: unknown[]) => void) {
    if (event === 'message') {
      const wrapped = (...args: unknown[]) => {
        try {
          const parsed = JSON.parse(args[0]?.toString() || '{}');
          if (parsed.type === 'join') {
            hasJoined = true;
            clearTimeout(joinTimer);
          }
        } catch {}
        return listener(...args);
      };
      return originalOn(event as any, wrapped as any);
    }
    return originalOn(event as any, listener as any);
  } as any;

  ws.on('close', () => {
    clearTimeout(joinTimer);
  });

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const roomCode = url.searchParams.get('room') || 'GRM-CITADEL';
  const { room } = roomRegistry.getOrCreate(roomCode);
  room.handleConnection(ws, rateLimitCheck);
});

// 15,000ms heartbeat reaper to terminate half-open sockets
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    const socket = client as MonitoredSocket;
    if (socket.isAlive === false) {
      console.warn('[GARAM Security] Terminating unresponsive half-open socket.');
      return socket.terminate();
    }
    socket.isAlive = false;
    socket.ping();
  });
}, 15000);
heartbeatInterval.unref();

server.listen(PORT, () => {
  console.log(`[GARAM Server] Authoritative 64-Tick Server running on ws://localhost:${PORT}`);
});

export { server, wss, gameRoom, roomRegistry };
