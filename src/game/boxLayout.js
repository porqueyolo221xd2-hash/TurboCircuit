// Distribución determinista de las cajas de objetos.
// El cliente y el servidor generan exactamente la misma lista e índices para
// que una concesión de objeto se refiera siempre a la misma caja.

export const BOX_ROW_GAP = 120;
export const BOX_ROW_COUNT = 6;
export const BOX_ROW_OFFSET = 70;
export const BOX_LANES = [-4.6, 0, 4.6];
export const BOX_RESPAWN = 5;
export const BOX_PICKUP_RADIUS = 2.1;
export const BOX_SPAWN_TIME = 0.38;

/**
 * Devuelve todas las cajas en el mismo orden que usa ItemSystem.
 * Cada entrada incluye la posición calculada sobre la pista para que el
 * servidor pueda validar la distancia sin construir mallas.
 */
export function buildBoxPlan(track) {
  const entries = [];
  const layouts = [{ routeId: null, rows: BOX_ROW_COUNT, startS: track.startS }];
  for (const route of track.routes ?? []) {
    layouts.push({
      routeId: route.id,
      rows: Math.max(2, Math.floor(route.length / (BOX_ROW_GAP * 1.6))),
      startS: route.enterS,
    });
  }

  for (const layout of layouts) {
    const route = layout.routeId ? track.routesById.get(layout.routeId) : null;
    for (let row = 0; row < layout.rows; row += 1) {
      const s = route
        ? track.globalSForRoute(route, (0.2 + (row / layout.rows) * 0.6) * route.length)
        : layout.startS + BOX_ROW_OFFSET + row * BOX_ROW_GAP;
      for (const lane of BOX_LANES) {
        const point = track.posAt(s, lane, layout.routeId);
        entries.push({
          index: entries.length,
          s,
          routeId: layout.routeId,
          lane,
          x: point.x,
          y: point.y + 0.95,
          z: point.z,
        });
      }
    }
  }

  return entries;
}
