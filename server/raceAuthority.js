// Autoridad de una carrera online.
//
// El cliente simula su propio kart (para que la conducción siga siendo fluida),
// pero el servidor no acepta ciegas sus resultados:
//   - proyecta cada posición sobre la pista real (Track en modo headless),
//   - mide distancia y tiempo para rechazar teletransportes,
//   - acumula progreso y valida los checkpoints de cada vuelta,
//   - decide la clasificación y el momento de meta,
//   - concede cajas y valida el uso de objetos de efecto inmediato.
import { Track } from '../src/game/Track.js';
import { getMap } from '../src/game/maps.js';
import { CONFIG } from '../src/game/config.js';
import { buildBoxPlan } from '../src/game/boxLayout.js';
import { ITEMS, ITEM_WEIGHTS } from '../src/game/items.js';
import {
  BOX_RESPAWN_MS,
  FINISH_GRACE_MS,
  ITEM_COOLDOWN_MS,
  MAX_RACE_MS,
  ONLINE_ITEM_POOL,
  PICKUP_COOLDOWN_MS,
  PICKUP_RADIUS,
  isValidItem,
  isValidKart,
  sanitizeSnapshot,
} from '../shared/protocol.js';

const MAX_SPEED = 45; // m/s: holgura sobre la punta real del juego
const MAX_DISTANCE_SLACK = 8; // margen para pérdidas de paquetes y latencia

const trackCache = new Map();

export function getHeadlessTrack(mapId) {
  if (!trackCache.has(mapId)) {
    trackCache.set(mapId, new Track(getMap(mapId), { headless: true }));
  }
  return trackCache.get(mapId);
}

function weightedOnlineItem(random = Math.random) {
  const total = ONLINE_ITEM_POOL.reduce((sum, id) => sum + (ITEM_WEIGHTS[id] ?? 0), 0);
  let roll = random() * total;
  for (const id of ONLINE_ITEM_POOL) {
    roll -= ITEM_WEIGHTS[id] ?? 0;
    if (roll < 0) return id;
  }
  return ONLINE_ITEM_POOL[ONLINE_ITEM_POOL.length - 1];
}

function gridSlot(index) {
  const base = CONFIG.grid[index % CONFIG.grid.length];
  const row = Math.floor(index / CONFIG.grid.length);
  return { back: base.back + row * 8, lateral: base.lateral };
}

export class RaceAuthority {
  constructor({
    mapId,
    startAt,
    racers,
    now = Date.now,
    countdownMs = 0,
    random = Math.random,
    finishGraceMs = FINISH_GRACE_MS,
    maxRaceMs = MAX_RACE_MS,
  }) {
    this.mapId = mapId;
    this.track = getHeadlessTrack(mapId);
    this.startAt = startAt;
    this.now = now;
    this.random = random;
    this.finishGraceMs = finishGraceMs;
    this.maxRaceMs = maxRaceMs;
    this.raceId = `race-${startAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.players = new Map();
    this.firstFinishAt = null;
    this.final = null;
    this.finalSent = false;
    this.startedAt = startAt - countdownMs;

    const plan = buildBoxPlan(this.track);
    this.boxes = plan.map((entry) => ({
      ...entry,
      active: true,
      itemId: weightedOnlineItem(random),
      respawnAt: 0,
    }));

    racers.forEach((racer, index) => {
      const slot = gridSlot(index);
      const s = this.track.wrapS(this.track.startS - slot.back);
      const point = this.track.posAt(s, slot.lateral);
      const heading = this.track.headingAt(s);
      this.players.set(racer.id, {
        id: racer.id,
        name: racer.name,
        kartId: isValidKart(racer.kartId) ? racer.kartId : 'rayo',
        slot: index,
        connected: true,
        left: false,
        progress: -slot.back,
        lap: 1,
        checkpointMask: 0,
        checkpointCount: 0,
        invalidLaps: 0,
        finished: false,
        finishTime: null,
        finishAt: null,
        lastS: s,
        lastX: point.x,
        lastZ: point.z,
        lastAt: startAt,
        lastStateAt: startAt,
        item: null,
        lastPickupAt: -Infinity,
        lastUseAt: -Infinity,
        last: {
          id: racer.id,
          x: point.x,
          z: point.z,
          gy: point.y,
          h: 0,
          hd: heading,
          sp: 0,
          st: 0,
          d: false,
          t: false,
          ab: false,
          og: false,
          route: null,
          lap: 1,
          progress: -slot.back,
          finished: false,
          finishTime: null,
          connected: true,
          at: startAt,
        },
      });
    });
  }

  get code() {
    return this.raceId;
  }

  startPayload() {
    return {
      raceId: this.raceId,
      mapId: this.mapId,
      startAt: this.startAt,
      racers: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        kartId: p.kartId,
        slot: p.slot,
      })),
      boxes: this.boxes.map((box) => ({
        index: box.index,
        itemId: box.itemId,
        active: box.active,
      })),
    };
  }

  getOwnState(id) {
    return this.players.get(id)?.last ?? null;
  }

  /**
   * Acepta, sanea y valida un snapshot. Devuelve null si es imposible
   * (miembro inexistente, fuera de tiempo o teletransporte).
   */
  updateState(id, raw, now = this.now()) {
    const p = this.players.get(id);
    if (!p || p.left) return null;
    if (p.finished) {
      // Un kart que ya cruzó meta puede seguir moviéndose, pero no altera
      // su progreso ni su tiempo. Se sigue validando que no se teletransporte.
      const state = sanitizeSnapshot(raw);
      if (!state) return null;
      const finishedElapsed = Math.max(0.001, (now - p.lastStateAt) / 1000);
      const finishedDistance = Math.hypot(state.x - p.lastX, state.z - p.lastZ);
      const finishedAllowed = Math.min(180, finishedElapsed * MAX_SPEED + MAX_DISTANCE_SLACK);
      if (finishedDistance > finishedAllowed) return null;
      p.lastX = state.x;
      p.lastZ = state.z;
      p.lastAt = now;
      p.lastStateAt = now;
      const relay = this.makeRelay(p, state, now);
      p.last = relay;
      return relay;
    }
    if (now < this.startAt - 25) return null;

    const state = sanitizeSnapshot(raw);
    if (!state) return null;

    const elapsed = Math.max(0.001, (now - p.lastStateAt) / 1000);
    if (elapsed < 0.012) return null; // techo ~80 Hz por jugador

    const dx = state.x - p.lastX;
    const dz = state.z - p.lastZ;
    const distance = Math.hypot(dx, dz);
    const allowedDistance = Math.min(180, elapsed * MAX_SPEED + MAX_DISTANCE_SLACK);
    if (Number.isFinite(distance) && distance > allowedDistance) {
      return null;
    }

    const routeId =
      state.route && this.track.routesById.has(state.route) ? state.route : null;
    const projection = this.track.project(
      { x: state.x, z: state.z },
      routeId,
      p.lastS,
    );
    if (!projection) return null;

    const previousS = p.lastS;
    const previousProgress = p.progress;
    let delta = this.track.wrapDelta(projection.s - previousS);
    const maxDelta = elapsed * MAX_SPEED + MAX_DISTANCE_SLACK;
    if (delta > maxDelta) delta = maxDelta;
    if (delta < -maxDelta) delta = -maxDelta;
    p.lastS = projection.s;
    p.progress += delta;

    if (delta > 0) {
      const checkpoints = this.track.checkpoints ?? [];
      for (let i = 0; i < checkpoints.length; i += 1) {
        const ahead = this.track.wrapDelta(checkpoints[i] - previousS);
        if (ahead > 0 && ahead <= delta + 1e-6) p.checkpointMask |= 1 << i;
      }
      let count = 0;
      for (let mask = p.checkpointMask; mask; mask >>= 1) count += mask & 1;
      p.checkpointCount = count;
    }

    const length = this.track.length;
    const lapBefore = Math.floor(previousProgress / length);
    const lapAfter = Math.floor(p.progress / length);
    if (lapAfter > lapBefore && lapAfter >= 1) {
      const required = this.track.checkpoints?.length ?? 0;
      const valid = required === 0 || p.checkpointCount >= required;
      if (valid) {
        p.lap += 1;
        if (p.lap > CONFIG.laps) {
          p.lap = CONFIG.laps + 1;
          p.finished = true;
          p.finishTime = Math.max(0, (now - this.startAt) / 1000);
          p.finishAt = now;
          if (this.firstFinishAt === null) this.firstFinishAt = now;
        }
      } else {
        p.invalidLaps += 1;
      }
      p.checkpointMask = 0;
      p.checkpointCount = 0;
    }

    p.lastX = state.x;
    p.lastZ = state.z;
    p.lastAt = now;
    p.lastStateAt = now;
    const relay = this.makeRelay(p, state, now);
    p.last = relay;
    return relay;
  }

  makeRelay(p, state, now) {
    return {
      id: p.id,
      x: state.x,
      z: state.z,
      gy: state.gy,
      h: state.h,
      hd: state.hd,
      sp: state.sp,
      st: state.st,
      d: state.d,
      t: state.t,
      ab: state.ab,
      og: state.og,
      route: state.route,
      lap: p.lap,
      progress: Math.round(p.progress * 1000) / 1000,
      finished: p.finished,
      finishTime: p.finishTime,
      connected: p.connected,
      at: now,
    };
  }

  claimBox(id, boxIndex, now = this.now()) {
    const p = this.players.get(id);
    const box = this.boxes[boxIndex];
    if (!p || p.left) return { ok: false, reason: 'not-member' };
    if (p.finished) return { ok: false, reason: 'finished' };
    if (!box) return { ok: false, reason: 'bad-box' };
    if (!box.active) return { ok: false, reason: 'inactive' };
    if (p.item) return { ok: false, reason: 'has-item' };
    if (now - p.lastPickupAt < PICKUP_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
    if (!p.last) return { ok: false, reason: 'no-state' };
    if (box.routeId && p.last.route !== box.routeId) return { ok: false, reason: 'route' };
    if ((p.last.h ?? 0) > 1.8) return { ok: false, reason: 'height' };
    const dx = p.last.x - box.x;
    const dz = p.last.z - box.z;
    // Tolerancia extra por la latencia entre el snapshot y la petición.
    if (dx * dx + dz * dz > (PICKUP_RADIUS + 3) * (PICKUP_RADIUS + 3)) {
      return { ok: false, reason: 'distance' };
    }

    p.item = weightedOnlineItem(this.random);
    p.lastPickupAt = now;
    box.active = false;
    box.respawnAt = now + BOX_RESPAWN_MS;
    return {
      ok: true,
      playerId: id,
      boxIndex,
      itemId: p.item,
      at: now,
    };
  }

  useItem(id, itemId, now = this.now()) {
    const p = this.players.get(id);
    if (!p || p.left || p.finished) return { ok: false, reason: 'not-active' };
    if (!isValidItem(itemId)) return { ok: false, reason: 'item-offline' };
    if (p.item !== itemId) return { ok: false, reason: 'no-item' };
    if (now - p.lastUseAt < ITEM_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
    if (!p.last) return { ok: false, reason: 'no-state' };

    p.item = null;
    p.lastUseAt = now;
    const targets = [];
    if (itemId === 'PULSO') {
      const radius = ITEMS.PULSO.radius;
      for (const other of this.players.values()) {
        if (other.id === id || other.left || other.finished || !other.last) continue;
        const dx = other.last.x - p.last.x;
        const dz = other.last.z - p.last.z;
        if (dx * dx + dz * dz <= radius * radius) targets.push(other.id);
      }
    }
    return { ok: true, playerId: id, itemId, targets, at: now };
  }

  setConnected(id, connected) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = Boolean(connected);
    if (p.last) p.last.connected = p.connected;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.left = true;
    p.connected = false;
  }

  standings() {
    const list = [...this.players.values()].filter((p) => !p.left);
    list.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    return list.map((p, index) => ({
      position: index + 1,
      id: p.id,
      name: p.name,
      kartId: p.kartId,
      lap: Math.min(p.lap, CONFIG.laps),
      progress: Math.round(p.progress * 1000) / 1000,
      finished: p.finished,
      finishTime: p.finishTime,
      connected: p.connected,
    }));
  }

  tick(now = this.now()) {
    const respawned = [];
    for (const box of this.boxes) {
      if (box.active) continue;
      if (now >= box.respawnAt) {
        box.active = true;
        box.itemId = weightedOnlineItem(this.random);
        respawned.push({ index: box.index, itemId: box.itemId, active: true });
      }
    }

    let final = null;
    if (!this.final) {
      const active = [...this.players.values()].filter((p) => !p.left);
      const allFinished = active.length > 0 && active.every((p) => p.finished);
      const finishExpired =
        this.firstFinishAt !== null && now - this.firstFinishAt >= this.finishGraceMs;
      const timeExpired = now - this.startAt >= this.maxRaceMs;
      if (allFinished || finishExpired || timeExpired) {
        this.final = {
          raceId: this.raceId,
          mapId: this.mapId,
          endedAt: now,
          reason: allFinished ? 'all-finished' : finishExpired ? 'finish-deadline' : 'time-limit',
          results: this.standings(),
        };
      }
    }
    if (this.final && !this.finalSent) {
      this.finalSent = true;
      final = this.final;
    }
    return { respawned, final };
  }
}
