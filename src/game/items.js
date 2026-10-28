// Definiciones de los objetos originales de Turbo Circuit.
// Los nombres, iconos y efectos son propios de este proyecto.

export const ITEMS = {
  IMPULSO: {
    id: 'IMPULSO',
    name: 'IMPULSO',
    icon: '⚡',
    color: '#ffd23f',
    description: 'Aceleración extra durante un instante.',
    duration: 1.6,
    power: 0.3,
  },
  PULSO: {
    id: 'PULSO',
    name: 'PULSO',
    icon: '◉',
    color: '#5fe6ff',
    description: 'Onda que ralentiza a los karts cercanos.',
    radius: 16,
    slowFactor: 0.58,
    slowDuration: 1.3,
  },
  BARRERA: {
    id: 'BARRERA',
    name: 'BARRERA',
    icon: '⬡',
    color: '#77f06b',
    description: 'Reduce los efectos negativos durante unos segundos.',
    duration: 4.5,
    useHint: 'Pulsa E para protegerte',
  },
  MINA: {
    id: 'MINA',
    name: 'MINA',
    icon: '◈',
    color: '#ffb03a',
    description: 'Se suelta en la pista y explota al pasar un rival cerca.',
    useHint: 'Pulsa E para soltar una mina',
    // Se despliega detrás del kart y queda armada tras un instante.
    placeBehind: 2.7,
    armTime: 0.75,
    triggerRadius: 4.2,
    blastRadius: 7.6,
    life: 20,
    limit: 6,
    slowFactor: 0.4,
    slowDuration: 1.6,
    controlDuration: 0.65,
    controlStrength: 0.6,
    impactSpeedLoss: 0.74,
    // Empuje radial y salto pequeño para que la explosión se note sin ser injusta.
    push: 0.9,
    hop: 3.2,
    stunTime: 0.42,
  },
  // La FURIA reutiliza el sistema de proyectiles: lanza una ráfaga de tres
  // descargas de plasma con identidad visual propia y un aturdimiento potente.
  FURIA: {
    id: 'FURIA',
    name: 'FURIA',
    icon: '⚔',
    color: '#c66bff',
    description: 'Ráfaga de plasma que desestabiliza y aturde a los rivales.',
    useHint: 'Pulsa E para desatar la furia',
    speed: 58,
    range: 46,
    life: 0.95,
    radius: 0.48,
    hitRadius: 2.2,
    slowFactor: 0.5,
    slowDuration: 1.5,
    controlDuration: 1.2,
    controlStrength: 0.68,
    impactSpeedLoss: 0.86,
    stunTime: 1.3,
    volley: 3,
    spread: 0.075,
    trail: 1.6,
  },
  PULSO_IMPACTO: {
    id: 'PULSO_IMPACTO',
    name: 'PULSO DE IMPACTO',
    icon: '✹',
    color: '#ff5f8f',
    description: 'Proyectil de energía que desestabiliza y aturde al rival que golpea.',
    useHint: 'Pulsa E para disparar',
    // El proyectil no sigue al kart: estos valores se fijan al disparar.
    // Velocidad alta con alcance y vida coherentes (62 × 0.94 ≈ 58 m).
    speed: 62,
    range: 56,
    life: 0.94,
    radius: 0.42,
    hitRadius: 2.1,
    slowFactor: 0.56,
    slowDuration: 1.35,
    controlDuration: 0.8,
    controlStrength: 0.52,
    impactSpeedLoss: 0.88,
    stunTime: 0.85,
    trail: 1,
  },
};

export const ITEM_ORDER = ['IMPULSO', 'PULSO', 'BARRERA', 'MINA', 'FURIA', 'PULSO_IMPACTO'];

// Pesos de aparición. Los objetos nuevos son menos frecuentes que los básicos
// para que no monopolicen las cajas (14 % entre MINA y FURIA).
export const ITEM_WEIGHTS = {
  IMPULSO: 26,
  PULSO: 19,
  BARRERA: 19,
  PULSO_IMPACTO: 22,
  MINA: 8,
  FURIA: 6,
};

const ITEM_WEIGHT_TOTAL = ITEM_ORDER.reduce(
  (total, id) => total + (ITEM_WEIGHTS[id] ?? 0),
  0,
);

/** Devuelve un objeto aleatorio ponderado (sin dependencias externas). */
export function randomItem(random = Math.random) {
  let roll = random() * ITEM_WEIGHT_TOTAL;
  for (const id of ITEM_ORDER) {
    roll -= ITEM_WEIGHTS[id] ?? 0;
    if (roll < 0) return id;
  }
  return ITEM_ORDER[ITEM_ORDER.length - 1];
}
