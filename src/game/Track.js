// Circuito cerrado construido a partir de una curva Catmull-Rom.
// La física, las vueltas, la clasificación y la IA son compartidas: cada mapa
// solo aporta su trazado, anchura, ambiente y decoración.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getMap } from './maps.js';
import { mulberry32, clamp } from './utils.js';
import {
  createAsphaltBumpTexture,
  createAsphaltTexture,
  createBannerTexture,
  createBoostPadTexture,
  createBrakingBoardTexture,
  createBuildingTexture,
  createCheckerTexture,
  createCityGroundTexture,
  createDirtTexture,
  createEnergyFieldTexture,
  createGrassTexture,
  createHazardTexture,
  createSandTexture,
  createSignTexture,
  createStripeTexture,
} from './textures.js';

const SEGMENTS = 720;

export class Track {
  constructor(map = null) {
    this.map = map && map.controlPoints ? map : getMap('coast');
    this.group = new THREE.Group();
    this.group.name = `circuito-${this.map.id}`;
    this.halfWidth = this.map.roadWidth / 2;
    this.shoulderWidth = this.map.shoulderWidth;
    this.wallOffset = this.halfWidth + this.shoulderWidth;
    this.curbWidth = 1.35;
    this.samples = [];

    this.curve = new THREE.CatmullRomCurve3(
      this.map.controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    );
    this.curve.arcLengthDivisions = 2000;
    this.length = this.curve.getLength();
    this.segmentLength = this.length / SEGMENTS;
    this.startS = this.map.startS ?? 24;

    this.buildSamples();
    this.buildCurvature();
    this.bounds = this.computeBounds();
    this.build();
  }

  /**
   * Curvatura de la línea central. Se mide el giro entre dos tangentes
   * separadas ~12 m para que la IA no reaccione al ruido de la spline.
   * κ = Δθ / Δs (1/m); en recta vale 0.
   */
  buildCurvature() {
    const N = this.samples.length;
    const w = 6;
    this.curvature = new Float32Array(N);
    for (let i = 0; i < N; i += 1) {
      const a = this.samples[(i - w + N) % N].tangent;
      const b = this.samples[(i + w) % N].tangent;
      const cross = a.x * b.z - a.z * b.x;
      const dot = a.x * b.x + a.z * b.z;
      const angle = Math.atan2(cross, dot);
      this.curvature[i] = Math.abs(angle) / (2 * w * this.segmentLength);
    }
  }

  /** Curvatura en la distancia `s` (consulta barata, sin búsqueda binaria). */
  curvatureAt(s) {
    const N = this.samples.length;
    const wrapped = ((s % this.length) + this.length) % this.length;
    return this.curvature[Math.floor((wrapped / this.length) * N) % N];
  }

  // ---------------------------------------------------------------------------
  // Muestreo y consultas sobre la pista
  // ---------------------------------------------------------------------------

  buildSamples() {
    for (let i = 0; i < SEGMENTS; i += 1) {
      const u = i / SEGMENTS;
      const point = this.curve.getPointAt(u);
      const tangent = this.curve.getTangentAt(u);
      tangent.y = 0;
      tangent.normalize();
      this.samples.push({
        point,
        tangent,
        side: new THREE.Vector3(-tangent.z, 0, tangent.x),
        s: u * this.length,
      });
    }
  }

  computeBounds() {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const sample of this.samples) {
      minX = Math.min(minX, sample.point.x);
      maxX = Math.max(maxX, sample.point.x);
      minZ = Math.min(minZ, sample.point.z);
      maxZ = Math.max(maxZ, sample.point.z);
    }
    return { minX, maxX, minZ, maxZ, centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2 };
  }

  /**
   * Proyecta una posición sobre la línea central.
   * Devuelve la distancia lateral con signo, el punto central y la tangente.
   */
  project(position) {
    const N = this.samples.length;
    let bestDist2 = Infinity;
    let best = null;

    for (let i = 0; i < N; i += 1) {
      const a = this.samples[i].point;
      const b = this.samples[(i + 1) % N].point;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const apx = position.x - a.x;
      const apz = position.z - a.z;
      const len2 = abx * abx + abz * abz;
      let t = len2 > 0 ? (apx * abx + apz * abz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = a.x + abx * t;
      const cz = a.z + abz * t;
      const dx = position.x - cx;
      const dz = position.z - cz;
      const dist2 = dx * dx + dz * dz;

      if (dist2 < bestDist2) {
        bestDist2 = dist2;
        const inv = 1 / (Math.sqrt(len2) || 1);
        const tx = abx * inv;
        const tz = abz * inv;
        best = {
          index: i,
          t,
          centerX: cx,
          centerZ: cz,
          tx,
          tz,
          sx: -tz,
          sz: tx,
          lateral: dx * -tz + dz * tx,
          s: (this.samples[i].s + t * this.segmentLength) % this.length,
          distance: Math.sqrt(dist2),
        };
      }
    }

    return best;
  }

  /** Punto, tangente y lado en una distancia de arco concreta. */
  frameAt(s) {
    const N = this.samples.length;
    // Blindaje: una distancia no finita (estado transitorio, reubicación
    // manual o un valor pendiente de reiniciar) no debe romper el bucle de
    // render. En ese caso se usa el inicio del trazado.
    const safeS = Number.isFinite(s) ? s : 0;
    const wrapped = ((safeS % this.length) + this.length) % this.length;
    const f = (wrapped / this.length) * N;
    const i = ((Math.floor(f) % N) + N) % N;
    const t = f - Math.floor(f);
    const a = this.samples[i];
    const b = this.samples[(i + 1) % N];

    const point = new THREE.Vector3().lerpVectors(a.point, b.point, t);
    const tangent = new THREE.Vector3().lerpVectors(a.tangent, b.tangent, t).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    return { point, tangent, side };
  }

  posAt(s, lateral = 0) {
    const frame = this.frameAt(s);
    return frame.point.clone().addScaledVector(frame.side, lateral);
  }

  headingAt(s) {
    const tangent = this.frameAt(s).tangent;
    return Math.atan2(tangent.x, tangent.z);
  }

  // ---------------------------------------------------------------------------
  // Construcción de la geometría
  // ---------------------------------------------------------------------------

  build() {
    this.buildGround();
    this.buildRoad();
    this.buildRoadDetails();
    this.buildSkidMarks();
    this.buildBrakingBoards();
    this.buildWalls();
    this.buildStartLine();
    this.buildArch();
    this.buildScenery();
    this.buildTracksideDetails();
    this.buildFeatures();
  }

  buildGround() {
    const kind = this.map.ground?.texture ?? 'grass';
    let texture;
    let name = 'cesped';
    if (kind === 'sand') {
      texture = createSandTexture();
      texture.repeat.set(52, 52);
      name = 'arena';
    } else if (kind === 'city') {
      texture = createCityGroundTexture();
      texture.repeat.set(46, 46);
      name = 'suelo-urbano';
    } else {
      texture = createGrassTexture();
      texture.repeat.set(90, 90);
      name = 'cesped';
    }

    this.groundMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 1,
      metalness: 0,
    });
    const size = this.map.ground?.size ?? 1600;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    ground.name = name;
    this.group.add(ground);

    // Arcén de tierra compactada entre el piano y el muro: separa visualmente
    // la pista del terreno y da contraste justo donde el kart se sale.
    const dirt = createDirtTexture();
    dirt.repeat.set(3, 26);
    this.dirtTexture = dirt;
    this.shoulderMaterial = new THREE.MeshStandardMaterial({
      map: dirt,
      color: this.shoulderTint(kind),
      roughness: 1,
      metalness: 0,
    });
    const inner = this.halfWidth + this.curbWidth;
    const outer = this.wallOffset;
    for (const sign of [-1, 1]) {
      const a = sign > 0 ? inner : -outer;
      const b = sign > 0 ? outer : -inner;
      const verge = new THREE.Mesh(
        this.createHorizontalRibbon(a, b, 0.008, 'length', 22),
        this.shoulderMaterial,
      );
      verge.receiveShadow = true;
      verge.name = 'arcen';
      this.group.add(verge);
    }

    // Sombra de contacto al pie del muro: asienta las defensas en el suelo.
    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.wallShadowMaterial = shadowMaterial;
    for (const sign of [-1, 1]) {
      const a = sign > 0 ? this.wallOffset - 0.75 : -this.wallOffset - 1.15;
      const b = sign > 0 ? this.wallOffset + 1.15 : -this.wallOffset + 0.75;
      const strip = new THREE.Mesh(
        this.createHorizontalRibbon(a, b, 0.014, 'length', 12),
        shadowMaterial,
      );
      strip.renderOrder = 1;
      this.group.add(strip);
    }
  }

  /** Color del arcén según el terreno de cada circuito. */
  shoulderTint(kind) {
    if (kind === 'sand') return 0xc8a86c;
    if (kind === 'city') return 0x333b52;
    if (this.map.scenery === 'canyon') return 0xa06b3c;
    if (this.map.scenery === 'mountain') return 0x7d6f52;
    return 0x9b8a66;
  }

  buildRoad() {
    const asphalt = createAsphaltTexture();
    const bump = createAsphaltBumpTexture();
    this.asphaltTexture = asphalt;
    this.asphaltBump = bump;
    this.roadMaterial = new THREE.MeshStandardMaterial({
      map: asphalt,
      bumpMap: bump,
      bumpScale: 0.045,
      roughness: 0.94,
      metalness: 0.02,
    });
    const geometry = this.createHorizontalRibbon(-this.halfWidth, this.halfWidth, 0.02, 'length', 9);
    const road = new THREE.Mesh(geometry, this.roadMaterial);
    road.receiveShadow = true;
    road.name = 'asfalto';
    this.group.add(road);
  }

  buildRoadDetails() {
    this.whiteMaterial = new THREE.MeshStandardMaterial({
      color: 0xf7f5eb,
      roughness: 0.7,
      metalness: 0,
      emissive: 0x2a2a26,
      emissiveIntensity: 0.12,
    });

    // Líneas blancas continuas en los bordes.
    const lineInner = this.halfWidth - 0.62;
    const lineOuter = this.halfWidth - 0.2;
    for (const sign of [-1, 1]) {
      const a = sign > 0 ? lineInner : -lineOuter;
      const b = sign > 0 ? lineOuter : -lineInner;
      const mesh = new THREE.Mesh(this.createHorizontalRibbon(a, b, 0.04, 'length', 10), this.whiteMaterial);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    // Goma acumulada junto a la línea: rompe el gris plano del asfalto.
    this.rubberMaterial = new THREE.MeshBasicMaterial({
      color: 0x101319,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    for (const sign of [-1, 1]) {
      const a = sign > 0 ? this.halfWidth - 1.75 : -this.halfWidth + 0.75;
      const b = sign > 0 ? this.halfWidth - 0.75 : -this.halfWidth + 1.75;
      const strip = new THREE.Mesh(
        this.createHorizontalRibbon(a, b, 0.043, 'length', 14),
        this.rubberMaterial,
      );
      strip.renderOrder = 1;
      this.group.add(strip);
    }

    // Pianos con los colores del circuito, justo fuera del asfalto.
    const [curbA, curbB] = this.map.curb ?? ['#ef3f3f', '#f7f4ec'];
    this.curbColors = [curbA, curbB];
    this.stripeTexture = createStripeTexture(curbA, curbB);
    this.stripeMaterial = new THREE.MeshStandardMaterial({
      map: this.stripeTexture,
      roughness: 0.72,
      metalness: 0.03,
      side: THREE.DoubleSide,
    });
    const curbWidth = this.curbWidth;
    for (const sign of [-1, 1]) {
      const a = sign > 0 ? this.halfWidth : -this.halfWidth - curbWidth;
      const b = sign > 0 ? this.halfWidth + curbWidth : -this.halfWidth;
      const curb = new THREE.Mesh(this.createHorizontalRibbon(a, b, 0.035, 'stripes', 6), this.stripeMaterial);
      curb.receiveShadow = true;
      this.group.add(curb);

      // Canto exterior del piano: un pequeño relieve de 9 cm que lo separa
      // del arcén. Es puramente visual, no modifica la física.
      const outer = sign * (this.halfWidth + curbWidth);
      const riser = new THREE.Mesh(
        this.createVerticalRibbon(outer, 0.09, 'stripes', 6),
        this.stripeMaterial,
      );
      riser.name = 'canto-piano';
      this.group.add(riser);

      // Junta oscura entre asfalto y piano.
      const aSeam = sign > 0 ? this.halfWidth - 0.09 : -this.halfWidth - 0.03;
      const bSeam = sign > 0 ? this.halfWidth + 0.03 : -this.halfWidth + 0.09;
      const seam = new THREE.Mesh(
        this.createHorizontalRibbon(aSeam, bSeam, 0.041, 'length', 8),
        this.rubberMaterial,
      );
      seam.renderOrder = 1;
      this.group.add(seam);
    }
  }

  /**
   * Detecta las curvas más cerradas del trazado. Devuelve la distancia, el
   * ángulo girado y el lado exterior (donde se colocan las señales).
   */
  findCorners(max = 6) {
    const N = this.samples.length;
    const window = 16;
    const candidates = [];
    for (let i = 0; i < N; i += 3) {
      const a = this.samples[(i - window + N) % N].tangent;
      const b = this.samples[(i + window) % N].tangent;
      const angle = Math.acos(clamp(a.dot(b), -1, 1));
      if (angle < 0.34) continue;
      const cross = a.z * b.x - a.x * b.z;
      candidates.push({
        s: this.samples[i].s,
        angle,
        side: cross >= 0 ? 1 : -1,
      });
    }

    candidates.sort((a, b) => b.angle - a.angle);
    const chosen = [];
    for (const corner of candidates) {
      if (chosen.length >= max) break;
      if (chosen.some((other) => Math.abs(this.wrapDelta(other.s - corner.s)) < 85)) continue;
      chosen.push(corner);
    }
    return chosen;
  }

  /** Marcas de frenada y derrape en la entrada de las curvas. */
  buildSkidMarks() {
    const corners = this.findCorners(6);
    if (corners.length === 0) return;

    const positions = [];
    const uvs = [];
    const indices = [];
    const lanes = [-this.halfWidth * 0.44, this.halfWidth * 0.44];

    for (const corner of corners) {
      const length = 12 + Math.min(12, corner.angle * 18);
      const start = corner.s - length - 14;
      for (const lane of lanes) {
        this.addSkidStreak(
          positions,
          uvs,
          indices,
          start,
          start + length,
          lane * 1.12,
          lane * 0.78,
          0.3,
        );
      }
    }

    if (indices.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
      color: 0x0b0e13,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'marcas-de-frenada';
    mesh.renderOrder = 1;
    this.group.add(mesh);
  }

  addSkidStreak(positions, uvs, indices, s0, s1, lateralA, lateralB, width) {
    const steps = Math.max(3, Math.ceil(Math.abs(s1 - s0) / 2.4));
    const base = positions.length / 3;
    const half = width / 2;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const s = s0 + (s1 - s0) * t;
      const lateral = lateralA + (lateralB - lateralA) * t;
      const frame = this.frameAt(s);
      const ax = frame.point.x + frame.side.x * (lateral - half);
      const az = frame.point.z + frame.side.z * (lateral - half);
      const bx = frame.point.x + frame.side.x * (lateral + half);
      const bz = frame.point.z + frame.side.z * (lateral + half);
      positions.push(ax, 0.044, az, bx, 0.044, bz);
      const v = t * 3;
      uvs.push(0, v, 1, v);
    }
    for (let i = 0; i < steps; i += 1) {
      const a = base + i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  /** Paneles de frenada (3-2-1) antes de las curvas más cerradas. */
  buildBrakingBoards() {
    const corners = this.findCorners(4);
    if (corners.length === 0) return;

    const numbers = [3, 2, 1];
    const textures = numbers.map((number) => createBrakingBoardTexture(number));
    const panelMaterials = textures.map(
      (texture) =>
        new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.6,
          metalness: 0.05,
          emissive: 0x1a2030,
          emissiveIntensity: 0.25,
          side: THREE.DoubleSide,
        }),
    );
    const backMaterial = new THREE.MeshStandardMaterial({
      map: createHazardTexture(),
      roughness: 0.78,
      metalness: 0.04,
      emissive: 0x2a2410,
      emissiveIntensity: 0.3,
    });
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x39435c, roughness: 0.72, metalness: 0.2 });
    const panelGeometry = new THREE.PlaneGeometry(1.5, 1.5);
    const backGeometry = new THREE.BoxGeometry(1.64, 1.64, 0.1);
    const postGeometry = new THREE.CylinderGeometry(0.075, 0.095, 2.55, 8);

    for (const corner of corners) {
      for (let i = 0; i < numbers.length; i += 1) {
        const s = corner.s - 42 + i * 15;
        const frame = this.frameAt(s);
        const lateral = corner.side * (this.wallOffset + 2.3);
        const x = frame.point.x + frame.side.x * lateral;
        const z = frame.point.z + frame.side.z * lateral;
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        group.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z) + Math.PI;

        const post = new THREE.Mesh(postGeometry, postMaterial);
        post.position.y = 1.28;
        post.castShadow = true;
        group.add(post);

        const back = new THREE.Mesh(backGeometry, backMaterial);
        back.position.set(0, 2.5, -0.06);
        back.castShadow = true;
        group.add(back);

        const panel = new THREE.Mesh(panelGeometry, panelMaterials[i]);
        panel.position.set(0, 2.5, 0.02);
        group.add(panel);

        this.group.add(group);
      }
    }
  }

  /** Detalles comunes en los seis circuitos: neumáticos, banderas y balizas. */
  buildTracksideDetails() {
    const corners = this.findCorners(8);

    // Pilas de neumáticos en el exterior de las curvas, siempre tras el muro.
    if (corners.length > 0) {
      const tireGeometry = new THREE.TorusGeometry(0.52, 0.19, 7, 14);
      const tireMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.94,
        metalness: 0.02,
      });
      const perStack = 3;
      const stacks = [];
      for (const corner of corners) {
        for (const extra of [0, 2.4]) {
          const s = corner.s - 16 + extra;
          const lateral = corner.side * (this.wallOffset + 2.5 + extra * 0.4);
          stacks.push({ s, lateral });
        }
      }
      const tires = new THREE.InstancedMesh(tireGeometry, tireMaterial, stacks.length * perStack);
      tires.name = 'pilas-de-neumaticos';
      tires.castShadow = true;
      tires.receiveShadow = true;
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      const scale = new THREE.Vector3(1, 1, 1);
      const color = new THREE.Color();
      let index = 0;
      for (const stack of stacks) {
        const frame = this.frameAt(stack.s);
        const x = frame.point.x + frame.side.x * stack.lateral;
        const z = frame.point.z + frame.side.z * stack.lateral;
        for (let level = 0; level < perStack; level += 1) {
          const position = new THREE.Vector3(x, 0.24 + level * 0.36, z);
          matrix.compose(position, quaternion, scale);
          tires.setMatrixAt(index, matrix);
          const shade = 0.1 + level * 0.025;
          color.setRGB(shade, shade + 0.005, shade + 0.015);
          tires.setColorAt(index, color);
          index += 1;
        }
      }
      tires.instanceMatrix.needsUpdate = true;
      if (tires.instanceColor) tires.instanceColor.needsUpdate = true;
      this.group.add(tires);
    }

    // Banderas de circuito: dan referencia de velocidad y color a los arcenes.
    const spacing = 54;
    const flagCount = Math.max(2, Math.floor(this.length / spacing));
    const poleGeometry = new THREE.CylinderGeometry(0.055, 0.07, 3.1, 6);
    const poleMaterial = new THREE.MeshStandardMaterial({
      color: 0xb9c2d4,
      roughness: 0.45,
      metalness: 0.35,
    });
    const flagGeometry = new THREE.PlaneGeometry(1.7, 0.9);
    const flagMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.65,
      metalness: 0,
      side: THREE.DoubleSide,
      emissive: 0x101010,
      emissiveIntensity: 0.2,
    });
    const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, flagCount * 2);
    const flags = new THREE.InstancedMesh(flagGeometry, flagMaterial, flagCount * 2);
    poles.name = 'postes-de-bandera';
    flags.name = 'banderas';
    poles.castShadow = true;
    const accent = new THREE.Color(this.map.accent ?? '#5fe6ff');
    const white = new THREE.Color(0xf1f3f7);
    const matrix = new THREE.Matrix4();
    const flagQuat = new THREE.Quaternion();
    const euler = new THREE.Euler(0, 0, 0);
    const scale = new THREE.Vector3(1, 1, 1);
    let index = 0;
    for (let i = 0; i < flagCount; i += 1) {
      const s = (i / flagCount) * this.length + 9;
      const frame = this.frameAt(s);
      const heading = Math.atan2(frame.tangent.x, frame.tangent.z);
      for (const sign of [-1, 1]) {
        const lateral = sign * (this.wallOffset + 1.7);
        const x = frame.point.x + frame.side.x * lateral;
        const z = frame.point.z + frame.side.z * lateral;
        matrix.compose(new THREE.Vector3(x, 1.55, z), new THREE.Quaternion(), scale);
        poles.setMatrixAt(index, matrix);

        euler.set(0, heading, 0);
        flagQuat.setFromEuler(euler);
        const fx = x + frame.side.x * sign * 0.95;
        const fz = z + frame.side.z * sign * 0.95;
        matrix.compose(new THREE.Vector3(fx, 2.55, fz), flagQuat, scale);
        flags.setMatrixAt(index, matrix);
        const color = (Math.floor(i / 2) + (sign > 0 ? 0 : 1)) % 3 === 0 ? white : accent;
        flags.setColorAt(index, color);
        index += 1;
      }
    }
    poles.instanceMatrix.needsUpdate = true;
    flags.instanceMatrix.needsUpdate = true;
    if (flags.instanceColor) flags.instanceColor.needsUpdate = true;
    this.group.add(poles, flags);
  }


  buildWalls() {
    const isCity = this.map.scenery === 'city';
    this.wallMaterial = new THREE.MeshStandardMaterial({
      map: this.stripeTexture,
      roughness: 0.75,
      side: THREE.DoubleSide,
      emissive: isCity ? 0x2a1466 : 0x000000,
      emissiveIntensity: isCity ? 0.35 : 0,
    });
    this.wallCapMaterial = new THREE.MeshStandardMaterial({
      color: isCity ? 0x2a3350 : 0xf5f3e9,
      roughness: 0.8,
    });

    for (const sign of [-1, 1]) {
      const offset = this.wallOffset * sign;
      const face = new THREE.Mesh(
        this.createVerticalRibbon(offset, CONFIG.wallHeight, 'stripes', 6),
        this.wallMaterial,
      );
      face.receiveShadow = true;
      this.group.add(face);

      // Remate superior del muro.
      const cap = new THREE.Mesh(
        this.createHorizontalRibbon(offset, offset + sign * 0.55, CONFIG.wallHeight, 'stripes', 6),
        this.wallCapMaterial,
      );
      cap.receiveShadow = true;
      this.group.add(cap);
    }

    // Postes de sujeción: ritmo visual y profundidad sin coste de draw calls.
    const spacing = 18;
    const count = Math.max(4, Math.floor(this.length / spacing));
    const postGeometry = new THREE.BoxGeometry(0.18, CONFIG.wallHeight + 0.46, 0.18);
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0x2c3446,
      roughness: 0.55,
      metalness: 0.28,
    });
    const posts = new THREE.InstancedMesh(postGeometry, postMaterial, count * 2);
    posts.name = 'postes-del-muro';
    posts.castShadow = true;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const night = isCity || this.map.scenery === 'neon' || this.map.scenery === 'orbital';
    const reflectors = night
      ? new THREE.InstancedMesh(
          new THREE.BoxGeometry(0.14, 0.12, 0.14),
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(this.map.accent ?? '#5fe6ff'),
            toneMapped: false,
          }),
          count * 2,
        )
      : null;
    if (reflectors) reflectors.name = 'balizas-del-muro';

    let index = 0;
    for (let i = 0; i < count; i += 1) {
      const s = (i / count) * this.length;
      const frame = this.frameAt(s);
      const heading = Math.atan2(frame.tangent.x, frame.tangent.z);
      quaternion.setFromEuler(new THREE.Euler(0, heading, 0));
      for (const sign of [-1, 1]) {
        const lateral = sign * (this.wallOffset + 0.09);
        const x = frame.point.x + frame.side.x * lateral;
        const z = frame.point.z + frame.side.z * lateral;
        matrix.compose(new THREE.Vector3(x, (CONFIG.wallHeight + 0.46) / 2, z), quaternion, scale);
        posts.setMatrixAt(index, matrix);
        if (reflectors) {
          matrix.compose(
            new THREE.Vector3(x, CONFIG.wallHeight + 0.4, z),
            quaternion,
            scale,
          );
          reflectors.setMatrixAt(index, matrix);
        }
        index += 1;
      }
    }
    posts.instanceMatrix.needsUpdate = true;
    this.group.add(posts);
    if (reflectors) {
      reflectors.instanceMatrix.needsUpdate = true;
      this.group.add(reflectors);
    }
  }

  buildStartLine() {
    const checker = createCheckerTexture();
    checker.wrapS = THREE.ClampToEdgeWrapping;
    checker.wrapT = THREE.ClampToEdgeWrapping;
    this.checkerMaterial = new THREE.MeshStandardMaterial({
      map: checker,
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    const positions = [];
    const uvs = [];
    const indices = [];
    const steps = 14;
    const halfLength = 2.6;

    for (let i = 0; i <= steps; i += 1) {
      const s = this.startS - halfLength + (i / steps) * halfLength * 2;
      const frame = this.frameAt(s);
      for (const offset of [-this.halfWidth, this.halfWidth]) {
        positions.push(
          frame.point.x + frame.side.x * offset,
          0.055,
          frame.point.z + frame.side.z * offset,
        );
      }
      const v = i / steps;
      uvs.push(0, v, 1, v);
    }

    for (let i = 0; i < steps; i += 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const finish = new THREE.Mesh(geometry, this.checkerMaterial);
    finish.receiveShadow = true;
    finish.name = 'linea-de-meta';
    this.group.add(finish);
  }

  buildArch() {
    const frame = this.frameAt(this.startS);
    const group = new THREE.Group();
    group.name = 'arco-de-meta';
    group.position.copy(frame.point);
    group.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);

    const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x172653, roughness: 0.6 });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.map.accent ?? '#ff8a2a'),
      roughness: 0.5,
    });
    const beamMaterial = new THREE.MeshStandardMaterial({ color: 0x101a38, roughness: 0.6 });

    const pillarX = this.halfWidth + 3.2;
    for (const sign of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 8.8, 1.1), pillarMaterial);
      pillar.position.set(sign * pillarX, 4.4, 0);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      group.add(pillar);

      const band = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.55, 1.25), accentMaterial);
      band.position.set(sign * pillarX, 1.1, 0);
      band.castShadow = true;
      group.add(band);
    }

    const beam = new THREE.Mesh(new THREE.BoxGeometry(pillarX * 2 + 1.2, 0.55, 1.25), beamMaterial);
    beam.position.set(0, 8.55, 0);
    beam.castShadow = true;
    group.add(beam);

    const bannerTexture = createBannerTexture();
    const night = this.map.scenery === 'city' || this.map.scenery === 'neon' || this.map.scenery === 'orbital';
    const bannerMaterial = new THREE.MeshStandardMaterial({
      map: bannerTexture,
      emissive: 0xffffff,
      emissiveMap: bannerTexture,
      emissiveIntensity: night ? 0.46 : 0.14,
      roughness: 0.7,
      metalness: 0,
    });
    const bannerGeometry = new THREE.PlaneGeometry(2 * pillarX - 1.5, 2.7);

    const bannerFront = new THREE.Mesh(bannerGeometry, bannerMaterial);
    bannerFront.position.set(0, 7.0, -0.03);
    bannerFront.rotation.y = Math.PI;
    group.add(bannerFront);

    const bannerBack = new THREE.Mesh(bannerGeometry, bannerMaterial);
    bannerBack.position.set(0, 7.0, 0.03);
    group.add(bannerBack);

    this.group.add(group);
  }

  buildScenery() {
    this.buildGrandstand();
    this.buildSigns();
    if (this.map.scenery === 'city' || this.map.scenery === 'neon') {
      this.buildCity();
      this.buildNeonStrips();
    } else if (this.map.scenery === 'mountain') {
      this.buildPines();
      this.buildMountains();
      this.buildLake();
      this.buildClouds();
    } else if (this.map.scenery === 'canyon') {
      this.buildCanyon();
      this.buildClouds();
    } else if (this.map.scenery === 'orbital') {
      this.buildCity();
      this.buildNeonStrips();
      this.buildOrbitalBackdrop();
    } else {
      this.buildPalms();
      this.buildSea();
      this.buildBeachDetails();
      this.buildClouds();
    }
  }

  // ---------------------------------------------------------------------------
  // Mecánicas de mapa: placas de turbo, rampas y obstáculos móviles
  // ---------------------------------------------------------------------------

  buildFeatures() {
    this.features = { boostPads: [], ramps: [], obstacles: [] };
    const config = this.map.features ?? {};
    const accent = new THREE.Color(this.map.accent ?? '#5fe6ff');

    const pads = config.boostPads ?? [];
    if (pads.length > 0) {
      this.boostTexture = createBoostPadTexture(this.map.accent ?? '#5fe6ff');
      // Mezcla normal: la placa se lee como pintura sobre el asfalto. Con
      // aditivo se lavaba en los circuitos claros (arena, nieve, cañón).
      this.boostMaterial = new THREE.MeshBasicMaterial({
        map: this.boostTexture,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      this.padGlowMaterial = new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      this.padRailMaterial = new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
    }
    pads.forEach((def, index) => this.buildBoostPad(def, index));

    const ramps = config.ramps ?? [];
    if (ramps.length > 0) {
      this.rampGlowMaterial = new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
    }
    ramps.forEach((def, index) => this.buildRamp(def, index, accent));

    const obstacles = config.obstacles ?? [];
    if (obstacles.some((def) => (def.kind ?? 'gate') === 'gate')) {
      this.energyTexture = createEnergyFieldTexture(this.map.accent ?? '#5fe6ff');
      this.energyTexture.repeat.set(1, 2.4);
      this.energyMaterial = new THREE.MeshBasicMaterial({
        map: this.energyTexture,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
    }
    obstacles.forEach((def, index) => this.buildObstacle(def, index, accent));
  }

  /** Coloca una placa de aceleración orientada con la pista. */
  buildBoostPad(def, index) {
    const s = this.wrapS(def.at * this.length);
    const frame = this.frameAt(s);
    const width = def.width ?? 4.8;
    const length = def.length ?? 10;
    const group = new THREE.Group();
    group.name = `turbo-${index}`;
    group.position.copy(frame.point).addScaledVector(frame.side, def.lateral ?? 0);
    group.position.y = 0.065;
    group.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, length), this.boostMaterial);
    plane.rotation.x = -Math.PI / 2;
    plane.renderOrder = 2;
    group.add(plane);

    // Halo exterior barato: da sensación de energía sin otra textura.
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 1.22, length * 1.1),
      this.padGlowMaterial,
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.012;
    halo.renderOrder = 1;
    group.add(halo);

    const railGeometry = new THREE.BoxGeometry(0.14, 0.1, length);
    for (const sign of [-1, 1]) {
      const rail = new THREE.Mesh(railGeometry, this.padRailMaterial);
      rail.position.set(sign * (width / 2 + 0.12), 0.035, 0);
      group.add(rail);
    }

    this.group.add(group);
    this.features.boostPads.push({
      id: `boost-${index}`,
      def,
      s,
      width,
      length,
      lateral: def.lateral ?? 0,
      group,
    });
  }

  /** Rampa en cuña con carril luminoso. La entrada está en -length/2. */
  buildRamp(def, index, accent) {
    const s = this.wrapS(def.at * this.length);
    const frame = this.frameAt(s);
    const width = def.width ?? 6;
    const length = def.length ?? 10;
    const height = def.height ?? 2.2;
    const group = new THREE.Group();
    group.name = `rampa-${index}`;
    group.position.copy(frame.point).addScaledVector(frame.side, def.lateral ?? 0);
    group.position.y = 0.03;
    group.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);

    const rampMaterial = new THREE.MeshStandardMaterial({
      color: 0x3c567e,
      roughness: 0.58,
      metalness: 0.28,
      emissive: accent,
      emissiveIntensity: 0.18,
    });
    const wedge = new THREE.Mesh(this.createRampGeometry(width, length, height), rampMaterial);
    wedge.castShadow = true;
    wedge.receiveShadow = true;
    group.add(wedge);

    const slope = -Math.atan2(height, length);

    // Superficie luminosa con chevrones: se lee como rampa desde la cámara.
    const deck = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.94, length * 0.96),
      this.boostMaterial ?? this.rampGlowMaterial,
    );
    deck.rotation.x = -Math.PI / 2 + slope;
    deck.position.y = height / 2 + 0.04;
    deck.renderOrder = 2;
    group.add(deck);
    const railGeometry = new THREE.BoxGeometry(0.15, 0.12, Math.hypot(length, height));
    for (const sign of [-1, 1]) {
      const rail = new THREE.Mesh(railGeometry, this.rampGlowMaterial);
      rail.position.set(sign * (width / 2 - 0.06), height / 2 + 0.07, 0);
      rail.rotation.x = slope;
      group.add(rail);
    }

    // Tres travesaños luminosos que marcan la subida.
    const stripGeometry = new THREE.BoxGeometry(width * 0.86, 0.045, 0.16);
    for (let i = 1; i <= 3; i += 1) {
      const progress = i / 4;
      const strip = new THREE.Mesh(stripGeometry, this.rampGlowMaterial);
      strip.position.set(0, height * progress + 0.07, -length / 2 + length * progress);
      strip.rotation.x = slope;
      group.add(strip);
    }

    this.group.add(group);
    this.features.ramps.push({
      id: `ramp-${index}`,
      def,
      s,
      width,
      length,
      height,
      lateral: def.lateral ?? 0,
      group,
    });
  }

  /** Obstáculo móvil: puerta de energía, roca o plataforma deslizante. */
  buildObstacle(def, index, accent) {
    const s = this.wrapS(def.at * this.length);
    const width = def.width ?? 3;
    const height = def.height ?? 2;
    const depth = def.depth ?? 2;
    const frame = this.frameAt(s);
    const group = new THREE.Group();
    group.name = `${def.kind}-${index}`;
    group.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);

    const shellMaterial = new THREE.MeshStandardMaterial({
      color: def.kind === 'boulder' ? 0x6f5a45 : 0x1a2440,
      roughness: def.kind === 'boulder' ? 0.95 : 0.45,
      metalness: def.kind === 'boulder' ? 0.05 : 0.45,
      emissive: accent,
      emissiveIntensity: def.kind === 'boulder' ? 0.05 : 0.12,
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });

    let spinMesh = null;
    if (def.kind === 'gate') {
      const postX = width / 2 + 0.35;
      const postGeometry = new THREE.BoxGeometry(0.3, height, 0.3);
      for (const sign of [-1, 1]) {
        const post = new THREE.Mesh(postGeometry, shellMaterial);
        post.position.set(sign * postX, height / 2, 0);
        post.castShadow = true;
        group.add(post);

        // Franja luminosa en la cara interior del poste.
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, height * 0.9, 0.34),
          glowMaterial,
        );
        strip.position.set(sign * (postX - 0.2), height * 0.47, 0);
        group.add(strip);

        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), glowMaterial);
        cap.position.set(sign * postX, height + 0.2, 0);
        group.add(cap);
      }

      const beam = new THREE.Mesh(new THREE.BoxGeometry(width + 1, 0.26, 0.3), shellMaterial);
      beam.position.y = height;
      group.add(beam);

      const beamGlow = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.8, 0.07, 0.35),
        glowMaterial,
      );
      beamGlow.position.y = height - 0.16;
      group.add(beamGlow);

      // Campo de energía con textura de barrido.
      const energy = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height * 0.9),
        this.energyMaterial ?? glowMaterial,
      );
      energy.position.y = height * 0.5 - 0.04;
      energy.renderOrder = 2;
      group.add(energy);

      for (const sign of [-1, 1]) {
        const edge = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, height * 0.9, 0.07),
          glowMaterial,
        );
        edge.position.set((sign * width) / 2, height * 0.47, 0);
        group.add(edge);
      }

      const line = new THREE.Mesh(new THREE.BoxGeometry(width, 0.035, 0.26), glowMaterial);
      line.position.y = 0.04;
      group.add(line);
    } else if (def.kind === 'boulder') {
      const radius = width / 2;
      spinMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), shellMaterial);
      spinMesh.position.y = radius;
      spinMesh.castShadow = true;
      group.add(spinMesh);

      // Franjas de peligro que giran con la roca.
      for (let i = 0; i < 3; i += 1) {
        const band = new THREE.Mesh(
          new THREE.TorusGeometry(radius * 1.0, 0.05, 5, 18),
          glowMaterial,
        );
        band.position.y = 0;
        band.rotation.x = Math.PI / 2;
        band.rotation.y = (i * Math.PI) / 3;
        band.rotation.z = (i - 1) * 0.5;
        spinMesh.add(band);
      }

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 1.16, 0.08, 6, 22),
        glowMaterial,
      );
      ring.position.y = radius;
      ring.rotation.x = Math.PI / 2;
      group.add(ring);

      // Sombra de contacto: asienta la roca en el asfalto.
      const contact = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 1.25, 18),
        new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        }),
      );
      contact.rotation.x = -Math.PI / 2;
      contact.position.y = 0.015;
      group.add(contact);
    } else {
      // Plataforma: bloque bajo que cruza la pista y obliga a trazar.
      const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), shellMaterial);
      body.position.y = height / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const top = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.9, depth * 0.9),
        glowMaterial,
      );
      top.rotation.x = -Math.PI / 2;
      top.position.y = height + 0.012;
      top.renderOrder = 2;
      group.add(top);

      // Esquinas luminosas: se ven de noche y desde cualquier ángulo.
      const cornerGeometry = new THREE.BoxGeometry(0.16, height, 0.16);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const corner = new THREE.Mesh(cornerGeometry, glowMaterial);
          corner.position.set(
            sx * (width / 2 - 0.08),
            height / 2,
            sz * (depth / 2 - 0.08),
          );
          group.add(corner);
        }
      }

      for (const sign of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, 0.12), glowMaterial);
        edge.position.set(0, height + 0.03, (sign * depth) / 2);
        group.add(edge);

        const side = new THREE.Mesh(
          new THREE.PlaneGeometry(width * 0.94, height * 0.55),
          glowMaterial,
        );
        side.position.set(0, height * 0.5, (sign * depth) / 2 + sign * 0.012);
        side.rotation.y = sign > 0 ? 0 : Math.PI;
        group.add(side);
      }
    }

    const obstacle = {
      id: `obs-${index}`,
      def,
      kind: def.kind ?? 'gate',
      s,
      width,
      height,
      depth,
      baseLateral: def.lateral ?? 0,
      lateral: def.lateral ?? 0,
      amplitude: def.amplitude ?? 0,
      speed: def.speed ?? 1,
      phase: def.phase ?? 0,
      group,
      glowMaterial,
      spinMesh,
    };

    this.positionObstacle(obstacle, 0);
    this.group.add(group);
    this.features.obstacles.push(obstacle);
  }

  positionObstacle(obstacle, time) {
    const lateral =
      obstacle.baseLateral +
      (obstacle.amplitude > 0 ? Math.sin(time * obstacle.speed + obstacle.phase) * obstacle.amplitude : 0);
    obstacle.lateral = lateral;
    const frame = this.frameAt(obstacle.s);
    obstacle.group.position.copy(frame.point).addScaledVector(frame.side, lateral);
    obstacle.group.position.y = 0.03;
    obstacle.group.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);
  }

  updateFeatures(dt, time) {
    if (!this.features) return;

    if (this.boostMaterial) {
      this.boostMaterial.opacity = 0.86 + Math.sin(time * 5.4) * 0.09;
    }
    if (this.padRailMaterial) {
      this.padRailMaterial.opacity = 0.58 + Math.sin(time * 5.4) * 0.22;
    }
    if (this.rampGlowMaterial) {
      this.rampGlowMaterial.opacity = 0.62 + Math.sin(time * 4.2) * 0.2;
    }
    if (this.energyMaterial) {
      this.energyTexture.offset.y = (-time * 0.55) % 1;
      this.energyMaterial.opacity = 0.74 + Math.sin(time * 6.4) * 0.12;
    }

    for (const obstacle of this.features.obstacles) {
      this.positionObstacle(obstacle, time);
      if (obstacle.spinMesh) {
        obstacle.spinMesh.rotation.x += dt * 0.7;
        obstacle.spinMesh.rotation.z += dt * 0.9;
      }
      if (obstacle.glowMaterial) {
        obstacle.glowMaterial.opacity =
          0.4 + Math.sin(time * 3.6 + obstacle.phase) * 0.16;
      }
    }
  }

  /** Devuelve la rampa que pisa el kart, con la altura correspondiente. */
  rampAt(kart) {
    if (!this.features) return null;
    for (const ramp of this.features.ramps) {
      const delta = this.wrapDelta(kart.trackS - ramp.s);
      if (Math.abs(delta) > ramp.length / 2) continue;
      if (Math.abs(kart.lateral - ramp.lateral) > ramp.width / 2) continue;
      const progress = clamp((delta + ramp.length / 2) / ramp.length, 0, 1);
      return { ramp, progress, height: ramp.height * progress };
    }
    return null;
  }

  wrapS(s) {
    return ((s % this.length) + this.length) % this.length;
  }

  wrapDelta(delta) {
    if (delta > this.length / 2) return delta - this.length;
    if (delta < -this.length / 2) return delta + this.length;
    return delta;
  }

  createRampGeometry(width, length, height) {
    const w = width / 2;
    const l = length / 2;
    const positions = [
      // Cara superior en pendiente.
      -w, 0, -l, w, height, l, w, 0, -l,
      -w, 0, -l, -w, height, l, w, height, l,
      // Trasera vertical.
      -w, 0, l, w, 0, l, w, height, l,
      -w, 0, l, w, height, l, -w, height, l,
      // Lateral izquierdo.
      -w, 0, -l, -w, 0, l, -w, height, l,
      // Lateral derecho.
      w, 0, -l, w, height, l, w, 0, l,
      // Base.
      -w, 0, -l, w, 0, l, -w, 0, l,
      -w, 0, -l, w, 0, -l, w, 0, l,
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  buildGrandstand() {
    const frame = this.frameAt(this.length - 46);
    const group = new THREE.Group();
    group.position.copy(frame.point).addScaledVector(frame.side, -31);
    group.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);

    const stepMaterials = [
      new THREE.MeshStandardMaterial({ color: 0xd9dde7, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0xb9c1d1, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0x9da8bd, roughness: 0.9 }),
    ];

    for (let row = 0; row < 3; row += 1) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0 + row, 34), stepMaterials[row]);
      step.position.set(row * 3.2, (1.0 + row) / 2, 0);
      step.castShadow = true;
      step.receiveShadow = true;
      group.add(step);
    }

    // Público: cubos de colores colocados con InstancedMesh.
    const colors = [0xff5c5c, 0xffd23f, 0x4dd4ff, 0xff8ae2, 0x8dff7a, 0xffffff];
    const crowd = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.75, 1.1, 0.75),
      new THREE.MeshStandardMaterial({ roughness: 0.8 }),
      60,
    );
    crowd.castShadow = true;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    let index = 0;
    for (let row = 0; row < 3 && index < 60; row += 1) {
      for (let i = 0; i < 20 && index < 60; i += 1) {
        const x = row * 3.2 + (i % 2 === 0 ? -0.35 : 0.35);
        const z = -16 + i * 1.6;
        const y = 1.0 + row + 0.75;
        matrix.makeTranslation(x, y, z);
        crowd.setMatrixAt(index, matrix);
        crowd.setColorAt(index, color.setHex(colors[index % colors.length]));
        index += 1;
      }
    }
    crowd.instanceMatrix.needsUpdate = true;
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    group.add(crowd);

    this.group.add(group);
  }

  buildSigns() {
    const signs = [
      { u: 0.14, side: 1, text: '¡TURBO!', sub: this.map.shortName ?? 'A FONDO' },
      { u: 0.36, side: -1, text: 'CURVA', sub: 'FRENA UN POCO' },
      { u: 0.6, side: 1, text: 'META', sub: 'QUEDAN 3 VUELTAS' },
      { u: 0.82, side: -1, text: '¡DALE!', sub: this.map.name ?? 'TURBO CIRCUIT' },
    ];

    for (const sign of signs) {
      const s = sign.u * this.length;
      let lateral = sign.side * (this.wallOffset + 5.2);
      let position = this.posAt(s, lateral);
      const projection = this.project(position);
      if (projection.distance < this.wallOffset + 3) {
        lateral = sign.side * (this.wallOffset + 8);
        position = this.posAt(s, lateral);
      }

      const frame = this.frameAt(s);
      const normal = frame.side.clone().multiplyScalar(-sign.side);
      const group = new THREE.Group();
      group.position.copy(position);
      group.rotation.y = Math.atan2(normal.x, normal.z);

      const postMaterial = new THREE.MeshStandardMaterial({ color: 0x2b3350, roughness: 0.7 });
      for (const x of [-3.1, 3.1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 4.2, 8), postMaterial);
        post.position.set(x, 2.1, 0);
        post.castShadow = true;
        group.add(post);
      }

      const back = new THREE.Mesh(
        new THREE.BoxGeometry(8.6, 4.0, 0.28),
        new THREE.MeshStandardMaterial({ color: 0x26304d, roughness: 0.8 }),
      );
      back.position.set(0, 4.1, 0);
      back.castShadow = true;
      group.add(back);

      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(8.2, 3.7),
        new THREE.MeshStandardMaterial({ map: createSignTexture(sign.text, sign.sub), roughness: 0.65 }),
      );
      panel.position.set(0, 4.1, 0.16);
      group.add(panel);

      this.group.add(group);
    }
  }

  // ---------------------------------------------------------------------------
  // Decoración: COSTA TROPICAL
  // ---------------------------------------------------------------------------

  buildPalms() {
    const rand = mulberry32(777);
    this.palmAssets = {
      trunkGeometry: new THREE.CylinderGeometry(0.18, 0.34, 5.2, 7),
      frondGeometry: new THREE.SphereGeometry(1, 7, 5),
      coconutGeometry: new THREE.SphereGeometry(0.18, 6, 5),
      trunkMaterial: new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 1, flatShading: true }),
      frondMaterials: [
        new THREE.MeshStandardMaterial({ color: 0x2f8f3c, roughness: 0.95, flatShading: true }),
        new THREE.MeshStandardMaterial({ color: 0x46a844, roughness: 0.95, flatShading: true }),
        new THREE.MeshStandardMaterial({ color: 0x1f7436, roughness: 0.95, flatShading: true }),
      ],
      coconutMaterial: new THREE.MeshStandardMaterial({ color: 0x5d3a1f, roughness: 1 }),
    };

    const step = 20;
    for (let i = 0; i < this.samples.length; i += step) {
      for (const sign of [-1, 1]) {
        const s = this.samples[i].s;
        // Deja libre la zona de la grada.
        if (sign === -1 && s > this.length - 62 && s < this.length - 4) continue;
        if (rand() > 0.62) continue;

        const lateral = sign * (this.wallOffset + 5.5 + rand() * 24);
        const position = this.posAt(s + (rand() - 0.5) * 8, lateral);
        if (this.project(position).distance < this.wallOffset + 4.5) continue;
        this.addPalm(position.x, position.z, 0.85 + rand() * 0.55, rand);
      }
    }

    // Rocas sueltas entre las palmeras.
    for (let i = 0; i < 16; i += 1) {
      const angle = rand() * Math.PI * 2;
      const radius = 45 + rand() * 75;
      const position = new THREE.Vector3(
        this.bounds.centerX + Math.cos(angle) * radius,
        0,
        this.bounds.centerZ + Math.sin(angle) * radius,
      );
      if (this.project(position).distance < this.wallOffset + 7) continue;
      this.addRock(position.x, position.z, 0.7 + rand() * 1.6, rand);
    }
  }

  addPalm(x, z, scale, rand) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.scale.setScalar(scale);
    group.rotation.y = rand() * Math.PI * 2;
    group.rotation.z = (rand() - 0.5) * 0.12;

    const trunk = new THREE.Mesh(this.palmAssets.trunkGeometry, this.palmAssets.trunkMaterial);
    trunk.position.y = 2.6;
    trunk.castShadow = true;
    group.add(trunk);

    const frondMaterial =
      this.palmAssets.frondMaterials[Math.floor(rand() * this.palmAssets.frondMaterials.length)];
    const fronds = 7;
    for (let i = 0; i < fronds; i += 1) {
      const frond = new THREE.Mesh(this.palmAssets.frondGeometry, frondMaterial);
      const angle = (i / fronds) * Math.PI * 2 + rand() * 0.25;
      frond.position.set(Math.cos(angle) * 1.25, 5.2, Math.sin(angle) * 1.25);
      frond.scale.set(2.6, 0.16, 0.72);
      frond.rotation.y = -angle;
      frond.rotation.z = -0.16 - rand() * 0.1;
      frond.castShadow = true;
      group.add(frond);
    }

    for (let i = 0; i < 3; i += 1) {
      const coconut = new THREE.Mesh(this.palmAssets.coconutGeometry, this.palmAssets.coconutMaterial);
      coconut.position.set((rand() - 0.5) * 0.5, 4.95, (rand() - 0.5) * 0.5);
      group.add(coconut);
    }

    this.group.add(group);
  }

  buildSea() {
    const foamMaterial = new THREE.MeshStandardMaterial({
      color: 0xe8fbff,
      roughness: 0.35,
      transparent: true,
      opacity: 0.82,
    });
    const seaMaterial = new THREE.MeshStandardMaterial({
      color: 0x2aa8d8,
      roughness: 0.16,
      metalness: 0.28,
    });
    const shoreX = this.bounds.maxX + this.wallOffset + 14;
    const depth = 1500;

    const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, depth), seaMaterial);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(shoreX + 450, 0.025, this.bounds.centerZ);
    sea.receiveShadow = true;
    sea.name = 'mar';
    this.group.add(sea);

    const foam = new THREE.Mesh(new THREE.PlaneGeometry(7, depth), foamMaterial);
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(shoreX - 1.4, 0.04, this.bounds.centerZ);
    this.group.add(foam);

    // Islas lejanas para cerrar el horizonte del agua.
    const islandMaterial = new THREE.MeshStandardMaterial({
      color: 0x5f8f72,
      roughness: 1,
      flatShading: true,
    });
    const rand = mulberry32(8585);
    for (let i = 0; i < 3; i += 1) {
      const island = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 6), islandMaterial);
      const width = 90 + rand() * 90;
      const height = 16 + rand() * 22;
      island.position.set(
        shoreX + 520 + rand() * 250,
        height / 2 - 1,
        this.bounds.centerZ + (rand() - 0.5) * 700,
      );
      island.scale.set(width, height, width);
      island.rotation.y = rand() * Math.PI;
      this.group.add(island);
    }

    // Velas lejanas: dan vida al mar sin coste de física ni luces.
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0xf2eee2, roughness: 0.55 });
    const mastMaterial = new THREE.MeshStandardMaterial({ color: 0x6c4b30, roughness: 0.9 });
    const sailMaterial = new THREE.MeshStandardMaterial({
      color: 0xfffaf0,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const sailGeometry = new THREE.BufferGeometry();
    sailGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 4.6, 0, 2.8, 0.5, 0], 3),
    );
    sailGeometry.computeVertexNormals();
    const hullGeometry = new THREE.BoxGeometry(5.4, 1.1, 2.1);
    const mastGeometry = new THREE.CylinderGeometry(0.07, 0.09, 5.2, 6);
    const boatRand = mulberry32(1717);
    for (let i = 0; i < 4; i += 1) {
      const boat = new THREE.Group();
      boat.position.set(
        shoreX + 110 + boatRand() * 220,
        0.25,
        this.bounds.centerZ + (boatRand() - 0.5) * 460,
      );
      boat.rotation.y = boatRand() * Math.PI * 2;
      const hull = new THREE.Mesh(hullGeometry, hullMaterial);
      hull.position.y = 0.2;
      boat.add(hull);
      const mast = new THREE.Mesh(mastGeometry, mastMaterial);
      mast.position.y = 3.1;
      boat.add(mast);
      const sail = new THREE.Mesh(sailGeometry, sailMaterial);
      sail.position.set(0, 1.3, 0.06);
      boat.add(sail);
      const sailBack = sail.clone();
      sailBack.position.z = -0.06;
      sailBack.rotation.y = Math.PI;
      boat.add(sailBack);
      this.group.add(boat);
    }
  }

  buildBeachDetails() {
    const rand = mulberry32(1212);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0xff6a5a, roughness: 0.75 });
    const canopyAltMaterial = new THREE.MeshStandardMaterial({ color: 0x3fe0ff, roughness: 0.75 });
    const shoreX = this.bounds.maxX + this.wallOffset + 18;

    for (let i = 0; i < 9; i += 1) {
      const z = this.bounds.centerZ + (rand() - 0.5) * 240;
      const x = shoreX + 6 + rand() * 55;
      const position = new THREE.Vector3(x, 0, z);
      if (this.project(position).distance < this.wallOffset + 9) continue;

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), poleMaterial);
      pole.position.set(x, 1.3, z);
      this.group.add(pole);

      const canopy = new THREE.Mesh(
        new THREE.ConeGeometry(2.1, 0.85, 10),
        rand() > 0.5 ? canopyMaterial : canopyAltMaterial,
      );
      canopy.position.set(x, 2.8, z);
      canopy.castShadow = true;
      this.group.add(canopy);
    }
  }

  // ---------------------------------------------------------------------------
  // Decoración: MONTAÑA
  // ---------------------------------------------------------------------------

  buildPines() {
    const rand = mulberry32(2424);
    this.pineAssets = {
      trunkGeometry: new THREE.CylinderGeometry(0.2, 0.34, 2.1, 7),
      coneGeometry: new THREE.ConeGeometry(1, 1, 7),
      trunkMaterial: new THREE.MeshStandardMaterial({ color: 0x5c3c22, roughness: 1 }),
      needleMaterials: [
        new THREE.MeshStandardMaterial({ color: 0x2c6b42, roughness: 0.95, flatShading: true }),
        new THREE.MeshStandardMaterial({ color: 0x357c4b, roughness: 0.95, flatShading: true }),
        new THREE.MeshStandardMaterial({ color: 0x235a3d, roughness: 0.95, flatShading: true }),
      ],
    };

    const step = 12;
    for (let i = 0; i < this.samples.length; i += step) {
      for (const sign of [-1, 1]) {
        const s = this.samples[i].s;
        if (sign === -1 && s > this.length - 62 && s < this.length - 4) continue;
        if (rand() > 0.55) continue;

        const lateral = sign * (this.wallOffset + 5 + rand() * 30);
        const position = this.posAt(s + (rand() - 0.5) * 8, lateral);
        if (this.project(position).distance < this.wallOffset + 4) continue;
        if (rand() > 0.82) this.addRock(position.x, position.z, 0.8 + rand() * 2.1, rand);
        else this.addPine(position.x, position.z, 0.8 + rand() * 0.75, rand);
      }
    }

    for (let i = 0; i < 22; i += 1) {
      const angle = rand() * Math.PI * 2;
      const radius = 45 + rand() * 95;
      const position = new THREE.Vector3(
        this.bounds.centerX + Math.cos(angle) * radius,
        0,
        this.bounds.centerZ + Math.sin(angle) * radius,
      );
      if (this.project(position).distance < this.wallOffset + 8) continue;
      if (rand() > 0.35) this.addPine(position.x, position.z, 0.9 + rand() * 0.9, rand);
      else this.addRock(position.x, position.z, 0.9 + rand() * 2.4, rand);
    }
  }

  addPine(x, z, scale, rand) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.scale.setScalar(scale);
    group.rotation.y = rand() * Math.PI * 2;

    const trunk = new THREE.Mesh(this.pineAssets.trunkGeometry, this.pineAssets.trunkMaterial);
    trunk.position.y = 1.05;
    trunk.castShadow = true;
    group.add(trunk);

    const material =
      this.pineAssets.needleMaterials[Math.floor(rand() * this.pineAssets.needleMaterials.length)];
    const layers = [
      { y: 2.45, w: 1.75, h: 2.5 },
      { y: 3.75, w: 1.35, h: 2.1 },
      { y: 4.9, w: 0.95, h: 1.7 },
    ];
    for (const layer of layers) {
      const cone = new THREE.Mesh(this.pineAssets.coneGeometry, material);
      cone.position.y = layer.y;
      cone.scale.set(layer.w, layer.h, layer.w);
      cone.castShadow = true;
      group.add(cone);
    }

    this.group.add(group);
  }

  ensureRockAssets() {
    if (this.rockAssets) return;
    this.rockAssets = {
      geometry: new THREE.DodecahedronGeometry(1, 0),
      material: new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: 1, flatShading: true }),
    };
  }

  addRock(x, z, scale, rand) {
    this.ensureRockAssets();
    const rock = new THREE.Mesh(this.rockAssets.geometry, this.rockAssets.material);
    rock.position.set(x, 0.35 * scale, z);
    rock.scale.set(scale, scale * 0.7, scale);
    rock.rotation.set(rand() * 0.5, rand() * Math.PI, rand() * 0.5);
    rock.castShadow = true;
    rock.receiveShadow = true;
    this.group.add(rock);
  }

  buildLake() {
    const center = new THREE.Vector3(this.bounds.centerX, 0, this.bounds.centerZ - 4);
    if (this.project(center).distance < 56) return;

    const shore = new THREE.Mesh(
      new THREE.CircleGeometry(24, 36),
      new THREE.MeshStandardMaterial({ color: 0x63748a, roughness: 1 }),
    );
    shore.rotation.x = -Math.PI / 2;
    shore.position.set(center.x, 0.012, center.z);
    this.group.add(shore);

    const water = new THREE.Mesh(
      new THREE.CircleGeometry(20.5, 36),
      new THREE.MeshStandardMaterial({ color: 0x2f7f8f, roughness: 0.2, metalness: 0.2 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(center.x, 0.02, center.z);
    this.group.add(water);

    const rand = mulberry32(4242);
    for (let i = 0; i < 7; i += 1) {
      this.addRock(
        center.x + (rand() - 0.5) * 46,
        center.z + (rand() - 0.5) * 46,
        0.7 + rand() * 1.8,
        rand,
      );
    }
  }

  buildMountains() {
    const rand = mulberry32(31415);
    const geometry = new THREE.ConeGeometry(1, 1, 7);
    const materials = [
      new THREE.MeshStandardMaterial({ color: 0x6f8580, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x7e968c, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x5f7674, roughness: 1, flatShading: true }),
    ];
    const snowMaterial = new THREE.MeshStandardMaterial({
      color: 0xeef4f7,
      roughness: 0.9,
      flatShading: true,
    });
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2 + rand() * 0.32;
      const radius = 340 + rand() * 170;
      const height = 80 + rand() * 110;
      const width = 95 + rand() * 85;
      const mountain = new THREE.Mesh(geometry, materials[i % materials.length]);
      const baseY = height / 2 - 2;
      mountain.position.set(
        this.bounds.centerX + Math.cos(angle) * radius,
        baseY,
        this.bounds.centerZ + Math.sin(angle) * radius,
      );
      mountain.scale.set(width, height, width);
      mountain.rotation.y = rand() * Math.PI;
      this.group.add(mountain);

      // Cumbres nevadas en las montañas más altas: profundidad y escala.
      if (height > 118) {
        const capHeight = height * 0.3;
        const cap = new THREE.Mesh(geometry, snowMaterial);
        cap.position.set(
          mountain.position.x,
          baseY + height / 2 - capHeight / 2 + 0.3,
          mountain.position.z,
        );
        cap.scale.set(width * 0.3, capHeight, width * 0.3);
        cap.rotation.y = mountain.rotation.y;
        this.group.add(cap);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Decoración: CIUDAD FUTURISTA
  // ---------------------------------------------------------------------------

  buildCity() {
    const rand = mulberry32(2027);
    const palette = this.map.cityPalette?.length
      ? this.map.cityPalette
      : [
          ['#141a2e', '#5fe6ff', '#b66cff'],
          ['#1a1430', '#ffd23f', '#ff4f9a'],
          ['#101b28', '#77f06b', '#3fe0ff'],
        ];
    const textures = palette.map(([base, windowColor, accent]) =>
      createBuildingTexture(base, windowColor, accent),
    );
    const materials = textures.map((texture) => {
      texture.repeat.set(1.4, 2.4);
      return new THREE.MeshStandardMaterial({
        map: texture,
        emissive: 0xffffff,
        emissiveMap: texture,
        emissiveIntensity: 0.42,
        roughness: 0.62,
        metalness: 0.24,
      });
    });

    const antennaMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.map.accent ?? '#b66cff'),
    });
    const heightScale = this.map.scenery === 'orbital' ? 0.55 : 1;
    const placed = [];
    const tryBuilding = (x, z) => {
      const width = 8 + rand() * 13;
      const depth = 8 + rand() * 13;
      const height = (15 + rand() * 54) * heightScale;
      const position = new THREE.Vector3(x, 0, z);
      if (this.project(position).distance < this.wallOffset + 12) return;
      for (const other of placed) {
        if (Math.hypot(other.x - x, other.z - z) < 11 + Math.max(width, other.size) * 0.35) return;
      }

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        materials[Math.floor(rand() * materials.length)],
      );
      mesh.position.set(x, height / 2, z);
      mesh.rotation.y = rand() * 0.35;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      placed.push({ x, z, size: width });

      // Antena luminosa en las torres más altas.
      if (height > 34 && rand() > 0.35) {
        const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.22, 7, 0.22), antennaMaterial);
        antenna.position.set(x, height + 3.5, z);
        this.group.add(antenna);
      }
    };

    const step = 26;
    for (let i = 0; i < this.samples.length; i += step) {
      const s = this.samples[i].s;
      for (const sign of [-1, 1]) {
        if (rand() > 0.82) continue;
        const lateral = sign * (this.wallOffset + 15 + rand() * 40);
        const position = this.posAt(s + (rand() - 0.5) * 10, lateral);
        tryBuilding(position.x, position.z);
      }
    }

    // Bloques lejanos para llenar el horizonte nocturno.
    for (let i = 0; i < 26; i += 1) {
      const angle = rand() * Math.PI * 2;
      const radius = 120 + rand() * 130;
      const x = this.bounds.centerX + Math.cos(angle) * radius;
      const z = this.bounds.centerZ + Math.sin(angle) * radius;
      tryBuilding(x, z);
    }

    if (this.map.scenery === 'neon') this.buildNeonSigns();
  }

  buildNeonStrips() {
    const color = new THREE.Color(this.map.accent ?? '#b66cff');
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (const sign of [-1, 1]) {
      const offset = this.wallOffset * sign;
      const strip = new THREE.Mesh(
        this.createHorizontalRibbon(
          offset - sign * 0.16,
          offset + sign * 0.16,
          CONFIG.wallHeight + 0.035,
          'stripes',
          8,
        ),
        material,
      );
      this.group.add(strip);
    }

    // Balizas verticales repartidas por el muro.
    const pylonGeometry = new THREE.BoxGeometry(0.18, 4.4, 0.18);
    for (let s = 0; s < this.length; s += 42) {
      for (const sign of [-1, 1]) {
        const position = this.posAt(s + sign * 9, sign * (this.wallOffset + 0.9));
        const pylon = new THREE.Mesh(pylonGeometry, material);
        pylon.position.set(position.x, 2.2, position.z);
        this.group.add(pylon);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Decoración: CAÑÓN Y ESTACIÓN ORBITAL
  // ---------------------------------------------------------------------------

  buildCanyon() {
    const rand = mulberry32(5150);
    const materials = [
      new THREE.MeshStandardMaterial({ color: 0xc07a44, roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: 0xa9633a, roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: 0xd99a5f, roughness: 1 }),
    ];

    // Mesetas alrededor del trazado, sin invadir la pista.
    for (let i = 0; i < 26; i += 1) {
      const angle = rand() * Math.PI * 2;
      const radius = 45 + rand() * 130;
      const x = this.bounds.centerX + Math.cos(angle) * radius;
      const z = this.bounds.centerZ + Math.sin(angle) * radius;
      const bottom = 5 + rand() * 10;
      const top = bottom * (0.55 + rand() * 0.3);
      const height = 8 + rand() * 26;
      if (this.project(new THREE.Vector3(x, 0, z)).distance < this.wallOffset + bottom + 10) continue;

      const mesa = new THREE.Mesh(
        new THREE.CylinderGeometry(top, bottom, height, 7, 1),
        materials[Math.floor(rand() * materials.length)],
      );
      mesa.position.set(x, height / 2 - 0.4, z);
      mesa.rotation.y = rand() * Math.PI;
      mesa.castShadow = true;
      mesa.receiveShadow = true;
      this.group.add(mesa);

      // Estrato superior más claro: rompe la silueta plana de la meseta.
      if (rand() > 0.42) {
        const capHeight = 1.2 + rand() * 2.4;
        const cap = new THREE.Mesh(
          new THREE.CylinderGeometry(top * 1.04, top * 1.1, capHeight, 7, 1),
          materials[2],
        );
        cap.position.set(x, height - 0.4 - capHeight / 2, z);
        cap.rotation.y = mesa.rotation.y;
        cap.castShadow = true;
        this.group.add(cap);
      }
    }

    // Cactus bajos y rocas sueltas para dar vida al arcén.
    this.ensureRockAssets();
    const cactusMaterial = new THREE.MeshStandardMaterial({ color: 0x4f7d3a, roughness: 0.9 });
    for (let i = 0; i < 16; i += 1) {
      const s = rand() * this.length;
      const side = rand() > 0.5 ? 1 : -1;
      const lateral = side * (this.wallOffset + 4 + rand() * 22);
      const position = this.posAt(s, lateral);
      if (i % 2 === 0) {
        const cactus = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 3.4, 7), cactusMaterial);
        trunk.position.y = 1.7;
        cactus.add(trunk);
        for (const armSign of [-1, 1]) {
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.5, 6), cactusMaterial);
          arm.position.set(armSign * 0.55, 2.1, 0);
          arm.rotation.z = armSign * 0.55;
          cactus.add(arm);
        }
        cactus.position.copy(position);
        cactus.scale.setScalar(0.7 + rand() * 0.5);
        this.group.add(cactus);
      } else {
        this.addRock(position.x, position.z, 0.7 + rand() * 1.6, rand);
      }
    }
  }

  buildNeonSigns() {
    const texts = [
      ['NEÓN', 'DISTRITO 7'],
      ['TURBO', 'NOCTURNO'],
      ['24H', 'CIRCUITO'],
      ['SECTOR', 'MAGENTA'],
    ];
    const accent = new THREE.Color(this.map.accent ?? '#ff3fd0');
    const frameMaterial = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    texts.forEach(([text, sub], index) => {
      const s = (0.12 + index * 0.24) * this.length;
      const side = index % 2 === 0 ? 1 : -1;
      const frame = this.frameAt(s);
      const position = this.posAt(s, side * (this.wallOffset + 9));
      const group = new THREE.Group();
      group.position.set(position.x, 8.4, position.z);
      group.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);

      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(7.6, 3.1),
        new THREE.MeshBasicMaterial({
          map: createSignTexture(text, sub),
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      group.add(panel);

      for (const sign of [-1, 1]) {
        const border = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.5, 0.12), frameMaterial);
        border.position.set(sign * 3.9, 0, 0.05);
        group.add(border);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(8, 0.16, 0.12), frameMaterial);
      top.position.set(0, 1.7, 0.05);
      group.add(top);
      const bottom = top.clone();
      bottom.position.y = -1.7;
      group.add(bottom);

      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.34, 6.2, 0.34), frameMaterial);
      pole.position.set(0, -4.8, 0);
      group.add(pole);

      this.group.add(group);
    });
  }

  buildOrbitalBackdrop() {
    const rand = mulberry32(9090);

    // Campo de estrellas barato: solo puntos, sin luces ni geometría pesada.
    const count = 900;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const angle = rand() * Math.PI * 2;
      const radius = 520 + rand() * 320;
      const height = 40 + rand() * 480;
      positions[i * 3] = this.bounds.centerX + Math.cos(angle) * radius;
      positions[i * 3 + 1] = height;
      positions[i * 3 + 2] = this.bounds.centerZ + Math.sin(angle) * radius;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0xdff6ff,
        size: 1.8,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        fog: false,
      }),
    );
    this.group.add(stars);

    // Planeta anillado al fondo.
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(92, 32, 20),
      new THREE.MeshStandardMaterial({
        color: 0x6f8cff,
        emissive: 0x18245c,
        emissiveIntensity: 0.9,
        roughness: 1,
        metalness: 0,
      }),
    );
    planet.position.set(
      this.bounds.centerX + 360,
      250,
      this.bounds.centerZ - 520,
    );
    this.group.add(planet);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x9fe8ff,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(112, 178, 72), ringMaterial);
    ring.position.copy(planet.position);
    ring.rotation.x = Math.PI / 2.25;
    ring.rotation.z = 0.42;
    this.group.add(ring);

    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(16, 18, 12),
      new THREE.MeshStandardMaterial({ color: 0xc8d8ff, emissive: 0x26345c, roughness: 1 }),
    );
    moon.position.set(
      this.bounds.centerX - 300,
      180,
      this.bounds.centerZ - 430,
    );
    this.group.add(moon);
  }

  // ---------------------------------------------------------------------------
  // Decoración común
  // ---------------------------------------------------------------------------

  buildClouds() {
    const rand = mulberry32(8080);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const geometry = new THREE.SphereGeometry(1, 10, 8);

    for (let i = 0; i < 10; i += 1) {
      const cloud = new THREE.Group();
      const angle = rand() * Math.PI * 2;
      const radius = 100 + rand() * 280;
      cloud.position.set(
        this.bounds.centerX + Math.cos(angle) * radius,
        60 + rand() * 45,
        this.bounds.centerZ + Math.sin(angle) * radius,
      );
      const pieces = 3 + Math.floor(rand() * 3);
      for (let j = 0; j < pieces; j += 1) {
        const puff = new THREE.Mesh(geometry, material);
        puff.position.set((j - pieces / 2) * 7 + rand() * 4, rand() * 3, rand() * 5);
        const scale = 5 + rand() * 7;
        puff.scale.set(scale, scale * 0.55, scale * 0.8);
        cloud.add(puff);
      }
      this.group.add(cloud);
    }
  }

  // ---------------------------------------------------------------------------
  // Generadores de cintas de geometría
  // ---------------------------------------------------------------------------

  /**
   * Cinta horizontal siguiendo la pista.
   * uvMode 'length': U cruza el ancho, V avanza a lo largo.
   * uvMode 'stripes': U avanza a lo largo, V cruza el ancho.
   */
  createHorizontalRibbon(offsetA, offsetB, y, uvMode = 'length', uScale = 8) {
    const positions = [];
    const uvs = [];
    const indices = [];
    const N = this.samples.length;

    for (let i = 0; i <= N; i += 1) {
      const sample = this.samples[i % N];
      const ax = sample.point.x + sample.side.x * offsetA;
      const az = sample.point.z + sample.side.z * offsetA;
      const bx = sample.point.x + sample.side.x * offsetB;
      const bz = sample.point.z + sample.side.z * offsetB;
      positions.push(ax, y, az, bx, y, bz);

      if (uvMode === 'stripes') {
        const u = (i === N ? this.length : sample.s) / uScale;
        uvs.push(u, 0, u, 1);
      } else {
        const v = (i === N ? this.length : sample.s) / uScale;
        uvs.push(0, v, 1, v);
      }
    }

    for (let i = 0; i < N; i += 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  /** Cinta vertical (muro) a un lado de la pista. */
  createVerticalRibbon(offset, height, uvMode = 'stripes', uScale = 6) {
    const positions = [];
    const uvs = [];
    const indices = [];
    const N = this.samples.length;

    for (let i = 0; i <= N; i += 1) {
      const sample = this.samples[i % N];
      const x = sample.point.x + sample.side.x * offset;
      const z = sample.point.z + sample.side.z * offset;
      positions.push(x, 0, z, x, height, z);
      const u = (i === N ? this.length : sample.s) / uScale;
      uvs.push(u, 0, u, 1);
    }

    for (let i = 0; i < N; i += 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  dispose() {
    // No basta con `map`: el asfalto usa bumpMap y los edificios/carteles
    // comparten map + emissiveMap. Si queda alguna textura sin liberar, cambiar
    // de circuito varias veces hace crecer la memoria de la GPU.
    const textureSlots = [
      'map',
      'bumpMap',
      'normalMap',
      'roughnessMap',
      'metalnessMap',
      'alphaMap',
      'aoMap',
      'lightMap',
      'emissiveMap',
      'specularMap',
      'displacementMap',
      'clearcoatMap',
      'clearcoatRoughnessMap',
      'clearcoatNormalMap',
      'sheenColorMap',
      'sheenRoughnessMap',
      'transmissionMap',
      'thicknessMap',
      'iridescenceMap',
      'iridescenceThicknessMap',
      'anisotropyMap',
    ];
    const disposedTextures = new Set();

    this.group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          for (const slot of textureSlots) {
            const texture = material[slot];
            if (!texture || disposedTextures.has(texture)) continue;
            disposedTextures.add(texture);
            texture.dispose();
          }
          material.dispose();
        }
      }
    });
  }
}
