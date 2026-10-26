'use strict';
/**
 * "VERDADE OCULTA" DA CIDADE SIMULADA
 * ----------------------------------
 * Este arquivo define como a cidade realmente se comporta: taxas de ocorrência por
 * bairro, horário e dia, efeito da chuva, de eventos, tendências e desgaste dos
 * equipamentos.
 *
 * REGRA DE OURO DO PROJETO: o motor preditivo (server/engine) NUNCA importa este
 * arquivo. Ele só enxerga o banco de dados (o histórico), exatamente como aconteceria
 * com dados reais. Se a previsão acerta, é porque aprendeu com os dados, não porque
 * "colou" a resposta. O backtest mostra isso de forma mensurável.
 */
const { horaLocal, diaSemana, inicioDia, DIA, HORA } = require('../lib/time');
const { mulberry32 } = require('../lib/rng');

// Perfil horário (00h..23h), valores relativos.
const PERFIL_HORA = {
  acidente:                 [.3,.2,.2,.2,.3,.6,1.2,2.2,2.0,1.2,1.0,1.1,1.6,1.4,1.1,1.1,1.4,2.2,2.4,1.8,1.2,.9,.7,.5],
  congestionamento:         [0,0,0,0,0,.2,1.0,3.2,2.8,1.0,.6,.8,1.8,1.6,.7,.7,1.2,3.0,3.4,1.6,.5,.2,.1,0],
  via_obstruida:            [.2,.1,.1,.1,.2,.4,.9,1.6,1.5,1.2,1.1,1.1,1.3,1.3,1.2,1.2,1.4,1.7,1.6,1.1,.8,.6,.4,.3],
  estacionamento_irregular: [0,0,0,0,0,0,.3,1.2,2.0,2.4,2.6,2.6,2.2,2.2,2.5,2.6,2.4,1.8,1.0,.5,.3,.1,0,0],
  roubo_furto:              [1.1,.9,.7,.6,.6,.9,1.0,.8,.6,.6,.7,.8,.8,.8,.8,.9,1.0,1.3,1.8,2.2,2.3,2.1,1.8,1.4],
  perturbacao:              [2.2,2.0,1.4,.8,.3,.1,.1,.1,.1,.2,.3,.4,.5,.5,.5,.5,.6,.8,1.1,1.5,2.0,2.4,2.6,2.5],
  alagamento:               new Array(24).fill(1),
  vandalismo_equipamento:   [2.4,2.6,2.4,2.0,1.4,.6,.3,.2,.2,.2,.2,.3,.3,.3,.3,.3,.4,.5,.7,.9,1.2,1.5,1.9,2.2],
};

// Fator por dia da semana (dom..sáb).
const FATOR_DIA = {
  acidente:                 [.8, 1, 1, 1, 1.05, 1.2, 1.05],
  congestionamento:         [.25, 1.1, 1, 1, 1.05, 1.2, .55],
  via_obstruida:            [.6, 1, 1, 1, 1, 1.1, .8],
  estacionamento_irregular: [.15, 1, 1, 1, 1, 1.05, .7],
  roubo_furto:              [.9, 1, .95, 1, 1, 1.2, 1.2],
  perturbacao:              [1.5, .6, .6, .7, .85, 1.5, 1.9],
  alagamento:               [1, 1, 1, 1, 1, 1, 1],
  vandalismo_equipamento:   [1.2, 1, 1, 1, 1, 1.1, 1.3],
};

// Total médio por dia na cidade inteira (antes dos fatores).
const TOTAL_DIA = {
  acidente: 16, congestionamento: 20, via_obstruida: 18, estacionamento_irregular: 85,
  roubo_furto: 15, perturbacao: 13, alagamento: 0, vandalismo_equipamento: 2.2,
};

// Multiplicador por perfil de bairro.
const PERFIL_BAIRRO = {
  comercial:     { acidente: 1.7, congestionamento: 2.8, via_obstruida: 1.6, estacionamento_irregular: 4.5, roubo_furto: 1.8, perturbacao: 1.0, vandalismo_equipamento: 1.3 },
  universitario: { acidente: 1.2, congestionamento: 1.3, via_obstruida: 1.0, estacionamento_irregular: 1.4, roubo_furto: 1.1, perturbacao: 2.6, vandalismo_equipamento: 1.2 },
  residencial:   { acidente: .8,  congestionamento: .6,  via_obstruida: .8,  estacionamento_irregular: .5,  roubo_furto: .9,  perturbacao: .8,  vandalismo_equipamento: .8 },
  periferico:    { acidente: .9,  congestionamento: .35, via_obstruida: .9,  estacionamento_irregular: .2,  roubo_furto: 1.4, perturbacao: 1.3, vandalismo_equipamento: 1.6 },
  industrial:    { acidente: 1.4, congestionamento: .9,  via_obstruida: 1.5, estacionamento_irregular: .3,  roubo_furto: .8,  perturbacao: .3,  vandalismo_equipamento: 1.1 },
  rodovia:       { acidente: 2.0, congestionamento: .8,  via_obstruida: 1.6, estacionamento_irregular: .2,  roubo_furto: .7,  perturbacao: .4,  vandalismo_equipamento: .9 },
};

/** Hash determinístico -> [0,1). Torna clima e eventos reprodutíveis sem armazenar estado. */
function hash01(...nums) {
  let h = 2166136261;
  for (const n of nums) { h ^= Math.floor(n); h = Math.imul(h, 16777619); }
  return mulberry32(h >>> 0)();
}

// Chuva extra injetada pelo modo exercício ("e se chover forte agora?").
const CHUVA_EXTRA = new Map();
function definirChuvaExtra(hourTs, mm) { CHUVA_EXTRA.set(hourTs, mm); }

/** Chuva real (mm/h) na hora que começa em hourTs. Outubro/novembro: estação chuvosa. */
function chuvaReal(hourTs) {
  const extra = CHUVA_EXTRA.get(hourTs) || 0;
  return Math.max(extra, chuvaBase(hourTs));
}

function chuvaBase(hourTs) {
  const dia = Math.floor(inicioDia(hourTs) / DIA);
  if (hash01(dia, 1) > 0.30) return 0; // ~30% dos dias têm chuva
  const inicio = 13 + Math.floor(hash01(dia, 2) * 7); // começa entre 13h e 19h
  const dur = 1 + Math.floor(hash01(dia, 3) * 4);     // 1 a 4 horas
  const pico = 3 + hash01(dia, 4) * 32;               // até ~35 mm/h
  const h = horaLocal(hourTs);
  if (h < inicio || h >= inicio + dur) return 0;
  const pos = (h - inicio + 0.5) / dur;               // forma de sino
  return +(pico * Math.sin(Math.PI * pos)).toFixed(1);
}

/** Previsão meteorológica: a chuva real com erro de ±30% (a previsão nunca é perfeita). */
function chuvaPrevista(hourTs) {
  if (CHUVA_EXTRA.has(hourTs)) return CHUVA_EXTRA.get(hourTs);
  const real = chuvaReal(hourTs);
  const erro = 0.7 + hash01(hourTs / HORA, 9) * 0.6;
  return +(real * erro).toFixed(1);
}

/**
 * Tendência: alguns bairros estão mudando de comportamento nas últimas 3 semanas.
 * (O motor precisa perceber isso sozinho, comparando janelas recentes com o histórico.)
 */
function fatorTendencia(bairro, tipo, ts, agora) {
  if (!bairro.tendencia || bairro.tendencia.tipo !== tipo) return 1;
  const diasAtras = (agora - ts) / DIA;
  if (diasAtras > 21) return 1;
  const progresso = 1 - Math.max(0, diasAtras) / 21; // 0 há 21 dias -> 1 hoje
  return 1 + (bairro.tendencia.fator - 1) * progresso;
}

/** Efeito de evento (jogo/show) no bairro e vizinhos. */
function fatorEvento(bairro, tipo, ts, eventos) {
  let f = 1;
  for (const ev of eventos) {
    if (ts < ev.inicio - 2 * HORA || ts > ev.fim + HORA) continue;
    const perto = ev.bairro_id === bairro.id ? 1 : (ev.vizinhos || []).includes(bairro.id) ? 0.5 : 0;
    if (!perto) continue;
    const efeito = { congestionamento: 3.5, perturbacao: 2.8, roubo_furto: 1.7, estacionamento_irregular: 3, acidente: 1.6, via_obstruida: 1.5 }[tipo] || 1;
    f *= 1 + (efeito - 1) * perto;
  }
  return f;
}

function fatorChuva(tipo, mm, bairro) {
  if (mm <= 0) return tipo === 'alagamento' ? 0 : 1;
  switch (tipo) {
    case 'acidente': return Math.min(2.4, 1 + 0.045 * mm);
    case 'congestionamento': return Math.min(2.2, 1 + 0.035 * mm);
    case 'via_obstruida': return Math.min(1.8, 1 + 0.02 * mm);
    case 'estacionamento_irregular': return Math.max(0.4, 1 - 0.02 * mm);
    case 'perturbacao': return Math.max(0.4, 1 - 0.025 * mm);
    case 'roubo_furto': return Math.max(0.6, 1 - 0.012 * mm);
    case 'alagamento': return bairro.baixada ? Math.max(0, mm - 8) * 0.06 : Math.max(0, mm - 18) * 0.008;
    default: return 1;
  }
}

/**
 * Taxa esperada (ocorrências por hora) de um tipo, num bairro, numa hora.
 * fatorCobertura: câmeras furtadas/inoperantes no bairro aumentam crimes.
 */
function taxaHora(bairro, tipo, hourTs, ctx) {
  const h = horaLocal(hourTs), d = diaSemana(hourTs);
  const mm = chuvaReal(hourTs);
  const perfil = PERFIL_BAIRRO[bairro.perfil] || PERFIL_BAIRRO.residencial;
  const somaHora = PERFIL_HORA[tipo].reduce((s, x) => s + x, 0) || 24;
  const baseHora = (TOTAL_DIA[tipo] / ctx.somaPesos) * bairro.peso * (perfil[tipo] ?? 1) * (PERFIL_HORA[tipo][h] / somaHora);
  let taxa = baseHora * FATOR_DIA[tipo][d];
  if (tipo === 'alagamento') taxa = fatorChuva(tipo, mm, bairro) * 0.5;
  else taxa *= fatorChuva(tipo, mm, bairro);
  taxa *= fatorTendencia(bairro, tipo, hourTs, ctx.agora);
  taxa *= fatorEvento(bairro, tipo, hourTs, ctx.eventos || []);
  if ((tipo === 'roubo_furto' || tipo === 'vandalismo_equipamento') && ctx.camerasFora) {
    taxa *= 1 + 0.12 * (ctx.camerasFora[bairro.id] || 0);
  }
  return taxa;
}

// Desgaste dos equipamentos: distribuição de Weibull (forma k, escala eta em dias).
const WEIBULL = {
  radar: { k: 1.7, eta: 420 }, camera: { k: 1.5, eta: 320 }, semaforo: { k: 1.8, eta: 380 },
  balanca: { k: 1.6, eta: 400 }, fiscal_autonomo: { k: 1.4, eta: 220 }, cancela: { k: 1.6, eta: 260 },
  totem: { k: 1.5, eta: 210 }, taxi: { k: 1.3, eta: 300 }, mototaxi: { k: 1.3, eta: 260 },
  escolar: { k: 1.3, eta: 300 }, patinete: { k: 1.4, eta: 140 }, moto_agente: { k: 1.3, eta: 280 },
  viatura_gcm: { k: 1.3, eta: 300 }, viatura_pm: { k: 1.3, eta: 300 }, sensor_alagamento: { k: 1.6, eta: 360 },
  painel: { k: 1.7, eta: 500 },
};
// Uma marca ruim de propósito: o sistema deve descobrir isso nos dados.
const FATOR_MARCA = { 'Vigiax': 0.42 }; // marca fictícia

module.exports = {
  PERFIL_HORA, FATOR_DIA, TOTAL_DIA, PERFIL_BAIRRO, WEIBULL, FATOR_MARCA,
  chuvaReal, chuvaPrevista, definirChuvaExtra, taxaHora, hash01,
};
