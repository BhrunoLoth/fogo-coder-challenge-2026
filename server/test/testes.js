'use strict';
/**
 * Testes automatizados do motor (sem framework: node:assert).
 * Rode com:  npm test
 */
const assert = require('node:assert/strict');
const A = require('../engine/algoritmos');
const { ajustarWeibull } = require('../engine/manutencao');
const { validarEquipamento, ErroValidacao } = require('../domain/validacao');
const { haversine } = require('../lib/geo');
const { Rng } = require('../lib/rng');

let ok = 0, falhas = 0;
function teste(nome, fn) {
  try { fn(); ok++; console.log(`  ✔ ${nome}`); }
  catch (e) { falhas++; console.log(`  ✘ ${nome}\n    ${e.message}`); }
}

console.log('\n  F.O.G.O. — testes do motor\n');

teste('Algoritmo Húngaro encontra a atribuição de custo mínimo (3x3)', () => {
  const custo = [[4, 1, 3], [2, 0, 5], [3, 2, 2]];
  const a = A.hungaro(custo);
  assert.deepEqual(a, [1, 0, 2]);
  assert.equal(a.reduce((s, j, i) => s + custo[i][j], 0), 5);
});

teste('Algoritmo Húngaro bate a força bruta em 200 matrizes aleatórias', () => {
  const rng = new Rng(7);
  const perm = (n) => (n === 1 ? [[0]] : perm(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)])));
  for (let t = 0; t < 200; t++) {
    const n = rng.int(2, 6);
    const c = Array.from({ length: n }, () => Array.from({ length: n }, () => rng.int(0, 50)));
    const melhor = Math.min(...perm(n).map((p) => p.reduce((s, j, i) => s + c[i][j], 0)));
    const a = A.hungaro(c);
    assert.equal(a.reduce((s, j, i) => s + c[i][j], 0), melhor);
  }
});

teste('Método de Hamilton reparte exatamente o total, proporcional aos pesos', () => {
  const r = A.hamilton(10, [5, 3, 2.2]);
  assert.equal(r.reduce((s, x) => s + x, 0), 10);
  assert.deepEqual(r, [5, 3, 2]);
  assert.deepEqual(A.hamilton(0, [1, 2]), [0, 0]);
});

teste('Cauda de Poisson: P(X ≥ 0) = 1 e valores conhecidos', () => {
  assert.equal(A.poissonCaudaSuperior(0, 3), 1);
  assert.ok(Math.abs(A.poissonCaudaSuperior(1, 2) - (1 - Math.exp(-2))) < 1e-12);
  assert.ok(Math.abs(A.poissonCaudaInferior(0, 2) - Math.exp(-2)) < 1e-12);
});

teste('Voronoi: cada ponto fica dentro da própria célula e as células não se sobrepõem', () => {
  const rng = new Rng(3);
  const sites = Array.from({ length: 12 }, () => ({ lat: rng.float(-22.25, -22.18), lng: rng.float(-49.98, -49.91) }));
  const cel = A.voronoi(sites, { south: -22.27, west: -50, north: -22.16, east: -49.89 });
  const { pointInPolygon } = require('../lib/geo');
  sites.forEach((s, i) => {
    assert.ok(pointInPolygon(s.lat, s.lng, cel[i]), `site ${i} fora da célula`);
    sites.forEach((o, j) => { if (j !== i) assert.ok(!pointInPolygon(o.lat, o.lng, cel[i]), `site ${j} dentro da célula ${i}`); });
  });
});

teste('Weibull: o ajuste recupera parâmetros conhecidos (k=1,8; η=300) com censura', () => {
  const rng = new Rng(11);
  const dados = [];
  for (let i = 0; i < 3000; i++) {
    const t = 300 * Math.pow(-Math.log(1 - rng.next()), 1 / 1.8);
    const censura = rng.float(50, 700);
    dados.push({ eq: { marca: 'X' }, dias: Math.min(t, censura), falha: t <= censura });
  }
  const m = ajustarWeibull(dados);
  assert.ok(Math.abs(m.k - 1.8) < 0.15, `k=${m.k}`);
  assert.ok(Math.abs(m.eta - 300) / 300 < 0.08, `eta=${m.eta}`);
});

teste('Haversine: Catedral → Aeroporto de Marília ≈ 2,9 km', () => {
  const d = haversine(-22.2147, -49.9461, -22.1968, -49.9269);
  assert.ok(d > 2.6 && d < 3.2, `d=${d}`);
});

teste('Validação rejeita equipamento sem série, com CEP inválido e atributo fora da faixa', () => {
  try {
    validarEquipamento({ tipo: 'radar', serie: '', cep: '123', lat: -22.2, lng: -49.9, atributos: { velocidade_maxima: 999 } });
    assert.fail('deveria ter lançado');
  } catch (e) {
    assert.ok(e instanceof ErroValidacao);
    assert.ok(e.erros.serie && e.erros.cep && e.erros['atributos.velocidade_maxima']);
  }
});

teste('Validação aceita equipamento válido e descarta atributos que não pertencem ao tipo', () => {
  const d = validarEquipamento({ tipo: 'camera', serie: 'CAM-1', cep: '17519000', lat: -22.2, lng: -49.9, atributos: { visao_noturna: true, velocidade_maxima: 60 } });
  assert.equal(d.cep, '17519-000');
  assert.deepEqual(d.atributos, { visao_noturna: true });
});

console.log(`\n  ${ok} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
