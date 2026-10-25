// Karts jugables y rivales de Turbo Circuit.
// Cada kart tiene física propia, silueta propia y una ficha de estadísticas
// normalizada (0-100) para mostrarla en el menú.
// Ningún kart es mejor en todo: velocidad, agarre, aceleración y estabilidad
// se compensan entre sí.

export const PLAYER_KARTS = [
  {
    id: 'rayo',
    name: 'Rayo',
    color: 0xff6a1a,
    accent: 0xffd23f,
    bodyStyle: 'standard',
    mass: 1,
    maxSpeed: 31,
    acceleration: 18,
    brakePower: 38,
    turnRate: 2.4,
    reverseMax: 8,
    tagline: 'El equilibrado',
    description: 'Rápido, noble y fácil de leer. No destaca en nada, pero no falla en nada.',
    stats: { speed: 70, acceleration: 74, grip: 76, stability: 74 },
  },
  {
    id: 'centella',
    name: 'Centella',
    color: 0xff3d6e,
    accent: 0xffd23f,
    bodyStyle: 'speedster',
    mass: 0.9,
    maxSpeed: 33.6,
    acceleration: 17,
    brakePower: 33.5,
    turnRate: 2.2,
    reverseMax: 8,
    tagline: 'La veloz',
    description: 'Punta altísima y morro largo, pero frena tarde y se mueve en las curvas rápidas.',
    stats: { speed: 94, acceleration: 76, grip: 56, stability: 50 },
  },
  {
    id: 'lira',
    name: 'Lira',
    color: 0x2fe0a4,
    accent: 0xd8fff2,
    bodyStyle: 'agile',
    mass: 0.94,
    maxSpeed: 28.4,
    acceleration: 21,
    brakePower: 42,
    turnRate: 2.72,
    reverseMax: 8,
    tagline: 'La ágil',
    description: 'Entra en cualquier curva y sale antes que nadie, pero pierde en las rectas largas.',
    stats: { speed: 58, acceleration: 92, grip: 94, stability: 66 },
  },
  {
    id: 'titan',
    name: 'Titán',
    color: 0x4b6fff,
    accent: 0xa9c8ff,
    bodyStyle: 'heavy',
    mass: 1.24,
    maxSpeed: 30.6,
    acceleration: 14.2,
    brakePower: 37,
    turnRate: 2.24,
    reverseMax: 8,
    tagline: 'El pesado',
    description: 'Acelera despacio, pero aguanta los empujones y no se descoloca en los roces.',
    stats: { speed: 72, acceleration: 52, grip: 66, stability: 96 },
  },
];

// Rivales de la IA: conservan sus personalidades y ahora también su silueta.
export const AI_KARTS = [
  {
    id: 'vega',
    name: 'Vega',
    color: 0xbd3bff,
    accent: 0xffa4f3,
    bodyStyle: 'speedster',
    mass: 0.95,
    maxSpeed: 30.4,
    acceleration: 17,
    brakePower: 35,
    turnRate: 2.22,
    reverseMax: 8,
    aiProfile: {
      lane: -2.4,
      lookAheadBias: 3.5,
      cornerSpeed: 0.42,
      cornerCaution: 0.9,
      aggression: 0.6,
      precision: 0.82,
      mistakeChance: 0.08,
    },
  },
  {
    id: 'nilo',
    name: 'Nilo',
    color: 0x12c7d8,
    accent: 0xc4fbff,
    bodyStyle: 'agile',
    mass: 0.98,
    maxSpeed: 29.4,
    acceleration: 19.6,
    brakePower: 43,
    turnRate: 2.6,
    reverseMax: 8,
    aiProfile: {
      lane: 2.4,
      lookAheadBias: 0.5,
      cornerSpeed: 0.36,
      cornerCaution: 1.02,
      aggression: 0.35,
      precision: 1.05,
      mistakeChance: 0.015,
    },
  },
  {
    id: 'musgo',
    name: 'Musgo',
    color: 0x82ce3d,
    accent: 0xfff0a1,
    bodyStyle: 'heavy',
    mass: 1.12,
    maxSpeed: 29.6,
    acceleration: 18.2,
    brakePower: 38,
    turnRate: 2.46,
    reverseMax: 8,
    aiProfile: {
      lane: 0.4,
      lookAheadBias: -1.5,
      cornerSpeed: 0.4,
      cornerCaution: 0.94,
      aggression: 1.05,
      precision: 0.92,
      mistakeChance: 0.2,
    },
  },
];

export const KART_ORDER = PLAYER_KARTS.map((kart) => kart.id);
export const DEFAULT_KART = 'rayo';
const STORAGE_KEY = 'turbo-circuit-kart-v1';

export function isKart(value) {
  return PLAYER_KARTS.some((kart) => kart.id === value);
}

export function getKart(id) {
  return PLAYER_KARTS.find((kart) => kart.id === id) ?? PLAYER_KARTS[0];
}

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Navegadores en modo privado pueden bloquear localStorage.
  }
  return null;
}

export function loadKartId(storage = null) {
  const target = resolveStorage(storage);
  if (!target) return DEFAULT_KART;
  try {
    const saved = target.getItem(STORAGE_KEY);
    return isKart(saved) ? saved : DEFAULT_KART;
  } catch {
    return DEFAULT_KART;
  }
}

export function saveKartId(id, storage = null) {
  if (!isKart(id)) return false;
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}
