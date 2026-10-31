// Núcleo del juego: escena 3D, estados de carrera, cámara, rivales y HUD.
import * as THREE from 'three';
import { computeAIControls } from './AIController.js';
import { AudioManager } from './Audio.js';
import { CONFIG } from './config.js';
import { DIFFICULTIES, isDifficulty, loadDifficulty, saveDifficulty } from './difficulty.js';
import { Effects } from './Effects.js';
import { Input } from './Input.js';
import { ItemSystem } from './ItemSystem.js';
import { isTextEntryTarget } from './keyboard.js';
import { ITEMS } from './items.js';
import { AI_KARTS, DEFAULT_KART, PLAYER_KARTS, getKart } from './karts.js';
import { Kart } from './Kart.js';
import { KartPreview } from './KartPreview.js';
import { DEFAULT_MAP, getMap } from './maps.js';
import { Track } from './Track.js';
import { UI } from './UI.js';
import { clamp, formatTime, lerpAngle } from './utils.js';
import { OvertakeTracker, driftIntensity, turboIntensity } from './raceFeedback.js';
import { OnlineClient } from '../online/OnlineClient.js';
import { loadName, onlineErrorMessage, saveName } from '../online/config.js';
import {
  COUNTDOWN_MS,
  ONLINE_KARTS,
  ONLINE_MAPS,
  isValidRoomCode,
  normalizeRoomCode,
  sanitizeName,
} from '../../shared/protocol.js';
import {
  coinsFor,
  grantCoins,
  loadProgress,
  ownsKart,
  ownsLoadout,
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
    // loadProgress repara el perfil en memoria; no se guarda nada al arrancar
    // para no sobrescribir una partida guardada si la lectura ha fallado.
    this.progress = loadProgress();
    this.kartId = this.progress.selectedKart;
    this.kartSpec = getKart(this.kartId);
    this.mapId = this.progress.selectedMap;
    this.map = getMap(this.mapId);
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
    this.effects = new Effects(this.scene);
    this.overtakes = new OvertakeTracker();
    this.cameraShake = 0;
    this.shakeTime = 0;
    this.camRender = new THREE.Vector3();
    this.bumpCooldowns = new Map();
    this.wallContacts = new Map();
    // Multijugador: la red no toca el progreso local ni las seis pistas.
    this.online = null;
    this.onlineMode = false;
    this.onlineRoom = null;
    this.onlineSelfId = null;
    this.onlineRemotes = new Map();
    this.onlineStandings = [];
    this.onlineRaceStartAt = 0;
    this.onlineRaceMapId = null;
    this.onlineFinalShown = false;
    this.onlineCountdownValue = 3;
    this.onlineResultShown = false;
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
    this.aiKarts = AI_KARTS.map((spec) => new Kart(spec));
    this.karts = [this.playerKart, ...this.aiKarts];

    for (const kart of this.karts) this.scene.add(kart.group);
  }

  /** Vuelve a crear el sistema de objetos para la pista actual. */
  createItemSystem() {
    if (this.itemSystem) this.itemSystem.dispose();
    this.itemSystem = new ItemSystem(this.scene, this.track, this.karts);
    this.itemSystem.setDifficulty?.(this.difficulty);
    this.itemSystem.onPickup = (kart) => {
      if (kart === this.playerKart) {
        this.audio.pickup();
        this.effects?.emitPickup(kart);
      }
    };
    this.itemSystem.onUse = (kart, id) => {
      if (kart === this.playerKart) {
        this.audio.item(id);
        this.effects?.emitPickup(kart);
      }
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
    listen(this.ui.el.againButton, 'click', () => {
      if (this.onlineMode) this.requestOnlineRematch();
      else this.startRace({ snapCamera: true });
    });
    listen(this.ui.el.menuButton, 'click', () => {
      if (this.onlineMode) this.leaveOnline({ toMenu: true });
      else this.goToMenu();
    });
    listen(this.ui.el.pauseButton, 'click', () => {
      if (this.onlineMode) return;
      if (this.state === 'racing') this.pause();
      else if (this.state === 'paused') this.resume();
    });
    listen(this.ui.el.soundButton, 'click', () => this.toggleSound());
    if (this.ui.el.onlineButton) {
      listen(this.ui.el.onlineButton, 'click', () => this.openOnline());
    }
    if (this.ui.el.onlineBack) {
      listen(this.ui.el.onlineBack, 'click', () => this.handleOnlineBack());
    }
    if (this.ui.el.onlineCreate) {
      listen(this.ui.el.onlineCreate, 'click', () => this.createOnlineRoom());
    }
    if (this.ui.el.onlineJoin) {
      listen(this.ui.el.onlineJoin, 'click', () => this.joinOnlineRoom());
    }
    if (this.ui.el.onlineLeave) {
      listen(this.ui.el.onlineLeave, 'click', () => this.leaveOnline({ toMenu: false }));
    }
    if (this.ui.el.onlineStart) {
      listen(this.ui.el.onlineStart, 'click', () => this.startOnlineRace());
    }
    if (this.ui.el.onlineCopy) {
      listen(this.ui.el.onlineCopy, 'click', () => this.copyOnlineCode());
    }
    if (this.ui.el.onlineMap) {
      listen(this.ui.el.onlineMap, 'change', async () => {
        const mapId = this.ui.el.onlineMap.value;
        const result = await this.online?.setMap(mapId);
        // Si el servidor rechaza el cambio (carrera ya iniciada, no eres
        // anfitrión…), el selector vuelve a la pista real de la sala.
        if (result && !result.ok) {
          const real = this.onlineRoom?.mapId;
          if (real) this.ui.el.onlineMap.value = real;
          this.ui.showOnlineError(onlineErrorMessage(result.error));
        }
      });
    }
    if (this.ui.el.onlineName) {
      listen(this.ui.el.onlineName, 'change', () => {
        saveName(this.ui.getOnlineName());
      });
    }
    if (this.ui.el.onlineCode) {
      listen(this.ui.el.onlineCode, 'input', () => {
        const clean = normalizeRoomCode(this.ui.el.onlineCode.value);
        if (this.ui.el.onlineCode.value !== clean) this.ui.el.onlineCode.value = clean;
      });
      listen(this.ui.el.onlineCode, 'keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.joinOnlineRoom();
        }
      });
    }
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
      // Nunca se ejecutan atajos del juego mientras se escribe un nombre,
      // un código de sala o cualquier otro campo de texto.
      if (isTextEntryTarget(event.target)) return;
      // Con la tienda abierta el teclado no puede arrancar la carrera.
      if (this.shop?.isOpen) {
        if (code === 'Escape') {
          event.preventDefault();
          this.closeShop();
        }
        return;
      }
      if (code === 'Enter') {
        if (this.state === 'menu' && !this.isOnlineScreenOpen()) {
          event.preventDefault();
          this.startRace({ snapCamera: false });
        }
        return;
      }
      if (code === 'KeyP' || code === 'Escape') {
        if (this.onlineMode) return;
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
        if (this.onlineMode) this.useOnlineItem();
        else this.itemSystem.useItem(this.playerKart);
      }
    };

    // El botón táctil de objeto comparte la mecánica de la tecla E.
    this.input.onTouchAction = (action) => {
      if (action === 'item' && this.state === 'racing') {
        if (this.onlineMode) this.useOnlineItem();
        else this.itemSystem.useItem(this.playerKart);
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
        if (this.state === 'racing' && !this.onlineMode) this.pause();
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
    if (!map) return;
    // El contenido bloqueado no se puede elegir: lleva a la tienda.
    if (!ownsMap(this.progress, map.id)) {
      this.openShop('maps', map.id);
      return;
    }
    if (map.id === this.mapId) return;
    const previous = this.progress.selectedMap;
    if (!selectMap(this.progress, map.id)) return;
    if (!saveProgress(this.progress)) {
      // Si no se puede guardar, la selección no cambia de verdad.
      this.progress.selectedMap = previous;
      this.ui.setProgress(this.progress);
      this.shop?.setProgress(this.progress);
      this.ui.notice('No se pudo guardar el circuito. Revisa el almacenamiento del navegador.', 'error');
      return;
    }
    this.ui.notice('');
    this.applyMap(map);
    this.ui.setProgress(this.progress);
  }

  /** Reconstruye la pista y la parrilla para el circuito indicado. */
  applyMap(map) {
    if (!map || map.id === this.mapId) return;
    this.mapId = map.id;
    this.map = map;

    this.input.clear();
    for (const kart of this.karts) kart.clearTransientState();
    if (this.itemSystem) this.itemSystem.clearEffects();
    if (this.effects) this.effects.clear();
    this.bumpCooldowns?.clear();
    this.wallContacts?.clear();
    this.cameraShake = 0;

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
    if (!spec) return;
    if (!ownsKart(this.progress, spec.id)) {
      this.openShop('karts', spec.id);
      return;
    }
    if (spec.id === this.kartId) return;
    const previous = this.progress.selectedKart;
    if (!selectKart(this.progress, spec.id)) return;
    if (!saveProgress(this.progress)) {
      // Si no se puede guardar, la selección no cambia de verdad.
      this.progress.selectedKart = previous;
      this.ui.setProgress(this.progress);
      this.shop?.setProgress(this.progress);
      this.ui.notice('No se pudo guardar el kart. Revisa el almacenamiento del navegador.', 'error');
      return;
    }
    this.ui.notice('');
    this.applyKart(spec);
    this.ui.setProgress(this.progress);
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

  firstOwnedKartId() {
    if (ownsKart(this.progress, DEFAULT_KART)) return DEFAULT_KART;
    return this.progress?.karts?.[0] ?? DEFAULT_KART;
  }

  firstOwnedMapId() {
    if (ownsMap(this.progress, DEFAULT_MAP)) return DEFAULT_MAP;
    return this.progress?.maps?.[0] ?? DEFAULT_MAP;
  }

  /**
   * Red de seguridad antes de correr: nunca se arranca con un kart o circuito
   * bloqueado. Comprueba tanto el id seleccionado como el modelo/pista que se
   * va a usar, porque un estado incoherente podría dejar la pista de Orbital
   * con el id de Costa. Si algo no cuadra se corrige a Rayo/Costa y se guarda.
   */
  ensureOwnedLoadout() {
    let changed = false;

    const kartOwned =
      ownsKart(this.progress, this.kartId) &&
      (!this.kartSpec || ownsKart(this.progress, this.kartSpec.id));
    if (!kartOwned) {
      const kartId = this.firstOwnedKartId();
      // Fuerza la reconstrucción aunque el id coincida: el modelo puede ser otro.
      this.kartId = null;
      this.applyKart(getKart(kartId));
      changed = true;
    } else if (this.kartSpec && this.kartSpec.id !== this.kartId) {
      const kartId = this.kartId;
      this.kartId = null;
      this.applyKart(getKart(kartId));
      changed = true;
    }
    if (this.progress.selectedKart !== this.kartId) {
      this.progress.selectedKart = this.kartId;
      changed = true;
    }

    const mapOwned =
      ownsMap(this.progress, this.mapId) &&
      (!this.map || ownsMap(this.progress, this.map.id));
    if (!mapOwned) {
      const mapId = this.firstOwnedMapId();
      // Fuerza la reconstrucción aunque el id coincida: la pista puede ser otra.
      this.mapId = null;
      this.applyMap(getMap(mapId));
      changed = true;
    } else if (this.map && this.map.id !== this.mapId) {
      const mapId = this.mapId;
      this.mapId = null;
      this.applyMap(getMap(mapId));
      changed = true;
    }
    if (this.progress.selectedMap !== this.mapId) {
      this.progress.selectedMap = this.mapId;
      changed = true;
    }

    if (changed) saveProgress(this.progress);
    return !changed;
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
    this.ui.notice('');
    this.ui.setProgress(this.progress);
    this.shop?.setProgress(this.progress);
    this.shop?.renderGrid();
    this.shop?.selectPreview(id);
    this.shop?.note(`¡${name} desbloqueado! Ya puedes equiparlo.`, 'ok');
    return result;
  }

  /** Equipa contenido desbloqueado. Nunca permite seleccionar un bloqueo. */
  selectItem(kind, id) {
    if (!this.progress || (kind !== 'kart' && kind !== 'map')) return false;
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

    this.ui.notice('');
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
  // Multijugador online
  // ---------------------------------------------------------------------------

  isOnlineScreenOpen() {
    return Boolean(this.ui.el.online && !this.ui.el.online.classList.contains('hidden'));
  }

  /**
   * Crea el cliente de red la primera vez. El socket se conecta en segundo
   * plano; las operaciones esperan a que esté listo. No se toca nada guardado
   * del jugador salvo el nombre visible del modo online, en su propia clave.
   */
  ensureOnline() {
    if (this.online) return this.online;
    this.online = new OnlineClient({
      onStatus: (status) => this.handleOnlineStatus(status),
      onRoom: (room) => this.handleOnlineRoom(room),
      onRoomClosed: (payload) => this.handleOnlineRoomClosed(payload),
      onPresence: (payload) => this.handleOnlinePresence(payload),
      onRaceStart: (payload) => this.beginOnlineRace(payload, { resume: false }),
      onRaceResume: (payload) => this.beginOnlineRace(payload, { resume: true }),
      onRaceState: (payload) => this.applyRemoteSnapshot(payload),
      onStandings: (payload) => this.handleOnlineStandings(payload),
      onFinal: (payload) => this.finishOnlineRace(payload),
      onPlayerLeft: (payload) => this.removeOnlinePlayer(payload?.id),
      onItemAward: (payload) => this.handleOnlineItemAward(payload),
      onItemBox: (payload) => this.handleOnlineItemBox(payload),
      onItemUse: (payload) => this.handleOnlineItemUse(payload),
      onItemDenied: (payload) => this.handleOnlineItemDenied(payload),
      onError: (code) => this.handleOnlineError(code),
    });
    this.ui.setOnlineServer(this.online.configUrl);
    this.ui.setOnlineName(loadName());
    this.online.connect();
    return this.online;
  }

  openOnline() {
    if (this.state !== 'menu') this.goToMenu();
    this.ensureOnline();
    this.ui.showOnline();
    this.ui.setOnlineName(loadName());
    this.ui.setOnlineConnection(this.online.connected ? 'connected' : 'connecting');
    if (this.online.room) {
      this.onlineRoom = this.online.room;
      this.ui.setOnlineRoom(this.onlineRoom, this.online.selfId ?? this.onlineSelfId);
    } else {
      this.ui.showOnlineHome();
    }
  }

  handleOnlineStatus(status) {
    this.ui.setOnlineConnection(status.state);
    if (status.state === 'connected') {
      this.ui.showOnlineError('');
    } else if (status.state === 'offline' && this.onlineMode) {
      this.ui.showOnlineToast('Sin conexión con el servidor. Reintentando…', 'error');
    }
  }

  handleOnlineError(code) {
    const message = onlineErrorMessage(code);
    if (this.onlineMode) this.ui.showOnlineToast(message, 'error');
    else this.ui.showOnlineError(message);
  }

  handleOnlineRoom(room) {
    this.onlineRoom = room;
    this.onlineSelfId = this.online?.selfId ?? this.onlineSelfId;
    if (!room) {
      this.ui.showOnlineHome();
      return;
    }
    // Revancha o vuelta al vestíbulo: la escena vuelve al menú de la sala.
    if (room.status === 'lobby' && this.onlineMode) this.exitOnlineRaceScene();
    // Durante la carrera el overlay debe seguir oculto: solo se sincronizan
    // los karts que falten (reconexiones).
    if (this.onlineMode && room.status !== 'lobby') {
      this.syncOnlineKarts(room);
      return;
    }
    this.ui.setOnlineRoom(room, this.onlineSelfId);
    if (room.status === 'racing') this.syncOnlineKarts(room);
  }

  handleOnlineRoomClosed(payload) {
    this.onlineRoom = null;
    this.onlineStandings = [];
    if (this.onlineMode) this.exitOnlineRaceScene();
    this.ui.hideOnlineRace();
    this.ui.hideResults();
    this.ui.showOnlineHome();
    this.ui.showOnlineError('');
    const messages = {
      empty: 'La sala se cerró por inactividad.',
      expired: 'Se agotó el tiempo para reconectar y la sala te ha expulsado.',
    };
    this.ui.showOnlineToast(messages[payload?.reason] ?? 'La sala se ha cerrado.', 'error');
  }

  handleOnlinePresence(payload) {
    if (!payload) return;
    const name = payload.name ?? 'Un piloto';
    const isSelf = Boolean(payload.id && payload.id === this.onlineSelfId);
    if (payload.type === 'host') {
      const self = payload.newHostId
        ? payload.newHostId === this.onlineSelfId
        : payload.newHostName && this.onlineRoom?.hostId === this.onlineSelfId;
      this.ui.showOnlineToast(
        self ? 'Ahora eres el anfitrión de la sala.' : `El nuevo anfitrión es ${payload.newHostName}.`,
        'ok',
      );
      return;
    }
    if (isSelf) return;
    if (payload.type === 'join') this.ui.showOnlineToast(`${name} se ha unido a la sala.`, 'ok');
    else if (payload.type === 'leave') this.ui.showOnlineToast(`${name} ha salido de la sala.`);
    else if (payload.type === 'disconnect') {
      this.ui.showOnlineToast(`${name} se ha desconectado. Tiene unos segundos para volver.`, 'error');
    } else if (payload.type === 'reconnect') {
      this.ui.showOnlineToast(`${name} se ha reconectado.`, 'ok');
    }
  }

  normalizeOnlineName() {
    const raw = sanitizeName(this.ui.getOnlineName());
    if (!raw) {
      this.ui.showOnlineError('Escribe un nombre de 1 a 16 caracteres.');
      return null;
    }
    this.ui.setOnlineName(raw);
    saveName(raw);
    return raw;
  }

  onlineKartId() {
    return ONLINE_KARTS.includes(this.kartId) ? this.kartId : 'rayo';
  }

  onlineMapId() {
    return ONLINE_MAPS.includes(this.mapId) ? this.mapId : 'coast';
  }

  async createOnlineRoom() {
    const name = this.normalizeOnlineName();
    if (!name) return;
    const client = this.ensureOnline();
    this.ui.showOnlineError('');
    const ready = await client.ready();
    if (!ready) {
      this.ui.showOnlineError(onlineErrorMessage('timeout'));
      return;
    }
    const result = await client.createRoom({
      name,
      kartId: this.onlineKartId(),
      mapId: this.onlineMapId(),
    });
    if (!result.ok) {
      this.ui.showOnlineError(onlineErrorMessage(result.error));
      return;
    }
    this.onlineSelfId = result.youId ?? client.selfId;
    this.onlineRoom = result.room;
    this.ui.setOnlineRoom(result.room, this.onlineSelfId);
    this.ui.showOnlineToast('Sala creada. Comparte el código.', 'ok');
  }

  async joinOnlineRoom() {
    const name = this.normalizeOnlineName();
    if (!name) return;
    const code = normalizeRoomCode(this.ui.getOnlineCode());
    if (!isValidRoomCode(code)) {
      this.ui.showOnlineError('El código debe tener 5 caracteres (sin 0, O, 1, I ni L).');
      return;
    }
    const client = this.ensureOnline();
    this.ui.showOnlineError('');
    const ready = await client.ready();
    if (!ready) {
      this.ui.showOnlineError(onlineErrorMessage('timeout'));
      return;
    }
    const result = await client.joinRoom({ name, code, kartId: this.onlineKartId() });
    if (!result.ok) {
      this.ui.showOnlineError(onlineErrorMessage(result.error));
      return;
    }
    this.onlineSelfId = result.youId ?? client.selfId;
    this.onlineRoom = result.room;
    this.ui.setOnlineRoom(result.room, this.onlineSelfId);
    this.ui.showOnlineToast('Has entrado en la sala.', 'ok');
  }

  async startOnlineRace() {
    if (!this.online || this.onlineRoom?.hostId !== this.onlineSelfId) return;
    const result = await this.online.startRace();
    if (!result.ok) this.ui.showOnlineError(onlineErrorMessage(result.error));
  }

  async copyOnlineCode() {
    const code = this.onlineRoom?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.ui.showOnlineToast('Código copiado al portapapeles.', 'ok');
    } catch {
      this.ui.setOnlineCode(code);
      this.ui.el.onlineCode?.select?.();
      this.ui.showOnlineToast('Código seleccionado: cópialo con Ctrl+C.', 'ok');
    }
  }

  handleOnlineBack() {
    if (this.online?.room) {
      this.leaveOnline({ toMenu: false });
      return;
    }
    this.ui.hideOnline();
    this.goToMenu();
  }

  async leaveOnline({ toMenu = true } = {}) {
    if (this.online?.room) {
      await this.online.leaveRoom();
    }
    this.onlineRoom = null;
    this.onlineStandings = [];
    this.resetOnlineScene();
    this.ui.hideOnline();
    if (toMenu) {
      this.goToMenu();
    } else {
      this.ui.showOnline();
      this.ui.showOnlineHome();
      this.ui.setOnlineConnection(this.online?.connected ? 'connected' : 'offline');
    }
  }

  /** Devuelve la escena al modo local sin tocar la selección guardada. */
  resetOnlineScene() {
    this.onlineMode = false;
    this.onlineFinalShown = false;
    this.onlineResultShown = false;
    this.removeOnlineKarts();
    for (const kart of this.aiKarts ?? []) kart.group.visible = true;
    this.karts.length = 0;
    this.karts.push(this.playerKart, ...(this.aiKarts ?? []));
    if (this.itemSystem) {
      this.itemSystem.onBoxClaim = null;
      this.itemSystem.setOnlineMode(false);
    }
    this.restoreLocalKart();
    this.restoreLocalTrack();
    this.state = 'menu';
    this.raceTime = 0;
    this.ui.hideOnlineRace();
    this.ui.hideResults();
    this.ui.hideCountdown();
    this.ui.showHud(false);
    this.ui.showPause(false);
    this.ui.showMenu();
    this.input.clear();
    this.audio.stopAll();
    this.effects?.clear();
    this.cameraShake = 0;
    this.overtakes?.reset([], this.playerKart);
    this.resetRace();
    this.menuTime = 0;
    this.menuCameraReady = false;
    this.updateMenuCamera(0);
  }

  restoreLocalKart() {
    const spec = this.kartSpec ?? getKart(this.kartId);
    if (!spec) return;
    if (this.playerKart?.id !== spec.id) {
      const old = this.playerKart;
      this.input.clear();
      if (old) {
        this.scene.remove(old.group);
        old.dispose();
      }
      const kart = new Kart({ ...spec, isPlayer: true });
      this.karts[0] = kart;
      this.playerKart = kart;
      this.scene.add(kart.group);
    }
    this.playerKart.name = spec.name;
    this.playerKart.netId = null;
  }

  restoreLocalTrack() {
    const returnId = this.onlineReturnMapId ?? this.progress?.selectedMap ?? DEFAULT_MAP;
    this.onlineReturnMapId = null;
    const map = getMap(returnId);
    if (map && map.id !== this.mapId) this.applyMap(map);
  }

  ensureOnlinePlayerKart(racer, ownState = null) {
    const spec = getKart(racer?.kartId) ?? getKart('rayo');
    const name = racer?.name || 'Piloto';
    if (this.playerKart?.id !== spec.id) {
      const old = this.playerKart;
      if (old) {
        this.scene.remove(old.group);
        old.dispose();
      }
      const kart = new Kart({ ...spec, name, isPlayer: true });
      this.playerKart = kart;
      this.karts[0] = kart;
      this.scene.add(kart.group);
    }
    this.playerKart.name = name;
    this.playerKart.netId = racer?.id ?? this.onlineSelfId;
    if (ownState) this.applyOwnState(this.playerKart, ownState);
    return this.playerKart;
  }

  applyOwnState(kart, state) {
    if (!state) return;
    kart.position.set(state.x, state.gy ?? 0, state.z);
    kart.groundY = state.gy ?? 0;
    kart.heading = state.hd ?? kart.heading;
    kart.speed = state.sp ?? 0;
    kart.height = state.h ?? 0;
    kart.progress = Number.isFinite(state.progress) ? state.progress : kart.progress;
    kart.lap = state.lap ?? kart.lap;
    kart.trackS = this.track.wrapS(this.track.startS + kart.progress);
    kart.group.position.set(kart.position.x, kart.groundY + 0.02 + kart.height, kart.position.z);
    kart.group.rotation.y = kart.heading;
  }

  createRemoteKart(racer) {
    if (!racer || racer.id === this.onlineSelfId) return null;
    if (this.onlineRemotes.has(racer.id)) return this.onlineRemotes.get(racer.id).kart;
    const spec = getKart(racer.kartId) ?? getKart('rayo');
    const kart = new Kart({ ...spec, name: racer.name || 'Piloto' });
    kart.netId = racer.id;
    this.scene.add(kart.group);
    this.onlineRemotes.set(racer.id, { kart, target: null });
    this.karts.push(kart);
    return kart;
  }

  removeOnlinePlayer(id) {
    const remote = this.onlineRemotes.get(id);
    if (!remote) return;
    const index = this.karts.indexOf(remote.kart);
    if (index >= 0) this.karts.splice(index, 1);
    this.scene.remove(remote.kart.group);
    remote.kart.dispose();
    this.onlineRemotes.delete(id);
  }

  removeOnlineKarts() {
    for (const id of [...this.onlineRemotes.keys()]) this.removeOnlinePlayer(id);
    this.onlineRemotes.clear();
  }

  syncOnlineKarts(room) {
    if (!room || room.status !== 'racing') return;
    for (const player of room.players) {
      if (player.id === this.onlineSelfId) continue;
      if (!this.onlineRemotes.has(player.id)) {
        const kart = this.createRemoteKart(player);
        if (kart) this.placeKartOnGrid(kart, player.slot ?? 0);
      }
    }
  }

  placeKartOnGrid(kart, slotIndex) {
    const grid = CONFIG.grid;
    const base = grid[slotIndex % grid.length];
    const back = base.back + Math.floor(slotIndex / grid.length) * 8;
    const s = this.track.wrapS(this.track.startS - back);
    kart.reset({ s, back, lateral: base.lateral, track: this.track });
  }

  async beginOnlineRace(payload, { resume = false } = {}) {
    if (!payload?.racers || !payload.mapId) return;
    this.onlineMode = true;
    this.onlineFinalShown = false;
    this.onlineResultShown = false;
    this.onlineSelfId = this.online?.selfId ?? this.onlineSelfId;
    this.onlineRaceMapId = payload.mapId;
    this.onlineRaceStartAt = payload.startAt;
    this.onlineCountdownValue = 3;

    // La pista online no exige comprarla: es una sala privada, no progreso.
    const map = getMap(payload.mapId);
    if (map && map.id !== this.mapId) this.applyMap(map);

    const racers = payload.racers;
    const self = racers.find((racer) => racer.id === this.onlineSelfId) ?? racers[0];
    if (!self) return;
    this.onlineSelfId = self.id;
    this.ensureOnlinePlayerKart(self, resume ? payload.ownState : null);

    this.removeOnlineKarts();
    for (const kart of this.aiKarts ?? []) kart.group.visible = false;
    this.karts.length = 0;
    this.karts.push(this.playerKart);

    for (const racer of racers) {
      if (racer.id === this.onlineSelfId) continue;
      const kart = this.createRemoteKart(racer);
      if (kart) this.placeKartOnGrid(kart, racer.slot ?? 0);
    }

    if (!(resume && payload.ownState)) {
      const slot = racers.indexOf(self);
      this.placeKartOnGrid(this.playerKart, slot >= 0 ? slot : 0);
    }

    this.itemSystem.setOnlineMode(true, this.playerKart);
    this.itemSystem.onBoxClaim = (boxIndex) => this.online?.claimBox(boxIndex);
    this.itemSystem.applyServerBoxes(payload.boxes);

    this.onlineStandings = payload.standings ?? (resume
      ? this.onlineStandings
      : racers.map((racer, index) => ({
          position: index + 1,
          id: racer.id,
          name: racer.name,
          kartId: racer.kartId,
          lap: 1,
          finished: false,
          connected: true,
        })));
    this.ui.hideOnline();
    this.ui.hideResults();
    this.ui.hideMenu();
    this.ui.showPause(false);
    this.ui.showHud(true);
    this.ui.updateOnlineRace({
      code: this.onlineRoom?.code ?? this.online?.room?.code,
      standings: this.onlineStandings,
      selfId: this.onlineSelfId,
    });

    const now = this.online?.serverNow() ?? Date.now();
    const remainingMs = this.onlineRaceStartAt - now;
    this.state = remainingMs > 0 ? 'countdown' : 'racing';
    this.raceTime = Math.max(0, (now - this.onlineRaceStartAt) / 1000);
    this.goTimer = 0;
    this.snapCamera = true;
    this.input.clear();
    this.timer.reset();
    this.audio.ensure();
    this.audio.startEngine();
    this.audio.resumeEngine();
    if (this.state === 'countdown') {
      this.ui.showCountdown(3);
      this.audio.beep(466, 0.13, 0.1);
    } else {
      this.ui.hideCountdown();
    }
    this.updateStandings();
    this.refreshHud();
    this.ui.updateMinimap(this.track, this.karts, this.playerKart);
    if (resume) this.ui.showOnlineToast('Te has reconectado a la carrera.', 'ok');
  }

  /** Sale de la carrera al vestíbulo (revancha) o al abandonar. */
  exitOnlineRaceScene() {
    this.onlineMode = false;
    this.onlineFinalShown = false;
    this.onlineResultShown = false;
    this.removeOnlineKarts();
    for (const kart of this.aiKarts ?? []) kart.group.visible = true;
    this.karts.length = 0;
    this.karts.push(this.playerKart, ...(this.aiKarts ?? []));
    if (this.itemSystem) {
      this.itemSystem.onBoxClaim = null;
      this.itemSystem.setOnlineMode(false);
    }
    this.restoreLocalKart();
    this.restoreLocalTrack();
    this.state = 'menu';
    this.raceTime = 0;
    this.input.clear();
    this.audio.stopAll();
    this.effects?.clear();
    this.cameraShake = 0;
    this.overtakes?.reset([], this.playerKart);
    this.ui.hideResults();
    this.ui.hideOnlineRace();
    this.ui.hideCountdown();
    this.ui.showHud(false);
    this.ui.showPause(false);
    this.resetRace();
    this.menuTime = 0;
    this.menuCameraReady = false;
    this.updateMenuCamera(0);
  }

  requestOnlineRematch() {
    if (!this.onlineRoom) return;
    if (this.onlineRoom.hostId !== this.onlineSelfId) {
      this.ui.showOnlineToast('Esperando a que el anfitrión pida la revancha…');
      return;
    }
    this.online.requestRematch().then((result) => {
      if (!result.ok) this.ui.showOnlineToast(onlineErrorMessage(result.error), 'error');
    });
  }

  useOnlineItem() {
    const itemId = this.playerKart?.item;
    if (!itemId || this.playerKart.itemUseCooldown > 0) return;
    this.online?.useItem(itemId).then((result) => {
      if (!result.ok) this.ui.showOnlineToast(onlineErrorMessage(result.error), 'error');
    });
  }

  handleOnlineItemAward(payload) {
    const kart = this.onlineKartById(payload.playerId);
    if (!kart) return;
    this.itemSystem.awardServerItem(kart, payload.itemId, payload.boxIndex);
  }

  handleOnlineItemBox(payload) {
    this.itemSystem.setServerBox(payload.index, payload.active, payload.itemId);
  }

  handleOnlineItemUse(payload) {
    const kart = this.onlineKartById(payload.playerId);
    if (!kart) return;
    this.itemSystem.applyServerItemUse(kart, payload.itemId, payload.targets ?? []);
  }

  handleOnlineItemDenied(payload) {
    const reason = payload?.reason;
    if (reason === 'inactive' || reason === 'distance' || reason === 'cooldown') return;
    this.ui.showOnlineToast(onlineErrorMessage(reason), 'error');
  }

  onlineKartById(id) {
    if (!id) return null;
    if (id === this.onlineSelfId) return this.playerKart;
    return this.onlineRemotes.get(id)?.kart ?? null;
  }

  handleOnlineStandings(payload) {
    if (!Array.isArray(payload?.standings)) return;
    this.onlineStandings = payload.standings;
    this.ui.updateOnlineRace({
      code: this.onlineRoom?.code ?? this.online?.room?.code,
      standings: this.onlineStandings,
      selfId: this.onlineSelfId,
    });
  }

  applyRemoteSnapshot(message) {
    if (!message || message.id === this.onlineSelfId) return;
    let remote = this.onlineRemotes.get(message.id);
    if (!remote) {
      const player = this.onlineRoom?.players?.find((entry) => entry.id === message.id);
      if (!player) return;
      const kart = this.createRemoteKart(player);
      if (!kart) return;
      remote = this.onlineRemotes.get(message.id);
    }
    remote.target = message;
    remote.lastAt = performance.now();
  }

  updateOnlineRemotes(dt) {
    for (const { kart, target } of this.onlineRemotes.values()) {
      if (!target) continue;
      const dx = target.x - kart.position.x;
      const dz = target.z - kart.position.z;
      const jump = Math.hypot(dx, dz);
      const factor = 1 - Math.exp(-dt * 14);
      if (jump > 30) {
        kart.position.x = target.x;
        kart.position.z = target.z;
        kart.groundY = target.gy ?? kart.groundY;
        kart.height = target.h ?? kart.height;
        kart.heading = target.hd ?? kart.heading;
      } else {
        kart.position.x += dx * factor;
        kart.position.z += dz * factor;
        kart.groundY += ((target.gy ?? 0) - kart.groundY) * factor;
        kart.height += ((target.h ?? 0) - kart.height) * factor;
        kart.heading = lerpAngle(kart.heading, target.hd ?? kart.heading, factor);
      }
      kart.speed = target.sp ?? kart.speed;
      kart.route = target.route ?? kart.route;
      kart.driftActive = target.d === true;
      kart.onGrass = target.og === true;
      kart.airborne = (target.h ?? 0) > 0.15;
      kart.finished = target.finished === true;
      kart.lap = target.lap ?? kart.lap;
      kart.progress = Number.isFinite(target.progress) ? target.progress : kart.progress;
      if (target.t === true && !kart.turboActive) {
        kart.turboActive = true;
        kart.turboTime = 0.6;
        kart.turboDuration = 0.6;
        kart.turboLevel = 1;
      } else if (target.t !== true && kart.turboActive) {
        kart.turboActive = false;
        kart.turboTime = 0;
      }
      kart.group.position.set(
        kart.position.x,
        kart.groundY + 0.02 + kart.height,
        kart.position.z,
      );
      kart.group.rotation.y = kart.heading;
      kart.updateVisual(dt, target.st ?? 0, kart.speed);
    }
  }

  onlineSnapshot() {
    const kart = this.playerKart;
    if (!kart) return null;
    return {
      x: kart.position.x,
      z: kart.position.z,
      gy: kart.groundY ?? 0,
      h: kart.height ?? 0,
      hd: kart.heading,
      sp: kart.speed,
      st: kart.steerVisual ?? 0,
      d: kart.driftActive === true,
      t: kart.turboActive === true,
      ab: kart.airborne === true,
      og: kart.onGrass === true,
      route: kart.route ?? null,
    };
  }

  updateOnlineCountdown(dt) {
    const remaining = (this.onlineRaceStartAt - (this.online?.serverNow() ?? Date.now())) / 1000;
    if (remaining <= 0) {
      this.state = 'racing';
      this.raceTime = 0;
      this.goTimer = 0.9;
      this.ui.showCountdown(0);
      this.audio.beep(880, 0.3, 0.12);
      this.timer.reset();
      return;
    }
    const step = COUNTDOWN_MS / 3000;
    const value = Math.max(1, Math.min(3, Math.ceil(remaining / step)));
    if (value !== this.onlineCountdownValue) {
      this.onlineCountdownValue = value;
      this.ui.showCountdown(value);
      this.audio.beep(466, 0.13, 0.1);
    }
  }

  updateOnlineRace(dt) {
    this.raceTime = Math.max(0, ((this.online?.serverNow() ?? Date.now()) - this.onlineRaceStartAt) / 1000);
    if (this.track) this.track.updateFeatures(dt, this.raceTime);

    if (this.goTimer > 0) {
      this.goTimer -= dt;
      if (this.goTimer <= 0) this.ui.hideCountdown();
    }

    const player = this.playerKart;
    const controls = player.finished
      ? { throttle: 0, brake: 1, steer: 0 }
      : this.input.controls;
    player.step(dt, controls, this.track, this.raceTime);
    if (player.turboJustActivated) {
      this.audio.turbo(player.turboLevel);
      this.addShake(player.turboLevel >= 2 ? 0.3 : 0.2);
      this.effects?.emitTurbo(player, 0.9, player.turboLevel, dt);
    }
    if (player.turboJustEnded) this.audio.stopTurbo();

    this.updateOnlineRemotes(dt);
    this.applyTrackFeatures(dt);
    this.updateDrivingFeedback(dt);
    this.itemSystem.update(dt, this.karts);
    this.refreshHud();
    this.ui.updateMinimap(this.track, this.karts, player);
    this.audio.setEngine(Math.abs(player.speed) / player.maxSpeed, player.onGrass);
    this.audio.setSkid(driftIntensity(player), player.onGrass);
    this.audio.setTurbo(turboIntensity(player), player.turboLevel || 1);

    if (player.finished && !this.onlineResultShown) {
      this.onlineResultShown = true;
      this.input.clear();
      this.ui.showOnlineToast('Has cruzado la meta. Esperando los resultados…', 'ok');
    }

    this.online?.update(dt, () => this.onlineSnapshot());
  }

  finishOnlineRace(final) {
    // También se acepta al reconectar después de que la carrera haya
    // terminado: el servidor reenvía el resultado y el jugador no debe
    // quedarse atrapado en el vestíbulo.
    if (!Array.isArray(final?.results)) return;
    if (!this.onlineMode && !this.onlineRoom) return;
    if (this.onlineFinalShown) return;
    this.onlineMode = true;
    this.onlineFinalShown = true;
    this.onlineResultShown = true;
    this.onlineStandings = final.results;
    this.state = 'finished';

    this.input.clear();
    this.audio.stopAll();
    this.effects?.clear();
    this.cameraShake = 0;
    this.ui.hideCountdown();
    this.ui.updateOnlineRace({
      code: this.onlineRoom?.code ?? this.online?.room?.code,
      standings: final.results,
      selfId: this.onlineSelfId,
    });

    const self = final.results.find((row) => row.id === this.onlineSelfId);
    const position = self?.position ?? final.results.length;
    const rows = final.results.map((row) => {
      const spec = getKart(row.kartId);
      return {
        position: row.position,
        name: row.name,
        cssColor: `#${(spec?.color ?? 0x7fb0d8).toString(16).padStart(6, '0')}`,
        isPlayer: row.id === this.onlineSelfId,
        finished: row.finished,
        time: row.finishTime,
      };
    });

    const note =
      position === 1
        ? 'Has ganado la carrera online. No se han otorgado monedas: el modo online no modifica tu progreso local.'
        : 'Resultados compartidos por el servidor. El modo online no otorga monedas ni cambia tu progreso local.';

    if (position === 1) this.audio.finishJingle();
    else this.audio.defeatJingle();

    this.ui.showResults({
      position,
      total: final.results.length,
      rows,
      note,
      online: true,
    });
    this.ui.hideOnlineRace();
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
    if (this.effects) this.effects.clear();
    if (this.bumpCooldowns) this.bumpCooldowns.clear();
    if (this.wallContacts) this.wallContacts.clear();
    this.cameraShake = 0;
    this.updateStandings();
    this.overtakes?.reset(this.standings, this.playerKart);
  }

  startRace({ snapCamera = false } = {}) {
    if (this.onlineMode) return;
    // Se limpia antes de recolocar los karts: así un derrape mantenido durante
    // la cuenta atrás no queda bloqueado por el cancelDrift del reinicio.
    this.input.clear();
    if (this.shop?.isOpen) this.closeShop();
    // Red de seguridad: nunca se corre con contenido que no esté desbloqueado.
    this.ensureOwnedLoadout();
    // La comprobación final usa la pista y el modelo reales, no solo los ids.
    if (!ownsLoadout(this.progress, this.kartSpec?.id, this.map?.id)) {
      this.state = 'menu';
      this.ui.showMenu();
      this.ui.notice(
        'No se pudo iniciar la carrera: la selección incluye contenido bloqueado.',
        'error',
      );
      return;
    }
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
    if (this.onlineMode) {
      this.updateOnlineRace(dt);
      return;
    }
    this.raceTime += dt;
    if (this.track) this.track.updateFeatures(dt, this.raceTime);

    if (this.goTimer > 0) {
      this.goTimer -= dt;
      if (this.goTimer <= 0) this.ui.hideCountdown();
    }

    const player = this.playerKart;
    player.step(dt, this.input.controls, this.track, this.raceTime);
    if (player.turboJustActivated) {
      this.audio.turbo(player.turboLevel);
      this.addShake(player.turboLevel >= 2 ? 0.3 : 0.2);
      this.effects?.emitTurbo(player, 0.9, player.turboLevel, dt);
    }
    if (player.turboJustEnded) this.audio.stopTurbo();

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
    this.updateDrivingFeedback(dt);
    this.itemSystem.update(dt, this.karts);
    this.updateStandings();
    const overtake = this.overtakes?.update(this.standings, player, dt);
    if (overtake) {
      this.ui.showOvertake(overtake.position);
      this.audio.overtake();
    }
    this.refreshHud();
    this.ui.updateMinimap(this.track, this.karts, player);
    this.audio.setEngine(Math.abs(player.speed) / player.maxSpeed, player.onGrass);
    this.audio.setSkid(driftIntensity(player), player.onGrass);
    this.audio.setTurbo(turboIntensity(player), player.turboLevel || 1);

    if (player.finished) this.finishRace();
  }

  /** Sacudida de cámara acumulativa y acotada (solo visual). */
  addShake(amount) {
    this.cameraShake = clamp(this.cameraShake + amount, 0, 1);
  }

  /**
   * Efectos y sonidos continuos de conducción. Se leen del estado real del
   * kart, así que al terminar derrape/turbo se apagan solos.
   */
  updateDrivingFeedback(dt) {
    if (!this.effects) return;
    for (const kart of this.karts) {
      if (this.onlineMode && !kart.isPlayer) continue;
      const drift = driftIntensity(kart);
      if (drift > 0) this.effects.emitDrift(kart, drift, dt);
      const turbo = turboIntensity(kart);
      if (turbo > 0) {
        this.effects.emitTurbo(kart, 0.45 + turbo * 0.55, kart.turboLevel, dt);
      }
    }

    const player = this.playerKart;
    const wasTouching = this.wallContacts.get(player) ?? false;
    if (player.wallContact && !wasTouching && Math.abs(player.speed) > 4) {
      const strength = clamp(Math.abs(player.speed) / player.maxSpeed, 0.3, 1);
      this.audio.wall(strength);
      this.effects.emitImpact(player, strength, true);
      this.addShake(strength * 0.35);
    }
    this.wallContacts.set(player, player.wallContact);
  }

  /**
   * Mecánicas de mapa: placas de turbo, rampas con salto y obstáculos móviles.
   * Se aplican después de mover los karts para usar su proyección más reciente.
   */
  applyTrackFeatures(dt) {
    const features = this.track?.features;
    if (!features) return;

    for (const kart of this.karts) {
      if (this.onlineMode && !kart.isPlayer) continue;
      this.applyBoostPads(kart, features.boostPads);
      this.applyRamps(kart, features.ramps);
      this.applyObstacles(kart, features.obstacles);
      kart.group.position.set(
        kart.position.x,
        (kart.groundY ?? 0) + 0.02 + kart.height,
        kart.position.z,
      );

      if (kart.isPlayer && kart.justLanded) {
        this.audio.beep(180, 0.09, 0.055, 'triangle');
        this.effects?.emitLanding(kart);
        this.addShake(0.16);
        kart.justLanded = false;
      }
    }
  }

  applyBoostPads(kart, pads) {
    if (!pads || pads.length === 0 || kart.finished) return;
    for (const pad of pads) {
      if (!this.track.boostPadContact(kart, pad, this.raceTime)) continue;

      kart.featureCooldowns.set(pad.id, this.raceTime + 1.1);
      kart.applyItemBoost(pad.def.power ?? 0.26, pad.def.duration ?? 0.5);
      if (kart.isPlayer) {
        this.ui.flashBoost?.();
        this.audio.turbo(1);
        this.effects?.emitTurbo(kart, 0.9, 1);
        this.addShake(0.12);
      }
    }
  }

  applyRamps(kart, ramps) {
    if (!ramps || ramps.length === 0 || kart.finished) return;
    const { launched } = this.track.applyRamp(kart);
    if (launched && kart.isPlayer) {
      this.ui.flashLaunch();
      this.audio.turbo(1);
      this.addShake(0.14);
    }
  }

  applyObstacles(kart, obstacles) {
    if (!obstacles || obstacles.length === 0 || kart.finished) return;
    for (const obstacle of obstacles) {
      const contact = this.track.obstacleContact(kart, obstacle, this.raceTime);
      if (!contact) continue;
      const { side } = contact;

      kart.featureCooldowns.set(obstacle.id, this.raceTime + 1.25);
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

      const projection = this.track.project(kart.position, kart.route ?? null, kart.trackS);
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
        this.effects?.emitImpact(kart, obstacle.kind === 'boulder' ? 1 : 0.6, blocked);
        this.addShake(obstacle.kind === 'boulder' ? 0.42 : 0.24);
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

          // Feedback de roce: breve, con cooldown por pareja para no saturar.
          if (a === this.playerKart || b === this.playerKart) {
            const key = `${i}-${j}`;
            const last = this.bumpCooldowns.get(key) ?? -Infinity;
            if (this.raceTime - last >= 0.5) {
              this.bumpCooldowns.set(key, this.raceTime);
              const strength = clamp(
                Math.abs(a.speed - b.speed) / 14 + overlap / 1.4,
                0.25,
                1,
              );
              const other = a === this.playerKart ? b : a;
              this.audio.bump(strength);
              this.ui.flashImpact(false, strength > 0.7);
              this.effects?.emitImpact(
                other,
                strength,
                false,
                (a.position.x + b.position.x) / 2,
                (a.position.z + b.position.z) / 2,
              );
              this.addShake(strength * 0.4);
            }
          }
        }
      }
    }

    // Tras los empujones, que nadie quede fuera de los muros.
    for (const kart of this.karts) {
      const projection = this.track.project(kart.position, kart.route ?? null, kart.trackS);
      const wallOffset = projection.wallOffset ?? this.track.wallOffset;
      const limit = wallOffset - CONFIG.kart.wallLimitExtra;
      if (Math.abs(projection.lateral) > limit) {
        const side = Math.sign(projection.lateral);
        kart.position.x = projection.centerX + projection.sx * limit * side;
        kart.position.z = projection.centerZ + projection.sz * limit * side;
      }
      kart.group.position.set(
        kart.position.x,
        (kart.groundY ?? 0) + 0.02 + (kart.height ?? 0),
        kart.position.z,
      );
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
    const selfRow = this.onlineMode
      ? this.onlineStandings.find((row) => row.id === this.onlineSelfId)
      : null;
    this.ui.updateHud({
      lap: selfRow ? Math.min(selfRow.lap ?? player.lap, CONFIG.laps) : Math.min(player.lap, CONFIG.laps),
      laps: CONFIG.laps,
      position: selfRow?.position ?? this.getPlayerPosition(),
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
      turboCooldown: player.turboCooldown,
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
    if (this.onlineMode) return;
    if (this.state !== 'racing') return;
    this.state = 'finished';
    this.playerKart.finished = true;
    this.ui.hideCountdown();
    this.audio.stopAll();
    this.effects?.clear();
    this.cameraShake = 0;
    this.input.clear();
    for (const kart of this.karts) kart.clearTransientState();
    this.itemSystem.clearEffects();
    this.updateStandings();

    const position = this.getPlayerPosition();
    if (position === 1) this.audio.finishJingle();
    else this.audio.defeatJingle();

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
      saved: saveOk,
    });
    this.ui.updateMinimap(this.track, this.karts, this.playerKart);
  }

  pause() {
    if (this.onlineMode) return;
    if (this.state !== 'racing') return;
    this.state = 'paused';
    this.ui.showPause(true);
    this.audio.stopAll();
    this.effects?.clear();
    this.cameraShake = 0;
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
    this.audio.stopAll();
    this.effects?.clear();
    this.cameraShake = 0;
    this.wallContacts.clear();
    this.bumpCooldowns.clear();
    this.overtakes?.reset([], this.playerKart);
    this.input.clear();
    if (this.shop?.isOpen) this.shop.close();
    this.ui.notice('');
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
    const ground = kart.groundY ?? 0;

    const distance = CONFIG.camera.distance + speedRatio * 1.1;
    const height =
      ground + CONFIG.camera.height + speedRatio * 0.35 + (kart.height ?? 0) * 0.7;
    const desiredX = kart.position.x - forwardX * distance;
    const desiredZ = kart.position.z - forwardZ * distance;
    // Anticipación lateral suave: la mirada se abre un poco hacia el giro.
    const anticipation = (kart.steerVisual ?? 0) * 1.4;
    const desiredLookX =
      kart.position.x + forwardX * CONFIG.camera.lookAhead + Math.cos(kart.heading) * anticipation;
    const desiredLookZ =
      kart.position.z + forwardZ * CONFIG.camera.lookAhead - Math.sin(kart.heading) * anticipation;
    const desiredLookY = ground + CONFIG.camera.lookHeight + (kart.height ?? 0) * 0.85;

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

    // La cámara nunca baja por debajo del asfalto (rampas, desniveles, saltos).
    const cameraProjection = this.track?.project
      ? this.track.project({ x: this.camPos.x, z: this.camPos.z }, kart.route ?? null, kart.trackS)
      : null;
    const cameraGround = cameraProjection?.height ?? 0;
    if (this.camPos.y < cameraGround + 1.3) this.camPos.y = cameraGround + 1.3;

    // Sacudida breve de impactos/turbo, aplicada solo a la cámara renderizada:
    // camPos sigue siendo la referencia suave y se restaura sola.
    this.shakeTime += dt * 26;
    if (this.cameraShake > 0.002) {
      this.cameraShake = Math.max(0, this.cameraShake * Math.exp(-CONFIG.camera.shakeDecay * dt));
      const amplitude = this.cameraShake * 0.22;
      const offsetX = Math.sin(this.shakeTime * 1.7) * amplitude;
      const offsetY = Math.cos(this.shakeTime * 2.3) * amplitude * 0.7;
      this.camRender.set(
        this.camPos.x + offsetX,
        Math.max(1.1, this.camPos.y + offsetY),
        this.camPos.z + offsetX * 0.45,
      );
    } else {
      this.cameraShake = 0;
      this.camRender.copy(this.camPos);
    }
    this.camera.position.copy(this.camRender);
    this.camera.lookAt(this.camLook);

    const turboRatio = turboIntensity(kart);
    const targetFov = this.baseFov + speedRatio * 7 + turboRatio * CONFIG.camera.turboFov;
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
        if (this.onlineMode) this.updateOnlineCountdown(dt);
        else this.updateCountdown(dt);
        for (const kart of this.karts) kart.updateVisual(dt, 0, 0);
        this.updateCamera(dt);
        this.effects?.update(dt);
        break;
      case 'racing':
        this.updateRace(dt);
        this.updateCamera(dt);
        this.effects?.update(dt);
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
    if (this.online) {
      this.online.dispose();
      this.online = null;
    }
    if (this.preview) this.preview.dispose();
    if (this.shop) this.shop.dispose();

    if (this.itemSystem) this.itemSystem.dispose();
    if (this.effects) this.effects.dispose();
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
