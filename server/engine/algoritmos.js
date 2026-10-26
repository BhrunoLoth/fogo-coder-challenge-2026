'use strict';
/**
 * Algoritmos clássicos implementados do zero (sem bibliotecas).
 *  - Diagrama de Voronoi por recorte de semiplanos (Sutherland–Hodgman)
 *  - Algoritmo Húngaro (Kuhn–Munkres) para atribuição de custo mínimo
 *  - Método de Hamilton (maiores restos) para repartir agentes proporcionalmente
 *  - Cauda da distribuição de Poisson para detectar picos improváveis
 */

// ---------------------------------------------------------------------------
// VORONOI
// Cada bairro "domina" a área mais próxima do seu centro. A célula de um ponto é
// a interseção dos semiplanos "mais perto de mim do que do vizinho j", recortada
// pela caixa da cidade. Complexidade O(n² · v), ótima para n ≈ 20 bairros.
// ---------------------------------------------------------------------------
/** Envoltória convexa (cadeia monótona de Andrew), pontos [x, y]. */
function envoltoria(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inf = [], sup = [];
  for (const q of p) { while (inf.length >= 2 && cruz(inf[inf.length - 2], inf[inf.length - 1], q) <= 0) inf.pop(); inf.push(q); }
  for (const q of p.slice().reverse()) { while (sup.length >= 2 && cruz(sup[sup.length - 2], sup[sup.length - 1], q) <= 0) sup.pop(); sup.push(q); }
  return inf.slice(0, -1).concat(sup.slice(0, -1));
}

function voronoi(sites, bbox, margemKm = 1.4) {
  const lat0 = (bbox.south + bbox.north) / 2;
  const kx = Math.cos((lat0 * Math.PI) / 180); // corrige a distorção leste-oeste
  const P = sites.map((s) => [s.lng * kx, s.lat]);
  // Contorno da cidade: envoltória convexa dos bairros, expandida em ~1,4 km para fora.
  const hull = envoltoria(P);
  const cx = hull.reduce((s, q) => s + q[0], 0) / hull.length, cy = hull.reduce((s, q) => s + q[1], 0) / hull.length;
  const margem = margemKm / 111.32;
  const caixa = hull.map(([x, y]) => { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1; return [x + (dx / d) * margem, y + (dy / d) * margem]; });

  return P.map((pi, i) => {
    let poly = caixa.slice();
    for (let j = 0; j < P.length && poly.length; j++) {
      if (i === j) continue;
      const pj = P[j];
      // Semiplano: (x - m) · (pj - pi) <= 0, onde m é o ponto médio.
      const nx = pj[0] - pi[0], ny = pj[1] - pi[1];
      const mx = (pi[0] + pj[0]) / 2, my = (pi[1] + pj[1]) / 2;
      const dentro = (p) => (p[0] - mx) * nx + (p[1] - my) * ny <= 0;
      const cruza = (a, b) => {
        const da = (a[0] - mx) * nx + (a[1] - my) * ny, db = (b[0] - mx) * nx + (b[1] - my) * ny;
        const t = da / (da - db);
        return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      };
      const out = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length];
        const ia = dentro(a), ib = dentro(b);
        if (ia) out.push(a);
        if (ia !== ib) out.push(cruza(a, b));
      }
      poly = out;
    }
    return poly.map(([x, y]) => [y, x / kx]); // de volta para [lat, lng]
  });
}

// ---------------------------------------------------------------------------
// ALGORITMO HÚNGARO — O(n³)
// Dada uma matriz de custos (agentes x vagas), encontra a atribuição um-para-um
// que minimiza o custo total (aqui: distância total percorrida pelos agentes).
// Implementação clássica com potenciais (u, v) e caminhos aumentantes.
// Aceita matriz retangular (linhas <= colunas); retorna atribuicao[linha] = coluna.
// ---------------------------------------------------------------------------
function hungaro(custo) {
  const n = custo.length;
  if (!n) return [];
  const m = custo[0].length;
  const INF = 1e18;
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const usado = new Array(m + 1).fill(false);
    do {
      usado[j0] = true;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (usado[j]) continue;
        const cur = custo[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (usado[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const atrib = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) atrib[p[j] - 1] = j - 1;
  return atrib;
}

// ---------------------------------------------------------------------------
// MÉTODO DE HAMILTON (maiores restos)
// Reparte N agentes entre regiões proporcionalmente à demanda prevista, sem
// arredondamentos que "somem" ou "criam" agentes.
// ---------------------------------------------------------------------------
function hamilton(total, pesos) {
  const soma = pesos.reduce((s, x) => s + x, 0);
  if (!soma || total <= 0) return pesos.map(() => 0);
  const cotas = pesos.map((w) => (total * w) / soma);
  const base = cotas.map(Math.floor);
  let resto = total - base.reduce((s, x) => s + x, 0);
  const ordem = cotas.map((c, i) => [c - Math.floor(c), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < ordem.length && resto > 0; k++, resto--) base[ordem[k][1]]++;
  return base;
}

// ---------------------------------------------------------------------------
// POISSON
// P(X >= k) quando X ~ Poisson(lambda). Usado para decidir se um número de
// ocorrências é "azar normal" ou um pico estatisticamente improvável.
// ---------------------------------------------------------------------------
function poissonCaudaSuperior(k, lambda) {
  if (k <= 0) return 1;
  let termo = Math.exp(-lambda), acumulado = termo;
  for (let i = 1; i < k; i++) { termo *= lambda / i; acumulado += termo; }
  return Math.max(0, 1 - acumulado);
}

/** P(X <= k) quando X ~ Poisson(lambda): queda improvável. */
function poissonCaudaInferior(k, lambda) {
  let termo = Math.exp(-lambda), acumulado = termo;
  for (let i = 1; i <= k; i++) { termo *= lambda / i; acumulado += termo; }
  return Math.min(1, acumulado);
}

/** Média móvel exponencial. */
function ewma(serie, alfa = 0.3) {
  let s = null;
  return serie.map((x) => (s = s === null ? x : alfa * x + (1 - alfa) * s));
}

module.exports = { voronoi, envoltoria, hungaro, hamilton, poissonCaudaSuperior, poissonCaudaInferior, ewma };
