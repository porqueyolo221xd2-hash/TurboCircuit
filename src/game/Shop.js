// Garaje y tienda: tarjetas de karts y circuitos, vista previa y compra.
//
// La tienda no guarda nada por su cuenta: recibe el perfil de progreso y avisa
// al juego con onBuy/onSelect. Así solo hay una fuente de verdad (economy.js) y
// es imposible cobrar dos veces o quedar con saldo negativo.
import { KartPreview } from './KartPreview.js';
import { MAPS } from './maps.js';
import { PLAYER_KARTS } from './karts.js';
import {
  coinsFor,
  itemState,
  kartPrice,
  mapPrice,
  priceHint,
  winsNeeded,
} from './economy.js';

const MAP_ORDER = ['coast', 'mountain', 'city', 'neon', 'canyon', 'orbital'];

export class Shop {
  constructor({ onBuy, onSelect, onClose }) {
    const byId = (id) => document.getElementById(id);
    this.onBuy = onBuy;
    this.onSelect = onSelect;
    this.onClose = onClose;
    this.progress = null;
    this.tab = 'karts';
    this.focusId = null;
    this.preview = null;
    this.previewKartId = null;
    this.disposed = false;
    this.tabHandlers = [];

    this.el = {
      screen: byId('screen-shop'),
      back: byId('btn-shop-back'),
      coins: byId('shop-coins'),
      tabs: Array.from(document.querySelectorAll('[data-shop-tab]')),
      grid: byId('shop-grid'),
      stage: byId('shop-preview-stage'),
      canvas: byId('shop-preview-canvas'),
      mapCanvas: byId('shop-map-canvas'),
      tag: byId('shop-preview-tag'),
      name: byId('shop-preview-name'),
      desc: byId('shop-preview-desc'),
      stats: byId('shop-preview-stats'),
      hint: byId('shop-preview-hint'),
      note: byId('shop-note'),
      menuCoins: byId('menu-coins'),
      resultsCoins: byId('results-coins'),
      resultsBalance: byId('results-balance'),
      resultsLabel: byId('results-reward-label'),
      resultsReward: byId('results-reward'),
    };

    this.handleBack = () => this.onClose?.();
    this.el.back?.addEventListener('click', this.handleBack);
    for (const tab of this.el.tabs) {
      const handler = () => this.setTab(tab.dataset.shopTab);
      tab.addEventListener('click', handler);
      this.tabHandlers.push([tab, handler]);
    }
  }

  setProgress(progress) {
    this.progress = progress;
    this.renderCoins();
  }

  renderCoins() {
    const coins = this.progress?.coins ?? 0;
    if (this.el.coins) this.el.coins.textContent = String(coins);
    if (this.el.menuCoins) this.el.menuCoins.textContent = String(coins);
  }

  open(tab = 'karts', focusId = null) {
    if (this.el.screen) this.el.screen.classList.remove('hidden');
    this.focusId = focusId;
    this.setTab(tab);
  }

  close() {
    if (this.el.screen) this.el.screen.classList.add('hidden');
    this.note('');
  }

  get isOpen() {
    return this.el.screen ? !this.el.screen.classList.contains('hidden') : false;
  }

  setTab(tab) {
    if (tab !== 'karts' && tab !== 'maps') return;
    this.tab = tab;
    for (const button of this.el.tabs) {
      const selected = button.dataset.shopTab === tab;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-selected', String(selected));
    }
    if (this.el.tag) this.el.tag.textContent = tab === 'karts' ? 'KART' : 'CIRCUITO';
    this.renderGrid();
    const fallback = tab === 'karts' ? PLAYER_KARTS[0].id : MAP_ORDER[0];
    const id = this.focusId && this.hasItem(tab, this.focusId) ? this.focusId : fallback;
    this.selectPreview(id);
  }

  hasItem(tab, id) {
    return tab === 'karts' ? PLAYER_KARTS.some((k) => k.id === id) : MAP_ORDER.includes(id);
  }

  /** Ficha de la tarjeta: estado, precio y etiqueta del botón. */
  describe(kind, item) {
    const id = item.id;
    const progress = this.progress;
    const state = itemState(progress, kind, id);
    const price = kind === 'kart' ? kartPrice(id) : mapPrice(id);
    const coins = progress?.coins ?? 0;
    return {
      state,
      price,
      affordable: coins >= price,
      hint: priceHint(price),
    };
  }

  renderGrid() {
    const grid = this.el.grid;
    if (!grid || !this.progress) return;
    grid.replaceChildren();

    const kind = this.tab === 'karts' ? 'kart' : 'map';
    const items =
      kind === 'kart' ? PLAYER_KARTS : MAP_ORDER.map((id) => MAPS[id]);

    for (const item of items) {
      const info = this.describe(kind, item);
      const card = document.createElement('article');
      card.className = 'shop-card';
      card.dataset.id = item.id;
      card.setAttribute('role', 'listitem');
      card.classList.toggle('is-equipped', info.state === 'equipped');
      card.classList.toggle('is-locked', info.state === 'locked');
      card.classList.toggle('is-selected', item.id === this.focusId);

      const accent = `#${(item.color ?? 0x3fe0ff).toString(16).padStart(6, '0')}`;
      card.style.setProperty('--card-accent', item.accent ?? accent);

      const head = document.createElement('div');
      head.className = 'shop-card-head';
      const swatch = document.createElement('i');
      swatch.className = 'shop-swatch';
      swatch.style.background = item.accent ?? accent;
      const name = document.createElement('b');
      name.textContent = item.name;
      head.append(swatch, name);

      if (info.state === 'locked') {
        const lock = document.createElement('span');
        lock.className = 'shop-lock';
        lock.textContent = 'BLOQUEADO';
        head.append(lock);
      }

      const desc = document.createElement('p');
      desc.textContent = item.tagline ?? item.description ?? '';

      const foot = document.createElement('div');
      foot.className = 'shop-card-foot';

      if (info.state === 'locked') {
        const priceTag = document.createElement('span');
        priceTag.className = 'shop-price';
        priceTag.title = info.hint;
        priceTag.innerHTML = `<i class="coin-icon" aria-hidden="true"></i>${info.price}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-buy';
        button.textContent = 'Comprar';
        button.disabled = !info.affordable;
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          this.onBuy?.(kind, item.id);
        });
        foot.append(priceTag, button);
      } else {
        const stateTag = document.createElement('span');
        stateTag.className = 'shop-state';
        stateTag.textContent = info.state === 'equipped' ? 'EQUIPADO' : 'DESBLOQUEADO';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `btn ${info.state === 'equipped' ? 'btn-secondary' : 'btn-primary'}`;
        button.textContent = info.state === 'equipped' ? 'En uso' : 'Equipar';
        button.disabled = info.state === 'equipped';
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          this.onSelect?.(kind, item.id);
        });
        foot.append(stateTag, button);
      }

      card.append(head, desc, foot);
      card.addEventListener('click', () => this.selectPreview(item.id));
      grid.append(card);
    }
  }

  selectPreview(id) {
    this.focusId = id;
    for (const card of this.el.grid?.children ?? []) {
      card.classList.toggle('is-selected', card.dataset.id === id);
    }
    if (this.tab === 'karts') {
      const spec = PLAYER_KARTS.find((kart) => kart.id === id) ?? PLAYER_KARTS[0];
      this.showKartPreview(spec);
    } else {
      const map = MAPS[id] ?? MAPS.coast;
      this.showMapPreview(map);
    }
  }

  updatePreviewHint(kind, id) {
    const element = this.el.hint;
    if (!element) return;
    const state = itemState(this.progress, kind, id);
    const price = kind === 'kart' ? kartPrice(id) : mapPrice(id);
    if (state === 'locked') {
      element.textContent = `${priceHint(price)} · cuesta ${price} monedas`;
      element.dataset.state = 'locked';
    } else if (state === 'equipped') {
      element.textContent = 'En uso';
      element.dataset.state = 'equipped';
    } else {
      element.textContent = 'Desbloqueado';
      element.dataset.state = 'owned';
    }
  }

  showKartPreview(spec) {
    this.toggleStage('kart');
    this.updatePreviewHint('kart', spec.id);
    if (this.el.name) this.el.name.textContent = spec.name;
    if (this.el.desc) this.el.desc.textContent = spec.description ?? '';
    if (this.el.stats) {
      this.el.stats.replaceChildren();
      for (const [key, label] of [
        ['speed', 'Velocidad'],
        ['acceleration', 'Aceleración'],
        ['grip', 'Agarre'],
        ['stability', 'Estabilidad'],
      ]) {
        const row = document.createElement('div');
        row.className = 'kart-stat';
        const text = document.createElement('span');
        text.textContent = label;
        const bar = document.createElement('i');
        bar.className = 'stat-bar';
        const fill = document.createElement('b');
        fill.style.width = `${Math.max(0, Math.min(100, spec.stats?.[key] ?? 0))}%`;
        bar.append(fill);
        row.append(text, bar);
        this.el.stats.append(row);
      }
    }

    try {
      if (!this.preview && this.el.canvas) {
        this.preview = new KartPreview(this.el.canvas);
      }
      if (this.preview && this.previewKartId !== spec.id) {
        this.preview.setKart(spec);
        this.previewKartId = spec.id;
      }
    } catch (error) {
      console.warn('No se pudo abrir la vista previa de la tienda.', error);
      this.preview = null;
    }
  }

  showMapPreview(map) {
    this.toggleStage('map');
    this.updatePreviewHint('map', map.id);
    if (this.el.name) this.el.name.textContent = map.name;
    if (this.el.desc) this.el.desc.textContent = map.description ?? '';
    if (this.el.stats) {
      this.el.stats.replaceChildren();
      for (const tag of map.featureTags ?? []) {
        const chip = document.createElement('span');
        chip.className = 'feature-chip';
        chip.textContent = tag;
        this.el.stats.append(chip);
      }
    }
    this.drawMapLayout(map);
  }

  toggleStage(mode) {
    const stage = this.el.stage;
    if (!stage) return;
    stage.classList.toggle('is-map', mode === 'map');
    if (this.el.canvas) this.el.canvas.classList.toggle('hidden', mode === 'map');
    if (this.el.mapCanvas) this.el.mapCanvas.classList.toggle('hidden', mode !== 'map');
  }

  /** Dibuja el trazado del circuito como vista previa 2D. */
  drawMapLayout(map) {
    const canvas = this.el.mapCanvas;
    if (!canvas || !map?.controlPoints?.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 240;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Suavizado de Chaikin para que el trazado no parezca un polígono.
    let points = map.controlPoints.map(([x, z]) => ({ x, z }));
    for (let pass = 0; pass < 3; pass += 1) {
      const next = [];
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
        next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
      }
      points = next;
    }

    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minZ = Math.min(...points.map((p) => p.z));
    const maxZ = Math.max(...points.map((p) => p.z));
    const padding = 22;
    const scale = Math.min(
      (width - padding * 2) / Math.max(1, maxX - minX),
      (height - padding * 2) / Math.max(1, maxZ - minZ),
    );
    const offsetX = (width - (maxX - minX) * scale) / 2;
    const offsetY = (height - (maxZ - minZ) * scale) / 2;
    const px = (x) => offsetX + (x - minX) * scale;
    const py = (z) => offsetY + (z - minZ) * scale;

    const path = new Path2D();
    points.forEach((point, index) => {
      if (index === 0) path.moveTo(px(point.x), py(point.z));
      else path.lineTo(px(point.x), py(point.z));
    });
    path.closePath();

    const accent = map.accent ?? '#3fe0ff';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(2, 8, 20, 0.75)';
    ctx.lineWidth = 22;
    ctx.stroke(path);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 18;
    ctx.stroke(path);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#e8f4ff';
    ctx.lineWidth = 8;
    ctx.stroke(path);

    const start = points[0];
    ctx.fillStyle = '#ff6b3d';
    ctx.beginPath();
    ctx.arc(px(start.x), py(start.z), 6, 0, Math.PI * 2);
    ctx.fill();
  }

  note(message, tone = 'info') {
    const element = this.el.note;
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('is-error', tone === 'error');
    element.classList.toggle('is-ok', tone === 'ok');
  }

  /** Anima la entrada de la recompensa en la pantalla de resultados. */
  showReward({ coins, balance, difficulty, won }) {
    const block = this.el.resultsReward;
    if (!block) return;
    block.classList.toggle('no-reward', !won);
    block.classList.remove('pop');
    void block.offsetWidth;
    block.classList.add('pop');

    if (this.el.resultsCoins) this.el.resultsCoins.textContent = won ? `+${coins}` : '+0';
    if (this.el.resultsLabel) {
      this.el.resultsLabel.textContent = won
        ? 'monedas ganadas'
        : 'Gana la carrera para cobrar';
    }
    if (this.el.resultsBalance) this.el.resultsBalance.textContent = String(balance);
    const difficultyEl = document.getElementById('results-difficulty');
    if (difficultyEl) {
      difficultyEl.textContent = `DIFICULTAD ${(difficulty ?? '').toUpperCase()}`;
      difficultyEl.dataset.difficulty = difficulty ?? 'normal';
    }

    // Cuenta ascendente: el saldo se ve crecer moneda a moneda.
    if (this.el.resultsBalance && won && coins > 0) {
      const from = Math.max(0, balance - coins);
      const start = performance.now();
      const duration = 700;
      const step = (now) => {
        if (this.disposed) return;
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        this.el.resultsBalance.textContent = String(Math.round(from + (balance - from) * eased));
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  update(dt) {
    if (!this.preview || this.tab !== 'karts' || !this.isOpen) return;
    this.preview.update(dt);
    this.preview.render();
  }

  dispose() {
    this.disposed = true;
    if (this.el.back) this.el.back.removeEventListener('click', this.handleBack);
    for (const [tab, handler] of this.tabHandlers) {
      tab.removeEventListener('click', handler);
    }
    this.tabHandlers = [];
    if (this.preview) {
      this.preview.dispose();
      this.preview = null;
    }
  }
}

export { MAP_ORDER, coinsFor, winsNeeded };
