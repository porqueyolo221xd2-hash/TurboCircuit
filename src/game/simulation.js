// Simulación de carreras sin render, pensada para equilibrar la IA.
//
// No se usa durante la partida normal: sirve para lanzar carreras completas con
// una semilla fija y comparar dificultades con datos reales (posiciones, vueltas,
// salidas de pista, golpes y adelantamientos) en vez de ajustar a ojo.
//
// El jugador se sustituye por un bot de referencia con una dificultad fija. Así
// la misma vara mide todas las dificultades y los resultados son comparables.
import { Track } from './Track.js';
import { getMap } from './maps.js';
import { DIFFICULTIES } from './difficulty.js';
import { computeAIControls } from './AIController.js';
import { mulberry32, clamp } from './utils.js';

export const SIM_MAPS = ['coast', 'mountain', 'city', 'neon', 'canyon', 'orbital'];

/** Reconstruye la pista de un mapa sin tocar la selección guardada. */
export function prepareTrack(game, mapId) {
  const map = getMap(mapId);
  if (!map) return false;
  if (game.track) {
    game.scene.remove(game.track.group);
    game.track.dispose();
  }
  game.mapId = map.id;
  game.map = map;
  game.track = new Track(map);
  game.scene.add(game.track.group);
  game.applyEnvironment();
  game.createItemSystem();
  return true;
}

/** Devuelve la pista al estado de menú del mapa indicado. */
export function restoreTrack(game, mapId) {
  prepareTrack(game, mapId);
  game.resetRace();
  game.state = 'menu';
  game.ui.setMap(game.mapId, game.map);
  game.ui.resetMinimap();
  game.ui.showHud(false);
  return game.mapId;
}

function emptyMetrics(kart) {
  return {
    id: kart.id ?? kart.name,
    name: kart.name,
    isReference: false,
    finishTime: null,
    lapTimes: [],
    bestLap: null,
    offRoad: 0,
    wallHits: 0,
    bumps: 0,
    driftTime: 0,
    turboTime: 0,
    mistakeTime: 0,
    itemsPicked: 0,
    overtakes: 0,
    lostPlaces: 0,
    avgSpeed: 0,
  };
}

/**
 * Corre una carrera completa (3 vueltas) con los 4 karts pilotados por la IA.
 *
 * @param {object} game Instancia de Game.
 * @param {object} options
 * @param {string} options.mapId Circuito.
 * @param {string} options.difficulty Dificultad de los tres rivales.
 * @param {string} options.reference Dificultad del bot que ocupa el puesto del jugador.
 * @param {number} options.seed Semilla de repetición.
 * @param {number} options.dt Paso de simulación.
 * @param {number} options.maxTime Corte de seguridad en segundos.
 * @param {boolean} options.withItems Si los cubos y proyectiles intervienen.
 */
export function runRaceSimulation(game, options = {}) {
  const {
    mapId = 'coast',
    difficulty = 'normal',
    reference = 'normal',
    seed = 1,
    dt = 1 / 60,
    maxTime = 260,
    withItems = true,
  } = options;

  const field = DIFFICULTIES[difficulty] ?? DIFFICULTIES.normal;
  const referenceTuning = DIFFICULTIES[reference] ?? DIFFICULTIES.normal;

  if (!prepareTrack(game, mapId)) {
    return { error: `Mapa desconocido: ${mapId}` };
  }

  const savedRandom = Math.random;
  const savedCallbacks = {
    onPickup: game.itemSystem.onPickup,
    onUse: game.itemSystem.onUse,
    onSlow: game.itemSystem.onSlow,
    onProjectileFired: game.itemSystem.onProjectileFired,
    onProjectileHit: game.itemSystem.onProjectileHit,
    onMineTriggered: game.itemSystem.onMineTriggered,
  };
  const savedVisuals = new Map();

  Math.random = mulberry32(seed >>> 0);

  try {
    // resetRace recoloca los karts y limpia el perfil, así que la dificultad
    // se aplica después (en la partida real startRace hace lo mismo).
    game.resetRace();
    for (const kart of game.karts) {
      kart.applyDifficulty(kart === game.playerKart ? referenceTuning : field);
    }
    game.itemSystem.setDifficulty?.(field);

    game.itemSystem.onPickup = null;
    game.itemSystem.onUse = null;
    game.itemSystem.onSlow = null;
    game.itemSystem.onProjectileFired = null;
    game.itemSystem.onProjectileHit = null;
    game.itemSystem.onMineTriggered = null;

    for (const kart of game.karts) {
      savedVisuals.set(kart, { updateVisual: kart.updateVisual, isPlayer: kart.isPlayer });
      kart.updateVisual = () => {};
      kart.isPlayer = false;
    }

    const karts = game.karts;
    const player = game.playerKart;
    const track = game.track;
    const metrics = karts.map((kart) => {
      const base = emptyMetrics(kart);
      base.isReference = kart === player;
      return base;
    });
    const state = karts.map(() => ({ wall: false, bumps: new Set(), item: null }));
    const startProgress = karts.map((kart) => kart.progress);
    const contactPairs = new Set();

    let raceTime = 0;
    let lastOrder = game.standings.map((kart) => kart);

    while (raceTime < maxTime) {
      raceTime += dt;
      track.updateFeatures(dt, raceTime);

      for (let i = 0; i < karts.length; i += 1) {
        const kart = karts[i];
        const m = metrics[i];
        const gap = player.progress - kart.progress;
        kart.speedBias = kart.finished
          ? 1
          : clamp(
              1 + (gap / field.rubberBandDivisor) * field.rubberBandStrength,
              field.rubberBandMin,
              field.rubberBandMax,
            );

        const controls = computeAIControls(kart, track, {
          karts,
          dt,
          raceTime,
          difficulty: kart === player ? referenceTuning : field,
        });

        const lapBefore = kart.lap;
        kart.step(dt, controls, track, raceTime);

        if (kart.wallContact && !state[i].wall) m.wallHits += 1;
        state[i].wall = kart.wallContact;
        if (kart.onGrass) m.offRoad += dt;
        if (kart.driftActive) m.driftTime += dt;
        if (kart.turboActive) m.turboTime += dt;
        if (kart.aiMistakeTime > 0) m.mistakeTime += dt;
        if (kart.lap !== lapBefore && kart.lastLapTime) {
          m.lapTimes.push(kart.lastLapTime);
          if (m.bestLap === null || kart.lastLapTime < m.bestLap) {
            m.bestLap = kart.lastLapTime;
          }
        }
        if (kart.finished && m.finishTime === null) m.finishTime = kart.finishTime;
      }

      game.applyTrackFeatures(dt);
      game.resolveCollisions();

      // Roces entre karts: se cuenta una vez por contacto, no por fotograma.
      const activePairs = new Set();
      for (let i = 0; i < karts.length; i += 1) {
        for (let j = i + 1; j < karts.length; j += 1) {
          const a = karts[i];
          const b = karts[j];
          const d = Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z);
          if (d < 2.06) {
            const key = `${i}:${j}`;
            activePairs.add(key);
            if (!contactPairs.has(key)) {
              metrics[i].bumps += 1;
              metrics[j].bumps += 1;
            }
          }
        }
      }
      contactPairs.clear();
      for (const key of activePairs) contactPairs.add(key);

      if (withItems) game.itemSystem.update(dt, karts);
      game.updateStandings();

      for (let i = 0; i < karts.length; i += 1) {
        const item = karts[i].item;
        if (item && !state[i].item) metrics[i].itemsPicked += 1;
        state[i].item = item;
      }

      const order = game.standings;
      for (let i = 0; i < order.length; i += 1) {
        const prevIndex = lastOrder.indexOf(order[i]);
        if (prevIndex > i) metrics[karts.indexOf(order[i])].overtakes += prevIndex - i;
        else if (prevIndex < i && prevIndex >= 0) metrics[karts.indexOf(order[i])].lostPlaces += i - prevIndex;
      }
      lastOrder = [...order];

      if (karts.every((kart) => kart.finished)) break;
    }

    const finalOrder = [...karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });

    const results = finalOrder.map((kart, index) => {
      const m = metrics[karts.indexOf(kart)];
      return {
        ...m,
        position: index + 1,
        finished: kart.finished,
        progress: kart.progress - startProgress[karts.indexOf(kart)],
        avgSpeed:
          raceTime > 0 ? Math.max(0, kart.progress - startProgress[karts.indexOf(kart)]) / raceTime : 0,
      };
    });

    return {
      mapId,
      difficulty,
      reference,
      seed,
      raceTime,
      completed: karts.every((kart) => kart.finished),
      results,
      referencePosition: results.find((r) => r.isReference)?.position ?? null,
      referenceWon: results[0]?.isReference ?? false,
    };
  } finally {
    Math.random = savedRandom;
    for (const [kart, saved] of savedVisuals) {
      kart.updateVisual = saved.updateVisual;
      kart.isPlayer = saved.isPlayer;
      kart.speedBias = 1;
    }
    Object.assign(game.itemSystem, savedCallbacks);
  }
}

/** Media aritmética simple, tolerante a listas vacías. */
function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Batería de carreras: mapas × dificultades × semillas.
 * Devuelve un resumen por dificultad y el detalle de cada carrera.
 */
export function runSimulationSuite(game, options = {}) {
  const {
    maps = SIM_MAPS,
    difficulties = ['easy', 'normal', 'hard'],
    seeds = [11, 23, 37],
    reference = 'normal',
    withItems = true,
    dt = 1 / 60,
    maxTime = 260,
    onRace = null,
  } = options;

  const races = [];
  for (const mapId of maps) {
    for (const difficulty of difficulties) {
      for (const seed of seeds) {
        const race = runRaceSimulation(game, {
          mapId,
          difficulty,
          reference,
          seed,
          dt,
          maxTime,
          withItems,
        });
        races.push(race);
        onRace?.(race);
      }
    }
  }

  const summary = difficulties.map((difficulty) => {
    const subset = races.filter((race) => race.difficulty === difficulty && race.results);
    const referenceResults = subset.map((race) => race.results.find((r) => r.isReference));
    const rivalResults = subset.flatMap((race) => race.results.filter((r) => !r.isReference));
    const lapTimes = subset.flatMap((race) =>
      race.results.filter((r) => !r.isReference).flatMap((r) => r.lapTimes),
    );
    const finished = subset.filter((race) => race.completed).length;
    return {
      difficulty,
      races: subset.length,
      completed: finished,
      referenceWins: subset.filter((race) => race.referenceWon).length,
      referenceWinRate: subset.length
        ? subset.filter((race) => race.referenceWon).length / subset.length
        : 0,
      referenceAvgPosition: average(referenceResults.map((r) => r?.position)),
      rivalAvgPosition: average(rivalResults.map((r) => r.position)),
      rivalBestLap: lapTimes.length ? Math.min(...lapTimes) : null,
      rivalAvgLap: average(lapTimes),
      rivalOffRoad: average(rivalResults.map((r) => r.offRoad)),
      rivalWallHits: average(rivalResults.map((r) => r.wallHits)),
      rivalBumps: average(rivalResults.map((r) => r.bumps)),
      rivalDrift: average(rivalResults.map((r) => r.driftTime)),
      rivalMistakes: average(rivalResults.map((r) => r.mistakeTime)),
      rivalOvertakes: average(rivalResults.map((r) => r.overtakes)),
    };
  });

  return { races, summary };
}
