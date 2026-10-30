// Partículas reutilizables para derrape, turbo e impactos.
//
// Todo se dibuja con dos objetos Points (humo y chispas) y pools de tamaño
// fijo: no se crean geometrías, materiales ni objetos por frame. Las partículas
// son puramente visuales y viven en el espacio del mundo; nunca tocan la física.
import * as THREE from 'three';
import { clamp } from './utils.js';

const SPAWN_COLOR = new THREE.Color();

const VERTEX_SHADER = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aTint;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vAlpha = aAlpha;
    vTint = aTint;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (260.0 / max(1.0, -viewPosition.z));
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const FRAGMENT_SHADER = `
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float distanceToCenter = length(uv);
    if (distanceToCenter > 0.5) discard;
    float falloff = smoothstep(0.5, 0.06, distanceToCenter);
    gl_FragColor = vec4(vTint, vAlpha * falloff);
  }
`;

/**
 * Pool circular de partículas. Cada instancia ocupa un único draw call.
 */
export class ParticlePool {
  constructor({ count = 200, blending = THREE.NormalBlending, gravity = 0 } = {}) {
    this.count = count;
    this.gravity = gravity;
    this.cursor = 0;
    this.active = 0;

    this.positions = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.alphas = new Float32Array(count);
    this.tints = new Float32Array(count * 3);

    this.velocities = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.sizeStart = new Float32Array(count);
    this.sizeEnd = new Float32Array(count);
    this.alphaStart = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.gravityPerParticle = new Float32Array(count);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute('aTint', new THREE.BufferAttribute(this.tints, 3));
    geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    geometry.attributes.aSize.setUsage(THREE.DynamicDrawUsage);
    geometry.attributes.aAlpha.setUsage(THREE.DynamicDrawUsage);
    geometry.attributes.aTint.setUsage(THREE.DynamicDrawUsage);
    // Las partículas se mueven cada frame: la caja original dejaría de valer.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending,
      uniforms: {},
    });

    this.geometry = geometry;
    this.material = material;
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.name = 'particle-pool';
    // Sin partículas vivas no se dibuja: coste real 0 cuando no hay efectos.
    this.points.visible = false;
    this.dirty = false;
  }

  /**
   * Lanza una partícula. Los parámetros llegan ya calculados por el emisor.
   */
  spawn(x, y, z, {
    vx = 0,
    vy = 0,
    vz = 0,
    life = 0.6,
    size = 1,
    endSize = 2,
    alpha = 0.5,
    color = 0xffffff,
    drag = 1.6,
    gravity = this.gravity,
  } = {}) {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;

    const positionIndex = index * 3;
    this.positions[positionIndex] = x;
    this.positions[positionIndex + 1] = y;
    this.positions[positionIndex + 2] = z;
    this.velocities[positionIndex] = vx;
    this.velocities[positionIndex + 1] = vy;
    this.velocities[positionIndex + 2] = vz;

    this.life[index] = life;
    this.maxLife[index] = life;
    this.sizeStart[index] = size;
    this.sizeEnd[index] = endSize;
    this.alphaStart[index] = alpha;
    this.drag[index] = drag;
    this.gravityPerParticle[index] = gravity;

    const colorObject = color instanceof THREE.Color ? color : SPAWN_COLOR.setHex(color);
    this.tints[positionIndex] = colorObject.r;
    this.tints[positionIndex + 1] = colorObject.g;
    this.tints[positionIndex + 2] = colorObject.b;

    this.sizes[index] = size;
    this.alphas[index] = alpha;
    this.points.visible = true;
    this.dirty = true;
  }

  update(dt) {
    if (dt <= 0) return;
    let active = 0;
    for (let i = 0; i < this.count; i += 1) {
      let remaining = this.life[i];
      if (remaining <= 0) {
        if (this.alphas[i] !== 0) {
          this.alphas[i] = 0;
          this.sizes[i] = 0;
          this.dirty = true;
        }
        continue;
      }

      remaining -= dt;
      this.life[i] = remaining;
      if (remaining <= 0) {
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        this.dirty = true;
        continue;
      }

      const index = i * 3;
      const drag = Math.max(0, 1 - this.drag[i] * dt);
      this.velocities[index] *= drag;
      this.velocities[index + 1] = this.velocities[index + 1] * drag - this.gravityPerParticle[i] * dt;
      this.velocities[index + 2] *= drag;
      this.positions[index] += this.velocities[index] * dt;
      this.positions[index + 1] += this.velocities[index + 1] * dt;
      this.positions[index + 2] += this.velocities[index + 2] * dt;

      const progress = clamp(1 - remaining / Math.max(0.0001, this.maxLife[i]), 0, 1);
      // Entrada rápida y salida suave, sin allocations.
      const fadeIn = Math.min(1, progress * 6);
      this.alphas[i] = this.alphaStart[i] * fadeIn * (1 - progress);
      this.sizes[i] = this.sizeStart[i] + (this.sizeEnd[i] - this.sizeStart[i]) * progress;
      active += 1;
    }

    this.active = active;
    if (active > 0) this.dirty = true;
    this.points.visible = active > 0;
    if (this.dirty) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
      this.geometry.attributes.aTint.needsUpdate = true;
      this.dirty = false;
    }
  }

  clear() {
    this.life.fill(0);
    this.alphas.fill(0);
    this.sizes.fill(0);
    this.active = 0;
    this.points.visible = false;
    this.dirty = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const TMP = new THREE.Color();
const TMP_POINT = { x: 0, y: 0, z: 0 };

/**
 * Emisores de alto nivel: humo de derrape, estela de turbo, chispas de impacto
 * y confirmaciones de objetos. Mantiene acumuladores por kart para no emitir
 * más partículas de las necesarias.
 */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new ParticlePool({ count: 220, blending: THREE.NormalBlending, gravity: -0.4 });
    this.sparks = new ParticlePool({ count: 160, blending: THREE.AdditiveBlending, gravity: 5.5 });
    scene.add(this.smoke.points);
    scene.add(this.sparks.points);
    this.states = new WeakMap();
    this.enabled = true;
  }

  stateFor(kart) {
    let state = this.states.get(kart);
    if (!state) {
      state = { smoke: 0, turbo: 0 };
      this.states.set(kart, state);
    }
    return state;
  }

  /** Posición del mundo a partir de coordenadas locales del kart. */
  localPoint(kart, localX, localY, localZ) {
    FORWARD.set(Math.sin(kart.heading), 0, Math.cos(kart.heading));
    RIGHT.set(Math.cos(kart.heading), 0, -Math.sin(kart.heading));
    TMP_POINT.x = kart.position.x + RIGHT.x * localX + FORWARD.x * localZ;
    TMP_POINT.y = (kart.height ?? 0) + localY;
    TMP_POINT.z = kart.position.z + RIGHT.z * localX + FORWARD.z * localZ;
    return TMP_POINT;
  }

  /** Humo de neumático: solo cuando hay derrape real y el kart se desplaza. */
  emitDrift(kart, intensity, dt = 1 / 60) {
    if (!this.enabled) return;
    const strength = clamp(intensity, 0, 1);
    if (strength <= 0.02) return;
    const state = this.stateFor(kart);
    const rate = 7 + strength * 30;
    state.smoke += rate * dt;
    let budget = Math.min(3, Math.floor(state.smoke));
    if (budget <= 0) return;
    state.smoke -= budget;

    const speedSign = Math.sign(kart.speed) || 1;
    while (budget > 0) {
      budget -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const wheel = this.localPoint(kart, side * 0.78, 0.16, -0.95);
      TMP.setHSL(0.58, 0.05, 0.62 + Math.random() * 0.16);
      this.smoke.spawn(wheel.x, wheel.y, wheel.z, {
        vx: (Math.random() - 0.5) * 1.6 - Math.sin(kart.heading) * speedSign * 1.1,
        vy: 0.5 + Math.random() * 0.8,
        vz: (Math.random() - 0.5) * 1.6 - Math.cos(kart.heading) * speedSign * 1.1,
        life: 0.45 + Math.random() * 0.35,
        size: 0.55 + Math.random() * 0.35,
        endSize: 2.2 + strength * 1.1,
        alpha: 0.1 + strength * 0.2,
        color: TMP,
        drag: 2.4,
        gravity: -0.55,
      });
    }
  }

  /** Estela del turbo: brillo corto detrás del escape, sin tapar la pista. */
  emitTurbo(kart, intensity, level = 1, dt = 1 / 60) {
    if (!this.enabled) return;
    const strength = clamp(intensity, 0, 1);
    if (strength <= 0.02) return;
    const state = this.stateFor(kart);
    state.turbo += (18 + strength * 52) * dt;
    let budget = Math.min(4, Math.floor(state.turbo));
    if (budget <= 0) return;
    state.turbo -= budget;

    const strong = level >= 2;
    TMP.setHex(strong ? 0xffb02e : 0x5fe6ff);
    const speedSign = Math.sign(kart.speed) || 1;
    while (budget > 0) {
      budget -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const exhaust = this.localPoint(kart, side * 0.26, 0.52, -1.46);
      this.sparks.spawn(exhaust.x, exhaust.y, exhaust.z, {
        vx: (Math.random() - 0.5) * 1.4 - Math.sin(kart.heading) * speedSign * (2 + Math.random() * 3),
        vy: 0.2 + Math.random() * 0.7,
        vz: (Math.random() - 0.5) * 1.4 - Math.cos(kart.heading) * speedSign * (2 + Math.random() * 3),
        life: 0.2 + Math.random() * 0.22,
        size: 0.5 + Math.random() * 0.4,
        endSize: 0.12,
        alpha: 0.35 + strength * 0.35,
        color: TMP,
        drag: 4.2,
        gravity: 0.4,
      });
    }
  }

  /** Chispas breves de un choque o bloqueo. */
  emitImpact(kart, strength = 1, blocked = false, x = null, z = null) {
    if (!this.enabled) return;
    const amount = Math.round(5 + clamp(strength, 0, 1) * 9);
    const originX = x ?? kart.position.x;
    const originZ = z ?? kart.position.z;
    TMP.setHex(blocked ? 0x7fd8ff : 0xffc94a);
    for (let i = 0; i < amount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5;
      this.sparks.spawn(
        originX + (Math.random() - 0.5) * 0.9,
        (kart.height ?? 0) + 0.45 + Math.random() * 0.4,
        originZ + (Math.random() - 0.5) * 0.9,
        {
          vx: Math.cos(angle) * speed,
          vy: 0.8 + Math.random() * 2.4,
          vz: Math.sin(angle) * speed,
          life: 0.22 + Math.random() * 0.3,
          size: 0.35 + Math.random() * 0.3,
          endSize: 0.05,
          alpha: 0.55,
          color: TMP,
          drag: 2.2,
          gravity: 7,
        },
      );
    }
  }

  /** Pequeña nube al aterrizar de un salto. */
  emitLanding(kart) {
    if (!this.enabled) return;
    for (let i = 0; i < 6; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      this.smoke.spawn(
        kart.position.x + Math.cos(angle) * 0.7,
        (kart.height ?? 0) + 0.12,
        kart.position.z + Math.sin(angle) * 0.7,
        {
          vx: Math.cos(angle) * (0.6 + Math.random()),
          vy: 0.35 + Math.random() * 0.4,
          vz: Math.sin(angle) * (0.6 + Math.random()),
          life: 0.35 + Math.random() * 0.25,
          size: 0.4,
          endSize: 1.4,
          alpha: 0.16,
          color: 0xc8d6e2,
          drag: 2.8,
          gravity: -0.2,
        },
      );
    }
  }

  /** Confirmación dorada al recoger una caja. */
  emitPickup(kart) {
    if (!this.enabled) return;
    for (let i = 0; i < 7; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      this.sparks.spawn(
        kart.position.x + Math.cos(angle) * 0.55,
        0.75 + Math.random() * 0.5,
        kart.position.z + Math.sin(angle) * 0.55,
        {
          vx: Math.cos(angle) * 1.2,
          vy: 1.2 + Math.random() * 1.2,
          vz: Math.sin(angle) * 1.2,
          life: 0.3 + Math.random() * 0.25,
          size: 0.3,
          endSize: 0.05,
          alpha: 0.5,
          color: 0xffd76a,
          drag: 1.8,
          gravity: 4,
        },
      );
    }
  }

  update(dt) {
    this.smoke.update(dt);
    this.sparks.update(dt);
  }

  clear() {
    this.smoke.clear();
    this.sparks.clear();
    this.states = new WeakMap();
  }

  dispose() {
    this.smoke.dispose();
    this.sparks.dispose();
    this.states = new WeakMap();
  }
}
