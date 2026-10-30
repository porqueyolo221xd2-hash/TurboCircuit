// Protocolo compartido entre el cliente del juego y el servidor de salas.
// Este archivo no importa Three.js ni APIs de Node: se puede usar en ambos
// entornos y en las pruebas.

export const PROTOCOL_VERSION = 1;

// Sin caracteres ambiguos: no hay 0/O ni 1/I/L.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

export const DEFAULT_MAX_PLAYERS = 4;
export const MAX_PLAYERS_LIMIT = 8;
export const MIN_PLAYERS = 1;

export const ONLINE_MAPS = ['coast', 'mountain', 'city', 'neon', 'canyon', 'orbital'];
export const ONLINE_KARTS = ['rayo', 'centella', 'lira', 'titan'];
// En online solo se usan objetos de efecto inmediato. Minas y proyectiles
// necesitarían una simulación continua en el servidor y quedan fuera de esta
// versión para no mostrar una sincronización que no sería real.
export const ONLINE_ITEM_POOL = ['IMPULSO', 'BARRERA', 'PULSO'];

export const COUNTDOWN_MS = 4200;
export const STATE_INTERVAL_MS = 50; // 20 Hz
export const STANDINGS_INTERVAL_MS = 250; // 4 Hz
export const RACE_TICK_MS = 100;
export const BOX_RESPAWN_MS = 5000;
export const PICKUP_RADIUS = 2.1;
export const PICKUP_COOLDOWN_MS = 600;
export const ITEM_COOLDOWN_MS = 700;
export const DISCONNECT_GRACE_MS = 15000;
export const EMPTY_ROOM_TTL_MS = 30000;
export const MAX_RACE_MS = 8 * 60 * 1000;
export const FINISH_GRACE_MS = 60000;

export const ERRORS = {
  INVALID_CODE: 'invalid-code',
  ROOM_NOT_FOUND: 'room-not-found',
  ROOM_FULL: 'room-full',
  RACE_STARTED: 'race-started',
  NAME_TAKEN: 'name-taken',
  INVALID_NAME: 'invalid-name',
  INVALID_MAP: 'invalid-map',
  INVALID_KART: 'invalid-kart',
  NOT_HOST: 'not-host',
  NOT_IN_ROOM: 'not-in-room',
  ALREADY_IN_ROOM: 'already-in-room',
  RATE_LIMITED: 'rate-limited',
  BAD_STATE: 'bad-state',
  NO_ITEM: 'no-item',
  NOT_ACTIVE: 'not-active',
  SERVER_ERROR: 'server-error',
};

const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** Limpia un código pegado por el usuario: mayúsculas y sin separadores. */
export function normalizeRoomCode(value) {
  if (typeof value !== 'string') return '';
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(value) {
  return typeof value === 'string' && ROOM_CODE_RE.test(value);
}

/** Nombre visible: sin controles, espacios colapsados y máximo 16 caracteres. */
export function sanitizeName(value) {
  if (typeof value !== 'string') return '';
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, 16).join('');
}

export function isValidName(value) {
  const name = sanitizeName(value);
  return name.length >= 1 && name.length <= 16;
}

export function isValidMap(value) {
  return ONLINE_MAPS.includes(value);
}

export function isValidKart(value) {
  return ONLINE_KARTS.includes(value);
}

export function isValidItem(value) {
  return ONLINE_ITEM_POOL.includes(value);
}

function finite(value, min, max) {
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

/**
 * Sanea un snapshot de kart enviado por un cliente. Devuelve null si faltan
 * los campos imprescindibles. El servidor no confía en lap/finished: usan su
 * propia proyección y checkpoints.
 */
export function sanitizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = finite(raw.x, -20000, 20000);
  const z = finite(raw.z, -20000, 20000);
  const gy = finite(raw.gy, -1000, 2000);
  const h = finite(raw.h, 0, 100);
  const hd = finite(raw.hd, -Math.PI * 4, Math.PI * 4);
  const sp = finite(raw.sp, -60, 120);
  const st = finite(raw.st, -1, 1);
  if (x === null || z === null || gy === null || h === null || hd === null || sp === null) {
    return null;
  }
  return {
    x,
    z,
    gy,
    h,
    hd: normalizeAngle(hd),
    sp,
    st: st ?? 0,
    d: raw.d === true,
    t: raw.t === true,
    ab: raw.ab === true,
    og: raw.og === true,
    route: typeof raw.route === 'string' ? raw.route.slice(0, 48) : null,
    lap: Number.isInteger(raw.lap) ? Math.max(1, Math.min(10, raw.lap)) : 1,
    cp: Number.isInteger(raw.cp) ? Math.max(0, Math.min(65535, raw.cp)) : 0,
  };
}

/** Datos públicos de un participante (nunca socketId ni clientId). */
export function publicPlayer(player, hostId) {
  return {
    id: player.id,
    name: player.name,
    kartId: player.kartId,
    connected: player.connected !== false,
    isHost: player.id === hostId,
  };
}

/** Validación básica de un snapshot de red antes de usarlo en el cliente. */
export function isSnapshotMessage(message) {
  return Boolean(
    message &&
      typeof message === 'object' &&
      typeof message.id === 'string' &&
      Number.isFinite(message.x) &&
      Number.isFinite(message.z) &&
      Number.isFinite(message.hd),
  );
}
