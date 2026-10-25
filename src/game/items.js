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
  PULSO_IMPACTO: {
    id: 'PULSO_IMPACTO',
    name: 'PULSO DE IMPACTO',
    icon: '✹',
    color: '#ff5f8f',
    description: 'Proyectil de energía que desestabiliza al rival que golpea.',
    useHint: 'Pulsa E para disparar',
    // El proyectil no sigue al kart: estos valores se fijan al disparar.
    speed: 44,
    range: 52,
    life: 1.6,
    radius: 0.42,
    hitRadius: 2,
    slowFactor: 0.56,
    slowDuration: 1.35,
    controlDuration: 0.7,
    controlStrength: 0.5,
    impactSpeedLoss: 0.88,
  },
};

export const ITEM_ORDER = ['IMPULSO', 'PULSO', 'BARRERA', 'PULSO_IMPACTO'];

/** Devuelve un objeto aleatorio (sin dependencias externas). */
export function randomItem(random = Math.random) {
  const index = Math.min(ITEM_ORDER.length - 1, Math.floor(random() * ITEM_ORDER.length));
  return ITEM_ORDER[index];
}
