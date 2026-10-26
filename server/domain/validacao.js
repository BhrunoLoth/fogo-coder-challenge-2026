'use strict';
/**
 * Validação de entrada. Tudo que chega pela API passa por aqui antes do banco:
 * campos obrigatórios, tipos, listas fechadas (enum) e os atributos dinâmicos de
 * cada tipo de equipamento, validados contra o schema do catálogo.
 */
const { TIPO_EQ, SITUACAO, ORGAO, TIPO_AG, STATUS_AG, TURNOS, MANUTENCAO_TIPOS } = require('./catalog');

class ErroValidacao extends Error {
  constructor(erros) { super('Dados inválidos'); this.erros = erros; this.status = 422; }
}

const texto = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? '' : String(v).slice(0, max));
const numero = (v) => (v === '' || v == null ? null : Number(v));
const CEP_RE = /^\d{5}-?\d{3}$/;

function validarEquipamento(body, { parcial = false } = {}) {
  const erros = {};
  const out = {};
  const tipo = TIPO_EQ[body.tipo];
  if (!parcial || body.tipo !== undefined) { if (!tipo) erros.tipo = 'Tipo de equipamento inválido'; else out.tipo = body.tipo; }
  for (const campo of ['serie', 'marca', 'modelo']) {
    if (!parcial || body[campo] !== undefined) {
      out[campo] = texto(body[campo], 80);
      if (campo === 'serie' && !out[campo]) erros.serie = 'Número de série é obrigatório';
    }
  }
  if (!parcial || body.orgao !== undefined) { out.orgao = body.orgao || (tipo && tipo.orgao); if (!ORGAO[out.orgao]) erros.orgao = 'Órgão responsável inválido'; }
  for (const campo of ['rua', 'referencia', 'cidade', 'uf']) if (!parcial || body[campo] !== undefined) out[campo] = texto(body[campo], 120);
  if (!parcial) { out.cidade = out.cidade || 'Marília'; out.uf = (out.uf || 'SP').toUpperCase().slice(0, 2); }
  if (!parcial || body.cep !== undefined) {
    const bruto = body.cep == null ? '' : String(body.cep).trim();
    out.cep = bruto;
    if (bruto && !CEP_RE.test(bruto)) erros.cep = 'CEP deve ter o formato 00000-000';
    else if (bruto) {
      const n = Number(bruto.replace(/\D/g, ''));
      if (n < 17500000 || n > 17529999) erros.cep = 'CEP fora de Marília (faixa 17500-000 a 17529-999)';
      out.cep = `${bruto.replace(/\D/g, '').slice(0, 5)}-${bruto.replace(/\D/g, '').slice(5)}`;
    }
  }
  if (!parcial || body.lat !== undefined || body.lng !== undefined) {
    out.lat = numero(body.lat); out.lng = numero(body.lng);
    if (!Number.isFinite(out.lat) || out.lat < -90 || out.lat > 90) erros.lat = 'Latitude inválida';
    if (!Number.isFinite(out.lng) || out.lng < -180 || out.lng > 180) erros.lng = 'Longitude inválida';
  }
  if (!parcial || body.situacao !== undefined) { out.situacao = body.situacao || 'operacional'; if (!SITUACAO[out.situacao]) erros.situacao = 'Situação inválida'; }
  if (!parcial || body.manut_tipo !== undefined) {
    out.manut_tipo = body.manut_tipo || 'nenhuma';
    if (!MANUTENCAO_TIPOS.some((m) => m.id === out.manut_tipo)) erros.manut_tipo = 'Tipo de manutenção inválido';
    out.manut_data = numero(body.manut_data);
    out.manut_periodicidade_dias = numero(body.manut_periodicidade_dias);
    const ANO = 365 * 24 * 3600 * 1000, agora = Date.now();
    if (['agendada', 'periodica'].includes(out.manut_tipo) && !out.manut_data) erros.manut_data = 'Informe a data da próxima manutenção';
    else if (out.manut_data && (!Number.isFinite(out.manut_data) || out.manut_data < agora - 2 * ANO || out.manut_data > agora + 10 * ANO)) erros.manut_data = 'Data de manutenção fora de um intervalo razoável';
    if (out.manut_tipo === 'periodica' && !(out.manut_periodicidade_dias >= 1 && out.manut_periodicidade_dias <= 3650)) erros.manut_periodicidade_dias = 'Periodicidade entre 1 e 3650 dias';
    if (out.manut_tipo !== 'periodica') out.manut_periodicidade_dias = null;
  }
  if (body.instalado_em !== undefined) out.instalado_em = numero(body.instalado_em);
  // Atributos dinâmicos do tipo.
  const tipoFinal = TIPO_EQ[out.tipo || body.tipo];
  if (tipoFinal && (!parcial || body.atributos !== undefined)) {
    const attrs = {};
    const entrada = body.atributos || {};
    for (const a of tipoFinal.atributos) {
      const v = entrada[a.key];
      if (v === undefined || v === '' || v === null) continue;
      if (a.tipo === 'bool') attrs[a.key] = v === true || v === 'true' || v === 1;
      else if (a.tipo === 'number') {
        const n = Number(v);
        if (!Number.isFinite(n) || (a.min != null && n < a.min) || (a.max != null && n > a.max)) erros[`atributos.${a.key}`] = `${a.label}: valor entre ${a.min} e ${a.max}`;
        else attrs[a.key] = n;
      } else if (a.tipo === 'select') {
        if (!a.opcoes.includes(v)) erros[`atributos.${a.key}`] = `${a.label}: opção inválida`; else attrs[a.key] = v;
      } else attrs[a.key] = texto(v, 120);
    }
    out.atributos = attrs;
  }
  if (Object.keys(erros).length) throw new ErroValidacao(erros);
  return out;
}

function validarAgente(body, { parcial = false } = {}) {
  const erros = {}; const out = {};
  if (!parcial || body.nome !== undefined) { out.nome = texto(body.nome, 80); if (out.nome.length < 3) erros.nome = 'Nome é obrigatório'; }
  if (!parcial || body.matricula !== undefined) { out.matricula = texto(body.matricula, 20); if (!out.matricula) erros.matricula = 'Matrícula é obrigatória'; }
  if (!parcial || body.tipo !== undefined) { out.tipo = body.tipo; if (!TIPO_AG[out.tipo]) erros.tipo = 'Tipo de agente inválido'; else out.orgao = TIPO_AG[out.tipo].orgao; }
  if (!parcial || body.turno !== undefined) { out.turno = body.turno; if (!TURNOS.some((t) => t.id === out.turno)) erros.turno = 'Turno inválido'; }
  if (!parcial || body.status !== undefined) { out.status = body.status || 'fora_turno'; if (!STATUS_AG[out.status]) erros.status = 'Status inválido'; }
  if (!parcial || body.telefone !== undefined) out.telefone = texto(body.telefone, 20);
  if (!parcial || body.bairro_id !== undefined) { out.bairro_id = numero(body.bairro_id); if (!out.bairro_id) erros.bairro_id = 'Bairro de atuação é obrigatório'; }
  if (body.veiculo_id !== undefined) out.veiculo_id = numero(body.veiculo_id);
  if (Object.keys(erros).length) throw new ErroValidacao(erros);
  return out;
}

module.exports = { validarEquipamento, validarAgente, ErroValidacao };
