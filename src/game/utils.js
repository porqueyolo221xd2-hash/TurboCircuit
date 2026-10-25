// Utilidades matemáticas y de formato compartidas.

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const lerp = (a, b, t) => a + (b - a) * t;

/** Interpolación exponencial estable, independiente de los FPS. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Diferencia más corta entre dos ángulos (radianes). */
export function angleDiff(from, to) {
  let d = (to - from + Math.PI) % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return d - Math.PI;
}

export function lerpAngle(from, to, t) {
  return from + angleDiff(from, to) * t;
}

/** Formatea segundos como mm:ss.mmm. */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const ms = Math.floor((seconds % 1) * 1000);
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** Generador pseudoaleatorio con semilla: el circuito decora igual en cada carga. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
