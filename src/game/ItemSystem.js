// Cajas de objetos, inventario de un solo uso, ondas, proyectiles y efectos temporales.
// Todo se genera con geometrías simples y temporizadores que siempre expiran.
import * as THREE from 'three';
import { ITEMS, randomItem } from './items.js';
import { angleDiff, clamp } from './utils.js';

const ROW_GAP = 120;
const ROW_COUNT = 6;
const ROW_OFFSET = 70;
const BOX_LANES = [-4.6, 0, 4.6];
const BOX_RESPAWN = 5;
const PICKUP_RADIUS = 2.1;

const PROJECTILE_LIMIT = 10;
const PROJECTILE_SPAWN_AHEAD = 2.3;
const PROJECTILE_HEIGHT = 1.05;
const PROJECTILE_WALL_MARGIN = 0.7;
const BURST_DURATION = 0.36;

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
export function lineOfSightClear(track, from, to, margin = 0.8) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.ceil(distance / 4));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const projection = track.project({
      x: from.x + dx * t,
      z: from.z + dz * t,
    });
    if (Math.abs(projection.lateral) > track.wallOffset - margin) return false;
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
    if (!lineOfSightClear(track, kart.position, other.position)) continue;

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
    this.effects = [];
    this.time = 0;
    this.onPickup = null;
    this.onUse = null;
    this.onSlow = null;
    this.onProjectileFired = null;
    this.onProjectileHit = null;
    this.difficulty = null;

    this.group = new THREE.Group();
    this.group.name = 'sistema-objetos';
    this.scene.add(this.group);

    this.boxGeometry = new THREE.BoxGeometry(1.15, 1.15, 1.15);
    this.boxMaterial = new THREE.MeshStandardMaterial({
      color: 0x7ff4ff,
      emissive: 0x1fa8c8,
      emissiveIntensity: 0.9,
      roughness: 0.3,
      metalness: 0.4,
    });
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
    for (let row = 0; row < ROW_COUNT; row += 1) {
      const s = this.track.startS + ROW_OFFSET + row * ROW_GAP;
      for (const lane of BOX_LANES) {
        const point = this.track.posAt(s, lane);
        const mesh = new THREE.Mesh(this.boxGeometry, this.boxMaterial);
        mesh.position.set(point.x, 0.95, point.z);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.boxes.push({
          mesh,
          active: true,
          respawn: 0,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
  }

  reset() {
    this.time = 0;
    for (const box of this.boxes) {
      box.active = true;
      box.respawn = 0;
      box.mesh.visible = true;
      box.mesh.scale.setScalar(1);
    }
    this.clearEffects();
    for (const kart of this.karts) kart.clearItemState();
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
    if (!keepProjectiles) this.clearProjectiles();
    for (const kart of this.karts) kart.clearItemState();
  }

  clearProjectiles() {
    for (const projectile of this.projectiles) {
      this.group.remove(projectile.mesh);
    }
    this.projectiles.length = 0;
  }

  clearBursts() {
    for (const effect of this.effects) {
      this.group.remove(effect.group);
      effect.material.dispose();
    }
    this.effects.length = 0;
  }

  update(dt, karts = this.karts) {
    this.time += dt;
    this.updateBoxes(dt, karts);
    this.updateWaves(dt);
    this.updateProjectiles(dt, karts);
    this.updateBursts(dt);
    this.updateAI(dt, karts);
  }

  updateBoxes(dt, karts) {
    for (const box of this.boxes) {
      if (!box.active) {
        box.respawn -= dt;
        if (box.respawn <= 0) {
          box.active = true;
          box.mesh.visible = true;
          box.mesh.scale.setScalar(0.05);
        }
        continue;
      }

      if (box.mesh.scale.x < 1) {
        box.mesh.scale.setScalar(Math.min(1, box.mesh.scale.x + dt * 4));
      }
      box.mesh.rotation.y += dt * 1.7;
      box.mesh.rotation.x += dt * 0.55;
      box.mesh.position.y = 0.95 + Math.sin(this.time * 2 + box.phase) * 0.12;

      for (const kart of karts) {
        if (kart.finished || kart.item || kart.pickupCooldown > 0) continue;
        const dx = kart.position.x - box.mesh.position.x;
        const dz = kart.position.z - box.mesh.position.z;
        if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS) continue;

        // Un kart con objeto no consume más cajas: evita recogidas encadenadas.
        kart.item = randomItem();
        kart.pickupCooldown = 0.6;
        kart.aiItemTimer = 0.7 + Math.random() * 0.9;
        box.active = false;
        box.respawn = BOX_RESPAWN;
        box.mesh.visible = false;
        if (this.onPickup) this.onPickup(kart, kart.item);
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
      wave.material.opacity = 0.7 * (1 - t);
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
   * Lanza un PULSO DE IMPACTO desde delante del kart y en su orientación actual.
   * La dirección y la posición quedan congeladas: no se mueve con el kart.
   */
  spawnProjectile(kart) {
    if (!kart) return null;

    const def = ITEMS.PULSO_IMPACTO;
    const forwardX = Math.sin(kart.heading);
    const forwardZ = Math.cos(kart.heading);
    let x = kart.position.x + forwardX * PROJECTILE_SPAWN_AHEAD;
    let z = kart.position.z + forwardZ * PROJECTILE_SPAWN_AHEAD;
    let spawnProjection = this.track.project({ x, z });

    // Si el kart está pegado al muro, el morro puede quedar fuera: se prueba
    // un punto algo más cercano antes de descartar el disparo.
    if (Math.abs(spawnProjection.lateral) > this.track.wallOffset - PROJECTILE_WALL_MARGIN) {
      for (const ahead of [1.4, 0.7]) {
        const testX = kart.position.x + forwardX * ahead;
        const testZ = kart.position.z + forwardZ * ahead;
        const testProjection = this.track.project({ x: testX, z: testZ });
        if (Math.abs(testProjection.lateral) <= this.track.wallOffset - PROJECTILE_WALL_MARGIN) {
          x = testX;
          z = testZ;
          spawnProjection = testProjection;
          break;
        }
      }
    }
    if (Math.abs(spawnProjection.lateral) > this.track.wallOffset - PROJECTILE_WALL_MARGIN) {
      return null;
    }

    if (this.projectiles.length >= PROJECTILE_LIMIT) {
      // Nunca se acumulan indefinidamente: se retira el más antiguo.
      const oldest = this.projectiles.shift();
      this.group.remove(oldest.mesh);
    }

    const group = new THREE.Group();
    group.name = 'pulso-de-impacto';

    const core = new THREE.Mesh(this.projectileCoreGeometry, this.projectileCoreMaterial);
    const shell = new THREE.Mesh(this.projectileShellGeometry, this.projectileShellMaterial);
    const ring = new THREE.Mesh(this.projectileRingGeometry, this.projectileRingMaterial);
    ring.rotation.x = Math.PI / 2;
    group.add(core, shell, ring);
    group.position.set(x, PROJECTILE_HEIGHT, z);
    group.rotation.y = kart.heading;
    this.group.add(group);

    const projectile = {
      mesh: group,
      ring,
      owner: kart,
      x,
      z,
      directionX: forwardX,
      directionZ: forwardZ,
      traveled: 0,
      life: 0,
    };
    this.projectiles.push(projectile);

    if (!kart.isPlayer) {
      const cooldown = this.difficulty?.projectileCooldown ?? 2.4;
      kart.aiProjectileCooldown = cooldown;
    }
    if (this.onProjectileFired) this.onProjectileFired(kart, projectile);
    return projectile;
  }

  updateProjectiles(dt, karts) {
    const def = ITEMS.PULSO_IMPACTO;
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i];
      const previousX = projectile.x;
      const previousZ = projectile.z;
      const step = def.speed * dt;
      const nextX = previousX + projectile.directionX * step;
      const nextZ = previousZ + projectile.directionZ * step;

      projectile.life += dt;
      projectile.traveled += step;
      projectile.x = nextX;
      projectile.z = nextZ;
      projectile.mesh.position.set(
        nextX,
        PROJECTILE_HEIGHT + Math.sin(projectile.life * 17) * 0.07,
        nextZ,
      );
      projectile.mesh.rotation.y += dt * 6;
      projectile.ring.rotation.z += dt * 5;

      // Colisión barrida: evita atravesar un kart a velocidades altas.
      let hitKart = null;
      for (const kart of karts) {
        if (kart === projectile.owner || kart.finished) continue;
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
        }
        this.spawnBurst(nextX, nextZ, blocked);
        if (this.onProjectileHit) this.onProjectileHit(hitKart, projectile.owner, blocked);
        this.removeProjectileAt(i);
        continue;
      }

      const midX = (previousX + nextX) / 2;
      const midZ = (previousZ + nextZ) / 2;
      if (this.isOutsideTrack(nextX, nextZ) || this.isOutsideTrack(midX, midZ)) {
        this.spawnBurst(nextX, nextZ, false);
        this.removeProjectileAt(i);
        continue;
      }

      if (projectile.life >= def.life || projectile.traveled >= def.range) {
        // Al agotar alcance o duración desaparece sin dejar rastro.
        this.removeProjectileAt(i);
      }
    }
  }

  isOutsideTrack(x, z) {
    const projection = this.track.project({ x, z });
    return Math.abs(projection.lateral) > this.track.wallOffset - PROJECTILE_WALL_MARGIN;
  }

  removeProjectileAt(index) {
    const [projectile] = this.projectiles.splice(index, 1);
    if (projectile) this.group.remove(projectile.mesh);
  }

  spawnBurst(x, z, blocked = false) {
    // Material propio y pequeño por destello: se libera al terminar.
    const material = (blocked ? this.burstBlockedMaterial : this.burstHitMaterial).clone();
    const group = new THREE.Group();
    group.position.set(x, PROJECTILE_HEIGHT, z);
    const sphere = new THREE.Mesh(this.burstSphereGeometry, material);
    const ring = new THREE.Mesh(this.burstRingGeometry, material);
    ring.rotation.x = Math.PI / 2;
    group.add(sphere, ring);
    group.scale.setScalar(0.45);
    this.group.add(group);
    this.effects.push({
      group,
      material,
      life: 0,
      spin: blocked ? -5 : 7,
    });
  }

  updateBursts(dt) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.life += dt;
      const t = clamp(effect.life / BURST_DURATION, 0, 1);
      effect.group.scale.setScalar(0.45 + t * 2.3);
      effect.group.rotation.y += dt * effect.spin;
      effect.group.rotation.x += dt * effect.spin * 0.6;
      effect.material.opacity = (1 - t) * 0.78;
      if (t >= 1) {
        this.group.remove(effect.group);
        effect.material.dispose();
        this.effects.splice(i, 1);
      }
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
    if (!kart.item || kart.finished || kart.itemUseCooldown > 0) return null;
    const id = kart.item;
    const def = ITEMS[id];
    kart.item = null;
    kart.itemUseCooldown = 0.7;

    if (id === 'IMPULSO') {
      kart.applyItemBoost(def.power, def.duration);
    } else if (id === 'BARRERA') {
      kart.applyBarrier(def.duration);
    } else if (id === 'PULSO') {
      this.spawnWave(kart);
      for (const other of this.karts) {
        if (other === kart || other.finished) continue;
        if (this.distanceTo(kart, other) > def.radius) continue;
        other.applySlow(def.slowFactor, def.slowDuration);
        if (this.onSlow) this.onSlow(other);
      }
    } else if (id === 'PULSO_IMPACTO') {
      if (!this.spawnProjectile(kart)) {
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
    const material = new THREE.MeshBasicMaterial({
      color: 0x5fe6ff,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.ringGeometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(kart.position.x, 0.14, kart.position.z);
    mesh.scale.setScalar(1.4);
    this.group.add(mesh);
    this.waves.push({
      mesh,
      material,
      life: 0,
      duration: 0.65,
      radius: ITEMS.PULSO.radius,
    });
  }

  dispose() {
    this.clearProjectiles();
    this.clearBursts();
    for (const wave of this.waves) {
      this.group.remove(wave.mesh);
      wave.material.dispose();
    }
    this.waves.length = 0;
    this.scene.remove(this.group);
    this.boxGeometry.dispose();
    this.boxMaterial.dispose();
    this.ringGeometry.dispose();
    this.projectileCoreGeometry.dispose();
    this.projectileShellGeometry.dispose();
    this.projectileRingGeometry.dispose();
    this.projectileCoreMaterial.dispose();
    this.projectileShellMaterial.dispose();
    this.projectileRingMaterial.dispose();
    this.burstSphereGeometry.dispose();
    this.burstRingGeometry.dispose();
    this.burstHitMaterial.dispose();
    this.burstBlockedMaterial.dispose();
  }
}
