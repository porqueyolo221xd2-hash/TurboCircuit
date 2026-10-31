// Cajas de objetos, inventario de un solo uso, ondas, proyectiles y efectos temporales.
// Todo se genera con geometrías simples y temporizadores que siempre expiran.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ITEMS, ITEM_ORDER, randomItem } from './items.js';
import { angleDiff, clamp } from './utils.js';
import {
  BOX_RESPAWN,
  BOX_SPAWN_TIME,
  BOX_PICKUP_RADIUS,
  buildBoxPlan,
} from './boxLayout.js';
import { ITEM_COOLDOWN_MS, PICKUP_COOLDOWN_MS } from '../../shared/protocol.js';

const PICKUP_RADIUS = BOX_PICKUP_RADIUS;
const PICKUP_COOLDOWN_SECONDS = PICKUP_COOLDOWN_MS / 1000;
const ITEM_COOLDOWN_SECONDS = ITEM_COOLDOWN_MS / 1000;
const SPECIAL_ITEMS = new Set(['MINA', 'FURIA']);

/** Rectángulo redondeado reutilizable para las texturas de las cajas. */
function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** Icono vectorial grande, sin texto, legible a distancia de carrera. */
function drawItemIcon(ctx, id) {
  ctx.beginPath();
  if (id === 'IMPULSO') {
    ctx.moveTo(16, -68);
    ctx.lineTo(-36, 6);
    ctx.lineTo(0, 6);
    ctx.lineTo(-17, 68);
    ctx.lineTo(38, -12);
    ctx.lineTo(2, -12);
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (id === 'PULSO') {
    for (const radius of [62, 44, 26]) {
      ctx.moveTo(radius, 0);
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (id === 'BARRERA') {
    ctx.moveTo(0, -68);
    ctx.lineTo(60, -40);
    ctx.lineTo(50, 20);
    ctx.lineTo(0, 68);
    ctx.lineTo(-50, 20);
    ctx.lineTo(-60, -40);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -44);
    ctx.lineTo(34, -28);
    ctx.lineTo(0, 38);
    ctx.lineTo(-34, -28);
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (id === 'MINA') {
    const spikes = 12;
    for (let i = 0; i < spikes * 2; i += 1) {
      const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const radius = i % 2 === 0 ? 68 : 44;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  if (id === 'FURIA') {
    for (const offset of [-30, 0, 30]) {
      ctx.moveTo(offset - 22, 34);
      ctx.lineTo(offset, -16);
      ctx.lineTo(offset + 22, 34);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 48, 8, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (id === 'PULSO_IMPACTO') {
    const points = 8;
    for (let i = 0; i < points * 2; i += 1) {
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const radius = i % 2 === 0 ? 70 : 28;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.arc(0, 0, 42, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Textura de una caja de objetos: fondo oscuro, marco del color del objeto y
 * un icono vectorial grande. Se crea una sola vez por tipo y se comparte.
 */
function createBoxTexture(item) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const special = SPECIAL_ITEMS.has(item.id);

  ctx.fillStyle = '#070a12';
  ctx.fillRect(0, 0, size, size);

  const glow = ctx.createRadialGradient(128, 128, 12, 128, 128, 150);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
  glow.addColorStop(0.5, 'rgba(255, 255, 255, 0.03)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.lineJoin = 'round';
  roundedRectPath(ctx, 10, 10, 236, 236, 30);
  ctx.lineWidth = special ? 11 : 7;
  ctx.strokeStyle = item.color;
  ctx.stroke();

  roundedRectPath(ctx, 25, 25, 206, 206, 20);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.stroke();

  // Remaches en las esquinas; los objetos especiales llevan doble aro.
  ctx.fillStyle = item.color;
  for (const [x, y] of [
    [30, 30],
    [226, 30],
    [30, 226],
    [226, 226],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, special ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (special) {
    roundedRectPath(ctx, 18, 18, 220, 220, 24);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(128, 128);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = item.color;
  ctx.shadowBlur = 24;
  drawItemIcon(ctx, item.id);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function itemHexColor(item) {
  return Number.parseInt(item.color.replace('#', ''), 16);
}

const PROJECTILE_LIMIT = 14;
const PROJECTILE_SPAWN_AHEAD = 2.3;
const PROJECTILE_HEIGHT = 1.05;
const PROJECTILE_WALL_MARGIN = 0.7;
const BURST_DURATION = 0.36;
const MINE_LIMIT = 6;
const MINE_WALL_MARGIN = 1.1;

/** Distancia mínima (en el plano XZ) de un punto a un segmento. */
export function segmentDistance2D(ax, az, bx, bz, px, pz) {
  const abx = bx - ax;
  const abz = bz - az;
  const length2 = abx * abx + abz * abz;
  let t = 0;
  if (length2 > 0.000001) {
    t = ((px - ax) * abx + (pz - az) * abz) / length2;
    t = clamp(t, 0, 1);
  }
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return Math.hypot(px - cx, pz - cz);
}

/** Colisión barrida entre el recorrido del proyectil y el kart. */
export function segmentHitsKart(ax, az, bx, bz, kart, radius = 2) {
  return segmentDistance2D(ax, az, bx, bz, kart.position.x, kart.position.z) <= radius;
}

/** Comprueba que la línea de tiro no cruce los muros del circuito. */
export function lineOfSightClear(track, from, to, margin = 0.8, routeId = null) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.ceil(distance / 4));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const projection = track.project(
      {
        x: from.x + dx * t,
        z: from.z + dz * t,
      },
      routeId,
    );
    const wallOffset = projection?.wallOffset ?? track.wallOffset;
    if (Math.abs(projection.lateral) > wallOffset - margin) return false;
  }
  return true;
}

/**
 * Elige un objetivo delante, dentro del alcance y del cono de tiro.
 * La dificultad ajusta alcance, ángulo y margen lateral de puntería.
 */
export function chooseProjectileTarget(kart, karts, track, tuning = {}) {
  const range = tuning.projectileRange ?? 24;
  const maxAngle = tuning.projectileAngle ?? 0.2;
  const aimMargin = tuning.projectileAimMargin ?? 2;
  const forwardX = Math.sin(kart.heading);
  const forwardZ = Math.cos(kart.heading);
  let best = null;
  let bestDistance = Infinity;

  for (const other of karts) {
    if (other === kart || other.finished) continue;
    const dx = other.position.x - kart.position.x;
    const dz = other.position.z - kart.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 3 || distance > range) continue;

    const forward = dx * forwardX + dz * forwardZ;
    if (forward <= 0.5) continue;
    const angle = Math.acos(clamp(forward / distance, -1, 1));
    if (angle > maxAngle) continue;

    const lateral = Math.abs(dx * forwardZ - dz * forwardX);
    if (lateral > aimMargin) continue;
    if (!lineOfSightClear(track, kart.position, other.position, 0.8, kart.route ?? null)) continue;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = other;
    }
  }
  return best;
}

export class ItemSystem {
  constructor(scene, track, karts) {
    this.scene = scene;
    this.track = track;
    this.karts = karts;
    this.boxes = [];
    this.waves = [];
    this.projectiles = [];
    this.mines = [];
    this.sparks = [];
    this.effects = [];
    this.time = 0;
    this.onPickup = null;
    this.onUse = null;
    this.onSlow = null;
    this.onProjectileFired = null;
    this.onProjectileHit = null;
    this.onMineTriggered = null;
    this.difficulty = null;
    // Online: el servidor concede cajas y objetos. El cliente solo detecta
    // contactos y reproduce los efectos confirmados.
    this.onlineMode = false;
    this.onBoxClaim = null;
    this.localKart = null;
    this.claimCooldowns = new Map();

    this.group = new THREE.Group();
    this.group.name = 'sistema-objetos';
    this.scene.add(this.group);

    // Recursos compartidos de las cajas: una geometría biselada, una textura y
    // dos materiales (cuerpo y halo) por cada tipo de objeto.
    this.boxGeometry = new RoundedBoxGeometry(1.15, 1.15, 1.15, 4, 0.12);
    this.boxHaloGeometry = new THREE.TorusGeometry(0.9, 0.035, 8, 36);
    this.boxShellGeometry = new THREE.IcosahedronGeometry(0.98, 1);
    this.boxTextures = [];
    this.boxMaterials = new Map();
    this.boxHaloMaterials = new Map();
    this.boxShellMaterials = new Map();
    for (const id of ITEM_ORDER) {
      const item = ITEMS[id];
      const texture = createBoxTexture(item);
      this.boxTextures.push(texture);
      this.boxMaterials.set(
        id,
        new THREE.MeshStandardMaterial({
          map: texture,
          emissive: 0xffffff,
          emissiveMap: texture,
          emissiveIntensity: 0.6,
          roughness: 0.32,
          metalness: 0.18,
        }),
      );
      this.boxHaloMaterials.set(
        id,
        new THREE.MeshBasicMaterial({
          color: itemHexColor(item),
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      this.boxShellMaterials.set(
        id,
        new THREE.MeshBasicMaterial({
          color: itemHexColor(item),
          transparent: true,
          opacity: 0.5,
          wireframe: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
    }
    this.ringGeometry = new THREE.RingGeometry(0.86, 1, 40);

    // Recursos compartidos del proyectil: se crean una vez y se liberan en dispose().
    this.projectileCoreGeometry = new THREE.IcosahedronGeometry(0.34, 1);
    this.projectileShellGeometry = new THREE.IcosahedronGeometry(0.56, 1);
    this.projectileRingGeometry = new THREE.TorusGeometry(0.58, 0.055, 6, 20);
    this.projectileCoreMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff2f7,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.projectileShellMaterial = new THREE.MeshBasicMaterial({
      color: 0xff5f8f,
      transparent: true,
      opacity: 0.7,
      wireframe: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.projectileRingMaterial = new THREE.MeshBasicMaterial({
      color: 0x7ff4ff,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Recursos compartidos de la FURIA: proyectil más grande y de otro color.
    this.furiaCoreGeometry = new THREE.IcosahedronGeometry(0.4, 1);
    this.furiaShellGeometry = new THREE.IcosahedronGeometry(0.76, 1);
    this.furiaRingGeometry = new THREE.TorusGeometry(0.82, 0.06, 6, 22);
    this.furiaCoreMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff0ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.furiaShellMaterial = new THREE.MeshBasicMaterial({
      color: 0xc66bff,
      transparent: true,
      opacity: 0.72,
      wireframe: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.furiaRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd23f,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Estelas: conos aditivos muy baratos que viajan pegados al proyectil.
    this.pulseTailGeometry = new THREE.ConeGeometry(0.3, 2.2, 8, 1, true);
    this.furiaTailGeometry = new THREE.ConeGeometry(0.42, 2.9, 10, 1, true);
    this.pulseTailMaterial = new THREE.MeshBasicMaterial({
      color: 0xff5f8f,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.furiaTailMaterial = new THREE.MeshBasicMaterial({
      color: 0xc66bff,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Recursos compartidos de las minas.
    this.mineBaseGeometry = new THREE.CylinderGeometry(0.5, 0.64, 0.16, 12);
    this.mineDomeGeometry = new THREE.SphereGeometry(
      0.36,
      12,
      8,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2,
    );
    this.mineRingGeometry = new THREE.TorusGeometry(0.7, 0.048, 6, 22);
    this.mineSpikeGeometry = new THREE.ConeGeometry(0.085, 0.28, 6);
    this.mineBeaconGeometry = new THREE.SphereGeometry(0.1, 8, 6);
    this.mineIndicatorGeometry = new THREE.RingGeometry(0.96, 1, 56);
    this.mineBaseMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a2530,
      roughness: 0.55,
      metalness: 0.55,
    });
    this.mineBodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xffb03a,
      emissive: 0xa14c00,
      emissiveIntensity: 0.9,
      roughness: 0.35,
      metalness: 0.4,
    });
    this.mineBeaconMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Recursos compartidos de los destellos de impacto.
    this.burstSphereGeometry = new THREE.IcosahedronGeometry(1, 1);
    this.burstRingGeometry = new THREE.TorusGeometry(1, 0.075, 6, 26);
    this.burstHitMaterial = new THREE.MeshBasicMaterial({
      color: 0xff5f8f,
      transparent: true,
      opacity: 0.78,
      wireframe: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.burstBlockedMaterial = new THREE.MeshBasicMaterial({
      color: 0x77f06b,
      transparent: true,
      opacity: 0.72,
      wireframe: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.buildBoxes();
  }

  /** La dificultad ajusta la frecuencia y la prudencia con los objetos. */
  setDifficulty(difficulty) {
    this.difficulty = difficulty ?? null;
  }

  buildBoxes() {
    const plan = buildBoxPlan(this.track);
    for (const entry of plan) {
      const group = new THREE.Group();
      const baseY = entry.y;
      group.position.set(entry.x, baseY, entry.z);

      const mesh = new THREE.Mesh(this.boxGeometry, this.boxMaterials.get('IMPULSO'));
      mesh.castShadow = true;
      const halo = new THREE.Mesh(this.boxHaloGeometry, this.boxHaloMaterials.get('IMPULSO'));
      halo.rotation.x = Math.PI / 2;
      const shell = new THREE.Mesh(this.boxShellGeometry, this.boxShellMaterials.get('IMPULSO'));
      shell.visible = false;
      group.add(mesh, halo, shell);
      this.group.add(group);

      const box = {
        index: entry.index,
        group,
        mesh,
        halo,
        shell,
        baseY,
        s: entry.s,
        routeId: entry.routeId,
        itemId: null,
        special: false,
        active: true,
        respawn: 0,
        phase: Math.random() * Math.PI * 2,
        spawnTime: BOX_SPAWN_TIME,
      };
      this.applyBoxItem(box, randomItem());
      box.mesh.scale.setScalar(1);
      this.boxes.push(box);
    }
  }

  /** Asigna un objeto a una caja y actualiza su material, halo y carcasa. */
  applyBoxItem(box, itemId) {
    const item = ITEMS[itemId] ?? ITEMS.IMPULSO;
    box.itemId = item.id;
    box.special = SPECIAL_ITEMS.has(item.id);
    box.mesh.material = this.boxMaterials.get(item.id);
    box.halo.material = this.boxHaloMaterials.get(item.id);
    box.shell.material = this.boxShellMaterials.get(item.id);
    box.shell.visible = box.special;
  }

  /** Reactiva una caja con un objeto nuevo y su animación de aparición. */
  activateBox(box, withEffect = true) {
    this.applyBoxItem(box, randomItem());
    box.active = true;
    box.respawn = 0;
    box.spawnTime = 0;
    box.group.visible = true;
    box.group.position.y = box.baseY ?? 0.95;
    box.mesh.scale.setScalar(0.05);
    box.mesh.rotation.set(0, 0, 0);
    box.halo.scale.setScalar(0.6);
    if (withEffect) this.spawnBoxAppear(box);
  }

  spawnBoxAppear(box) {
    const item = ITEMS[box.itemId] ?? ITEMS.IMPULSO;
    const color = itemHexColor(item);
    const { x, y, z } = box.group.position;
    this.spawnWaveAt(x, z, { color, radius: 2.6, duration: 0.45, opacity: 0.45, y: 0.12 });
    this.spawnBurst(x, z, false, { color, scale: 0.65, duration: 0.28, height: y });
  }

  spawnBoxPickup(box) {
    const item = ITEMS[box.itemId] ?? ITEMS.IMPULSO;
    const color = itemHexColor(item);
    const { x, y, z } = box.group.position;
    this.spawnBurst(x, z, false, { color, scale: 1.05, duration: 0.42, height: y });
    this.spawnSparks(x, y, z, color, 16, 6, 0.45);
    this.spawnWaveAt(x, z, { color, radius: 2.4, duration: 0.38, opacity: 0.5, y: 0.12 });
  }

  reset() {
    this.time = 0;
    for (const box of this.boxes) {
      this.applyBoxItem(box, randomItem());
      box.active = true;
      box.respawn = 0;
      box.spawnTime = BOX_SPAWN_TIME * 0.6;
      box.group.visible = true;
      box.group.position.y = box.baseY ?? 0.95;
      box.mesh.scale.setScalar(0.05);
      box.mesh.rotation.set(0, 0, 0);
      box.halo.scale.setScalar(0.6);
    }
    this.claimCooldowns.clear();
    this.clearEffects();
    for (const kart of this.karts) kart.clearItemState();
  }

  /** Activa el modo online: sin respawn local ni concesión automática de cajas. */
  setOnlineMode(enabled, localKart = null) {
    this.onlineMode = Boolean(enabled);
    this.localKart = localKart;
    this.claimCooldowns.clear();
    if (this.onlineMode) {
      this.clearProjectiles();
      this.clearMines();
    }
  }

  /** Aplica la lista inicial de cajas confirmada por el servidor. */
  applyServerBoxes(entries) {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!entry || !Number.isInteger(entry.index)) continue;
      const box = this.boxes[entry.index];
      if (!box) continue;
      this.applyBoxItem(box, entry.itemId ?? 'IMPULSO');
      box.active = entry.active !== false;
      box.respawn = 0;
      box.spawnTime = BOX_SPAWN_TIME;
      box.group.visible = box.active;
      box.group.position.y = box.baseY ?? 0.95;
      box.mesh.scale.setScalar(1);
      box.mesh.rotation.set(0, 0, 0);
      box.halo.scale.setScalar(0.94);
    }
  }

  /** Actualiza una sola caja (recogida o reaparición confirmada). */
  setServerBox(index, active, itemId = null) {
    const box = this.boxes[index];
    if (!box) return;
    if (itemId) this.applyBoxItem(box, itemId);
    const wasActive = box.active;
    box.active = Boolean(active);
    box.respawn = 0;
    box.group.visible = box.active;
    if (box.active) {
      box.spawnTime = 0;
      box.mesh.scale.setScalar(1);
      box.halo.scale.setScalar(0.94);
      if (!wasActive) this.spawnBoxAppear(box);
    }
  }

  /** El servidor confirma que este kart ha recogido una caja. */
  awardServerItem(kart, itemId, boxIndex) {
    if (!kart || !ITEMS[itemId]) return;
    kart.item = itemId;
    kart.pickupCooldown = PICKUP_COOLDOWN_SECONDS;
    const box = this.boxes[boxIndex];
    if (box) {
      this.spawnBoxPickup(box);
      box.active = false;
      box.group.visible = false;
    }
    if (this.onPickup) this.onPickup(kart, itemId);
  }

  /** Reproduce un uso de objeto ya validado por el servidor. */
  applyServerItemUse(kart, itemId, targetIds = [], karts = this.karts) {
    const def = ITEMS[itemId];
    if (!kart || !def) return;
    if (kart.item === itemId) kart.item = null;
    kart.itemUseCooldown = ITEM_COOLDOWN_SECONDS;

    if (itemId === 'IMPULSO') {
      kart.applyItemBoost(def.power, def.duration);
    } else if (itemId === 'BARRERA') {
      kart.applyBarrier(def.duration);
    } else if (itemId === 'PULSO') {
      this.spawnWave(kart);
      const targets = new Set(targetIds);
      for (const other of karts) {
        if (other === kart || !targets.has(other.netId)) continue;
        other.applySlow(def.slowFactor, def.slowDuration);
        if (this.onSlow) this.onSlow(other);
      }
    }

    if (this.onUse) this.onUse(kart, itemId);
  }

  /**
   * Quita las ondas y los destellos activos y los objetos equipados.
   * Con keepProjectiles se conservan los proyectiles en vuelo (pausa).
   */
  clearEffects({ keepProjectiles = false } = {}) {
    for (const wave of this.waves) {
      this.group.remove(wave.mesh);
      wave.material.dispose();
    }
    this.waves.length = 0;
    this.clearBursts();
    this.clearSparks();
    if (!keepProjectiles) {
      this.clearProjectiles();
      this.clearMines();
    }
    for (const kart of this.karts) kart.clearItemState();
  }

  clearProjectiles() {
    for (const projectile of this.projectiles) {
      this.group.remove(projectile.mesh);
    }
    this.projectiles.length = 0;
  }

  clearMines() {
    for (const mine of this.mines) {
      this.group.remove(mine.group);
      mine.indicatorMaterial.dispose();
    }
    this.mines.length = 0;
  }

  clearBursts() {
    for (const effect of this.effects) {
      this.group.remove(effect.group);
      effect.material.dispose();
    }
    this.effects.length = 0;
  }

  clearSparks() {
    for (const spark of this.sparks) {
      this.group.remove(spark.points);
      spark.geometry.dispose();
      spark.material.dispose();
    }
    this.sparks.length = 0;
  }

  update(dt, karts = this.karts) {
    this.time += dt;
    this.updateBoxes(dt, karts);
    this.updateWaves(dt);
    this.updateMines(dt, karts);
    this.updateProjectiles(dt, karts);
    this.updateBursts(dt);
    this.updateSparks(dt);
    if (!this.onlineMode) this.updateAI(dt, karts);
  }

  updateBoxes(dt, karts) {
    for (const box of this.boxes) {
      if (!box.active) {
        // En online la reactivación la decide el servidor.
        if (!this.onlineMode) {
          box.respawn -= dt;
          if (box.respawn <= 0) this.activateBox(box);
        }
        continue;
      }

      // Aparición elástica: la caja crece desde el centro sin saltar.
      if (box.spawnTime < BOX_SPAWN_TIME) {
        box.spawnTime = Math.min(BOX_SPAWN_TIME, box.spawnTime + dt);
        const t = box.spawnTime / BOX_SPAWN_TIME;
        const eased = 1 - Math.pow(1 - t, 3);
        box.mesh.scale.setScalar(0.05 + 0.95 * eased);
      } else if (box.mesh.scale.x !== 1) {
        box.mesh.scale.setScalar(1);
      }

      // Rotación suave: giro continuo con una inclinación muy leve.
      box.mesh.rotation.y += dt * 1.55;
      box.mesh.rotation.x = Math.sin(this.time * 0.9 + box.phase) * 0.2;
      box.mesh.rotation.z = Math.sin(this.time * 0.7 + box.phase * 1.3) * 0.12;
      box.group.position.y = (box.baseY ?? 0.95) + Math.sin(this.time * 2 + box.phase) * 0.12;

      const pulse = 0.94 + Math.sin(this.time * 3.2 + box.phase) * 0.06;
      box.halo.scale.setScalar(pulse);
      if (box.special) {
        box.shell.rotation.y -= dt * 1.5;
        box.shell.rotation.x += dt * 0.65;
        box.shell.scale.setScalar(1 + Math.sin(this.time * 4 + box.phase) * 0.035);
      }

      if (this.onlineMode) {
        const kart = this.localKart ?? karts[0];
        if (!kart || kart.finished || kart.item || kart.pickupCooldown > 0) continue;
        if (box.routeId && box.routeId !== kart.route) continue;
        const dx = kart.position.x - box.group.position.x;
        const dz = kart.position.z - box.group.position.z;
        if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS) continue;
        if ((kart.height ?? 0) > 1.8) continue;

        // No se concede nada en local: se pide al servidor y se evita repetir
        // la petición mientras llega la respuesta.
        const last = this.claimCooldowns.get(box.index) ?? -Infinity;
        if (this.time - last < 0.35) continue;
        this.claimCooldowns.set(box.index, this.time);
        if (this.onBoxClaim) this.onBoxClaim(box.index);
        continue;
      }

      for (const kart of karts) {
        if (kart.finished || kart.item || kart.pickupCooldown > 0) continue;
        if (box.routeId && box.routeId !== kart.route) continue;
        const dx = kart.position.x - box.group.position.x;
        const dz = kart.position.z - box.group.position.z;
        if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS) continue;
        if ((kart.height ?? 0) > 1.8) continue;

        // El objeto estaba decidido al aparecer: el icono siempre coincide.
        const itemId = box.itemId ?? randomItem();
        kart.item = itemId;
        kart.pickupCooldown = 0.6;
        kart.aiItemTimer = 0.7 + Math.random() * 0.9;
        this.spawnBoxPickup(box);
        box.active = false;
        box.respawn = BOX_RESPAWN;
        box.group.visible = false;
        box.itemId = null;
        if (this.onPickup) this.onPickup(kart, itemId);
        break;
      }
    }
  }

  updateWaves(dt) {
    for (let i = this.waves.length - 1; i >= 0; i -= 1) {
      const wave = this.waves[i];
      wave.life += dt;
      const t = clamp(wave.life / wave.duration, 0, 1);
      const scale = 1.4 + (wave.radius - 1.4) * t;
      wave.mesh.scale.setScalar(scale);
      wave.material.opacity = (wave.opacity ?? 0.7) * (1 - t);
      if (t >= 1) {
        this.group.remove(wave.mesh);
        wave.material.dispose();
        this.waves.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Proyectiles
  // ---------------------------------------------------------------------------

  /**
   * Lanza un proyectil desde delante del kart. Reutilizado por el PULSO DE
   * IMPACTO y por la FURIA (con abanico y geometría propia). La dirección y la
   * posición quedan congeladas: no se mueve con el kart.
   */
  spawnProjectile(kart, itemId = 'PULSO_IMPACTO', angleOffset = 0, notify = true) {
    if (!kart) return null;

    const def = ITEMS[itemId] ?? ITEMS.PULSO_IMPACTO;
    const heading = kart.heading + angleOffset;
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const routeId = kart.route ?? null;
    let x = kart.position.x + forwardX * PROJECTILE_SPAWN_AHEAD;
    let z = kart.position.z + forwardZ * PROJECTILE_SPAWN_AHEAD;
    let spawnProjection = this.track.project({ x, z }, routeId, kart.trackS);
    const spawnWall = () => spawnProjection.wallOffset ?? this.track.wallOffset;

    // Si el kart está pegado al muro, el morro puede quedar fuera: se prueba
    // un punto algo más cercano antes de descartar el disparo.
    if (Math.abs(spawnProjection.lateral) > spawnWall() - PROJECTILE_WALL_MARGIN) {
      for (const ahead of [1.4, 0.7]) {
        const testX = kart.position.x + forwardX * ahead;
        const testZ = kart.position.z + forwardZ * ahead;
        const testProjection = this.track.project({ x: testX, z: testZ }, routeId, kart.trackS);
        if (Math.abs(testProjection.lateral) <= (testProjection.wallOffset ?? this.track.wallOffset) - PROJECTILE_WALL_MARGIN) {
          x = testX;
          z = testZ;
          spawnProjection = testProjection;
          break;
        }
      }
    }
    if (Math.abs(spawnProjection.lateral) > spawnWall() - PROJECTILE_WALL_MARGIN) {
      return null;
    }

    const limit = itemId === 'FURIA' ? PROJECTILE_LIMIT + 6 : PROJECTILE_LIMIT;
    if (this.projectiles.length >= limit) {
      // Nunca se acumulan indefinidamente: se retira el más antiguo.
      const oldest = this.projectiles.shift();
      this.group.remove(oldest.mesh);
    }

    const group = new THREE.Group();
    group.name = itemId === 'FURIA' ? 'descarga-furia' : 'pulso-de-impacto';
    let core;
    let shell;
    let ring;
    let secondRing = null;
    let tail;

    if (itemId === 'FURIA') {
      core = new THREE.Mesh(this.furiaCoreGeometry, this.furiaCoreMaterial);
      shell = new THREE.Mesh(this.furiaShellGeometry, this.furiaShellMaterial);
      ring = new THREE.Mesh(this.furiaRingGeometry, this.furiaRingMaterial);
      secondRing = new THREE.Mesh(this.furiaRingGeometry, this.furiaRingMaterial);
      ring.rotation.x = Math.PI / 2;
      secondRing.rotation.x = Math.PI / 2.6;
      secondRing.rotation.z = Math.PI / 2;
      tail = new THREE.Mesh(this.furiaTailGeometry, this.furiaTailMaterial);
      tail.rotation.x = -Math.PI / 2;
      tail.position.z = -1.35;
      group.add(core, shell, ring, secondRing, tail);
    } else {
      core = new THREE.Mesh(this.projectileCoreGeometry, this.projectileCoreMaterial);
      shell = new THREE.Mesh(this.projectileShellGeometry, this.projectileShellMaterial);
      ring = new THREE.Mesh(this.projectileRingGeometry, this.projectileRingMaterial);
      ring.rotation.x = Math.PI / 2;
      tail = new THREE.Mesh(this.pulseTailGeometry, this.pulseTailMaterial);
      tail.rotation.x = -Math.PI / 2;
      tail.position.z = -1.05;
      group.add(core, shell, ring, tail);
    }

    const baseY = spawnProjection.height ?? kart.groundY ?? 0;
    group.position.set(x, baseY + PROJECTILE_HEIGHT, z);
    group.rotation.y = heading;
    this.group.add(group);

    const projectile = {
      mesh: group,
      core,
      shell,
      ring,
      secondRing,
      tail,
      owner: kart,
      kind: itemId,
      def,
      x,
      z,
      routeId,
      baseY,
      directionX: forwardX,
      directionZ: forwardZ,
      traveled: 0,
      life: 0,
      seed: Math.random() * Math.PI * 2,
    };
    this.projectiles.push(projectile);

    if (!kart.isPlayer) {
      const cooldown = this.difficulty?.projectileCooldown ?? 2.4;
      kart.aiProjectileCooldown = cooldown;
    }
    if (notify && this.onProjectileFired) this.onProjectileFired(kart, projectile);
    return projectile;
  }

  updateProjectiles(dt, karts) {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i];
      const def = projectile.def ?? ITEMS.PULSO_IMPACTO;
      const previousX = projectile.x;
      const previousZ = projectile.z;
      const step = def.speed * dt;
      const nextX = previousX + projectile.directionX * step;
      const nextZ = previousZ + projectile.directionZ * step;

      projectile.life += dt;
      projectile.traveled += step;
      projectile.x = nextX;
      projectile.z = nextZ;
      const projectileY = (projectile.baseY ?? 0) + PROJECTILE_HEIGHT;
      projectile.mesh.position.set(
        nextX,
        projectileY + Math.sin(projectile.life * 17 + projectile.seed) * 0.07,
        nextZ,
      );
      // La estela debe apuntar siempre hacia atrás: se gira el núcleo, no el grupo.
      if (projectile.shell) {
        projectile.shell.rotation.y += dt * 6;
        projectile.shell.rotation.x += dt * 3;
      }
      if (projectile.ring) projectile.ring.rotation.z += dt * 5;
      if (projectile.secondRing) projectile.secondRing.rotation.z -= dt * 4.2;
      if (projectile.tail) {
        projectile.tail.scale.setScalar(
          0.92 + Math.sin(projectile.life * 22 + projectile.seed) * 0.1,
        );
      }

      // Colisión barrida: evita atravesar un kart a velocidades altas.
      let hitKart = null;
      for (const kart of karts) {
        if (kart === projectile.owner || kart.finished) continue;
        if (kart.projectileGrace > 0) continue;
        if (segmentHitsKart(previousX, previousZ, nextX, nextZ, kart, def.hitRadius)) {
          hitKart = kart;
          break;
        }
      }

      if (hitKart) {
        const blocked = hitKart.barrierTime > 0;
        if (!blocked) {
          const relX = hitKart.position.x - nextX;
          const relZ = hitKart.position.z - nextZ;
          const side =
            Math.sign(relX * projectile.directionZ - relZ * projectile.directionX) || 1;
          hitKart.applyImpact(def, side);
          hitKart.projectileGrace = 0.14;
        }
        const furia = projectile.kind === 'FURIA';
        this.spawnBurst(nextX, nextZ, blocked, {
          color: furia ? 0xc66bff : null,
          scale: furia ? 1.3 : 1,
          duration: furia ? 0.44 : BURST_DURATION,
        });
        this.spawnSparks(
          nextX,
          (projectile.baseY ?? 0) + PROJECTILE_HEIGHT,
          nextZ,
          blocked ? 0x9dff8f : furia ? 0xe2b0ff : 0xffb6cc,
          furia ? 14 : 9,
          furia ? 8 : 6,
          0.4,
        );
        if (this.onProjectileHit) {
          this.onProjectileHit(hitKart, projectile.owner, blocked, projectile);
        }
        this.removeProjectileAt(i);
        continue;
      }

      const midX = (previousX + nextX) / 2;
      const midZ = (previousZ + nextZ) / 2;
      if (this.isOutsideTrack(nextX, nextZ, projectile.routeId) || this.isOutsideTrack(midX, midZ, projectile.routeId)) {
        this.spawnBurst(nextX, nextZ, false, {
          color: projectile.kind === 'FURIA' ? 0xc66bff : null,
          scale: 0.8,
        });
        this.removeProjectileAt(i);
        continue;
      }

      if (projectile.life >= def.life || projectile.traveled >= def.range) {
        // Al agotar alcance o duración desaparece sin dejar rastro.
        this.removeProjectileAt(i);
      }
    }
  }

  isOutsideTrack(x, z, routeId = null) {
    const projection = this.track.project({ x, z }, routeId);
    if (!projection) return true;
    const wallOffset = projection.wallOffset ?? this.track.wallOffset;
    return Math.abs(projection.lateral) > wallOffset - PROJECTILE_WALL_MARGIN;
  }

  removeProjectileAt(index) {
    const [projectile] = this.projectiles.splice(index, 1);
    if (projectile) this.group.remove(projectile.mesh);
  }

  spawnBurst(x, z, blocked = false, options = {}) {
    const {
      color = null,
      scale = 1,
      duration = BURST_DURATION,
      height = PROJECTILE_HEIGHT,
    } = options;
    // Material propio y pequeño por destello: se libera al terminar.
    const material = (blocked ? this.burstBlockedMaterial : this.burstHitMaterial).clone();
    if (color !== null) material.color.setHex(color);
    const group = new THREE.Group();
    group.position.set(x, height, z);
    const sphere = new THREE.Mesh(this.burstSphereGeometry, material);
    const ring = new THREE.Mesh(this.burstRingGeometry, material);
    ring.rotation.x = Math.PI / 2;
    group.add(sphere, ring);
    group.scale.setScalar(0.45 * scale);
    this.group.add(group);
    this.effects.push({
      group,
      material,
      life: 0,
      duration,
      baseScale: 0.45 * scale,
      growth: 2.3 * scale,
      spin: blocked ? -5 : 7,
      opacity: blocked ? 0.72 : 0.78,
    });
  }

  /** Chispas aditivas ligeras: un único Points por impacto/explosión. */
  spawnSparks(x, y, z, color, count = 10, power = 6, duration = 0.4) {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = x + (Math.random() - 0.5) * 0.3;
      positions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.2;
      positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
      const angle = Math.random() * Math.PI * 2;
      const speed = power * (0.4 + Math.random() * 0.8);
      const up = 0.22 + Math.random() * 0.7;
      velocities[i * 3] = Math.cos(angle) * speed * (1 - up * 0.5);
      velocities[i * 3 + 1] = up * speed;
      velocities[i * 3 + 2] = Math.sin(angle) * speed * (1 - up * 0.5);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color,
      size: 0.17,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    this.group.add(points);
    this.sparks.push({
      points,
      geometry,
      material,
      velocities,
      life: 0,
      duration,
      gravity: 13,
    });
  }

  updateBursts(dt) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.life += dt;
      const t = clamp(effect.life / effect.duration, 0, 1);
      effect.group.scale.setScalar(effect.baseScale + t * effect.growth);
      effect.group.rotation.y += dt * effect.spin;
      effect.group.rotation.x += dt * effect.spin * 0.6;
      effect.material.opacity = (1 - t) * effect.opacity;
      if (t >= 1) {
        this.group.remove(effect.group);
        effect.material.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  updateSparks(dt) {
    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const spark = this.sparks[i];
      spark.life += dt;
      const t = clamp(spark.life / spark.duration, 0, 1);
      const position = spark.geometry.getAttribute('position');
      const array = position.array;
      for (let j = 0; j < array.length; j += 3) {
        spark.velocities[j + 1] -= spark.gravity * dt;
        array[j] += spark.velocities[j] * dt;
        array[j + 1] += spark.velocities[j + 1] * dt;
        array[j + 2] += spark.velocities[j + 2] * dt;
      }
      position.needsUpdate = true;
      spark.material.opacity = (1 - t) * 0.95;
      if (t >= 1) {
        this.group.remove(spark.points);
        spark.geometry.dispose();
        spark.material.dispose();
        this.sparks.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Minas
  // ---------------------------------------------------------------------------

  /**
   * Suelta una mina detrás del kart, siempre dentro de la pista.
   * Devuelve la mina o null si no hay un punto válido (el objeto no se gasta).
   */
  spawnMine(kart) {
    if (!kart) return null;
    const def = ITEMS.MINA;
    const routeId = kart.route ?? null;
    const route = routeId ? this.track.routesById.get(routeId) : null;
    const wallOffset = route ? route.wallOffset : this.track.wallOffset;
    const limit = wallOffset - MINE_WALL_MARGIN;
    const lateral = clamp(kart.lateral, -limit, limit);
    let behindS = kart.trackS - def.placeBehind;
    if (route) {
      const local = this.track.localSForRoute(route, kart.trackS);
      behindS = this.track.globalSForRoute(route, Math.max(1.5, local - def.placeBehind));
    }
    const point = this.track.posAt(behindS, lateral, routeId);
    const projection = this.track.project(point, routeId, kart.trackS);
    const projectedWall = projection.wallOffset ?? wallOffset;
    const projectedLimit = projectedWall - MINE_WALL_MARGIN;
    const clampedLateral = clamp(projection.lateral, -projectedLimit, projectedLimit);
    const x = projection.centerX + projection.sx * clampedLateral;
    const z = projection.centerZ + projection.sz * clampedLateral;
    const baseY = projection.height ?? 0;

    if (this.mines.length >= Math.min(def.limit ?? MINE_LIMIT, MINE_LIMIT)) {
      this.removeMineAt(0);
    }

    const group = new THREE.Group();
    group.name = 'mina';
    group.position.set(x, baseY, z);

    const base = new THREE.Mesh(this.mineBaseGeometry, this.mineBaseMaterial);
    base.position.y = 0.1;
    base.castShadow = true;
    const dome = new THREE.Mesh(this.mineDomeGeometry, this.mineBodyMaterial);
    dome.position.y = 0.18;
    dome.castShadow = true;
    group.add(base, dome);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb03a,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(this.mineRingGeometry, this.mineBodyMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.22;
    group.add(ring);

    for (let i = 0; i < 4; i += 1) {
      const spike = new THREE.Mesh(this.mineSpikeGeometry, this.mineBodyMaterial);
      const angle = (i / 4) * Math.PI * 2;
      spike.position.set(Math.cos(angle) * 0.43, 0.13, Math.sin(angle) * 0.43);
      spike.rotation.z = Math.cos(angle) * 0.9;
      spike.rotation.x = Math.sin(angle) * 0.9;
      group.add(spike);
    }

    const beacon = new THREE.Mesh(this.mineBeaconGeometry, this.mineBeaconMaterial);
    beacon.position.y = 0.5;
    group.add(beacon);

    const indicator = new THREE.Mesh(this.mineIndicatorGeometry, ringMaterial);
    indicator.rotation.x = -Math.PI / 2;
    indicator.position.y = 0.035;
    indicator.scale.setScalar(def.triggerRadius);
    group.add(indicator);

    group.scale.setScalar(0.08);
    this.group.add(group);

    const mine = {
      group,
      ring,
      beacon,
      indicator,
      indicatorMaterial: ringMaterial,
      owner: kart,
      x,
      z,
      baseY,
      routeId,
      def,
      life: 0,
      phase: Math.random() * Math.PI * 2,
    };
    this.mines.push(mine);
    return mine;
  }

  removeMineAt(index) {
    const [mine] = this.mines.splice(index, 1);
    if (!mine) return;
    this.group.remove(mine.group);
    mine.indicatorMaterial.dispose();
  }

  updateMines(dt, karts) {
    for (let i = this.mines.length - 1; i >= 0; i -= 1) {
      const mine = this.mines[i];
      const def = mine.def;
      mine.life += dt;

      if (mine.life >= def.life) {
        this.removeMineAt(i);
        continue;
      }

      // Despliegue rápido y pulso del indicador en el suelo.
      const grow = Math.min(1, mine.life / 0.26);
      mine.group.scale.setScalar(0.08 + 0.92 * grow);
      const armed = mine.life >= def.armTime;
      const blinkRate = armed ? 8 : 20;
      const blink = Math.sin(this.time * blinkRate + mine.phase);
      mine.beacon.visible = blink > -0.15;
      mine.beacon.scale.setScalar(0.8 + Math.max(0, blink) * 0.5);
      const pulse = 0.5 + Math.sin(this.time * 4.4 + mine.phase) * 0.5;
      mine.indicatorMaterial.opacity = armed ? 0.16 + pulse * 0.18 : 0.1 + pulse * 0.08;
      mine.indicator.scale.setScalar(def.triggerRadius * (0.98 + pulse * 0.02));
      mine.ring.rotation.z += dt * (armed ? 1.8 : 4.5);

      if (!armed) continue;

      // El dueño tiene una gracia breve para no detonarla al soltarla.
      for (const kart of karts) {
        if (kart.finished) continue;
        if (kart === mine.owner && mine.life < def.armTime + 0.6) continue;
        if ((kart.height ?? 0) > 1.3) continue;
        if (Math.abs((kart.groundY ?? 0) - (mine.baseY ?? 0)) > 2.2) continue;
        const dx = kart.position.x - mine.x;
        const dz = kart.position.z - mine.z;
        if (dx * dx + dz * dz <= def.triggerRadius * def.triggerRadius) {
          this.explodeMine(i, kart);
          break;
        }
      }
    }
  }

  explodeMine(index, triggeredBy) {
    const mine = this.mines[index];
    if (!mine) return;
    const { def, x, z, owner, baseY = 0 } = mine;
    this.removeMineAt(index);

    this.spawnBurst(x, z, false, {
      color: 0xffb03a,
      scale: 1.9,
      duration: 0.5,
      height: baseY + 0.55,
    });
    this.spawnWaveAt(x, z, {
      color: 0xffb03a,
      radius: def.blastRadius,
      duration: 0.55,
      opacity: 0.8,
      y: baseY + 0.12,
    });
    this.spawnSparks(x, baseY + 0.6, z, 0xffcf6a, 22, 9, 0.55);

    const affected = [];
    for (const kart of this.karts) {
      if (kart.finished) continue;
      if (Math.abs((kart.groundY ?? 0) - baseY) > 2.4) continue;
      const dx = kart.position.x - x;
      const dz = kart.position.z - z;
      const distance = Math.hypot(dx, dz);
      if (distance > def.blastRadius) continue;
      affected.push(kart);
      if (kart.barrierTime > 0) continue;

      const falloff = clamp(1 - distance / def.blastRadius, 0.18, 1);
      const side = Math.sign(dx * Math.cos(kart.heading) - dz * Math.sin(kart.heading)) || 1;
      kart.applyImpact(
        {
          slowFactor: 1 - (1 - def.slowFactor) * (0.45 + falloff * 0.55),
          slowDuration: def.slowDuration * (0.55 + falloff * 0.45),
          controlDuration: def.controlDuration * (0.6 + falloff * 0.4),
          controlStrength: def.controlStrength * (0.6 + falloff * 0.4),
          impactSpeedLoss: 1 - (1 - def.impactSpeedLoss) * (0.5 + falloff * 0.5),
          stunTime: (def.stunTime ?? 0) * falloff,
        },
        side,
      );

      // Empuje radial corto y salto arcade solo si el golpe es cercano.
      const nx = distance > 0.001 ? dx / distance : 0;
      const nz = distance > 0.001 ? dz / distance : 0;
      const push = def.push * falloff;
      kart.position.x += nx * push;
      kart.position.z += nz * push;
      const projection = this.track.project(kart.position);
      const wallLimit = this.track.wallOffset - MINE_WALL_MARGIN;
      if (Math.abs(projection.lateral) > wallLimit) {
        const wallSide = Math.sign(projection.lateral);
        kart.position.x = projection.centerX + projection.sx * wallLimit * wallSide;
        kart.position.z = projection.centerZ + projection.sz * wallLimit * wallSide;
      }
      if (falloff > 0.32 && !kart.airborne && Math.abs(kart.speed) > 4) {
        kart.startJump(def.hop * falloff);
      }
      kart.group.position.set(kart.position.x, 0.02 + kart.height, kart.position.z);
    }

    if (this.onMineTriggered) {
      this.onMineTriggered(owner, affected, triggeredBy, x, z);
    }
  }

  // ---------------------------------------------------------------------------
  // Decisiones de la IA
  // ---------------------------------------------------------------------------

  updateAI(dt, karts) {
    for (const kart of karts) {
      if (kart.isPlayer || kart.finished) continue;
      kart.aiProjectileCooldown = Math.max(0, (kart.aiProjectileCooldown ?? 0) - dt);
      if (!kart.item) continue;
      kart.aiItemTimer -= dt;
      if (kart.aiItemTimer > 0) continue;
      const delay = this.difficulty?.itemDelay ?? 1;
      kart.aiItemTimer = (0.8 + Math.random() * 1.1) * delay;
      if (this.shouldAIUse(kart)) this.useItem(kart);
    }
  }

  shouldAIUse(kart) {
    const item = kart.item;
    const tuning = this.difficulty ?? {};
    if (item === 'IMPULSO') {
      const impulseChance = clamp(tuning.impulseChance ?? 0.7, 0, 1);
      const heading = this.track.headingAt(kart.trackS);
      const ahead = this.track.headingAt(kart.trackS + 26);
      const straight = Math.abs(angleDiff(heading, ahead)) < 0.3;
      if (straight && Math.abs(kart.speed) > 14) {
        return Math.random() < Math.min(0.98, impulseChance + 0.2);
      }
      const rivalAhead = this.karts.some(
        (other) =>
          other !== kart &&
          !other.finished &&
          other.progress - kart.progress > 2 &&
          other.progress - kart.progress < 22,
      );
      return rivalAhead && Math.random() < impulseChance * 0.7;
    }

    if (item === 'PULSO') {
      const pulseChance = clamp(tuning.pulseChance ?? 0.7, 0, 1);
      const nearby = this.karts.some(
        (other) =>
          other !== kart &&
          !other.finished &&
          this.distanceTo(kart, other) < ITEMS.PULSO.radius - 1,
      );
      return nearby && Math.random() < pulseChance;
    }

    if (item === 'BARRERA') {
      const barrierChance = clamp(tuning.barrierChance ?? 0.7, 0, 1);
      const threatened = this.karts.some((other) => {
        if (other === kart || other.finished) return false;
        const gap = other.progress - kart.progress;
        return gap > -12 && gap < 6 && this.distanceTo(kart, other) < 14;
      });
      return threatened && Math.random() < barrierChance;
    }

    if (item === 'MINA') {
      const mineChance = clamp(tuning.mineChance ?? 0.6, 0, 1);
      const chased = this.karts.some((other) => {
        if (other === kart || other.finished) return false;
        const gap = kart.progress - other.progress;
        return gap > 1 && gap < 18 && this.distanceTo(kart, other) < 14;
      });
      return chased && Math.random() < mineChance;
    }

    if (item === 'FURIA') {
      if ((kart.aiProjectileCooldown ?? 0) > 0) return false;
      const target = chooseProjectileTarget(kart, this.karts, this.track, {
        projectileRange: tuning.furiaRange ?? 32,
        projectileAngle: tuning.furiaAngle ?? 0.24,
        projectileAimMargin: tuning.furiaAimMargin ?? tuning.projectileAimMargin ?? 2.5,
      });
      if (!target) return false;
      const chance = clamp(tuning.furiaChance ?? 0.55, 0, 1);
      return Math.random() < chance;
    }

    if (item === 'PULSO_IMPACTO') {
      if ((kart.aiProjectileCooldown ?? 0) > 0) return false;
      const target = chooseProjectileTarget(kart, this.karts, this.track, tuning);
      if (!target) return false;
      const chance = clamp(tuning.projectileChance ?? 0.55, 0, 1);
      return Math.random() < chance;
    }

    return false;
  }

  distanceTo(a, b) {
    return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
  }

  /**
   * Usa el objeto equipado. Devuelve su id o null si no había objeto,
   * el kart ya terminó o está en recarga.
   */
  useItem(kart) {
    // En online la petición viaja al servidor; no se aplica nada por cuenta propia.
    if (this.onlineMode) return null;
    if (!kart.item || kart.finished || kart.itemUseCooldown > 0) return null;
    const id = kart.item;
    const def = ITEMS[id];
    kart.item = null;
    kart.itemUseCooldown = 0.7;

    if (id === 'IMPULSO') {
      kart.applyItemBoost(def.power, def.duration);
    } else if (id === 'BARRERA') {
      kart.applyBarrier(def.duration);
    } else if (id === 'MINA') {
      if (!this.spawnMine(kart)) {
        // Sin un punto válido detrás del kart, el objeto no se pierde.
        kart.item = id;
        kart.itemUseCooldown = 0;
        return null;
      }
    } else if (id === 'PULSO') {
      this.spawnWave(kart);
      for (const other of this.karts) {
        if (other === kart || other.finished) continue;
        if (this.distanceTo(kart, other) > def.radius) continue;
        other.applySlow(def.slowFactor, def.slowDuration);
        if (this.onSlow) this.onSlow(other);
      }
    } else if (id === 'FURIA') {
      // Ráfaga reutilizando el mismo sistema de proyectiles.
      const count = def.volley ?? 3;
      let fired = 0;
      for (let i = 0; i < count; i += 1) {
        const offset = (i - (count - 1) / 2) * (def.spread ?? 0.075);
        const projectile = this.spawnProjectile(kart, 'FURIA', offset, i === 0);
        if (projectile) fired += 1;
      }
      if (fired === 0) {
        kart.item = id;
        kart.itemUseCooldown = 0;
        return null;
      }
    } else if (id === 'PULSO_IMPACTO') {
      if (!this.spawnProjectile(kart, 'PULSO_IMPACTO')) {
        // Si no hay un punto de salida válido, el objeto no se pierde.
        kart.item = id;
        kart.itemUseCooldown = 0;
        return null;
      }
    }

    if (this.onUse) this.onUse(kart, id);
    return id;
  }

  spawnWave(kart) {
    // La onda debe quedar justo sobre el asfalto. Con una altura fija quedaría
    // enterrada en las zonas elevadas de la pista y no se vería.
    const groundY = Number.isFinite(kart?.groundY) ? kart.groundY : (kart?.position?.y ?? 0);
    this.spawnWaveAt(kart.position.x, kart.position.z, {
      color: 0x5fe6ff,
      radius: ITEMS.PULSO.radius,
      duration: 0.65,
      y: groundY + 0.14,
    });
  }

  /** Onda expansiva reutilizable (PULSO, explosión de MINA, etc.). */
  spawnWaveAt(x, z, options = {}) {
    const {
      color = 0x5fe6ff,
      radius = 16,
      duration = 0.65,
      opacity = 0.7,
      y = 0.14,
    } = options;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.ringGeometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(1.4);
    this.group.add(mesh);
    this.waves.push({
      mesh,
      material,
      life: 0,
      duration,
      radius,
      opacity,
    });
  }

  dispose() {
    this.clearProjectiles();
    this.clearMines();
    this.clearBursts();
    this.clearSparks();
    for (const wave of this.waves) {
      this.group.remove(wave.mesh);
      wave.material.dispose();
    }
    this.waves.length = 0;
    this.scene.remove(this.group);
    this.boxGeometry.dispose();
    this.boxHaloGeometry.dispose();
    this.boxShellGeometry.dispose();
    for (const texture of this.boxTextures) texture.dispose();
    for (const material of this.boxMaterials.values()) material.dispose();
    for (const material of this.boxHaloMaterials.values()) material.dispose();
    for (const material of this.boxShellMaterials.values()) material.dispose();
    this.boxTextures.length = 0;
    this.boxMaterials.clear();
    this.boxHaloMaterials.clear();
    this.boxShellMaterials.clear();
    this.ringGeometry.dispose();
    this.projectileCoreGeometry.dispose();
    this.projectileShellGeometry.dispose();
    this.projectileRingGeometry.dispose();
    this.projectileCoreMaterial.dispose();
    this.projectileShellMaterial.dispose();
    this.projectileRingMaterial.dispose();
    this.furiaCoreGeometry.dispose();
    this.furiaShellGeometry.dispose();
    this.furiaRingGeometry.dispose();
    this.furiaCoreMaterial.dispose();
    this.furiaShellMaterial.dispose();
    this.furiaRingMaterial.dispose();
    this.pulseTailGeometry.dispose();
    this.furiaTailGeometry.dispose();
    this.pulseTailMaterial.dispose();
    this.furiaTailMaterial.dispose();
    this.mineBaseGeometry.dispose();
    this.mineDomeGeometry.dispose();
    this.mineRingGeometry.dispose();
    this.mineSpikeGeometry.dispose();
    this.mineBeaconGeometry.dispose();
    this.mineIndicatorGeometry.dispose();
    this.mineBaseMaterial.dispose();
    this.mineBodyMaterial.dispose();
    this.mineBeaconMaterial.dispose();
    this.burstSphereGeometry.dispose();
    this.burstRingGeometry.dispose();
    this.burstHitMaterial.dispose();
    this.burstBlockedMaterial.dispose();
  }
}
