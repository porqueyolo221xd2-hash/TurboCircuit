// Pruebas de comportamiento de los circuitos rediseñados: desniveles, saltos,
// bifurcaciones transitables, checkpoints por ruta y carreras completas de la IA.
//
// Se ejecutan sin navegador: Track(headless) genera los datos de simulación y
// Kart/ItemSystem no dependen del render. No se rebajan umbrales para "hacer
// pasar" una prueba: si un circuito no cumple, la prueba falla.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Track } from '../src/game/Track.js';
import { MAPS, MAP_ORDER } from '../src/game/maps.js';
import { Kart } from '../src/game/Kart.js';
import { AI_KARTS } from '../src/game/karts.js';
import { DIFFICULTIES } from '../src/game/difficulty.js';
import { computeAIControls } from '../src/game/AIController.js';
import { ItemSystem } from '../src/game/ItemSystem.js';
import { mulberry32 } from '../src/game/utils.js';
import { CONFIG } from '../src/game/config.js';

const DT = 1 / 60;
const tracks = new Map();

function trackFor(id) {
  if (!tracks.has(id)) tracks.set(id, new Track(MAPS[id], { headless: true }));
  return tracks.get(id);
}

function makeKart(spec = AI_KARTS[0]) {
  return new Kart({ ...spec });
}

function placeKart(kart, track, s, lateral = 0, back = 0) {
  kart.reset({ s, back, lateral, track });
  kart.applyDifficulty(DIFFICULTIES.normal);
}

/**
 * Pilota un kart con la IA real. `branch` fuerza (true) o prohíbe (false) tomar
 * la bifurcación; con null se deja la decisión al plan aleatorio de la IA.
 */
function runAIRace(track, { seed = 1, branch = null, maxTime = 240, karts = null } = {}) {
  const savedRandom = Math.random;
  Math.random = mulberry32(seed >>> 0);
  try {
    const field = karts ?? [makeKart()];
    field.forEach((kart, index) => {
      const slot = CONFIG.grid[index] ?? { back: 9, lateral: 0 };
      placeKart(kart, track, track.startS - slot.back, slot.lateral, slot.back);
      if (!kart.aiRoutePlan) kart.aiRoutePlan = new Map();
      kart.aiRoutePlan.clear();
      for (const route of track.routes) {
        kart.aiRoutePlan.set(route.id, branch === null ? Math.random() < 0.5 : branch);
      }
    });

    let time = 0;
    let stuck = 0;
    let maxLateral = 0;
    let visitedRoute = null;
    let airTime = 0;
    let jumps = 0;
    let wallContacts = 0;
    let previousWall = false;

    while (time < maxTime && field.some((kart) => !kart.finished)) {
      for (const kart of field) {
        if (kart.finished) continue;
        const controls = computeAIControls(kart, track, {
          karts: field,
          dt: DT,
          raceTime: time,
          difficulty: DIFFICULTIES.normal,
        });
        kart.step(DT, controls, track, time);
        const { launched } = track.applyRamp(kart);
        if (launched) jumps += 1;
        if (kart.airborne) airTime += DT;
        if (kart.route) visitedRoute = kart.route;
        maxLateral = Math.max(maxLateral, Math.abs(kart.lateral));
        if (kart.wallContact && !previousWall) wallContacts += 1;
        previousWall = kart.wallContact;
        if (Math.abs(kart.speed) < 1) stuck += DT;
        else stuck = 0;
        if (stuck > 8) break;
      }
      time += DT;
    }

    return { field, time, stuck, maxLateral, visitedRoute, airTime, jumps, wallContacts };
  } finally {
    Math.random = savedRandom;
  }
}

test('los seis circuitos generan datos coherentes y una vuelta cerrada', () => {
  for (const id of MAP_ORDER) {
    const track = trackFor(id);
    assert.equal(track.map.id, id);
    assert.ok(track.length > 600, `${id}: el circuito es demasiado corto`);
    assert.equal(track.samples.length, 720);
    assert.ok(track.checkpoints.length >= 4, `${id}: faltan checkpoints`);
    assert.ok(track.checkpoints.every((s) => s >= 0 && s < track.length));
    assert.ok(track.bounds.maxX > track.bounds.minX);
    assert.ok(track.bounds.maxZ > track.bounds.minZ);
    assert.ok(track.elevation.length >= 2);

    let previous = track.heightAt(0);
    for (let s = 0; s <= track.length; s += 2) {
      const height = track.heightAt(s);
      assert.ok(Number.isFinite(height), `${id}: altura no finita en s=${s}`);
      assert.ok(height >= -0.01, `${id}: altura negativa en s=${s}`);
      assert.ok(Math.abs(height - previous) < 0.9, `${id}: escalón de altura en s=${s}`);
      previous = height;
    }
  }
});

test('cada mapa tiene al menos un salto real y un obstáculo móvil', () => {
  for (const id of MAP_ORDER) {
    const track = trackFor(id);
    assert.ok(track.features.ramps.length >= 1, `${id}: no hay rampas`);
    assert.ok(track.features.obstacles.length >= 1, `${id}: no hay obstáculos`);
    for (const ramp of track.features.ramps) {
      assert.ok(ramp.length > 4 && ramp.height > 0.5, `${id}: rampa inválida`);
      assert.ok(ramp.width < (ramp.route ? ramp.route.width : track.map.roadWidth));
    }
  }
});

test('las bifurcaciones se separan de verdad y vuelven a la calzada', () => {
  for (const id of MAP_ORDER) {
    const track = trackFor(id);
    assert.ok(track.routes.length >= 1, `${id}: falta una bifurcación`);
    for (const route of track.routes) {
      assert.ok(route.length > 80, `${id}: ruta demasiado corta`);
      assert.ok(route.width >= 10, `${id}: ruta demasiado estrecha`);

      const n = route.samples.length - 1;
      let minClearance = Infinity;
      for (let i = Math.floor(n * 0.3); i <= Math.ceil(n * 0.7); i += 1) {
        const point = route.samples[i].point;
        const main = track.projectMain(point);
        minClearance = Math.min(
          minClearance,
          main.distance - (track.halfWidth + route.halfWidth),
        );
      }
      assert.ok(
        minClearance > 3,
        `${id}/${route.id}: los dos caminos se solapan (${minClearance.toFixed(2)} m)`,
      );

      const enterDistance = track.projectMain(route.samples[0].point).distance;
      const exitDistance = track.projectMain(route.samples[n].point).distance;
      assert.ok(enterDistance < track.halfWidth + 1, `${id}: entrada de ruta desalineada`);
      assert.ok(exitDistance < track.halfWidth + 1, `${id}: salida de ruta desalineada`);

      // La altura del ramal empalma con la principal en ambos extremos.
      const enterHeight = track.heightAt(route.enterS);
      const exitHeight = track.heightAt(route.exitS);
      assert.ok(Math.abs(route.samples[0].point.y - enterHeight) < 0.2);
      assert.ok(Math.abs(route.samples[n].point.y - exitHeight) < 0.2);
    }
  }
});

test('proyectar sobre una ruta devuelve esa ruta y respeta su ancho', () => {
  for (const id of MAP_ORDER) {
    const track = trackFor(id);
    for (const route of track.routes) {
      const n = route.samples.length - 1;
      for (const u of [0.2, 0.4, 0.5, 0.6, 0.8]) {
        const point = route.samples[Math.round(n * u)].point;
        const globalS = track.globalSForRoute(route, u * route.length);
        const projection = track.project({ x: point.x, z: point.z }, route.id, globalS);
        assert.equal(projection.routeId, route.id, `${id}: no se proyecta en su ruta`);
        assert.ok(Math.abs(projection.lateral) < 0.75, `${id}: lateral falso`);
        assert.ok(
          Math.abs(projection.s - globalS) < route.span * 0.05 + 1,
          `${id}: progreso global incoherente`,
        );
      }
    }
  }
});

test('la vuelta solo cuenta al cruzar todos los checkpoints', () => {
  const track = trackFor('coast');
  const kart = makeKart();
  placeKart(kart, track, track.startS - 9, 0, 9);
  kart.lapStartTime = 0;

  let time = 0;
  let s = kart.trackS;
  const target = track.startS + track.length + 1;
  while (s < target) {
    s += 2;
    time += 0.1;
    kart.trackS = ((s % track.length) + track.length) % track.length;
    kart.updateProgress(track, time);
  }

  assert.equal(kart.lap, 2, 'la primera vuelta limpia debe contar');
  assert.equal(kart.invalidLaps, 0, 'no debe haber vueltas inválidas');
});

test('una vuelta sin checkpoints no concede vuelta', () => {
  const track = trackFor('coast');
  const kart = makeKart();
  placeKart(kart, track, track.startS - 9, 0, 9);

  kart.lap = 1;
  kart.progress = track.length - 1;
  kart.checkpointMask = 0;
  kart.checkpointCount = 0;
  kart.lastTrackS = track.startS - 1;
  kart.trackS = track.startS + 1;
  kart.lapStartTime = 0;
  kart.updateProgress(track, 10);

  assert.equal(kart.lap, 1, 'no se puede saltar la línea sin checkpoints');
  assert.equal(kart.invalidLaps, 1);
  assert.equal(kart.checkpointCount, 0);
});

function driveRamp(track, rampS, lateral, speed = 26) {
  const kart = makeKart();
  placeKart(kart, track, rampS - 9, lateral);
  kart.speed = speed;
  const result = { airborne: 0, landed: false, landedFlag: false, maxHeight: 0 };
  let previousAir = false;

  for (let i = 0; i < 360; i += 1) {
    kart.step(DT, { throttle: 1, brake: 0, steer: 0, drift: false }, track, i * DT);
    track.applyRamp(kart);
    result.maxHeight = Math.max(result.maxHeight, kart.height);
    if (kart.airborne) result.airborne += DT;
    if (previousAir && !kart.airborne) {
      result.landed = true;
      result.landedFlag = kart.justLanded;
    }
    previousAir = kart.airborne;
  }
  return { kart, result };
}

test('los saltos despegan, vuelan y aterrizan sin repetirse en el aire', () => {
  for (const id of ['coast', 'canyon', 'orbital']) {
    const track = trackFor(id);
    const ramp = track.features.ramps.find((item) => !item.route) ?? track.features.ramps[0];
    const { kart, result } = driveRamp(track, ramp.s, ramp.lateral, 25);

    assert.ok(result.maxHeight > 1, `${id}: la rampa no eleva el kart`);
    assert.ok(result.airborne > 0.15, `${id}: el salto es demasiado breve`);
    assert.ok(result.landed, `${id}: el kart nunca aterriza`);
    assert.equal(kart.airborne, false, `${id}: salto infinito`);
    assert.equal(kart.height, 0, `${id}: altura residual tras aterrizar`);
    assert.ok(result.landedFlag, `${id}: no se notifica el aterrizaje`);
  }
});

test('la altura del kart sigue el desnivel del asfalto', () => {
  for (const id of MAP_ORDER) {
    const track = trackFor(id);
    for (const u of [0.15, 0.3, 0.5, 0.7, 0.85]) {
      const s = track.length * u;
      const kart = makeKart();
      placeKart(kart, track, s, 0);
      kart.step(DT, { throttle: 0, brake: 0, steer: 0, drift: false }, track, 0);
      assert.ok(
        Math.abs(kart.groundY - track.heightAt(kart.trackS)) < 0.4,
        `${id}: el kart no sigue la altura en s=${s.toFixed(1)}`,
      );
      assert.ok(
        Math.abs(kart.group.position.y - (kart.groundY + 0.02)) < 0.01,
        `${id}: el modelo no se apoya en el asfalto`,
      );
    }
  }
});

test('los obstáculos nunca cierran todo el ancho de la pista', () => {
  for (const id of MAP_ORDER) {
    const track = trackFor(id);
    for (const obstacle of track.features.obstacles) {
      const route = obstacle.route ?? null;
      const wallOffset = route ? route.wallOffset : track.wallOffset;
      const edge = Math.abs(obstacle.baseLateral) + obstacle.amplitude + obstacle.width / 2;
      const free = wallOffset - edge;
      assert.ok(free > 2, `${id}/${obstacle.id}: cierra la pista (${free.toFixed(2)} m libres)`);
      assert.ok(obstacle.width < (route ? route.width : track.map.roadWidth));
      assert.ok(obstacle.depth <= 3);
    }
  }
});

test('un obstáculo golpea al kart y se puede superar saltando', () => {
  const track = trackFor('coast');
  const obstacle = track.features.obstacles[0];
  const kart = makeKart();
  placeKart(kart, track, obstacle.s, obstacle.lateral);
  kart.featureCooldowns.clear();

  const contact = track.obstacleContact(kart, obstacle, 5);
  assert.ok(contact, 'debería detectar el obstáculo');
  assert.equal(contact.side, 1);
  const hit = kart.applyImpact(
    {
      slowFactor: 0.56,
      slowDuration: 0.95,
      controlDuration: 0.35,
      controlStrength: 0.38,
      impactSpeedLoss: 0.84,
    },
    contact.side,
  );
  assert.equal(hit, true);
  assert.ok(kart.impactTime > 0, 'el golpe debe desestabilizar');

  kart.featureCooldowns.clear();
  kart.height = obstacle.height + 1;
  assert.equal(track.obstacleContact(kart, obstacle, 5), null, 'en el aire no debe golpear');
});

test('las placas de turbo de la ruta nueva se activan en esa ruta', () => {
  for (const id of MAP_ORDER) {
    const track = trackFor(id);
    const pad = track.features.boostPads.find((item) => item.routeId);
    assert.ok(pad, `${id}: la ruta no tiene turbo propio`);
    const route = track.routesById.get(pad.routeId);
    const kart = makeKart();
    placeKart(kart, track, pad.s, pad.lateral);
    kart.route = pad.routeId;
    kart.trackS = pad.s;
    kart.lateral = pad.lateral;
    kart.featureCooldowns.clear();

    assert.ok(track.boostPadContact(kart, pad, 5), `${id}: el turbo del ramal no responde`);
    kart.applyItemBoost(pad.def.power, pad.def.duration);
    assert.ok(kart.itemBoostTime > 0);
    assert.ok(route.length > 0);
  }
});

test('las cajas y los proyectiles funcionan dentro de la bifurcación', () => {
  const savedDocument = globalThis.document;
  const noop = () => {};
  const context = new Proxy(
    {
      createRadialGradient: () => ({ addColorStop: noop }),
      createLinearGradient: () => ({ addColorStop: noop }),
      measureText: () => ({ width: 8 }),
    },
    {
      get: (target, property) => (property in target ? target[property] : noop),
      set: () => true,
    },
  );
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };

  try {
    const track = trackFor('coast');
    const kart = makeKart();
    placeKart(kart, track, track.startS - 9, 0, 9);
    const scene = new THREE.Scene();
    const items = new ItemSystem(scene, track, [kart]);

    assert.ok(items.boxes.some((box) => box.routeId === null), 'faltan cajas en la principal');
    const routeBox = items.boxes.find((box) => box.routeId === 'coast-palms');
    assert.ok(routeBox, 'faltan cajas en la bifurcación');
    const route = track.routesById.get(routeBox.routeId);
    assert.ok(
      Math.abs(routeBox.baseY - (track.heightAt(routeBox.s, route.id) + 0.95)) < 0.35,
      'la caja no está apoyada en la altura de la ruta',
    );

    // Colocar el kart en la caja del ramal y comprobar que la recoge.
    const point = track.posAt(track.globalSForRoute(route, route.length * 0.5), 0, route.id);
    kart.position.set(point.x, point.y, point.z);
    kart.route = route.id;
    kart.trackS = track.globalSForRoute(route, route.length * 0.5);
    kart.lateral = 0;
    kart.groundY = point.y;
    kart.item = null;
    kart.pickupCooldown = 0;
    // Se usa la caja más cercana al punto: es la que debe activarse.
    routeBox.group.position.set(point.x, point.y + 0.95, point.z);
    items.update(DT, [kart]);
    assert.ok(kart.item, 'el kart no recoge la caja del ramal');
    assert.equal(routeBox.active, false);

    kart.item = null;
    const projectile = items.spawnProjectile(kart);
    assert.ok(projectile, 'no se puede disparar en la ruta');
    assert.equal(projectile.routeId, route.id);
    assert.ok(
      Math.abs(projectile.baseY - point.y) < 0.5,
      'el proyectil no parte de la altura de la ruta',
    );
    items.update(DT, [kart]);
    assert.ok(items.projectiles.length >= 1, 'el proyectil desaparece al instante');
  } finally {
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
  }
});

test('carrera completa de la IA por la calzada principal en los seis mapas', () => {
  for (const id of MAP_ORDER) {
    const track = trackFor(id);
    const result = runAIRace(track, { seed: 7, branch: false });
    const kart = result.field[0];

    assert.ok(kart.finished, `${id}: la IA no termina la carrera`);
    assert.equal(kart.lap, CONFIG.laps + 1, `${id}: vueltas incorrectas`);
    assert.equal(kart.invalidLaps, 0, `${id}: vueltas inválidas sin motivo`);
    assert.equal(result.stuck, 0, `${id}: la IA se atasca`);
    assert.ok(result.maxLateral < track.wallOffset, `${id}: la IA atraviesa el muro`);
    assert.ok(result.time < 240, `${id}: carrera demasiado lenta`);
  }
});

test('carrera completa de la IA por la bifurcación en los seis mapas', () => {
  for (const id of MAP_ORDER) {
    const track = trackFor(id);
    const result = runAIRace(track, { seed: 11, branch: true });
    const kart = result.field[0];

    assert.ok(kart.finished, `${id}: la IA no termina tomando el ramal`);
    assert.equal(kart.lap, CONFIG.laps + 1);
    assert.equal(kart.invalidLaps, 0, `${id}: la ruta invalida la vuelta`);
    assert.equal(result.stuck, 0, `${id}: la IA se atasca en el ramal`);
    assert.ok(result.visitedRoute, `${id}: nunca entra en la bifurcación`);
    assert.equal(result.visitedRoute, track.routes[0].id);
  }
});

test('cuatro karts completan una carrera sin bloquearse', () => {
  const track = trackFor('coast');
  const field = [
    makeKart(AI_KARTS[0]),
    makeKart(AI_KARTS[1]),
    makeKart(AI_KARTS[2]),
    makeKart(AI_KARTS[3]),
  ];
  const result = runAIRace(track, { seed: 23, branch: null, maxTime: 300, karts: field });

  for (const kart of result.field) {
    assert.ok(kart.finished, `${kart.name}: no termina la carrera`);
    assert.equal(kart.lap, CONFIG.laps + 1);
    assert.equal(kart.invalidLaps, 0, `${kart.name}: vuelta inválida`);
  }
  assert.equal(result.stuck, 0);
});
