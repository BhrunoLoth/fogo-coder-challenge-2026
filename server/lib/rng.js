'use strict';
/**
 * Gerador pseudoaleatório determinístico (mulberry32).
 * Usamos semente fixa para que a "cidade" gerada seja sempre a mesma:
 * o avaliador vê exatamente os mesmos dados que nós vimos ao desenvolver.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(seed = 2026) { this.r = mulberry32(seed); }
  next() { return this.r(); }
  float(min, max) { return min + (max - min) * this.r(); }
  int(min, max) { return Math.floor(this.float(min, max + 1)); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  chance(p) { return this.r() < p; }
  /** Normal padrão (Box-Muller). */
  normal(mu = 0, sigma = 1) {
    let u = 0; while (u === 0) u = this.r();
    const v = this.r();
    return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /**
   * Amostra de Poisson. Para lambda pequeno usamos o método de Knuth;
   * para lambda grande, aproximação normal (rápida e suficiente aqui).
   */
  poisson(lambda) {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= this.r(); } while (p > L);
    return k - 1;
  }
  /** Escolha ponderada: weights[i] >= 0. */
  weighted(items, weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    let x = this.r() * total;
    for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x <= 0) return items[i]; }
    return items[items.length - 1];
  }
}

module.exports = { Rng, mulberry32 };
