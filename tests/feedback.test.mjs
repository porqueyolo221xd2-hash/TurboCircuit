// Pruebas del feedback de carrera: adelantamientos con histéresis/cooldown e
// intensidades puras usadas por efectos, audio y cámara.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OvertakeTracker,
  driftIntensity,
  turboIntensity,
} from '../src/game/raceFeedback.js';

const A = { id: 'a' };
const B = { id: 'b' };
const C = { id: 'c' };

/** Avanza el tracker manteniendo la misma clasificación durante `seconds`. */
function hold(tracker, standings, kart, seconds, dt = 1 / 60) {
  let result = null;
  const steps = Math.max(1, Math.round(seconds / dt));
  for (let i = 0; i < steps; i += 1) {
    const next = tracker.update(standings, kart, dt);
    if (next) result = next;
  }
  return result;
}

test('detecta un adelantamiento real tras mantener la posición', () => {
  const tracker = new OvertakeTracker({ hold: 0.25, cooldown: 2 });
  tracker.reset([B, C, A], A); // el jugador es 3º

  assert.equal(tracker.update([B, A, C], A, 0.1), null, 'aún no se confirma');
  assert.equal(tracker.update([B, A, C], A, 0.1), null, 'hace falta mantener la posición');
  const event = tracker.update([B, A, C], A, 0.12);
  assert.ok(event, 'debería confirmarse el adelantamiento');
  assert.equal(event.position, 2);
  assert.equal(event.gained, 1);
  assert.deepEqual(event.rivals, [C]);
});

test('no avisa si el kart recupera la posición perdida antes de confirmar', () => {
  const tracker = new OvertakeTracker({ hold: 0.3, cooldown: 2 });
  tracker.reset([B, C, A], A);

  tracker.update([B, A, C], A, 0.1); // sube a 2º
  tracker.update([B, C, A], A, 0.1); // vuelve a 3º: cancela
  assert.equal(hold(tracker, [B, C, A], A, 0.5), null);
});

test('el cooldown evita repetir el aviso en intercambios constantes', () => {
  const tracker = new OvertakeTracker({ hold: 0.15, cooldown: 10 });
  tracker.reset([B, C, A], A);

  const first = hold(tracker, [B, A, C], A, 0.3);
  assert.ok(first, 'el primer adelantamiento sí avisa');

  // B y A se intercambian varias veces dentro del cooldown.
  for (let i = 0; i < 4; i += 1) {
    tracker.update([B, C, A], A, 0.1);
    assert.equal(hold(tracker, [B, A, C], A, 0.3), null, 'no debe repetir el aviso');
  }
});

test('pasado el cooldown, un nuevo adelantamiento vuelve a avisar', () => {
  const tracker = new OvertakeTracker({ hold: 0.15, cooldown: 1 });
  tracker.reset([B, C, A], A);
  assert.ok(hold(tracker, [B, A, C], A, 0.3));

  tracker.update([B, C, A], A, 0.05);
  hold(tracker, [B, C, A], A, 1.1); // deja pasar el cooldown
  const event = hold(tracker, [B, A, C], A, 0.3);
  assert.ok(event, 'tras el cooldown el aviso se reactiva');
});

test('perder posición nunca genera aviso de adelantamiento', () => {
  const tracker = new OvertakeTracker({ hold: 0.1, cooldown: 1 });
  tracker.reset([A, B, C], A);
  assert.equal(hold(tracker, [B, A, C], A, 0.5), null);
});

test('reset limpia la posición y los cooldowns', () => {
  const tracker = new OvertakeTracker({ hold: 0.1, cooldown: 5 });
  tracker.reset([B, C, A], A);
  assert.ok(hold(tracker, [B, A, C], A, 0.2));

  tracker.reset([B, C, A], A);
  assert.ok(hold(tracker, [B, A, C], A, 0.2), 'tras reset vuelve a avisar');
});

test('las intensidades son seguras y proporcionales', () => {
  assert.equal(driftIntensity(null), 0);
  assert.equal(driftIntensity({ driftActive: false, speed: 20 }), 0);
  const mild = driftIntensity({
    driftActive: true,
    speed: 10,
    maxSpeed: 30,
    driftSlip: 0.05,
    driftCharge: 0.1,
  });
  const strong = driftIntensity({
    driftActive: true,
    speed: 30,
    maxSpeed: 30,
    driftSlip: 0.3,
    driftCharge: 1.1,
  });
  assert.ok(mild > 0 && mild < strong);
  assert.ok(strong <= 1);

  assert.equal(turboIntensity({ turboActive: false }), 0);
  assert.equal(turboIntensity({ turboActive: true, turboTime: 0.5, turboDuration: 1 }), 0.5);
  assert.equal(turboIntensity({ turboActive: true, turboTime: 2, turboDuration: 1 }), 1);
});
