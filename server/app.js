// Fábrica del servidor: HTTP estático + Socket.IO + salas en memoria.
//
// En local se puede usar solo para el multijugador (Vite sirve el cliente).
// En un alojamiento gratuito también puede servir dist/ y el socket en el
// mismo origen, evitando CORS.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import {
  COUNTDOWN_MS,
  DEFAULT_MAX_PLAYERS,
  DISCONNECT_GRACE_MS,
  EMPTY_ROOM_TTL_MS,
  RACE_TICK_MS,
} from '../shared/protocol.js';
import { RoomManager } from './roomManager.js';
import { createStaticHandler } from './static.js';

// Orígenes locales aceptados siempre para no romper Vite (5173/5174) ni la
// vista previa (4173). Un navegador remoto no puede falsificar su cabecera
// Origin y este servidor no usa cookies ni credenciales.
const LOCAL_DEV_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://[::1]:5174',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://[::1]:4173',
]);

/** Normaliza un origen http(s) y descarta valores inválidos o rutas. */
function normalizeOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function createGameServer({
  port = 0,
  host = '0.0.0.0',
  clientOrigin = '*',
  maxPlayers = DEFAULT_MAX_PLAYERS,
  countdownMs = COUNTDOWN_MS,
  disconnectGraceMs = DISCONNECT_GRACE_MS,
  emptyRoomTtlMs = EMPTY_ROOM_TTL_MS,
  finishGraceMs,
  maxRaceMs,
  raceTickMs = RACE_TICK_MS,
  serveClient = true,
  distDir = resolve('dist'),
  now = Date.now,
  random = Math.random,
  logger = console,
} = {}) {
  const staticHandler = createStaticHandler({
    root: distDir,
    enabled: serveClient,
  });

  // `*` mantiene el comportamiento abierto del desarrollo local. En producción
  // se recomienda fijar CLIENT_ORIGIN al origen exacto del cliente.
  const allowAllOrigins = !clientOrigin || clientOrigin.trim() === '*';
  const configuredOrigins = allowAllOrigins
    ? []
    : [...new Set(clientOrigin.split(',').map(normalizeOrigin).filter(Boolean))];
  const allowedOrigins = allowAllOrigins
    ? true
    : [...new Set([...configuredOrigins, ...LOCAL_DEV_ORIGINS])];

  if (!allowAllOrigins && configuredOrigins.length === 0) {
    logger.warn?.(
      'CLIENT_ORIGIN no contiene orígenes http(s) válidos; solo se aceptarán el mismo origen y localhost.',
    );
  }

  /** El mismo origen siempre es válido, aunque Host venga de un proxy. */
  function isSameOrigin(req, origin) {
    const host = req.headers.host;
    if (!host) return false;
    try {
      return new URL(origin).host.toLowerCase() === String(host).toLowerCase();
    } catch {
      return false;
    }
  }

  function isAllowedOrigin(req) {
    if (allowAllOrigins) return true;
    const raw = req.headers.origin;
    // Clientes Node (pruebas y herramientas) no envían Origin.
    if (!raw) return true;
    const origin = normalizeOrigin(raw);
    if (!origin) return false;
    return isSameOrigin(req, origin) || allowedOrigins.includes(origin);
  }

  // Se aplica a polling y al upgrade WebSocket: CORS por sí solo no protege
  // las conexiones WebSocket.
  function allowRequest(req, callback) {
    if (isAllowedOrigin(req)) return callback(null, true);
    logger.warn?.(`Origen rechazado: ${req.headers.origin} (revisa CLIENT_ORIGIN)`);
    return callback(null, false);
  }

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') {
        const text = JSON.stringify({
          ok: true,
          service: 'turbo-circuit-rooms',
          uptime: Math.round(process.uptime()),
          ...rooms.stats(),
          maxPlayers: rooms.maxPlayers,
        });
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(text);
        return;
      }
      await staticHandler(req, res);
    } catch (error) {
      logger.error?.('Error HTTP:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ ok: false, error: 'server-error' }));
    }
  });

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: false,
    },
    allowRequest,
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 10_000,
    pingTimeout: 20_000,
    transports: ['websocket', 'polling'],
  });

  const rooms = new RoomManager({
    io,
    maxPlayers,
    countdownMs,
    disconnectGraceMs,
    emptyRoomTtlMs,
    finishGraceMs,
    maxRaceMs,
    now,
    random,
  });

  io.on('connection', (socket) => {
    rooms.attachSocket(socket);
  });

  const tickTimer = setInterval(() => {
    try {
      rooms.tick(now());
    } catch (error) {
      logger.error?.('Error en el tick de carreras:', error);
    }
  }, raceTickMs);
  if (typeof tickTimer.unref === 'function') tickTimer.unref();

  let listening = false;
  let closed = false;

  function listen(listenPort = port, listenHost = host) {
    return new Promise((resolvePromise, reject) => {
      const onError = (error) => {
        httpServer.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        httpServer.off('error', onError);
        listening = true;
        resolvePromise(httpServer.address());
      };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(listenPort, listenHost);
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(tickTimer);
    rooms.dispose();
    await new Promise((resolvePromise) => {
      io.close(() => resolvePromise());
    });
    if (listening) {
      await new Promise((resolvePromise) => {
        httpServer.close(() => resolvePromise());
      });
    }
  }

  return {
    httpServer,
    io,
    rooms,
    listen,
    close,
    get port() {
      const address = httpServer.address();
      return typeof address === 'object' && address ? address.port : port;
    },
  };
}
