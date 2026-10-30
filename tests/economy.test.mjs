// Pruebas de la economía y la persistencia, sin navegador.
// Ejecutar con: npm.cmd test
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORRUPT_BACKUP_KEY,
  KART_PRICES,
  MAP_PRICES,
  PROGRESS_KEY,
  REWARDS,
  createNewProgress,
  grantCoins,
  itemState,
  loadProgress,
  mapPrice,
  missingCoins,
  ownsKart,
  ownsLoadout,
  ownsMap,
  priceOf,
  purchase,
  sanitizeProgress,
  saveProgress,
  selectKart,
  selectMap,
} from '../src/game/economy.js';

class MemoryStorage {
  constructor(entries = {}) {
    this.map = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

const LEGACY_KART_KEY = 'turbo-circuit-kart-v1';
const LEGACY_MAP_KEY = 'turbo-circuit-map-v1';

test('el perfil nuevo solo tiene Rayo, Costa y 0 monedas', () => {
  const profile = createNewProgress();
  assert.deepEqual(profile.karts, ['rayo']);
  assert.deepEqual(profile.maps, ['coast']);
  assert.equal(profile.coins, 0);
  assert.equal(profile.selectedKart, 'rayo');
  assert.equal(profile.selectedMap, 'coast');
});

test('los precios y recompensas se mantienen centralizados', () => {
  assert.deepEqual(KART_PRICES, { rayo: 0, centella: 150, lira: 260, titan: 400 });
  assert.deepEqual(MAP_PRICES, {
    coast: 0,
    mountain: 120,
    city: 220,
    neon: 320,
    canyon: 440,
    orbital: 560,
  });
  assert.deepEqual(REWARDS, { easy: 20, normal: 40, hard: 70 });
});

test('sin datos guardados se empieza de cero', () => {
  const storage = new MemoryStorage();
  const profile = loadProgress(storage);
  assert.deepEqual(profile.karts, ['rayo']);
  assert.deepEqual(profile.maps, ['coast']);
  assert.equal(profile.coins, 0);
});

test('las claves antiguas no regalan karts ni circuitos', () => {
  const storage = new MemoryStorage({
    [LEGACY_KART_KEY]: 'titan',
    [LEGACY_MAP_KEY]: 'orbital',
  });
  const profile = loadProgress(storage);
  assert.deepEqual(profile.karts, ['rayo']);
  assert.deepEqual(profile.maps, ['coast']);
  assert.equal(profile.selectedKart, 'rayo');
  assert.equal(profile.selectedMap, 'coast');
  // Las claves antiguas siguen intactas.
  assert.equal(storage.getItem(LEGACY_KART_KEY), 'titan');
  assert.equal(storage.getItem(LEGACY_MAP_KEY), 'orbital');
});

test('un perfil v1 conserva sus compras aunque existan claves antiguas', () => {
  const storage = new MemoryStorage({
    [PROGRESS_KEY]: JSON.stringify({
      version: 1,
      coins: 130,
      karts: ['rayo', 'centella'],
      maps: ['coast', 'mountain'],
      selectedKart: 'centella',
      selectedMap: 'mountain',
      stats: { races: 12, wins: 10, coinsEarned: 400 },
    }),
    [LEGACY_KART_KEY]: 'titan',
    [LEGACY_MAP_KEY]: 'orbital',
  });
  const profile = loadProgress(storage);
  assert.deepEqual(profile.karts, ['rayo', 'centella']);
  assert.deepEqual(profile.maps, ['coast', 'mountain']);
  assert.equal(profile.coins, 130);
  assert.equal(profile.selectedKart, 'centella');
  assert.equal(profile.selectedMap, 'mountain');
});

test('los datos incompletos se reparan sin perder monedas', () => {
  const profile = sanitizeProgress({ coins: 75 });
  assert.equal(profile.coins, 75);
  assert.deepEqual(profile.karts, ['rayo']);
  assert.deepEqual(profile.maps, ['coast']);
  assert.equal(profile.selectedKart, 'rayo');
  assert.equal(profile.selectedMap, 'coast');
});

test('un saldo corrupto o negativo se convierte en 0', () => {
  assert.equal(sanitizeProgress({ coins: -500 }).coins, 0);
  assert.equal(sanitizeProgress({ coins: 'muchas' }).coins, 0);
  assert.equal(sanitizeProgress({ coins: Number.NaN }).coins, 0);
  assert.equal(sanitizeProgress({ coins: Infinity }).coins, 0);
  assert.equal(sanitizeProgress({ coins: 12.9 }).coins, 12);
});

test('la selección bloqueada se corrige y los ids inválidos se descartan', () => {
  const profile = sanitizeProgress({
    karts: ['rayo', 'nave-inventada'],
    maps: ['coast', 'luna'],
    selectedKart: 'titan',
    selectedMap: 'orbital',
  });
  assert.deepEqual(profile.karts, ['rayo']);
  assert.deepEqual(profile.maps, ['coast']);
  assert.equal(profile.selectedKart, 'rayo');
  assert.equal(profile.selectedMap, 'coast');
});

test('el JSON dañado se copia antes de reparar el perfil', () => {
  const corrupt = '{"coins": 50, "karts": [';
  const storage = new MemoryStorage({ [PROGRESS_KEY]: corrupt });
  const profile = loadProgress(storage);
  assert.deepEqual(profile.karts, ['rayo']);
  assert.equal(profile.coins, 0);
  assert.equal(storage.getItem(CORRUPT_BACKUP_KEY), corrupt);
  assert.equal(storage.getItem(PROGRESS_KEY), corrupt);
});

test('comprar con saldo suficiente descuenta una sola vez y desbloquea', () => {
  const profile = createNewProgress();
  profile.coins = 200;
  const result = purchase(profile, 'kart', 'centella');
  assert.equal(result.ok, true);
  assert.equal(profile.coins, 50);
  assert.equal(ownsKart(profile, 'centella'), true);
  assert.equal(itemState(profile, 'kart', 'centella'), 'owned');
});

test('comprar dos veces no vuelve a cobrar', () => {
  const profile = createNewProgress();
  profile.coins = 300;
  assert.equal(purchase(profile, 'kart', 'centella').ok, true);
  const coinsAfterFirst = profile.coins;
  const second = purchase(profile, 'kart', 'centella');
  assert.equal(second.ok, false);
  assert.equal(second.code, 'owned');
  assert.equal(profile.coins, coinsAfterFirst);
  assert.equal(profile.karts.filter((id) => id === 'centella').length, 1);
});

test('comprar sin saldo suficiente no descuenta ni desbloquea', () => {
  const profile = createNewProgress();
  profile.coins = 100;
  const result = purchase(profile, 'kart', 'centella');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'insufficient');
  assert.equal(result.missing, 50);
  assert.equal(profile.coins, 100);
  assert.equal(ownsKart(profile, 'centella'), false);
});

test('comprar un circuito aplica su precio y descuenta exacto', () => {
  const profile = createNewProgress();
  profile.coins = 120;
  assert.equal(purchase(profile, 'map', 'mountain').ok, true);
  assert.equal(profile.coins, 0);
  assert.equal(ownsMap(profile, 'mountain'), true);
});

test('no se pueden comprar ids inexistentes ni tipos desconocidos', () => {
  const profile = createNewProgress();
  profile.coins = 9999;
  assert.equal(purchase(profile, 'kart', 'fantasma').ok, false);
  assert.equal(purchase(profile, 'map', 'fantasma').ok, false);
  assert.equal(purchase(profile, 'arma', 'centella').ok, false);
  assert.equal(profile.coins, 9999);
});

test('solo se puede seleccionar contenido desbloqueado', () => {
  const profile = createNewProgress();
  assert.equal(selectKart(profile, 'titan'), false);
  assert.equal(selectMap(profile, 'orbital'), false);
  assert.equal(profile.selectedKart, 'rayo');
  assert.equal(profile.selectedMap, 'coast');

  profile.coins = 400;
  purchase(profile, 'kart', 'titan');
  assert.equal(selectKart(profile, 'titan'), true);
  assert.equal(profile.selectedKart, 'titan');
});

test('las monedas que faltan se calculan sin negativos', () => {
  const profile = createNewProgress();
  profile.coins = 100;
  assert.equal(missingCoins(profile, 'kart', 'centella'), 50);
  assert.equal(missingCoins(profile, 'map', 'mountain'), 20);
  assert.equal(missingCoins(profile, 'kart', 'rayo'), 0);
  assert.equal(missingCoins(profile, 'kart', 'titan'), 300);
});

test('las recompensas respetan dificultad y no aceptan valores negativos', () => {
  const profile = createNewProgress();
  assert.equal(grantCoins(profile, REWARDS.easy), 20);
  assert.equal(grantCoins(profile, REWARDS.normal), 40);
  assert.equal(grantCoins(profile, REWARDS.hard), 70);
  assert.equal(profile.coins, 130);
  assert.equal(profile.stats.coinsEarned, 130);
  assert.equal(grantCoins(profile, -500), 0);
  assert.equal(profile.coins, 130);
});

test('itemState distingue bloqueado, desbloqueado y equipado', () => {
  const profile = createNewProgress();
  assert.equal(itemState(profile, 'kart', 'rayo'), 'equipped');
  assert.equal(itemState(profile, 'kart', 'centella'), 'locked');
  profile.coins = 150;
  purchase(profile, 'kart', 'centella');
  assert.equal(itemState(profile, 'kart', 'centella'), 'owned');
  selectKart(profile, 'centella');
  assert.equal(itemState(profile, 'kart', 'centella'), 'equipped');
});

test('priceOf solo devuelve precios de objetos válidos', () => {
  assert.equal(priceOf('kart', 'centella'), 150);
  assert.equal(priceOf('map', 'orbital'), 560);
  assert.equal(priceOf('kart', 'nada'), 0);
  assert.equal(priceOf('otro', 'rayo'), 0);
});

test('si el almacenamiento falla, saveProgress lo indica', () => {
  const failing = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(saveProgress(createNewProgress(), failing), false);
});

// ---------------------------------------------------------------------------
// Regresión: Orbital (560) y la migración que confundía selección con compra.
// ---------------------------------------------------------------------------

test('perfil nuevo: Orbital no está en maps, cuesta 560 y aparece bloqueado', () => {
  const profile = createNewProgress();
  assert.equal(profile.maps.includes('orbital'), false);
  assert.deepEqual(profile.maps, ['coast']);
  assert.equal(mapPrice('orbital'), 560);
  assert.equal(MAP_PRICES.orbital, 560);
  assert.equal(itemState(profile, 'map', 'orbital'), 'locked');
  assert.equal(missingCoins(profile, 'map', 'orbital'), 560);
});

test('con monedas insuficientes no se puede comprar Orbital', () => {
  const profile = createNewProgress();
  profile.coins = 100;
  const result = purchase(profile, 'map', 'orbital');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'insufficient');
  assert.equal(result.missing, 460);
  assert.equal(profile.coins, 100);
  assert.equal(ownsMap(profile, 'orbital'), false);
  assert.deepEqual(profile.maps, ['coast']);
});

test('con 559 monedas Orbital sigue bloqueado y falta 1', () => {
  const profile = createNewProgress();
  profile.coins = 559;
  assert.equal(itemState(profile, 'map', 'orbital'), 'locked');
  assert.equal(missingCoins(profile, 'map', 'orbital'), 1);
  const result = purchase(profile, 'map', 'orbital');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'insufficient');
  assert.equal(result.missing, 1);
  assert.equal(profile.coins, 559);
  assert.equal(ownsMap(profile, 'orbital'), false);
});

test('con 560 monedas Orbital solo se desbloquea tras una compra válida', () => {
  const profile = createNewProgress();
  profile.coins = 560;
  // Tener el saldo no desbloquea nada por sí solo.
  assert.equal(ownsMap(profile, 'orbital'), false);
  assert.equal(itemState(profile, 'map', 'orbital'), 'locked');

  const result = purchase(profile, 'map', 'orbital');
  assert.equal(result.ok, true);
  assert.equal(result.code, 'purchased');
  assert.equal(result.price, 560);
  assert.equal(profile.coins, 0);
  assert.equal(ownsMap(profile, 'orbital'), true);
  assert.deepEqual(profile.maps, ['coast', 'orbital']);
  assert.equal(itemState(profile, 'map', 'orbital'), 'owned');
});

test('comprar Orbital dos veces no vuelve a cobrar', () => {
  const profile = createNewProgress();
  profile.coins = 1000;
  assert.equal(purchase(profile, 'map', 'orbital').ok, true);
  assert.equal(profile.coins, 440);
  const second = purchase(profile, 'map', 'orbital');
  assert.equal(second.ok, false);
  assert.equal(second.code, 'owned');
  assert.equal(profile.coins, 440);
  assert.equal(profile.maps.filter((id) => id === 'orbital').length, 1);
});

test('seleccionar o previsualizar Orbital no lo desbloquea', () => {
  const profile = createNewProgress();
  profile.coins = 560;
  assert.equal(selectMap(profile, 'orbital'), false);
  assert.equal(profile.selectedMap, 'coast');
  assert.equal(itemState(profile, 'map', 'orbital'), 'locked');
  assert.equal(ownsMap(profile, 'orbital'), false);

  // Un perfil que dice tener Orbital seleccionado pero no comprado se repara.
  const repaired = sanitizeProgress({
    coins: 560,
    karts: ['rayo'],
    maps: ['coast'],
    selectedKart: 'rayo',
    selectedMap: 'orbital',
    stats: { races: 8, wins: 8, coinsEarned: 560 },
  });
  assert.deepEqual(repaired.maps, ['coast']);
  assert.equal(repaired.selectedMap, 'coast');
  assert.equal(repaired.coins, 560);
});

test('iniciar carrera con Orbital sin comprarlo se rechaza de forma segura', () => {
  const profile = createNewProgress();
  profile.coins = 560;
  assert.equal(ownsLoadout(profile, 'rayo', 'orbital'), false);
  assert.equal(ownsLoadout(profile, 'rayo', 'coast'), true);
  assert.equal(ownsLoadout(profile, 'titan', 'coast'), false);

  purchase(profile, 'map', 'orbital');
  assert.equal(ownsLoadout(profile, 'rayo', 'orbital'), true);
});

test('un perfil antiguo sin Orbital no lo recibe al migrar', () => {
  const storage = new MemoryStorage({
    [PROGRESS_KEY]: JSON.stringify({
      version: 1,
      coins: 0,
      karts: ['rayo'],
      maps: ['coast'],
      selectedKart: 'rayo',
      selectedMap: 'coast',
      stats: { races: 0, wins: 0, coinsEarned: 0 },
    }),
    [LEGACY_MAP_KEY]: 'orbital',
  });
  const profile = loadProgress(storage);
  assert.deepEqual(profile.maps, ['coast']);
  assert.equal(profile.selectedMap, 'coast');
  assert.equal(ownsMap(profile, 'orbital'), false);
  // La clave antigua no se borra ni se sobrescribe.
  assert.equal(storage.getItem(LEGACY_MAP_KEY), 'orbital');
});

test('un perfil que compró Orbital legítimamente conserva su compra', () => {
  const profile = sanitizeProgress({
    version: 1,
    coins: 0,
    karts: ['rayo'],
    maps: ['coast', 'orbital'],
    selectedKart: 'rayo',
    selectedMap: 'orbital',
    stats: { races: 8, wins: 8, coinsEarned: 560 },
  });
  assert.deepEqual(profile.maps, ['coast', 'orbital']);
  assert.equal(profile.selectedMap, 'orbital');
  assert.equal(itemState(profile, 'map', 'orbital'), 'equipped');
});

test('un perfil contaminado por la migración antigua pierde Orbital si no pudo pagarlo', () => {
  const polluted = sanitizeProgress({
    version: 1,
    coins: 0,
    karts: ['rayo'],
    maps: ['coast', 'orbital'],
    selectedKart: 'rayo',
    selectedMap: 'orbital',
    stats: { races: 0, wins: 0, coinsEarned: 0 },
  });
  assert.deepEqual(polluted.maps, ['coast']);
  assert.equal(polluted.selectedMap, 'coast');
  assert.equal(polluted.coins, 0);

  // Aunque tenga algunas monedas, si nunca ganó 560 no pudo comprar Orbital.
  const partial = sanitizeProgress({
    version: 1,
    coins: 200,
    karts: ['rayo'],
    maps: ['coast', 'orbital'],
    selectedKart: 'rayo',
    selectedMap: 'orbital',
    stats: { races: 10, wins: 5, coinsEarned: 200 },
  });
  assert.deepEqual(partial.maps, ['coast']);
  assert.equal(partial.selectedMap, 'coast');
  assert.equal(partial.coins, 200);
});

