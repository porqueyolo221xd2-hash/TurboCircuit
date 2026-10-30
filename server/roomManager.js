// Gestión de salas privadas, presencia, anfitrión y carrera.
// Toda la información vive en memoria: no hay base de datos ni credenciales.
import { randomInt, randomUUID } from 'node:crypto';
import {
  COUNTDOWN_MS,
  DEFAULT_MAX_PLAYERS,
  DISCONNECT_GRACE_MS,
  EMPTY_ROOM_TTL_MS,
  ERRORS,
  MAX_PLAYERS_LIMIT,
  MIN_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  STANDINGS_INTERVAL_MS,
  isValidKart,
  isValidMap,
  isValidRoomCode,
  normalizeRoomCode,
  publicPlayer,
  sanitizeName,
} from '../shared/protocol.js';
import { RaceAuthority } from './raceAuthority.js';

const NAME_MAX = 16;

function fail(ack, error) {
  if (typeof ack === 'function') ack({ ok: false, error });
}

function ok(ack, payload) {
  if (typeof ack === 'function') ack({ ok: true, ...payload });
}

function safeClientId(value) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return clean.length >= 8 ? clean : null;
}

export class RoomManager {
  constructor({
    io,
    maxPlayers = DEFAULT_MAX_PLAYERS,
    countdownMs = COUNTDOWN_MS,
    disconnectGraceMs = DISCONNECT_GRACE_MS,
    emptyRoomTtlMs = EMPTY_ROOM_TTL_MS,
    finishGraceMs,
    maxRaceMs,
    now = Date.now,
    random = Math.random,
  }) {
    this.io = io;
    this.maxPlayers = Math.max(2, Math.min(MAX_PLAYERS_LIMIT, Number(maxPlayers) || DEFAULT_MAX_PLAYERS));
    this.countdownMs = countdownMs;
    this.disconnectGraceMs = disconnectGraceMs;
    this.emptyRoomTtlMs = emptyRoomTtlMs;
    this.finishGraceMs = finishGraceMs;
    this.maxRaceMs = maxRaceMs;
    this.now = now;
    this.random = random;

    this.rooms = new Map();
    this.byClient = new Map();
    this.bySocket = new Map();
  }

  // -------------------------------------------------------------------------
  // Conexión y reconexión
  // -------------------------------------------------------------------------

  attachSocket(socket) {
    const clientId = safeClientId(socket.handshake.auth?.clientId) ?? randomUUID();
    socket.data.clientId = clientId;
    socket.data.online = {
      roomCode: null,
      playerId: null,
      counters: new Map(),
    };
    this.bySocket.set(socket.id, { clientId });

    this.bindSocket(socket);
    this.tryReattach(socket, clientId);
  }

  tryReattach(socket, clientId) {
    const link = this.byClient.get(clientId);
    if (!link) return false;
    const room = this.rooms.get(link.roomCode);
    if (!room) {
      this.byClient.delete(clientId);
      return false;
    }
    const player = room.players.get(link.playerId);
    if (!player) {
      this.byClient.delete(clientId);
      return false;
    }

    const previous = player.socketId ? this.io.sockets.sockets.get(player.socketId) : null;
    if (previous && previous.connected && previous.id !== socket.id) {
      // Evita que dos pestañas con el mismo identificador controlen el mismo
      // participante a la vez. El cliente normal usa un id por pestaña.
      socket.emit('online:error', { error: ERRORS.ALREADY_IN_ROOM });
      return false;
    }

    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    player.socketId = socket.id;
    player.connected = true;
    player.lastSeen = this.now();
    socket.join(room.code);
    socket.data.online.roomCode = room.code;
    socket.data.online.playerId = player.id;
    this.bySocket.set(socket.id, { clientId, roomCode: room.code, playerId: player.id });
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }
    if (room.race) room.race.setConnected(player.id, true);

    socket.emit('online:you', { playerId: player.id, clientId });
    this.emitRoom(room);
    this.emitPresence(room, {
      type: 'reconnect',
      id: player.id,
      name: player.name,
      newHostName: this.hostName(room),
    });

    if (room.status === 'racing' && room.race) {
      socket.emit('race:resume', {
        ...room.race.startPayload(),
        ownState: room.race.getOwnState(player.id),
        standings: room.race.standings(),
      });
    } else if (room.status === 'finished' && room.race?.final) {
      socket.emit('race:final', room.race.final);
    }
    this.ensureEmptyCleanup(room);
    return true;
  }

  bindSocket(socket) {
    socket.on('room:create', (payload, ack) => this.createRoom(socket, payload, ack));
    socket.on('room:join', (payload, ack) => this.joinRoom(socket, payload, ack));
    socket.on('room:leave', (_payload, ack) => this.leaveRoom(socket, true, ack));
    socket.on('room:map', (payload, ack) => this.setMap(socket, payload, ack));
    socket.on('room:start', (_payload, ack) => this.startRace(socket, ack));
    socket.on('room:rematch', (_payload, ack) => this.rematch(socket, ack));
    socket.on('race:state', (payload) => this.receiveState(socket, payload));
    socket.on('item:claim', (payload, ack) => this.claimBox(socket, payload, ack));
    socket.on('item:use', (payload, ack) => this.useItem(socket, payload, ack));
    socket.on('time:sync', (payload, ack) => {
      if (typeof ack === 'function') {
        ack({ clientT0: payload?.t0 ?? null, serverNow: this.now() });
      }
    });
    socket.on('disconnect', () => this.handleDisconnect(socket));
  }

  // -------------------------------------------------------------------------
  // Ayudas
  // -------------------------------------------------------------------------

  publicRoom(room) {
    return {
      code: room.code,
      status: room.status,
      maxPlayers: room.maxPlayers,
      hostId: room.hostId,
      mapId: room.mapId,
      raceId: room.raceId ?? null,
      raceStartAt: room.raceStartAt ?? null,
      players: [...room.players.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((player) => publicPlayer(player, room.hostId)),
    };
  }

  emitRoom(room) {
    this.io.to(room.code).emit('room:update', this.publicRoom(room));
  }

  emitPresence(room, payload) {
    this.io.to(room.code).emit('presence', payload);
  }

  hostName(room) {
    return room.players.get(room.hostId)?.name ?? '';
  }

  canStart(room) {
    return room.status === 'lobby' && room.players.size >= MIN_PLAYERS;
  }

  allow(socket, key, limit, windowMs) {
    const bucket = socket.data.online?.counters.get(key) ?? [];
    const now = this.now();
    while (bucket.length && now - bucket[0] > windowMs) bucket.shift();
    if (bucket.length >= limit) return false;
    bucket.push(now);
    socket.data.online.counters.set(key, bucket);
    return true;
  }

  member(socket) {
    const code = socket.data.online?.roomCode;
    const playerId = socket.data.online?.playerId;
    const room = code ? this.rooms.get(code) : null;
    const player = room && playerId ? room.players.get(playerId) : null;
    if (!room || !player || player.socketId !== socket.id) return null;
    return { room, player };
  }

  generateCode() {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
        code += ROOM_CODE_ALPHABET[randomInt(0, ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code) && isValidRoomCode(code)) return code;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Salas
  // -------------------------------------------------------------------------

  createRoom(socket, payload, ack) {
    if (!this.allow(socket, 'room', 12, 60_000)) return fail(ack, ERRORS.RATE_LIMITED);
    if (this.member(socket)) return fail(ack, ERRORS.ALREADY_IN_ROOM);
    const name = sanitizeName(payload?.name);
    if (!name || name.length > NAME_MAX) return fail(ack, ERRORS.INVALID_NAME);
    if (!isValidMap(payload?.mapId)) return fail(ack, ERRORS.INVALID_MAP);
    if (!isValidKart(payload?.kartId)) return fail(ack, ERRORS.INVALID_KART);

    const code = this.generateCode();
    if (!code) return fail(ack, ERRORS.SERVER_ERROR);
    const playerId = randomUUID();
    const now = this.now();
    const room = {
      code,
      hostId: playerId,
      status: 'lobby',
      mapId: payload.mapId,
      maxPlayers: this.maxPlayers,
      players: new Map(),
      createdAt: now,
      race: null,
      raceId: null,
      raceStartAt: null,
      lastStandingsAt: 0,
      emptyTimer: null,
      raceTimer: null,
    };
    const player = {
      id: playerId,
      clientId: socket.data.clientId,
      name,
      kartId: payload.kartId,
      socketId: socket.id,
      connected: true,
      joinedAt: now,
      lastSeen: now,
      disconnectTimer: null,
    };
    room.players.set(playerId, player);
    this.rooms.set(code, room);
    this.byClient.set(player.clientId, { roomCode: code, playerId });
    socket.join(code);
    socket.data.online.roomCode = code;
    socket.data.online.playerId = playerId;
    this.bySocket.set(socket.id, { clientId: player.clientId, roomCode: code, playerId });

    ok(ack, { room: this.publicRoom(room), youId: playerId });
    this.emitRoom(room);
    return true;
  }

  joinRoom(socket, payload, ack) {
    if (!this.allow(socket, 'join', 20, 60_000)) return fail(ack, ERRORS.RATE_LIMITED);
    if (this.member(socket)) return fail(ack, ERRORS.ALREADY_IN_ROOM);
    const code = normalizeRoomCode(payload?.code);
    if (!isValidRoomCode(code)) return fail(ack, ERRORS.INVALID_CODE);
    const room = this.rooms.get(code);
    if (!room) return fail(ack, ERRORS.ROOM_NOT_FOUND);
    if (room.status !== 'lobby') return fail(ack, ERRORS.RACE_STARTED);
    if (room.players.size >= room.maxPlayers) return fail(ack, ERRORS.ROOM_FULL);
    const name = sanitizeName(payload?.name);
    if (!name || name.length > NAME_MAX) return fail(ack, ERRORS.INVALID_NAME);
    if (!isValidKart(payload?.kartId)) return fail(ack, ERRORS.INVALID_KART);
    const taken = [...room.players.values()].some(
      (player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (taken) return fail(ack, ERRORS.NAME_TAKEN);

    const playerId = randomUUID();
    const player = {
      id: playerId,
      clientId: socket.data.clientId,
      name,
      kartId: payload.kartId,
      socketId: socket.id,
      connected: true,
      joinedAt: this.now(),
      lastSeen: this.now(),
      disconnectTimer: null,
    };
    room.players.set(playerId, player);
    this.byClient.set(player.clientId, { roomCode: code, playerId });
    socket.join(code);
    socket.data.online.roomCode = code;
    socket.data.online.playerId = playerId;
    this.bySocket.set(socket.id, { clientId: player.clientId, roomCode: code, playerId });

    ok(ack, { room: this.publicRoom(room), youId: playerId });
    this.emitRoom(room);
    this.emitPresence(room, { type: 'join', id: playerId, name });
    return true;
  }

  leaveRoom(socket, announce = true, ack = null) {
    const membership = this.member(socket);
    if (!membership) return fail(ack, ERRORS.NOT_IN_ROOM);
    const { room, player } = membership;
    // Salir del canal antes de avisar evita que quien abandona reciba su
    // propio room:update y se quede con una sala a la que ya no pertenece.
    socket.leave(room.code);
    socket.data.online.roomCode = null;
    socket.data.online.playerId = null;
    this.removeParticipant(room, player, { announce, reason: 'leave' });
    this.bySocket.delete(socket.id);
    ok(ack, {});
    return true;
  }

  removeParticipant(room, player, { announce = true, reason = 'leave' } = {}) {
    if (!room.players.has(player.id)) return;
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    room.players.delete(player.id);
    this.byClient.delete(player.clientId);
    if (player.socketId) {
      const link = this.bySocket.get(player.socketId);
      if (link?.roomCode === room.code) this.bySocket.delete(player.socketId);
    }
    if (room.race) {
      room.race.removePlayer(player.id);
      this.io.to(room.code).emit('race:player-left', { id: player.id, name: player.name });
    }

    if (room.hostId === player.id) {
      this.transferHost(room);
    }

    if (announce) {
      this.emitPresence(room, {
        type: reason === 'expired' ? 'leave' : 'leave',
        id: player.id,
        name: player.name,
        newHostName: this.hostName(room),
      });
    }

    if (room.players.size === 0) {
      this.scheduleEmptyDelete(room);
    } else {
      this.emitRoom(room);
      this.ensureEmptyCleanup(room);
    }
  }

  transferHost(room) {
    const connected = [...room.players.values()]
      .filter((player) => player.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    const next = connected[0] ?? [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next && room.hostId !== next.id) {
      room.hostId = next.id;
      this.emitPresence(room, {
        type: 'host',
        id: next.id,
        name: next.name,
        newHostId: next.id,
        newHostName: next.name,
      });
      this.emitRoom(room);
    }
  }

  setMap(socket, payload, ack) {
    if (!this.allow(socket, 'map', 10, 10_000)) return fail(ack, ERRORS.RATE_LIMITED);
    const membership = this.member(socket);
    if (!membership) return fail(ack, ERRORS.NOT_IN_ROOM);
    const { room, player } = membership;
    if (room.hostId !== player.id) return fail(ack, ERRORS.NOT_HOST);
    if (room.status !== 'lobby') return fail(ack, ERRORS.RACE_STARTED);
    if (!isValidMap(payload?.mapId)) return fail(ack, ERRORS.INVALID_MAP);
    room.mapId = payload.mapId;
    this.emitRoom(room);
    ok(ack, { room: this.publicRoom(room) });
    return true;
  }

  startRace(socket, ack) {
    if (!this.allow(socket, 'start', 8, 10_000)) return fail(ack, ERRORS.RATE_LIMITED);
    const membership = this.member(socket);
    if (!membership) return fail(ack, ERRORS.NOT_IN_ROOM);
    const { room, player } = membership;
    if (room.hostId !== player.id) return fail(ack, ERRORS.NOT_HOST);
    if (room.status !== 'lobby') return fail(ack, ERRORS.RACE_STARTED);
    if (!this.canStart(room)) return fail(ack, ERRORS.SERVER_ERROR);

    const now = this.now();
    const startAt = now + this.countdownMs;
    const racers = [...room.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        name: p.name,
        kartId: p.kartId,
        connected: p.connected,
      }));
    room.race = new RaceAuthority({
      mapId: room.mapId,
      startAt,
      racers,
      now: this.now,
      countdownMs: this.countdownMs,
      random: this.random,
      finishGraceMs: this.finishGraceMs,
      maxRaceMs: this.maxRaceMs,
    });
    room.status = 'racing';
    room.raceId = room.race.raceId;
    room.raceStartAt = startAt;
    room.lastStandingsAt = 0;
    for (const racer of racers) {
      room.race.setConnected(racer.id, room.players.get(racer.id)?.connected !== false);
    }
    const payload = room.race.startPayload();
    this.io.to(room.code).emit('race:start', payload);
    this.emitRoom(room);
    ok(ack, { raceId: room.raceId, startAt });
    return true;
  }

  receiveState(socket, payload) {
    if (!this.allow(socket, 'state', 45, 1000)) return;
    const membership = this.member(socket);
    if (!membership || membership.room.status !== 'racing' || !membership.room.race) return;
    const state = membership.room.race.updateState(
      membership.player.id,
      payload,
      this.now(),
    );
    if (!state) return;
    socket.to(membership.room.code).emit('race:state', state);
  }

  claimBox(socket, payload, ack) {
    if (!this.allow(socket, 'claim', 12, 1000)) return fail(ack, ERRORS.RATE_LIMITED);
    const membership = this.member(socket);
    if (!membership) return fail(ack, ERRORS.NOT_IN_ROOM);
    const { room, player } = membership;
    if (room.status !== 'racing' || !room.race) return fail(ack, ERRORS.NOT_ACTIVE);
    if (!Number.isInteger(payload?.boxIndex)) return fail(ack, ERRORS.BAD_STATE);
    const result = room.race.claimBox(player.id, payload.boxIndex, this.now());
    if (!result.ok) {
      socket.emit('item:denied', { boxIndex: payload.boxIndex, reason: result.reason });
      return fail(ack, result.reason);
    }
    this.io.to(room.code).emit('item:award', result);
    ok(ack, result);
    return true;
  }

  useItem(socket, payload, ack) {
    if (!this.allow(socket, 'use', 8, 1000)) return fail(ack, ERRORS.RATE_LIMITED);
    const membership = this.member(socket);
    if (!membership) return fail(ack, ERRORS.NOT_IN_ROOM);
    const { room, player } = membership;
    if (room.status !== 'racing' || !room.race) return fail(ack, ERRORS.NOT_ACTIVE);
    const result = room.race.useItem(player.id, payload?.itemId, this.now());
    if (!result.ok) {
      socket.emit('item:denied', { itemId: payload?.itemId, reason: result.reason });
      return fail(ack, result.reason);
    }
    this.io.to(room.code).emit('item:use', result);
    ok(ack, result);
    return true;
  }

  rematch(socket, ack) {
    const membership = this.member(socket);
    if (!membership) return fail(ack, ERRORS.NOT_IN_ROOM);
    const { room, player } = membership;
    if (room.hostId !== player.id) return fail(ack, ERRORS.NOT_HOST);
    if (room.status !== 'finished') return fail(ack, ERRORS.RACE_STARTED);
    room.status = 'lobby';
    room.race = null;
    room.raceId = null;
    room.raceStartAt = null;
    room.lastStandingsAt = 0;
    this.emitRoom(room);
    ok(ack, { room: this.publicRoom(room) });
    return true;
  }

  // -------------------------------------------------------------------------
  // Desconexión y limpieza
  // -------------------------------------------------------------------------

  handleDisconnect(socket) {
    this.bySocket.delete(socket.id);
    const membership = this.member(socket);
    if (!membership) return;
    const { room, player } = membership;
    player.connected = false;
    player.lastSeen = this.now();
    if (room.race) room.race.setConnected(player.id, false);

    if (room.hostId === player.id) this.transferHost(room);
    this.emitRoom(room);
    this.emitPresence(room, {
      type: 'disconnect',
      id: player.id,
      name: player.name,
      newHostName: this.hostName(room),
    });

    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = setTimeout(() => {
      player.disconnectTimer = null;
      if (player.connected) return;
      const current = this.rooms.get(room.code);
      if (!current || !current.players.has(player.id)) return;
      this.removeParticipant(current, player, { announce: true, reason: 'expired' });
    }, this.disconnectGraceMs);
    if (typeof player.disconnectTimer.unref === 'function') player.disconnectTimer.unref();

    this.ensureEmptyCleanup(room);
  }

  ensureEmptyCleanup(room) {
    const anyConnected = [...room.players.values()].some((player) => player.connected);
    if (anyConnected) {
      if (room.emptyTimer) {
        clearTimeout(room.emptyTimer);
        room.emptyTimer = null;
      }
      return;
    }
    if (room.emptyTimer) return;
    room.emptyTimer = setTimeout(() => {
      room.emptyTimer = null;
      const current = this.rooms.get(room.code);
      if (!current) return;
      const stillEmpty = ![...current.players.values()].some((player) => player.connected);
      if (stillEmpty) this.deleteRoom(current, 'empty');
    }, this.emptyRoomTtlMs);
    if (typeof room.emptyTimer.unref === 'function') room.emptyTimer.unref();
  }

  scheduleEmptyDelete(room) {
    if (room.emptyTimer) clearTimeout(room.emptyTimer);
    room.emptyTimer = setTimeout(() => {
      room.emptyTimer = null;
      const current = this.rooms.get(room.code);
      if (!current) return;
      if ([...current.players.values()].some((player) => player.connected)) return;
      this.deleteRoom(current, 'empty');
    }, this.emptyRoomTtlMs);
    if (typeof room.emptyTimer.unref === 'function') room.emptyTimer.unref();
  }

  deleteRoom(room, reason = 'closed') {
    if (!this.rooms.has(room.code)) return;
    this.rooms.delete(room.code);
    if (room.emptyTimer) clearTimeout(room.emptyTimer);
    room.emptyTimer = null;
    for (const player of room.players.values()) {
      if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
      this.byClient.delete(player.clientId);
      this.bySocket.delete(player.socketId);
    }
    this.io.to(room.code).emit('room:closed', { reason });
    this.io.socketsLeave(room.code);
  }

  tick(now = this.now()) {
    for (const room of this.rooms.values()) {
      if (room.status !== 'racing' || !room.race) continue;
      const { respawned, final } = room.race.tick(now);
      for (const box of respawned) {
        this.io.to(room.code).emit('item:box', box);
      }
      if (now - room.lastStandingsAt >= STANDINGS_INTERVAL_MS) {
        room.lastStandingsAt = now;
        this.io.to(room.code).emit('race:standings', {
          raceId: room.raceId,
          standings: room.race.standings(),
          at: now,
        });
      }
      if (final) {
        room.status = 'finished';
        this.io.to(room.code).emit('race:final', final);
        this.emitRoom(room);
      }
    }
  }

  stats() {
    let players = 0;
    for (const room of this.rooms.values()) players += room.players.size;
    return { rooms: this.rooms.size, players };
  }

  dispose() {
    for (const room of this.rooms.values()) {
      if (room.emptyTimer) clearTimeout(room.emptyTimer);
      for (const player of room.players.values()) {
        if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
      }
    }
    this.rooms.clear();
    this.byClient.clear();
    this.bySocket.clear();
  }
}
