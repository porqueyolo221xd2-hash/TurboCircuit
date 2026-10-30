// Kart original construido con geometrías simples y física arcade.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { clamp, damp, lerpAngle } from './utils.js';

const KART = CONFIG.kart;
const DRIFT = CONFIG.drift;

// Proporciones de carrocería por estilo. Comparten materiales, ruedas y pilotos,
// pero cambian silueta, anchura y distancia entre ejes.
const STYLE_SHAPES = {
  // Cada estilo define una silueta propia: proporciones, morro, pontones,
  // alerón y ruedas. La física no depende de estos valores.
  standard: {
    bodyW: 1.15,
    bodyL: 2.25,
    bodyY: 0.66,
    noseW: 0.44,
    noseLen: 1.05,
    noseBaseZ: 0.68,
    podW: 0.4,
    podH: 0.36,
    podL: 1.25,
    podY: 0.5,
    podZ: -0.18,
    frontWingW: 1.8,
    engineW: 0.6,
    exhaustX: 0.26,
    exhaustY: 0.56,
    exhaustZ: -1.42,
    wingW: 1.85,
    wingY: 1.24,
    wheelTrack: 0.9,
    wheelBase: 1,
    wheelRadius: 0.36,
  },
  speedster: {
    bodyW: 1.05,
    bodyL: 2.45,
    bodyY: 0.64,
    noseW: 0.36,
    noseLen: 1.32,
    noseBaseZ: 0.75,
    podW: 0.33,
    podH: 0.3,
    podL: 1.15,
    podY: 0.48,
    podZ: -0.2,
    frontWingW: 1.65,
    engineW: 0.5,
    exhaustX: 0.22,
    exhaustY: 0.54,
    exhaustZ: -1.52,
    wingW: 1.55,
    wingY: 1.04,
    wheelTrack: 0.88,
    wheelBase: 1.08,
    wheelRadius: 0.355,
  },
  agile: {
    bodyW: 1.08,
    bodyL: 2.1,
    bodyY: 0.66,
    noseW: 0.46,
    noseLen: 0.88,
    noseBaseZ: 0.62,
    podW: 0.34,
    podH: 0.32,
    podL: 1,
    podY: 0.5,
    podZ: -0.12,
    frontWingW: 1.7,
    engineW: 0.56,
    exhaustX: 0.25,
    exhaustY: 0.55,
    exhaustZ: -1.3,
    wingW: 1.7,
    wingY: 1.36,
    wheelTrack: 0.86,
    wheelBase: 0.92,
    wheelRadius: 0.355,
  },
  heavy: {
    bodyW: 1.34,
    bodyL: 2.35,
    bodyY: 0.7,
    noseW: 0.58,
    noseLen: 0.9,
    noseBaseZ: 0.72,
    podW: 0.48,
    podH: 0.42,
    podL: 1.3,
    podY: 0.54,
    podZ: -0.2,
    frontWingW: 2.05,
    engineW: 0.7,
    exhaustX: 0.3,
    exhaustY: 0.6,
    exhaustZ: -1.5,
    wingW: 2.1,
    wingY: 1.34,
    wheelTrack: 1,
    wheelBase: 0.98,
    wheelRadius: 0.385,
  },
};

/**
 * Acumulador de piezas: agrupa geometrías por material y las fusiona en una
 * sola malla. Permite modelar con mucho detalle sin disparar los draw calls.
 */
class PartBuilder {
  constructor() {
    this.groups = new Map();
  }

  add(material, geometry) {
    let list = this.groups.get(material);
    if (!list) {
      list = [];
      this.groups.set(material, list);
    }
    list.push(geometry);
  }

  commit(target) {
    for (const [material, geometries] of this.groups) {
      const merged = mergeGeometries(geometries, false);
      for (const geometry of geometries) geometry.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      target.add(mesh);
    }
    this.groups.clear();
  }
}

/** Caja con tapa superior e inferior de distinto tamaño (volumen troncocónico). */
function taperedBoxY(wBottom, dBottom, wTop, dTop, height) {
  const geometry = new THREE.BoxGeometry(wBottom, height, dBottom);
  const position = geometry.attributes.position;
  const ratioW = wTop / wBottom;
  const ratioD = dTop / dBottom;
  for (let i = 0; i < position.count; i += 1) {
    const t = (position.getY(i) + height / 2) / height;
    position.setX(i, position.getX(i) * (1 + (ratioW - 1) * t));
    position.setZ(i, position.getZ(i) * (1 + (ratioD - 1) * t));
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Caja que se estrecha hacia el morro (+Z). */
function taperedBoxZ(wBack, hBack, wFront, hFront, length) {
  const geometry = new THREE.BoxGeometry(wBack, hBack, length);
  const position = geometry.attributes.position;
  const ratioW = wFront / wBack;
  const ratioH = hFront / hBack;
  for (let i = 0; i < position.count; i += 1) {
    const t = position.getZ(i) / length + 0.5;
    position.setX(i, position.getX(i) * (1 + (ratioW - 1) * t));
    position.setY(i, position.getY(i) * (1 + (ratioH - 1) * t));
  }
  geometry.computeVertexNormals();
  return geometry;
}

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

    // Salto: altura sobre el suelo, velocidad vertical y estado aéreo.
    this.height = 0;
    this.verticalVelocity = 0;
    this.airborne = false;
    this.airTime = 0;
    this.rampHeight = 0;
    this.landingTime = 0;
    this.justLanded = false;
    this.featureCooldowns = new Map();

    this.trackS = 0;
    this.lateral = 0;
    this.lastTrackS = 0;
    this.progress = 0;
    // Ruta activa (null = trazado principal) y altura del asfalto bajo el kart.
    this.route = null;
    this.groundY = 0;
    this.checkpointMask = 0;
    this.checkpointCount = 0;
    this.invalidLaps = 0;
    this.aiRouteIntent = null;
    this.aiRouteCommitS = null;
    this.aiRoutePlan = new Map();

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
    this.turboJustEnded = false;
    this.turboCooldown = 0;

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
    this.stunTime = 0;
    this.stunDuration = 0;
    this.stunImmunity = 0;
    this.stunPhase = 0;
    this.projectileGrace = 0;

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

  /**
   * Acumulador de piezas: agrupa geometrías por material y las fusiona en una
   * sola malla. Permite modelar con detalle (morro, pontones, alerón, escapes)
   * sin disparar el número de draw calls.
   */
  buildModel() {
    const shape = STYLE_SHAPES[this.bodyStyle] ?? STYLE_SHAPES.standard;

    const paint = this.makeMaterial(this.color, 0.38, 0.18);
    const paintDark = this.makeMaterial(
      new THREE.Color(this.color).multiplyScalar(0.48),
      0.46,
      0.12,
    );
    const accent = this.makeMaterial(this.accent, 0.38, 0.14);
    const carbon = this.makeMaterial(0x14171d, 0.68, 0.1);
    const rubber = this.makeMaterial(0x0b0d11, 0.96, 0.02);
    const rim = this.makeMaterial(0xe2e9f3, 0.3, 0.38);
    const chrome = this.makeMaterial(0xb9c4d6, 0.26, 0.42);
    const glass = this.makeMaterial(0x0a1524, 0.16, 0.18);
    const suit = this.makeMaterial(0xf5f7fb, 0.62, 0.04);
    const headlight = new THREE.MeshStandardMaterial({
      color: 0xfff7dc,
      emissive: 0xffe49c,
      emissiveIntensity: 2.8,
      roughness: 0.2,
    });
    const taillight = new THREE.MeshStandardMaterial({
      color: 0xff3346,
      emissive: 0xff1b30,
      emissiveIntensity: 2.4,
      roughness: 0.3,
    });
    this.materials.push(headlight, taillight);
    this.paintMaterial = paint;
    this.accentMaterial = accent;

    const b = new PartBuilder();
    const put = (mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      if (rx) geo.rotateX(rx);
      if (ry) geo.rotateY(ry);
      if (rz) geo.rotateZ(rz);
      geo.translate(x, y, z);
      b.add(mat, geo);
    };

    const wheelR = shape.wheelRadius;
    const bodyW = shape.bodyW;
    const bodyY = shape.bodyY;
    const noseBaseZ = shape.noseBaseZ;
    const noseLen = shape.noseLen;
    const noseTipZ = noseBaseZ + noseLen;
    const rearZ = -shape.bodyL * 0.5;
    const wingY = shape.wingY;
    const wingZ = rearZ - 0.16;

    // --- Plataforma, fondo y cuerpo central --------------------------------
    put(carbon, taperedBoxY(bodyW * 0.84, shape.bodyL * 0.92, bodyW * 0.9, shape.bodyL * 0.78, 0.08), 0, 0.3, -0.04);
    put(paintDark, taperedBoxY(bodyW * 0.98, shape.bodyL * 0.78, bodyW * 0.84, shape.bodyL * 0.62, 0.24), 0, 0.44, -0.1);
    put(paint, taperedBoxY(bodyW * 0.9, shape.bodyL * 0.6, bodyW * 0.66, shape.bodyL * 0.52, 0.3), 0, 0.63, -0.2);

    // Morro: cuna baja y afilada que termina en punta.
    put(
      paint,
      taperedBoxZ(bodyW * 0.7, 0.34, shape.noseW, 0.14, noseLen),
      0,
      0.55,
      noseBaseZ + noseLen * 0.5,
    );
    put(
      paintDark,
      taperedBoxZ(bodyW * 0.72, 0.07, shape.noseW * 1.02, 0.05, noseLen * 0.96),
      0,
      0.39,
      noseBaseZ + noseLen * 0.48,
    );
    // Puntera y faros integrados.
    put(accent, new THREE.BoxGeometry(shape.noseW * 0.9, 0.07, 0.12), 0, 0.57, noseTipZ - 0.04);
    put(accent, new THREE.BoxGeometry(0.14, 0.022, noseLen * 0.8), 0, 0.69, noseBaseZ + noseLen * 0.5, 0.095);
    put(carbon, new THREE.BoxGeometry(shape.noseW * 0.55, 0.12, 0.08), 0, 0.5, noseTipZ - 0.02);
    for (const sign of [-1, 1]) {
      put(
        headlight,
        new THREE.BoxGeometry(0.14, 0.06, 0.04),
        sign * shape.noseW * 0.32,
        0.54,
        noseTipZ - 0.3,
      );
    }

    // Alerón delantero bajo, con endplates, flap y soportes al morro.
    const fwZ = noseTipZ + 0.06;
    put(carbon, new THREE.BoxGeometry(shape.frontWingW * 0.92, 0.05, 0.34), 0, 0.22, fwZ);
    put(paint, new THREE.BoxGeometry(shape.frontWingW * 0.7, 0.035, 0.18), 0, 0.29, fwZ + 0.08, 0.12);
    for (const sign of [-1, 1]) {
      put(
        carbon,
        new THREE.BoxGeometry(0.05, 0.2, 0.4),
        sign * shape.frontWingW * 0.46,
        0.31,
        fwZ,
      );
      put(
        accent,
        new THREE.BoxGeometry(0.055, 0.04, 0.4),
        sign * shape.frontWingW * 0.46,
        0.42,
        fwZ,
      );
      put(
        carbon,
        new THREE.BoxGeometry(0.06, 0.34, 0.09),
        sign * shape.noseW * 0.38,
        0.38,
        fwZ - 0.16,
      );
    }

    // Suspensión vista: brazos que unen el chasis con cada rueda.
    for (const sign of [-1, 1]) {
      for (const z of [shape.wheelBase, -shape.wheelBase]) {
        put(
          carbon,
          new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8),
          sign * 0.68,
          shape.wheelRadius + 0.07,
          z,
          0,
          0,
          Math.PI / 2,
        );
        put(
          chrome,
          new THREE.CylinderGeometry(0.026, 0.026, 0.4, 8),
          sign * 0.66,
          shape.wheelRadius - 0.06,
          z + 0.1,
          0,
          0,
          Math.PI / 2,
        );
      }
    }

    // Pontones laterales con entrada de aire frontal.
    for (const sign of [-1, 1]) {
      put(
        paint,
        taperedBoxZ(shape.podW, shape.podH, shape.podW * 0.78, shape.podH * 0.72, shape.podL),
        sign * (bodyW * 0.5 + shape.podW * 0.36),
        shape.podY,
        shape.podZ,
      );
      put(
        carbon,
        new THREE.BoxGeometry(shape.podW * 0.58, shape.podH * 0.42, 0.1),
        sign * (bodyW * 0.5 + shape.podW * 0.36),
        shape.podY - 0.02,
        shape.podZ + shape.podL * 0.47,
      );
      put(
        accent,
        new THREE.BoxGeometry(0.05, 0.05, shape.podL * 0.8),
        sign * (bodyW * 0.5 + shape.podW * 0.72),
        shape.podY + shape.podH * 0.36,
        shape.podZ,
      );
      // Roundel lateral: aro de color y disco claro.
      put(
        accent,
        new THREE.CylinderGeometry(0.15, 0.15, 0.02, 18),
        sign * (bodyW * 0.5 + shape.podW * 0.5 + 0.015),
        shape.podY + 0.02,
        shape.podZ - 0.03,
        0,
        0,
        Math.PI / 2,
      );
      put(
        rim,
        new THREE.CylinderGeometry(0.115, 0.115, 0.024, 18),
        sign * (bodyW * 0.5 + shape.podW * 0.5 + 0.02),
        shape.podY + 0.02,
        shape.podZ - 0.03,
        0,
        0,
        Math.PI / 2,
      );
    }

    // Cockpit abierto, asiento y salpicadero.
    put(carbon, new THREE.BoxGeometry(bodyW * 0.58, 0.05, 0.82), 0, bodyY + 0.2, -0.05);
    put(carbon, new THREE.BoxGeometry(bodyW * 0.46, 0.24, 0.3), 0, bodyY + 0.32, -0.33);
    put(paintDark, new THREE.BoxGeometry(bodyW * 0.56, 0.16, 0.12), 0, bodyY + 0.28, 0.3);
    for (const sign of [-1, 1]) {
      put(
        paintDark,
        new THREE.BoxGeometry(0.09, 0.3, 0.78),
        sign * bodyW * 0.31,
        bodyY + 0.13,
        -0.05,
      );
    }
    put(carbon, new THREE.BoxGeometry(0.36, 0.22, 0.12), 0, bodyY + 0.55, -0.34);

    // Cubierta del motor: baja hacia la zaga.
    put(
      paint,
      taperedBoxZ(shape.engineW, 0.2, shape.engineW * 0.72, 0.34, 0.95),
      0,
      0.7,
      -0.86,
    );
    put(accent, new THREE.BoxGeometry(0.12, 0.03, 0.8), 0, 0.83, -0.82);
    put(carbon, new THREE.BoxGeometry(shape.engineW * 0.8, 0.06, 0.5), 0, 0.79, -0.6);

    // Escapes gemelos.
    for (const sign of [-1, 1]) {
      put(
        chrome,
        new THREE.CylinderGeometry(0.062, 0.075, 0.26, 10),
        sign * shape.exhaustX,
        shape.exhaustY,
        shape.exhaustZ,
        Math.PI / 2,
      );
      put(
        carbon,
        new THREE.CylinderGeometry(0.078, 0.078, 0.07, 10),
        sign * shape.exhaustX,
        shape.exhaustY,
        shape.exhaustZ - 0.15,
        Math.PI / 2,
      );
    }

    // Piloto: torso, casco con visera, brazos y volante.
    put(carbon, new THREE.BoxGeometry(0.54, 0.1, 0.34), 0, bodyY + 0.19, -0.28);
    put(
      suit,
      new THREE.CapsuleGeometry(0.17, 0.24, 4, 12),
      0,
      bodyY + 0.3,
      -0.22,
      -0.12,
    );
    put(accent, new THREE.BoxGeometry(0.26, 0.09, 0.2), 0, bodyY + 0.32, -0.05);
    put(
      paint,
      new THREE.SphereGeometry(0.21, 18, 14),
      0,
      bodyY + 0.61,
      -0.16,
    );
    put(accent, new THREE.BoxGeometry(0.08, 0.1, 0.42), 0, bodyY + 0.75, -0.16);
    put(
      glass,
      new THREE.CylinderGeometry(0.214, 0.214, 0.13, 18, 1, true, -0.95, 1.9),
      0,
      bodyY + 0.63,
      -0.16,
    );
    put(suit, new THREE.BoxGeometry(0.18, 0.07, 0.06), 0, bodyY + 0.53, 0.015);
    for (const sign of [-1, 1]) {
      put(
        suit,
        new THREE.CapsuleGeometry(0.06, 0.24, 3, 8),
        sign * 0.18,
        bodyY + 0.28,
        0.02,
        1.15,
        0,
        sign * 0.22,
      );
      put(carbon, new THREE.SphereGeometry(0.065, 8, 6), sign * 0.16, bodyY + 0.19, 0.25);
    }
    put(carbon, new THREE.TorusGeometry(0.145, 0.026, 6, 16), 0, bodyY + 0.25, 0.33, -1.15);
    put(chrome, new THREE.CylinderGeometry(0.026, 0.026, 0.28, 8), 0, bodyY + 0.19, 0.42, 1.2);

    // Alerón trasero: dos planos, soportes y endplates.
    const wingW = shape.wingW;
    for (const sign of [-1, 1]) {
      put(
        carbon,
        new THREE.BoxGeometry(0.06, wingY - 0.68, 0.1),
        sign * (wingW * 0.22),
        0.68 + (wingY - 0.68) * 0.5,
        wingZ + 0.1,
      );
      put(
        carbon,
        new THREE.BoxGeometry(0.05, 0.22, 0.4),
        sign * wingW * 0.5,
        wingY + 0.02,
        wingZ,
      );
      put(
        accent,
        new THREE.BoxGeometry(0.045, 0.055, 0.42),
        sign * (wingW * 0.5 - 0.005),
        wingY + 0.16,
        wingZ,
      );
    }
    put(accent, new THREE.BoxGeometry(wingW, 0.055, 0.38), 0, wingY, wingZ, 0.08);
    put(paintDark, new THREE.BoxGeometry(wingW * 0.9, 0.04, 0.24), 0, wingY + 0.13, wingZ - 0.03, 0.16);
    put(carbon, new THREE.BoxGeometry(0.5, 0.1, 0.2), 0, 0.62, rearZ - 0.06);
    put(taillight, new THREE.BoxGeometry(0.36, 0.06, 0.05), 0, 0.72, rearZ - 0.1);
    for (const offset of [-0.26, 0, 0.26]) {
      put(carbon, new THREE.BoxGeometry(0.035, 0.22, 0.32), offset, 0.3, rearZ - 0.04);
    }

    // --- Rasgos de silueta por estilo --------------------------------------
    if (this.bodyStyle === 'speedster') {
      // Cabina envolvente, aletas traseras gemelas y morro largo.
      put(
        glass,
        new THREE.SphereGeometry(0.34, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        0,
        bodyY + 0.2,
        -0.22,
      );
      for (const sign of [-1, 1]) {
        put(
          accent,
          taperedBoxY(0.06, 0.55, 0.02, 0.22, 0.85),
          sign * 0.62,
          0.98,
          -1.3,
        );
        put(
          carbon,
          new THREE.BoxGeometry(0.09, 0.14, 0.6),
          sign * 0.48,
          0.36,
          -1.1,
        );
      }
      // Tomas de aire sobre los pontones.
      for (const sign of [-1, 1]) {
        put(
          carbon,
          new THREE.BoxGeometry(0.14, 0.06, 0.5),
          sign * (bodyW * 0.5 + shape.podW * 0.3),
          shape.podY + shape.podH * 0.5,
          shape.podZ + 0.2,
        );
      }
    } else if (this.bodyStyle === 'agile') {
      // Aleta central, pontones redondeados y suspensión a la vista.
      put(
        paint,
        taperedBoxY(0.07, 0.96, 0.025, 0.42, 0.9),
        0,
        1.02,
        -0.95,
      );
      put(accent, new THREE.BoxGeometry(0.09, 0.07, 0.78), 0, 1.47, -0.95);
      for (const sign of [-1, 1]) {
        put(
          paint,
          new THREE.CylinderGeometry(0.17, 0.19, shape.podL, 12),
          sign * (bodyW * 0.5 + shape.podW * 0.42),
          shape.podY,
          shape.podZ,
          Math.PI / 2,
        );
        put(
          accent,
          new THREE.TorusGeometry(0.19, 0.02, 6, 16),
          sign * (bodyW * 0.5 + shape.podW * 0.42),
          shape.podY,
          shape.podZ + shape.podL * 0.5,
        );
        put(
          chrome,
          new THREE.CylinderGeometry(0.028, 0.028, 0.68, 8),
          sign * (bodyW * 0.5 + 0.26),
          0.3,
          shape.wheelBase,
          Math.PI / 2,
          0.14,
        );
        put(
          chrome,
          new THREE.CylinderGeometry(0.026, 0.026, 0.64, 8),
          sign * (bodyW * 0.5 + 0.26),
          0.3,
          -shape.wheelBase,
          Math.PI / 2,
          -0.14,
        );
      }
      put(rim, new THREE.BoxGeometry(bodyW * 0.5, 0.05, 0.28), 0, 0.33, noseTipZ - 0.06);
    } else if (this.bodyStyle === 'heavy') {
      // Paragolpes macizos, jaula antivuelco y escapes verticales.
      put(carbon, new THREE.BoxGeometry(bodyW * 1.02, 0.18, 0.28), 0, 0.43, noseTipZ - 0.12);
      put(carbon, new THREE.BoxGeometry(bodyW * 0.96, 0.2, 0.3), 0, 0.5, rearZ - 0.02);
      for (const sign of [-1, 1]) {
        put(
          rim,
          new THREE.CylinderGeometry(0.055, 0.055, 1.02, 8),
          sign * 0.55,
          1.08,
          -0.3,
        );
        put(
          rim,
          new THREE.CylinderGeometry(0.055, 0.055, 0.82, 8),
          sign * 0.55,
          1.58,
          -0.08,
          Math.PI / 2,
        );
        put(
          rim,
          new THREE.CylinderGeometry(0.055, 0.055, 1.12, 8),
          0,
          1.58,
          -0.08,
          0,
          0,
          Math.PI / 2,
        );
        put(
          chrome,
          new THREE.CylinderGeometry(0.07, 0.08, 0.5, 10),
          sign * (shape.exhaustX + 0.16),
          0.86,
          rearZ + 0.16,
        );
      }
      put(carbon, new THREE.BoxGeometry(bodyW * 1.06, 0.2, 0.26), 0, 0.56, noseTipZ + 0.04);
    }

    b.commit(this.model);
    for (const child of this.model.children) {
      if (child.isMesh && child.geometry) this.geometries.push(child.geometry);
    }

    this.buildWheels(shape, rubber, carbon, rim, accent, chrome);

    // Llamas del turbo: se encienden solo al acelerar.
    this.turboMaterial = new THREE.MeshBasicMaterial({
      color: 0x5fe6ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(this.turboMaterial);
    this.turboFlames = [];
    const flameGeometry = new THREE.ConeGeometry(0.1, 0.9, 8);
    for (const sign of [-1, 1]) {
      const flame = new THREE.Mesh(flameGeometry, this.turboMaterial);
      flame.position.set(sign * shape.exhaustX, shape.exhaustY, shape.exhaustZ - 0.6);
      flame.rotation.x = -Math.PI / 2;
      flame.visible = false;
      this.model.add(flame);
      this.turboFlames.push(flame);
    }
    this.geometries.push(flameGeometry);

    // Barrera: burbuja de alambre que solo se ve mientras protege.
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
    this.barrierMesh.position.y = 0.85;
    this.barrierMesh.visible = false;
    this.model.add(this.barrierMesh);

    // Estrellas de aturdimiento: tres rombos que orbitan sobre el casco.
    this.stunMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd23f,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(this.stunMaterial);
    this.stunStars = new THREE.Group();
    this.stunStars.position.y = CONFIG.stun.starHeight * 0.86;
    this.stunStars.visible = false;
    const starGeometry = this.trackGeometry(new THREE.OctahedronGeometry(0.095, 0));
    for (let i = 0; i < 3; i += 1) {
      const star = new THREE.Mesh(starGeometry, this.stunMaterial);
      const angle = (i / 3) * Math.PI * 2;
      star.position.set(
        Math.cos(angle) * 0.36,
        Math.sin(angle * 3) * 0.045,
        Math.sin(angle) * 0.36,
      );
      this.stunStars.add(star);
    }
    this.model.add(this.stunStars);

    // Sombra de contacto (barata y siempre bajo el kart).
    const shadow = new THREE.Mesh(
      this.trackGeometry(new THREE.CircleGeometry(1.05, 20)),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.008;
    shadow.scale.set(shape.bodyW / 1.7, (shape.bodyL / 2.45) * 1.55, 1);
    this.group.add(shadow);
    this.shadow = shadow;
    this.shadowMaterial = shadow.material;
    this.shadowBaseScale = shadow.scale.clone();
  }

  /** Ruedas con neumático toroidal, llanta, radios y buje (3 mallas por rueda). */
  buildWheels(shape, rubber, carbon, rim, accent, chrome) {
    const tireParts = [];
    const tire = new THREE.TorusGeometry(0.277, 0.083, 10, 22);
    tire.rotateY(Math.PI / 2);
    tireParts.push(tire);
    const tireInner = new THREE.CylinderGeometry(0.17, 0.17, 0.16, 18);
    tireInner.rotateZ(Math.PI / 2);
    tireParts.push(tireInner);
    const tireGeometry = mergeGeometries(tireParts, false);
    for (const part of tireParts) part.dispose();
    tireGeometry.computeBoundingSphere();
    this.geometries.push(tireGeometry);

    // Disco oscuro de fondo: hace que los radios claros destaquen.
    const discGeometry = new THREE.CylinderGeometry(0.19, 0.19, 0.13, 18);
    discGeometry.rotateZ(Math.PI / 2);
    this.geometries.push(discGeometry);

    const rimParts = [];
    const ring = new THREE.TorusGeometry(0.184, 0.013, 6, 20);
    ring.rotateY(Math.PI / 2);
    rimParts.push(ring);
    for (let i = 0; i < 5; i += 1) {
      // Barras radiales en el plano de la rueda (eje X), repartidas en estrella.
      const spoke = new THREE.BoxGeometry(0.07, 0.33, 0.04);
      spoke.rotateX((i / 5) * Math.PI);
      rimParts.push(spoke);
    }
    const hub = new THREE.CylinderGeometry(0.062, 0.062, 0.2, 10);
    hub.rotateZ(Math.PI / 2);
    rimParts.push(hub);
    const rimGeometry = mergeGeometries(rimParts, false);
    for (const part of rimParts) part.dispose();
    rimGeometry.computeBoundingSphere();
    this.geometries.push(rimGeometry);

    const capGeometry = new THREE.CylinderGeometry(0.042, 0.042, 0.22, 10);
    capGeometry.rotateZ(Math.PI / 2);
    this.geometries.push(capGeometry);

    const wheelPositions = [      { x: -shape.wheelTrack, z: shape.wheelBase, front: true },
      { x: shape.wheelTrack, z: shape.wheelBase, front: true },
      { x: -shape.wheelTrack, z: -shape.wheelBase, front: false },
      { x: shape.wheelTrack, z: -shape.wheelBase, front: false },
    ];

    for (const spec of wheelPositions) {
      const steerGroup = new THREE.Group();
      steerGroup.position.set(spec.x, shape.wheelRadius, spec.z);
      const spinGroup = new THREE.Group();
      steerGroup.add(spinGroup);

      const tireMesh = new THREE.Mesh(tireGeometry, rubber);
      tireMesh.castShadow = true;
      spinGroup.add(tireMesh);

      const discMesh = new THREE.Mesh(discGeometry, carbon);
      spinGroup.add(discMesh);

      const rimMesh = new THREE.Mesh(rimGeometry, rim);
      rimMesh.castShadow = true;
      spinGroup.add(rimMesh);

      const cap = new THREE.Mesh(capGeometry, accent);
      spinGroup.add(cap);

      this.model.add(steerGroup);
      this.wheels.push({
        steer: steerGroup,
        spin: spinGroup,
        front: spec.front,
        baseY: shape.wheelRadius,
      });
    }
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
    this.route = null;
    this.groundY = Number.isFinite(position.y) ? position.y : 0;
    this.checkpointMask = 0;
    this.checkpointCount = 0;
    this.invalidLaps = 0;
    this.aiRouteIntent = null;
    this.aiRouteCommitS = null;
    if (this.aiRoutePlan) this.aiRoutePlan.clear();
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
    this.turboJustEnded = false;
    this.turboCooldown = 0;

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
    this.stunTime = 0;
    this.stunDuration = 0;
    this.stunImmunity = 0;
    this.stunPhase = 0;
    this.projectileGrace = 0;

    this.height = 0;
    this.verticalVelocity = 0;
    this.airborne = false;
    this.airTime = 0;
    this.rampHeight = 0;
    this.landingTime = 0;
    this.justLanded = false;
    this.featureCooldowns.clear();

    this.group.position.set(position.x, this.groundY + 0.02, position.z);
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
    if (this.turboActive) return;
    const strong = level >= 2;
    this.turboLevel = strong ? 2 : 1;
    this.turboDuration = strong ? DRIFT.strongDuration : DRIFT.shortDuration;
    this.turboTime = this.turboDuration;
    this.turboPower = strong ? DRIFT.strongPower : DRIFT.shortPower;
    this.turboActive = true;
    this.turboJustActivated = true;
    this.turboJustEnded = false;
    // Pequeño empujón inicial; el límite real se aplica en step().
    this.speed += strong ? 1.8 : 1.1;
    if (this.turboMaterial) {
      this.turboMaterial.color.setHex(strong ? 0xffb02e : 0x5fe6ff);
    }
  }

  endTurbo() {
    const wasActive = this.turboActive;
    this.turboActive = false;
    this.turboTime = 0;
    this.turboDuration = 0;
    this.turboLevel = 0;
    this.turboPower = 0;
    if (wasActive) {
      // Pausa breve obligatoria: evita reencadenar impulsos sin cargar de nuevo.
      this.turboCooldown = DRIFT.turboCooldown;
      this.turboJustEnded = true;
    }
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
   * Impacto de proyectil: ralentiza, desestabiliza y puede aturdir.
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

    // Aturdimiento real: se refresca hasta el máximo, nunca se suma sin límite.
    const stun = Math.min(def.stunTime ?? 0, CONFIG.stun.maxDuration);
    if (stun > 0 && this.stunImmunity <= 0) {
      const wasStunned = this.stunTime > 0;
      this.stunDuration = Math.max(this.stunDuration, stun);
      this.stunTime = Math.max(this.stunTime, stun);
      this.stunPhase = 0;
      if (!wasStunned) {
        // Un golpe fuerte corta el derrape: no se regala turbo al perder el control.
        this.cancelDrift();
      }
    }
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
    this.stunTime = 0;
    this.stunDuration = 0;
    this.stunImmunity = 0;
    this.stunPhase = 0;
    this.projectileGrace = 0;
    this.aiProjectileCooldown = 0;
    if (this.model) this.model.rotation.y = 0;
  }

  /**
   * Limpia derrape, turbo y objetos sin tocar la posición ni las vueltas.
   * Se usa al pausar, cambiar de pestaña o terminar, para que ningún efecto
   * quede congelado ni se pueda reutilizar al volver.
   */
  /**
   * Inicia un salto. `height` se conserva para que la rampa pueda lanzar
   * desde su altura real y el kart caiga con gravedad propia.
   */
  startJump(verticalVelocity = CONFIG.air.launchBase) {
    if (this.verticalVelocity > verticalVelocity) return;
    this.airborne = true;
    this.airTime = 0;
    this.verticalVelocity = Math.max(0, verticalVelocity);
    this.height = Math.max(this.height, 0.05);
    this.driftActive = false;
    this.driftCharge = 0;
    this.driftSlip = 0;
  }

  setRampHeight(height) {
    this.rampHeight = Math.max(0, height);
    if (!this.airborne) this.height = this.rampHeight;
  }

  landFromAir() {
    this.airborne = false;
    this.height = 0;
    this.verticalVelocity = 0;
    this.airTime = 0;
    this.rampHeight = 0;
    this.landingTime = 0.26;
    this.justLanded = true;
    this.speed *= CONFIG.air.landingDrag;
  }

  clearTransientState() {
    this.cancelDrift();
    this.endTurbo();
    this.turboJustActivated = false;
    this.turboJustEnded = false;
    this.turboCooldown = 0;
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
    let throttle = clamp(controls.throttle || 0, 0, 1);
    let brake = clamp(controls.brake || 0, 0, 1);
    let steer = clamp(controls.steer || 0, -1, 1);

    this.turboJustActivated = false;
    this.turboJustEnded = false;
    this.justLanded = false;

    if (this.turboCooldown > 0) {
      this.turboCooldown = Math.max(0, this.turboCooldown - dt);
    }

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
    if (this.projectileGrace > 0) {
      this.projectileGrace = Math.max(0, this.projectileGrace - dt);
    }

    // Aturdimiento: el control se reduce al principio y vuelve de forma
    // progresiva. El kart nunca se congela: conserva inercia y algo de volante.
    let stunRatio = 0;
    if (this.stunTime > 0 && this.stunDuration > 0) {
      stunRatio = clamp(this.stunTime / this.stunDuration, 0, 1);
      this.stunPhase += dt * (6 + stunRatio * 7);
      this.stunTime = Math.max(0, this.stunTime - dt);
      if (this.stunTime === 0) {
        this.stunDuration = 0;
        this.stunImmunity = CONFIG.stun.immunity;
      } else {
        const control = 1 - CONFIG.stun.controlLoss * stunRatio;
        steer *= control;
        throttle *= 1 - CONFIG.stun.throttleLoss * stunRatio;
        brake *= 1 - CONFIG.stun.throttleLoss * 0.6 * stunRatio;
      }
    } else if (this.stunImmunity > 0) {
      this.stunImmunity = Math.max(0, this.stunImmunity - dt);
    }
    if (this.landingTime > 0) this.landingTime = Math.max(0, this.landingTime - dt);

    // Física vertical: el kart mantiene su inercia horizontal, pero cae con
    // gravedad propia. El control y la tracción se reducen en el aire.
    if (this.airborne) {
      this.airTime += dt;
      this.verticalVelocity -= CONFIG.air.gravity * dt;
      this.height += this.verticalVelocity * dt;
      this.rampHeight = 0;
      if (this.height <= 0) this.landFromAir();
    } else if (this.rampHeight > 0) {
      this.height = this.rampHeight;
    } else {
      this.height = 0;
    }

    const traction = this.airborne ? CONFIG.air.traction : 1;

    // Derrape: solo empieza con velocidad, asfalto y giro real.
    const driftHeld = Boolean(controls.drift);
    if (!driftHeld) {
      if (this.driftActive) this.finishDrift(true);
      this.driftLock = false;
    } else if (
      !this.driftActive &&
      !this.driftLock &&
      !this.airborne &&
      !this.turboActive &&
      this.turboCooldown <= 0 &&
      this.stunTime <= 0 &&
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
      } else if (
        !this.wallContact &&
        !this.turboActive &&
        this.turboCooldown <= 0 &&
        this.stunTime <= 0 &&
        this.speed > DRIFT.minSpeed * 0.75
      ) {
        // La carga exige girar de verdad y avanzar sobre el asfalto:
        // mantener ESPACIO en recta, parado o contra un muro no carga nada.
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
        this.speed = Math.max(0, this.speed - this.brakePower * brake * traction * dt);
      } else {
        this.speed = Math.max(
          -this.reverseMax,
          this.speed - KART.reverseAcceleration * brake * traction * dt,
        );
      }
    } else if (throttle > 0) {
      const boost = 1 + boostPower * 0.85;
      this.speed += this.acceleration * throttle * boost * traction * dt;
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
      (this.driftActive ? DRIFT.turnBoost : 1) *
      (this.airborne ? CONFIG.air.steerControl : 1);
    this.heading -= steer * turnRate * Math.sign(this.speed || 1) * dt;

    // Un impacto desestabiliza el morro durante unos instantes, sin invertir el control.
    if (this.impactTime > 0 && this.impactDuration > 0) {
      const impactRatio = this.impactTime / this.impactDuration;
      const impactGrip = clamp(speedAbs / 8, 0, 1);
      this.heading += this.impactSteer * impactRatio * impactGrip * dt * 1.8;
    }

    // El aturdimiento añade un vaivén de dirección que se apaga con la recuperación.
    if (this.stunTime > 0 && stunRatio > 0) {
      const wobbleGrip = clamp(speedAbs / 10, 0, 1);
      this.heading +=
        Math.sin(this.stunPhase) * CONFIG.stun.wobble * stunRatio * wobbleGrip * dt;
    }

    // Movimiento dependiente del tiempo real. Durante el derrape la trayectoria
    // se abre respecto al morro, que apunta más cerrado hacia la curva.
    const moveHeading = this.heading + this.driftSlip * Math.sign(steer);
    this.position.x += Math.sin(moveHeading) * this.speed * dt;
    this.position.z += Math.cos(moveHeading) * this.speed * dt;

    // Proyección sobre el trazado: límites, césped y progreso.
    const projection = track.project(this.position, this.route ?? null, this.trackS);
    this.route = projection.routeId ?? null;
    this.lateral = projection.lateral;
    this.trackS = projection.s;
    this.groundY = projection.height ?? 0;
    const halfWidth = projection.halfWidth ?? track.halfWidth;
    const wallOffset = projection.wallOffset ?? track.wallOffset;
    this.onGrass = !this.airborne && Math.abs(this.lateral) > halfWidth;
    this.wallContact = false;

    const limit = wallOffset - KART.wallLimitExtra;
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
      this.onGrass = !this.airborne && Math.abs(clampedLateral) > halfWidth;
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

    this.group.position.set(this.position.x, this.groundY + 0.02 + this.height, this.position.z);
    this.group.rotation.y = this.heading;
  }

  updateProgress(track, raceTime) {
    const length = track.length;
    const previousS = this.lastTrackS;
    let delta = this.trackS - previousS;
    if (delta > length / 2) delta -= length;
    if (delta < -length / 2) delta += length;
    this.lastTrackS = this.trackS;

    const previousProgress = this.progress;
    this.progress += delta;

    if (this.finished) return;

    // Checkpoints: la `s` global avanza de forma monótona por cualquiera de
    // las rutas, así que una misma lista de controles valida los dos caminos.
    const checkpoints = Array.isArray(track.checkpoints) ? track.checkpoints : null;
    const wrap = (value) => {
      if (typeof track.wrapDelta === 'function') return track.wrapDelta(value);
      if (value > length / 2) return value - length;
      if (value < -length / 2) return value + length;
      return value;
    };
    if (checkpoints && checkpoints.length > 0 && delta > 0) {
      for (let i = 0; i < checkpoints.length; i += 1) {
        const ahead = wrap(checkpoints[i] - previousS);
        if (ahead > 0 && ahead <= delta + 1e-6) {
          this.checkpointMask |= 1 << i;
        }
      }
      let count = 0;
      for (let mask = this.checkpointMask; mask; mask >>= 1) count += mask & 1;
      this.checkpointCount = count;
    }

    // La primera vuelta empieza de verdad al cruzar la línea de salida.
    if (this.lapStartTime === null && this.progress >= 0) {
      this.lapStartTime = raceTime;
    }

    // Solo se concede una vuelta si se han cruzado todos los checkpoints.
    const lapBefore = Math.floor(previousProgress / length);
    const lapAfter = Math.floor(this.progress / length);
    if (lapAfter > lapBefore && lapAfter >= 1) {
      const required = checkpoints?.length ?? 0;
      const valid = required === 0 || this.checkpointCount >= required;
      if (valid) {
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
        }
      } else {
        // Vuelta inválida: se pierde, pero el kart conserva su posición.
        this.invalidLaps += 1;
      }
      this.checkpointMask = 0;
      this.checkpointCount = 0;
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

    // Balanceo de la carrocería y cabeceo al acelerar/frenar. Durante el
    // derrape la inclinación crece con el deslizamiento real.
    const driftLean = this.driftActive
      ? Math.min(1, Math.abs(this.driftSlip) / Math.max(0.001, DRIFT.slipMax))
      : 0;
    const targetRoll = -this.steerVisual * (0.09 + driftLean * 0.085) * speedRatio;
    const acceleration = dt > 0 ? clamp((this.speed - previousSpeed) / dt, -45, 30) : 0;
    const targetPitch = -acceleration * 0.0022;
    this.roll = damp(this.roll, targetRoll, 7, dt);
    this.pitch = damp(this.pitch, targetPitch, 7, dt);

    this.bobTime += dt * (3 + speedAbs * 0.25);
    const roughness = this.onGrass ? 0.045 : 0.012;
    const bob = this.airborne
      ? 0
      : Math.sin(this.bobTime) * roughness * (0.35 + speedRatio);

    // Sacudida de impacto: breve, lateral y decreciente; no altera la física.
    const impactRatio =
      this.impactTime > 0 && this.impactDuration > 0
        ? clamp(this.impactTime / this.impactDuration, 0, 1)
        : 0;
    const jolt = impactRatio * impactRatio;

    this.model.rotation.z = this.roll + this.impactSteer * jolt * 0.34;
    this.model.rotation.x =
      this.pitch + (this.airborne ? -this.verticalVelocity * 0.012 : 0) - jolt * 0.1;
    this.model.position.y = bob + Math.sin(this.bobTime * 7) * jolt * 0.05;
    this.model.position.x =
      Math.sin(this.bobTime * 0.5) * (this.onGrass ? 0.035 : 0.008) +
      Math.sin(this.bobTime * 11) * jolt * 0.07;

    // Aterrizaje: compresión breve y elástica.
    const squash = this.landingTime > 0
      ? Math.sin((this.landingTime / 0.26) * Math.PI) * 0.075
      : 0;
    this.model.scale.set(1 + squash * 0.55, 1 - squash, 1 + squash * 0.55);

    // La sombra de contacto se queda en el suelo aunque el kart salte.
    if (this.shadow) {
      this.shadow.position.y = -0.008 - this.height;
      const airFade = clamp(1 - this.height / 5.5, 0.3, 1);
      const spread = 1 + this.height * 0.03;
      this.shadow.scale.set(
        this.shadowBaseScale.x * spread,
        this.shadowBaseScale.y * spread,
        1,
      );
      this.shadowMaterial.opacity = 0.16 * airFade;
    }

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
      else this.turboMaterial.color.setHex(0x5fe6ff);

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

    // Estrellas y balanceo de aturdimiento: comunicación visual clara y barata.
    if (this.stunStars) {
      const stunActive = this.stunTime > 0 && this.stunDuration > 0;
      this.stunStars.visible = stunActive;
      if (stunActive) {
        const ratio = clamp(this.stunTime / this.stunDuration, 0, 1);
        this.stunStars.rotation.y += dt * (3.5 + ratio * 5);
        this.stunStars.position.y =
          CONFIG.stun.starHeight + Math.sin(this.bobTime * 5) * 0.05;
        for (const star of this.stunStars.children) {
          star.rotation.z += dt * 5;
          star.scale.setScalar(0.75 + ratio * 0.5);
        }
        this.stunMaterial.opacity = 0.35 + ratio * 0.5;
        this.model.rotation.y = Math.sin(this.stunPhase * 0.75) * 0.16 * ratio;
      } else {
        this.stunMaterial.opacity = 0;
        this.model.rotation.y = damp(this.model.rotation.y, jolt * this.impactSteer * 0.3, 9, dt);
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
