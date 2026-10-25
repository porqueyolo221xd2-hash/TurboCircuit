// Ajustes generales del juego.
// Todos los valores están pensados para una escala en "metros" dentro de Three.js.
export const CONFIG = {
  laps: 3,
  roadWidth: 18,
  shoulderWidth: 4.6, // césped transitable entre el asfalto y el muro
  wallHeight: 0.8,
  countdownStep: 0.9,
  kart: {
    maxSpeed: 31,
    acceleration: 18,
    brakePower: 38,
    coastDrag: 5.5,
    reverseMax: 8,
    reverseAcceleration: 14,
    turnRate: 2.4,
    offRoadSpeedFactor: 0.42,
    offRoadDrag: 22,
    wallLimitExtra: 0.35, // margen interior para no atravesar el muro
  },
  // Derrape y turbo: la carga solo sube derrapando de verdad (velocidad + giro).
  drift: {
    minSpeed: 7,
    chargeMax: 1.1,
    chargeLevel1: 0.45,
    chargeLevel2: 0.9,
    slipMax: 0.3,
    slipSpeed: 6.5,
    turnBoost: 1.3,
    drag: 0.09,
    shortDuration: 1.05,
    shortPower: 0.2,
    strongDuration: 1.8,
    strongPower: 0.34,
  },
  // Situación en la parrilla (distancia detrás de la línea de meta).
  grid: [
    { back: 9, lateral: -3.4 },
    { back: 9, lateral: 3.4 },
    { back: 16, lateral: -3.4 },
    { back: 17.5, lateral: 3.4 },
  ],
  camera: {
    distance: 9.6,
    height: 4.3,
    lookAhead: 6,
    lookHeight: 1.2,
    fov: 62,
  },
};
