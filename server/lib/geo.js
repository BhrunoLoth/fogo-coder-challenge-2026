'use strict';
/** Utilidades geográficas escritas do zero. */

const R_TERRA_KM = 6371;
const rad = (g) => (g * Math.PI) / 180;

/** Distância em km entre dois pontos (fórmula de Haversine). */
function haversine(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TERRA_KM * Math.asin(Math.sqrt(a));
}

/** Desloca um ponto em metros (aproximação plana, ok para escala urbana). */
function offsetMeters(lat, lng, dNorth, dEast) {
  const dLat = dNorth / 111320;
  const dLng = dEast / (111320 * Math.cos(rad(lat)));
  return [lat + dLat, lng + dLng];
}

/** Ponto dentro de polígono (ray casting). poly = [[lat,lng],...] */
function pointInPolygon(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    const cruza = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (cruza) inside = !inside;
  }
  return inside;
}

/** Índice do ponto mais próximo (usado como "geocodificação reversa" offline). */
function nearest(lat, lng, points) {
  let best = -1, bestD = Infinity;
  points.forEach((p, i) => {
    const d = haversine(lat, lng, p.lat, p.lng);
    if (d < bestD) { bestD = d; best = i; }
  });
  return { index: best, km: bestD };
}

module.exports = { haversine, offsetMeters, pointInPolygon, nearest };
