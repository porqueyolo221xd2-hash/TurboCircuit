// Ayuda para no capturar las teclas del juego mientras se escribe.
// Los campos de texto deben recibir todas las letras (incluidas W/A/S/D/E)
// sin que la conducción, la pausa o el uso de objetos interfieran.

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'number',
  'password',
  'tel',
  'url',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
]);

/**
 * ¿El evento de teclado nace en un campo donde el usuario escribe texto?
 * Se comprueban etiqueta, tipo de input y editabilidad para cubrir tanto
 * los campos del menú online como cualquier otro formulario del juego.
 */
export function isTextEntryTarget(target) {
  if (!target || typeof target !== 'object') return false;

  const tag = typeof target.tagName === 'string' ? target.tagName.toLowerCase() : '';
  if (tag === 'textarea') return true;
  if (tag === 'input') {
    const type = typeof target.type === 'string' ? target.type.toLowerCase() : 'text';
    return TEXT_INPUT_TYPES.has(type);
  }
  if (target.isContentEditable === true) return true;

  // Elementos hijos de un contenedor editable (por ejemplo, un span dentro
  // de un div contenteditable).
  if (typeof target.closest === 'function') {
    return Boolean(
      target.closest(
        'textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
      ),
    );
  }
  return false;
}
