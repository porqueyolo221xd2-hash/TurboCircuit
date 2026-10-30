// IA de los rivales: perfiles distintos, anticipación de curvas, adelantamientos
// laterales dentro del asfalto y recuperación marcha atrás sin teletransportes.
// La conducción combina una trazada exterior-vértice-exterior, frenada progresiva
// y derrapes encadenados con el turbo cuando el perfil lo permite.
import { angleDiff, clamp, damp } from './utils.js';

const DEFAULT_PROFILE = {
  lane: 0,
  lookAheadBias: 0,
  cornerSpeed: 0.45,
  cornerCaution: 1,
  aggression: 0.5,
  precision: 0.9,
  mistakeChance: 0.08,
};

export function computeAIControls(kart, track, context = {}) {
  const dt = clamp(context.dt ?? 1 / 60, 0.001, 0.05);
  const karts = context.karts ?? [];
  const raceTime = context.raceTime ?? 0;
  const profile = kart.aiProfile ?? DEFAULT_PROFILE;
  const tuning = context.difficulty ?? null;
  const aggression = profile.aggression * (tuning?.aggression ?? 1);
  const precision = profile.precision * (tuning?.precision ?? 1);
  const mistakeChance = clamp(profile.mistakeChance * (tuning?.mistakeChance ?? 1), 0, 1);
  const mistakeAmplitude = 0.32 * (tuning?.mistakeAmplitude ?? 1);
  const lookAheadBias = profile.lookAheadBias + (tuning?.lookAheadBias ?? 0);
  const cornerGrip = clamp(tuning?.cornerGrip ?? 0.8, 0.2, 1.02);
  const brakeMargin = Math.max(0.8, tuning?.brakeMargin ?? 1.3);
  const cornerFloor = clamp(tuning?.cornerFloor ?? 0.24, 0.1, 0.5);
  const anticipation = clamp(tuning?.anticipation ?? 1, 0.75, 1.4);
  const apexLine = clamp(tuning?.apexLine ?? 0, 0, 1);
  const driftChance = clamp(tuning?.driftChance ?? 0, 0, 1);
  const recoveryThreshold = tuning?.recoveryThreshold ?? 1.1;
  const recoveryTime = tuning?.recoveryTime ?? 1;
  const halfWidth = track.halfWidth;
  // Ruta activa: la IA sigue su propio camino, no el centro de la pista.
  const activeRoute = kart.route && track.routesById ? track.routesById.get(kart.route) ?? null : null;
  const routeId = activeRoute?.id ?? null;
  const routeHalfWidth = activeRoute?.halfWidth ?? track.halfWidth;
  // Los rivales se quedan lejos del borde: si no, acaban en el césped o el muro.
  const laneLimit = Math.max(2.6, Math.min(routeHalfWidth - 2.2, 5.4));

  if (kart.aiOvertakeTimer > 0) {
    kart.aiOvertakeTimer = Math.max(0, kart.aiOvertakeTimer - dt);
  }
  if (kart.aiOvertakeCooldown > 0) {
    kart.aiOvertakeCooldown = Math.max(0, kart.aiOvertakeCooldown - dt);
  }
  if (kart.aiMistakeTime > 0) {
    kart.aiMistakeTime = Math.max(0, kart.aiMistakeTime - dt);
  }
  if (kart.aiDriftCooldown > 0) {
    kart.aiDriftCooldown = Math.max(0, kart.aiDriftCooldown - dt);
  }
  kart.aiMistakeCooldown = Math.max(0, kart.aiMistakeCooldown - dt);

  // -------------------------------------------------------------------------
  // Recuperación: si lleva demasiado tiempo bloqueado, retrocede y se recoloca.
  // No se mueve la posición a mano ni se regala progreso.
  // -------------------------------------------------------------------------
  const offTrack = Math.abs(kart.lateral) > routeHalfWidth + 0.25;
  const crawling = Math.abs(kart.speed) < 2.2;
  if (
    kart.aiRecoveryTime <= 0 &&
    (kart.stuckTime > recoveryThreshold ||
      (offTrack && crawling && kart.stuckTime > recoveryThreshold * 0.6))
  ) {
    kart.aiRecoveryTime = (0.72 + Math.random() * 0.33) * recoveryTime;
    kart.stuckTime = 0;
    kart.aiOvertakeTimer = 0;
    kart.aiDriftHold = 0;
  }

  if (kart.aiRecoveryTime > 0) {
    kart.aiRecoveryTime -= dt;
    const targetHeading = track.headingAt(kart.trackS + 4, routeId);
    const diff = angleDiff(kart.heading, targetHeading);
    // Con velocidad negativa el sentido del giro se invierte; por eso el signo
    // de la dirección es directo respecto al ángulo que falta por corregir.
    return {
      throttle: 0,
      brake: 1,
      steer: clamp(diff * 1.7, -1, 1),
      drift: false,
    };
  }

  // -------------------------------------------------------------------------
  // Bifurcaciones: cada rival decide una vez por carrera si toma el ramal.
  // La decisión se mantiene (sin bandazos) y solo se toma desde la principal.
  // -------------------------------------------------------------------------
  const sNow = kart.trackS;
  let navRouteId = routeId;
  if (track.routes?.length) {
    if (!kart.aiRoutePlan) kart.aiRoutePlan = new Map();
    if (kart.aiRouteIntent && kart.aiRouteIntent === routeId) kart.aiRouteIntent = null;
    for (const branch of track.routes) {
      if (!kart.aiRoutePlan.has(branch.id)) {
        const riskPenalty = clamp(1 - (branch.risk ?? 0.5) * 0.6, 0.25, 1);
        const chance = clamp(
          (0.24 + aggression * 0.4 + precision * 0.12) * riskPenalty,
          0.05,
          0.88,
        );
        kart.aiRoutePlan.set(branch.id, Math.random() < chance);
      }
      if (routeId !== null) continue;
      const ahead = track.wrapDelta(branch.enterS - sNow);
      if (
        kart.aiRoutePlan.get(branch.id) &&
        ahead > -4 &&
        ahead < 70
      ) {
        kart.aiRouteIntent = branch.id;
      } else if (kart.aiRouteIntent === branch.id && ahead < -6) {
        // No llegó a entrar: se abandona la idea y se sigue por la principal.
        kart.aiRouteIntent = null;
      }
    }
    if (kart.aiRouteIntent) navRouteId = kart.aiRouteIntent;
  }

  // -------------------------------------------------------------------------
  // Buscar el rival más cercano por delante (progreso continuo, no distancia).
  // -------------------------------------------------------------------------
  let nearestAhead = null;
  let nearestGap = Infinity;
  for (const other of karts) {
    if (other === kart) continue;
    const gap = other.progress - kart.progress;
    if (gap > 0.8 && gap < 18 && gap < nearestGap) {
      nearestGap = gap;
      nearestAhead = other;
    }
  }

  // Iniciar un adelantamiento si hay hueco y el perfil es lo bastante decidido.
  // La decisión se toma cada cierto tiempo (no en cada fotograma) para que la
  // agresividad marque una diferencia real entre dificultades.
  if (
    kart.aiOvertakeTimer <= 0 &&
    nearestAhead &&
    nearestGap < 12 + clamp(aggression, 0, 1.4) * 5 &&
    kart.aiOvertakeCooldown <= 0
  ) {
    kart.aiOvertakeCooldown = 0.55 + Math.random() * 0.55;
    const lateralGap = nearestAhead.lateral - kart.lateral;
    if (Math.abs(lateralGap) < 3.4) {
      // Se pasa por el lado contrario al que ocupa el rival, si hay sitio.
      let side = nearestAhead.lateral <= 0.2 ? 1 : -1;
      const roomRight = laneLimit - nearestAhead.lateral;
      const roomLeft = laneLimit + nearestAhead.lateral;
      if ((side > 0 ? roomRight : roomLeft) < 2.6) side = -side;

      const offset = 3.1 + clamp(aggression, 0, 1.3) * 0.5;
      const candidate = clamp(
        nearestAhead.lateral + side * offset,
        -laneLimit,
        laneLimit,
      );
      const laneBusy = karts.some(
        (other) =>
          other !== kart &&
          other !== nearestAhead &&
          Math.abs(other.progress - kart.progress) < 4.5 &&
          Math.abs(other.lateral - candidate) < 2.1,
      );
      const chance = clamp(0.34 + aggression * 0.6, 0.2, 0.98);
      if (!laneBusy && Math.random() < chance) {
        kart.aiOvertakeSide = side;
        kart.aiOvertakeLane = candidate;
        kart.aiOvertakeTimer = 1.6 + Math.random() * 1.2;
      }
    }
  }

  if (kart.aiOvertakeTimer > 0 && nearestAhead && nearestGap < 22) {
    kart.aiOvertakeLane = clamp(
      nearestAhead.lateral + kart.aiOvertakeSide * (3.1 + clamp(aggression, 0, 1.3) * 0.5),
      -laneLimit,
      laneLimit,
    );
  }

  // -------------------------------------------------------------------------
  // Curvatura próxima. Las tres ventanas miden cuánto gira el trazado delante
  // y permiten frenar antes de entrar, no dentro de la curva.
  // -------------------------------------------------------------------------
  const s = kart.trackS;
  const bendBetween = (near, far) =>
    Math.abs(
      angleDiff(
        track.headingAt(s + near * anticipation, navRouteId),
        track.headingAt(s + far * anticipation, navRouteId),
      ),
    );
  const nearBend = bendBetween(4, 18);
  const midBend = bendBetween(15, 31);
  const farBend = bendBetween(28, 46);
  const bend = Math.max(nearBend, midBend, farBend);
  const severity = clamp(bend / 0.9, 0, 1);

  // -------------------------------------------------------------------------
  // Carril objetivo: base con vaivén suave, adelantamiento o trazada de curva.
  // -------------------------------------------------------------------------
  let cornerDir = 0;
  if (Math.abs(kart.speed) > 6 && severity > 0.06) {
    cornerDir = Math.sign(
      angleDiff(
        track.headingAt(s + 4 * anticipation, navRouteId),
        track.headingAt(s + 18 * anticipation, navRouteId),
      ),
    );
    if (cornerDir === 0) {
      cornerDir = Math.sign(
        angleDiff(
          track.headingAt(s + 18 * anticipation, navRouteId),
          track.headingAt(s + 34 * anticipation, navRouteId),
        ),
      );
    }
  }

  const weave = Math.sin(raceTime * 0.28 + kart.aiPhase) * 0.34;
  let targetLane = clamp(kart.aiLaneBase + weave, -laneLimit, laneLimit);

  if (Math.abs(kart.lateral) > routeHalfWidth - 0.3) {
    // Fuera del asfalto: vuelve hacia el centro sin cruzar la pista de golpe.
    targetLane = clamp(kart.lateral * 0.2, -2.6, 2.6);
  } else if (kart.aiOvertakeTimer > 0) {
    targetLane = clamp(kart.aiOvertakeLane, -laneLimit, laneLimit);
  } else if (cornerDir !== 0) {
    const inside = -cornerDir;
    const strength = clamp(severity / 0.65, 0, 1) * apexLine * laneLimit;
    let line = inside * strength * 0.88;

    // Entrada ancha: si la curva fuerte todavía está delante, se abre.
    const entry = clamp((farBend - nearBend) / 0.28, 0, 1);
    if (entry > 0.15) line -= inside * strength * 0.55 * entry;

    // Salida ancha: cuando el vértice ya queda atrás, deja correr el kart.
    const exit = clamp((nearBend - farBend) / 0.3, 0, 1);
    if (exit > 0.2) line -= inside * strength * 0.4 * exit;

    targetLane = clamp(targetLane + line, -laneLimit, laneLimit);
  }

  // -------------------------------------------------------------------------
  // Obstáculos móviles: se predice dónde estarán al llegar y se abre hueco.
  // Sin hueco disponible, se levanta el pie para que el obstáculo se mueva.
  // -------------------------------------------------------------------------
  const obstacles = track.features?.obstacles ?? [];
  let dodging = false;
  let obstacleBrake = 1;
  if (obstacles.length > 0) {
    const speedNow = Math.abs(kart.speed);
    let blocked = null;
    let blockedGap = Infinity;
    for (const obstacle of obstacles) {
      const delta = track.featureDelta ? track.featureDelta(obstacle, kart) : null;
      if (delta === null) continue;
      const gapAhead = -delta;
      if (gapAhead < 2 || gapAhead > 34) continue;
      const reach = gapAhead / Math.max(9, speedNow);
      const predicted =
        obstacle.baseLateral +
        Math.sin((raceTime + reach) * obstacle.speed + obstacle.phase) * obstacle.amplitude;
      const clearance = obstacle.width / 2 + 1.75;
      if (Math.abs(predicted - kart.aiLaneCurrent) > clearance) continue;
      if (gapAhead < blockedGap) {
        blocked = { width: obstacle.width, predicted, gapAhead, clearance };
        blockedGap = gapAhead;
      }
    }

    if (blocked) {
      const halfClear = blocked.width / 2 + 2.35;
      const options = [blocked.predicted - halfClear, blocked.predicted + halfClear]
        .filter((lane) => Math.abs(lane) <= laneLimit)
        .sort(
          (a, b) =>
            Math.abs(a - kart.aiLaneCurrent) - Math.abs(b - kart.aiLaneCurrent),
        );
      const lane = options.find(
        (candidate) => Math.abs(candidate - blocked.predicted) >= blocked.clearance,
      );
      if (lane !== undefined) {
        targetLane = lane;
        dodging = true;
      } else {
        obstacleBrake = blocked.gapAhead < 14 ? 0.6 : 0.82;
      }
    }
  }

  kart.aiLaneCurrent = damp(kart.aiLaneCurrent, targetLane, dodging ? 5.4 : 2.8, dt);

  // -------------------------------------------------------------------------
  // Velocidad objetivo. Se tiene en cuenta el turbo y el IMPULSO activos para
  // no frenar justo cuando el kart acaba de ganar velocidad punta.
  // -------------------------------------------------------------------------
  const boost = Math.max(
    kart.turboActive ? kart.turboPower : 0,
    kart.itemBoostTime > 0 ? kart.itemBoostPower : 0,
  );
  const slow = kart.slowTime > 0 ? kart.slowFactor : 1;
  const pace = kart.speedBias * kart.paceFactor;
  const maxSpeed = kart.maxSpeed * pace * (1 + boost) * slow;

  // Velocidad máxima real de paso por curva. El kart gira a
  // ω = turnRate · (1 − 0,32·v/vmax), y para seguir un arco de curvatura κ
  // necesita ω = v·κ. Despejando: v = turnRate / (κ + 0,32·turnRate/vmax).
  // No es una regla inventada: sale de la física que aplica Kart.step().
  const geometrySpeed = (kappa) => {
    if (kappa < 1e-4) return Infinity;
    return kart.turnRate / (kappa + (kart.turnRate * 0.32) / Math.max(1, kart.maxSpeed));
  };

  // Perfil de frenada: se mira la curvatura por delante y se calcula a qué
  // velocidad habría que ir AHORA para llegar a cada punto a la velocidad de
  // paso. Así se frena tarde pero a tiempo, en vez de arrastrarse toda la curva.
  const brakeAccel = Math.max(8, (kart.brakePower ?? 38) * 0.88) / brakeMargin;
  const probeDistances = [2, 8, 15, 24, 36, 52, 72];
  let targetSpeed = maxSpeed;
  for (const distance of probeDistances) {
    const kappa = track.curvatureAt(s + distance * anticipation, navRouteId);
    if (!Number.isFinite(kappa) || kappa < 1e-4) continue;
    const cornerSpeed = geometrySpeed(kappa) * cornerGrip;
    const allowed = Math.sqrt(
      cornerSpeed * cornerSpeed + 2 * brakeAccel * Math.max(0, distance - 3),
    );
    if (allowed < targetSpeed) targetSpeed = allowed;
  }
  targetSpeed = Math.max(targetSpeed, maxSpeed * cornerFloor);

  if (kart.onGrass) targetSpeed *= 0.72;
  if (kart.finished) targetSpeed *= 0.6;
  targetSpeed *= obstacleBrake;

  // No empotrarse contra el kart que va justo delante si aún no hay hueco.
  if (nearestAhead && nearestGap < 7) {
    const lateralGap = Math.abs(kart.aiLaneCurrent - nearestAhead.lateral);
    if (lateralGap < 2) {
      const keep = clamp(0.88 + aggression * 0.08, 0.9, 0.995);
      targetSpeed = Math.min(
        targetSpeed,
        Math.max(6, Math.abs(nearestAhead.speed) * keep),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Errores ocasionales: pequeños y recuperables, nunca un volantazo permanente.
  // -------------------------------------------------------------------------
  if (kart.aiMistakeCooldown <= 0) {
    kart.aiMistakeCooldown = 6 + Math.random() * 8;
    if (
      Math.random() < mistakeChance &&
      Math.abs(kart.lateral) < routeHalfWidth - 1.8
    ) {
      kart.aiMistakeTime = 0.35 + Math.random() * 0.4;
    }
  }
  let mistakeSteer = 0;
  if (kart.aiMistakeTime > 0) {
    mistakeSteer = Math.sin(raceTime * 12 + kart.aiPhase) * mistakeAmplitude;
    targetSpeed *= 0.9;
  }

  // -------------------------------------------------------------------------
  // Derrape de la IA: empieza con una probabilidad propia del perfil, se
  // mantiene mientras dure la curva y se suelta al salir para cobrar el turbo.
  // -------------------------------------------------------------------------
  const speedAbs = Math.abs(kart.speed);
  let drift = false;
  const driftAllowed =
    driftChance > 0 &&
    !kart.onGrass &&
    !kart.wallContact &&
    speedAbs > 13 &&
    Math.abs(kart.lateral) < routeHalfWidth - 1.5 &&
    kart.aiMistakeTime <= 0;

  if (kart.aiDriftHold > 0) {
    kart.aiDriftHold = Math.max(0, kart.aiDriftHold - dt);
    if (driftAllowed && severity > 0.3 && kart.aiDriftHold > 0) {
      drift = true;
    } else {
      kart.aiDriftHold = 0;
      kart.aiDriftCooldown = Math.max(
        kart.aiDriftCooldown,
        2 + Math.random() * 1.6,
      );
    }
  } else if (driftAllowed && severity > 0.44 && kart.aiDriftCooldown <= 0) {
    if (Math.random() < driftChance) {
      // La IA mantiene el derrape el tiempo suficiente para cargar turbo;
      // lo suelta al abrirse la curva o si pierde el control.
      kart.aiDriftHold = 2.6 + severity * 1.4;
      kart.aiDriftCooldown = 3.2 + Math.random() * 2.4;
      drift = true;
    } else {
      kart.aiDriftCooldown = 0.7 + Math.random() * 1.1;
    }
  }

  // -------------------------------------------------------------------------
  // Dirección: persecución pura de un punto del trazado en el carril actual.
  // -------------------------------------------------------------------------
  let lookAhead = 9.5 + Math.min(16, speedAbs * 0.58) + lookAheadBias;
  if (kart.onGrass) lookAhead = Math.min(lookAhead, 11);

  const aimLane = kart.aiRouteIntent && routeId === null ? 0 : kart.aiLaneCurrent;
  let aim = null;
  if (kart.aiRouteIntent && routeId === null) {
    const branch = track.routesById?.get(kart.aiRouteIntent);
    if (branch) aim = track.posAt(branch.enterS + 16, 0, branch.id);
  }
  if (!aim) aim = track.posAt(s + lookAhead, aimLane, navRouteId);
  const dx = aim.x - kart.position.x;
  const dz = aim.z - kart.position.z;
  const desiredHeading = Math.atan2(dx, dz);
  const diff = angleDiff(kart.heading, desiredHeading);
  let steer = clamp(
    -diff * (2.7 + precision * 1.15) + mistakeSteer,
    -1,
    1,
  );
  // Durante el derrape se añade un poco de volante hacia el interior: con el
  // giro extra del derrape, el kart necesita una entrada decidida para cargar
  // el turbo, igual que haría un piloto humano.
  if (drift && cornerDir !== 0) {
    steer = clamp(
      steer * 0.15 - cornerDir * (0.28 + severity * 0.04),
      -1,
      1,
    );
  }

  // -------------------------------------------------------------------------
  // Acelerador y freno. Se mantiene el gas cuando la diferencia es pequeña y
  // solo se frena de verdad si el kart llega pasado a la curva.
  // -------------------------------------------------------------------------
  const error = targetSpeed - speedAbs;
  let throttle = 0;
  let brake = 0;
  if (error >= -0.5) {
    throttle = 1;
  } else if (error >= -2) {
    brake = clamp(-error / 8, 0, 0.25);
  } else {
    brake = clamp((-error - 1.5) / 8, 0.25, 1);
  }

  return { throttle, brake, steer, drift };
}
