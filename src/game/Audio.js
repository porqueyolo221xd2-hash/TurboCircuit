// Pequeño motor de sonido con WebAudio: motor, pitidos de cuenta atrás y melodía final.
// No usa archivos de audio externos.
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.oscA = null;
    this.oscB = null;
    this.engineActive = false;
    this.enabled = true;
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
    if (!this.enabled && this.ctx && this.engineGain) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    }
    return this.enabled;
  }

  dispose() {
    this.engineActive = false;
    try {
      if (this.oscA) this.oscA.stop();
      if (this.oscB) this.oscB.stop();
    } catch {
      // Los osciladores ya podrían estar parados.
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.engineGain = null;
    this.engineFilter = null;
    this.oscA = null;
    this.oscB = null;
  }
}
