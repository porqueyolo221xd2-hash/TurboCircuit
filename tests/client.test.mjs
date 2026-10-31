// Pruebas de regresión del cliente: teclado mientras se escribe y efectos
// online que deben reproducirse una sola vez con la altura correcta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isTextEntryTarget } from '../src/game/keyboard.js';
import { Input } from '../src/game/Input.js';
import { ItemSystem } from '../src/game/ItemSystem.js';
import { ITEMS } from '../src/game/items.js';

// Input necesita un window con listeners; en Node basta con un doble mínimo.
// `document` no existe, así que bindTouchControls no intenta tocar el DOM.
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
};

test('distingue campos de texto de botones y controles no editables', () => {
  assert.equal(isTextEntryTarget({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isTextEntryTarget({ tagName: 'INPUT' }), true, 'input sin type es texto');
  assert.equal(isTextEntryTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTextEntryTarget({ tagName: 'BUTTON', type: 'button' }), false);
  assert.equal(isTextEntryTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isTextEntryTarget(null), false);
});

test('W/A/S/D/E y ESPACIO se escriben sin bloquearse ni activar el juego', () => {
  const input = new Input();
  let actions = 0;
  input.onAction = () => {
    actions += 1;
  };

  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'Space']) {
    let prevented = false;
    input.handleKeyDown({
      code,
      repeat: false,
      target: { tagName: 'INPUT', type: 'text' },
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, false, `${code} debe llegar al campo de texto`);
  }

  assert.equal(actions, 0, 'ningún atajo debe ejecutarse mientras se escribe');
  assert.deepEqual(input.controls, {
    steer: 0,
    throttle: 0,
    brake: 0,
    drift: false,
  });
  input.dispose();
});

test('al salir del campo vuelven los controles y el foco libera teclas', () => {
  const input = new Input();
  const actions = [];
  input.onAction = (code) => actions.push(code);

  const keydown = (code, target) => {
    let prevented = false;
    input.handleKeyDown({
      code,
      repeat: false,
      target,
      preventDefault() {
        prevented = true;
      },
    });
    return prevented;
  };

  // En el campo: la tecla se ignora.
  assert.equal(keydown('KeyW', { tagName: 'INPUT', type: 'text' }), false);
  assert.equal(input.controls.throttle, 0);

  // Fuera del campo: la conducción vuelve a responder.
  assert.equal(keydown('KeyW', { tagName: 'BUTTON' }), true);
  assert.equal(input.controls.throttle, 1);
  assert.deepEqual(actions, ['KeyW']);

  // Si el foco entra en el campo con una tecla pulsada, se libera.
  input.handleFocusIn({ target: { tagName: 'INPUT', type: 'text' } });
  assert.equal(input.controls.throttle, 0);
  input.dispose();
});

test('la onda del PULSO se dibuja sobre el asfalto, no bajo la pista', () => {
  const calls = [];
  const fake = {
    spawnWaveAt(x, z, options) {
      calls.push({ x, z, options });
    },
  };

  ItemSystem.prototype.spawnWave.call(fake, {
    position: { x: 12, z: -3 },
    groundY: 7.5,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].x, 12);
  assert.equal(calls[0].z, -3);
  assert.equal(calls[0].options.y, 7.64);
  assert.equal(calls[0].options.radius, ITEMS.PULSO.radius);

  // Sin altura de terreno conocida se mantiene el nivel base.
  ItemSystem.prototype.spawnWave.call(fake, { position: { x: 0, z: 0 } });
  assert.equal(calls[1].options.y, 0.14);
});

test('un evento PULSO reproduce una sola onda y solo ralentiza a sus objetivos', () => {
  const slowed = [];
  let waves = 0;
  const kart = { netId: 'self', item: 'PULSO', itemUseCooldown: 0 };
  const target = {
    netId: 'r1',
    applySlow(factor, duration) {
      slowed.push({ id: 'r1', factor, duration });
    },
  };
  const far = {
    netId: 'r2',
    applySlow() {
      slowed.push({ id: 'r2' });
    },
  };
  const fake = {
    spawnWave() {
      waves += 1;
    },
    onSlow: null,
    onUse: null,
  };

  ItemSystem.prototype.applyServerItemUse.call(fake, kart, 'PULSO', ['r1'], [kart, target, far]);

  assert.equal(waves, 1, 'cada evento debe crear una única onda');
  assert.equal(kart.item, null, 'el objeto se consume al confirmarse');
  assert.deepEqual(slowed, [
    { id: 'r1', factor: ITEMS.PULSO.slowFactor, duration: ITEMS.PULSO.slowDuration },
  ]);
});
