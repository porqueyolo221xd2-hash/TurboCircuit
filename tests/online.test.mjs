// Pruebas del servidor de salas y de la autoridad de carrera.
// Levantan un servidor real en un puerto efímero y usan varios clientes
// Socket.IO, además de probar la validación de vueltas/objetos con reloj falso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { createGameServer } from '../server/app.js';
import { RaceAuthority, getHeadlessTrack } from '../server/raceAuthority.js';
import { CONFIG } from '../src/game/config.js';
import { getMap } from '../src/game/maps.js';
import {
  ERRORS,
  ONLINE_ITEM_POOL,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isValidRoomCode,
} from '../shared/protocol.js';

const VALID_CODE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

function connect(url, clientId, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      timeout: 4000,
      ...options,
      auth: { clientId, ...(options.auth ?? {}) },
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('timeout conectando'));
    }, 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function ack(socket, event, payload, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${event}`)), timeout);
    socket.emit(event, payload, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function once(socket, event, predicate = () => true, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout esperando ${event}`));
    }, timeout);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rawFromState(state, extra = {}) {
  return {
    x: state.x,
    z: state.z,
    gy: state.gy ?? 0,
    h: state.h ?? 0,
    hd: state.hd ?? 0,
    sp: state.sp ?? 0,
    st: 0,
    route: state.route ?? null,
    ...extra,
  };
}

test('salas: crear, unirse, límites, anfitrión y mensajes de no miembros', async (t) => {
  const server = createGameServer({
    port: 0,
    host: '127.0.0.1',
    serveClient: false,
    maxPlayers: 3,
    countdownMs: 180,
    disconnectGraceMs: 2000,
    emptyRoomTtlMs: 200,
    raceTickMs: 25,
    logger: { error() {} },
  });
  const address = await server.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];

  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await server.close();
  });

  const a = await connect(url, 'client-aaaa-1111');
  const b = await connect(url, 'client-bbbb-2222');
  const c = await connect(url, 'client-cccc-3333');
  const d = await connect(url, 'client-dddd-4444');
  sockets.push(a, b, c, d);

  const created = await ack(a, 'room:create', {
    name: 'Aurora',
    kartId: 'rayo',
    mapId: 'coast',
  });
  assert.equal(created.ok, true);
  assert.match(created.room.code, VALID_CODE);
  const code = created.room.code;
  assert.equal(created.room.players.length, 1);
  assert.equal(created.room.players[0].isHost, true);
  assert.equal(created.youId, created.room.players[0].id);

  const wrong = await ack(b, 'room:join', {
    code: 'ZZZZZ',
    name: 'Boreal',
    kartId: 'lira',
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error, ERRORS.ROOM_NOT_FOUND);

  const joined = await ack(b, 'room:join', {
    code: code.toLowerCase(),
    name: 'Boreal',
    kartId: 'lira',
  });
  assert.equal(joined.ok, true);
  assert.equal(joined.room.players.length, 2);
  assert.equal(joined.room.hostId, created.youId);

  const duplicate = await ack(c, 'room:join', {
    code,
    name: 'aurora',
    kartId: 'titan',
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, ERRORS.NAME_TAKEN);

  const third = await ack(c, 'room:join', {
    code,
    name: 'Cobalto',
    kartId: 'titan',
  });
  assert.equal(third.ok, true);

  const full = await ack(d, 'room:join', {
    code,
    name: 'Duna',
    kartId: 'centella',
  });
  assert.equal(full.ok, false);
  assert.equal(full.error, ERRORS.ROOM_FULL);

  const nonHostMap = await ack(b, 'room:map', { mapId: 'city' });
  assert.equal(nonHostMap.ok, false);
  assert.equal(nonHostMap.error, ERRORS.NOT_HOST);

  const hostMap = await ack(a, 'room:map', { mapId: 'city' });
  assert.equal(hostMap.ok, true);
  assert.equal(hostMap.room.mapId, 'city');

  const nonHostStart = await ack(b, 'room:start', {});
  assert.equal(nonHostStart.ok, false);
  assert.equal(nonHostStart.error, ERRORS.NOT_HOST);

  const startPromise = once(b, 'race:start');
  const started = await ack(a, 'room:start', {});
  assert.equal(started.ok, true);
  const start = await startPromise;
  assert.equal(start.mapId, 'city');
  assert.equal(start.racers.length, 3);
  assert.ok(start.boxes.length > 0);

  const doubleStart = await ack(a, 'room:start', {});
  assert.equal(doubleStart.ok, false);
  assert.equal(doubleStart.error, ERRORS.RACE_STARTED);

  // Fuera de la cuenta atrás no se aceptan snapshots.
  const room = server.rooms.rooms.get(code);
  const stateA = room.race.getOwnState(created.youId);
  a.emit('race:state', rawFromState(stateA, { x: stateA.x + 1000 }));
  await sleep(50);

  await sleep(260);

  const relayPromise = once(b, 'race:state', (message) => message.id === created.youId);
  a.emit('race:state', rawFromState(stateA, { sp: 4 }));
  const relayed = await relayPromise;
  assert.equal(relayed.id, created.youId);
  assert.equal(relayed.sp, 4);
  assert.equal(relayed.lap, 1);

  // Un socket que no pertenece a la sala no puede inyectar estados.
  let injected = false;
  const spy = (message) => {
    if (message.id === 'intruso') injected = true;
  };
  b.on('race:state', spy);
  d.emit('race:state', {
    id: 'intruso',
    ...rawFromState(stateA),
  });
  await sleep(120);
  b.off('race:state', spy);
  assert.equal(injected, false);

  // Una caja solo se concede una vez, aunque dos clientes la pidan.
  const box = room.race.boxes[0];
  box.x = stateA.x;
  box.z = stateA.z;
  box.routeId = null;
  box.active = true;
  const announcedItem = start.boxes[0].itemId;
  const awardForB = once(b, 'item:award', (payload) => payload.playerId === created.youId);
  const claimA = await ack(a, 'item:claim', { boxIndex: 0 });
  const awarded = await awardForB;
  assert.equal(claimA.ok, true);
  assert.equal(claimA.itemId, announcedItem, 'el objeto entregado debe ser el anunciado');
  assert.equal(awarded.itemId, announcedItem, 'el HUD recibe el mismo objeto que la caja');
  assert.equal(room.race.players.get(created.youId).item, announcedItem);
  const claimAAgain = await ack(a, 'item:claim', { boxIndex: 0 });
  assert.equal(claimAAgain.ok, false);
  assert.equal(claimAAgain.error, 'inactive');

  // Boreal también intenta la misma caja desde su propia posición.
  const stateB = room.race.getOwnState(joined.youId);
  box.x = stateB.x;
  box.z = stateB.z;
  const statePromise = once(a, 'race:state', (message) => message.id === joined.youId);
  b.emit('race:state', rawFromState(stateB, { sp: 2 }));
  await statePromise;
  const claimB = await ack(b, 'item:claim', { boxIndex: 0 });
  assert.equal(claimB.ok, false);
  assert.equal(claimB.error, 'inactive');

  // El objeto concedido se puede usar una vez y queda validado por el servidor.
  // El evento visual llega tanto al jugador que lo activa como al resto: es lo
  // que dispara la onda del PULSO en cada cliente.
  const useForA = once(a, 'item:use', (payload) => payload.playerId === created.youId);
  const useForB = once(b, 'item:use', (payload) => payload.playerId === created.youId);
  const use = await ack(a, 'item:use', { itemId: claimA.itemId });
  const [useEventA, useEventB] = await Promise.all([useForA, useForB]);
  assert.equal(use.ok, true);
  assert.equal(use.itemId, claimA.itemId);
  assert.equal(useEventA.itemId, claimA.itemId);
  assert.equal(useEventB.itemId, claimA.itemId);
  assert.deepEqual(useEventA.targets, useEventB.targets);
  const useAgain = await ack(a, 'item:use', { itemId: claimA.itemId });
  assert.equal(useAgain.ok, false);
  assert.equal(useAgain.error, 'no-item');

  // El anfitrión se desconecta: el otro jugador pasa a serlo.
  const hostChange = once(b, 'presence', (payload) => payload.type === 'host');
  a.disconnect();
  const changed = await hostChange;
  assert.equal(changed.newHostName, 'Boreal');

  // Reconexión con el mismo identificador de cliente: conserva participante.
  const a2 = ioClient(url, {
    transports: ['websocket'],
    auth: { clientId: 'client-aaaa-1111' },
    reconnection: false,
    forceNew: true,
    timeout: 4000,
  });
  const resumePromise = once(a2, 'race:resume');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout reconectando')), 4000);
    a2.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    a2.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  sockets.push(a2);
  const resumed = await resumePromise;
  assert.equal(resumed.racers.length, 3);
  assert.ok(resumed.ownState);

  b.disconnect();
  a2.disconnect();
  await sleep(300);
});

test('autoridad: checkpoints, meta, teletransportes y objetos', () => {
  let clock = 1_000_000;
  const now = () => clock;
  const startAt = clock;
  const racers = [
    { id: 'p1', name: 'Uno', kartId: 'rayo' },
    { id: 'p2', name: 'Dos', kartId: 'lira' },
  ];
  const race = new RaceAuthority({
    mapId: 'coast',
    startAt,
    racers,
    now,
    random: () => 0,
    finishGraceMs: 60_000,
    maxRaceMs: 600_000,
  });
  const track = getHeadlessTrack('coast');
  const slot = CONFIG.grid[0];
  const startS = track.wrapS(track.startS - slot.back);
  const player = race.players.get('p1');

  // Avanza por la pista a velocidad realista (31 m/s), con snapshots a 20 Hz.
  let distance = 0;
  const step = 31 * 0.05;
  let finished = false;
  for (let i = 0; i < 6000 && !finished; i += 1) {
    clock += 50;
    distance += step;
    const s = track.wrapS(startS + distance);
    const point = track.posAt(s, slot.lateral);
    const state = race.updateState(
      'p1',
      {
        x: point.x,
        z: point.z,
        gy: point.y,
        h: 0,
        hd: track.headingAt(s),
        sp: 31,
        st: 0,
        route: null,
      },
      clock,
    );
    assert.ok(state, `snapshot válido en el paso ${i}`);
    finished = state.finished;
  }
  assert.equal(finished, true, 'completa 3 vueltas');
  assert.ok(player.finishTime > 0);
  assert.equal(player.lap, CONFIG.laps + 1);

  // Un salto imposible se rechaza y no altera el progreso.
  const before = player.progress;
  const teleport = race.updateState(
    'p1',
    { x: 9999, z: 9999, gy: 0, h: 0, hd: 0, sp: 40, st: 0 },
    clock + 50,
  );
  assert.equal(teleport, null);
  assert.equal(player.progress, before);

  // Caja y objeto: se prueban en una carrera nueva (los karts que ya han
  // terminado no pueden recoger cajas).
  clock += 2000;
  const itemRace = new RaceAuthority({
    mapId: 'coast',
    startAt: clock,
    racers: [{ id: 'p1', name: 'Uno', kartId: 'rayo' }],
    now,
    random: () => 0,
    finishGraceMs: 60_000,
    maxRaceMs: 600_000,
  });
  clock += 50;
  const itemPlayer = itemRace.players.get('p1');
  const initial = itemRace.updateState(
    'p1',
    {
      x: itemPlayer.lastX,
      z: itemPlayer.lastZ,
      gy: itemPlayer.last.gy,
      h: 0,
      hd: itemPlayer.last.hd,
      sp: 0,
      st: 0,
    },
    clock,
  );
  assert.ok(initial);
  const box = itemRace.boxes[0];
  box.x = itemPlayer.last.x;
  box.z = itemPlayer.last.z;
  box.routeId = null;
  box.active = true;
  // Aunque el generador aleatorio devuelva IMPULSO, la concesión debe respetar
  // el objeto que la caja ya mostraba al jugador (BARRERA).
  box.itemId = 'BARRERA';
  const first = itemRace.claimBox('p1', 0, clock);
  assert.equal(first.ok, true);
  assert.equal(first.itemId, box.itemId);
  assert.equal(first.itemId, 'BARRERA');
  assert.equal(itemPlayer.item, first.itemId);
  const second = itemRace.claimBox('p1', 0, clock + 10);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'inactive');

  // Uso validado y cooldown.
  const used = itemRace.useItem('p1', first.itemId, clock + 800);
  assert.equal(used.ok, true);
  assert.deepEqual(used.targets, []);
  const usedAgain = itemRace.useItem('p1', first.itemId, clock + 900);
  assert.equal(usedAgain.ok, false);
  assert.equal(usedAgain.reason, 'no-item');

  // Una caja reaparece pasado el tiempo, recibe un objeto nuevo y lo anuncia
  // con el mismo id que queda activo en el servidor.
  const tick = itemRace.tick(clock + 5000);
  assert.equal(tick.respawned.length, 1);
  assert.equal(itemRace.boxes[0].active, true);
  assert.equal(tick.respawned[0].itemId, itemRace.boxes[0].itemId);
});

test('autoridad: BARRERA y PULSO online, y objetos fuera del pool rechazados', () => {
  let clock = 7_000_000;
  const now = () => clock;
  const race = new RaceAuthority({
    mapId: 'coast',
    startAt: clock,
    racers: [
      { id: 'p1', name: 'Uno', kartId: 'rayo' },
      { id: 'p2', name: 'Dos', kartId: 'lira' },
      { id: 'p3', name: 'Tres', kartId: 'titan' },
    ],
    now,
    random: () => 0.5,
    finishGraceMs: 60_000,
    maxRaceMs: 600_000,
  });

  const p1 = race.players.get('p1');
  // p2 arranca cerca en la parrilla; p3 se aleja para quedar fuera del radio
  // del PULSO. Se mueve su último estado conocido, que es lo que consulta el
  // servidor al calcular objetivos.
  race.players.get('p3').last.x = p1.last.x + 500;
  race.players.get('p3').last.z = p1.last.z + 500;

  // BARRERA: efecto inmediato sobre uno mismo, sin objetivos.
  p1.item = 'BARRERA';
  const barrier = race.useItem('p1', 'BARRERA', clock + 1000);
  assert.equal(barrier.ok, true);
  assert.equal(barrier.itemId, 'BARRERA');
  assert.deepEqual(barrier.targets, []);
  assert.equal(p1.item, null);

  // PULSO: solo alcanza a los karts dentro del radio.
  p1.item = 'PULSO';
  const pulse = race.useItem('p1', 'PULSO', clock + 2000);
  assert.equal(pulse.ok, true);
  assert.deepEqual(pulse.targets, ['p2']);

  // Minas, furia y proyectiles no existen en online: el servidor los rechaza
  // aunque un cliente manipulado los pida con el objeto en la mano.
  for (const blocked of ['MINA', 'FURIA', 'PULSO_IMPACTO']) {
    p1.item = blocked;
    const denied = race.useItem('p1', blocked, clock + 3000);
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, 'item-offline');
    assert.equal(p1.item, blocked, 'un objeto rechazado no debe consumirse');
  }

  // El pool del servidor solo concede objetos de efecto inmediato.
  for (const roll of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
    const sample = new RaceAuthority({
      mapId: 'coast',
      startAt: clock,
      racers: [{ id: 'p1', name: 'Uno', kartId: 'rayo' }],
      now,
      random: () => roll,
      finishGraceMs: 60_000,
      maxRaceMs: 600_000,
    });
    for (const box of sample.boxes) {
      assert.ok(
        ONLINE_ITEM_POOL.includes(box.itemId),
        `objeto fuera del pool online: ${box.itemId}`,
      );
    }
  }
});

test('autoridad: la carrera termina por límite cuando alguien no acaba', () => {
  let clock = 5_000_000;
  const now = () => clock;
  const race = new RaceAuthority({
    mapId: 'mountain',
    startAt: clock,
    racers: [
      { id: 'p1', name: 'Uno', kartId: 'rayo' },
      { id: 'p2', name: 'Dos', kartId: 'lira' },
    ],
    now,
    random: () => 0.5,
    finishGraceMs: 1000,
    maxRaceMs: 10_000,
  });
  const track = getHeadlessTrack('mountain');
  const slot = CONFIG.grid[0];
  const startS = track.wrapS(track.startS - slot.back);

  // p1 termina; p2 se queda quieto.
  let distance = 0;
  for (let i = 0; i < 6000; i += 1) {
    clock += 50;
    distance += 31 * 0.05;
    const s = track.wrapS(startS + distance);
    const point = track.posAt(s, slot.lateral);
    const state = race.updateState(
      'p1',
      {
        x: point.x,
        z: point.z,
        gy: point.y,
        h: 0,
        hd: track.headingAt(s),
        sp: 31,
        st: 0,
      },
      clock,
    );
    if (state?.finished) break;
  }
  assert.equal(race.players.get('p1').finished, true);
  clock += 1100;
  const tick = race.tick(clock);
  assert.ok(tick.final);
  assert.equal(tick.final.reason, 'finish-deadline');
  assert.equal(tick.final.results[0].id, 'p1');
  assert.equal(tick.final.results[1].id, 'p2');
  assert.equal(race.tick(clock).final, null);
});

test('carrera online: final compartido y revancha del anfitrión', async (t) => {
  const server = createGameServer({
    port: 0,
    host: '127.0.0.1',
    serveClient: false,
    maxPlayers: 4,
    countdownMs: 80,
    finishGraceMs: 150,
    maxRaceMs: 1200,
    raceTickMs: 25,
    logger: { error() {} },
  });
  const address = await server.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];

  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await server.close();
  });

  const a = await connect(url, 'client-final-1111');
  const b = await connect(url, 'client-final-2222');
  sockets.push(a, b);

  const created = await ack(a, 'room:create', {
    name: 'Aurora',
    kartId: 'rayo',
    mapId: 'canyon',
  });
  assert.equal(created.ok, true);
  const code = created.room.code;
  const joined = await ack(b, 'room:join', { code, name: 'Boreal', kartId: 'lira' });
  assert.equal(joined.ok, true);

  const startA = once(a, 'race:start');
  const startB = once(b, 'race:start');
  const finalA = once(a, 'race:final', () => true, 5000);
  const finalB = once(b, 'race:final', () => true, 5000);
  assert.equal((await ack(a, 'room:start', {})).ok, true);
  await startA;
  const start = await startB;
  assert.equal(start.racers.length, 2);

  // Nadie cruza la meta: el servidor cierra la carrera por límite de tiempo
  // y envía el mismo resultado a todos.
  const final = await finalA;
  const finalOther = await finalB;
  assert.equal(final.reason, 'time-limit');
  assert.deepEqual(
    final.results.map((row) => row.position),
    [1, 2],
  );
  assert.deepEqual(finalOther.results, final.results);

  // Un invitado no puede pedir la revancha.
  const notHost = await ack(b, 'room:rematch', {});
  assert.equal(notHost.ok, false);
  assert.equal(notHost.error, ERRORS.NOT_HOST);

  const lobbyUpdate = once(b, 'room:update', (room) => room.status === 'lobby');
  const rematch = await ack(a, 'room:rematch', {});
  assert.equal(rematch.ok, true);
  const lobby = await lobbyUpdate;
  assert.equal(lobby.code, code);
  assert.equal(lobby.players.length, 2);
  assert.equal(lobby.raceId, null);

  // Con la sala de nuevo en el vestíbulo se puede cambiar de pista y repetir.
  const newMap = await ack(a, 'room:map', { mapId: 'orbital' });
  assert.equal(newMap.ok, true);
  assert.equal(newMap.room.mapId, 'orbital');
  assert.equal((await ack(a, 'room:start', {})).ok, true);
});

test('reconexión: reengancha a media carrera y conserva el estado', async (t) => {
  const server = createGameServer({
    port: 0,
    host: '127.0.0.1',
    serveClient: false,
    maxPlayers: 4,
    countdownMs: 120,
    disconnectGraceMs: 3000,
    emptyRoomTtlMs: 500,
    raceTickMs: 25,
    logger: { error() {} },
  });
  const address = await server.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];

  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await server.close();
  });

  const a = await connect(url, 'client-mid-aaaa');
  const b = await connect(url, 'client-mid-bbbb');
  sockets.push(a, b);

  const created = await ack(a, 'room:create', {
    name: 'Aurora',
    kartId: 'rayo',
    mapId: 'coast',
  });
  const code = created.room.code;
  const joined = await ack(b, 'room:join', { code, name: 'Boreal', kartId: 'lira' });
  assert.equal(joined.ok, true);

  const startB = once(b, 'race:start');
  assert.equal((await ack(a, 'room:start', {})).ok, true);
  await startB;
  await sleep(180); // deja atrás la cuenta atrás

  const room = server.rooms.rooms.get(code);
  const stateA = room.race.getOwnState(created.youId);
  const firstRelay = once(b, 'race:state', (message) => message.id === created.youId);
  a.emit('race:state', rawFromState(stateA, { sp: 6 }));
  assert.equal((await firstRelay).sp, 6);

  // El anfitrión se cae a media carrera y el otro pasa a serlo.
  const hostChange = once(b, 'presence', (payload) => payload.type === 'host', 4000);
  const disconnected = once(b, 'presence', (payload) => payload.type === 'disconnect', 4000);
  a.disconnect();
  const host = await hostChange;
  assert.equal(host.newHostId, joined.youId);
  const offline = await disconnected;
  assert.equal(offline.id, created.youId);
  assert.equal(offline.name, 'Aurora');

  // Vuelve con el mismo identificador dentro del margen: recibe race:resume
  // con su último estado, no con la parrilla inicial.
  const a2 = ioClient(url, {
    transports: ['websocket'],
    auth: { clientId: 'client-mid-aaaa' },
    reconnection: false,
    forceNew: true,
    timeout: 4000,
  });
  const resumed = once(a2, 'race:resume', () => true, 5000);
  const reconnected = once(b, 'presence', (payload) => payload.type === 'reconnect', 5000);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout reconectando')), 4000);
    a2.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    a2.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  sockets.push(a2);
  const resume = await resumed;
  assert.equal(resume.racers.length, 2);
  assert.equal(resume.ownState.sp, 6);
  assert.ok(Math.abs(resume.ownState.x - stateA.x) < 1e-6);
  assert.equal((await reconnected).id, created.youId);

  // Después de volver puede seguir enviando estados y el rival los recibe.
  // El servidor descarta snapshots a más de 80 Hz por jugador (12 ms); la
  // reconexión puede ocurrir tan rápido que el estado anterior es más reciente.
  await sleep(30);
  const secondRelay = once(b, 'race:state', (message) => message.id === created.youId, 4000);
  a2.emit('race:state', rawFromState(resume.ownState, { sp: 7 }));
  assert.equal((await secondRelay).sp, 7);

  // Si el que se cae no vuelve a tiempo, se le expulsa y el rival lo sabe.
  const left = once(
    a2,
    'presence',
    (payload) => payload.type === 'leave' && payload.id === joined.youId,
    7000,
  );
  b.disconnect();
  const bye = await left;
  assert.equal(bye.name, 'Boreal');
  assert.equal(room.race.players.get(joined.youId).left, true);
  assert.equal(room.race.standings().length, 1);
});

test('carrera de 4 jugadores: inicio, snapshots cruzados y final compartido', async (t) => {
  const server = createGameServer({
    port: 0,
    host: '127.0.0.1',
    serveClient: false,
    maxPlayers: 4,
    countdownMs: 120,
    finishGraceMs: 300,
    maxRaceMs: 1600,
    raceTickMs: 25,
    logger: { error() {} },
  });
  const address = await server.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];

  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await server.close();
  });

  const names = ['Aurora', 'Boreal', 'Cobalto', 'Duna'];
  const karts = ['rayo', 'lira', 'titan', 'centella'];
  const clients = [];
  for (let i = 0; i < 4; i += 1) {
    clients.push(await connect(url, `client-four-${i}${i}${i}${i}`));
  }
  sockets.push(...clients);

  const created = await ack(clients[0], 'room:create', {
    name: names[0],
    kartId: karts[0],
    mapId: 'coast',
  });
  assert.equal(created.ok, true);
  const code = created.room.code;
  for (let i = 1; i < 4; i += 1) {
    const joined = await ack(clients[i], 'room:join', {
      code,
      name: names[i],
      kartId: karts[i],
    });
    assert.equal(joined.ok, true);
    assert.equal(joined.room.players.length, i + 1);
  }

  // Con el límite en 4, el quinto no entra.
  const extra = await connect(url, 'client-four-eeee');
  const full = await ack(extra, 'room:join', { code, name: 'Eco', kartId: 'rayo' });
  assert.equal(full.ok, false);
  assert.equal(full.error, ERRORS.ROOM_FULL);
  extra.disconnect();

  const starts = clients.map((client) => once(client, 'race:start'));
  const finals = clients.map((client) => once(client, 'race:final', () => true, 8000));
  assert.equal((await ack(clients[0], 'room:start', {})).ok, true);
  const payloads = await Promise.all(starts);
  for (const payload of payloads) {
    assert.equal(payload.racers.length, 4);
    assert.deepEqual(
      payload.racers.map((racer) => racer.slot).sort(),
      [0, 1, 2, 3],
    );
    assert.equal(payload.boxes.length > 0, true);
  }

  await sleep(180); // fin de la cuenta atrás
  const room = server.rooms.rooms.get(code);
  const ids = payloads[0].racers.map((racer) => racer.id);
  const received = new Map(clients.map((_, index) => [index, new Set()]));
  clients.forEach((client, index) => {
    client.on('race:state', (message) => {
      if (message.id !== ids[index]) received.get(index).add(message.id);
    });
  });
  clients.forEach((client, index) => {
    const state = room.race.getOwnState(ids[index]);
    client.emit('race:state', rawFromState(state, { sp: 3 + index }));
  });
  await sleep(400);
  for (let index = 0; index < 4; index += 1) {
    assert.equal(received.get(index).size, 3, `cliente ${index} recibe a los otros tres`);
  }

  // La clasificación se comparte con los cuatro participantes.
  const standings = await once(
    clients[3],
    'race:standings',
    (payload) => payload.standings.length === 4,
    4000,
  );
  assert.deepEqual(
    standings.standings.map((row) => row.position),
    [1, 2, 3, 4],
  );
  assert.equal(new Set(standings.standings.map((row) => row.name)).size, 4);

  // El final también llega a los cuatro con el mismo orden.
  const results = await Promise.all(finals);
  for (const final of results) {
    assert.equal(final.results.length, 4);
    assert.deepEqual(finalOther(results[0]), finalOther(final));
  }
});

function finalOther(final) {
  return final.results.map((row) => `${row.position}:${row.id}`);
}

test('protocolo: códigos y nombres saneados', () => {
  assert.equal(isValidRoomCode('ABCDE'), true);
  assert.equal(isValidRoomCode('AB0DE'), false);
  assert.equal(isValidRoomCode('abcde'), false);
  assert.equal(getMap('coast').id, 'coast');
});

test('socket.io: valida Origin en WebSocket y polling, permite mismo origen y local', async (t) => {
  const warnings = [];
  const server = createGameServer({
    port: 0,
    host: '127.0.0.1',
    serveClient: false,
    clientOrigin: 'https://cliente.example',
    countdownMs: 80,
    logger: { error() {}, warn: (message) => warnings.push(message) },
  });
  const address = await server.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];

  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await server.close();
  });

  const open = async (clientId, options) => {
    const socket = await connect(url, clientId, options);
    sockets.push(socket);
    return socket;
  };

  // Cliente Node sin cabecera Origin: se acepta para no romper pruebas ni
  // herramientas internas. Un navegador siempre envía Origin.
  await open('origin-none');

  // Origen exacto configurado en CLIENT_ORIGIN, por WebSocket.
  await open('origin-allowed', {
    transports: ['websocket'],
    extraHeaders: { Origin: 'https://cliente.example' },
  });

  // Origen local de Vite, aunque CLIENT_ORIGIN apunte a producción.
  await open('origin-local', {
    transports: ['websocket'],
    extraHeaders: { Origin: 'http://localhost:5173' },
  });

  // Mismo origen del servidor (despliegue de una sola URL), por WebSocket.
  await open('origin-same', {
    transports: ['websocket'],
    extraHeaders: { Origin: url },
  });

  const rejected = (clientId, options) =>
    new Promise((resolve, reject) => {
      const socket = ioClient(url, {
        reconnection: false,
        forceNew: true,
        timeout: 4000,
        ...options,
        auth: { clientId },
      });
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('la conexión no se rechazó a tiempo'));
      }, 3000);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.close();
        reject(new Error('la conexión se aceptó con un origen no permitido'));
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        socket.close();
        resolve(error);
      });
    });

  // Origen ajeno rechazado en WebSocket...
  let started = Date.now();
  const evilWs = await rejected('origin-evil-ws', {
    transports: ['websocket'],
    extraHeaders: { Origin: 'https://evil.example' },
  });
  assert.ok(Date.now() - started < 2500, 'el rechazo WebSocket debe ser inmediato');
  assert.match(evilWs.message, /error|403|forbidden/i);

  // ...y también en polling.
  started = Date.now();
  const evilPolling = await rejected('origin-evil-polling', {
    transports: ['polling'],
    extraHeaders: { Origin: 'https://evil.example' },
  });
  assert.ok(Date.now() - started < 2500, 'el rechazo de polling debe ser inmediato');
  assert.match(evilPolling.message, /error|403|forbidden/i);

  assert.ok(warnings.some((message) => message.includes('https://evil.example')));
});
