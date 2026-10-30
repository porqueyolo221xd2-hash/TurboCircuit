// Progreso del jugador: monedas, karts y circuitos desbloqueados.
//
// Todo vive en localStorage bajo una única clave (`turbo-circuit-progress-v1`).
// Las claves antiguas (`turbo-circuit-kart-v1` y `turbo-circuit-map-v1`) NO se
// usan para conceder desbloqueos: la versión anterior a la economía no tenía
// compras, así que no hay ninguna compra legítima que migrar desde ellas. Solo
// se conservan los desbloqueos que ya estén dentro del perfil v1. Las claves
// antiguas no se leen, no se sobrescriben y no se borran.
//
// Un perfil v1 solo puede contener como compra legítima un objeto cuyo precio
// no supere `stats.coinsEarned` (las monedas solo entran ganando carreras y ese
// contador es acumulativo). Si un perfil antiguo trae un objeto más caro que
// todo lo ganado, ese desbloqueo vino de la migración antigua —que confundía
// el mapa seleccionado con un mapa comprado— y se retira al sanear.
//
// Reglas de economía (centralizadas aquí, no repartidas por la interfaz):
//   • Solo se gana dinero al quedar primero.
//   • Una carrera paga una sola vez: Game marca la recompensa como cobrada.
//   • Ningún saldo puede quedar negativo ni contener NaN.
//   • No hay cuentas, servidores ni pagos: todo es local.
import { DEFAULT_KART, KART_ORDER, isKart } from './karts.js';
import { DEFAULT_MAP, MAP_ORDER, isMap } from './maps.js';

export const PROGRESS_KEY = 'turbo-circuit-progress-v1';
/** Copia de seguridad del texto corrupto antes de reparar el perfil. */
export const CORRUPT_BACKUP_KEY = 'turbo-circuit-progress-v1.corrupt';
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

function cleanCount(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

/**
 * Deja solo identificadores válidos, sin duplicados y en el orden canónico.
 * Añade siempre el contenido de serie: Rayo y Costa no pueden perderse.
 */
function ownedList(list, order, starters) {
  const owned = new Set();
  if (Array.isArray(list)) {
    for (const id of list) {
      if (typeof id === 'string' && order.includes(id)) owned.add(id);
    }
  }
  for (const id of starters) owned.add(id);
  return order.filter((id) => owned.has(id));
}

/**
 * Convierte cualquier dato guardado en un perfil válido. Si algo no cuadra se
 * repara campo a campo en lugar de descartar la partida: el jugador conserva
 * sus monedas y sus compras, y como mínimo mantiene Rayo, Costa y saldo ≥ 0.
 * Nunca concede desbloqueos que no estén ya en el perfil.
 */
export function sanitizeProgress(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return createNewProgress();

  const profile = createNewProgress();
  profile.coins = cleanCoins(raw.coins);
  profile.karts = ownedList(raw.karts, KART_ORDER, STARTING_KARTS);
  profile.maps = ownedList(raw.maps, MAP_ORDER, STARTING_MAPS);

  const stats = raw.stats && typeof raw.stats === 'object' && !Array.isArray(raw.stats)
    ? raw.stats
    : null;
  const earnedRaw = stats ? Number(stats.coinsEarned) : Number.NaN;
  // Solo se usa como prueba de compra si el perfil trae el contador. Si falta
  // o está dañado se conservan los desbloqueos para no borrar compras reales.
  const hasEarnedEvidence = Number.isFinite(earnedRaw) && earnedRaw >= 0;
  if (hasEarnedEvidence) {
    const earned = cleanCount(earnedRaw);
    profile.karts = profile.karts.filter((id) => (KART_PRICES[id] ?? 0) <= earned);
    profile.maps = profile.maps.filter((id) => (MAP_PRICES[id] ?? 0) <= earned);
  }

  profile.stats = {
    races: cleanCount(stats?.races),
    wins: cleanCount(stats?.wins),
    coinsEarned: cleanCount(stats?.coinsEarned),
  };

  const kart = typeof raw.selectedKart === 'string' ? raw.selectedKart : null;
  profile.selectedKart =
    kart && profile.karts.includes(kart) ? kart : DEFAULT_KART;
  const map = typeof raw.selectedMap === 'string' ? raw.selectedMap : null;
  profile.selectedMap = map && profile.maps.includes(map) ? map : DEFAULT_MAP;

  return profile;
}

/** Guarda una copia del texto corrupto antes de reparar el perfil. */
function backupCorrupt(target, text) {
  if (!target || typeof text !== 'string' || !text) return;
  try {
    target.setItem(CORRUPT_BACKUP_KEY, text);
  } catch {
    // Si tampoco se puede escribir la copia, no se bloquea el arranque.
  }
}

/**
 * Lee el perfil guardado. Si el JSON está dañado, guarda una copia del texto
 * original en `turbo-circuit-progress-v1.corrupt` y devuelve un perfil seguro.
 * No escribe nada por su cuenta: el guardado solo ocurre cuando el jugador
 * compra, equipa o termina una carrera.
 */
export function loadProgress(storage = null) {
  const target = resolveStorage(storage);
  if (!target) return createNewProgress();

  let text = null;
  try {
    text = target.getItem(PROGRESS_KEY);
  } catch {
    return createNewProgress();
  }
  if (!text) return createNewProgress();

  let raw = null;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    backupCorrupt(target, text);
    return createNewProgress();
  }
  return sanitizeProgress(raw);
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

/**
 * Comprobación única para arrancar una carrera: el kart y el circuito deben
 * estar comprados en el perfil. No basta con que sean los ids seleccionados ni
 * con que existan en la lista de contenido.
 */
export function ownsLoadout(progress, kartId, mapId) {
  return ownsKart(progress, kartId) && ownsMap(progress, mapId);
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

/** Precio de un objeto válido; 0 si no existe. */
export function priceOf(kind, id) {
  if (kind === 'kart') return isKart(id) ? kartPrice(id) : 0;
  if (kind === 'map') return isMap(id) ? mapPrice(id) : 0;
  return 0;
}

/** Monedas que faltan para comprar un objeto (0 si ya se tiene). */
export function missingCoins(progress, kind, id) {
  const owned = kind === 'kart' ? ownsKart(progress, id) : ownsMap(progress, id);
  if (owned) return 0;
  const price = priceOf(kind, id);
  return Math.max(0, price - cleanCoins(progress?.coins));
}

/** Victorias (en esa dificultad) que cuestan un objeto. Sirve para orientar. */
export function winsNeeded(price, difficulty) {
  const reward = coinsFor(difficulty);
  if (!reward || price <= 0) return 0;
  return Math.ceil(price / reward);
}

/**
 * Compra un kart o un circuito. Devuelve un motivo legible cuando falla para
 * que la interfaz pueda explicarlo sin inventarse el resultado. La operación
 * se aplica una sola vez: si ya está comprado, no vuelve a cobrar.
 */
export function purchase(progress, kind, id) {
  if (!progress || typeof progress !== 'object') {
    return { ok: false, code: 'no-progress', reason: 'No hay partida guardada.' };
  }
  if (kind !== 'kart' && kind !== 'map') {
    return { ok: false, code: 'bad-kind', reason: 'Ese tipo de objeto no existe.' };
  }
  const valid = kind === 'kart' ? isKart(id) : isMap(id);
  if (!valid) {
    return { ok: false, code: 'unknown', reason: 'Ese objeto no existe.' };
  }

  const owned = kind === 'kart' ? progress.karts : progress.maps;
  if (!Array.isArray(owned)) {
    return { ok: false, code: 'bad-profile', reason: 'El perfil guardado no es válido.' };
  }
  if (owned.includes(id)) {
    return { ok: false, code: 'owned', reason: 'Ya lo tienes desbloqueado.' };
  }

  const price = priceOf(kind, id);
  const coins = cleanCoins(progress.coins);
  if (coins < price) {
    const missing = price - coins;
    return {
      ok: false,
      code: 'insufficient',
      missing,
      reason: `Te faltan ${missing} monedas.`,
    };
  }

  progress.coins = coins - price;
  owned.push(id);
  return { ok: true, code: 'purchased', price, coins: progress.coins, missing: 0 };
}

/** Selecciona contenido ya desbloqueado; si no lo está, no cambia nada. */
export function selectKart(progress, id) {
  if (!progress || !isKart(id) || !progress.karts?.includes(id)) return false;
  progress.selectedKart = id;
  return true;
}

export function selectMap(progress, id) {
  if (!progress || !isMap(id) || !progress.maps?.includes(id)) return false;
  progress.selectedMap = id;
  return true;
}

/** Suma una recompensa validada. No permite saldos negativos ni NaN. */
export function grantCoins(progress, amount) {
  if (!progress || typeof progress !== 'object') return 0;
  const value = cleanCoins(amount);
  progress.coins = cleanCoins(cleanCoins(progress.coins) + value);
  if (!progress.stats || typeof progress.stats !== 'object') {
    progress.stats = { races: 0, wins: 0, coinsEarned: 0 };
  }
  progress.stats.coinsEarned = cleanCount(progress.stats.coinsEarned) + value;
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
