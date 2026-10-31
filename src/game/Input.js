// Entrada de teclado y pantalla táctil.
// El teclado sigue funcionando en ordenador y los controles táctiles usan
// Pointer Events para permitir varios dedos a la vez (girar + acelerar, etc.).
import { isTextEntryTarget } from './keyboard.js';

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
const HOLD_ACTIONS = new Set(['left', 'right', 'throttle', 'brake', 'drift']);

export class Input {
  constructor() {
    this.keys = new Set();
    this.onAction = null;
    this.onClear = null;
    this.onTouchAction = null;

    // Cada acción guarda si algún dedo la mantiene pulsada.
    this.touch = {
      left: false,
      right: false,
      throttle: false,
      brake: false,
      drift: false,
    };
    // pointerId -> { action, button }. Permite saber qué dedo levantó cada botón.
    this.touchPointers = new Map();
    this.touchButtons = [];
    this.touchBound = false;

    this.handleKeyDown = (event) => {
      // Mientras se escribe en un campo de texto, el juego no captura nada:
      // ni movimiento, ni pausa, ni objetos. Así W/A/S/D/E llegan al campo.
      if (isTextEntryTarget(event.target)) return;
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
      if (isTextEntryTarget(event.target)) return;
      if (MOVE_KEYS.has(event.code) || event.code === DRIFT_KEY) {
        event.preventDefault();
        this.keys.delete(event.code);
      }
    };

    this.handleBlur = () => this.clear();

    // Si el foco entra en un campo con una tecla de conducción pulsada, se
    // libera para que no quede acelerando al volver al juego.
    this.handleFocusIn = (event) => {
      if (isTextEntryTarget(event.target)) this.clear();
    };

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('focusin', this.handleFocusIn);
    this.bindTouchControls();
  }

  /**
   * Conecta los botones táctiles del HTML sin crear listeners por pulsación.
   * `data-touch-control` se mantiene pulsado; `data-touch-action` es una acción
   * instantánea (usar objeto).
   */
  bindTouchControls() {
    if (this.touchBound || typeof document === 'undefined') return;
    this.touchBound = true;

    const buttons = document.querySelectorAll('[data-touch-control], [data-touch-action]');
    for (const button of buttons) {
      const action = button.dataset.touchControl ?? button.dataset.touchAction;
      if (!action) continue;

      const onDown = (event) => this.handleTouchDown(event, action, button);
      const onUp = (event) => this.handleTouchUp(event);
      const onCancel = (event) => this.handleTouchUp(event, true);
      const onContextMenu = (event) => event.preventDefault();

      button.addEventListener('pointerdown', onDown);
      button.addEventListener('pointerup', onUp);
      button.addEventListener('pointercancel', onCancel);
      button.addEventListener('lostpointercapture', onCancel);
      button.addEventListener('contextmenu', onContextMenu);

      this.touchButtons.push({ button, onDown, onUp, onCancel, onContextMenu });
    }
  }

  handleTouchDown(event, action, button) {
    // El botón derecho del ratón no debe activar controles de conducción.
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    // En iOS y Android evita el scroll, el zoom y la selección de texto.
    event.preventDefault();
    if (this.touchPointers.has(event.pointerId)) return;

    this.touchPointers.set(event.pointerId, { action, button });
    button.classList.add('is-pressed');

    // Captura el puntero: si el dedo sale del botón, al soltar se libera igual.
    if (button.setPointerCapture && event.pointerId !== undefined) {
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // Algunos navegadores no permiten capturar punteros sintéticos.
      }
    }

    if (HOLD_ACTIONS.has(action)) {
      this.touch[action] = true;
    } else if (action === 'item' && this.onTouchAction) {
      this.onTouchAction(action);
    }
  }

  handleTouchUp(event, cancelled = false) {
    const entry = this.touchPointers.get(event.pointerId);
    if (!entry) return;

    if (event.cancelable) event.preventDefault();
    this.touchPointers.delete(event.pointerId);

    // Solo se quita el estado visual cuando no queda otro dedo en ese botón.
    let stillPressed = false;
    for (const other of this.touchPointers.values()) {
      if (other.button === entry.button) {
        stillPressed = true;
        break;
      }
    }
    if (!stillPressed) entry.button.classList.remove('is-pressed');

    if (HOLD_ACTIONS.has(entry.action)) this.syncTouchState();

    // Un pointercancel equivale a perder el dedo: se cancela el derrape sin
    // regalar el turbo que sí se obtiene al soltar voluntariamente.
    if (cancelled && entry.action === 'drift' && this.onClear) {
      this.onClear();
    }
  }

  syncTouchState() {
    const active = new Set();
    for (const entry of this.touchPointers.values()) {
      if (HOLD_ACTIONS.has(entry.action)) active.add(entry.action);
    }
    for (const action of HOLD_ACTIONS) {
      this.touch[action] = active.has(action);
    }
  }

  get controls() {
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.touch.left;
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.touch.right;
    const forward = this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.touch.throttle;
    const backward = this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.touch.brake;
    return {
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      throttle: forward ? 1 : 0,
      brake: backward ? 1 : 0,
      drift: this.keys.has(DRIFT_KEY) || this.touch.drift,
    };
  }

  clear() {
    this.keys.clear();
    this.touchPointers.clear();
    for (const action of HOLD_ACTIONS) this.touch[action] = false;
    for (const { button } of this.touchButtons) {
      button.classList.remove('is-pressed');
    }
    // Permite a la carrera cancelar derrapes sin regalar turbo al perder el foco.
    if (this.onClear) this.onClear();
  }

  dispose() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('focusin', this.handleFocusIn);

    for (const entry of this.touchButtons) {
      entry.button.removeEventListener('pointerdown', entry.onDown);
      entry.button.removeEventListener('pointerup', entry.onUp);
      entry.button.removeEventListener('pointercancel', entry.onCancel);
      entry.button.removeEventListener('lostpointercapture', entry.onCancel);
      entry.button.removeEventListener('contextmenu', entry.onContextMenu);
    }
    this.touchButtons = [];
    this.touchBound = false;

    this.clear();
    this.onAction = null;
    this.onTouchAction = null;
  }
}
