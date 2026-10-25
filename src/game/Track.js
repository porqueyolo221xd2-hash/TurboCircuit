// Circuito cerrado construido a partir de una curva Catmull-Rom.
// La física, las vueltas, la clasificación y la IA son compartidas: cada mapa
// solo aporta su trazado, anchura, ambiente y decoración.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getMap } from './maps.js';
import { mulberry32 } from './utils.js';
import {
  createAsphaltTexture,
  createBannerTexture,
  createBuildingTexture,
  createCheckerTexture,
  createCityGroundTexture,
  createGrassTexture,
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
    this.bounds = this.computeBounds();
    this.build();
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
    const wrapped = ((s % this.length) + this.length) % this.length;
    const f = (wrapped / this.length) * N;
    const i = Math.floor(f) % N;
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
    this.buildWalls();
    this.buildStartLine();
    this.buildArch();
    this.buildScenery();
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
  }

  buildRoad() {
    const asphalt = createAsphaltTexture();
    this.roadMaterial = new THREE.MeshStandardMaterial({
      map: asphalt,
      roughness: 0.96,
      metalness: 0,
    });
    const geometry = this.createHorizontalRibbon(-this.halfWidth, this.halfWidth, 0.02, 'length', 9);
    const road = new THREE.Mesh(geometry, this.roadMaterial);
    road.receiveShadow = true;
    road.name = 'asfalto';
    this.group.add(road);
  }

  buildRoadDetails() {
    this.whiteMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5f3e9,
      roughness: 0.75,
      metalness: 0,
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

    // Pianas con los colores del circuito, justo fuera del asfalto.
    const [curbA, curbB] = this.map.curb ?? ['#ef3f3f', '#f7f4ec'];
    this.curbColors = [curbA, curbB];
    this.stripeTexture = createStripeTexture(curbA, curbB);
    this.stripeMaterial = new THREE.MeshStandardMaterial({ map: this.stripeTexture, roughness: 0.8 });
    const curbWidth = this.curbWidth;
    for (const sign of [-1, 1]) {
      const a = sign > 0 ? this.halfWidth : -this.halfWidth - curbWidth;
      const b = sign > 0 ? this.halfWidth + curbWidth : -this.halfWidth;
      const curb = new THREE.Mesh(this.createHorizontalRibbon(a, b, 0.035, 'stripes', 6), this.stripeMaterial);
      curb.receiveShadow = true;
      this.group.add(curb);
    }
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

    const bannerMaterial = new THREE.MeshStandardMaterial({
      map: createBannerTexture(),
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
    if (this.map.scenery === 'city') {
      this.buildCity();
      this.buildNeonStrips();
    } else if (this.map.scenery === 'mountain') {
      this.buildPines();
      this.buildMountains();
      this.buildLake();
      this.buildClouds();
    } else {
      this.buildPalms();
      this.buildSea();
      this.buildBeachDetails();
      this.buildClouds();
    }
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
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2 + rand() * 0.32;
      const radius = 340 + rand() * 170;
      const height = 80 + rand() * 110;
      const width = 95 + rand() * 85;
      const mountain = new THREE.Mesh(geometry, materials[i % materials.length]);
      mountain.position.set(
        this.bounds.centerX + Math.cos(angle) * radius,
        height / 2 - 2,
        this.bounds.centerZ + Math.sin(angle) * radius,
      );
      mountain.scale.set(width, height, width);
      mountain.rotation.y = rand() * Math.PI;
      this.group.add(mountain);
    }
  }

  // ---------------------------------------------------------------------------
  // Decoración: CIUDAD FUTURISTA
  // ---------------------------------------------------------------------------

  buildCity() {
    const rand = mulberry32(2027);
    const textures = [
      createBuildingTexture('#141a2e', '#5fe6ff', '#b66cff'),
      createBuildingTexture('#1a1430', '#ffd23f', '#ff4f9a'),
      createBuildingTexture('#101b28', '#77f06b', '#3fe0ff'),
    ];
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
    const placed = [];
    const tryBuilding = (x, z) => {
      const width = 8 + rand() * 13;
      const depth = 8 + rand() * 13;
      const height = 15 + rand() * 54;
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
      if (height > 42 && rand() > 0.35) {
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
    this.group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material.map) material.map.dispose();
          material.dispose();
        }
      }
    });
  }
}
