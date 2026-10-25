// Núcleo del juego: escena 3D, estados de carrera, cámara, rivales y HUD.
import * as THREE from 'three';
import { computeAIControls } from './AIController.js';
import { AudioManager } from './Audio.js';
import { CONFIG } from './config.js';
import { DIFFICULTIES, isDifficulty, loadDifficulty, saveDifficulty } from './difficulty.js';
import { Input } from './Input.js';
import { ItemSystem } from './ItemSystem.js';
import { ITEMS } from './items.js';
import { AI_KARTS, PLAYER_KARTS, getKart, loadKartId, saveKartId } from './karts.js';
import { Kart } from './Kart.js';
import { KartPreview } from './KartPreview.js';
import { getMap, loadMapId, saveMapId } from './maps.js';
import { Track } from './Track.js';
import { UI } from './UI.js';
import { clamp, formatTime } from './utils.js';

export class Game {
  constructor(container) {
    this.container = container;
    this.difficultyId = loadDifficulty();
    this.difficulty = DIFFICULTIES[this.difficultyId];
    this.mapId = loadMapId();
    this.map = getMap(this.mapId);
    this.kartId = loadKartId();
    this.kartSpec = getKart(this.kartId);
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

    this.animate = this.animate.bind(this);
    this.rafId = requestAnimationFrame(this.animate);
  }

  // ---------------------------------------------------------------------------
  // Inicialización
  // ---------------------------------------------------------------------------

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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

    this.camera = new THREE.PerspectiveCamera(
      CONFIG.camera.fov,
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
    this.sun.shadow.mapSize.set(2048, 2048);
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
    this.itemSystem.onProjectileFired = (kart) => {
      // El disparo del jugador ya suena en onUse; la IA solo se oye si está cerca.
      if (kart === this.playerKart) return;
      const dx = kart.position.x - this.playerKart.position.x;
      const dz = kart.position.z - this.playerKart.position.z;
      if (dx * dx + dz * dz < 32 * 32) this.audio.projectile(0.55);
    };
    this.itemSystem.onProjectileHit = (victim, shooter, blocked) => {
      if (victim === this.playerKart) {
        this.ui.flashImpact(blocked);
        this.audio.impact(blocked);
      } else if (shooter === this.playerKart) {
        this.audio.impact(false);
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

    this.handleResize = () => this.resize();
    listen(window, 'resize', this.handleResize);

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
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
    if (this.state !== 'menu') return;
    const map = getMap(id);
    if (!map || map.id === this.mapId) return;
    this.mapId = map.id;
    this.map = map;
    saveMapId(map.id);

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
    if (this.state !== 'menu') return;
    const spec = getKart(id);
    if (!spec || spec.id === this.kartId) return;
    this.kartId = spec.id;
    this.kartSpec = spec;
    saveKartId(spec.id);

    this.rebuildPlayerKart();
    this.ui.setKart(this.kartId, this.kartSpec);
    if (this.preview) this.preview.setKart(this.kartSpec);
    this.resetRace();
    this.ui.updateMinimap(this.track, this.karts, this.playerKart);
  }

  /** Navegación circular con las flechas del selector de kart. */
  cycleKart(direction) {
    if (this.state !== 'menu') return;
    const index = PLAYER_KARTS.findIndex((kart) => kart.id === this.kartId);
    const next = (index + direction + PLAYER_KARTS.length) % PLAYER_KARTS.length;
    this.setKart(PLAYER_KARTS[next].id);
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
    this.resetRace();
    this.itemSystem.setDifficulty(this.difficulty);
    for (const kart of this.karts) {
      if (!kart.isPlayer) kart.applyDifficulty(this.difficulty);
    }
    this.state = 'countdown';
    this.countdownRemaining = CONFIG.countdownStep * 3;
    this.countdownValue = 3;
    this.snapCamera = snapCamera;
    this.input.clear();
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

    this.resolveCollisions();
    this.itemSystem.update(dt, this.karts);
    this.updateStandings();
    this.refreshHud();
    this.ui.updateMinimap(this.track, this.karts, player);
    this.audio.setEngine(Math.abs(player.speed) / player.maxSpeed, player.onGrass);

    if (player.finished) this.finishRace();
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
      kart.group.position.set(kart.position.x, 0.02, kart.position.z);
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
  }

  finishRace() {
    if (this.state !== 'racing') return;
    this.state = 'finished';
    this.playerKart.finished = true;
    this.audio.stopEngine();
    this.audio.finishJingle();
    this.input.clear();
    for (const kart of this.karts) kart.clearTransientState();
    this.itemSystem.clearEffects();
    this.updateStandings();

    const position = this.getPlayerPosition();
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
    const note =
      `Has completado las ${CONFIG.laps} vueltas en ${formatTime(totalTime)}.` +
      (bestLap ? ` Tu mejor vuelta fue ${formatTime(bestLap)}.` : '') +
      (position === 1 ? ' ¡Carrera perfecta!' : ' Vuelve a intentarlo para subir al podio.');

    this.ui.showResults({
      position,
      total: this.karts.length,
      rows,
      note,
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
    this.ui.showMenu();
    this.ui.showPause(false);
    this.ui.hideCountdown();
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
    const height = CONFIG.camera.height + speedRatio * 0.35;
    const desiredX = kart.position.x - forwardX * distance;
    const desiredZ = kart.position.z - forwardZ * distance;
    const desiredLookX = kart.position.x + forwardX * CONFIG.camera.lookAhead;
    const desiredLookZ = kart.position.z + forwardZ * CONFIG.camera.lookAhead;

    if (this.snapCamera) {
      this.camPos.set(desiredX, height, desiredZ);
      this.camLook.set(desiredLookX, CONFIG.camera.lookHeight, desiredLookZ);
      this.snapCamera = false;
    } else {
      const positionFactor = 1 - Math.exp(-dt * 5.6);
      const lookFactor = 1 - Math.exp(-dt * 7.5);
      this.camPos.x += (desiredX - this.camPos.x) * positionFactor;
      this.camPos.y += (height - this.camPos.y) * positionFactor;
      this.camPos.z += (desiredZ - this.camPos.z) * positionFactor;
      this.camLook.x += (desiredLookX - this.camLook.x) * lookFactor;
      this.camLook.y += (CONFIG.camera.lookHeight - this.camLook.y) * lookFactor;
      this.camLook.z += (desiredLookZ - this.camLook.z) * lookFactor;
    }

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    const targetFov = CONFIG.camera.fov + speedRatio * 7;
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
        if (this.preview) {
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
