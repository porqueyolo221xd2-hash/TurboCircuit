import './style.css';
import { Game } from './game/Game.js';

const container = document.getElementById('scene');
const errorScreen = document.getElementById('webgl-error');
const errorText = document.getElementById('webgl-error-text');

let game = null;

try {
  if (!container) throw new Error('No se encontró el contenedor #scene.');
  game = new Game(container);
  // Expuesto para depurar desde la consola del navegador.
  window.turboCircuit = game;
} catch (error) {
  console.error('Turbo Circuit no ha podido iniciarse:', error);
  if (errorText) {
    errorText.textContent =
      'No se ha podido crear la escena 3D. Comprueba que tu navegador tiene WebGL activado ' +
      '(Chrome, Edge o Firefox actualizados) y vuelve a cargar la página.';
  }
  if (errorScreen) errorScreen.classList.remove('hidden');
}

// En desarrollo, Vite recarga el módulo: liberamos la escena anterior.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (game) game.dispose();
    delete window.turboCircuit;
  });
}
