'use strict';
/**
 * Gera a cidade inicial: bairros, equipamentos (com histórico de manutenção e
 * telemetria), agentes, calendário de eventos, clima e 90 dias de ocorrências.
 * Tudo com semente fixa: o avaliador vê a mesma cidade que nós.
 */
const { Rng } = require('../lib/rng');
const { offsetMeters, haversine } = require('../lib/geo');
const { HORA, DIA, inicioHora, inicioDia, horaLocal, diaSemana } = require('../lib/time');
const { TIPOS_EQUIPAMENTO, TIPOS_OCORRENCIA, TURNOS } = require('../domain/catalog');
const truth = require('./truth');

const DIAS_HISTORICO = 90;

// Marcas e modelos fictícios (exceto veículos, que usam modelos comerciais comuns).
const MARCAS = {
  radar: [['Tecnorad', 'TR-500'], ['Tecnorad', 'TR-700'], ['Velox Sistemas', 'VX-Speed 3']],
  camera: [['Vigiax', 'VX-4K Dome'], ['Vigiax', 'VX-PTZ 30x'], ['Argos Vision', 'AV-1080 Bullet'], ['Argos Vision', 'AV-Night Pro']],
  semaforo: [['Semafix', 'SF-Control 8'], ['Urbis Tráfego', 'UT-4']],
  balanca: [['Pesatec', 'PT-Dinâmica 2']],
  fiscal_autonomo: [['Kronos Mobility', 'KM-Scout']],
  cancela: [['Acessa', 'AC-Gate 2'], ['Urbis Tráfego', 'UG-100']],
  totem: [['Rotativa+', 'RT-Totem S'], ['ParkUrb', 'PU-200']],
  taxi: [['Toyota', 'Corolla'], ['Chevrolet', 'Spin'], ['Fiat', 'Cronos'], ['Volkswagen', 'Virtus']],
  mototaxi: [['Honda', 'CG 160'], ['Yamaha', 'Factor 150']],
  escolar: [['Mercedes-Benz', 'Sprinter'], ['Fiat', 'Ducato'], ['Renault', 'Master']],
  patinete: [['Brisa Mobilidade', 'BR-One'], ['Zap Scooters', 'Zap S2']],
  moto_agente: [['Honda', 'XRE 300'], ['Yamaha', 'Lander 250']],
  viatura_gcm: [['Chevrolet', 'S10'], ['Renault', 'Duster'], ['Volkswagen', 'Virtus']],
  viatura_pm: [['Toyota', 'Hilux'], ['Chevrolet', 'Trailblazer'], ['Volkswagen', 'Virtus']],
  sensor_alagamento: [['Hidrosense', 'HS-2']],
  painel: [['LumiVia', 'PMV-3']],
};

const QUANTIDADES = {
  radar: 30, camera: 44, semaforo: 28, balanca: 2, fiscal_autonomo: 3, cancela: 6, totem: 16,
  taxi: 24, mototaxi: 18, escolar: 14, patinete: 36, moto_agente: 10, viatura_gcm: 8, viatura_pm: 10,
  sensor_alagamento: 6, painel: 5,
};

const PRENOMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Nicolas', 'Olívia', 'Paulo', 'Rafaela', 'Rodrigo', 'Sabrina', 'Thiago', 'Vanessa', 'Wesley', 'Larissa', 'Marcos', 'Juliana', 'André', 'Patrícia', 'Gustavo', 'Letícia', 'Fernando', 'Camila', 'Renato', 'Beatriz', 'Leandro', 'Aline', 'Vinícius'];
const SOBRENOMES = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Ferreira', 'Almeida', 'Costa', 'Rodrigues', 'Gomes', 'Martins', 'Araújo', 'Barbosa', 'Ribeiro', 'Carvalho', 'Rocha', 'Moraes', 'Nogueira', 'Teixeira', 'Batista', 'Cardoso', 'Pinto', 'Mendes'];
const OPERADORAS = ['Brisa Mobilidade', 'Zap Scooters'];
const ESCOLAS = ['EMEF Cidade Alta', 'Colégio Vale do Sol', 'EE Prof. Antônio', 'Escola Municipal Ipê', 'Colégio Horizonte'];

function placa(rng) {
  const L = () => String.fromCharCode(65 + rng.int(0, 25));
  return `${L()}${L()}${L()}${rng.int(0, 9)}${L()}${rng.int(10, 99)}`;
}

/**
 * Uso diário típico por tipo (o que a telemetria conta): veículos que passaram no radar,
 * transações no totem, aberturas da cancela, viagens do patinete, corridas do táxi...
 */
function usoDiario(tipo, dia, rng) {
  const base = { radar: 9000, camera: 86400, semaforo: 1400, balanca: 420, fiscal_autonomo: 1600, cancela: 260, totem: 85,
    taxi: 14, mototaxi: 18, escolar: 4, patinete: 7, moto_agente: 60, viatura_gcm: 90, viatura_pm: 110, sensor_alagamento: 288, painel: 96 }[tipo] || 100;
  const dow = diaSemana(dia + 12 * HORA);
  const fds = ['totem', 'cancela', 'radar', 'escolar', 'fiscal_autonomo'].includes(tipo) ? (dow === 0 ? 0.35 : dow === 6 ? 0.7 : 1) : tipo === 'patinete' ? (dow === 0 || dow === 6 ? 1.4 : 1) : 1;
  // Patinetes ganhando adesão: +35% ao longo dos últimos 90 dias.
  const tendencia = tipo === 'patinete' ? 1 + 0.35 * Math.max(0, Math.min(1, (dia - (Date.now() - 90 * DIA)) / (90 * DIA))) : 1;
  return base * fds * tendencia * rng.float(0.85, 1.15);
}

/** Inverso da CDF de Weibull: amostra o tempo até a falha (dias). */
function weibullSample(rng, k, eta) {
  return eta * Math.pow(-Math.log(1 - rng.next()), 1 / k);
}

function atributosPadrao(tipo, rng) {
  const a = {};
  for (const at of tipo.atributos) {
    if (at.tipo === 'bool') a[at.key] = rng.chance(0.6);
    else if (at.tipo === 'select') a[at.key] = rng.pick(at.opcoes);
    else if (at.tipo === 'number') a[at.key] = rng.int(at.min, Math.round(at.min + (at.max - at.min) * 0.7));
    else a[at.key] = '';
  }
  if (tipo.id === 'radar') {
    a.velocidade_maxima = rng.pick([40, 50, 60, 60, 70, 80]);
    a.faixas = rng.int(1, 3);
  }
  if (['taxi', 'mototaxi', 'escolar', 'moto_agente', 'viatura_gcm', 'viatura_pm'].includes(tipo.id)) a.placa = placa(rng);
  if (tipo.id === 'taxi' || tipo.id === 'mototaxi') a.permissionario = `${rng.pick(PRENOMES)} ${rng.pick(SOBRENOMES)}`;
  if (tipo.id === 'escolar') a.escola = rng.pick(ESCOLAS);
  if (tipo.id === 'patinete') { a.operadora = rng.pick(OPERADORAS); a.bateria = rng.int(15, 100); a.velocidade_max = 20; }
  if (tipo.id === 'cancela') a.local_atendido = rng.pick(['Estacionamento do Terminal Urbano', 'Pátio municipal', 'Estacionamento da Prefeitura', 'Garagem do Paço']);
  return a;
}

/** Preferência de bairro por tipo de equipamento (onde faz sentido instalar). */
function pesoBairroParaTipo(tipo, b) {
  const p = b.perfil;
  switch (tipo) {
    case 'radar': case 'semaforo': case 'painel': return { comercial: 4, rodovia: 3, universitario: 2, industrial: 1.5 }[p] || 1;
    case 'camera': return { comercial: 4, periferico: 2.5, universitario: 2 }[p] || 1;
    case 'totem': case 'cancela': case 'fiscal_autonomo': return { comercial: 8, universitario: 2 }[p] || 0.2;
    case 'balanca': return p === 'rodovia' || p === 'industrial' ? 5 : 0;
    case 'sensor_alagamento': return b.baixada ? 6 : 0.1;
    case 'patinete': return { comercial: 4, universitario: 4 }[p] || 0.5;
    default: return 1;
  }
}

function referencia(rng, tipo, b, ruas, city, rua) {
  if (b.perfil === 'rodovia' && rng.chance(0.6)) return `KM ${rng.int(300, 340)}`;
  const r = rng.next();
  if (r < 0.35) return `nº ${rng.int(10, 2400)}`;
  if (r < 0.55) return `oposto ao nº ${rng.int(10, 2400)}`;
  if (r < 0.7) return 'S/N';
  if (r < 0.85) {
    const outras = ruas.filter((x) => x !== rua);
    if (outras.length) return `esquina com ${rng.pick(outras)}`;
    return `nº ${rng.int(10, 2400)}`;
  }
  // Só cita um ponto de referência se ele estiver de fato perto do bairro (até 1,2 km).
  const perto = (city.pontos_referencia || []).filter((p) => haversine(p.lat, p.lng, b.lat, b.lng) <= 1.2);
  if (!perto.length) return `nº ${rng.int(10, 2400)}`;
  return `próximo ao ${rng.pick(perto).nome}`.replace('próximo ao Famema', 'próximo à Famema').replace('próximo ao Catedral', 'próximo à Catedral');
}

function gerarCidade(db, city, agora) {
  const rng = new Rng(2026);
  const t0 = inicioDia(agora) - DIAS_HISTORICO * DIA;

  // ---------- Bairros ----------
  city.bairros.forEach((b, i) => {
    b.id = i + 1;
    db.run('INSERT INTO bairros(id, nome, zona, lat, lng, cep, ruas) VALUES(?,?,?,?,?,?,?)',
      [b.id, b.nome, b.zona, b.lat, b.lng, b.cep, JSON.stringify(b.ruas || [])]);
  });

  // ---------- Equipamentos ----------
  const equipamentos = [];
  db.tx(() => {
    for (const tipo of TIPOS_EQUIPAMENTO) {
      const n = QUANTIDADES[tipo.id] || 0;
      for (let i = 0; i < n; i++) {
        const pesos = city.bairros.map((b) => pesoBairroParaTipo(tipo.id, b));
        const b = rng.weighted(city.bairros, pesos);
        const raio = tipo.movel ? 1400 : 650;
        const [lat, lng] = offsetMeters(b.lat, b.lng, rng.normal(0, raio / 2), rng.normal(0, raio / 2));
        const [marca, modelo] = rng.pick(MARCAS[tipo.id]);
        const ruas = b.ruas && b.ruas.length ? b.ruas : ['Rua sem nome'];
        const instaladoDiasAtras = rng.int(120, 1600);
        const eq = {
          tipo: tipo.id, serie: `${tipo.id.slice(0, 3).toUpperCase()}-${String(1000 + equipamentos.length).padStart(5, '0')}`,
          marca, modelo, orgao: tipo.orgao, cep: b.cep, rua: null, referencia: null,
          bairro_id: b.id, lat, lng, atributos: atributosPadrao(tipo, rng),
          instalado_em: agora - instaladoDiasAtras * DIA, periodicidade: rng.chance(0.55) ? rng.pick([90, 120, 180]) : null,
        };
        eq.rua = rng.pick(ruas);
        eq.referencia = referencia(rng, tipo.id, b, ruas, city, eq.rua);
        equipamentos.push(eq);
      }
    }

    // Simula a vida de cada equipamento desde a instalação (falhas e manutenções).
    for (const eq of equipamentos) {
      const w = truth.WEIBULL[eq.tipo];
      const eta = w.eta * (truth.FATOR_MARCA[eq.marca] || 1);
      const manut = [];
      let t = eq.instalado_em, situacao = 'operacional', ultimaManut = eq.instalado_em;
      while (t < agora) {
        const falha = t + weibullSample(rng, w.k, eta) * DIA;
        const preventiva = eq.periodicidade ? t + eq.periodicidade * DIA : Infinity;
        if (preventiva < falha && preventiva < agora) {
          manut.push({ data: preventiva, tipo: 'preventiva', motivo: 'Manutenção periódica' });
          t = preventiva; ultimaManut = t;
        } else if (falha < agora) {
          const parada = rng.float(0.5, 6) * DIA;
          if (falha + parada > agora) { situacao = rng.chance(0.6) ? 'mau_funcionamento' : 'manutencao'; t = agora; break; }
          manut.push({ data: falha + parada, tipo: 'corretiva', motivo: rng.pick(['Falha de comunicação', 'Defeito na fonte', 'Sensor danificado', 'Falha de software', 'Desgaste mecânico']) });
          t = falha + parada; ultimaManut = t;
        } else break;
      }
      eq.situacao = situacao; eq.ultima_manut = ultimaManut; eq.manut = manut;
    }

    // Situações especiais para o inventário ficar realista.
    const MOVEIS = new Set(TIPOS_EQUIPAMENTO.filter((t) => t.movel).map((t) => t.id));
    const fixos = equipamentos.filter((e) => !MOVEIS.has(e.tipo));
    for (let i = 0; i < 4; i++) { const e = rng.pick(fixos); e.situacao = 'nao_instalado'; e.instalado_em = null; e.manut = []; e.ultima_manut = null; }
    for (let i = 0; i < 3; i++) { const e = rng.pick(fixos.filter((x) => x.situacao === 'operacional')); e.situacao = 'desativado'; }
    // Algumas falhas em andamento, mais prováveis nos equipamentos mais desgastados (Weibull).
    const candidatos = fixos.filter((e) => e.situacao === 'operacional' && e.ultima_manut);
    const desgaste = candidatos.map((e) => { const w = truth.WEIBULL[e.tipo]; const eta = w.eta * (truth.FATOR_MARCA[e.marca] || 1); return Math.pow((agora - e.ultima_manut) / DIA / eta, w.k) + 0.05; });
    for (let i = 0; i < 6; i++) { const e = rng.weighted(candidatos, desgaste); e.situacao = i % 3 === 0 ? 'manutencao' : 'mau_funcionamento'; }
    const camerasCriticas = equipamentos.filter((e) => e.tipo === 'camera' && e.situacao === 'operacional');
    for (let i = 0; i < 3; i++) { const e = rng.pick(camerasCriticas); e.situacao = 'furtado'; }

    for (const eq of equipamentos) {
      let manutTipo = 'nenhuma', manutData = null;
      if (eq.situacao === 'mau_funcionamento' || eq.situacao === 'furtado') { manutTipo = 'imediata'; manutData = agora; }
      else if (eq.situacao === 'manutencao') { manutTipo = 'agendada'; manutData = agora + rng.int(1, 3) * DIA; }
      else if (eq.situacao === 'nao_instalado') { manutTipo = 'agendada'; manutData = agora + rng.int(5, 40) * DIA; }
      else if (eq.periodicidade && eq.ultima_manut) { manutTipo = 'periodica'; manutData = eq.ultima_manut + eq.periodicidade * DIA; }
      const id = db.run(`INSERT INTO equipamentos(tipo, serie, marca, modelo, orgao, cep, rua, referencia, bairro_id, lat, lng,
          situacao, manut_tipo, manut_data, manut_periodicidade_dias, instalado_em, ultima_manut, atributos, ultimo_sinal, criado_em, atualizado_em)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [eq.tipo, eq.serie, eq.marca, eq.modelo, eq.orgao, eq.cep, eq.rua, eq.referencia, eq.bairro_id, eq.lat, eq.lng,
          eq.situacao, manutTipo, manutData, eq.periodicidade, eq.instalado_em, eq.ultima_manut, JSON.stringify(eq.atributos),
          eq.situacao === 'operacional' ? agora : agora - rng.int(2, 72) * HORA, eq.instalado_em || agora, agora]);
      eq.id = id;
      for (const m of eq.manut) db.run('INSERT INTO manutencoes(equipamento_id, data, tipo, motivo) VALUES(?,?,?,?)', [id, m.data, m.tipo, m.motivo]);
      db.run('INSERT INTO situacao_historico(equipamento_id, ts, de, para, motivo) VALUES(?,?,?,?,?)',
        [id, eq.instalado_em || agora, null, eq.situacao === 'nao_instalado' ? 'nao_instalado' : 'operacional', 'Cadastro inicial']);
      if (!['operacional', 'nao_instalado'].includes(eq.situacao)) {
        db.run('INSERT INTO situacao_historico(equipamento_id, ts, de, para, motivo) VALUES(?,?,?,?,?)',
          [id, agora - rng.int(2, 48) * HORA, 'operacional', eq.situacao, 'Registro de campo']);
      }
    }
  });

  // ---------- Telemetria diária (90 dias) ----------
  gerarTelemetriaDiaria(db, equipamentos, t0, inicioDia(agora), rng);

  // ---------- Agentes ----------
  gerarAgentes(db, city, agora, rng, equipamentos);

  // ---------- Calendário, clima e ocorrências ----------
  garantirCalendario(db, city, t0, agora + 7 * DIA);
  atualizarClima(db, t0, agora);
  gerarOcorrencias(db, city, t0, inicioHora(agora), agora, rng);

  db.setMeta('gerado_em', agora);
  db.setMeta('historico_ate', inicioHora(agora));
  db.run('INSERT INTO auditoria(ts, ator, acao, entidade, entidade_id, detalhes) VALUES(?,?,?,?,?,?)',
    [agora, 'Sistema', 'carga_inicial', 'cidade', null, JSON.stringify({ equipamentos: equipamentos.length, dias: DIAS_HISTORICO })]);
}

function gerarTelemetriaDiaria(db, equipamentos, de, ate, rng) {
  db.tx(() => {
    for (const eq of equipamentos) {
      if (!eq.instalado_em) continue;
      const w = truth.WEIBULL[eq.tipo];
      const eta = w.eta * (truth.FATOR_MARCA[eq.marca] || 1);
      const datas = (eq.manut || []).map((m) => m.data).sort((a, b) => a - b);
      for (let dia = Math.max(de, inicioDia(eq.instalado_em)); dia < ate; dia += DIA) {
        // Idade desde a última manutenção nesse dia: quanto mais perto de eta, mais erros (sinal de desgaste).
        let ultima = eq.instalado_em;
        for (const d of datas) if (d <= dia) ultima = d;
        const idade = (dia - ultima) / DIA;
        const desgaste = Math.pow(idade / eta, w.k);
        const parado = (eq.manut || []).some((m) => m.tipo === 'corretiva' && dia >= m.data - 3 * DIA && dia < m.data);
        const disp = parado ? rng.float(0, 0.5) : Math.min(1, rng.float(0.97, 1.0));
        const leituras = Math.round((parado ? 0.3 : 1) * usoDiario(eq.tipo, dia, rng));
        const erros = Math.round(rng.poisson(1 + 18 * desgaste) + (parado ? rng.int(20, 60) : 0));
        db.run('INSERT OR REPLACE INTO telemetria_diaria(equipamento_id, dia, disponibilidade, leituras, erros) VALUES(?,?,?,?,?)',
          [eq.id, dia, +disp.toFixed(3), leituras, erros]);
      }
    }
  });
}

function gerarAgentes(db, city, agora, rng, equipamentos) {
  const plano = [['agente_transito', 'mobilidade', 30], ['guarda_municipal', 'gcm', 22], ['policial_militar', 'pm', 24]];
  const usados = new Set();
  const veiculos = {
    agente_transito: equipamentos.filter((e) => e.tipo === 'moto_agente'),
    guarda_municipal: equipamentos.filter((e) => e.tipo === 'viatura_gcm'),
    policial_militar: equipamentos.filter((e) => e.tipo === 'viatura_pm'),
  };
  let seq = 1;
  db.tx(() => {
    for (const [tipo, orgao, n] of plano) {
      for (let i = 0; i < n; i++) {
        let nome;
        do { nome = `${rng.pick(PRENOMES)} ${rng.pick(SOBRENOMES)}`; } while (usados.has(nome));
        usados.add(nome);
        const turno = TURNOS[i % 3].id;
        const pesos = city.bairros.map((b) => (tipo === 'agente_transito'
          ? ({ comercial: 5, rodovia: 2, universitario: 2 }[b.perfil] || 1)
          : ({ periferico: 2.5, comercial: 2.5, universitario: 2 }[b.perfil] || 1)));
        const b = rng.weighted(city.bairros, pesos);
        const [lat, lng] = offsetMeters(b.lat, b.lng, rng.normal(0, 300), rng.normal(0, 300));
        const veic = veiculos[tipo][i % Math.max(1, veiculos[tipo].length)];
        const prefixo = { agente_transito: 'AT', guarda_municipal: 'GCM', policial_militar: 'PM' }[tipo];
        db.run(`INSERT INTO agentes(nome, matricula, tipo, orgao, turno, status, telefone, bairro_id, lat, lng, veiculo_id, criado_em, atualizado_em)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [nome, `${prefixo}-${String(seq++).padStart(4, '0')}`, tipo, orgao, turno, 'fora_turno',
            `(14) 9${rng.int(1000, 9999)}-${rng.int(1000, 9999)}`, b.id, lat, lng, veic && i < 8 ? veic.id : null, agora, agora]);
      }
    }
    const ids = db.all('SELECT id FROM agentes');
    for (let i = 0; i < 2; i++) db.run("UPDATE agentes SET status = 'afastado' WHERE id = ?", [rng.pick(ids).id]);
  });
}

/** Jogos do MAC no Estádio Bento de Abreu e outros eventos, de forma determinística. */
function garantirCalendario(db, city, de, ate) {
  const estadio = (city.pontos_referencia || []).find((p) => /Bento de Abreu|Estádio/i.test(p.nome));
  const bairroEstadio = estadio ? nearestBairro(city, estadio.lat, estadio.lng) : city.bairros[0];
  const vizinhos = city.bairros.filter((b) => b.id !== bairroEstadio.id)
    .sort((a, b) => haversine(a.lat, a.lng, bairroEstadio.lat, bairroEstadio.lng) - haversine(b.lat, b.lng, bairroEstadio.lat, bairroEstadio.lng))
    .slice(0, 2).map((b) => b.id);
  const existentes = new Set(db.all('SELECT inicio FROM eventos_cidade').map((r) => r.inicio));
  const primeiroDia = Math.floor(de / DIA), ultimoDia = Math.floor(ate / DIA);
  for (let d = primeiroDia; d <= ultimoDia; d++) {
    const diaTs = inicioDia(d * DIA + 12 * HORA);
    const dow = diaSemana(diaTs + 12 * HORA);
    const r = truth.hash01(d, 77);
    let inicio = null, nome = null, publico = 0;
    if ((dow === 0 && r < 0.45) || (dow === 3 && r < 0.3)) {
      inicio = diaTs + (dow === 0 ? 16 : 19.5) * HORA; nome = 'Jogo do MAC (Marília Atlético Clube)'; publico = 3000 + Math.round(r * 9000);
    } else if (dow === 5 && r < 0.2) {
      inicio = diaTs + 20 * HORA; nome = 'Show no estádio'; publico = 6000 + Math.round(r * 20000);
    }
    if (inicio && !existentes.has(inicio)) {
      db.run('INSERT INTO eventos_cidade(nome, local, bairro_id, inicio, fim, publico_estimado) VALUES(?,?,?,?,?,?)',
        [nome, estadio ? estadio.nome : 'Estádio Bento de Abreu', bairroEstadio.id, inicio, inicio + 2.5 * HORA, publico]);
    }
  }
  return { bairroId: bairroEstadio.id, vizinhos };
}

/** Garante que há um evento nas próximas 24h para a demonstração da previsão. */
function garantirEventoProximo(db, city, agora) {
  const prox = db.get('SELECT id FROM eventos_cidade WHERE fim >= ? AND inicio <= ?', [agora, agora + 25 * HORA]);
  if (prox) return;
  const { bairroId } = garantirCalendario(db, city, agora, agora);
  // Próximo início às 19h30 com pelo menos 30 min de antecedência (hoje ou amanhã).
  let inicio = inicioDia(agora) + 19.5 * HORA;
  if (inicio < agora + 0.5 * HORA) inicio += DIA;
  const estadio = (city.pontos_referencia || []).find((p) => /Bento de Abreu|Estádio/i.test(p.nome));
  const nome = 'Jogo do MAC (Marília Atlético Clube)';
  db.run('INSERT INTO eventos_cidade(nome, local, bairro_id, inicio, fim, publico_estimado) VALUES(?,?,?,?,?,?)',
    [nome, estadio ? estadio.nome : 'Estádio Bento de Abreu', bairroId, inicio, inicio + 2.5 * HORA, 8500]);
}

function nearestBairro(city, lat, lng) {
  let best = city.bairros[0], bd = Infinity;
  for (const b of city.bairros) { const d = haversine(lat, lng, b.lat, b.lng); if (d < bd) { bd = d; best = b; } }
  return best;
}

/** Chuva observada (passado) e previsão (próximas 48h). */
function atualizarClima(db, de, agora) {
  const ultimaHora = inicioHora(agora);
  db.tx(() => {
    for (let h = inicioHora(de); h < ultimaHora; h += HORA) {
      db.run('INSERT INTO clima(hora, chuva_mm, previsao) VALUES(?,?,0) ON CONFLICT(hora) DO UPDATE SET chuva_mm = excluded.chuva_mm, previsao = 0', [h, truth.chuvaReal(h)]);
    }
    for (let h = ultimaHora; h < ultimaHora + 48 * HORA; h += HORA) {
      db.run('INSERT INTO clima(hora, chuva_mm, previsao) VALUES(?,?,1) ON CONFLICT(hora) DO UPDATE SET chuva_mm = excluded.chuva_mm, previsao = 1', [h, truth.chuvaPrevista(h)]);
    }
  });
}

function eventosParaTruth(db, city, de, ate) {
  const evs = db.all('SELECT * FROM eventos_cidade WHERE fim >= ? AND inicio <= ?', [de - DIA, ate + DIA]);
  return evs.map((e) => {
    const b = city.bairros.find((x) => x.id === e.bairro_id) || city.bairros[0];
    const vizinhos = city.bairros.filter((x) => x.id !== b.id)
      .sort((p, q) => haversine(p.lat, p.lng, b.lat, b.lng) - haversine(q.lat, q.lng, b.lat, b.lng)).slice(0, 2).map((x) => x.id);
    return { ...e, vizinhos };
  });
}

function camerasForaPorBairro(db) {
  const m = {};
  for (const r of db.all("SELECT bairro_id, COUNT(*) AS n FROM equipamentos WHERE tipo = 'camera' AND situacao IN ('furtado','mau_funcionamento','manutencao') GROUP BY bairro_id")) m[r.bairro_id] = r.n;
  return m;
}

/** Ocorrências hora a hora no intervalo [de, ate), amostradas da "verdade" (Poisson). */
function gerarOcorrencias(db, city, de, ate, agora, rng) {
  const ctx = {
    agora, somaPesos: city.bairros.reduce((s, b) => s + b.peso, 0),
    eventos: eventosParaTruth(db, city, de, ate), camerasFora: camerasForaPorBairro(db),
  };
  let n = 0;
  db.tx(() => {
    for (let h = inicioHora(de); h < ate; h += HORA) {
      // Horas parciais (início/fim do intervalo) recebem só a fração correspondente.
      const lo = Math.max(h, de), hi = Math.min(h + HORA, ate);
      if (hi <= lo) continue;
      const frac = (hi - lo) / HORA;
      for (const b of city.bairros) {
        for (const t of TIPOS_OCORRENCIA) {
          const k = rng.poisson(truth.taxaHora(b, t.id, h, ctx) * frac);
          for (let i = 0; i < k; i++) {
            const inicio = lo + Math.floor(rng.next() * (hi - lo));
            const [lat, lng] = offsetMeters(b.lat, b.lng, rng.normal(0, 380), rng.normal(0, 380));
            const dur = Math.max(5, rng.normal(t.duracaoMin, t.duracaoMin / 3)) * 60000;
            const origem = rng.weighted(['agente', 'cidadao', 'camera', 'sensor'], [3, 3, 2, 1]);
            const fim = inicio + dur;
            db.run('INSERT INTO ocorrencias(tipo, bairro_id, lat, lng, inicio, fim, status, origem, descricao) VALUES(?,?,?,?,?,?,?,?,?)',
              [t.id, b.id, lat, lng, inicio, fim, fim > agora ? 'atendimento' : 'encerrada', origem, null]);
            n++;
          }
        }
      }
    }
  });
  return n;
}

module.exports = {
  gerarCidade, gerarOcorrencias, atualizarClima, garantirCalendario, garantirEventoProximo,
  eventosParaTruth, camerasForaPorBairro, gerarTelemetriaDiaria, usoDiario, DIAS_HISTORICO,
};
