// Núcleo del juego: escena 3D, estados de carrera, cámara, rivales y HUD.
import * as THREE from 'three';
import { computeAIControls } from './AIController.js';
import { AudioManager } from './Audio.js';
import { CONFIG } from './config.js';
import { DIFFICULTIES, isDifficulty, loadDifficulty, saveDifficulty } from './difficulty.js';
import { Input } from './Input.js';
import { ItemSystem } from './ItemSystem.js';
import { ITEMS } from './items.js';
import { AI_KARTS, PLAYER_KARTS, getKart } from './karts.js';
import { Kart } from './Kart.js';
import { KartPreview } from './KartPreview.js';
import { getMap } from './maps.js';
import { Track } from './Track.js';
import { UI } from './UI.js';
import { clamp, formatTime } from './utils.js';
import {
  coinsFor,
  grantCoins,
  loadProgress,
  ownsKart,
  ownsMap,
  purchase,
  saveProgress,
  selectKart,
  selectMap,
} from './economy.js';
import { Shop } from './Shop.js';

export class Game {
  constructor(container) {
    this.container = container;
    this.difficultyId = loadDifficulty();
    this.difficulty = DIFFICULTIES[this.difficultyId];
    // Perfil persistente: una sola fuente de verdad para monedas y desbloqueos.
    // loadProgress migra (sin borrar) las claves antiguas de kart y circuito.
    this.progress = loadProgress();
    this.kartId = this.progress.selectedKart;
    this.kartSpec = getKart(this.kartId);
    this.mapId = this.progress.selectedMap;
    this.map = getMap(this.mapId);
    saveProgress(this.progress);
    this.rewardClaimed = false;
    this.ui = new UI();
    this.input = new Input();
    this.audio = new AudioManager();
    // Timer usa la Page Visibility API y evita saltos enormes al volver a la pestaña.
    this.timer = new THREE.Timer();
    this.timer.connect(document);

    this.state = 'menu';
    this.raceTime = 0;
    this.countdownRemaining = 0;
    this.countdownValue = 3;
    this.goTimer = 0;
    this.menuTime = 0;
    this.menuCameraReady = false;
    this.snapCamera = true;
    this.standings = [];
    this.disposed = false;
    this.rafId = null;
    this.listeners = [];
    this.sunOffset = new THREE.Vector3(62, 105, 48);

    this.initRenderer();
    this.initScene();
    this.applyEnvironment();
    this.track = new Track(this.map);
    this.scene.add(this.track.group);
    this.createKarts();
    this.itemSystem = null;
    this.createItemSystem();
    this.preview = null;
    this.createPreview();
    this.shop = new Shop({
      onBuy: (kind, id) => this.buyItem(kind, id),
      onSelect: (kind, id) => this.selectItem(kind, id),
      onClose: () => this.closeShop(),
    });
    this.shop.setProgress(this.progress);
    this.resetRace();
    this.bindEvents();
    this.updateMenuCamera(0);

    this.ui.showMenu();
    this.ui.showHud(false);
    this.ui.showPause(false);
    this.ui.hideResults();
    this.ui.setSound(this.audio.enabled);
    this.ui.setDifficulty(this.difficultyId, this.difficulty);
    this.ui.setMap(this.mapId, this.map);
    this.ui.setKart(this.kartId, this.kartSpec);
    this.ui.setProgress(this.progress);

    this.animate = this.animate.bind(this);
    this.rafId = requestAnimationFrame(this.animate);
  }

  // ---------------------------------------------------------------------------
  // Inicialización
  // ---------------------------------------------------------------------------

  isTouchDevice() {
    return document.documentElement.classList.contains('is-touch');
  }

  /**
   * Resolución de renderizado adaptativa: mantiene nitidez en ordenador y
   * limita el número de píxeles en móviles para no castigar la GPU/batería.
   */
  getRenderPixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const touch = this.isTouchDevice();
    const maxRatio = touch ? 1.5 : 2;
    const pixelBudget = touch ? 1_600_000 : 16_000_000;
    const budgetRatio = Math.sqrt(pixelBudget / (width * height));
    return Math.max(0.75, Math.min(dpr, maxRatio, budgetRatio));
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.getRenderPixelRatio());
    this.renderer.setSize(
      Math.max(1, this.container.clientWidth),
      Math.max(1, this.container.clientHeight),
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('aria-label', 'Turbo Circuit, vista 3D de la carrera');
    this.container.appendChild(this.renderer.domElement);
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcfeaff, 260, 950);

    this.baseFov = CONFIG.camera.fov;
    this.camera = new THREE.PerspectiveCamera(
      this.baseFov,
      Math.max(1, this.container.clientWidth) / Math.max(1, this.container.clientHeight),
      0.1,
      2500,
    );
    this.camera.position.set(0, 90, 220);

    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();

    // Cielo degradado procedural (sin texturas externas).
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x2579dd) },
        bottomColor: { value: new THREE.Color(0xd6f4ff) },
        offset: { value: 60 },
        exponent: { value: 0.75 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          float t = pow(max(h, 0.0), exponent);
          gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(950, 32, 18), this.skyMaterial);
    this.sky.name = 'cielo';
    this.scene.add(this.sky);

    this.sunBall = new THREE.Mesh(
      new THREE.SphereGeometry(26, 20, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff4c0, fog: false }),
    );
    this.sunBall.position.set(420, 520, 330);
    this.scene.add(this.sunBall);

    this.hemisphere = new THREE.HemisphereLight(0xd9f1ff, 0x557a3b, 1.55);
    this.scene.add(this.hemisphere);

    this.sun = new THREE.DirectionalLight(0xfff0c8, 2.5);
    this.sun.castShadow = true;
    // Sombras algo más ligeras en táctil: se nota menos en pantalla pequeña.
    const shadowSize = this.isTouchDevice() ? 1024 : 2048;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.camera.left = -75;
    this.sun.shadow.camera.right = 75;
    this.sun.shadow.camera.top = 75;
    this.sun.shadow.camera.bottom = -75;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  /** Ajusta cielo, niebla, luces y exposición al ambiente del circuito. */
  applyEnvironment() {
    const env = this.map.environment ?? {};
    if (env.skyTop !== undefined) this.skyMaterial.uniforms.topColor.value.setHex(env.skyTop);
    if (env.skyBottom !== undefined) {
      this.skyMaterial.uniforms.bottomColor.value.setHex(env.skyBottom);
    }
    if (this.scene.fog) {
      if (env.fogColor !== undefined) this.scene.fog.color.setHex(env.fogColor);
      if (env.fogNear !== undefined) this.scene.fog.near = env.fogNear;
      if (env.fogFar !== undefined) this.scene.fog.far = env.fogFar;
    }
    if (env.hemiSky !== undefined) this.hemisphere.color.setHex(env.hemiSky);
    if (env.hemiGround !== undefined) this.hemisphere.groundColor.setHex(env.hemiGround);
    if (env.hemiIntensity !== undefined) this.hemisphere.intensity = env.hemiIntensity;
    if (env.sunColor !== undefined) this.sun.color.setHex(env.sunColor);
    if (env.sunIntensity !== undefined) this.sun.intensity = env.sunIntensity;
    if (env.sunBallColor !== undefined) this.sunBall.material.color.setHex(env.sunBallColor);
    if (env.exposure !== undefined) this.renderer.toneMappingExposure = env.exposure;
  }

  createKarts() {
    // El jugador siempre ocupa el índice 0: el resto de sistemas lo asume.
    this.playerKart = new Kart({ ...this.kartSpec, isPlayer: true });
    this.karts = [this.playerKart];
    for (const spec of AI_KARTS) this.karts.push(new Kart(spec));

    for (const kart of this.karts) this.scene.add(kart.group);
  }

  /** Vuelve a crear el sistema de objetos para la pista actual. */
  createItemSystem() {
    if (this.itemSystem) this.itemSystem.dispose();
    this.itemSystem = new ItemSystem(this.scene, this.track, this.karts);
    this.itemSystem.setDifficulty?.(this.difficulty);
    this.itemSystem.onPickup = (kart) => {
      if (kart === this.playerKart) this.audio.pickup();
    };
    this.itemSystem.onUse = (kart, id) => {
      if (kart === this.playerKart) this.audio.item(id);
    };
    this.itemSystem.onSlow = (kart) => {
      if (kart === this.playerKart) this.audio.beep(150, 0.2, 0.08);
    };
    this.itemSystem.onProjectileFired = (kart, projectile) => {
      // El disparo del jugador ya suena en onUse; la IA solo se oye si está cerca.
      if (kart === this.playerKart) return;
      const dx = kart.position.x - this.playerKart.position.x;
      const dz = kart.position.z - this.playerKart.position.z;
      if (dx * dx + dz * dz < 32 * 32) {
        if (projectile?.kind === 'FURIA') this.audio.furia(0.55);
        else this.audio.projectile(0.55);
      }
    };
    this.itemSystem.onProjectileHit = (victim, shooter, blocked, projectile) => {
      if (victim === this.playerKart) {
        this.ui.flashImpact(blocked, projectile?.kind === 'FURIA');
        this.audio.impact(blocked);
        if (!blocked && (projectile?.def?.stunTime ?? 0) > 0) this.audio.stun();
      } else if (shooter === this.playerKart) {
        this.audio.impact(false);
      }
    };
    this.itemSystem.onMineTriggered = (owner, affected, triggeredBy, x, z) => {
      const playerHit = affected.some((kart) => kart === this.playerKart);
      if (playerHit) this.ui.flashImpact(false, true);
      const dx = x - this.playerKart.position.x;
      const dz = z - this.playerKart.position.z;
      if (playerHit || owner === this.playerKart || dx * dx + dz * dz < 40 * 40) {
        this.audio.mineBoom();
      }
    };
  }

  /** Vista previa 3D del kart en el menú; si falla, el juego sigue sin ella. */
  createPreview() {
    if (!this.ui.el.kartPreview) return;
    try {
      this.preview = new KartPreview(this.ui.el.kartPreview);
      this.preview.setKart(this.kartSpec);
    } catch (error) {
      console.warn('No se pudo iniciar la vista previa 3D del kart.', error);
      this.preview = null;
    }
  }

  /** Sustituye el kart del jugador sin tocar a los rivales ni a la pista. */
  rebuildPlayerKart() {
    const old = this.playerKart;
    this.input.clear();
    if (this.itemSystem) this.itemSystem.clearEffects();
    if (old) {
      this.scene.remove(old.group);
      old.dispose();
    }

    const kart = new Kart({ ...this.kartSpec, isPlayer: true });
    this.karts[0] = kart;
    this.playerKart = kart;
    this.scene.add(kart.group);
  }

  bindEvents() {
    // Al perder el foco o vaciar las teclas, se cancela el derrape sin regalar turbo.
    this.input.onClear = () => this.playerKart?.cancelDrift();

    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      this.listeners.push([target, type, handler, options]);
    };

    listen(this.ui.el.startButton, 'click', () => this.startRace({ snapCamera: false }));
    listen(this.ui.el.resumeButton, 'click', () => this.resume());
    listen(this.ui.el.restartButton, 'click', () => this.startRace({ snapCamera: true }));
    listen(this.ui.el.againButton, 'click', () => this.startRace({ snapCamera: true }));
    listen(this.ui.el.menuButton, 'click', () => this.goToMenu());
    listen(this.ui.el.pauseButton, 'click', () => {
      if (this.state === 'racing') this.pause();
      else if (this.state === 'paused') this.resume();
    });
    listen(this.ui.el.soundButton, 'click', () => this.toggleSound());
    if (this.ui.el.shopButton) {
      listen(this.ui.el.shopButton, 'click', () => this.openShop());
    }
    for (const button of this.ui.el.difficultyButtons ?? []) {
      listen(button, 'click', () => this.setDifficulty(button.dataset.difficulty));
    }
    for (const button of this.ui.el.mapButtons ?? []) {
      listen(button, 'click', () => this.setMap(button.dataset.map));
    }
    for (const button of this.ui.el.kartButtons ?? []) {
      listen(button, 'click', () => this.setKart(button.dataset.kart));
    }
    if (this.ui.el.kartPrev) {
      listen(this.ui.el.kartPrev, 'click', () => this.cycleKart(-1));
    }
    if (this.ui.el.kartNext) {
      listen(this.ui.el.kartNext, 'click', () => this.cycleKart(1));
    }

    this.input.onAction = (code, event) => {
      if (event.repeat) return;
      // Con la tienda abierta el teclado no puede arrancar la carrera.
      if (this.shop?.isOpen) {
        if (code === 'Escape') {
          event.preventDefault();
          this.closeShop();
        }
        return;
      }
      if (code === 'Enter') {
        if (this.state === 'menu') {
          event.preventDefault();
          this.startRace({ snapCamera: false });
        }
        return;
      }
      if (code === 'KeyP' || code === 'Escape') {
        if (this.state === 'racing') {
          event.preventDefault();
          this.pause();
        } else if (this.state === 'paused') {
          event.preventDefault();
          this.resume();
        }
        return;
      }
      if (code === 'KeyM') this.toggleSound();
      if (code === 'KeyE' && this.state === 'racing') {
        event.preventDefault();
        this.itemSystem.useItem(this.playerKart);
      }
    };

    // El botón táctil de objeto comparte la mecánica de la tecla E.
    this.input.onTouchAction = (action) => {
      if (action === 'item' && this.state === 'racing') {
        this.itemSystem.useItem(this.playerKart);
      }
    };

    this.handleResize = () => this.resize();
    listen(window, 'resize', this.handleResize);
    // iOS/Android a veces terminan de recolocar la vista después del evento.
    this.handleOrientationChange = () => {
      this.resize();
      window.requestAnimationFrame(() => this.resize());
    };
    listen(window, 'orientationchange', this.handleOrientationChange);
    if (window.visualViewport) {
      listen(window.visualViewport, 'resize', this.handleResize);
    }

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
    }

    this.handleVisibility = () => {
      if (document.hidden) {
        this.input.clear();
        if (this.state === 'racing') this.pause();
      } else {
        // Evita que el primer fotograma visible tenga un delta enorme.
        this.timer.reset();
      }
    };
    listen(document, 'visibilitychange', this.handleVisibility);
  }

  resize() {
    if (this.disposed || !this.renderer) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;
    this.renderer.setPixelRatio(this.getRenderPixelRatio());
    this.renderer.setSize(width, height);
    this.camera.aspect = aspect;
    // En vertical se abre algo el campo de visión para no perder los laterales.
    this.baseFov = CONFIG.camera.fov + clamp((1 - aspect) * 16, 0, 10);
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  toggleSound() {
    const enabled = this.audio.toggle();
    this.ui.setSound(enabled);
    if (enabled) this.audio.ensure();
  }

  /** La dificultad se elige en el menú y se guarda para la próxima partida. */
  setDifficulty(id) {
    if (!isDifficulty(id) || this.state !== 'menu') return;
    this.difficultyId = id;
    this.difficulty = DIFFICULTIES[id];
    saveDifficulty(id);
    this.ui.setDifficulty(id, this.difficulty);
    this.itemSystem?.setDifficulty(this.difficulty);
  }

  /** Cambia de circuito desde el menú: recrea pista, objetos y parrilla. */
  setMap(id) {
    if (this.state !== 'menu' || this.shop?.isOpen) return;
    const map = getMap(id);
    if (!map || map.id === this.mapId) return;
    // El contenido bloqueado no se puede elegir: lleva a la tienda.
    if (!ownsMap(this.progress, map.id)) {
      this.openShop('maps', map.id);
      return;
    }
    if (!selectMap(this.progress, map.id)) return;
    this.persistProgress();
    this.applyMap(map);
  }

  /** Reconstruye la pista y la parrilla para el circuito indicado. */
  applyMap(map) {
    if (!map || map.id === this.mapId) return;
    this.mapId = map.id;
    this.map = map;

    this.input.clear();
    for (const kart of this.karts) kart.clearTransientState();
    if (this.itemSystem) this.itemSystem.clearEffects();

    if (this.track) {
      this.scene.remove(this.track.group);
      this.track.dispose();
    }
    this.track = new Track(this.map);
    this.scene.add(this.track.group);
    this.applyEnvironment();
    this.createItemSystem();

    this.ui.setMap(this.mapId, this.map);
    this.ui.resetMinimap();
    this.resetRace();
    this.ui.updateMinimap(this.track, this.karts, this.playerKart);
    this.menuCameraReady = false;
    this.updateMenuCamera(0);
  }

  /** Cambia el kart del jugador desde el menú y guarda la elección. */
  setKart(id) {
    if (this.state !== 'menu' || this.shop?.isOpen) return;
    const spec = getKart(id);
    if (!spec || spec.id === this.kartId) return;
    if (!ownsKart(this.progress, spec.id)) {
      this.openShop('karts', spec.id);
      return;
    }
    if (!selectKart(this.progress, spec.id)) return;
    this.persistProgress();
    this.applyKart(spec);
  }

  /** Recoloca el modelo del jugador y actualiza la ficha del menú. */
  applyKart(spec) {
    if (!spec || spec.id === this.kartId) return;
    this.kartId = spec.id;
    this.kartSpec = spec;

    this.rebuildPlayerKart();
    this.ui.setKart(this.kartId, this.kartSpec);
    if (this.preview) this.preview.setKart(this.kartSpec);
    this.resetRace();
    this.ui.updateMinimap(this.track, this.karts, this.playerKart);
  }

  /** Navegación circular con las flechas del selector de kart. */
  cycleKart(direction) {
    if (this.state !== 'menu' || this.shop?.isOpen) return;
    const owned = PLAYER_KARTS.filter((kart) => ownsKart(this.progress, kart.id));
    if (owned.length < 2) return;
    const index = owned.findIndex((kart) => kart.id === this.kartId);
    const next = (index + direction + owned.length) % owned.length;
    this.setKart(owned[next].id);
  }

  // ---------------------------------------------------------------------------
  // Tienda y progreso
  // ---------------------------------------------------------------------------

  /** Refresca saldo, bloqueos y tarjetas tras cualquier cambio de perfil. */
  persistProgress() {
    const ok = saveProgress(this.progress);
    this.ui.setProgress(this.progress);
    this.shop?.setProgress(this.progress);
    this.shop?.renderGrid();
    return ok;
  }

  openShop(tab = 'karts', focusId = null) {
    if (this.state !== 'menu' || !this.shop) return;
    this.input.clear();
    this.shop.setProgress(this.progress);
    this.shop.open(tab, focusId);
  }

  closeShop() {
    if (!this.shop) return;
    this.shop.close();
    this.shop.setProgress(this.progress);
    this.ui.setProgress(this.progress);
  }

  /**
   * Compra un kart o un circuito. Si el navegador no puede guardar, se
   * deshace la compra en memoria para no fingir que se ha completado.
   */
  buyItem(kind, id) {
    if (!this.progress) return { ok: false };
    const backup = JSON.parse(JSON.stringify(this.progress));
    const result = purchase(this.progress, kind, id);
    if (!result.ok) {
      this.shop?.note(result.reason, 'error');
      return result;
    }
    if (!saveProgress(this.progress)) {
      this.progress = backup;
      this.shop?.setProgress(this.progress);
      this.ui.setProgress(this.progress);
      this.shop?.renderGrid();
      this.shop?.note('No se pudo guardar la compra. No se ha cobrado nada.', 'error');
      return { ok: false, reason: 'save-failed' };
    }

    const name = kind === 'kart' ? getKart(id).name : getMap(id).name;
    this.ui.setProgress(this.progress);
    this.shop?.setProgress(this.progress);
    this.shop?.renderGrid();
    this.shop?.selectPreview(id);
    this.shop?.note(`¡${name} desbloqueado! Ya puedes equiparlo.`, 'ok');
    return result;
  }

  /** Equipa contenido desbloqueado. Nunca permite seleccionar un bloqueo. */
  selectItem(kind, id) {
    if (!this.progress) return false;
    const backup = JSON.parse(JSON.stringify(this.progress));
    const ok = kind === 'kart' ? selectKart(this.progress, id) : selectMap(this.progress, id);
    if (!ok) {
      this.shop?.note('Ese objeto todavía está bloqueado.', 'error');
      return false;
    }
    if (!saveProgress(this.progress)) {
      this.progress = backup;
      this.shop?.setProgress(this.progress);
      this.ui.setProgress(this.progress);
      this.shop?.renderGrid();
      this.shop?.note('No se pudo guardar la selección. Inténtalo de nuevo.', 'error');
      return false;
    }

    if (kind === 'kart') this.applyKart(getKart(id));
    else this.applyMap(getMap(id));

    this.ui.setProgress(this.progress);
    this.shop?.setProgress(this.progress);
    this.shop?.renderGrid();
    this.shop?.selectPreview(id);
    const name = kind === 'kart' ? getKart(id).name : getMap(id).name;
    this.shop?.note(`${name} equipado.`, 'ok');
    return true;
  }

  // ---------------------------------------------------------------------------
  // Estados
  // ---------------------------------------------------------------------------

  resetRace() {
    this.raceTime = 0;
    this.goTimer = 0;
    this.countdownRemaining = 0;
    this.countdownValue = 3;

    // Parrilla: dos rivales delante, el jugador y Musgo detrás.
    const gridKarts = [this.karts[1], this.karts[2], this.karts[3], this.playerKart];
    for (let i = 0; i < gridKarts.length; i += 1) {
      const slot = CONFIG.grid[i];
      const s =
        ((this.track.startS - slot.back) % this.track.length + this.track.length) %
        this.track.length;
      gridKarts[i].reset({
        s,
        back: slot.back,
        lateral: slot.lateral,
        track: this.track,
      });
    }

    if (this.itemSystem) this.itemSystem.reset();
    this.updateStandings();
  }

  startRace({ snapCamera = false } = {}) {
    // Se limpia antes de recolocar los karts: así un derrape mantenido durante
    // la cuenta atrás no queda bloqueado por el cancelDrift del reinicio.
    this.input.clear();
    if (this.shop?.isOpen) this.closeShop();
    // Red de seguridad: nunca se corre con contenido que no esté desbloqueado.
    if (!ownsKart(this.progress, this.kartId)) this.applyKart(getKart(this.progress.selectedKart));
    if (!ownsMap(this.progress, this.mapId)) this.applyMap(getMap(this.progress.selectedMap));
    this.rewardClaimed = false;
    this.resetRace();
    this.itemSystem.setDifficulty(this.difficulty);
    for (const kart of this.karts) {
      if (!kart.isPlayer) kart.applyDifficulty(this.difficulty);
    }
    this.state = 'countdown';
    this.countdownRemaining = CONFIG.countdownStep * 3;
    this.countdownValue = 3;
    this.snapCamera = snapCamera;
    this.ui.hideMenu();
    this.ui.hideResults();
    this.ui.showPause(false);
    this.ui.showHud(true);
    this.ui.showCountdown(3);
    this.updateStandings();
    this.refreshHud();
    this.ui.updateMinimap(this.track, this.karts, this.playerKart);
    this.audio.ensure();
    this.audio.startEngine();
    this.audio.resumeEngine();
    this.audio.beep(466, 0.13, 0.1);
    this.timer.reset();
  }

  updateCountdown(dt) {
    this.countdownRemaining -= dt;
    if (this.countdownRemaining <= 0) {
      this.state = 'racing';
      this.raceTime = 0;
      this.goTimer = 0.9;
      this.ui.showCountdown(0);
      this.audio.beep(880, 0.3, 0.12);
      this.timer.reset();
      return;
    }

    const value = Math.max(1, Math.ceil(this.countdownRemaining / CONFIG.countdownStep));
    if (value !== this.countdownValue) {
      this.countdownValue = value;
      this.ui.showCountdown(value);
      this.audio.beep(466, 0.13, 0.1);
    }
  }

  updateRace(dt) {
    this.raceTime += dt;
    if (this.track) this.track.updateFeatures(dt, this.raceTime);

    if (this.goTimer > 0) {
      this.goTimer -= dt;
      if (this.goTimer <= 0) this.ui.hideCountdown();
    }

    const player = this.playerKart;
    player.step(dt, this.input.controls, this.track, this.raceTime);
    if (player.turboJustActivated) this.audio.turbo(player.turboLevel);

    for (const kart of this.karts) {
      if (kart === player) continue;
      // Rubber-banding moderado y distinto por dificultad: acerca ritmos, pero
      // no regala vueltas ni coloca karts a mano.
      const gap = player.progress - kart.progress;
      const tuning = this.difficulty;
      kart.speedBias = kart.finished
        ? 1
        : clamp(
            1 + (gap / tuning.rubberBandDivisor) * tuning.rubberBandStrength,
            tuning.rubberBandMin,
            tuning.rubberBandMax,
          );
      const controls = computeAIControls(kart, this.track, {
        karts: this.karts,
        dt,
        raceTime: this.raceTime,
        difficulty: this.difficulty,
      });
      kart.step(dt, controls, this.track, this.raceTime);
    }

    this.applyTrackFeatures(dt);
    this.resolveCollisions();
    this.itemSystem.update(dt, this.karts);
    this.updateStandings();
    this.refreshHud();
    this.ui.updateMinimap(this.track, this.karts, player);
    this.audio.setEngine(Math.abs(player.speed) / player.maxSpeed, player.onGrass);

    if (player.finished) this.finishRace();
  }

  /**
   * Mecánicas de mapa: placas de turbo, rampas con salto y obstáculos móviles.
   * Se aplican después de mover los karts para usar su proyección más reciente.
   */
  applyTrackFeatures(dt) {
    const features = this.track?.features;
    if (!features) return;

    for (const kart of this.karts) {
      this.applyBoostPads(kart, features.boostPads);
      this.applyRamps(kart, features.ramps);
      this.applyObstacles(kart, features.obstacles);
      kart.group.position.set(kart.position.x, 0.02 + kart.height, kart.position.z);

      if (kart.isPlayer && kart.justLanded) {
        this.audio.beep(180, 0.09, 0.055, 'triangle');
        kart.justLanded = false;
      }
    }
  }

  applyBoostPads(kart, pads) {
    if (!pads || pads.length === 0 || kart.finished) return;
    for (const pad of pads) {
      const delta = Math.abs(this.track.wrapDelta(kart.trackS - pad.s));
      if (delta > pad.length / 2 + 0.8) continue;
      if (Math.abs(kart.lateral - pad.lateral) > pad.width / 2 + 0.55) continue;
      if ((kart.featureCooldowns.get(pad.id) ?? 0) > this.raceTime) continue;

      kart.featureCooldowns.set(pad.id, this.raceTime + 1.1);
      kart.applyItemBoost(pad.def.power ?? 0.26, pad.def.duration ?? 0.5);
      if (kart.isPlayer) {
        this.ui.flashBoost?.();
        this.audio.turbo(1);
      }
    }
  }

  applyRamps(kart, ramps) {
    if (!ramps || ramps.length === 0 || kart.finished) return;
    const onRamp = this.track.rampAt(kart);

    if (onRamp && !kart.airborne) {
      kart.setRampHeight(onRamp.height);
      return;
    }

    if (!kart.airborne && kart.rampHeight > 0.3) {
      if (kart.speed > 5) {
        const launch =
          CONFIG.air.launchBase +
          Math.min(34, Math.max(0, kart.speed)) * CONFIG.air.launchPerSpeed +
          kart.rampHeight * 0.1;
        kart.startJump(launch);
        if (kart.isPlayer) {
          this.ui.flashLaunch();
          this.audio.turbo(1);
        }
      } else {
        kart.setRampHeight(0);
      }
    } else if (!kart.airborne) {
      kart.setRampHeight(0);
    }
  }

  applyObstacles(kart, obstacles) {
    if (!obstacles || obstacles.length === 0 || kart.finished) return;
    for (const obstacle of obstacles) {
      const delta = Math.abs(this.track.wrapDelta(kart.trackS - obstacle.s));
      if (delta > obstacle.depth / 2 + 1.15) continue;
      if (Math.abs(kart.lateral - obstacle.lateral) > obstacle.width / 2 + 0.95) continue;
      if (kart.height > obstacle.height + 0.35) continue;
      if ((kart.featureCooldowns.get(obstacle.id) ?? 0) > this.raceTime) continue;

      kart.featureCooldowns.set(obstacle.id, this.raceTime + 1.25);
      const side = Math.sign(kart.lateral - obstacle.lateral) || 1;
      const blocked = !kart.applyImpact(
        {
          slowFactor: obstacle.kind === 'platform' ? 0.68 : 0.56,
          slowDuration: obstacle.kind === 'platform' ? 0.65 : 0.95,
          controlDuration: obstacle.kind === 'gate' ? 0.5 : 0.35,
          controlStrength: obstacle.kind === 'gate' ? 0.5 : 0.38,
          impactSpeedLoss: obstacle.kind === 'platform' ? 0.9 : 0.84,
        },
        side,
      );

      const projection = this.track.project(kart.position);
      const push = obstacle.kind === 'boulder' ? 0.95 : 0.7;
      kart.position.x += projection.sx * side * push;
      kart.position.z += projection.sz * side * push;
      kart.lateral += side * push;
      if (obstacle.kind === 'gate') {
        kart.position.x -= projection.tx * 0.35;
        kart.position.z -= projection.tz * 0.35;
      }

      if (kart.isPlayer) {
        this.ui.flashImpact(!blocked, obstacle.kind === 'boulder');
        this.audio.impact(!blocked);
      }
    }
  }

  resolveCollisions() {
    const minDistance = 2.05;
    for (let i = 0; i < this.karts.length; i += 1) {
      for (let j = i + 1; j < this.karts.length; j += 1) {
        const a = this.karts[i];
        const b = this.karts[j];
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 0.0001 && distance < minDistance) {
          const overlap = minDistance - distance;
          const nx = dx / distance;
          const nz = dz / distance;
          // El kart pesado cede menos terreno en un roce.
          const massA = a.mass ?? 1;
          const massB = b.mass ?? 1;
          const shareA = massB / (massA + massB);
          const shareB = massA / (massA + massB);
          a.position.x -= nx * overlap * shareA;
          a.position.z -= nz * overlap * shareA;
          b.position.x += nx * overlap * shareB;
          b.position.z += nz * overlap * shareB;
          a.speed *= clamp(1 - 0.02 * (massB / massA), 0.95, 1);
          b.speed *= clamp(1 - 0.02 * (massA / massB), 0.95, 1);
        }
      }
    }

    // Tras los empujones, que nadie quede fuera de los muros.
    const limit = this.track.wallOffset - CONFIG.kart.wallLimitExtra;
    for (const kart of this.karts) {
      const projection = this.track.project(kart.position);
      if (Math.abs(projection.lateral) > limit) {
        const side = Math.sign(projection.lateral);
        kart.position.x = projection.centerX + projection.sx * limit * side;
        kart.position.z = projection.centerZ + projection.sz * limit * side;
      }
      kart.group.position.set(kart.position.x, 0.02 + (kart.height ?? 0), kart.position.z);
    }
  }

  updateStandings() {
    this.standings = [...this.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
  }

  getPlayerPosition() {
    const index = this.standings.indexOf(this.playerKart);
    return index >= 0 ? index + 1 : this.karts.length;
  }

  refreshHud() {
    const player = this.playerKart;
    const lapTime = player.lapStartTime !== null ? this.raceTime - player.lapStartTime : 0;
    this.ui.updateHud({
      lap: Math.min(player.lap, CONFIG.laps),
      laps: CONFIG.laps,
      position: this.getPlayerPosition(),
      time: this.raceTime,
      lapTime,
      best: player.bestLapTime,
      speed: Math.abs(player.speed),
      maxSpeed: player.maxSpeed,
      offroad: player.onGrass && Math.abs(player.speed) > 2,
    });

    const charge = player.turboActive && player.turboDuration > 0
      ? (player.turboTime / player.turboDuration) * CONFIG.drift.chargeMax
      : player.driftCharge;
    this.ui.updatePower({
      charge,
      chargeMax: CONFIG.drift.chargeMax,
      level1: CONFIG.drift.chargeLevel1,
      level2: CONFIG.drift.chargeLevel2,
      drifting: player.driftActive,
      turboActive: player.turboActive,
      turboLevel: player.turboLevel,
      boosting: player.turboActive || player.itemBoostTime > 0,
    });

    this.ui.updateItem({
      item: player.item ? ITEMS[player.item] : null,
      cooldown: player.itemUseCooldown,
      cooldownMax: 0.7,
    });

    const stunRatio =
      player.stunDuration > 0
        ? 1 - clamp(player.stunTime / player.stunDuration, 0, 1)
        : 0;
    this.ui.updateStun({
      active: player.stunTime > 0,
      ratio: stunRatio,
      recovering: player.stunTime > 0 && stunRatio > 0.55,
    });
  }

  finishRace() {
    if (this.state !== 'racing') return;
    this.state = 'finished';
    this.playerKart.finished = true;
    this.ui.hideCountdown();
    this.audio.stopEngine();
    this.audio.finishJingle();
    this.input.clear();
    for (const kart of this.karts) kart.clearTransientState();
    this.itemSystem.clearEffects();
    this.updateStandings();

    const position = this.getPlayerPosition();

    // Recompensa única por carrera: solo paga la victoria y nunca dos veces.
    let coins = 0;
    let saveOk = true;
    if (!this.rewardClaimed) {
      this.rewardClaimed = true;
      const backup = JSON.parse(JSON.stringify(this.progress));
      this.progress.stats.races += 1;
      if (position === 1) {
        coins = coinsFor(this.difficultyId);
        grantCoins(this.progress, coins);
        this.progress.stats.wins += 1;
      }
      if (!saveProgress(this.progress)) {
        // Si no se puede guardar, no se muestra un saldo que se perdería.
        this.progress = backup;
        coins = 0;
        saveOk = false;
      }
    }

    const rows = this.standings.map((kart, index) => ({
      position: index + 1,
      name: kart.name,
      cssColor: `#${kart.color.toString(16).padStart(6, '0')}`,
      isPlayer: kart.isPlayer,
      finished: kart.finished,
      time: kart.finishTime,
    }));

    const totalTime = this.playerKart.finishTime ?? this.raceTime;
    const bestLap = this.playerKart.bestLapTime;
    let note =
      `Has completado las ${CONFIG.laps} vueltas en ${formatTime(totalTime)}.` +
      (bestLap ? ` Tu mejor vuelta fue ${formatTime(bestLap)}.` : '') +
      (position === 1 ? ' ¡Carrera perfecta!' : ' Vuelve a intentarlo para subir al podio.');
    if (!saveOk) {
      note += ' No se pudo guardar la recompensa: revisa el almacenamiento del navegador.';
    } else if (coins > 0) {
      note += ` Has ganado ${coins} monedas.`;
    }

    this.ui.showResults({
      position,
      total: this.karts.length,
      rows,
      note,
    });
    this.ui.setProgress(this.progress);
    this.shop?.setProgress(this.progress);
    this.shop?.showReward({
      coins,
      balance: this.progress.coins,
      difficulty: this.difficulty.label,
      won: coins > 0,
    });
    this.ui.updateMinimap(this.track, this.karts, this.playerKart);
  }

  pause() {
    if (this.state !== 'racing') return;
    this.state = 'paused';
    this.ui.showPause(true);
    this.audio.stopEngine();
    this.input.clear();
    // Nada queda congelado a medias: se cancelan derrape, turbo, objetos y
    // estados de la IA al pausar o cambiar de pestaña. Los proyectiles en vuelo
    // se conservan quietos y siguen al reanudar (updateRace no se ejecuta).
    for (const kart of this.karts) kart.clearTransientState();
    if (this.itemSystem) this.itemSystem.clearEffects({ keepProjectiles: true });
    this.timer.reset();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'racing';
    this.ui.showPause(false);
    this.audio.resumeEngine();
    this.input.clear();
    this.timer.reset();
  }

  goToMenu() {
    this.state = 'menu';
    this.audio.stopEngine();
    this.input.clear();
    if (this.shop?.isOpen) this.shop.close();
    this.ui.showMenu();
    this.ui.showPause(false);
    this.ui.hideCountdown();
    this.ui.setProgress(this.progress);
    this.shop?.setProgress(this.progress);
    this.resetRace();
    this.menuTime = 0;
    this.menuCameraReady = false;
  }

  // ---------------------------------------------------------------------------
  // Cámara y bucle principal
  // ---------------------------------------------------------------------------

  updateMenuCamera(dt) {
    this.menuTime += dt;
    const { centerX, centerZ } = this.track.bounds;
    const env = this.map.environment ?? {};
    const angle = 0.7 + this.menuTime * 0.055;
    const radius = env.menuRadius ?? 235;
    const height = env.menuHeight ?? 88;
    const desiredX = centerX + Math.cos(angle) * radius;
    const desiredZ = centerZ + Math.sin(angle) * radius;

    if (!this.menuCameraReady) {
      this.camera.position.set(desiredX, height, desiredZ);
      this.menuCameraReady = true;
    } else {
      const factor = 1 - Math.exp(-dt * 1.4);
      this.camera.position.x += (desiredX - this.camera.position.x) * factor;
      this.camera.position.y += (height - this.camera.position.y) * factor;
      this.camera.position.z += (desiredZ - this.camera.position.z) * factor;
    }

    this.camera.lookAt(centerX, 0, centerZ);
    this.camPos.copy(this.camera.position);
    this.camLook.set(centerX, 0, centerZ);
  }

  updateCamera(dt) {
    const kart = this.playerKart;
    const forwardX = Math.sin(kart.heading);
    const forwardZ = Math.cos(kart.heading);
    const speedRatio = Math.min(1, Math.abs(kart.speed) / kart.maxSpeed);

    const distance = CONFIG.camera.distance + speedRatio * 1.1;
    const height = CONFIG.camera.height + speedRatio * 0.35 + (kart.height ?? 0) * 0.7;
    const desiredX = kart.position.x - forwardX * distance;
    const desiredZ = kart.position.z - forwardZ * distance;
    const desiredLookX = kart.position.x + forwardX * CONFIG.camera.lookAhead;
    const desiredLookZ = kart.position.z + forwardZ * CONFIG.camera.lookAhead;
    const desiredLookY = CONFIG.camera.lookHeight + (kart.height ?? 0) * 0.85;

    if (this.snapCamera) {
      this.camPos.set(desiredX, height, desiredZ);
      this.camLook.set(desiredLookX, desiredLookY, desiredLookZ);
      this.snapCamera = false;
    } else {
      const positionFactor = 1 - Math.exp(-dt * 5.6);
      const lookFactor = 1 - Math.exp(-dt * 7.5);
      this.camPos.x += (desiredX - this.camPos.x) * positionFactor;
      this.camPos.y += (height - this.camPos.y) * positionFactor;
      this.camPos.z += (desiredZ - this.camPos.z) * positionFactor;
      this.camLook.x += (desiredLookX - this.camLook.x) * lookFactor;
      this.camLook.y += (desiredLookY - this.camLook.y) * lookFactor;
      this.camLook.z += (desiredLookZ - this.camLook.z) * lookFactor;
    }

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    const targetFov = this.baseFov + speedRatio * 7;
    if (Math.abs(this.camera.fov - targetFov) > 0.02) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
    }
  }

  updateSun() {
    const player = this.playerKart;
    this.sun.position.set(
      player.position.x + this.sunOffset.x,
      this.sunOffset.y,
      player.position.z + this.sunOffset.z,
    );
    this.sun.target.position.set(player.position.x, 0, player.position.z);
    this.sun.target.updateMatrixWorld();
  }

  animate() {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);

    // dt limitado: al volver de otra pestaña no hay saltos enormes.
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);

    switch (this.state) {
      case 'menu':
        this.updateMenuCamera(dt);
        if (this.shop?.isOpen) {
          this.shop.update(dt);
        } else if (this.preview) {
          this.preview.update(dt);
          this.preview.render();
        }
        break;
      case 'countdown':
        this.updateCountdown(dt);
        for (const kart of this.karts) kart.updateVisual(dt, 0, 0);
        this.updateCamera(dt);
        break;
      case 'racing':
        this.updateRace(dt);
        this.updateCamera(dt);
        break;
      case 'paused':
      case 'finished':
      default:
        break;
    }

    this.updateSun();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    for (const [target, type, handler, options] of this.listeners) {
      target.removeEventListener(type, handler, options);
    }
    this.listeners = [];
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.timer.dispose();
    this.input.dispose();
    this.audio.dispose();
    if (this.preview) this.preview.dispose();
    if (this.shop) this.shop.dispose();

    if (this.itemSystem) this.itemSystem.dispose();
    for (const kart of this.karts) {
      this.scene.remove(kart.group);
      kart.dispose();
    }
    this.track.dispose();
    this.scene.remove(this.track.group);

    for (const object of [this.sky, this.sunBall]) {
      if (object && object.geometry) object.geometry.dispose();
      if (object && object.material) {
        if (object.material.map) object.material.map.dispose();
        object.material.dispose();
      }
    }
    if (this.scene.fog) this.scene.fog = null;

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.remove();
    }
  }
}
