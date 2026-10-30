// Cliente de red: conexión, sala, snapshots y reloj estimado del servidor.
// No decide resultados: solo envía el estado local y aplica lo que confirma
// el servidor.
import { io } from 'socket.io-client';
import { STATE_INTERVAL_MS } from '../../shared/protocol.js';
import { SERVER_URL, sessionStorageSafe } from './config.js';

const CLIENT_KEY = 'turbo-circuit-online-client-v1';
const STATE_SECONDS = STATE_INTERVAL_MS / 1000;

function createClientId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // Navegadores antiguos o contextos sin crypto.
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadClientId() {
  const storage = sessionStorageSafe();
  if (storage) {
    try {
      const saved = storage.getItem(CLIENT_KEY);
      if (saved && saved.length >= 8) return saved;
    } catch {
      // sessionStorage puede estar bloqueado.
    }
  }
  const id = createClientId();
  try {
    storage?.setItem(CLIENT_KEY, id);
  } catch {
    // Sin persistencia: la reconexión de la misma pestaña seguirá funcionando
    // mientras no se recargue la página.
  }
  return id;
}

const noop = () => {};

export class OnlineClient {
  constructor(handlers = {}) {
    this.handlers = {
      onStatus: handlers.onStatus ?? noop,
      onRoom: handlers.onRoom ?? noop,
      onRoomClosed: handlers.onRoomClosed ?? noop,
      onPresence: handlers.onPresence ?? noop,
      onRaceStart: handlers.onRaceStart ?? noop,
      onRaceResume: handlers.onRaceResume ?? noop,
      onRaceState: handlers.onRaceState ?? noop,
      onStandings: handlers.onStandings ?? noop,
      onFinal: handlers.onFinal ?? noop,
      onPlayerLeft: handlers.onPlayerLeft ?? noop,
      onItemAward: handlers.onItemAward ?? noop,
      onItemBox: handlers.onItemBox ?? noop,
      onItemUse: handlers.onItemUse ?? noop,
      onItemDenied: handlers.onItemDenied ?? noop,
      onError: handlers.onError ?? noop,
    };
    this.clientId = loadClientId();
    this.socket = null;
    this.room = null;
    this.selfId = null;
    this.connected = false;
    this.clockOffset = 0;
    this.syncTimer = null;
    this.resyncTimer = null;
    this.pendingResync = false;
    this.stateAccumulator = 0;
  }

  get configUrl() {
    return SERVER_URL;
  }

  clearResync() {
    if (this.resyncTimer) {
      window.clearTimeout(this.resyncTimer);
      this.resyncTimer = null;
    }
  }

  /** Espera a tener conexión antes de crear/unirse: evita timeouts de ack. */
  ready(timeout = 8000) {
    if (this.socket?.connected) return Promise.resolve(true);
    const socket = this.connect();
    if (socket.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        socket.off('connect', onConnect);
        resolve(value);
      };
      const onConnect = () => finish(true);
      const timer = window.setTimeout(() => finish(false), timeout);
      socket.once('connect', onConnect);
    });
  }

  connect() {
    if (this.socket) {
      if (!this.socket.connected) this.socket.connect();
      return this.socket;
    }

    this.socket = io(SERVER_URL, {
      autoConnect: true,
      transports: ['websocket', 'polling'],
      auth: { clientId: this.clientId },
      reconnection: true,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4000,
      reconnectionAttempts: Infinity,
      timeout: 8000,
      forceNew: true,
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this.handlers.onStatus({ state: 'connected', serverUrl: SERVER_URL });
      this.syncClock();
      if (this.syncTimer) clearInterval(this.syncTimer);
      this.syncTimer = setInterval(() => this.syncClock(), 15_000);
      if (this.pendingResync) {
        this.pendingResync = false;
        // El servidor reengancha al participante y manda room:update. Si no
        // llega, la sala ya no existe (expulsado o borrada por inactividad).
        this.clearResync();
        this.resyncTimer = window.setTimeout(() => {
          this.resyncTimer = null;
          if (!this.room) return;
          this.room = null;
          this.handlers.onRoomClosed({ reason: 'expired' });
        }, 2500);
      }
    });
    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      if (this.room && reason !== 'io client disconnect') this.pendingResync = true;
      this.handlers.onStatus({ state: 'reconnecting', reason });
    });
    this.socket.on('connect_error', () => {
      this.connected = false;
      this.handlers.onStatus({ state: 'offline', serverUrl: SERVER_URL });
    });
    this.socket.on('online:you', ({ playerId, clientId }) => {
      if (playerId) this.selfId = playerId;
      if (clientId) this.clientId = clientId;
    });
    this.socket.on('online:error', ({ error }) => {
      this.handlers.onError(error);
    });
    this.socket.on('room:update', (room) => {
      this.clearResync();
      this.room = room;
      this.handlers.onRoom(room);
    });
    this.socket.on('room:closed', (payload) => {
      this.clearResync();
      this.pendingResync = false;
      this.room = null;
      this.handlers.onRoomClosed(payload);
    });
    this.socket.on('presence', (payload) => this.handlers.onPresence(payload));
    this.socket.on('race:start', (payload) => {
      if (this.room) this.room.status = 'racing';
      this.handlers.onRaceStart(payload);
    });
    this.socket.on('race:resume', (payload) => this.handlers.onRaceResume(payload));
    this.socket.on('race:state', (payload) => this.handlers.onRaceState(payload));
    this.socket.on('race:standings', (payload) => this.handlers.onStandings(payload));
    this.socket.on('race:final', (payload) => this.handlers.onFinal(payload));
    this.socket.on('race:player-left', (payload) => this.handlers.onPlayerLeft(payload));
    this.socket.on('item:award', (payload) => this.handlers.onItemAward(payload));
    this.socket.on('item:box', (payload) => this.handlers.onItemBox(payload));
    this.socket.on('item:use', (payload) => this.handlers.onItemUse(payload));
    this.socket.on('item:denied', (payload) => this.handlers.onItemDenied(payload));
    return this.socket;
  }

  serverNow() {
    return Date.now() + this.clockOffset;
  }

  async syncClock() {
    if (!this.socket?.connected) return;
    const t0 = Date.now();
    const result = await this.emitAck('time:sync', { t0 }, 3000);
    if (!result?.ok && !Number.isFinite(result?.serverNow)) return;
    const rtt = Date.now() - t0;
    const sample = result.serverNow - (t0 + rtt / 2);
    // Suavizado: evita que un pico de latencia mueva la cuenta atrás.
    this.clockOffset = this.clockOffset === 0 ? sample : this.clockOffset * 0.7 + sample * 0.3;
  }

  emitAck(event, payload = {}, timeout = 6000) {
    if (!this.socket?.connected) {
      return Promise.resolve({ ok: false, error: 'timeout' });
    }
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: 'timeout' });
      }, timeout);
      this.socket.emit(event, payload, (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result ?? { ok: false, error: 'server-error' });
      });
    });
  }

  async createRoom({ name, kartId, mapId }) {
    const result = await this.emitAck('room:create', { name, kartId, mapId });
    if (result.ok) {
      this.selfId = result.youId ?? this.selfId;
      this.room = result.room;
      this.handlers.onRoom(result.room);
    }
    return result;
  }

  async joinRoom({ name, code, kartId }) {
    const result = await this.emitAck('room:join', { name, code, kartId });
    if (result.ok) {
      this.selfId = result.youId ?? this.selfId;
      this.room = result.room;
      this.handlers.onRoom(result.room);
    }
    return result;
  }

  async leaveRoom() {
    const result = await this.emitAck('room:leave', {});
    this.clearResync();
    this.pendingResync = false;
    this.room = null;
    return result;
  }

  async setMap(mapId) {
    const result = await this.emitAck('room:map', { mapId });
    if (result.ok && result.room) {
      this.room = result.room;
      this.handlers.onRoom(result.room);
    }
    return result;
  }

  async startRace() {
    return this.emitAck('room:start', {});
  }

  async requestRematch() {
    const result = await this.emitAck('room:rematch', {});
    if (result.ok && result.room) {
      this.room = result.room;
      this.handlers.onRoom(result.room);
    }
    return result;
  }

  claimBox(boxIndex) {
    if (!this.socket?.connected) return;
    if (this.room?.status !== 'racing') return;
    this.socket.emit('item:claim', { boxIndex });
  }

  async useItem(itemId) {
    return this.emitAck('item:use', { itemId }, 3000);
  }

  /** Envía como máximo un snapshot cada 50 ms; los estados son descartables. */
  update(dt, getState) {
    if (!this.connected || this.room?.status !== 'racing') {
      this.stateAccumulator = 0;
      return;
    }
    this.stateAccumulator += dt;
    if (this.stateAccumulator < STATE_SECONDS) return;
    this.stateAccumulator = 0;
    const state = getState();
    if (state) this.socket.volatile.emit('race:state', state);
  }

  dispose() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
    this.clearResync();
    this.pendingResync = false;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
    }
    this.socket = null;
    this.room = null;
    this.selfId = null;
    this.connected = false;
  }
}
