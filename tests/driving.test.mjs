// Pruebas de comportamiento de la conducción: aceleración, frenada, dirección,
// reglas de carga del derrape, turbo único y cooldown.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Kart } from '../src/game/Kart.js';
import { CONFIG } from '../src/game/config.js';

const DT = 1 / 60;
const DRIFT = CONFIG.drift;

/** Pista recta y muy ancha: aísla la física del kart sin muros cercanos. */
function makeOpenTrack() {
  const length = 2000;
  return {
    length,
    halfWidth: 200,
    wallOffset: 220,
    posAt(s, lateral = 0) {
      return new THREE.Vector3(lateral, 0, ((s % length) + length) % length);
    },
    headingAt() {
      return 0;
    },
    project(position) {
      const s = ((position.z % length) + length) % length;
      return {
        s,
        lateral: position.x,
        centerX: 0,
        centerZ: s,
        sx: 1,
        sz: 0,
        tx: 0,
        tz: 1,
      };
    },
  };
}

function makeKart(overrides = {}) {
  return new Kart({
    id: 'test',
    name: 'Test',
    color: 0xffffff,
    accent: 0x101010,
    maxSpeed: 30,
    acceleration: 18,
    brakePower: 38,
    turnRate: 2.4,
    mass: 1,
    bodyStyle: 'standard',
    isPlayer: true,
    ...overrides,
  });
}

function place(kart, track) {
  kart.reset({ s: 400, back: 0, lateral: 0, track });
}

function run(kart, track, controls, steps, onStep = null) {
  for (let i = 0; i < steps; i += 1) {
    kart.step(DT, controls, track, i * DT);
    if (onStep) onStep(kart, i);
  }
}

/** Acelera hasta superar el mínimo de derrape. */
function reachSpeed(kart, track, target = 14) {
  let guard = 0;
  while (kart.speed < target && guard < 600) {
    kart.step(DT, { throttle: 1, brake: 0, steer: 0, drift: false }, track, guard * DT);
    guard += 1;
  }
  assert.ok(kart.speed >= target, `el kart debería alcanzar ${target} m/s`);
  return guard;
}

test('acelerar y frenar conservan el comportamiento original', () => {
  const track = makeOpenTrack();
  const kart = makeKart();
  place(kart, track);

  run(kart, track, { throttle: 1, brake: 0, steer: 0, drift: false }, 120);
  assert.ok(kart.speed > 10, 'debería acelerar con throttle');
  assert.ok(kart.position.z > 400, 'debería avanzar en la pista');

  const beforeBrake = kart.speed;
  run(kart, track, { throttle: 0, brake: 1, steer: 0, drift: false }, 30);
  assert.ok(kart.speed < beforeBrake, 'el freno debería reducir la velocidad');
});

test('girar cambia el rumbo y el kart sigue desplazándose', () => {
  const track = makeOpenTrack();
  const kart = makeKart();
  place(kart, track);
  reachSpeed(kart, track);
  const heading = kart.heading;
  const x = kart.position.x;
  run(kart, track, { throttle: 1, brake: 0, steer: 1, drift: false }, 45);
  assert.ok(Math.abs(kart.heading - heading) > 0.2, 'el volante debería girar el kart');
  assert.ok(Math.abs(kart.position.x - x) > 0.5, 'el giro debería mover el kart lateralmente');
});

test('el derrape se activa con velocidad + giro y termina al soltar', () => {
  const track = makeOpenTrack();
  const kart = makeKart();
  place(kart, track);
  reachSpeed(kart, track);

  run(kart, track, { throttle: 1, brake: 0, steer: 1, drift: true }, 20);
  assert.equal(kart.driftActive, true, 'debería derrapar');
  assert.ok(kart.driftCharge > 0, 'debería empezar a cargar');

  run(kart, track, { throttle: 1, brake: 0, steer: 0, drift: false }, 1);
  assert.equal(kart.driftActive, false, 'al soltar debería terminar el derrape');
  assert.equal(kart.driftCharge, 0, 'la carga se consume una sola vez');
});

test('no se carga derrape parado aunque se mantenga el botón', () => {
  const track = makeOpenTrack();
  const kart = makeKart();
  place(kart, track);

  run(kart, track, { throttle: 0, brake: 0, steer: 1, drift: true }, 120);
  assert.equal(kart.driftActive, false);
  assert.equal(kart.driftCharge, 0);
  assert.equal(kart.speed, 0);
});

test('no se carga derrape en recta sin giro real', () => {
  const track = makeOpenTrack();
  const kart = makeKart();
  place(kart, track);
  reachSpeed(kart, track);

  run(kart, track, { throttle: 1, brake: 0, steer: 0, drift: true }, 90);
  assert.equal(kart.driftActive, false);
  assert.equal(kart.driftCharge, 0);
});

test('la carga tiene un límite y no regala velocidad', () => {
  const track = makeOpenTrack();
  const kart = makeKart();
  place(kart, track);
  reachSpeed(kart, track);

  let maxCharge = 0;
  let maxSpeed = 0;
  run(kart, track, { throttle: 1, brake: 0, steer: 1, drift: true }, 600, (current) => {
    maxCharge = Math.max(maxCharge, current.driftCharge);
    maxSpeed = Math.max(maxSpeed, current.speed);
  });

  assert.ok(maxCharge <= DRIFT.chargeMax + 0.0001, 'la carga nunca supera chargeMax');
  assert.ok(maxCharge > 0.5, 'debería haber cargado de verdad');
  assert.ok(maxSpeed <= kart.maxSpeed * 1.02 + 0.0001, 'derrapar no da velocidad gratis');

  // Sin gas, el derrape roza y pierde velocidad: no es un impulso encubierto.
  const speedBefore = kart.speed;
  run(kart, track, { throttle: 0, brake: 0, steer: 1, drift: true }, 30);
  assert.ok(kart.speed < speedBefore, 'mantener derrape sin gas no acelera');
});

test('el derrape no carga mientras se roza el muro', () => {
  const track = makeOpenTrack();
  const kart = makeKart();
  place(kart, track);
  reachSpeed(kart, track);

  run(kart, track, { throttle: 1, brake: 0, steer: 1, drift: true }, 15);
  assert.equal(kart.driftActive, true);
  const charge = kart.driftCharge;
  assert.ok(charge > 0);

  // wallContact se evalúa antes de mover; forzarlo simula el roce de ese frame.
  kart.wallContact = true;
  kart.step(DT, { throttle: 1, brake: 0, steer: 1, drift: true }, track, 2);
  assert.equal(kart.driftCharge, charge, 'contra el muro no se acumula carga');
});

test('soltar con carga suficiente gasta un único turbo', () => {
  const track = makeOpenTrack();
  const kart = makeKart();
  place(kart, track);
  reachSpeed(kart, track);

  run(kart, track, { throttle: 1, brake: 0, steer: 1, drift: true }, 60);
  assert.ok(kart.driftCharge >= DRIFT.chargeLevel1, 'debería haber carga para el turbo corto');
  assert.ok(kart.driftCharge < DRIFT.chargeLevel2, 'con 1 s no debería llegar al turbo potente');

  kart.step(DT, { throttle: 1, brake: 0, steer: 0, drift: false }, track, 5);
  assert.equal(kart.turboActive, true);
  assert.equal(kart.turboLevel, 1);
  assert.equal(kart.turboJustActivated, true);
  assert.equal(kart.driftCharge, 0, 'el mismo evento no puede repetirse');

  const duration = kart.turboTime;
  kart.step(DT, { throttle: 1, brake: 0, steer: 0, drift: false }, track, 6);
  assert.equal(kart.turboJustActivated, false, 'solo se activa en un frame');
  assert.ok(kart.turboTime < duration, 'el turbo avanza una sola vez');

  // Con la carga a cero, volver a llamar a finishDrift no regala otro turbo.
  kart.endTurbo();
  kart.finishDrift(true);
  assert.equal(kart.turboActive, false, 'sin carga no hay turbo');
});

test('el turbo termina solo y deja un cooldown que corta el encadenado', () => {
  const track = makeOpenTrack();
  const kart = makeKart();
  place(kart, track);
  reachSpeed(kart, track);

  run(kart, track, { throttle: 1, brake: 0, steer: 1, drift: true }, 60);
  kart.step(DT, { throttle: 1, brake: 0, steer: 0, drift: false }, track, 5);
  assert.equal(kart.turboActive, true);

  // Mantener derrape durante el turbo no debe activar otro derrape.
  let ended = false;
  for (let i = 0; i < 200 && !ended; i += 1) {
    kart.step(DT, { throttle: 1, brake: 0, steer: 1, drift: true }, track, 6 + i * DT);
    ended = kart.turboJustEnded;
    if (kart.turboActive) assert.equal(kart.driftActive, false);
  }

  assert.equal(ended, true, 'turboJustEnded debería avisar del final');
  assert.equal(kart.turboActive, false);
  assert.equal(kart.turboLevel, 0);
  assert.ok(kart.turboCooldown > 0, 'debería quedar un cooldown breve');

  // Durante el cooldown el derrape no puede reactivarse.
  run(kart, track, { throttle: 1, brake: 0, steer: 1, drift: true }, 5);
  assert.equal(kart.driftActive, false, 'el cooldown bloquea el derrape inmediato');

  // Pasado el cooldown, volver a derrapar sí es posible.
  run(kart, track, { throttle: 1, brake: 0, steer: 1, drift: true }, 40);
  assert.equal(kart.driftActive, true, 'tras el cooldown el derrape vuelve');
});

test('cancelar el derrape no regala turbo', () => {
  const track = makeOpenTrack();
  const kart = makeKart();
  place(kart, track);
  reachSpeed(kart, track);

  run(kart, track, { throttle: 1, brake: 0, steer: 1, drift: true }, 90);
  assert.ok(kart.driftCharge > 0);
  kart.cancelDrift();
  assert.equal(kart.driftActive, false);
  assert.equal(kart.driftCharge, 0);
  assert.equal(kart.turboActive, false);
});
