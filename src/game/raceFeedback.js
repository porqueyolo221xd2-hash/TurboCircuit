// Lógica pura de feedback de carrera: adelantamientos reales e intensidades.
//
// La detección se apoya en la clasificación (posiciones reales), nunca en la
// cámara. Exige que la mejora se mantenga unos instantes y aplica un cooldown
// por rival para que dos karts que se intercambian no generen avisos en bucle.
import { clamp } from './utils.js';

export const OVERTAKE_DEFAULTS = {
  hold: 0.32,
  cooldown: 2.4,
};

function positionOf(standings, kart) {
  const index = standings.indexOf(kart);
  return index >= 0 ? index + 1 : standings.length + 1;
}

export class OvertakeTracker {
  constructor({ hold = OVERTAKE_DEFAULTS.hold, cooldown = OVERTAKE_DEFAULTS.cooldown } = {}) {
    this.hold = Math.max(0, hold);
    this.cooldown = Math.max(0, cooldown);
    this.time = 0;
    this.position = 0;
    this.pending = null;
    this.cooldowns = new Map();
    this.ready = false;
  }

  /** Se llama al empezar una carrera o al recolocar la parrilla. */
  reset(standings = [], kart = null) {
    this.time = 0;
    this.position = kart ? positionOf(standings, kart) : 0;
    this.pending = null;
    this.cooldowns.clear();
    this.ready = Boolean(kart);
  }

  /**
   * Devuelve `{ gained, position, rivals }` una sola vez por adelantamiento
   * confirmado, o null si no hay nada que anunciar.
   */
  update(standings, kart, dt = 1 / 60) {
    if (!this.ready || !kart) return null;
    this.time += Math.max(0, dt);
    const position = positionOf(standings, kart);
    const previous = this.position;
    this.position = position;

    // Solo interesa mejorar. Al perder posición se cancela la confirmación.
    if (position > previous) {
      this.pending = null;
      return null;
    }
    if (position === previous) return this.confirm(dt);

    // Rivales que han quedado por detrás con esta mejora. El jugador ocupa
    // ahora el índice position-1; los adelantados empiezan justo después.
    const rivals = standings.slice(position, previous);
    this.pending = {
      position,
      previous,
      rivals,
      elapsed: 0,
    };
    return this.confirm(dt);
  }

  /** Avanza la confirmación pendiente. También se puede llamar sin cambios. */
  tick(dt = 1 / 60) {
    if (!this.pending) return null;
    return this.confirm(dt);
  }

  confirm(dt) {
    const pending = this.pending;
    if (!pending) return null;
    pending.elapsed += Math.max(0, dt);
    // Revalidar: si la posición ya no se mantiene, no hay adelantamiento.
    if (this.position !== pending.position) {
      this.pending = null;
      return null;
    }
    if (pending.elapsed < this.hold) return null;

    this.pending = null;
    const fresh = pending.rivals.filter((rival) => {
      const last = this.cooldowns.get(rival) ?? -Infinity;
      return this.time - last >= this.cooldown;
    });
    if (fresh.length === 0) return null;
    for (const rival of fresh) this.cooldowns.set(rival, this.time);
    return {
      gained: pending.rivals.length,
      position: pending.position,
      rivals: fresh,
    };
  }
}

/**
 * Intensidad visual del derrape (0..1). Depende del deslizamiento real, no de
 * mantener pulsado el botón. Se usa para humo y audio continuo.
 */
export function driftIntensity(kart) {
  if (!kart?.driftActive) return 0;
  const speedRatio = clamp(Math.abs(kart.speed) / Math.max(1, kart.maxSpeed), 0, 1);
  const slip = clamp(Math.abs(kart.driftSlip ?? 0) / 0.3, 0, 1);
  const charge = clamp((kart.driftCharge ?? 0) / 1.1, 0, 1);
  return clamp(speedRatio * 0.45 + slip * 0.4 + charge * 0.25, 0, 1);
}

/** Intensidad restante del turbo (0..1) para estela, cámara y audio. */
export function turboIntensity(kart) {
  if (!kart?.turboActive || !(kart.turboDuration > 0)) return 0;
  return clamp(kart.turboTime / kart.turboDuration, 0, 1);
}
