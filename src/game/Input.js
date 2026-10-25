// Entrada de teclado: no se necesita el ratón para conducir.
const MOVE_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

const DRIFT_KEY = 'Space';

export class Input {
  constructor() {
    this.keys = new Set();
    this.onAction = null;
    this.onClear = null;

    this.handleKeyDown = (event) => {
      if (MOVE_KEYS.has(event.code) || event.code === DRIFT_KEY) {
        // Evita el desplazamiento de la página y que ESPACIO pulse un botón.
        event.preventDefault();
      }
      if (MOVE_KEYS.has(event.code) || event.code === DRIFT_KEY) {
        this.keys.add(event.code);
      }
      if (this.onAction) this.onAction(event.code, event);
    };

    this.handleKeyUp = (event) => {
      if (MOVE_KEYS.has(event.code) || event.code === DRIFT_KEY) {
        event.preventDefault();
        this.keys.delete(event.code);
      }
    };

    this.handleBlur = () => this.clear();

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  get controls() {
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const forward = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const backward = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    return {
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      throttle: forward ? 1 : 0,
      brake: backward ? 1 : 0,
      drift: this.keys.has(DRIFT_KEY),
    };
  }

  clear() {
    this.keys.clear();
    // Permite a la carrera cancelar derrapes sin regalar turbo al perder el foco.
    if (this.onClear) this.onClear();
  }

  dispose() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.clear();
    this.onAction = null;
  }
}
