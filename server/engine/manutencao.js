'use strict';
/**
 * MANUTENÇÃO PREDITIVA
 * ====================
 * Modelo de confiabilidade de Weibull, ajustado por máxima verossimilhança para
 * cada tipo de equipamento, usando o histórico de manutenções do banco:
 *   - manutenção corretiva  = falha observada (evento)
 *   - manutenção preventiva = intervalo "censurado" (o equipamento não falhou)
 *   - tempo desde a última manutenção até hoje = também censurado
 *
 * Com a forma k fixa, a escala η tem solução fechada: η = (Σ tᵢᵏ / nº de falhas)^(1/k).
 * Para achar k, fazemos uma busca em grade maximizando a log-verossimilhança.
 *
 * Probabilidade de falhar nos próximos D dias, dado que já está funcionando há a dias:
 *   P = 1 − exp( −[ ((a+D)/η)ᵏ − (a/η)ᵏ ] × m )
 * onde m é o multiplicador da marca (marcas que falham mais que o esperado) e do
 * sinal de telemetria (erros crescendo na última semana = desgaste).
 */
const { DIA } = require('../lib/time');
const { TIPO_EQ } = require('../domain/catalog');
const { poissonCaudaSuperior } = require('./algoritmos');

function intervalos(equipamentos, manutencoes, agora) {
  const porEq = new Map();
  for (const m of manutencoes) {
    if (!porEq.has(m.equipamento_id)) porEq.set(m.equipamento_id, []);
    porEq.get(m.equipamento_id).push(m);
  }
  const out = [];
  for (const e of equipamentos) {
    if (!e.instalado_em) continue;
    const ms = (porEq.get(e.id) || []).sort((a, b) => a.data - b.data);
    let t = e.instalado_em;
    for (const m of ms) {
      out.push({ eq: e, dias: Math.max(0.5, (m.data - t) / DIA), falha: m.tipo === 'corretiva' });
      t = m.data;
    }
    const emFalha = ['mau_funcionamento', 'manutencao'].includes(e.situacao);
    out.push({ eq: e, dias: Math.max(0.5, (agora - t) / DIA), falha: emFalha });
  }
  return out;
}

function ajustarWeibull(dados, fatorMarca = {}) {
  // Modelo de riscos proporcionais: H(t) = m_marca · (t/η)^k.
  const m = (d) => fatorMarca[d.eq.marca] || 1;
  const nf = dados.filter((d) => d.falha).length;
  if (nf < 3) return null;
  let melhor = null;
  for (let k = 0.6; k <= 3.5; k += 0.05) {
    const somaTk = dados.reduce((s, d) => s + m(d) * Math.pow(d.dias, k), 0);
    const eta = Math.pow(somaTk / nf, 1 / k);
    let ll = 0;
    for (const d of dados) {
      const z = m(d) * Math.pow(d.dias / eta, k);
      if (d.falha) ll += Math.log(k / eta) + (k - 1) * Math.log(d.dias / eta) + Math.log(m(d));
      ll -= z;
    }
    if (!melhor || ll > melhor.ll) melhor = { k: +k.toFixed(2), eta, ll, falhas: nf, n: dados.length };
  }
  return melhor;
}

function analisar({ equipamentos, manutencoes, telemetria, agora, riscoBairro = {} }) {
  const intervs = intervalos(equipamentos, manutencoes, agora);
  const porTipo = {};
  for (const d of intervs) (porTipo[d.eq.tipo] = porTipo[d.eq.tipo] || []).push(d);
  const modelos = {};
  for (const [tipo, ds] of Object.entries(porTipo)) {
    const m = ajustarWeibull(ds);
    if (m) modelos[tipo] = { ...m, mtbf: +(m.eta * gamma(1 + 1 / m.k)).toFixed(0) };
  }
  // Confiabilidade por marca: falhas observadas ÷ falhas esperadas pelo modelo do tipo.
  // Só é sinalizada quando o excesso é estatisticamente improvável (Poisson, p < 1%).
  const acc = {};
  for (const d of intervs) {
    const mod = modelos[d.eq.tipo]; if (!mod || !d.eq.marca) continue;
    const a = acc[d.eq.marca] || (acc[d.eq.marca] = { marca: d.eq.marca, obs: 0, esp: 0, equipamentos: new Set(), tipos: new Set() });
    a.obs += d.falha ? 1 : 0; a.esp += Math.pow(d.dias / mod.eta, mod.k); a.equipamentos.add(d.eq.id); a.tipos.add(d.eq.tipo);
  }
  const marcas = {};
  for (const a of Object.values(acc)) {
    const fator = (a.obs + 4) / (a.esp + 4);
    const p = a.obs > a.esp ? poissonCaudaSuperior(a.obs, a.esp) : 1;
    marcas[a.marca] = { marca: a.marca, fator, falhas: a.obs, esperado: +a.esp.toFixed(1), equipamentos: a.equipamentos.size, tipos: [...a.tipos], p: +p.toFixed(5), significativo: p < 0.01 && a.equipamentos.size >= 3 };
  }
  const fatorMarca = {};
  for (const e of equipamentos) fatorMarca[`${e.tipo}|${e.marca}`] = marcas[e.marca] ? marcas[e.marca].fator : 1;

  // Sinal de telemetria: erros dos últimos 7 dias vs. média dos 30 anteriores.
  const tel = new Map();
  const corte7 = agora - 7 * DIA, corte37 = agora - 37 * DIA;
  for (const t of telemetria) {
    if (!tel.has(t.equipamento_id)) tel.set(t.equipamento_id, { r: 0, nr: 0, b: 0, nb: 0 });
    const x = tel.get(t.equipamento_id);
    if (t.dia >= corte7) { x.r += t.erros; x.nr++; } else if (t.dia >= corte37) { x.b += t.erros; x.nb++; }
  }

  const ultimaPorEq = new Map();
  for (const m of manutencoes) ultimaPorEq.set(m.equipamento_id, Math.max(ultimaPorEq.get(m.equipamento_id) || 0, m.data));

  const HORIZONTE = 30;
  const lista = [];
  for (const e of equipamentos) {
    if (e.situacao !== 'operacional') continue;
    const mod = modelos[e.tipo]; if (!mod) continue;
    const ultima = Math.max(e.ultima_manut || 0, ultimaPorEq.get(e.id) || 0, e.instalado_em || 0);
    const idade = (agora - ultima) / DIA;
    const fMarca = fatorMarca[`${e.tipo}|${e.marca}`] || 1;
    const fMarcaBruto = marcas[e.marca] ? marcas[e.marca].fator : 1;
    const x = tel.get(e.id);
    const taxaRecente = x && x.nr ? x.r / x.nr : 0, taxaBase = x && x.nb ? x.b / x.nb : 0;
    const razaoErros = (taxaRecente + 1) / (taxaBase + 1);
    const fTel = Math.max(1, Math.sqrt(razaoErros));
    const m = fMarca * fTel;
    const H = (d) => Math.pow(d / mod.eta, mod.k);
    const prob = 1 - Math.exp(-(H(idade + HORIZONTE) - H(idade)) * m);
    // Data sugerida: quando a probabilidade condicional de falha atinge 20%.
    let diasAte20 = null;
    for (let d = 1; d <= 365; d++) { if (1 - Math.exp(-(H(idade + d) - H(idade)) * m) >= 0.2) { diasAte20 = d; break; } }
    const crit = TIPO_EQ[e.tipo].criticidade;
    const riscoLocal = riscoBairro[e.bairro_id] || 0;
    const prioridade = prob * crit * (1 + riscoLocal / 100);
    const motivos = [`Funcionando há ${Math.round(idade)} dias desde a última manutenção (vida característica do tipo: ${Math.round(mod.eta)} dias)`];
    if (fMarcaBruto > 1.25 && marcas[e.marca] && marcas[e.marca].significativo) motivos.push(`Marca ${e.marca} falha ${fMarcaBruto.toFixed(1).replace(".", ",")}× o esperado para o tipo (estatisticamente significativo)`);
    if (razaoErros > 1.6) motivos.push(`Erros de telemetria ${razaoErros.toFixed(1).replace(".", ",")}× acima da média recente`);
    if (riscoLocal >= 60) motivos.push('Instalado em região de risco elevado');
    lista.push({
      equipamento_id: e.id, serie: e.serie, tipo: e.tipo, marca: e.marca, modelo: e.modelo, bairro_id: e.bairro_id,
      idade: Math.round(idade), prob30: +prob.toFixed(3), prioridade: +prioridade.toFixed(3),
      sugerirAte: diasAte20 !== null ? agora + diasAte20 * DIA : null, motivos, fatorMarca: +fMarcaBruto.toFixed(2), razaoErros: +razaoErros.toFixed(2),
    });
  }
  lista.sort((a, b) => b.prioridade - a.prioridade);
  return {
    modelos, marcas: Object.values(marcas).sort((a, b) => b.fator - a.fator), ranking: lista,
    falhasEsperadas30d: +lista.reduce((s, x) => s + x.prob30, 0).toFixed(1),
  };
}

/** Função Gama (aproximação de Lanczos), usada para o MTBF = η·Γ(1 + 1/k). */
function gamma(z) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1; let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

module.exports = { analisar, ajustarWeibull };
