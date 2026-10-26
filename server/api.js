'use strict';
/**
 * API REST + stream de eventos (Server-Sent Events).
 * Servidor HTTP puro do Node, sem framework: um roteador pequeno, explícito e legível.
 * Todas as consultas usam parâmetros (?), nunca concatenação de entrada do usuário.
 */
const { HORA, DIA, inicioHora } = require('./lib/time');
const { haversine, nearest } = require('./lib/geo');
const C = require('./domain/catalog');
const { validarEquipamento, validarAgente, ErroValidacao } = require('./domain/validacao');
const risco = require('./engine/risco');

function criarApi({ db, motor, sim, city }) {
  const rotas = [];
  const rota = (metodo, padrao, fn) => {
    const chaves = [];
    const re = new RegExp('^' + padrao.replace(/:(\w+)/g, (_, k) => { chaves.push(k); return '([^/]+)'; }) + '$');
    rotas.push({ metodo, re, chaves, fn });
  };
  const auditar = (ator, acao, entidade, id, detalhes) =>
    db.run('INSERT INTO auditoria(ts, ator, acao, entidade, entidade_id, detalhes) VALUES(?,?,?,?,?,?)', [Date.now(), ator, acao, entidade, id, JSON.stringify(detalhes || {})]);
  const naoEncontrado = () => { const e = new Error('Não encontrado'); e.status = 404; throw e; };
  const bairroDoPonto = (lat, lng) => motor.bairros[nearest(lat, lng, motor.bairros).index];
  const parseEq = (e) => e && { ...e, atributos: JSON.parse(e.atributos || '{}') };

  // ----------------------------------------------------------------- meta
  rota('GET', '/api/meta', () => ({
    cidade: { nome: 'Marília', uf: 'SP', centro: city.center, bbox: city.bbox, pontos: city.pontos_referencia },
    bairros: motor.bairros.map((b, i) => ({ ...b, ruas: JSON.parse(b.ruas || '[]'), poligono: motor.celulas[i] })),
    tiposEquipamento: C.TIPOS_EQUIPAMENTO, situacoes: C.SITUACOES, manutencaoTipos: C.MANUTENCAO_TIPOS, orgaos: C.ORGAOS,
    tiposAgente: C.TIPOS_AGENTE, statusAgente: C.STATUS_AGENTE, turnos: C.TURNOS, tiposOcorrencia: C.TIPOS_OCORRENCIA, zonas: C.ZONAS,
    agora: Date.now(),
  }));

  rota('GET', '/api/estado', () => sim.estadoAoVivo(Date.now()));

  // --------------------------------------------------------- equipamentos
  rota('GET', '/api/equipamentos', ({ q }) => {
    const where = [], p = [];
    if (q.tipo) { where.push(`e.tipo IN (${q.tipo.split(',').map(() => '?').join(',')})`); p.push(...q.tipo.split(',')); }
    if (q.situacao) { where.push(`e.situacao IN (${q.situacao.split(',').map(() => '?').join(',')})`); p.push(...q.situacao.split(',')); }
    if (q.bairro) { where.push('e.bairro_id = ?'); p.push(Number(q.bairro)); }
    if (q.zona) { where.push('b.zona = ?'); p.push(q.zona); }
    if (q.orgao) { where.push('e.orgao = ?'); p.push(q.orgao); }
    if (q.manut === 'urgente') { where.push("(e.manut_tipo = 'imediata' OR (e.manut_data IS NOT NULL AND e.manut_data < ? AND e.situacao != 'nao_instalado'))"); p.push(Date.now() + 7 * DIA); }
    if (q.busca) { where.push('(e.serie LIKE ? OR e.marca LIKE ? OR e.modelo LIKE ? OR e.rua LIKE ?)'); const s = `%${q.busca}%`; p.push(s, s, s, s); }
    const sql = `SELECT e.*, b.nome AS bairro, b.zona FROM equipamentos e LEFT JOIN bairros b ON b.id = e.bairro_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.tipo, e.serie`;
    return db.all(sql, p).map(parseEq);
  });

  rota('GET', '/api/equipamentos/:id', ({ params }) => {
    const e = parseEq(db.get('SELECT e.*, b.nome AS bairro, b.zona FROM equipamentos e LEFT JOIN bairros b ON b.id = e.bairro_id WHERE e.id = ?', [Number(params.id)]));
    if (!e) naoEncontrado();
    const man = motor.manutencao();
    return {
      ...e, semSinal: sim.estaSemSinal(e),
      manutencoes: db.all('SELECT * FROM manutencoes WHERE equipamento_id = ? ORDER BY data DESC LIMIT 20', [e.id]),
      manutencoesTotal: db.get('SELECT COUNT(*) AS n FROM manutencoes WHERE equipamento_id = ?', [e.id]).n,
      historicoSituacao: db.all('SELECT * FROM situacao_historico WHERE equipamento_id = ? ORDER BY ts DESC LIMIT 20', [e.id]),
      telemetria: db.all('SELECT dia, disponibilidade, leituras, erros FROM telemetria_diaria WHERE equipamento_id = ? ORDER BY dia DESC LIMIT 30', [e.id]).reverse(),
      preditivo: man.ranking.find((x) => x.equipamento_id === e.id) || null,
      modeloTipo: man.modelos[e.tipo] || null,
      fluxo: sim.fluxos.has(e.id) ? sim.leituraFluxos().find((f) => f.id === e.id) : null,
      auditoria: db.all("SELECT * FROM auditoria WHERE entidade = 'equipamento' AND entidade_id = ? ORDER BY ts DESC LIMIT 15", [e.id]),
    };
  });

  rota('POST', '/api/equipamentos', ({ body, ator }) => {
    const d = validarEquipamento(body);
    if (!dentroDaCidade(d.lat, d.lng)) throw new ErroValidacao({ lat: 'A localização precisa estar dentro de Marília (clique no mapa)' });
    if (db.get('SELECT id FROM equipamentos WHERE serie = ?', [d.serie])) throw new ErroValidacao({ serie: 'Já existe equipamento com este número de série' });
    const b = bairroDoPonto(d.lat, d.lng);
    const agora = Date.now();
    const id = db.run(`INSERT INTO equipamentos(tipo, serie, marca, modelo, orgao, cep, rua, referencia, bairro_id, cidade, uf, lat, lng, situacao,
      manut_tipo, manut_data, manut_periodicidade_dias, instalado_em, ultima_manut, atributos, ultimo_sinal, criado_em, atualizado_em)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [d.tipo, d.serie, d.marca, d.modelo, d.orgao, d.cep || b.cep, d.rua, d.referencia, b.id, d.cidade, d.uf, d.lat, d.lng, d.situacao,
      d.manut_tipo, d.manut_data, d.manut_periodicidade_dias, d.situacao === 'nao_instalado' ? null : (d.instalado_em || agora),
      d.situacao === 'nao_instalado' ? null : agora, JSON.stringify(d.atributos || {}), agora, agora, agora]);
    db.run('INSERT INTO situacao_historico(equipamento_id, ts, de, para, motivo) VALUES(?,?,?,?,?)', [id, agora, null, d.situacao, 'Cadastro']);
    auditar(ator, 'criar', 'equipamento', id, { serie: d.serie, tipo: d.tipo });
    motor.invalidar(); sim._moveis = null;
    sim.emitir('equipamento', { id, acao: 'criado' });
    return { id };
  });

  rota('PUT', '/api/equipamentos/:id', ({ params, body, ator }) => {
    const id = Number(params.id);
    const atual = db.get('SELECT * FROM equipamentos WHERE id = ?', [id]);
    if (!atual) naoEncontrado();
    const d = validarEquipamento({ ...atual, atributos: JSON.parse(atual.atributos), ...body });
    if (!dentroDaCidade(d.lat, d.lng)) throw new ErroValidacao({ lat: 'A localização precisa estar dentro de Marília (clique no mapa)' });
    if (d.serie !== atual.serie && db.get('SELECT id FROM equipamentos WHERE serie = ? AND id != ?', [d.serie, id])) throw new ErroValidacao({ serie: 'Já existe equipamento com este número de série' });
    const b = bairroDoPonto(d.lat, d.lng);
    const agora = Date.now();
    db.run(`UPDATE equipamentos SET tipo=?, serie=?, marca=?, modelo=?, orgao=?, cep=?, rua=?, referencia=?, bairro_id=?, cidade=?, uf=?, lat=?, lng=?,
      situacao=?, manut_tipo=?, manut_data=?, manut_periodicidade_dias=?, atributos=?, atualizado_em=? WHERE id=?`,
    [d.tipo, d.serie, d.marca, d.modelo, d.orgao, d.cep, d.rua, d.referencia, b.id, d.cidade, d.uf, d.lat, d.lng, d.situacao,
      d.manut_tipo, d.manut_data, d.manut_periodicidade_dias, JSON.stringify(d.atributos || {}), agora, id]);
    if (d.situacao !== atual.situacao) {
      db.run('INSERT INTO situacao_historico(equipamento_id, ts, de, para, motivo) VALUES(?,?,?,?,?)', [id, agora, atual.situacao, d.situacao, body.motivo || 'Edição manual']);
      if (d.situacao !== 'operacional') sim.silenciosos.delete(id);
      if (atual.situacao === 'nao_instalado' && d.situacao === 'operacional') db.run('UPDATE equipamentos SET instalado_em = ?, ultima_manut = ?, ultimo_sinal = ? WHERE id = ?', [agora, agora, agora, id]);
    }
    const mudou = Object.keys(d).filter((k) => k !== 'atributos' && String(d[k] ?? '') !== String(atual[k] ?? ''));
    auditar(ator, 'editar', 'equipamento', id, { campos: mudou });
    motor.invalidar(); sim._moveis = null;
    sim.emitir('equipamento', { id, acao: 'editado' });
    return { ok: true };
  });

  rota('DELETE', '/api/equipamentos/:id', ({ params, ator }) => {
    const id = Number(params.id);
    const e = db.get('SELECT serie FROM equipamentos WHERE id = ?', [id]);
    if (!e) naoEncontrado();
    db.run('UPDATE agentes SET veiculo_id = NULL WHERE veiculo_id = ?', [id]);
    db.run('DELETE FROM manutencoes WHERE equipamento_id = ?', [id]);
    db.run('DELETE FROM telemetria_diaria WHERE equipamento_id = ?', [id]);
    db.run('DELETE FROM situacao_historico WHERE equipamento_id = ?', [id]);
    db.run('DELETE FROM equipamentos WHERE id = ?', [id]);
    auditar(ator, 'excluir', 'equipamento', id, { serie: e.serie });
    motor.invalidar(); sim._moveis = null; sim.fluxos.delete(id); sim.silenciosos.delete(id);
    sim.emitir('equipamento', { id, acao: 'excluido' });
    return { ok: true };
  });

  rota('POST', '/api/equipamentos/:id/situacao', ({ params, body, ator }) => {
    const id = Number(params.id);
    if (!db.get('SELECT id FROM equipamentos WHERE id = ?', [id])) naoEncontrado();
    if (!C.SITUACAO[body.situacao]) throw new ErroValidacao({ situacao: 'Situação inválida' });
    sim.mudarSituacao(id, body.situacao, body.motivo || 'Alteração pelo operador', Date.now(), ator);
    sim.emitir('equipamento', { id, acao: 'situacao' });
    return { ok: true };
  });

  rota('POST', '/api/equipamentos/:id/manutencao', ({ params, body, ator }) => {
    const id = Number(params.id);
    const e = db.get('SELECT * FROM equipamentos WHERE id = ?', [id]);
    if (!e) naoEncontrado();
    const agora = Date.now();
    const tipo = body.tipo === 'corretiva' ? 'corretiva' : 'preventiva';
    db.run('INSERT INTO manutencoes(equipamento_id, data, tipo, motivo) VALUES(?,?,?,?)', [id, agora, tipo, texto(body.motivo) || 'Manutenção registrada pelo operador']);
    const proxima = e.manut_periodicidade_dias ? agora + e.manut_periodicidade_dias * DIA : null;
    db.run(`UPDATE equipamentos SET ultima_manut = ?, ultimo_sinal = ?, manut_tipo = ?, manut_data = ?, atualizado_em = ? WHERE id = ?`,
      [agora, agora, proxima ? 'periodica' : 'nenhuma', proxima, agora, id]);
    sim.silenciosos.delete(id);
    if (e.situacao !== 'operacional' && e.situacao !== 'desativado') sim.mudarSituacao(id, 'operacional', `Manutenção ${tipo} concluída`, agora, ator);
    auditar(ator, 'manutencao', 'equipamento', id, { tipo });
    motor.invalidar();
    sim.emitir('equipamento', { id, acao: 'manutencao' });
    return { ok: true };
  });

  // -------------------------------------------------------------- agentes
  rota('GET', '/api/agentes', ({ q }) => {
    const where = [], p = [];
    if (q.tipo) { where.push('a.tipo = ?'); p.push(q.tipo); }
    if (q.status) { where.push('a.status = ?'); p.push(q.status); }
    if (q.bairro) { where.push('a.bairro_id = ?'); p.push(Number(q.bairro)); }
    return db.all(`SELECT a.*, b.nome AS bairro, b.zona, e.serie AS veiculo_serie, e.tipo AS veiculo_tipo FROM agentes a LEFT JOIN bairros b ON b.id = a.bairro_id
      LEFT JOIN equipamentos e ON e.id = a.veiculo_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.tipo, a.nome`, p);
  });

  rota('GET', '/api/agentes/:id', ({ params }) => {
    const a = db.get('SELECT a.*, b.nome AS bairro, e.serie AS veiculo_serie FROM agentes a LEFT JOIN bairros b ON b.id = a.bairro_id LEFT JOIN equipamentos e ON e.id = a.veiculo_id WHERE a.id = ?', [Number(params.id)]);
    if (!a) naoEncontrado();
    return {
      ...a,
      ocorrencia: a.ocorrencia_id ? db.get('SELECT * FROM ocorrencias WHERE id = ?', [a.ocorrencia_id]) : null,
      atendimentos: db.all('SELECT o.*, b.nome AS bairro FROM ocorrencias o JOIN bairros b ON b.id = o.bairro_id WHERE o.agente_id = ? ORDER BY o.inicio DESC LIMIT 10', [a.id]),
      auditoria: db.all("SELECT * FROM auditoria WHERE entidade = 'agente' AND entidade_id = ? ORDER BY ts DESC LIMIT 10", [a.id]),
    };
  });

  rota('POST', '/api/agentes', ({ body, ator }) => {
    const d = validarAgente(body);
    validarVinculosAgente(d);
    if (db.get('SELECT id FROM agentes WHERE matricula = ?', [d.matricula])) throw new ErroValidacao({ matricula: 'Matrícula já cadastrada' });
    const b = motor.bairros.find((x) => x.id === d.bairro_id);
    if (!b) throw new ErroValidacao({ bairro_id: 'Bairro inválido' });
    const agora = Date.now();
    const id = db.run(`INSERT INTO agentes(nome, matricula, tipo, orgao, turno, status, telefone, bairro_id, lat, lng, veiculo_id, criado_em, atualizado_em)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, [d.nome, d.matricula, d.tipo, d.orgao, d.turno, d.status, d.telefone, d.bairro_id, b.lat, b.lng, d.veiculo_id || null, agora, agora]);
    auditar(ator, 'criar', 'agente', id, { nome: d.nome, matricula: d.matricula });
    motor.invalidar();
    return { id };
  });

  rota('PUT', '/api/agentes/:id', ({ params, body, ator }) => {
    const id = Number(params.id);
    const atual = db.get('SELECT * FROM agentes WHERE id = ?', [id]);
    if (!atual) naoEncontrado();
    const d = validarAgente({ ...atual, ...body });
    validarVinculosAgente(d);
    if (d.matricula !== atual.matricula && db.get('SELECT id FROM agentes WHERE matricula = ? AND id != ?', [d.matricula, id])) throw new ErroValidacao({ matricula: 'Matrícula já cadastrada' });
    db.run('UPDATE agentes SET nome=?, matricula=?, tipo=?, orgao=?, turno=?, status=?, telefone=?, bairro_id=?, veiculo_id=?, atualizado_em=? WHERE id=?',
      [d.nome, d.matricula, d.tipo, d.orgao, d.turno, d.status, d.telefone, d.bairro_id, d.veiculo_id ?? atual.veiculo_id, Date.now(), id]);
    auditar(ator, 'editar', 'agente', id, { campos: Object.keys(body) });
    motor.invalidar();
    return { ok: true };
  });

  rota('DELETE', '/api/agentes/:id', ({ params, ator }) => {
    const id = Number(params.id);
    const a = db.get('SELECT nome FROM agentes WHERE id = ?', [id]);
    if (!a) naoEncontrado();
    db.run('UPDATE ocorrencias SET agente_id = NULL WHERE agente_id = ?', [id]);
    db.run('DELETE FROM agentes WHERE id = ?', [id]);
    auditar(ator, 'excluir', 'agente', id, { nome: a.nome });
    return { ok: true };
  });

  // ----------------------------------------------------------- ocorrências
  rota('GET', '/api/ocorrencias', ({ q }) => {
    const where = [], p = [];
    if (q.abertas) where.push("o.status != 'encerrada'");
    if (q.desde) { where.push('o.inicio >= ?'); p.push(Number(q.desde)); }
    if (q.ate) { where.push('o.inicio < ?'); p.push(Number(q.ate)); }
    if (q.bairro) { where.push('o.bairro_id = ?'); p.push(Number(q.bairro)); }
    const lim = Math.max(1, Math.min(2000, Math.floor(Number(q.limite)) || 300));
    return db.all(`SELECT o.*, b.nome AS bairro, a.nome AS agente FROM ocorrencias o JOIN bairros b ON b.id = o.bairro_id LEFT JOIN agentes a ON a.id = o.agente_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.inicio DESC LIMIT ${lim}`, p);
  });

  // -------------------------------------------------------------- alertas
  rota('GET', '/api/alertas', () => sim.alertas.slice(0, 80));
  rota('POST', '/api/alertas/:id/reconhecer', ({ params, ator }) => {
    const a = sim.alertas.find((x) => x.id === Number(params.id));
    if (!a) naoEncontrado();
    if (a.reconhecido) return { ok: true };
    a.reconhecido = true; a.reconhecidoPor = ator; a.reconhecidoEm = Date.now();
    db.run('UPDATE alertas SET reconhecido = 1, dados = ? WHERE id = ?', [JSON.stringify(a), a.id]);
    auditar(ator, 'reconhecer_alerta', 'alerta', a.id, { titulo: a.titulo });
    return { ok: true };
  });

  // -------------------------------------------------- central e previsão
  rota('GET', '/api/regioes', () => motor.regioes());
  rota('GET', '/api/previsao', ({ q }) => motor.previsao(Math.min(48, Math.max(1, Number(q.horas) || 24))));
  rota('GET', '/api/previsao/explicar', ({ q }) => motor.explicar(Number(q.bairro), Number(q.hora) || Date.now()) || naoEncontrado());
  rota('GET', '/api/backtest', () => motor.backtest(7));
  rota('GET', '/api/manutencao-preditiva', () => motor.manutencao());
  rota('GET', '/api/anomalias', () => sim.anomaliasAtivas || []);
  rota('GET', '/api/fluxos', () => sim.leituraFluxos());
  rota('GET', '/api/tendencias', () => motor.tendencias());

  rota('GET', '/api/despacho', () => motor.despacho());
  rota('POST', '/api/despacho/aplicar', ({ body, ator }) => {
    const ag = db.get('SELECT * FROM agentes WHERE id = ?', [Number(body.agente_id)]);
    const destino = motor.bairros.find((b) => b.id === Number(body.bairro_id));
    if (!ag || !destino) naoEncontrado();
    // Idempotente: aprovar duas vezes (duplo clique) não duplica o registro.
    if (ag.status === 'deslocamento' && ag.bairro_id === destino.id) return { ok: true, jaAplicado: true };
    if (!['patrulha', 'base', 'deslocamento'].includes(ag.status)) throw new ErroValidacao({ agente_id: 'Agente não está disponível para deslocamento' });
    db.run("UPDATE agentes SET bairro_id = ?, status = 'deslocamento', atualizado_em = ? WHERE id = ?", [destino.id, Date.now(), ag.id]);
    const origem = motor.bairros.find((b) => b.id === ag.bairro_id);
    const detalhes = { agente: ag.nome, de: origem ? origem.nome : null, para: destino.nome, motivo: texto(body.motivo, 400) };
    db.run('INSERT INTO recomendacoes(ts, tipo, titulo, detalhes, status, decidido_por, decidido_em) VALUES(?,?,?,?,?,?,?)',
      [Date.now(), 'reforco', `Deslocar ${ag.nome} para ${destino.nome}`, JSON.stringify(detalhes), 'aprovada', ator, Date.now()]);
    auditar(ator, 'aprovar_reforco', 'agente', ag.id, detalhes);
    motor.invalidar();
    return { ok: true };
  });
  rota('POST', '/api/despacho/descartar', ({ body, ator }) => {
    const detalhes = { agente_id: body.agente_id, para: body.bairro_id, justificativa: texto(body.justificativa, 300) };
    db.run('INSERT INTO recomendacoes(ts, tipo, titulo, detalhes, status, decidido_por, decidido_em) VALUES(?,?,?,?,?,?,?)',
      [Date.now(), 'reforco', 'Recomendação descartada', JSON.stringify(detalhes), 'descartada', ator, Date.now()]);
    auditar(ator, 'descartar_reforco', 'agente', Number(body.agente_id) || null, detalhes);
    return { ok: true };
  });

  /**
   * Máquina do tempo: offset em horas (-24..+24) a partir da hora atual.
   * Passado: o que aconteceu (ocorrências) + o que o modelo esperava.
   * Futuro: o que o modelo prevê, bairro a bairro.
   */
  rota('GET', '/api/maquina-do-tempo', ({ q }) => {
    const off = Math.max(-24, Math.min(24, Math.round(Number(q.offset)) || 0));
    const h = inicioHora(Date.now()) + off * HORA;
    const m = motor.garantirModelo();
    const climaReal = new Map(db.all('SELECT hora, chuva_mm FROM clima WHERE hora BETWEEN ? AND ?', [h - HORA, h + HORA]).map((r) => [r.hora, r.chuva_mm]));
    const eventos = motor.eventos();
    const camerasFora = motor.camerasFora();
    const riscoBairros = motor.bairros.map((b) => {
      const p = risco.preverHora(m, b, h, { chuvaMm: climaReal.get(h) || 0, eventos, camerasFora });
      return { bairro_id: b.id, risco: p.risco, desvio: p.desvio, esperado: +p.porTipo.reduce((s, t) => s + t.lambda, 0).toFixed(2) };
    });
    const ocorrencias = off <= 0 ? db.all('SELECT id, tipo, bairro_id, lat, lng, inicio, status FROM ocorrencias WHERE inicio >= ? AND inicio < ?', [h, h + HORA]) : [];
    return { offset: off, hora: h, modo: off < 0 ? 'passado' : off === 0 ? 'agora' : 'futuro', chuvaMm: climaReal.get(h) || 0, risco: riscoBairros, ocorrencias,
      evento: eventos.find((e) => h >= e.inicio - 2 * HORA && h <= e.fim + HORA) || null };
  });

  rota('GET', '/api/auditoria', ({ q }) => db.all(`SELECT * FROM auditoria ORDER BY ts DESC LIMIT ${Math.max(1, Math.min(500, Math.floor(Number(q.limite)) || 150))}`)
    .map((r) => ({ ...r, detalhes: JSON.parse(r.detalhes || '{}') })));
  rota('GET', '/api/recomendacoes', () => db.all('SELECT * FROM recomendacoes ORDER BY ts DESC LIMIT 100').map((r) => ({ ...r, detalhes: JSON.parse(r.detalhes) })));

  // -------------------------------------------- localização (100% offline)
  rota('GET', '/api/cep/:cep', ({ params }) => {
    const cep = String(params.cep).replace(/\D/g, '');
    if (cep.length !== 8) throw new ErroValidacao({ cep: 'CEP deve ter 8 dígitos' });
    const lista = motor.bairros.map((b) => ({ ...b, num: Number(String(b.cep).replace(/\D/g, '')) }));
    const exato = lista.find((b) => b.num === Number(cep));
    // Sem internet: aproxima pelo CEP numericamente mais próximo da base local (mesma faixa = mesma região).
    const b = exato || lista.slice().sort((a, c) => Math.abs(a.num - Number(cep)) - Math.abs(c.num - Number(cep)))[0];
    return { cep: `${cep.slice(0, 5)}-${cep.slice(5)}`, exato: !!exato, bairro_id: b.id, bairro: b.nome, cidade: 'Marília', uf: 'SP', lat: b.lat, lng: b.lng, ruas: JSON.parse(b.ruas || '[]') };
  });

  rota('GET', '/api/geo/reverso', ({ q }) => {
    const lat = Number(q.lat), lng = Number(q.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new ErroValidacao({ lat: 'Coordenadas inválidas' });
    const b = bairroDoPonto(lat, lng);
    return { bairro_id: b.id, bairro: b.nome, zona: b.zona, cep: b.cep, ruas: JSON.parse(b.ruas || '[]'), distanciaKm: +haversine(lat, lng, b.lat, b.lng).toFixed(2) };
  });

  rota('POST', '/api/exercicio', ({ body, ator }) => {
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new ErroValidacao({ lat: 'Clique no mapa para escolher o local' });
    if (!dentroDaCidade(lat, lng)) throw new ErroValidacao({ lat: 'O local precisa estar dentro de Marília' });
    if (!['acidente', 'roubo_furto', 'alagamento', 'congestionamento', 'perturbacao', 'furto_camera', 'chuva_forte'].includes(body.tipo)) throw new ErroValidacao({ tipo: 'Tipo de exercício desconhecido' });
    return sim.exercicio({ tipo: String(body.tipo), lat, lng }, ator);
  });

  /** Passagem de turno: resumo automático das últimas 8 horas. */
  rota('GET', '/api/relatorio-turno', () => {
    const agora = Date.now(), de = agora - 8 * HORA;
    const porTipo = db.all('SELECT tipo, COUNT(*) AS n FROM ocorrencias WHERE inicio >= ? AND exercicio = 0 GROUP BY tipo ORDER BY n DESC', [de]);
    const porBairro = db.all('SELECT b.nome, COUNT(*) AS n FROM ocorrencias o JOIN bairros b ON b.id = o.bairro_id WHERE o.inicio >= ? AND o.exercicio = 0 GROUP BY b.nome ORDER BY n DESC LIMIT 5', [de]);
    const mudancas = db.all("SELECT h.*, e.serie, e.tipo FROM situacao_historico h JOIN equipamentos e ON e.id = h.equipamento_id WHERE h.ts >= ? AND h.de IS NOT NULL ORDER BY h.ts DESC", [de]);
    const decisoes = db.all("SELECT * FROM auditoria WHERE ts >= ? AND acao IN ('aprovar_reforco','descartar_reforco','reconhecer_alerta','exercicio','manutencao') ORDER BY ts DESC", [de]);
    const prev = motor.previsao(8);
    return { de, ate: agora, kpis: sim.kpis(), porTipo, porBairro, mudancas, decisoes, proximas8h: prev.hotspots.slice(0, 5), eventos: prev.eventos };
  });

  function texto(v, max = 200) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
  function dentroDaCidade(lat, lng) {
    const bb = city.bbox, m = 0.03; // ~3 km de folga
    return lat >= bb.south - m && lat <= bb.north + m && lng >= bb.west - m && lng <= bb.east + m;
  }
  function validarVinculosAgente(d) {
    if (d.bairro_id && !motor.bairros.some((b) => b.id === d.bairro_id)) throw new ErroValidacao({ bairro_id: 'Bairro inválido' });
    if (d.veiculo_id) {
      const v = db.get('SELECT tipo FROM equipamentos WHERE id = ?', [d.veiculo_id]);
      if (!v || !['moto_agente', 'viatura_gcm', 'viatura_pm'].includes(v.tipo)) throw new ErroValidacao({ veiculo_id: 'Escolha uma moto ou viatura da frota' });
    }
  }

  // ------------------------------------------------------------- despacho HTTP
  return async function handler(req, res, url) {
    const metodo = req.method;
    const caminho = url.pathname;
    if (caminho === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: tick\ndata: ${JSON.stringify(sim.estadoAoVivo(Date.now()))}\n\n`);
      sim.ouvintes.add(res);
      req.on('close', () => sim.ouvintes.delete(res));
      return;
    }
    for (const r of rotas) {
      if (r.metodo !== metodo) continue;
      const m = caminho.match(r.re);
      if (!m) continue;
      const decod = (v) => { try { return decodeURIComponent(v); } catch { return null; } };
      const params = Object.fromEntries(r.chaves.map((k, i) => [k, decod(m[i + 1])]));
      if (Object.values(params).some((v) => v === null)) return json(res, 400, { erro: 'URL inválida' });
      const q = Object.fromEntries(url.searchParams.entries());
      const ator = (decod(String(req.headers['x-operador'] || '')) || 'Operador').replace(/[<>]/g, '').slice(0, 60) || 'Operador';
      try {
        const bruto = ['POST', 'PUT'].includes(metodo) ? await lerCorpo(req) : {};
        const body = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
        const out = await r.fn({ params, q, body, ator, req });
        return json(res, 200, out);
      } catch (e) {
        if (e.status) return json(res, e.status, { erro: e.message, erros: e.erros });
        console.error(e);
        return json(res, 500, { erro: 'Erro interno', detalhe: e.message });
      }
    }
    return json(res, 404, { erro: 'Rota não encontrada' });
  };
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    let estourou = false;
    req.on('data', (c) => {
      if (estourou) return;
      tam += c.length;
      if (tam > 1e6) { estourou = true; reject(Object.assign(new Error('Corpo da requisição muito grande (máx. 1 MB)'), { status: 413 })); req.pause(); } else partes.push(c);
    });
    req.on('end', () => {
      if (estourou) return;
      if (!partes.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function json(res, status, dados) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(corpo);
}

module.exports = { criarApi };
