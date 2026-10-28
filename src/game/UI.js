// Interfaz HTML: pantallas, HUD, resultados y minimapa dibujado en canvas.
import { clamp, formatTime } from './utils.js';
import {
  coinsFor,
  kartPrice,
  mapPrice,
  ownsKart,
  ownsMap,
} from './economy.js';

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
      positionCard: byId('position-card'),
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
      shopButton: byId('btn-shop'),
      menuCoins: byId('menu-coins'),
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
      stunFx: byId('stun-fx'),
      launchFx: byId('launch-fx'),
      stunBanner: byId('stun-banner'),
      stunFill: byId('stun-fill'),
      lapToast: byId('lap-toast'),
      lapToastValue: byId('lap-toast-value'),
      mapButtons: Array.from(document.querySelectorAll('[data-map]')),
      mapCurrent: byId('map-current'),
      mapDesc: byId('map-desc'),
      mapFeatures: byId('map-features'),
      hudMapName: byId('hud-map-name'),
      kartButtons: Array.from(document.querySelectorAll('[data-kart]')),
      kartCurrent: byId('kart-current'),
      kartTagline: byId('kart-tagline'),
      kartDesc: byId('kart-desc'),
      kartNumber: byId('kart-number'),
      kartStyle: byId('kart-style'),
      kartPrev: byId('btn-kart-prev'),
      kartNext: byId('btn-kart-next'),
      kartPreview: byId('kart-preview'),
      statBars: Array.from(document.querySelectorAll('[data-stat]')),
      touchItem: byId('touch-item'),
      touchItemIcon: byId('touch-item-icon'),
    };

    this.isTouch = document.documentElement.classList.contains('is-touch');
    this.textCache = new Map();
    this.impactTimer = null;
    this.launchTimer = null;
    this.lapToastTimer = null;
    this.mapSize = 168;
    this.mapPath = null;
    this.mapTransform = null;
    this.lastPosition = null;
    this.lastLap = null;
    this.lastItemId = null;
    this.lastStunActive = false;

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
    this.updateStun({ active: false });
    this.lastPosition = null;
    this.lastLap = null;
  }

  hideMenu() {
    this.el.menu.classList.add('hidden');
  }

  showPause(visible) {
    this.el.pause.classList.toggle('hidden', !visible);
    if (visible) this.setSpeedFx(false);
  }

  showHud(visible) {
    this.el.hud.classList.toggle('hidden', !visible);
    if (!visible) {
      this.setSpeedFx(false);
      this.updateStun({ active: false });
    }
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

    const menu = this.el.menu;
    if (menu) {
      menu.style.setProperty('--map-accent', definition.accent ?? '#2fd7e8');
    }

    // Etiquetas de mecánicas: hacen visible que cada circuito no es solo color.
    const features = this.el.mapFeatures;
    if (features) {
      const tags = definition.featureTags ?? [];
      features.replaceChildren();
      for (const tag of tags) {
        const chip = document.createElement('span');
        chip.className = 'feature-chip';
        chip.textContent = tag;
        features.append(chip);
      }
      features.classList.toggle('is-empty', tags.length === 0);
    }
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
    this.setText(this.el.kartNumber, String(definition.number ?? '07').padStart(2, '0'));
    this.setText(
      this.el.kartStyle,
      (definition.classLabel ?? definition.bodyStyle ?? 'STANDARD').toUpperCase(),
    );

    const accent = `#${(definition.color ?? 0xff6a1a).toString(16).padStart(6, '0')}`;
    if (this.el.menu) this.el.menu.style.setProperty('--kart-accent', accent);
    if (this.el.kartPreview) this.el.kartPreview.style.setProperty('--kart-accent', accent);

    const stats = definition.stats ?? {};
    for (const bar of this.el.statBars) {
      const value = clamp(stats[bar.dataset.stat] ?? 0, 0, 100);
      bar.style.width = `${value}%`;
      bar.parentElement?.setAttribute('aria-label', `${bar.dataset.stat}: ${value} de 100`);
    }
  }

  /**
   * Refresca el saldo visible y marca los circuitos/karts bloqueados del menú.
   * El estado del perfil lo gestiona economy.js; la interfaz solo lo refleja.
   */
  setProgress(progress) {
    this.progress = progress;
    const coins = progress?.coins ?? 0;
    if (this.el.menuCoins) this.el.menuCoins.textContent = String(coins);

    for (const button of this.el.mapButtons) {
      this.decorateLock(button, 'map', progress);
    }
    for (const button of this.el.kartButtons) {
      this.decorateLock(button, 'kart', progress);
    }

    // Recompensa por victoria: visible antes de correr, no una sorpresa.
    for (const button of this.el.difficultyButtons) {
      const reward = coinsFor(button.dataset.difficulty);
      button.title = `Recompensa por victoria: ${reward} monedas`;
    }
  }

  decorateLock(button, kind, progress) {
    const id = kind === 'map' ? button.dataset.map : button.dataset.kart;
    if (!id) return;
    const owned = kind === 'map' ? ownsMap(progress, id) : ownsKart(progress, id);
    button.classList.toggle('is-locked', !owned);

    let badge = button.querySelector('.lock-badge');
    if (owned) {
      if (badge) badge.remove();
      return;
    }

    const price = kind === 'map' ? mapPrice(id) : kartPrice(id);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'lock-badge';
      badge.setAttribute('aria-hidden', 'true');
      button.append(badge);
    }
    badge.textContent = '';
    const coin = document.createElement('i');
    coin.className = 'coin-icon';
    badge.append(coin, document.createTextNode(String(price)));
    button.title = `Bloqueado · ${price} monedas. Pulsa para abrir la tienda.`;
  }

  /** Al cambiar de circuito, el minimapa debe recalcular su trazado. */
  resetMinimap() {
    this.mapPath = null;
    this.mapTransform = null;
    if (this.mapCtx) this.mapCtx.clearRect(0, 0, this.mapSize, this.mapSize);
  }

  /** Destello breve y periférico al recibir, bloquear o provocar un impacto. */
  flashImpact(blocked = false, strong = false) {
    const element = this.el.impactFx;
    if (!element) return;
    element.classList.remove('impact', 'blocked', 'strong');
    void element.offsetWidth;
    element.classList.add('impact');
    element.classList.toggle('blocked', Boolean(blocked));
    element.classList.toggle('strong', Boolean(strong));
    if (this.impactTimer) window.clearTimeout(this.impactTimer);
    this.impactTimer = window.setTimeout(() => {
      element.classList.remove('impact', 'blocked', 'strong');
      this.impactTimer = null;
    }, strong ? 520 : 340);
  }

  /** Fogonazo del disparo: confirma al jugador que el proyectil ha salido. */
  flashLaunch() {
    const element = this.el.launchFx;
    if (!element) return;
    element.classList.remove('launch', 'boost');
    void element.offsetWidth;
    element.classList.add('launch');
    if (this.launchTimer) window.clearTimeout(this.launchTimer);
    this.launchTimer = window.setTimeout(() => {
      element.classList.remove('launch');
      this.launchTimer = null;
    }, 260);
  }

  /** Destello cian al pasar por una placa de turbo del circuito. */
  flashBoost() {
    const element = this.el.launchFx;
    if (!element) return;
    element.classList.remove('launch', 'boost');
    void element.offsetWidth;
    element.classList.add('boost');
    if (this.launchTimer) window.clearTimeout(this.launchTimer);
    this.launchTimer = window.setTimeout(() => {
      element.classList.remove('boost');
      this.launchTimer = null;
    }, 420);
  }

  /** Aviso de aturdimiento con barra de recuperación. */
  updateStun({ active = false, ratio = 0, recovering = false } = {}) {
    const banner = this.el.stunBanner;
    if (!banner) return;
    banner.classList.toggle('hidden', !active);
    banner.classList.toggle('recovering', Boolean(active && recovering));
    if (active) {
      if (this.el.stunFill) this.el.stunFill.style.width = `${clamp(ratio, 0, 1) * 100}%`;
      const root = document.documentElement;
      root.classList.add('is-stunned');
    } else if (this.lastStunActive) {
      document.documentElement.classList.remove('is-stunned');
    }
    this.lastStunActive = active;
  }

  /** Aviso emergente al empezar una vuelta nueva. */
  showLapToast(lap, laps) {
    const toast = this.el.lapToast;
    if (!toast) return;
    this.setText(this.el.lapToastValue, `${lap} / ${laps}`);
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    if (this.lapToastTimer) window.clearTimeout(this.lapToastTimer);
    this.lapToastTimer = window.setTimeout(() => {
      toast.classList.remove('show');
      this.lapToastTimer = null;
    }, 1500);
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
    this.updateStun({ active: false });
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
    if (this.el.hud) this.el.hud.style.setProperty('--speed-ratio', ratio.toFixed(3));
    this.el.offroad.classList.toggle('visible', Boolean(offroad));

    // Cambio de posición: pequeño golpe visual para que el adelantamiento se note.
    if (this.lastPosition !== null && position !== this.lastPosition && this.el.positionCard) {
      this.el.positionCard.classList.remove('bump', 'lose');
      void this.el.positionCard.offsetWidth;
      this.el.positionCard.classList.add(position < this.lastPosition ? 'bump' : 'lose');
    }
    this.lastPosition = position;

    // Aviso de vuelta nueva y estado de última vuelta.
    if (this.lastLap !== null && lap !== this.lastLap && lap <= laps) {
      this.showLapToast(lap, laps);
    }
    this.lastLap = lap;
    if (this.el.hud) this.el.hud.classList.toggle('final-lap', lap === laps);
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

    let state = this.isTouch ? 'DRIFT' : 'ESPACIO';
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

    const itemId = item?.id ?? null;
    if (itemId && itemId !== this.lastItemId) {
      card.classList.remove('just-picked');
      void card.offsetWidth;
      card.classList.add('just-picked');
    }
    this.lastItemId = itemId;

    if (item) {
      card.style.setProperty('--item-color', item.color);
      this.setText(this.el.itemIcon, item.icon);
      this.setText(this.el.itemName, item.name);
      this.setText(this.el.itemState, cooldown > 0 ? 'Recargando…' : this.getItemHint(item));
    } else {
      card.style.setProperty('--item-color', '#5c7695');
      this.setText(this.el.itemIcon, '—');
      this.setText(this.el.itemName, 'Sin objeto');
      this.setText(this.el.itemState, cooldown > 0 ? 'Recargando…' : 'Recoge una caja');
    }

    const touchItem = this.el.touchItem;
    if (touchItem) {
      touchItem.classList.toggle('has-item', Boolean(item));
      touchItem.classList.toggle('cooling', !item && cooldown > 0 && cooldownMax > 0);
      touchItem.style.setProperty('--item-color', item ? item.color : '#5c7695');
      this.setText(this.el.touchItemIcon, item ? item.icon : '—');
      const label = item
        ? `Usar ${item.name.toLowerCase()}: toca el botón`
        : 'Usar objeto: sin objeto';
      touchItem.setAttribute('aria-label', label);
      touchItem.title = label;
    }
  }

  getItemHint(item) {
    const hint = item.useHint ?? 'Pulsa E para usar';
    if (!this.isTouch) return hint;
    return hint.replace(/Pulsa E/gi, 'Toca OBJETO');
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
