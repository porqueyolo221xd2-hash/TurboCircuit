// Kart original construido con geometrías simples y física arcade.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, lerpAngle } from './utils.js';

const KART = CONFIG.kart;
const DRIFT = CONFIG.drift;

// Proporciones de carrocería por estilo. Comparten materiales, ruedas y pilotos,
// pero cambian silueta, anchura y distancia entre ejes.
const STYLE_SHAPES = {
  standard: {
    chassisW: 1.7,
    chassisH: 0.42,
    chassisL: 2.45,
    chassisY: 0.66,
    noseW: 1.25,
    podW: 0.34,
    podX: 0.76,
    wingW: 1.85,
    wingHeight: 0.5,
    wingX: 0.55,
    wheelTrack: 0.9,
    wheelBase: 0.98,
  },
  speedster: {
    chassisW: 1.56,
    chassisH: 0.36,
    chassisL: 2.75,
    chassisY: 0.6,
    noseW: 1.02,
    podW: 0.28,
    podX: 0.72,
    wingW: 2,
    wingHeight: 0.38,
    wingX: 0.62,
    wheelTrack: 0.88,
    wheelBase: 1.08,
  },
  agile: {
    chassisW: 1.62,
    chassisH: 0.44,
    chassisL: 2.22,
    chassisY: 0.64,
    noseW: 1.12,
    podW: 0.3,
    podX: 0.74,
    wingW: 1.7,
    wingHeight: 0.46,
    wingX: 0.5,
    wheelTrack: 0.86,
    wheelBase: 0.9,
  },
  heavy: {
    chassisW: 1.98,
    chassisH: 0.5,
    chassisL: 2.5,
    chassisY: 0.7,
    noseW: 1.42,
    podW: 0.42,
    podX: 0.86,
    wingW: 2.08,
    wingHeight: 0.62,
    wingX: 0.62,
    wheelTrack: 0.98,
    wheelBase: 0.96,
  },
};

export class Kart {
  constructor({
    id = null,
    name,
    color,
    accent,
    maxSpeed,
    acceleration,
    brakePower,
    turnRate,
    reverseMax,
    mass = 1,
    bodyStyle = 'standard',
    isPlayer = false,
    aiProfile = null,
  }) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.accent = accent;
    this.isPlayer = isPlayer;
    this.maxSpeed = maxSpeed;
    this.mass = mass;
    this.bodyStyle = bodyStyle;
    this.acceleration = acceleration ?? KART.acceleration;
    this.brakePower = brakePower ?? KART.brakePower;
    this.turnRate = turnRate ?? KART.turnRate;
    this.reverseMax = reverseMax ?? KART.reverseMax;
    // Valores base para aplicar la dificultad sin acumular multiplicadores.
    this.baseAcceleration = this.acceleration;
    this.baseBrakePower = this.brakePower;
    this.baseTurnRate = this.turnRate;
    this.paceFactor = 1;
    this.driftChargeRate = 1;
    this.aiTurboThreshold = DRIFT.chargeLevel1;
    this.aiProfile = aiProfile;

    this.position = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.steerVisual = 0;
    this.spinAngle = 0;
    this.bobTime = 0;
    this.roll = 0;
    this.pitch = 0;
    this.onGrass = false;
    this.wallContact = false;

    this.trackS = 0;
    this.lateral = 0;
    this.lastTrackS = 0;
    this.progress = 0;

    this.lap = 1;
    this.lapStartTime = null;
    this.lastLapTime = null;
    this.bestLapTime = null;
    this.finished = false;
    this.finishTime = null;
    this.speedBias = 1;
    this.stuckTime = 0;

    // Estado de la IA. Se reinicia en cada carrera, nunca se teletransporta.
    this.aiLane = aiProfile?.lane ?? 0;
    this.aiLaneBase = this.aiLane;
    this.aiLaneCurrent = this.aiLane;
    this.aiOvertakeSide = 0;
    this.aiOvertakeTimer = 0;
    this.aiOvertakeLane = this.aiLane;
    this.aiOvertakeCooldown = 0;
    this.aiRecoveryTime = 0;
    this.aiMistakeTime = 0;
    this.aiMistakeCooldown = 3 + Math.random() * 4;
    this.aiDriftHold = 0;
    this.aiDriftCooldown = 0;
    this.aiPhase = Math.random() * Math.PI * 2;
    this.aiProjectileCooldown = 0;

    // Derrape y turbo. Solo el jugador recibe controls.drift.
    this.driftActive = false;
    this.driftLock = false;
    this.driftCharge = 0;
    this.driftSlip = 0;
    this.turboActive = false;
    this.turboTime = 0;
    this.turboDuration = 0;
    this.turboLevel = 0;
    this.turboPower = 0;
    this.turboJustActivated = false;

    // Objetos: inventario de un solo uso y efectos con temporizador propio.
    this.item = null;
    this.itemUseCooldown = 0;
    this.pickupCooldown = 0;
    this.aiItemTimer = 1 + Math.random() * 2;
    this.itemBoostTime = 0;
    this.itemBoostDuration = 0;
    this.itemBoostPower = 0;
    this.slowTime = 0;
    this.slowFactor = 1;
    this.barrierTime = 0;
    this.impactTime = 0;
    this.impactDuration = 0;
    this.impactSteer = 0;

    this.group = new THREE.Group();
    this.group.name = `kart-${name}`;
    this.model = new THREE.Group();
    this.group.add(this.model);
    this.wheels = [];
    this.materials = [];
    this.geometries = [];

    this.buildModel();
  }

  // ---------------------------------------------------------------------------
  // Modelo visual
  // ---------------------------------------------------------------------------

  buildModel() {
    const bodyMaterial = this.makeMaterial(this.color, 0.45, 0.1);
    const accentMaterial = this.makeMaterial(this.accent, 0.4, 0.05);
    const darkMaterial = this.makeMaterial(0x23262f, 0.7, 0.1);
    const tireMaterial = this.makeMaterial(0x15171c, 0.95, 0);
    const rimMaterial = this.makeMaterial(0xd9dee8, 0.35, 0.5);
    const visorMaterial = this.makeMaterial(0x111a2b, 0.2, 0.6);
    const whiteMaterial = this.makeMaterial(0xf5f3e9, 0.6, 0);
    const shape = STYLE_SHAPES[this.bodyStyle] ?? STYLE_SHAPES.standard;

    // Chasis y carrocería.
    this.addBox(shape.chassisW + 0.2, 0.2, shape.chassisL + 0.45, 0, 0.38, 0, darkMaterial);
    this.addBox(shape.chassisW, shape.chassisH, shape.chassisL, 0, shape.chassisY, -0.05, bodyMaterial);
    this.addBox(shape.noseW, 0.22, 0.95, 0, shape.chassisY + 0.12, 1.02, accentMaterial);
    this.addBox(shape.noseW * 0.76, 0.2, 0.55, 0, shape.chassisY - 0.04, 1.5, bodyMaterial);
    this.addBox(shape.chassisW + 0.12, 0.16, 0.38, 0, 0.42, 1.48, darkMaterial);

    // Pods laterales y asiento.
    for (const sign of [-1, 1]) {
      this.addBox(shape.podW, 0.3, 1.35, sign * shape.podX, shape.chassisY - 0.04, -0.15, accentMaterial);
    }
    this.addBox(0.92, 0.6, 0.64, 0, 0.92, -0.72, darkMaterial);
    this.addBox(0.96, 0.12, 0.7, 0, 1.2, -0.76, accentMaterial);

    // Alerón trasero.
    this.addBox(0.1, shape.wingHeight, 0.1, -shape.wingX, 1.11, -1.34, darkMaterial);
    this.addBox(0.1, shape.wingHeight, 0.1, shape.wingX, 1.11, -1.34, darkMaterial);
    this.addBox(shape.wingW, 0.09, 0.42, 0, 1.38, -1.38, accentMaterial);
    this.addBox(0.5, 0.22, 0.1, -shape.wingX - 0.17, 1.26, -1.38, bodyMaterial);
    this.addBox(0.5, 0.22, 0.1, shape.wingX + 0.17, 1.26, -1.38, bodyMaterial);

    // Parachoques y escapes.
    this.addBox(shape.chassisW, 0.18, 0.3, 0, 0.44, -1.5, darkMaterial);
    for (const sign of [-1, 1]) {
      this.addCylinder(0.085, 0.085, 0.32, sign * 0.42, 0.55, -1.48, darkMaterial, 'x');
    }

    // Rasgos de silueta propios de cada estilo.
    if (this.bodyStyle === 'speedster') {
      // Morro largo y aletas gemelas: silueta baja y afilada.
      this.addBox(0.74, 0.1, 0.9, 0, 0.49, 1.92, bodyMaterial);
      this.addBox(1.5, 0.08, 0.42, 0, 0.36, 1.78, darkMaterial);
      for (const sign of [-1, 1]) {
        this.addBox(0.07, 0.5, 0.72, sign * 0.66, 1.2, -1.18, accentMaterial);
      }
    } else if (this.bodyStyle === 'agile') {
      // Pods redondeados y aleta central: aspecto ligero y corto.
      for (const sign of [-1, 1]) {
        this.addCylinder(0.2, 0.2, 1.2, sign * 0.8, 0.64, -0.12, accentMaterial, 'z');
      }
      this.addBox(0.08, 0.38, 0.62, 0, 1.5, -0.92, accentMaterial);
      this.addBox(0.92, 0.08, 0.5, 0, 0.52, 1.72, darkMaterial);
    } else if (this.bodyStyle === 'heavy') {
      // Parachoques reforzado, faldones y arco de protección.
      this.addBox(shape.chassisW + 0.34, 0.15, 0.18, 0, 0.52, 1.84, darkMaterial);
      for (const sign of [-1, 1]) {
        this.addBox(0.14, 0.34, 0.18, sign * 0.66, 0.68, 1.84, darkMaterial);
        this.addBox(0.12, 0.26, 1.3, sign * 0.92, 0.4, -0.1, darkMaterial);
        this.addBox(0.1, 0.9, 0.1, sign * 0.58, 1.5, -0.68, darkMaterial);
      }
      this.addBox(1.26, 0.1, 0.1, 0, 1.95, -0.68, darkMaterial);
    }

    // Llamas del turbo: geometría barata que solo se ve durante la aceleración.
    this.turboMaterial = new THREE.MeshBasicMaterial({
      color: 0x5fe6ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(this.turboMaterial);
    this.turboFlames = [];
    for (const sign of [-1, 1]) {
      const flame = new THREE.Mesh(
        this.trackGeometry(new THREE.ConeGeometry(0.13, 0.8, 8)),
        this.turboMaterial,
      );
      flame.position.set(sign * 0.42, 0.55, -1.72);
      flame.rotation.x = -Math.PI / 2;
      flame.visible = false;
      this.model.add(flame);
      this.turboFlames.push(flame);
    }

    // Barrera: burbuja de alambre muy barata que solo se ve mientras protege.
    this.barrierMaterial = new THREE.MeshBasicMaterial({
      color: 0x77f06b,
      transparent: true,
      opacity: 0.2,
      wireframe: true,
      depthWrite: false,
    });
    this.materials.push(this.barrierMaterial);
    this.barrierMesh = new THREE.Mesh(
      this.trackGeometry(new THREE.IcosahedronGeometry(1.95, 1)),
      this.barrierMaterial,
    );
    this.barrierMesh.position.y = 0.95;
    this.barrierMesh.visible = false;
    this.model.add(this.barrierMesh);

    // Piloto.
    this.addBox(0.55, 0.48, 0.34, 0, 1.03, -0.62, whiteMaterial);
    const torso = new THREE.Mesh(
      this.trackGeometry(new THREE.CapsuleGeometry(0.26, 0.34, 4, 10)),
      accentMaterial,
    );
    torso.position.set(0, 1.22, -0.52);
    torso.castShadow = true;
    this.model.add(torso);

    for (const sign of [-1, 1]) {
      const arm = new THREE.Mesh(
        this.trackGeometry(new THREE.CapsuleGeometry(0.075, 0.38, 3, 8)),
        whiteMaterial,
      );
      arm.position.set(sign * 0.3, 1.14, -0.2);
      arm.rotation.x = 1.05;
      arm.rotation.z = sign * 0.25;
      arm.castShadow = true;
      this.model.add(arm);
    }

    const wheel = new THREE.Mesh(
      this.trackGeometry(new THREE.TorusGeometry(0.18, 0.035, 6, 16)),
      darkMaterial,
    );
    wheel.position.set(0, 1.08, -0.08);
    wheel.rotation.x = -1.1;
    this.model.add(wheel);

    const head = new THREE.Mesh(
      this.trackGeometry(new THREE.SphereGeometry(0.31, 16, 12)),
      bodyMaterial,
    );
    head.position.set(0, 1.7, -0.5);
    head.scale.set(1, 0.95, 1.02);
    head.castShadow = true;
    this.model.add(head);

    const visor = new THREE.Mesh(
      this.trackGeometry(new THREE.BoxGeometry(0.4, 0.16, 0.22)),
      visorMaterial,
    );
    visor.position.set(0, 1.73, -0.22);
    visor.rotation.x = -0.15;
    this.model.add(visor);

    const helmetStripe = new THREE.Mesh(
      this.trackGeometry(new THREE.BoxGeometry(0.09, 0.1, 0.52)),
      whiteMaterial,
    );
    helmetStripe.position.set(0, 1.94, -0.52);
    this.model.add(helmetStripe);

    // Ruedas: dos grupos anidados para girar y virar por separado.
    const wheelPositions = [
      { x: -shape.wheelTrack, z: shape.wheelBase, front: true },
      { x: shape.wheelTrack, z: shape.wheelBase, front: true },
      { x: -shape.wheelTrack, z: -shape.wheelBase, front: false },
      { x: shape.wheelTrack, z: -shape.wheelBase, front: false },
    ];

    for (const spec of wheelPositions) {
      const steerGroup = new THREE.Group();
      steerGroup.position.set(spec.x, 0.37, spec.z);
      const spinGroup = new THREE.Group();
      steerGroup.add(spinGroup);

      const tire = new THREE.Mesh(
        this.trackGeometry(new THREE.CylinderGeometry(0.37, 0.37, 0.34, 16)),
        tireMaterial,
      );
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      spinGroup.add(tire);

      const rim = new THREE.Mesh(
        this.trackGeometry(new THREE.CylinderGeometry(0.2, 0.2, 0.355, 10)),
        rimMaterial,
      );
      rim.rotation.z = Math.PI / 2;
      spinGroup.add(rim);

      this.model.add(steerGroup);
      this.wheels.push({ steer: steerGroup, spin: spinGroup, front: spec.front });
    }

    // Pequeña sombra de contacto adicional (barata y siempre bajo el kart).
    const shadow = new THREE.Mesh(
      this.trackGeometry(new THREE.CircleGeometry(1.05, 20)),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.008;
    shadow.scale.set(shape.chassisW / 1.7, (shape.chassisL / 2.45) * 1.55, 1);
    // Va colgada del grupo (no del modelo) para que no se incline con la carrocería.
    this.group.add(shadow);
  }

  makeMaterial(color, roughness = 0.6, metalness = 0) {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.materials.push(material);
    return material;
  }

  trackGeometry(geometry) {
    this.geometries.push(geometry);
    return geometry;
  }

  addBox(w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(this.trackGeometry(new THREE.BoxGeometry(w, h, d)), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.model.add(mesh);
    return mesh;
  }

  addCylinder(radiusTop, radiusBottom, height, x, y, z, material, axis = 'y') {
    const mesh = new THREE.Mesh(
      this.trackGeometry(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 12)),
      material,
    );
    mesh.position.set(x, y, z);
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true;
    this.model.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------------------
  // Estado de carrera
  // ---------------------------------------------------------------------------

  reset({ s, back, lateral, track }) {
    const position = track.posAt(s, lateral);
    this.position.copy(position);
    this.heading = track.headingAt(s);
    this.speed = 0;
    this.steerVisual = 0;
    this.roll = 0;
    this.pitch = 0;
    this.spinAngle = 0;
    this.trackS = s % track.length;
    this.lastTrackS = this.trackS;
    this.progress = -back;
    this.lateral = lateral;
    this.onGrass = false;
    this.wallContact = false;
    this.stuckTime = 0;
    this.paceFactor = 1;

    this.lap = 1;
    this.lapStartTime = null;
    this.lastLapTime = null;
    this.bestLapTime = null;
    this.finished = false;
    this.finishTime = null;
    this.speedBias = 1;

    this.aiLane = this.aiLaneBase;
    this.aiLaneCurrent = this.aiLaneBase;
    this.aiOvertakeSide = 0;
    this.aiOvertakeTimer = 0;
    this.aiOvertakeLane = this.aiLane;
    this.aiOvertakeCooldown = 0;
    this.aiRecoveryTime = 0;
    this.aiMistakeTime = 0;
    this.aiMistakeCooldown = 3 + Math.random() * 4;
    this.aiDriftHold = 0;
    this.aiDriftCooldown = 0;
    this.aiPhase = Math.random() * Math.PI * 2;
    this.aiProjectileCooldown = 0;

    this.driftActive = false;
    this.driftLock = false;
    this.driftCharge = 0;
    this.driftSlip = 0;
    this.turboActive = false;
    this.turboTime = 0;
    this.turboDuration = 0;
    this.turboLevel = 0;
    this.turboPower = 0;
    this.turboJustActivated = false;

    this.item = null;
    this.itemUseCooldown = 0;
    this.pickupCooldown = 0;
    this.aiItemTimer = 1 + Math.random() * 2;
    this.itemBoostTime = 0;
    this.itemBoostDuration = 0;
    this.itemBoostPower = 0;
    this.slowTime = 0;
    this.slowFactor = 1;
    this.barrierTime = 0;
    this.impactTime = 0;
    this.impactDuration = 0;
    this.impactSteer = 0;

    this.group.position.set(position.x, 0.02, position.z);
    this.group.rotation.y = this.heading;
    this.model.rotation.set(0, 0, 0);
  }

  /**
   * Aplica los multiplicadores de la dificultad a este rival.
   * Parte siempre de los valores base para no acumular ajustes entre carreras.
   */
  applyDifficulty(difficulty) {
    if (!difficulty) return;
    this.paceFactor = difficulty.pace ?? 1;
    this.driftChargeRate = difficulty.driftCharge ?? 1;
    this.aiTurboThreshold = difficulty.driftTurbo ?? DRIFT.chargeLevel1;
    this.acceleration = this.baseAcceleration * (difficulty.acceleration ?? 1);
    this.brakePower = this.baseBrakePower * (difficulty.brake ?? 1);
    this.turnRate = this.baseTurnRate * (difficulty.turn ?? 1);
  }

  // ---------------------------------------------------------------------------
  // Derrape y turbo
  // ---------------------------------------------------------------------------

  finishDrift(allowTurbo) {
    const charge = this.driftCharge;
    this.driftActive = false;
    this.driftCharge = 0;
    if (!allowTurbo) return;
    // El jugador mantiene los umbrales originales. La IA necesita un umbral
    // algo menor porque traza con menos volante que una persona; así puede
    // encadenar derrape y turbo sin cambiar la física del jugador.
    const level1 = this.isPlayer
      ? DRIFT.chargeLevel1
      : Math.max(0.05, this.aiTurboThreshold);
    const level2 = this.isPlayer
      ? DRIFT.chargeLevel2
      : Math.min(DRIFT.chargeLevel2, level1 + 0.18);
    if (charge >= level2) this.startTurbo(2);
    else if (charge >= level1) this.startTurbo(1);
  }

  startTurbo(level) {
    const strong = level >= 2;
    this.turboLevel = strong ? 2 : 1;
    this.turboDuration = strong ? DRIFT.strongDuration : DRIFT.shortDuration;
    this.turboTime = this.turboDuration;
    this.turboPower = strong ? DRIFT.strongPower : DRIFT.shortPower;
    this.turboActive = true;
    this.turboJustActivated = true;
    // Pequeño empujón inicial; el límite real se aplica en step().
    this.speed += strong ? 1.8 : 1.1;
    if (this.turboMaterial) {
      this.turboMaterial.color.setHex(strong ? 0xffb02e : 0x5fe6ff);
    }
  }

  endTurbo() {
    this.turboActive = false;
    this.turboTime = 0;
    this.turboDuration = 0;
    this.turboLevel = 0;
    this.turboPower = 0;
  }

  /** Cancela el derrape sin regalar turbo (pausa, cambio de pestaña, reinicio). */
  cancelDrift() {
    this.driftActive = false;
    this.driftCharge = 0;
    this.driftSlip = 0;
    this.driftLock = true;
  }

  // ---------------------------------------------------------------------------
  // Objetos
  // ---------------------------------------------------------------------------

  applyItemBoost(power, duration) {
    // Nunca se suman dos impulsos: se conserva el más potente y el más largo.
    this.itemBoostPower = Math.max(this.itemBoostPower, power);
    this.itemBoostDuration = Math.max(this.itemBoostDuration, duration);
    this.itemBoostTime = Math.max(this.itemBoostTime, duration);
  }

  applySlow(factor, duration) {
    let slowFactor = factor;
    let slowDuration = duration;
    // La barrera reduce la intensidad y la duración del efecto negativo.
    if (this.barrierTime > 0) {
      slowFactor = 1 - (1 - factor) * 0.45;
      slowDuration *= 0.55;
    }
    if (this.slowTime <= 0) this.slowFactor = slowFactor;
    else this.slowFactor = Math.min(this.slowFactor, slowFactor);
    this.slowTime = Math.max(this.slowTime, slowDuration);
    // La masa alta encaja mejor el golpe; la baja lo acusa algo más.
    const massLoss = clamp(0.84 + (this.mass - 1) * 0.05, 0.8, 0.89);
    this.speed *= this.barrierTime > 0 ? 0.94 : massLoss;
  }

  applyBarrier(duration) {
    this.barrierTime = Math.max(this.barrierTime, duration);
  }

  /**
   * Impacto de proyectil: ralentiza y desestabiliza durante un tiempo corto.
   * Devuelve false si la BARRERA está activa (protección completa).
   */
  applyImpact(def, side = 1) {
    if (this.barrierTime > 0) return false;
    this.applySlow(def.slowFactor, def.slowDuration);
    const duration = def.controlDuration ?? 0.65;
    this.impactDuration = Math.max(this.impactDuration, duration);
    this.impactTime = Math.max(this.impactTime, duration);
    // Un kart pesado se descoloca menos; uno ligero, algo más.
    this.impactSteer =
      clamp(side, -1, 1) *
      (def.controlStrength ?? 0.42) /
      Math.sqrt(Math.max(0.7, this.mass));
    // Pérdida extra, perceptible pero sin detener el kart.
    const baseLoss = def.impactSpeedLoss ?? 0.9;
    this.speed *= 1 - (1 - baseLoss) / Math.sqrt(Math.max(0.7, this.mass));
    return true;
  }

  clearItemState() {
    this.item = null;
    this.itemUseCooldown = 0;
    this.pickupCooldown = 0;
    this.aiItemTimer = 1 + Math.random() * 2;
    this.itemBoostTime = 0;
    this.itemBoostDuration = 0;
    this.itemBoostPower = 0;
    this.slowTime = 0;
    this.slowFactor = 1;
    this.barrierTime = 0;
    this.impactTime = 0;
    this.impactDuration = 0;
    this.impactSteer = 0;
    this.aiProjectileCooldown = 0;
  }

  /**
   * Limpia derrape, turbo y objetos sin tocar la posición ni las vueltas.
   * Se usa al pausar, cambiar de pestaña o terminar, para que ningún efecto
   * quede congelado ni se pueda reutilizar al volver.
   */
  clearTransientState() {
    this.cancelDrift();
    this.endTurbo();
    this.clearItemState();
    this.stuckTime = 0;
    this.aiOvertakeTimer = 0;
    this.aiOvertakeSide = 0;
    this.aiOvertakeCooldown = 0;
    this.aiRecoveryTime = 0;
    this.aiMistakeTime = 0;
    this.aiMistakeCooldown = 3 + Math.random() * 4;
    this.aiDriftHold = 0;
    this.aiDriftCooldown = 0;
  }

  // ---------------------------------------------------------------------------
  // Física y progreso
  // ---------------------------------------------------------------------------

  step(dt, controls, track, raceTime) {
    const previousSpeed = this.speed;
    const throttle = clamp(controls.throttle || 0, 0, 1);
    const brake = clamp(controls.brake || 0, 0, 1);
    const steer = clamp(controls.steer || 0, -1, 1);

    this.turboJustActivated = false;

    // El turbo se congela con la pausa porque updateRace deja de llamar a step().
    if (this.turboActive) {
      this.turboTime = Math.max(0, this.turboTime - dt);
      if (this.turboTime <= 0) this.endTurbo();
    }

    // Temporizadores de objetos: cada efecto expira por separado, sin duplicarse.
    if (this.itemUseCooldown > 0) this.itemUseCooldown = Math.max(0, this.itemUseCooldown - dt);
    if (this.pickupCooldown > 0) this.pickupCooldown = Math.max(0, this.pickupCooldown - dt);
    if (this.itemBoostTime > 0) {
      this.itemBoostTime = Math.max(0, this.itemBoostTime - dt);
      if (this.itemBoostTime === 0) {
        this.itemBoostPower = 0;
        this.itemBoostDuration = 0;
      }
    }
    if (this.slowTime > 0) {
      this.slowTime = Math.max(0, this.slowTime - dt);
      if (this.slowTime === 0) this.slowFactor = 1;
    }
    if (this.barrierTime > 0) this.barrierTime = Math.max(0, this.barrierTime - dt);
    if (this.impactTime > 0) {
      this.impactTime = Math.max(0, this.impactTime - dt);
      if (this.impactTime === 0) {
        this.impactDuration = 0;
        this.impactSteer = 0;
      }
    }

    // Derrape: solo empieza con velocidad, asfalto y giro real.
    const driftHeld = Boolean(controls.drift);
    if (!driftHeld) {
      if (this.driftActive) this.finishDrift(true);
      this.driftLock = false;
    } else if (
      !this.driftActive &&
      !this.driftLock &&
      this.speed > DRIFT.minSpeed &&
      !this.onGrass &&
      Math.abs(steer) > 0.12
    ) {
      this.driftActive = true;
      this.driftCharge = 0;
    }

    if (this.driftActive) {
      if (this.speed < DRIFT.minSpeed * 0.7 || this.onGrass) {
        // Derrape abortado: no se convierte en turbo.
        this.finishDrift(false);
        this.driftLock = true;
      } else if (!this.wallContact) {
        // La carga exige girar de verdad y avanzar sobre el asfalto:
        // mantener ESPACIO en recta o contra un muro no carga nada.
        const speedFactor = clamp(
          (this.speed - DRIFT.minSpeed * 0.6) /
            Math.max(1, this.maxSpeed - DRIFT.minSpeed * 0.6),
          0,
          1,
        );
        const steerEffort = clamp((Math.abs(steer) - 0.1) / 0.9, 0, 1);
        const rate =
          (0.18 + 0.5 * steerEffort) * (0.55 + 0.45 * speedFactor) * steerEffort;
        this.driftCharge = Math.min(
          DRIFT.chargeMax,
          this.driftCharge +
            rate * dt * (this.isPlayer ? 1 : this.driftChargeRate),
        );
      }
    }

    // Deslizamiento lateral: la carrocería gira más que la trayectoria.
    const slipTarget = this.driftActive
      ? DRIFT.slipMax * Math.abs(steer) * clamp(this.speed / this.maxSpeed, 0, 1)
      : 0;
    this.driftSlip = damp(
      this.driftSlip,
      slipTarget,
      this.driftActive ? DRIFT.slipSpeed : 4.5,
      dt,
    );

    // Cada kart tiene su propia velocidad, aceleración, frenada y giro.
    // speedBias lo ajusta la carrera (rivales que aprietan) y paceFactor el perfil.
    const pace = this.speedBias * this.paceFactor;
    // Turbo e IMPULSO comparten el mismo tope: nunca se acumulan sin límite.
    const boostPower = Math.max(
      this.turboActive ? this.turboPower : 0,
      this.itemBoostTime > 0 ? this.itemBoostPower : 0,
    );
    const slowFactor = this.slowTime > 0 ? this.slowFactor : 1;
    const maxSpeed = Math.max(1, this.maxSpeed * pace * (1 + boostPower) * slowFactor);

    // Acelerar / frenar / retroceder.
    if (brake > 0) {
      if (this.speed > 0.1) {
        this.speed = Math.max(0, this.speed - this.brakePower * brake * dt);
      } else {
        this.speed = Math.max(-this.reverseMax, this.speed - KART.reverseAcceleration * brake * dt);
      }
    } else if (throttle > 0) {
      const boost = 1 + boostPower * 0.85;
      this.speed += this.acceleration * throttle * boost * dt;
    } else {
      const drag = KART.coastDrag * dt;
      this.speed = Math.abs(this.speed) <= drag ? 0 : this.speed - Math.sign(this.speed) * drag;
    }

    // El derrape roza ligeramente: se compensa con el turbo si se encadena bien.
    if (this.driftActive) this.speed -= this.speed * DRIFT.drag * dt;

    // Sin césped se alcanza la velocidad máxima; en césped todo se ralentiza.
    const speedCap = this.onGrass ? maxSpeed * KART.offRoadSpeedFactor : maxSpeed;
    if (this.speed > speedCap) {
      this.speed = Math.max(speedCap, this.speed - (this.onGrass ? KART.offRoadDrag : 11) * dt);
    }
    this.speed = Math.min(this.speed, maxSpeed * 1.02);
    this.speed = Math.max(this.speed, -this.reverseMax);

    // Giramos menos a alta velocidad para que las curvas exijan frenar.
    const speedAbs = Math.abs(this.speed);
    const speedRatio = Math.min(1, speedAbs / this.maxSpeed);
    const grip = Math.min(1, speedAbs / 4);
    const turnRate =
      this.turnRate *
      (1 - 0.32 * speedRatio) *
      grip *
      (this.driftActive ? DRIFT.turnBoost : 1);
    this.heading -= steer * turnRate * Math.sign(this.speed || 1) * dt;

    // Un impacto desestabiliza el morro durante unos instantes, sin invertir el control.
    if (this.impactTime > 0 && this.impactDuration > 0) {
      const impactRatio = this.impactTime / this.impactDuration;
      const impactGrip = clamp(speedAbs / 8, 0, 1);
      this.heading += this.impactSteer * impactRatio * impactGrip * dt * 1.8;
    }

    // Movimiento dependiente del tiempo real. Durante el derrape la trayectoria
    // se abre respecto al morro, que apunta más cerrado hacia la curva.
    const moveHeading = this.heading + this.driftSlip * Math.sign(steer);
    this.position.x += Math.sin(moveHeading) * this.speed * dt;
    this.position.z += Math.cos(moveHeading) * this.speed * dt;

    // Proyección sobre el trazado: límites, césped y progreso.
    const projection = track.project(this.position);
    this.lateral = projection.lateral;
    this.trackS = projection.s;
    this.onGrass = Math.abs(this.lateral) > track.halfWidth;
    this.wallContact = false;

    const limit = track.wallOffset - KART.wallLimitExtra;
    if (Math.abs(this.lateral) > limit) {
      const side = Math.sign(this.lateral);
      const clampedLateral = side * limit;
      this.position.x = projection.centerX + projection.sx * clampedLateral;
      this.position.z = projection.centerZ + projection.sz * clampedLateral;
      this.speed *= 0.68;
      this.wallContact = true;

      // Reorienta el kart hacia la pista para evitar quedarse encajado en el muro.
      const tangentHeading = Math.atan2(projection.tx, projection.tz);
      const forwardDot =
        Math.sin(this.heading) * projection.tx + Math.cos(this.heading) * projection.tz;
      const target = forwardDot >= 0 ? tangentHeading : tangentHeading + Math.PI;
      this.heading = lerpAngle(this.heading, target, 0.55);
      this.lateral = clampedLateral;
      this.onGrass = Math.abs(clampedLateral) > track.halfWidth;
    }

    // Tiempo bloqueado: la IA lo usa para recuperarse sin teletransportes.
    const tryingToMove = throttle > 0.1 || brake > 0.1;
    if (tryingToMove && Math.abs(this.speed) < 2.5) {
      this.stuckTime = Math.min(this.stuckTime + dt, 30);
    } else {
      this.stuckTime = Math.max(0, this.stuckTime - dt * 1.8);
    }

    this.updateProgress(track, raceTime);
    this.updateVisual(dt, steer, previousSpeed);

    this.group.position.set(this.position.x, 0.02, this.position.z);
    this.group.rotation.y = this.heading;
  }

  updateProgress(track, raceTime) {
    const length = track.length;
    let delta = this.trackS - this.lastTrackS;
    if (delta > length / 2) delta -= length;
    if (delta < -length / 2) delta += length;
    this.lastTrackS = this.trackS;
    this.progress += delta;

    if (this.finished) return;

    // La primera vuelta empieza de verdad al cruzar la línea de salida.
    if (this.lapStartTime === null && this.progress >= 0) {
      this.lapStartTime = raceTime;
    }

    const expectedLap = Math.floor(this.progress / length) + 1;
    while (this.lap < expectedLap && !this.finished) {
      if (this.lapStartTime !== null) {
        const lapTime = Math.max(0, raceTime - this.lapStartTime);
        this.lastLapTime = lapTime;
        if (this.bestLapTime === null || lapTime < this.bestLapTime) {
          this.bestLapTime = lapTime;
        }
        this.lapStartTime = raceTime;
      }

      this.lap += 1;
      if (this.lap > CONFIG.laps) {
        this.lap = CONFIG.laps + 1;
        this.finished = true;
        this.finishTime = raceTime;
        this.lapStartTime = null;
        break;
      }
    }
  }

  updateVisual(dt, steer, previousSpeed) {
    const speedAbs = Math.abs(this.speed);
    const speedRatio = Math.min(1, speedAbs / this.maxSpeed);

    this.steerVisual = damp(this.steerVisual, steer, 12, dt);
    this.spinAngle += (this.speed / 0.37) * dt;

    for (const wheel of this.wheels) {
      wheel.spin.rotation.x = this.spinAngle;
      if (wheel.front) wheel.steer.rotation.y = -this.steerVisual * 0.42;
    }

    // Balanceo de la carrocería y cabeceo al acelerar/frenar.
    const targetRoll = -this.steerVisual * 0.09 * speedRatio;
    const acceleration = dt > 0 ? clamp((this.speed - previousSpeed) / dt, -45, 30) : 0;
    const targetPitch = -acceleration * 0.0022;
    this.roll = damp(this.roll, targetRoll, 7, dt);
    this.pitch = damp(this.pitch, targetPitch, 7, dt);

    this.bobTime += dt * (3 + speedAbs * 0.25);
    const roughness = this.onGrass ? 0.045 : 0.012;
    const bob = Math.sin(this.bobTime) * roughness * (0.35 + speedRatio);

    this.model.rotation.z = this.roll;
    this.model.rotation.x = this.pitch;
    this.model.position.y = bob;
    this.model.position.x = Math.sin(this.bobTime * 0.5) * (this.onGrass ? 0.035 : 0.008);

    // Llamas del turbo y del IMPULSO, con un parpadeo muy barato.
    if (this.turboFlames) {
      const itemBoost = this.itemBoostTime > 0;
      let boostRatio = 0;
      if (this.turboActive && this.turboDuration > 0) {
        boostRatio = clamp(this.turboTime / this.turboDuration, 0, 1);
      } else if (itemBoost && this.itemBoostDuration > 0) {
        boostRatio = clamp(this.itemBoostTime / this.itemBoostDuration, 0, 1);
      }
      if (!this.turboActive && itemBoost) this.turboMaterial.color.setHex(0xffd23f);

      const flicker = 0.8 + Math.random() * 0.45;
      for (const flame of this.turboFlames) {
        flame.visible = boostRatio > 0;
        if (flame.visible) {
          flame.scale.set(flicker, 0.55 + boostRatio * 1.25, flicker);
        }
      }
    }

    if (this.barrierMesh) {
      this.barrierMesh.visible = this.barrierTime > 0;
      if (this.barrierMesh.visible) {
        this.barrierMesh.rotation.y += dt * 1.4;
        this.barrierMaterial.opacity = 0.15 + Math.sin(this.bobTime * 3.2) * 0.06;
      }
    }
  }

  dispose() {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.group.traverse((object) => {
      if (object.isMesh && object.material instanceof THREE.Material) {
        // La sombra de contacto usa un material propio que no está en la lista.
        if (!this.materials.includes(object.material)) object.material.dispose();
      }
    });
  }
}
