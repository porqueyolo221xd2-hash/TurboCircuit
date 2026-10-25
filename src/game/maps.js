// Mapas jugables de Turbo Circuit.
// Cada mapa define su trazado, ancho, ambiente y tipo de decoración.
// La física, las vueltas, la clasificación y la IA son compartidas.

export const MAPS = {
  coast: {
    id: 'coast',
    name: 'COSTA TROPICAL',
    shortName: 'COSTA',
    tagline: 'Curvas amplias junto al mar',
    description:
      'Un circuito abierto y rápido entre palmeras y agua. Ideal para aprender a trazar curvas amplias y encadenar turbos.',
    accent: '#2fd7e8',
    roadWidth: 20,
    shoulderWidth: 4.8,
    startS: 24,
    ground: { color: 0xe7d29a, texture: 'sand', size: 760 },
    curb: ['#ff8a2a', '#fff3d0'],
    environment: {
      skyTop: 0x1e8ed8,
      skyBottom: 0xdffaff,
      fogColor: 0xd6f4ff,
      fogNear: 270,
      fogFar: 980,
      hemiSky: 0xe7fbff,
      hemiGround: 0x7b9b4a,
      hemiIntensity: 1.65,
      sunColor: 0xfff2c8,
      sunIntensity: 2.6,
      sunBallColor: 0xfff4c0,
      exposure: 1.05,
      menuRadius: 245,
      menuHeight: 92,
    },
    scenery: 'coast',
    controlPoints: [
      [-9, -128],
      [43, -128],
      [89, -119],
      [117, -95],
      [131, -58],
      [131, -15],
      [117, 24],
      [107, 41],
      [97, 73],
      [83, 104],
      [51, 121],
      [13, 126],
      [-27, 119],
      [-62, 102],
      [-89, 77],
      [-109, 44],
      [-117, 9],
      [-116, -29],
      [-109, -61],
      [-97, -89],
      [-80, -112],
      [-53, -126],
    ],
  },
  mountain: {
    id: 'mountain',
    name: 'MONTAÑA',
    shortName: 'MONTAÑA',
    tagline: 'Trazado técnico entre pinos',
    description:
      'Curvas cerradas, rasantes y cambios de ritmo entre pinos y roca. Exige frenar pronto, elegir bien la trazada y salir fuerte.',
    accent: '#9be36b',
    roadWidth: 16,
    shoulderWidth: 4.2,
    startS: 26,
    ground: { color: 0x6aa84f, texture: 'grass', size: 1500 },
    curb: ['#e84a3a', '#f7f4ec'],
    environment: {
      skyTop: 0x2f6fb0,
      skyBottom: 0xd8e8f2,
      fogColor: 0xcfe2ee,
      fogNear: 220,
      fogFar: 820,
      hemiSky: 0xd8ecff,
      hemiGround: 0x334b2d,
      hemiIntensity: 1.35,
      sunColor: 0xffe0ae,
      sunIntensity: 2.25,
      sunBallColor: 0xffe9c2,
      exposure: 0.98,
      menuRadius: 225,
      menuHeight: 96,
    },
    scenery: 'mountain',
    controlPoints: [
      [-6, -150],
      [48, -146],
      [86, -124],
      [96, -88],
      [78, -56],
      [44, -40],
      [26, -8],
      [44, 26],
      [82, 44],
      [102, 78],
      [78, 112],
      [36, 132],
      [-14, 126],
      [-58, 104],
      [-96, 74],
      [-112, 34],
      [-104, -10],
      [-82, -48],
      [-88, -88],
      [-70, -124],
      [-40, -144],
    ],
  },
  city: {
    id: 'city',
    name: 'CIUDAD FUTURISTA',
    shortName: 'CIUDAD',
    tagline: 'Neón, rectas y chicanes',
    description:
      'Circuito nocturno de bloques largos y chicanes marcadas. Las rectas invitan a apurar el turbo; las frenadas, a ser preciso.',
    accent: '#b66cff',
    roadWidth: 18,
    shoulderWidth: 4.4,
    startS: 26,
    ground: { color: 0x11162a, texture: 'city', size: 1250 },
    curb: ['#25e6ff', '#f5f3ff'],
    environment: {
      skyTop: 0x050716,
      skyBottom: 0x1b2148,
      fogColor: 0x10142e,
      fogNear: 170,
      fogFar: 720,
      hemiSky: 0x6676ff,
      hemiGround: 0x080a16,
      hemiIntensity: 0.8,
      sunColor: 0xa9c8ff,
      sunIntensity: 1.35,
      sunBallColor: 0xb7d4ff,
      exposure: 1.08,
      menuRadius: 250,
      menuHeight: 105,
    },
    scenery: 'city',
    controlPoints: [
      [-80, -122],
      [-30, -122],
      [30, -122],
      [90, -120],
      [125, -112],
      [148, -92],
      [158, -62],
      [158, -10],
      [166, 22],
      [154, 52],
      [158, 82],
      [152, 100],
      [130, 118],
      [100, 128],
      [60, 133],
      [10, 134],
      [-40, 133],
      [-90, 129],
      [-125, 118],
      [-150, 98],
      [-162, 70],
      [-164, 20],
      [-164, -40],
      [-158, -85],
      [-148, -110],
      [-125, -122],
      [-100, -123],
    ],
  },
};

export const MAP_ORDER = ['coast', 'mountain', 'city'];
export const DEFAULT_MAP = 'coast';
const STORAGE_KEY = 'turbo-circuit-map-v1';

export function isMap(value) {
  return Object.prototype.hasOwnProperty.call(MAPS, value);
}

export function getMap(id) {
  return isMap(id) ? MAPS[id] : MAPS[DEFAULT_MAP];
}

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Navegadores en modo privado pueden bloquear localStorage.
  }
  return null;
}

export function loadMapId(storage = null) {
  const target = resolveStorage(storage);
  if (!target) return DEFAULT_MAP;
  try {
    const saved = target.getItem(STORAGE_KEY);
    return isMap(saved) ? saved : DEFAULT_MAP;
  } catch {
    return DEFAULT_MAP;
  }
}

export function saveMapId(id, storage = null) {
  if (!isMap(id)) return false;
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}
