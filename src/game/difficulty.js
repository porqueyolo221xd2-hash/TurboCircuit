// Dificultades del juego. No cambian solo la velocidad: ajustan la conducción,
// la agresividad, los errores, la recuperación y la estrategia con objetos.
export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    label: 'FÁCIL',
    description: 'Rivales lentos y prudentes. Ideal para aprender el circuito y ganar con margen.',
    pace: 0.9,
    acceleration: 0.98,
    brake: 0.96,
    turn: 0.96,
    cornerSpeed: 1.14,
    cornerCaution: 1.2,
    minCornerFactor: 0.28,
    lookAheadBias: 1.8,
    anticipation: 0.9,
    apexLine: 0.15,
    driftChance: 0.12,
    aggression: 0.5,
    precision: 0.84,
    mistakeChance: 1.45,
    mistakeAmplitude: 1.12,
    recoveryThreshold: 0.95,
    recoveryTime: 0.82,
    driftCharge: 1.4,
    driftTurbo: 0.09,
    itemDelay: 1.3,
    impulseChance: 0.45,
    pulseChance: 0.45,
    barrierChance: 0.45,
    projectileChance: 0.22,
    projectileRange: 19,
    projectileAngle: 0.16,
    projectileAimMargin: 1.5,
    projectileCooldown: 4.2,
    rubberBandStrength: 0.35,
    rubberBandDivisor: 4200,
    rubberBandMin: 0.975,
    rubberBandMax: 1.02,
  },
  normal: {
    id: 'normal',
    label: 'NORMAL',
    description: 'Ritmo equilibrado, adelantamientos razonables y uso moderado de objetos.',
    pace: 1.02,
    acceleration: 1.05,
    brake: 1.04,
    turn: 1.02,
    cornerSpeed: 0.94,
    cornerCaution: 0.97,
    minCornerFactor: 0.38,
    lookAheadBias: 0.6,
    anticipation: 1.06,
    apexLine: 0.55,
    driftChance: 0.55,
    aggression: 1,
    precision: 1.02,
    mistakeChance: 0.8,
    mistakeAmplitude: 0.9,
    recoveryThreshold: 1.05,
    recoveryTime: 0.92,
    driftCharge: 1.8,
    driftTurbo: 0.07,
    itemDelay: 0.95,
    impulseChance: 0.7,
    pulseChance: 0.7,
    barrierChance: 0.7,
    projectileChance: 0.55,
    projectileRange: 24,
    projectileAngle: 0.2,
    projectileAimMargin: 2.1,
    projectileCooldown: 2.6,
    rubberBandStrength: 0.7,
    rubberBandDivisor: 3000,
    rubberBandMin: 0.96,
    rubberBandMax: 1.05,
  },
  hard: {
    id: 'hard',
    label: 'DIFÍCIL',
    description: 'Rivales rápidos y precisos, con mejor trazada y decisiones más agresivas.',
    pace: 1.07,
    acceleration: 1.12,
    brake: 1.14,
    turn: 1.08,
    cornerSpeed: 0.82,
    cornerCaution: 0.94,
    minCornerFactor: 0.48,
    lookAheadBias: 1.8,
    anticipation: 1.3,
    apexLine: 0.95,
    driftChance: 0.95,
    aggression: 1.3,
    precision: 1.12,
    mistakeChance: 0.28,
    mistakeAmplitude: 0.65,
    recoveryThreshold: 0.85,
    recoveryTime: 0.78,
    driftCharge: 2.2,
    driftTurbo: 0.05,
    itemDelay: 0.68,
    impulseChance: 0.92,
    pulseChance: 0.92,
    barrierChance: 0.95,
    projectileChance: 0.9,
    projectileRange: 32,
    projectileAngle: 0.25,
    projectileAimMargin: 3,
    projectileCooldown: 1.5,
    rubberBandStrength: 0.85,
    rubberBandDivisor: 2400,
    rubberBandMin: 0.955,
    rubberBandMax: 1.06,
  },
};

export const DIFFICULTY_ORDER = ['easy', 'normal', 'hard'];
export const DEFAULT_DIFFICULTY = 'normal';
const STORAGE_KEY = 'turbo-circuit-difficulty-v1';

export function isDifficulty(value) {
  return Object.prototype.hasOwnProperty.call(DIFFICULTIES, value);
}

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Algunos navegadores bloquean localStorage en modo privado.
  }
  return null;
}

/** Devuelve una dificultad válida guardada o el valor seguro por defecto. */
export function loadDifficulty(storage = null) {
  const target = resolveStorage(storage);
  if (!target) return DEFAULT_DIFFICULTY;
  try {
    const saved = target.getItem(STORAGE_KEY);
    return isDifficulty(saved) ? saved : DEFAULT_DIFFICULTY;
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}

/** Guarda la dificultad validada; si no se puede, la partida sigue funcionando. */
export function saveDifficulty(id, storage = null) {
  if (!isDifficulty(id)) return false;
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}
