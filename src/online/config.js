// Configuración de conexión del cliente.
//
// En desarrollo, Vite sirve el juego en :5173 y el servidor de salas en :3001.
// En producción se puede servir todo desde el mismo servidor (mismo origen) o
// definir VITE_SERVER_URL al compilar el cliente.
const explicit = import.meta.env?.VITE_SERVER_URL?.trim();

export const SERVER_URL =
  explicit ||
  (import.meta.env?.DEV ? 'http://localhost:3001' : window.location.origin);

export const NAME_KEY = 'turbo-circuit-online-name-v1';

export function loadName(storage = null) {
  const target = storage ?? safeStorage();
  if (!target) return '';
  try {
    return target.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name, storage = null) {
  const target = storage ?? safeStorage();
  if (!target) return false;
  try {
    target.setItem(NAME_KEY, name);
    return true;
  } catch {
    return false;
  }
}

export function safeStorage() {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function sessionStorageSafe() {
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

const ERROR_TEXT = {
  'invalid-code': 'El código debe tener 5 caracteres válidos.',
  'room-not-found': 'No existe ninguna sala con ese código.',
  'room-full': 'La sala está llena.',
  'race-started': 'La carrera ya ha empezado. Espera a la revancha.',
  'name-taken': 'Ese nombre ya está en uso en la sala.',
  'invalid-name': 'Escribe un nombre de 1 a 16 caracteres.',
  'invalid-map': 'Circuito no válido.',
  'invalid-kart': 'Kart no válido.',
  'not-host': 'Solo el anfitrión puede hacer eso.',
  'not-in-room': 'Ya no estás en esa sala.',
  'already-in-room': 'Ya estás en una sala.',
  'rate-limited': 'Demasiadas peticiones. Espera un momento.',
  'bad-state': 'Estado de carrera no válido.',
  'no-item': 'No tienes ese objeto.',
  'not-active': 'La carrera no está activa.',
  'item-offline': 'Ese objeto no está disponible en online.',
  'distance': 'La caja está demasiado lejos.',
  'height': 'No puedes recoger la caja en el aire.',
  'route': 'Esa caja pertenece a otra ruta.',
  'cooldown': 'Todavía no puedes hacer eso.',
  'has-item': 'Ya llevas un objeto.',
  'inactive': 'Esa caja ya se ha recogido.',
  'finished': 'Ya has terminado la carrera.',
  'server-error': 'Error del servidor. Inténtalo de nuevo.',
  'timeout': 'El servidor no responde. Comprueba tu conexión.',
};

export function onlineErrorMessage(code) {
  return ERROR_TEXT[code] ?? 'No se pudo completar la operación.';
}
