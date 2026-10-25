// Interfaz HTML: pantallas, HUD, resultados y minimapa dibujado en canvas.
import { clamp, formatTime } from './utils.js';

export class UI {
  constructor() {
    const byId = (id) => document.getElementById(id);
    this.el = {
      menu: byId('screen-menu'),
      hud: byId('hud'),
      countdown: byId('countdown'),
      countdownValue: byId('countdown-value'),
      pause: byId('screen-pause'),
      results: byId('screen-results'),
      resultsTitle: byId('results-title'),
      resultsPosition: byId('results-position'),
      resultsStars: byId('results-stars'),
      resultsBody: byId('results-body'),
      resultsNote: byId('results-note'),
      lap: byId('hud-lap'),
      lapTotal: byId('hud-lap-total'),
      position: byId('hud-position'),
      time: byId('hud-time'),
      lapTime: byId('hud-lap-time'),
      best: byId('hud-best'),
      speed: byId('hud-speed'),
      speedBar: byId('hud-speed-bar'),
      turboMeter: byId('turbo-meter'),
      turboBar: byId('turbo-bar-fill'),
      turboState: byId('turbo-state'),
      speedFx: byId('speed-fx'),
      itemCard: byId('item-card'),
      itemIcon: byId('item-icon'),
      itemName: byId('item-name'),
      itemState: byId('item-state'),
      offroad: byId('offroad'),
      minimap: byId('minimap'),
      soundButton: byId('btn-sound'),
      startButton: byId('btn-start'),
      resumeButton: byId('btn-resume'),
      restartButton: byId('btn-restart'),
      againButton: byId('btn-again'),
      menuButton: byId('btn-menu'),
      pauseButton: byId('btn-pause'),
      difficultyButtons: Array.from(document.querySelectorAll('[data-difficulty]')),
      difficultyCurrent: byId('difficulty-current'),
      difficultyDesc: byId('difficulty-desc'),
      difficultyHud: byId('hud-difficulty'),
      impactFx: byId('impact-fx'),
      mapButtons: Array.from(document.querySelectorAll('[data-map]')),
      mapCurrent: byId('map-current'),
      mapDesc: byId('map-desc'),
      hudMapName: byId('hud-map-name'),
      kartButtons: Array.from(document.querySelectorAll('[data-kart]')),
      kartCurrent: byId('kart-current'),
      kartTagline: byId('kart-tagline'),
      kartDesc: byId('kart-desc'),
      kartPrev: byId('btn-kart-prev'),
      kartNext: byId('btn-kart-next'),
      kartPreview: byId('kart-preview'),
      statBars: Array.from(document.querySelectorAll('[data-stat]')),
    };

    this.textCache = new Map();
    this.impactTimer = null;
    this.mapSize = 168;
    this.mapPath = null;
    this.mapTransform = null;

    this.initMinimap();
    this.setSound(true);
  }

  setText(element, value) {
    if (!element) return;
    if (this.textCache.get(element) === value) return;
    this.textCache.set(element, value);
    element.textContent = value;
  }

  // ---------------------------------------------------------------------------
  // Pantallas
  // ---------------------------------------------------------------------------

  showMenu() {
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.results.classList.add('hidden');
    this.setSpeedFx(false);
    this.hideCountdown();
  }

  hideMenu() {
    this.el.menu.classList.add('hidden');
  }

  showHud(visible) {
    this.el.hud.classList.toggle('hidden', !visible);
    if (!visible) this.setSpeedFx(false);
  }

  showPause(visible) {
    this.el.pause.classList.toggle('hidden', !visible);
    if (visible) this.setSpeedFx(false);
  }

  setSpeedFx(active) {
    if (this.el.speedFx) this.el.speedFx.classList.toggle('active', Boolean(active));
  }

  setDifficulty(id, definition) {
    if (!definition) return;
    for (const button of this.el.difficultyButtons) {
      const selected = button.dataset.difficulty === id;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    this.setText(this.el.difficultyCurrent, definition.label);
    this.setText(this.el.difficultyDesc, definition.description);
    this.setText(this.el.difficultyHud, definition.label);
    if (this.el.difficultyHud) {
      this.el.difficultyHud.title = `Dificultad: ${definition.label}`;
      this.el.difficultyHud.setAttribute('aria-label', `Dificultad ${definition.label}`);
    }
  }

  /** Marca el circuito elegido y actualiza la etiqueta del minimapa. */
  setMap(id, definition) {
    if (!definition) return;
    for (const button of this.el.mapButtons) {
      const selected = button.dataset.map === id;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    this.setText(this.el.mapCurrent, definition.name);
    this.setText(this.el.mapDesc, definition.description);
    this.setText(this.el.hudMapName, definition.shortName ?? definition.name);
  }

  /** Marca el kart elegido y actualiza su ficha de estadísticas. */
  setKart(id, definition) {
    if (!definition) return;
    for (const button of this.el.kartButtons) {
      const selected = button.dataset.kart === id;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    this.setText(this.el.kartCurrent, definition.name.toUpperCase());
    this.setText(this.el.kartTagline, definition.tagline);
    this.setText(this.el.kartDesc, definition.description);

    const stats = definition.stats ?? {};
    for (const bar of this.el.statBars) {
      const value = clamp(stats[bar.dataset.stat] ?? 0, 0, 100);
      bar.style.width = `${value}%`;
      bar.parentElement?.setAttribute('aria-label', `${bar.dataset.stat}: ${value} de 100`);
    }
  }

  /** Al cambiar de circuito, el minimapa debe recalcular su trazado. */
  resetMinimap() {
    this.mapPath = null;
    this.mapTransform = null;
    if (this.mapCtx) this.mapCtx.clearRect(0, 0, this.mapSize, this.mapSize);
  }

  /** Destello breve y periférico al recibir o bloquear un impacto. */
  flashImpact(blocked = false) {
    const element = this.el.impactFx;
    if (!element) return;
    element.classList.remove('impact', 'blocked');
    void element.offsetWidth;
    element.classList.add('impact');
    element.classList.toggle('blocked', Boolean(blocked));
    if (this.impactTimer) window.clearTimeout(this.impactTimer);
    this.impactTimer = window.setTimeout(() => {
      element.classList.remove('impact', 'blocked');
      this.impactTimer = null;
    }, 340);
  }

  showCountdown(value) {
    this.el.countdown.classList.remove('hidden');
    const isGo = value <= 0;
    this.el.countdown.classList.toggle('go', isGo);
    this.el.countdownValue.textContent = isGo ? '¡YA!' : String(value);

    const ring = this.el.countdown.querySelector('.countdown-ring');
    if (ring) {
      ring.classList.remove('pop');
      void ring.offsetWidth;
      ring.classList.add('pop');
    }
  }

  hideCountdown() {
    this.el.countdown.classList.add('hidden');
    this.el.countdown.classList.remove('go');
  }

  showResults({ position, total, rows, note }) {
    const titles = {
      1: '¡Victoria!',
      2: '¡Buen podio!',
      3: '¡Podio!',
      4: '¡A remontar!',
    };
    this.el.resultsTitle.textContent = titles[position] || '¡Carrera terminada!';
    this.el.resultsPosition.textContent = `${position}º`;
    this.el.resultsPosition.title = `${position}º de ${total}`;
    const stars = Math.max(0, 4 - position);
    this.el.resultsStars.textContent = `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`;
    this.el.resultsNote.textContent = note;

    this.el.resultsBody.replaceChildren();
    for (const row of rows) {
      const tr = document.createElement('tr');
      if (row.isPlayer) tr.classList.add('is-player');

      const tdPosition = document.createElement('td');
      tdPosition.textContent = `${row.position}º`;

      const tdName = document.createElement('td');
      const cell = document.createElement('span');
      cell.className = 'pilot-cell';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = row.cssColor;
      const name = document.createElement('span');
      name.textContent = row.name;
      cell.append(dot, name);
      tdName.append(cell);

      const tdTime = document.createElement('td');
      tdTime.textContent = row.finished ? formatTime(row.time) : 'En carrera';

      tr.append(tdPosition, tdName, tdTime);
      this.el.resultsBody.append(tr);
    }

    this.el.results.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.setSpeedFx(false);
  }

  hideResults() {
    this.el.results.classList.add('hidden');
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------

  updateHud({ lap, laps, position, time, lapTime, best, speed, maxSpeed, offroad }) {
    this.setText(this.el.lap, String(Math.min(lap, laps)));
    this.setText(this.el.lapTotal, `/${laps}`);
    this.setText(this.el.position, String(position));
    this.setText(this.el.time, formatTime(time));
    this.setText(this.el.lapTime, formatTime(lapTime));
    this.setText(this.el.best, formatTime(best));
    this.setText(this.el.speed, String(Math.round(speed * 3.6)));

    const ratio = clamp(speed / Math.max(maxSpeed, 0.001), 0, 1);
    this.el.speedBar.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.el.offroad.classList.toggle('visible', Boolean(offroad));
  }

  updatePower({
    charge = 0,
    chargeMax = 1.1,
    level1 = 0.45,
    level2 = 0.9,
    drifting = false,
    turboActive = false,
    turboLevel = 0,
    boosting = turboActive,
  }) {
    const meter = this.el.turboMeter;
    if (!meter) return;

    const ratio = clamp(charge / Math.max(chargeMax, 0.001), 0, 1);
    this.el.turboBar.style.width = `${(ratio * 100).toFixed(1)}%`;
    meter.classList.toggle('charging', Boolean(drifting));
    meter.classList.toggle('ready', !turboActive && charge >= level1);
    meter.classList.toggle('max', !turboActive && charge >= level2);
    meter.classList.toggle('active', Boolean(turboActive));
    this.setSpeedFx(boosting);

    let state = 'ESPACIO';
    if (turboActive) state = turboLevel >= 2 ? '¡POTENTE!' : '¡CORTO!';
    else if (charge >= level2) state = '¡MÁXIMO!';
    else if (charge >= level1) state = 'LISTO';
    else if (drifting) state = 'CARGANDO';
    this.setText(this.el.turboState, state);
  }

  updateItem({ item = null, cooldown = 0, cooldownMax = 0.7 }) {
    const card = this.el.itemCard;
    if (!card) return;

    card.classList.toggle('has-item', Boolean(item));
    card.classList.toggle('cooling', !item && cooldown > 0 && cooldownMax > 0);

    if (item) {
      card.style.setProperty('--item-color', item.color);
      this.setText(this.el.itemIcon, item.icon);
      this.setText(this.el.itemName, item.name);
      this.setText(this.el.itemState, cooldown > 0 ? 'Recargando…' : item.useHint ?? 'Pulsa E para usar');
    } else {
      card.style.setProperty('--item-color', '#5c7695');
      this.setText(this.el.itemIcon, '—');
      this.setText(this.el.itemName, 'Sin objeto');
      this.setText(this.el.itemState, cooldown > 0 ? 'Recargando…' : 'Recoge una caja');
    }
  }

  setSound(enabled) {
    if (!this.el.soundButton) return;
    this.el.soundButton.textContent = enabled ? '🔊' : '🔇';
    this.el.soundButton.classList.toggle('muted', !enabled);
    this.el.soundButton.setAttribute('aria-pressed', String(enabled));
    this.el.soundButton.title = enabled ? 'Silenciar sonido (M)' : 'Activar sonido (M)';
  }

  // ---------------------------------------------------------------------------
  // Minimapa
  // ---------------------------------------------------------------------------

  initMinimap() {
    const canvas = this.el.minimap;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = this.mapSize * dpr;
    canvas.height = this.mapSize * dpr;
    this.mapCtx = canvas.getContext('2d');
    if (this.mapCtx) {
      this.mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  buildMap(track) {
    if (this.mapPath) return;
    const size = this.mapSize;
    const padding = 15;
    const { minX, maxX, minZ, maxZ } = track.bounds;
    const trackWidth = maxX - minX;
    const trackHeight = maxZ - minZ;
    const scale = Math.min((size - padding * 2) / trackWidth, (size - padding * 2) / trackHeight);
    const offsetX = (size - trackWidth * scale) / 2;
    const offsetY = (size - trackHeight * scale) / 2;
    this.mapTransform = { minX, minZ, scale, offsetX, offsetY };

    const path = new Path2D();
    const step = 5;
    for (let i = 0; i < track.samples.length; i += step) {
      const { x, z } = track.samples[i].point;
      const px = offsetX + (x - minX) * scale;
      const py = offsetY + (z - minZ) * scale;
      if (i === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    }
    path.closePath();
    this.mapPath = path;
  }

  updateMinimap(track, karts, player) {
    const ctx = this.mapCtx;
    if (!ctx) return;
    this.buildMap(track);
    const { minX, minZ, scale, offsetX, offsetY } = this.mapTransform;
    const size = this.mapSize;
    const mapX = (x) => offsetX + (x - minX) * scale;
    const mapY = (z) => offsetY + (z - minZ) * scale;

    ctx.clearRect(0, 0, size, size);

    // Trazado: borde oscuro + asfalto claro.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(2, 8, 20, 0.7)';
    ctx.lineWidth = 14;
    ctx.stroke(this.mapPath);
    ctx.strokeStyle = '#cfe1f5';
    ctx.lineWidth = 8;
    ctx.stroke(this.mapPath);

    // Línea de salida/meta.
    const frame = track.frameAt(track.startS);
    const a = {
      x: frame.point.x + frame.side.x * track.halfWidth,
      z: frame.point.z + frame.side.z * track.halfWidth,
    };
    const b = {
      x: frame.point.x - frame.side.x * track.halfWidth,
      z: frame.point.z - frame.side.z * track.halfWidth,
    };
    ctx.strokeStyle = '#ff6b3d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mapX(a.x), mapY(a.z));
    ctx.lineTo(mapX(b.x), mapY(b.z));
    ctx.stroke();

    // Puntos de los karts; el jugador va el último para quedar encima.
    for (const kart of karts) {
      if (kart === player) continue;
      const px = mapX(kart.position.x);
      const py = mapY(kart.position.z);
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = `#${kart.color.toString(16).padStart(6, '0')}`;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.stroke();
    }

    if (player) {
      const px = mapX(player.position.x);
      const py = mapY(player.position.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI - player.heading);
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6, 6);
      ctx.lineTo(0, 3.5);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fillStyle = '#ff6a1a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    }
  }
}
