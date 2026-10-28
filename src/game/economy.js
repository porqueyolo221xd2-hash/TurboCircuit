// Progreso del jugador: monedas, karts y circuitos desbloqueados.
//
// Todo vive en localStorage bajo una única clave nueva. Las claves antiguas
// (`turbo-circuit-kart-v1` y `turbo-circuit-map-v1`) solo se leen una vez para
// migrar la selección: nunca se sobrescriben ni se borran.
//
// Reglas de economía (centralizadas aquí, no repartidas por la interfaz):
//   • Solo se gana dinero al quedar primero.
//   • Una carrera paga una sola vez: Game marca la recompensa como cobrada.
//   • No hay cuentas, servidores ni pagos: todo es local.
import { DEFAULT_KART, getKart, isKart, loadKartId } from './karts.js';
import { DEFAULT_MAP, getMap, isMap, loadMapId } from './maps.js';

export const PROGRESS_KEY = 'turbo-circuit-progress-v1';
export const PROGRESS_VERSION = 1;

/** Monedas por victoria según dificultad. */
export const REWARDS = Object.freeze({ easy: 20, normal: 40, hard: 70 });

/** Precio de cada kart en monedas (0 = desbloqueado de serie). */
export const KART_PRICES = Object.freeze({
  rayo: 0,
  centella: 150,
  lira: 260,
  titan: 400,
});

/** Precio de cada circuito en monedas (0 = desbloqueado de serie). */
export const MAP_PRICES = Object.freeze({
  coast: 0,
  mountain: 120,
  city: 220,
  neon: 320,
  canyon: 440,
  orbital: 560,
});

export const STARTING_KARTS = Object.freeze(['rayo']);
export const STARTING_MAPS = Object.freeze(['coast']);

const MAX_COINS = 9_999_999;

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Algunos navegadores bloquean localStorage en modo privado.
  }
  return null;
}

/** Perfil nuevo: un kart, un circuito y cero monedas. */
export function createNewProgress() {
  return {
    version: PROGRESS_VERSION,
    coins: 0,
    karts: [...STARTING_KARTS],
    maps: [...STARTING_MAPS],
    selectedKart: DEFAULT_KART,
    selectedMap: DEFAULT_MAP,
    stats: { races: 0, wins: 0, coinsEarned: 0 },
  };
}

function cleanCoins(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(MAX_COINS, Math.floor(number)));
}

function uniqueValid(list, predicate) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  for (const id of list) {
    if (typeof id === 'string' && predicate(id)) seen.add(id);
  }
  return [...seen];
}

/**
 * Convierte cualquier dato guardado en un perfil válido. Si algo no cuadra se
 * repara en lugar de descartar la partida: el jugador nunca pierde monedas por
 * un campo corrupto.
 */
export function sanitizeProgress(raw, legacy = {}) {
  const profile = createNewProgress();
  if (!raw || typeof raw !== 'object') {
    return applyLegacy(profile, legacy);
  }

  profile.coins = cleanCoins(raw.coins);
  profile.karts = uniqueValid(raw.karts, isKart);
  profile.maps = uniqueValid(raw.maps, isMap);

  // Los desbloqueos de serie nunca se pierden.
  for (const id of STARTING_KARTS) if (!profile.karts.includes(id)) profile.karts.push(id);
  for (const id of STARTING_MAPS) if (!profile.maps.includes(id)) profile.maps.push(id);

  const stats = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  profile.stats = {
    races: Math.max(0, Math.floor(Number(stats.races) || 0)),
    wins: Math.max(0, Math.floor(Number(stats.wins) || 0)),
    coinsEarned: Math.max(0, Math.floor(Number(stats.coinsEarned) || 0)),
  };

  const kart = typeof raw.selectedKart === 'string' ? raw.selectedKart : null;
  profile.selectedKart = kart && profile.karts.includes(kart) ? kart : profile.karts[0];
  const map = typeof raw.selectedMap === 'string' ? raw.selectedMap : null;
  profile.selectedMap = map && profile.maps.includes(map) ? map : profile.maps[0];

  return applyLegacy(profile, legacy, false);
}

/**
 * Migración desde las claves antiguas. Si el jugador tenía elegido un kart o un
 * circuito que ahora cuesta monedas, se le regala el desbloqueo: es la
 * compensación documentada para no romper su partida anterior. Las monedas
 * empiezan en 0.
 */
function applyLegacy(profile, legacy, preferLegacy = true) {
  if (legacy.kart && isKart(legacy.kart)) {
    if (!profile.karts.includes(legacy.kart)) profile.karts.push(legacy.kart);
    if (preferLegacy || !profile.selectedKart) profile.selectedKart = legacy.kart;
  }
  if (legacy.map && isMap(legacy.map)) {
    if (!profile.maps.includes(legacy.map)) profile.maps.push(legacy.map);
    if (preferLegacy || !profile.selectedMap) profile.selectedMap = legacy.map;
  }
  if (!profile.karts.includes(profile.selectedKart)) profile.selectedKart = profile.karts[0];
  if (!profile.maps.includes(profile.selectedMap)) profile.selectedMap = profile.maps[0];
  return profile;
}

/** Lee el perfil guardado, migrando las claves antiguas si hace falta. */
export function loadProgress(storage = null) {
  const target = resolveStorage(storage);
  const legacy = {};
  try {
    legacy.kart = loadKartId(target);
    legacy.map = loadMapId(target);
  } catch {
    // Sin acceso a las claves antiguas se sigue con los valores por defecto.
  }
  if (!target) return sanitizeProgress(null, legacy);

  let raw = null;
  try {
    const text = target.getItem(PROGRESS_KEY);
    if (text) raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  return sanitizeProgress(raw, legacy);
}

/** Guarda el perfil. Devuelve false si el navegador no deja escribir. */
export function saveProgress(progress, storage = null) {
  const target = resolveStorage(storage);
  if (!target || !progress) return false;
  try {
    target.setItem(PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

export function ownsKart(progress, id) {
  return Boolean(progress?.karts?.includes(id));
}

export function ownsMap(progress, id) {
  return Boolean(progress?.maps?.includes(id));
}

export function coinsFor(difficulty) {
  return REWARDS[difficulty] ?? 0;
}

export function kartPrice(id) {
  return KART_PRICES[id] ?? 0;
}

export function mapPrice(id) {
  return MAP_PRICES[id] ?? 0;
}

/** Victorias (en esa dificultad) que cuestan un objeto. Sirve para orientar. */
export function winsNeeded(price, difficulty) {
  const reward = coinsFor(difficulty);
  if (!reward || price <= 0) return 0;
  return Math.ceil(price / reward);
}

/**
 * Compra un kart o un circuito. Devuelve un motivo legible cuando falla para
 * que la interfaz pueda explicarlo sin inventarse el resultado.
 */
export function purchase(progress, kind, id) {
  if (!progress) return { ok: false, reason: 'No hay partida guardada.' };
  const isKartKind = kind === 'kart';
  const valid = isKartKind ? isKart(id) : isMap(id);
  if (!valid) return { ok: false, reason: 'Ese objeto no existe.' };

  const owned = isKartKind ? progress.karts : progress.maps;
  if (owned.includes(id)) return { ok: false, reason: 'Ya lo tienes desbloqueado.' };

  const price = isKartKind ? kartPrice(id) : mapPrice(id);
  if (progress.coins < price) {
    return { ok: false, reason: `Te faltan ${price - progress.coins} monedas.` };
  }

  progress.coins -= price;
  owned.push(id);
  return { ok: true, price, coins: progress.coins };
}

/** Selecciona contenido ya desbloqueado; si no lo está, no cambia nada. */
export function selectKart(progress, id) {
  if (!progress || !isKart(id) || !progress.karts.includes(id)) return false;
  progress.selectedKart = id;
  return true;
}

export function selectMap(progress, id) {
  if (!progress || !isMap(id) || !progress.maps.includes(id)) return false;
  progress.selectedMap = id;
  return true;
}

/** Suma una recompensa validada. No permite saldos negativos ni NaN. */
export function grantCoins(progress, amount) {
  if (!progress) return 0;
  const value = cleanCoins(amount);
  progress.coins = cleanCoins(progress.coins + value);
  progress.stats.coinsEarned += value;
  return value;
}

/** Etiqueta corta del estado de un objeto para la tienda. */
export function itemState(progress, kind, id) {
  const owned = kind === 'kart' ? ownsKart(progress, id) : ownsMap(progress, id);
  if (!owned) return 'locked';
  const selected =
    kind === 'kart' ? progress.selectedKart === id : progress.selectedMap === id;
  return selected ? 'equipped' : 'owned';
}

/** Texto de ayuda con las victorias necesarias en cada dificultad. */
export function priceHint(price) {
  if (price <= 0) return 'Incluido';
  const easy = winsNeeded(price, 'easy');
  const normal = winsNeeded(price, 'normal');
  const hard = winsNeeded(price, 'hard');
  return `${easy} victorias en fácil · ${normal} en normal · ${hard} en difícil`;
}

export { getKart, getMap };
