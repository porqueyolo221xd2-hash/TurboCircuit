// Pequeño motor de sonido con WebAudio: motor, derrape, turbo, pitidos de
// cuenta atrás y melodías finales. No usa archivos de audio externos.
const SOUND_STORAGE_KEY = 'turbo-circuit-sound-v1';

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Algunos navegadores bloquean localStorage en modo privado.
  }
  return null;
}

/** Preferencia de sonido persistida; por defecto activo. */
export function loadSoundPreference(storage = null) {
  const target = resolveStorage(storage);
  if (!target) return true;
  try {
    return target.getItem(SOUND_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Guarda el mute sin afectar al resto del progreso. */
export function saveSoundPreference(enabled, storage = null) {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(SOUND_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.oscA = null;
    this.oscB = null;
    this.engineActive = false;
    this.enabled = loadSoundPreference();

    // Capas continuas reutilizadas (nunca se crean por frame).
    this.noiseBuffer = null;
    this.skidSource = null;
    this.skidFilter = null;
    this.skidGain = null;
    this.turboOsc = null;
    this.turboFilter = null;
    this.turboGain = null;
  }

  ensure() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      try {
        this.ctx = new AudioContextClass();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.ctx.destination);
      } catch (error) {
        console.warn('WebAudio no disponible:', error);
        this.ctx = null;
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  startEngine() {
    const ctx = this.ensure();
    if (!ctx || this.engineGain) return;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 650;
    filter.Q.value = 1.2;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 52;

    const oscB = ctx.createOscillator();
    oscB.type = 'square';
    oscB.frequency.value = 78;
    oscB.detune.value = -7;

    const blend = ctx.createGain();
    blend.gain.value = 0.35;

    oscA.connect(filter);
    oscB.connect(blend);
    blend.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    oscA.start();
    oscB.start();

    this.oscA = oscA;
    this.oscB = oscB;
    this.engineFilter = filter;
    this.engineGain = gain;
    this.engineActive = true;
  }

  /** ratio: 0..1 según la velocidad; onGrass añade un matiz más áspero. */
  setEngine(ratio, onGrass = false) {
    if (!this.ctx || !this.engineGain || !this.engineActive) return;
    const now = this.ctx.currentTime;
    const value = Math.max(0, Math.min(1, ratio));
    const frequency = 48 + value * 165 + (onGrass ? 22 : 0);

    this.oscA.frequency.setTargetAtTime(frequency, now, 0.09);
    this.oscB.frequency.setTargetAtTime(frequency * 1.5, now, 0.09);
    this.engineFilter.frequency.setTargetAtTime(480 + value * 1400, now, 0.12);

    const volume = this.enabled ? 0.018 + value * 0.05 : 0;
    this.engineGain.gain.setTargetAtTime(volume, now, 0.09);
  }

  stopEngine() {
    this.engineActive = false;
    if (this.ctx && this.engineGain) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    }
  }

  resumeEngine() {
    this.engineActive = true;
  }

  /** Ruido marrón corto y reutilizable para derrape y golpes. */
  getNoiseBuffer() {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 1.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + white * 0.03) / 1.03;
      data[i] = last * 3.2;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  /** Crea una sola fuente en bucle para el derrape (se reutiliza siempre). */
  ensureSkid() {
    const ctx = this.ensure();
    if (!ctx || this.skidGain) return;
    const source = ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer();
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.8;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();

    this.skidSource = source;
    this.skidFilter = filter;
    this.skidGain = gain;
  }

  /** Intensidad 0..1 del derrape; 0 lo silencia suavemente. */
  setSkid(intensity, onGrass = false) {
    if (intensity > 0.02) this.ensureSkid();
    if (!this.skidGain) return;
    const now = this.ctx.currentTime;
    const value = this.enabled ? Math.max(0, Math.min(1, intensity)) : 0;
    const volume = value > 0.01 ? 0.018 + value * 0.055 : 0;
    this.skidGain.gain.setTargetAtTime(volume, now, 0.06);
    if (this.skidFilter) {
      const frequency = onGrass ? 760 : 1650;
      this.skidFilter.frequency.setTargetAtTime(frequency, now, 0.12);
    }
  }

  stopSkid() {
    if (!this.ctx || !this.skidGain) return;
    this.skidGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
  }

  /** Capa continua del turbo: sube de tono y volumen mientras dura. */
  ensureTurboLayer() {
    const ctx = this.ensure();
    if (!ctx || this.turboGain) return;
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = 76;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    oscillator.start();

    this.turboOsc = oscillator;
    this.turboFilter = filter;
    this.turboGain = gain;
  }

  /** ratio 0..1 = turbo restante; level 1 corto, 2 potente. */
  setTurbo(ratio, level = 1) {
    if (ratio > 0.01) this.ensureTurboLayer();
    if (!this.turboGain) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (!this.enabled || ratio <= 0.01) {
      this.turboGain.gain.setTargetAtTime(0, now, 0.06);
      return;
    }
    const value = Math.max(0, Math.min(1, ratio));
    const strong = level >= 2;
    this.turboOsc.frequency.setTargetAtTime(
      78 + value * 95 + (strong ? 26 : 0),
      now,
      0.08,
    );
    this.turboFilter.frequency.setTargetAtTime(
      520 + value * 900 + (strong ? 180 : 0),
      now,
      0.1,
    );
    this.turboGain.gain.setTargetAtTime(0.02 + value * 0.045, now, 0.07);
  }

  stopTurbo() {
    if (!this.ctx || !this.turboGain) return;
    this.turboGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  /** Golpe seco entre karts: grave y breve, sin tapar el motor. */
  bump(strength = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime + 0.005;
    const volume = 0.05 + Math.min(1, strength) * 0.05;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(110, now);
    oscillator.frequency.exponentialRampToValueAtTime(52, now + 0.16);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.23);
    this.tone(180, now, 0.07, volume * 0.45, 'triangle');
  }

  /** Roce con el muro: más áspero que un golpe entre karts. */
  wall(strength = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime + 0.005;
    const volume = 0.04 + Math.min(1, strength) * 0.05;
    this.tone(96, now, 0.13, volume, 'square');
    this.tone(240, now + 0.01, 0.07, volume * 0.5, 'sawtooth');
  }

  /** Aviso breve y agudo al ganar una posición. */
  overtake() {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime + 0.01;
    this.tone(660, now, 0.07, 0.05, 'triangle');
    this.tone(920, now + 0.06, 0.11, 0.055, 'triangle');
  }

  /** Melodía descendente para derrotas: misma familia que la victoria. */
  defeatJingle() {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime + 0.05;
    const notes = [
      [392, 0, 0.2],
      [329.63, 0.18, 0.2],
      [261.63, 0.36, 0.24],
      [196, 0.58, 0.5],
    ];
    for (const [frequency, offset, duration] of notes) {
      this.tone(frequency, now + offset, duration, 0.09, 'triangle');
    }
  }

  /** Pausa/reinicio: nada continuo debe quedar sonando. */
  stopAll() {
    this.stopEngine();
    this.stopSkid();
    this.stopTurbo();
  }

  tone(frequency, startAt, duration, volume = 0.12, type = 'square') {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.03);
  }

  beep(frequency = 480, duration = 0.12, volume = 0.1) {
    const ctx = this.ensure();
    if (!ctx) return;
    this.tone(frequency, ctx.currentTime + 0.01, duration, volume);
  }

  /** Breve subida de tono al liberar el turbo. */
  turbo(level = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime + 0.01;
    const strong = level >= 2;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(strong ? 155 : 190, now);
    oscillator.frequency.exponentialRampToValueAtTime(strong ? 390 : 330, now + 0.28);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(strong ? 0.1 : 0.075, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.4);
  }

  pickup() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime + 0.01;
    this.tone(784, now, 0.09, 0.07, 'triangle');
    this.tone(1046, now + 0.07, 0.1, 0.055, 'triangle');
  }

  /** Disparo breve del PULSO DE IMPACTO. volumeScale deja más suave el de la IA. */
  projectile(volumeScale = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime + 0.01;
    const volume = Math.max(0.01, Math.min(1, volumeScale));
    this.tone(680, now, 0.07, 0.075 * volume, 'triangle');
    this.tone(340, now + 0.05, 0.13, 0.06 * volume, 'sawtooth');
  }

  /** Golpe del proyectil o bloqueo por BARRERA, con timbres distintos. */
  impact(blocked = false) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime + 0.01;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = blocked ? 'triangle' : 'square';
    oscillator.frequency.setValueAtTime(blocked ? 260 : 190, now);
    oscillator.frequency.exponentialRampToValueAtTime(blocked ? 520 : 62, now + 0.2);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(blocked ? 0.06 : 0.085, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.27);
  }

  /** Disparo de la FURIA: ráfaga más grave y agresiva que el pulso normal. */
  furia(volumeScale = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime + 0.01;
    const volume = Math.max(0.01, Math.min(1, volumeScale));
    this.tone(920, now, 0.06, 0.075 * volume, 'sawtooth');
    this.tone(460, now + 0.035, 0.16, 0.065 * volume, 'square');
    this.tone(230, now + 0.11, 0.2, 0.05 * volume, 'sawtooth');
  }

  /** Clic metálico al desplegar una mina. */
  mine() {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime + 0.01;
    this.tone(190, now, 0.05, 0.06, 'square');
    this.tone(96, now + 0.04, 0.1, 0.05, 'triangle');
  }

  /** Explosión arcade de la mina: grave, corta y sin archivos externos. */
  mineBoom() {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime + 0.01;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(150, now);
    oscillator.frequency.exponentialRampToValueAtTime(36, now + 0.38);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.44);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.47);
    this.tone(78, now + 0.04, 0.3, 0.05, 'square');
  }

  /** Aturdimiento: pequeño tono descendente que acompaña a las estrellas. */
  stun() {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime + 0.01;
    this.tone(520, now, 0.1, 0.06, 'triangle');
    this.tone(330, now + 0.08, 0.18, 0.05, 'square');
    this.tone(220, now + 0.18, 0.22, 0.04, 'triangle');
  }

  item(kind) {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime + 0.01;
    if (kind === 'IMPULSO') {
      this.tone(523, now, 0.1, 0.08, 'sawtooth');
      this.tone(784, now + 0.08, 0.16, 0.07, 'sawtooth');
    } else if (kind === 'PULSO') {
      this.tone(440, now, 0.16, 0.08, 'square');
      this.tone(294, now + 0.12, 0.22, 0.07, 'square');
    } else if (kind === 'PULSO_IMPACTO') {
      this.projectile();
    } else if (kind === 'FURIA') {
      this.furia();
    } else if (kind === 'MINA') {
      this.mine();
    } else {
      this.tone(330, now, 0.12, 0.07, 'triangle');
      this.tone(440, now + 0.1, 0.2, 0.07, 'triangle');
    }
  }

  finishJingle() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime + 0.05;
    const notes = [
      [523.25, 0, 0.16],
      [659.25, 0.14, 0.16],
      [783.99, 0.28, 0.18],
      [1046.5, 0.44, 0.5],
    ];
    for (const [frequency, offset, duration] of notes) {
      this.tone(frequency, now + offset, duration, 0.11, 'triangle');
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    saveSoundPreference(this.enabled);
    if (!this.enabled) {
      if (this.ctx && this.engineGain) {
        this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      }
      this.stopSkid();
      this.stopTurbo();
    }
    return this.enabled;
  }

  dispose() {
    this.engineActive = false;
    try {
      if (this.oscA) this.oscA.stop();
      if (this.oscB) this.oscB.stop();
      if (this.skidSource) this.skidSource.stop();
      if (this.turboOsc) this.turboOsc.stop();
    } catch {
      // Los nodos ya podrían estar parados.
    }
    if (this.skidSource) this.skidSource.disconnect();
    if (this.skidFilter) this.skidFilter.disconnect();
    if (this.skidGain) this.skidGain.disconnect();
    if (this.turboOsc) this.turboOsc.disconnect();
    if (this.turboFilter) this.turboFilter.disconnect();
    if (this.turboGain) this.turboGain.disconnect();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.engineGain = null;
    this.engineFilter = null;
    this.oscA = null;
    this.oscB = null;
    this.noiseBuffer = null;
    this.skidSource = null;
    this.skidFilter = null;
    this.skidGain = null;
    this.turboOsc = null;
    this.turboFilter = null;
    this.turboGain = null;
  }
}
