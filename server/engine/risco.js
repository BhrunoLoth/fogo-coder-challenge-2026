'use strict';
/**
 * MODELO DE RISCO — "o que pode acontecer amanhã"
 * ===============================================
 * Modelo de Poisson log-linear, totalmente explicável. Para cada bairro (b),
 * tipo de ocorrência (t) e hora (h), a taxa esperada é um produto de fatores
 * aprendidos do histórico:
 *
 *   λ(b,t,h) = Base(b,t) × Horário(t,h) × DiaSemana(t,d) × Chuva(t,mm)
 *              × Evento(t) × Tendência(b,t) × Cobertura(b,t)
 *
 * Por que multiplicativo? Cada fator vira uma frase para o gestor:
 * "×1,8 por causa da chuva prevista", "×2,4 por causa do jogo no estádio".
 * Isso é o "fogo devolvido aos humanos": nenhuma previsão sem o porquê.
 *
 * Técnicas usadas (todas implementadas aqui):
 *  - Bayes empírico (Gama–Poisson) para não exagerar em bairros com poucos dados
 *  - Suavização de Laplace nos perfis de hora e dia
 *  - Razões observado/esperado para aprender efeito de chuva, eventos e tendência
 *  - Normalização do índice de risco pelo percentil 99 do histórico
 *
 * O motor lê SOMENTE o banco de dados. Ele não conhece a "verdade" do simulador.
 */
const { HORA, DIA, horaLocal, diaSemana, inicioHora } = require('../lib/time');
const { TIPOS_OCORRENCIA, TIPO_OC } = require('../domain/catalog');

const SEMANAS_TREINO = 8;
const PRIOR_FORCA = 2;          // "pseudodias" do prior Gama–Poisson
const ENCOLHIMENTO = 12;        // pseudocontagens para fatores de razão (evita exageros)
const TIPOS = TIPOS_OCORRENCIA.map((t) => t.id);
const FAIXAS_CHUVA = [0, 2, 8, 18, Infinity]; // mm/h: seco | fraca | moderada | forte
const NOME_FAIXA = ['sem chuva', 'chuva fraca', 'chuva moderada', 'chuva forte'];
const faixaChuva = (mm) => FAIXAS_CHUVA.findIndex((lim, i) => mm >= lim && mm < FAIXAS_CHUVA[i + 1]);

/**
 * Treina o modelo com ocorrências em [inicio, fim).
 * dados = { bairros, ocorrencias, clima: Map(hora->mm), eventos }
 */
function treinar(dados, fim) {
  const inicio = fim - SEMANAS_TREINO * 7 * DIA;
  const { bairros } = dados;
  const ocs = dados.ocorrencias.filter((o) => o.inicio >= inicio && o.inicio < fim && !o.exercicio);
  const dias = (fim - inicio) / DIA;
  const idx = Object.fromEntries(bairros.map((b, i) => [b.id, i]));
  const B = bairros.length;

  // Horas do período e suas características (chuva, evento por bairro).
  const horas = [];
  for (let h = inicioHora(inicio); h < fim; h += HORA) horas.push(h);
  const chuvaDe = (h) => dados.clima.get(h) || 0;

  // --- 1) Perfil por hora e por dia da semana (cidade inteira, com Laplace) ---
  const cont = {}; const contHora = {}; const contDia = {};
  for (const t of TIPOS) { cont[t] = new Array(B).fill(0); contHora[t] = new Array(24).fill(1); contDia[t] = new Array(7).fill(1); }
  for (const o of ocs) {
    cont[o.tipo][idx[o.bairro_id]]++;
    contHora[o.tipo][horaLocal(o.inicio)]++;
    contDia[o.tipo][diaSemana(o.inicio)]++;
  }
  const nDiasSemana = new Array(7).fill(0);
  for (let d = inicio; d < fim; d += DIA) nDiasSemana[diaSemana(d + 12 * HORA)]++;
  const perfilHora = {}, perfilDia = {};
  for (const t of TIPOS) {
    const sH = contHora[t].reduce((s, x) => s + x, 0);
    perfilHora[t] = contHora[t].map((x) => (24 * x) / sH);               // média = 1
    const porDia = contDia[t].map((x, d) => x / Math.max(1, nDiasSemana[d]));
    const mD = porDia.reduce((s, x) => s + x, 0) / 7;
    perfilDia[t] = porDia.map((x) => x / mD);                              // média = 1
  }

  // --- 2) Base por bairro com Bayes empírico (ocorrências/dia) ---
  const base = {};
  for (const t of TIPOS) {
    const media = cont[t].reduce((s, x) => s + x, 0) / (B * dias) || 1e-4;
    base[t] = cont[t].map((c) => (c + PRIOR_FORCA) / (dias + PRIOR_FORCA / media));
  }

  // Taxa "estrutural" (sem chuva/evento/tendência) para uma hora: usada como esperado.
  const estrutural = (t, bi, h) => (base[t][bi] / 24) * perfilHora[t][horaLocal(h)] * perfilDia[t][diaSemana(h)];

  // --- 3) Efeito da chuva: razão observado/esperado por faixa de chuva ---
  const obsF = {}, espF = {};
  for (const t of TIPOS) { obsF[t] = [0, 0, 0, 0]; espF[t] = [0, 0, 0, 0]; }
  const ocsPorHora = new Map();
  for (const o of ocs) {
    const h = inicioHora(o.inicio);
    if (!ocsPorHora.has(h)) ocsPorHora.set(h, []);
    ocsPorHora.get(h).push(o);
  }
  for (const h of horas) {
    const f = faixaChuva(chuvaDe(h));
    for (const t of TIPOS) {
      if (t === 'alagamento') continue;
      let e = 0; for (let bi = 0; bi < B; bi++) e += estrutural(t, bi, h);
      espF[t][f] += e;
    }
    for (const o of ocsPorHora.get(h) || []) obsF[o.tipo][f]++;
  }
  const chuva = {};
  for (const t of TIPOS) {
    chuva[t] = obsF[t].map((o, f) => (f === 0 ? 1 : (o + ENCOLHIMENTO) / (espF[t][f] + ENCOLHIMENTO)));
    const seco = (obsF[t][0] + ENCOLHIMENTO) / (espF[t][0] + ENCOLHIMENTO);
    chuva[t] = chuva[t].map((x, f) => (f === 0 ? 1 : x / seco));
  }

  // Alagamento depende do bairro e da chuva: taxa por bairro x faixa (com prior).
  const horasFaixa = [0, 0, 0, 0]; for (const h of horas) horasFaixa[faixaChuva(chuvaDe(h))]++;
  const alag = bairros.map(() => [0, 0, 0, 0]);
  for (const o of ocs) if (o.tipo === 'alagamento') alag[idx[o.bairro_id]][faixaChuva(chuvaDe(inicioHora(o.inicio)))]++;
  const totalAlagFaixa = [0, 1, 2, 3].map((f) => alag.reduce((s, a) => s + a[f], 0));
  const alagamento = alag.map((a) => a.map((c, f) => {
    if (f === 0) return 0;
    const media = totalAlagFaixa[f] / (B * Math.max(1, horasFaixa[f]));
    return (c + 1 * media * 4) / (Math.max(1, horasFaixa[f]) + 4);
  }));

  // --- 4) Efeito de eventos (jogos/shows): razão observado/esperado nas janelas ---
  const janelaEv = (e, h) => h >= e.inicio - 2 * HORA && h <= e.fim + HORA;
  const evObs = {}, evEsp = {};
  for (const t of TIPOS) { evObs[t] = 0; evEsp[t] = 0; }
  const evPassados = dados.eventos.filter((e) => e.fim < fim && e.inicio >= inicio);
  for (const e of evPassados) {
    const bi = idx[e.bairro_id]; if (bi === undefined) continue;
    for (let h = inicioHora(e.inicio - 2 * HORA); h <= e.fim + HORA; h += HORA) {
      for (const t of TIPOS) if (t !== 'alagamento') evEsp[t] += estrutural(t, bi, h) * chuva[t][faixaChuva(chuvaDe(h))];
      for (const o of ocsPorHora.get(h) || []) if (o.bairro_id === e.bairro_id && janelaEv(e, o.inicio)) evObs[o.tipo]++;
    }
  }
  const evento = {};
  for (const t of TIPOS) evento[t] = t === 'alagamento' ? 1 : (evObs[t] + ENCOLHIMENTO / 3) / (evEsp[t] + ENCOLHIMENTO / 3);

  // --- 5) Tendência: últimos 14 dias vs. o esperado pelo resto do modelo ---
  const corte = fim - 14 * DIA;
  const tendencia = {};
  for (const t of TIPOS) {
    tendencia[t] = new Array(B).fill(1);
    if (t === 'alagamento') continue;
    const obs = new Array(B).fill(0), esp = new Array(B).fill(0);
    for (const o of ocs) if (o.tipo === t && o.inicio >= corte) obs[idx[o.bairro_id]]++;
    for (let h = inicioHora(corte); h < fim; h += HORA) {
      const fc = chuva[t][faixaChuva(chuvaDe(h))];
      for (let bi = 0; bi < B; bi++) esp[bi] += estrutural(t, bi, h) * fc;
    }
    for (let bi = 0; bi < B; bi++) tendencia[t][bi] = (obs[bi] + ENCOLHIMENTO) / (esp[bi] + ENCOLHIMENTO);
  }

  const modelo = {
    treinadoAte: fim, inicio, dias, nOcorrencias: ocs.length, bairros, idx,
    base, perfilHora, perfilDia, chuva, alagamento, evento, tendencia, s0: 1, sMax: 2,
    alagamentoNormal: () => 0,
  };

  // --- 6) Escala do índice 0–100 ---
  // Escala logarítmica entre a mediana (s0) e o máximo histórico (sMax): evita que o
  // Centro fique sempre "100" e ainda permite comparar bairros entre si.
  const scores = [];
  for (let h = inicioHora(fim - 28 * DIA); h < fim; h += HORA) {
    for (const b of bairros) scores.push(preverHora(modelo, b, h, { chuvaMm: chuvaDe(h), eventos: [], camerasFora: {} }).score);
  }
  scores.sort((a, b) => a - b);
  modelo.s0 = scores[Math.floor(scores.length * 0.5)] || 1e-3;
  modelo.sMax = scores[scores.length - 1] || 1;
  return modelo;
}

/**
 * Previsão para um bairro numa hora, com a explicação de cada fator.
 * ctx = { chuvaMm, eventos: [...], camerasFora: {bairroId: n} }
 */
function preverHora(modelo, bairro, h, ctx) {
  const bi = modelo.idx[bairro.id];
  const f = faixaChuva(ctx.chuvaMm || 0);
  const evAtivo = (ctx.eventos || []).find((e) => h >= e.inicio - 2 * HORA && h <= e.fim + HORA &&
    (e.bairro_id === bairro.id || (e.vizinhos || []).includes(bairro.id)));
  const pesoEvento = evAtivo ? (evAtivo.bairro_id === bairro.id ? 1 : 0.5) : 0;
  const cams = (ctx.camerasFora || {})[bairro.id] || 0;

  const porTipo = [];
  let score = 0, scoreNormal = 0;
  for (const t of TIPOS) {
    let lambda, fatores;
    if (t === 'alagamento') {
      lambda = modelo.alagamento[bi][f];
      fatores = f > 0 ? [{ id: 'chuva', nome: `Histórico de alagamento com ${NOME_FAIXA[f]}`, mult: null }] : [];
    } else {
      const base = modelo.base[t][bi] / 24;
      const fh = modelo.perfilHora[t][horaLocal(h)];
      const fd = modelo.perfilDia[t][diaSemana(h)];
      const fc = modelo.chuva[t][f];
      const fe = 1 + (modelo.evento[t] - 1) * pesoEvento;
      const ft = modelo.tendencia[t][bi];
      const fcob = (t === 'roubo_furto' || t === 'vandalismo_equipamento') && cams ? 1 + 0.1 * cams : 1;
      lambda = base * fh * fd * fc * fe * ft * fcob;
      scoreNormal += TIPO_OC[t].peso * base * fh * fd;
      fatores = [
        { id: 'horario', nome: `Horário (${String(horaLocal(h)).padStart(2, '0')}h)`, mult: fh },
        { id: 'dia', nome: 'Dia da semana', mult: fd },
        { id: 'chuva', nome: NOME_FAIXA[f], mult: fc },
        { id: 'evento', nome: evAtivo ? `${evAtivo.nome}` : 'Sem evento', mult: fe },
        { id: 'tendencia', nome: 'Tendência dos últimos 14 dias', mult: ft },
        { id: 'cobertura', nome: cams ? `${cams} câmera(s) fora de operação no bairro` : 'Cobertura de câmeras normal', mult: fcob },
      ];
    }
    const peso = TIPO_OC[t].peso;
    score += peso * lambda;
    porTipo.push({ tipo: t, lambda, prob: 1 - Math.exp(-lambda), peso, fatores });
  }
  const risco = Math.max(0, Math.min(100, Math.round(100 * Math.log1p(score / modelo.s0) / Math.log1p(modelo.sMax / modelo.s0))));
  // "Desvio do normal": quanto a situação (chuva, evento, tendência, cobertura) eleva o risco
  // em relação ao que é típico para esse bairro, nesse horário e dia da semana.
  const desvio = scoreNormal > 0 ? score / (scoreNormal + modelo.alagamentoNormal(bi)) : 1;
  return { bairro_id: bairro.id, hora: h, score, risco, desvio: +desvio.toFixed(2), porTipo, evento: evAtivo || null, faixaChuva: f, chuvaMm: ctx.chuvaMm || 0 };
}

const nivel = (r) => (r >= 75 ? 'critico' : r >= 50 ? 'alto' : r >= 25 ? 'moderado' : 'baixo');

/** Previsão das próximas N horas para todos os bairros. */
function preverJanela(modelo, inicio, horas, ctxBase) {
  const out = [];
  for (let k = 0; k < horas; k++) {
    const h = inicioHora(inicio) + k * HORA;
    for (const b of modelo.bairros) {
      const p = preverHora(modelo, b, h, { ...ctxBase, chuvaMm: ctxBase.chuvaPrevista.get(h) || 0 });
      out.push(p);
    }
  }
  return out;
}

/** Resume uma previsão em fatores agregados (média ponderada pelo peso dos tipos). */
function explicar(p) {
  const tipos = p.porTipo.filter((x) => x.lambda > 1e-4).sort((a, b) => b.peso * b.lambda - a.peso * a.lambda);
  const total = tipos.reduce((s, x) => s + x.peso * x.lambda, 0) || 1;
  const fatores = {};
  for (const x of tipos) {
    for (const f of x.fatores) {
      if (f.mult === null) continue;
      if (!fatores[f.id]) fatores[f.id] = { id: f.id, nome: f.nome, logSoma: 0 };
      fatores[f.id].logSoma += (x.peso * x.lambda / total) * Math.log(f.mult);
      if (f.id === 'evento' && f.mult !== 1) fatores[f.id].nome = f.nome;
      if (f.id === 'cobertura' && f.mult !== 1) fatores[f.id].nome = f.nome;
    }
  }
  return {
    fatores: Object.values(fatores).map((f) => ({ id: f.id, nome: f.nome, mult: +Math.exp(f.logSoma).toFixed(2) })),
    tipos: tipos.slice(0, 5).map((x) => ({ tipo: x.tipo, nome: TIPO_OC[x.tipo].nome, esperado: +x.lambda.toFixed(3), prob: +x.prob.toFixed(3), contribuicao: +((x.peso * x.lambda) / total).toFixed(3) })),
  };
}

module.exports = { treinar, preverHora, preverJanela, explicar, nivel, faixaChuva, NOME_FAIXA, SEMANAS_TREINO };
