'use strict';
/**
 * Tempo da cidade. Marília usa o horário de Brasília (UTC-3, sem horário de verão
 * desde 2019), então usamos deslocamento fixo: simples e sem depender do fuso
 * configurado na máquina do avaliador.
 */
const OFFSET_MS = -3 * 3600 * 1000;
const HORA = 3600 * 1000;
const DIA = 24 * HORA;

const local = (ts) => new Date(ts + OFFSET_MS);
const horaLocal = (ts) => local(ts).getUTCHours();
const diaSemana = (ts) => local(ts).getUTCDay(); // 0 = domingo
/** Início da hora cheia (timestamp UTC). */
const inicioHora = (ts) => Math.floor(ts / HORA) * HORA;
/** Início do dia local (00:00 em Marília), como timestamp UTC. */
const inicioDia = (ts) => Math.floor((ts + OFFSET_MS) / DIA) * DIA - OFFSET_MS;

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function fmt(ts) {
  const d = local(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

module.exports = { OFFSET_MS, HORA, DIA, local, horaLocal, diaSemana, inicioHora, inicioDia, DIAS, fmt };
