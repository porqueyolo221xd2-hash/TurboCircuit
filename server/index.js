// Arranque del servidor de salas de Turbo Circuit.
//
// Variables de entorno (todas opcionales en local):
//   PORT=3001
//   HOST=0.0.0.0
//   CLIENT_ORIGIN=*            (en producción: https://tu-cliente.example)
//   MAX_PLAYERS=4
//   SERVE_CLIENT=1             (sirve dist/ en el mismo servicio)
//   COUNTDOWN_MS=4200          (cuenta atrás de la carrera)
//   DISCONNECT_GRACE_MS=15000  (margen para reconectar)
//   EMPTY_ROOM_TTL_MS=30000    (sala vacía que se conserva antes de borrarse)
//   FINISH_GRACE_MS=60000      (espera tras el primer clasificado)
//   MAX_RACE_MS=480000         (duración máxima de una carrera)
import { createGameServer } from './app.js';
import {
  COUNTDOWN_MS,
  DISCONNECT_GRACE_MS,
  EMPTY_ROOM_TTL_MS,
  FINISH_GRACE_MS,
  MAX_RACE_MS,
} from '../shared/protocol.js';

/** Entero positivo de entorno; si falta o no es válido, usa el valor por defecto. */
function envMs(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '0.0.0.0';
const clientOrigin = process.env.CLIENT_ORIGIN || '*';
const maxPlayers = Number(process.env.MAX_PLAYERS) || 4;
const serveClient = process.env.SERVE_CLIENT !== '0';
const countdownMs = envMs('COUNTDOWN_MS', COUNTDOWN_MS);
const disconnectGraceMs = envMs('DISCONNECT_GRACE_MS', DISCONNECT_GRACE_MS);
const emptyRoomTtlMs = envMs('EMPTY_ROOM_TTL_MS', EMPTY_ROOM_TTL_MS);
const finishGraceMs = envMs('FINISH_GRACE_MS', FINISH_GRACE_MS);
const maxRaceMs = envMs('MAX_RACE_MS', MAX_RACE_MS);

if (clientOrigin === '*' && process.env.NODE_ENV === 'production') {
  console.warn(
    'CLIENT_ORIGIN no está definido: se aceptan todos los orígenes. ' +
      'En producción fíjalo a la URL exacta del cliente (por ejemplo, la que asigne Render).',
  );
}

const server = createGameServer({
  port,
  host,
  clientOrigin,
  maxPlayers,
  serveClient,
  countdownMs,
  disconnectGraceMs,
  emptyRoomTtlMs,
  finishGraceMs,
  maxRaceMs,
});

try {
  await server.listen(port, host);
  console.log(`Turbo Circuit · servidor de salas en http://localhost:${port}`);
  console.log(`Salud: http://localhost:${port}/health · máximo ${server.rooms.maxPlayers} jugadores/sala`);
  if (!serveClient) {
    console.log('Cliente estático desactivado (SERVE_CLIENT=0): usa Vite en el puerto 5173.');
  }
} catch (error) {
  console.error('No se pudo iniciar el servidor de salas:', error);
  process.exitCode = 1;
}

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n${signal}: cerrando salas...`);
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
