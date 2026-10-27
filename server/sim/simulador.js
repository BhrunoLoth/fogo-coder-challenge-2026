'use strict';
/**
 * SIMULADOR DA CIDADE (o "campo")
 * --------------------------------
 * Faz o papel do mundo real: dispositivos IoT enviando telemetria, agentes se
 * movendo, ocorrências surgindo, equipamentos falhando. Tudo é gravado no banco
 * ou enviado como telemetria, que é o que o PROMETHEUS (o motor) enxerga.
 */
const { Rng } = require('../lib/rng');
const { offsetMeters, haversine, nearest } = require('../lib/geo');
const { HORA, DIA, inicioHora, inicioDia, horaLocal, diaSemana } = require('../lib/time');
const { TIPOS_OCORRENCIA, TIPO_OC, TIPO_EQ, TIPO_AG, TURNOS } = require('../domain/catalog');
const truth = require('./truth');
const seed = require('./seed');

const TICK_MS = 2000;
const HEARTBEAT_MS = 30000;
const SEM_SINAL_MS = 90000; // 3 batidas de 30 s perdidas
const MOVEIS = new Set(Object.values(TIPO_EQ).filter((t) => t.movel).map((t) => t.id));
const fmt = (x, c = 1) => Number(x).toFixed(c).replace('.', ',');
const VEL_KMH = { agente_transito: 38, guarda_municipal: 42, policial_militar: 45 };
// Perfil de fluxo de veículos por hora (veículos/min por faixa em via arterial).
const FLUXO_HORA = [2, 1.2, .8, .7, 1, 3, 8, 16, 18, 13, 11, 12, 15, 14, 12, 12, 14, 18, 19, 14, 10, 7, 5, 3];

class Simulador {
  constructor(db, city, motor, opts = {}) {
    this.db = db; this.city = city; this.motor = motor;
    this.rng = new Rng(opts.seed || Date.now() % 100000);
    this.ouvintes = new Set();
    // Alertas persistidos no banco: um reinício não apaga alertas críticos não reconhecidos.
    this.alertas = db.all('SELECT id, dados, reconhecido FROM alertas WHERE ts >= ? ORDER BY id DESC LIMIT 150', [Date.now() - DIA])
      .map((r) => ({ ...JSON.parse(r.dados), id: r.id, reconhecido: !!r.reconhecido }));
    this.seqAlerta = (db.get('SELECT MAX(id) AS m FROM alertas').m || 0) + 1;
    this.pendentes = { ocorrencias: [], atualizadas: [] }; // mudanças a enviar no próximo tick (SSE)
    this.fluxos = new Map();      // radarId -> { buckets: [{min, n}], anomalia: {mult, ate} }
    this.silenciosos = new Set(); // equipamentos que pararam de transmitir sem mudar o cadastro
    this.fimPlanejado = new Map();
    this.ultimoHeartbeat = 0;
    this.ultimaHora = inicioHora(Date.now());
    this.ultimoDia = inicioDia(Date.now());
    this.ultimaAnalise = 0;
    this.chavesAnomalia = new Set();
    this.contadoresDia = new Map();
    this.somaPesos = city.bairros.reduce((s, b) => s + b.peso, 0);
  }

  // ------------------------------------------------------------ inicialização
  preparar() {
    const agora = Date.now();
    // Recupera o tempo em que o servidor ficou desligado: a cidade não para.
    const ultimo = Number(this.db.getMeta('ultimo_tick') || this.db.getMeta('historico_ate') || agora);
    if (agora - ultimo > 5 * 60000) {
      const de = Math.max(ultimo, agora - 30 * DIA);
      seed.garantirCalendario(this.db, this.city, de, agora + 7 * DIA);
      seed.atualizarClima(this.db, de, agora);
      seed.gerarOcorrencias(this.db, this.city, de, agora, agora, new Rng(Math.floor(de / 1000)));
      const eqs = this.db.all('SELECT * FROM equipamentos').map((e) => ({ ...e, manut: [] }));
      seed.gerarTelemetriaDiaria(this.db, eqs, inicioDia(de), inicioDia(agora), new Rng(7));
    } else {
      seed.atualizarClima(this.db, agora - DIA, agora);
    }
    seed.garantirCalendario(this.db, this.city, agora - DIA, agora + 7 * DIA);
    seed.garantirEventoProximo(this.db, this.city, agora);
    // Encerra ocorrências antigas que ficaram abertas.
    this.db.run("UPDATE ocorrencias SET status = 'encerrada', fim = COALESCE(fim, inicio + 3600000) WHERE status != 'encerrada' AND COALESCE(fim, inicio + 3600000) <= ?", [agora]);
    for (const o of this.db.all("SELECT id, fim, inicio FROM ocorrencias WHERE status != 'encerrada'")) this.fimPlanejado.set(o.id, o.fim || o.inicio + HORA);
    this.db.run("UPDATE agentes SET ocorrencia_id = NULL, status = CASE WHEN status IN ('ocorrencia','deslocamento') THEN 'patrulha' ELSE status END");
    this.db.run("UPDATE ocorrencias SET agente_id = NULL, status = 'aberta' WHERE status != 'encerrada'");
    // Todos os equipamentos operacionais "reconectam".
    this.db.run("UPDATE equipamentos SET ultimo_sinal = ? WHERE situacao = 'operacional'", [agora]);
    this.atualizarTurnos(agora, true);
    this.prepararFluxos(agora);
    this.eventosTruth = seed.eventosParaTruth(this.db, this.city, agora - DIA, agora + 2 * DIA);
  }

  prepararFluxos(agora) {
    const radares = this.db.all("SELECT id, serie, bairro_id, lat, lng, atributos FROM equipamentos WHERE tipo = 'radar' AND situacao = 'operacional'");
    for (const r of radares) {
      const faixas = (JSON.parse(r.atributos || '{}').faixas || 2);
      const base = faixas * this.rng.float(0.7, 1.3);
      const f = { ...r, base, buckets: [], anomalia: null };
      for (let k = 60; k >= 1; k--) {
        const min = Math.floor((agora - k * 60000) / 60000);
        f.buckets.push({ min, n: this.rng.poisson(this.esperadoMinuto(f, min * 60000)) });
      }
      this.fluxos.set(r.id, f);
    }
  }

  esperadoMinuto(f, ts) {
    const h = horaLocal(ts), d = diaSemana(ts);
    const fimDeSemana = d === 0 ? 0.55 : d === 6 ? 0.75 : 1;
    const chuva = truth.chuvaReal(inicioHora(ts)) > 5 ? 0.85 : 1;
    let mult = 1;
    if (f.anomalia && ts < f.anomalia.ate && ts >= f.anomalia.de) mult = f.anomalia.mult;
    return f.base * FLUXO_HORA[h] * fimDeSemana * chuva * mult;
  }

  iniciar() {
    this.preparar();
    this.timer = setInterval(() => { try { this.tick(); } catch (e) { console.error('[simulador]', e); } }, TICK_MS);
  }

  parar() { clearInterval(this.timer); }

  // ------------------------------------------------------------------ ciclo
  tick() {
    const agora = Date.now();
    const mudancas = { ocorrencias: [], equipamentos: [], alertas: [] };

    if (inicioHora(agora) !== this.ultimaHora) this.novaHora(agora);
    if (inicioDia(agora) !== this.ultimoDia) this.novoDia(agora);

    this.atualizarTurnos(agora, false);
    this.gerarOcorrenciasAoVivo(agora, mudancas);
    this.encerrarOcorrencias(agora, mudancas);
    this.moverAgentes(agora);
    this.moverVeiculos();
    this.atualizarFluxos(agora);
    this.falhasAleatorias(agora, mudancas);

    if (agora - this.ultimoHeartbeat >= HEARTBEAT_MS) {
      this.ultimoHeartbeat = agora;
      this.db.tx(() => {
        for (const e of this.db.all("SELECT id FROM equipamentos WHERE situacao = 'operacional'")) {
          if (!this.silenciosos.has(e.id)) this.db.run('UPDATE equipamentos SET ultimo_sinal = ? WHERE id = ?', [agora, e.id]);
        }
      });
      this.db.setMeta('ultimo_tick', agora);
    }
    if (agora - this.ultimaAnalise >= 10000) {
      this.ultimaAnalise = agora;
      this.analisarAnomalias(mudancas);
    }
    mudancas.ocorrencias.push(...this.pendentes.ocorrencias);
    mudancas.atualizadas = this.pendentes.atualizadas;
    this.pendentes = { ocorrencias: [], atualizadas: [] };
    this.emitir('tick', this.estadoAoVivo(agora, mudancas));
  }

  novaHora(agora) {
    this.ultimaHora = inicioHora(agora);
    seed.atualizarClima(this.db, agora - 2 * HORA, agora);
    seed.garantirCalendario(this.db, this.city, agora - DIA, agora + 7 * DIA);
    seed.garantirEventoProximo(this.db, this.city, agora);
    this.eventosTruth = seed.eventosParaTruth(this.db, this.city, agora - DIA, agora + 2 * DIA);
    this.motor.garantirModelo(true);
    // Alertas preventivos da próxima hora.
    const prev = this.motor.previsao(3);
    for (const x of prev.matriz) {
      const s = x.serie[1];
      // Só alerta quando o risco é alto E foge do normal (evita "alarme todo dia no Centro").
      if (s && s.risco >= 70 && s.desvio >= 1.3) {
        const b = this.motor.bairros.find((y) => y.id === x.bairro_id);
        this.alertar({ nivel: 'alto', categoria: 'preventivo', titulo: `Risco elevado previsto em ${b.nome} na próxima hora`, detalhe: `Índice ${s.risco}, ${fmt(s.desvio, 2)}× o normal para o horário. Veja a recomendação de reforço.`, bairro_id: b.id, lat: b.lat, lng: b.lng });
      }
    }
    for (const e of prev.eventos) {
      if (e.inicio > agora && e.inicio - agora <= 2 * HORA) {
        const b = this.motor.bairros.find((y) => y.id === e.bairro_id);
        this.alertar({ nivel: 'medio', categoria: 'evento', titulo: `${e.nome} começa em breve`, detalhe: `Público estimado de ${e.publico_estimado} pessoas em ${e.local}. Previsão de aumento de congestionamento e perturbação no entorno.`, bairro_id: e.bairro_id, lat: b.lat, lng: b.lng });
      }
    }
  }

  novoDia(agora) {
    const dia = this.ultimoDia;
    this.ultimoDia = inicioDia(agora);
    // Fecha a telemetria diária com os contadores do dia que passou.
    const eqs = this.db.all("SELECT id, situacao, instalado_em FROM equipamentos WHERE instalado_em IS NOT NULL");
    this.db.tx(() => {
      for (const e of eqs) {
        const c = { leituras: Math.round(seed.usoDiario(e.tipo, dia, this.rng)), erros: this.rng.poisson(2) };
        const disp = e.situacao === 'operacional' && !this.silenciosos.has(e.id) ? this.rng.float(0.97, 1) : this.rng.float(0, 0.4);
        this.db.run('INSERT OR REPLACE INTO telemetria_diaria(equipamento_id, dia, disponibilidade, leituras, erros) VALUES(?,?,?,?,?)', [e.id, dia, +disp.toFixed(3), c.leituras, c.erros]);
      }
    });
    this.contadoresDia.clear();
  }

  // ------------------------------------------------------------------ turnos
  atualizarTurnos(agora, inicial) {
    const h = horaLocal(agora);
    const emTurno = (turno) => { const t = TURNOS.find((x) => x.id === turno); return t.inicio < t.fim ? h >= t.inicio && h < t.fim : h >= t.inicio || h < t.fim; };
    const ags = this.db.all("SELECT id, turno, status, bairro_id FROM agentes WHERE status != 'afastado'");
    for (const a of ags) {
      const deve = emTurno(a.turno);
      if (deve && a.status === 'fora_turno') {
        const b = this.city.bairros.find((x) => x.id === a.bairro_id);
        const [lat, lng] = offsetMeters(b.lat, b.lng, this.rng.normal(0, 250), this.rng.normal(0, 250));
        this.db.run("UPDATE agentes SET status = ?, lat = ?, lng = ?, atualizado_em = ? WHERE id = ?", [this.rng.chance(0.8) ? 'patrulha' : 'base', lat, lng, agora, a.id]);
      } else if (!deve && ['patrulha', 'base', 'deslocamento'].includes(a.status)) {
        this.db.run("UPDATE agentes SET status = 'fora_turno', atualizado_em = ? WHERE id = ?", [agora, a.id]);
      }
    }
  }

  // ------------------------------------------------------------- ocorrências
  ctxTruth(agora) {
    return { agora, somaPesos: this.somaPesos, eventos: this.eventosTruth || [], camerasFora: this.motor.camerasFora() };
  }

  gerarOcorrenciasAoVivo(agora, mudancas) {
    const ctx = this.ctxTruth(agora);
    const h = inicioHora(agora);
    const frac = TICK_MS / HORA;
    for (const b of this.city.bairros) {
      for (const t of TIPOS_OCORRENCIA) {
        const n = this.rng.poisson(truth.taxaHora(b, t.id, h, ctx) * frac);
        for (let i = 0; i < n; i++) {
          const [lat, lng] = offsetMeters(b.lat, b.lng, this.rng.normal(0, 380), this.rng.normal(0, 380));
          this.criarOcorrencia({ tipo: t.id, bairro_id: b.id, lat, lng, origem: this.rng.weighted(['agente', 'cidadao', 'camera', 'sensor'], [3, 3, 2, 1]) }, agora);
        }
      }
    }
  }

  criarOcorrencia({ tipo, bairro_id, lat, lng, origem, descricao, exercicio = 0 }, agora) {
    const t = TIPO_OC[tipo];
    const dur = Math.max(8, this.rng.normal(t.duracaoMin, t.duracaoMin / 3)) * 60000;
    const id = this.db.run('INSERT INTO ocorrencias(tipo, bairro_id, lat, lng, inicio, fim, status, origem, descricao, exercicio) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [tipo, bairro_id, lat, lng, agora, null, 'aberta', origem, descricao || null, exercicio]);
    this.fimPlanejado.set(id, agora + dur);
    // Despacho automático do agente compatível mais próximo e livre.
    const ags = this.db.all("SELECT id, nome, tipo, lat, lng FROM agentes WHERE status IN ('patrulha','base')");
    const compat = ags.filter((a) => TIPO_AG[a.tipo].foco === t.foco);
    let agente = null;
    if (compat.length && t.peso >= 1) {
      const n = nearest(lat, lng, compat);
      agente = compat[n.index];
      this.db.run("UPDATE agentes SET status = 'ocorrencia', ocorrencia_id = ?, atualizado_em = ? WHERE id = ?", [id, agora, agente.id]);
      this.db.run('UPDATE ocorrencias SET agente_id = ? WHERE id = ?', [agente.id, id]);
    }
    const b = this.city.bairros.find((x) => x.id === bairro_id);
    if (t.peso >= 2.5 || exercicio) {
      this.alertar({ nivel: t.peso >= 3 ? 'critico' : 'alto', categoria: 'ocorrencia', titulo: `${t.nome} em ${b.nome}`,
        detalhe: `${agente ? `Agente ${agente.nome} despachado automaticamente.` : 'Nenhum agente compatível disponível — atenção!'}${exercicio ? ' (EXERCÍCIO)' : ''}`,
        bairro_id, lat, lng, ref: { tipo: 'ocorrencia', id } });
    }
    this.motor.invalidar();
    const oc = { id, tipo, bairro_id, lat, lng, inicio: agora, status: 'aberta', origem, agente_id: agente ? agente.id : null, exercicio };
    this.pendentes.ocorrencias.push(oc);
    return oc;
  }

  encerrarOcorrencias(agora, mudancas) {
    for (const [id, fim] of this.fimPlanejado) {
      if (agora < fim) continue;
      this.fimPlanejado.delete(id);
      this.db.run("UPDATE ocorrencias SET status = 'encerrada', fim = ? WHERE id = ?", [agora, id]);
      this.db.run("UPDATE agentes SET status = 'patrulha', ocorrencia_id = NULL, atualizado_em = ? WHERE ocorrencia_id = ?", [agora, id]);
      mudancas.ocorrencias.push({ id, status: 'encerrada', fim: agora });
    }
  }

  // ---------------------------------------------------------- movimentação
  moverAgentes(agora) {
    const ags = this.db.all("SELECT a.id, a.tipo, a.status, a.lat, a.lng, a.bairro_id, a.ocorrencia_id, o.lat AS olat, o.lng AS olng, o.status AS ostatus FROM agentes a LEFT JOIN ocorrencias o ON o.id = a.ocorrencia_id WHERE a.status IN ('patrulha','ocorrencia','deslocamento')");
    const passoKm = (tipo) => (VEL_KMH[tipo] * TICK_MS) / HORA;
    this.db.tx(() => {
      for (const a of ags) {
        let alvo = null;
        if (a.status === 'ocorrencia' && a.olat) alvo = [a.olat, a.olng];
        else if (a.status === 'deslocamento') { const b = this.city.bairros.find((x) => x.id === a.bairro_id); alvo = [b.lat, b.lng]; }
        let lat = a.lat, lng = a.lng;
        if (alvo) {
          const d = haversine(lat, lng, alvo[0], alvo[1]);
          const passo = passoKm(a.tipo);
          if (d <= passo) {
            [lat, lng] = alvo;
            if (a.status === 'ocorrencia' && a.ostatus === 'aberta') {
              this.db.run("UPDATE ocorrencias SET status = 'atendimento' WHERE id = ?", [a.ocorrencia_id]);
              this.pendentes.atualizadas.push({ id: a.ocorrencia_id, status: 'atendimento' });
            }
            if (a.status === 'deslocamento') this.db.run("UPDATE agentes SET status = 'patrulha' WHERE id = ?", [a.id]);
          } else {
            lat += ((alvo[0] - lat) * passo) / d; lng += ((alvo[1] - lng) * passo) / d;
          }
        } else {
          // Patrulha: passeio aleatório que tende a voltar para o centro do bairro.
          const b = this.city.bairros.find((x) => x.id === a.bairro_id);
          const puxa = 0.02;
          lat += (b.lat - lat) * puxa + this.rng.normal(0, 0.00012);
          lng += (b.lng - lng) * puxa + this.rng.normal(0, 0.00012);
        }
        this.db.run('UPDATE agentes SET lat = ?, lng = ? WHERE id = ?', [lat, lng, a.id]);
      }
    });
  }

  moverVeiculos() {
    if (!this._moveis) this._moveis = this.db.all("SELECT id, tipo, lat, lng, atributos FROM equipamentos WHERE tipo IN ('taxi','mototaxi','escolar','patinete','fiscal_autonomo') AND situacao = 'operacional'")
      .map((v) => ({ ...v, dir: this.rng.float(0, 2 * Math.PI) }));
    const c = this.city.center;
    for (const v of this._moveis) {
      const vel = v.tipo === 'patinete' ? 0.00004 : 0.00012;
      v.dir += this.rng.normal(0, 0.35);
      v.lat += Math.sin(v.dir) * vel + (c.lat - v.lat) * 0.002;
      v.lng += Math.cos(v.dir) * vel + (c.lng - v.lng) * 0.002;
    }
  }

  // --------------------------------------------------------- telemetria radar
  atualizarFluxos(agora) {
    const min = Math.floor(agora / 60000);
    for (const f of this.fluxos.values()) {
      const ult = f.buckets[f.buckets.length - 1];
      if (ult.min !== min) {
        f.buckets.push({ min, n: 0 });
        if (f.buckets.length > 61) f.buckets.shift();
      }
      // Chegada de veículos neste tick (processo de Poisson).
      if (!this.silenciosos.has(f.id)) f.buckets[f.buckets.length - 1].n += this.rng.poisson(this.esperadoMinuto(f, agora) * (TICK_MS / 60000));
      const c = this.contadoresDia.get(f.id) || { leituras: 0, erros: 0 };
      c.leituras += 1; this.contadoresDia.set(f.id, c);
    }
  }

  /**
   * Leitura que o motor faz dos radares: compara os últimos 5 minutos de cada radar
   * com o "pulso da cidade" (média de todos os radares) — se um radar cai enquanto
   * os outros seguem normais, há algo acontecendo naquela via.
   */
  leituraFluxos(agora = Date.now()) {
    const min = Math.floor(agora / 60000);
    const lista = [...this.fluxos.values()].filter((f) => f.buckets.length > 20);
    if (!lista.length) return [];
    const fracAtual = ((agora % 60000) / 60000) || 0.01;
    const media = new Map();
    for (const f of lista) for (const b of f.buckets) media.set(b.min, (media.get(b.min) || 0) + b.n / lista.length);
    return lista.map((f) => {
      let obs = 0, esp = 0, histD = 0, histC = 0;
      for (const b of f.buckets) {
        const idade = min - b.min;
        const peso = idade === 0 ? fracAtual : 1;
        if (idade <= 5) { obs += b.n; }
        else if (idade <= 60) { histD += b.n; histC += media.get(b.min) || 0; }
      }
      const razao = histC > 0 ? histD / histC : 1;
      for (const b of f.buckets) { const idade = min - b.min; if (idade <= 5) esp += (media.get(b.min) || 0) * razao; }
      const z = esp > 0 ? (obs - esp) / Math.sqrt(esp) : 0;
      return { id: f.id, serie: f.serie, bairro_id: f.bairro_id, lat: f.lat, lng: f.lng, obs, esp, z, ultimos: f.buckets.slice(-30).map((b) => b.n) };
    });
  }

  // ------------------------------------------------------------- falhas
  falhasAleatorias(agora, mudancas) {
    if (!this.rng.chance(0.25)) return; // amostra 1 a cada ~4 ticks para economizar CPU
    const eqs = this.db.all("SELECT id, tipo, marca, serie, bairro_id, lat, lng, ultima_manut, instalado_em FROM equipamentos WHERE situacao = 'operacional'");
    const dtDias = (4 * TICK_MS) / DIA;
    for (const e of eqs) {
      const w = truth.WEIBULL[e.tipo]; if (!w) continue;
      const eta = w.eta * (truth.FATOR_MARCA[e.marca] || 1);
      const idade = Math.max(1, (agora - (e.ultima_manut || e.instalado_em || agora)) / DIA);
      const hazard = (w.k / eta) * Math.pow(idade / eta, w.k - 1);
      if (!this.rng.chance(hazard * dtDias)) continue;
      if (TIPO_EQ[e.tipo].movel || this.rng.chance(0.5)) {
        this.mudarSituacao(e.id, 'mau_funcionamento', 'Falha reportada pelo autodiagnóstico', agora);
        mudancas.equipamentos.push(e.id);
        this.alertar({ nivel: TIPO_EQ[e.tipo].criticidade >= 3 ? 'alto' : 'medio', categoria: 'equipamento', titulo: `${TIPO_EQ[e.tipo].nome} ${e.serie} com mau funcionamento`, detalhe: 'Autodiagnóstico do equipamento reportou falha. Manutenção imediata registrada.', bairro_id: e.bairro_id, lat: e.lat, lng: e.lng, ref: { tipo: 'equipamento', id: e.id } });
      } else {
        this.silenciosos.add(e.id); // falha silenciosa: só a análise de sinal percebe
      }
    }
  }

  mudarSituacao(id, para, motivo, agora, ator = 'Sistema') {
    const e = this.db.get('SELECT situacao FROM equipamentos WHERE id = ?', [id]);
    if (!e || e.situacao === para) return;
    const manut = para === 'mau_funcionamento' || para === 'furtado' ? ", manut_tipo = 'imediata', manut_data = " + agora : '';
    this.db.run(`UPDATE equipamentos SET situacao = ?, atualizado_em = ?${manut} WHERE id = ?`, [para, agora, id]);
    this.db.run('INSERT INTO situacao_historico(equipamento_id, ts, de, para, motivo) VALUES(?,?,?,?,?)', [id, agora, e.situacao, para, motivo]);
    this.db.run('INSERT INTO auditoria(ts, ator, acao, entidade, entidade_id, detalhes) VALUES(?,?,?,?,?,?)', [agora, ator, 'mudanca_situacao', 'equipamento', id, JSON.stringify({ de: e.situacao, para, motivo })]);
    if (para !== 'operacional') this.silenciosos.delete(id);
    this._moveis = null;
    this.motor.invalidar();
  }

  analisarAnomalias(mudancas) {
    const an = this.motor.anomalias(this.leituraFluxos());
    const ativas = new Set();
    for (const a of an) {
      const chave = `${a.tipo}:${a.equipamento_id || a.bairro_id}`;
      ativas.add(chave);
      if (this.chavesAnomalia.has(chave)) continue;
      this.chavesAnomalia.add(chave);
      mudancas.alertas.push(this.alertar({ nivel: a.gravidade === 'alta' ? 'alto' : 'medio', categoria: 'anomalia', titulo: a.titulo, detalhe: a.detalhe, bairro_id: a.bairro_id, lat: a.lat, lng: a.lng, ref: a.equipamento_id ? { tipo: 'equipamento', id: a.equipamento_id, anomalia: a.tipo } : null }));
    }
    for (const k of this.chavesAnomalia) if (!ativas.has(k)) this.chavesAnomalia.delete(k);
    this.anomaliasAtivas = an;
  }

  // ------------------------------------------------------------- alertas
  alertar(a) {
    const alerta = { id: this.seqAlerta++, ts: Date.now(), reconhecido: false, ...a };
    try { this.db.run('INSERT INTO alertas(id, ts, dados, reconhecido) VALUES(?,?,?,0)', [alerta.id, alerta.ts, JSON.stringify(alerta)]); } catch { /* segue em memória */ }
    this.alertas.unshift(alerta);
    if (this.alertas.length > 150) this.alertas.pop();
    this.emitir('alerta', alerta);
    return alerta;
  }

  // ------------------------------------------------------------- exercícios
  /**
   * Modo exercício: o operador injeta um incidente para treinar a equipe e
   * ver como o F.O.G.O. reage (detecção, alerta, despacho, impacto na previsão).
   */
  exercicio({ tipo, lat, lng }, ator = 'Operador') {
    const agora = Date.now();
    const b = this.city.bairros[nearest(lat, lng, this.city.bairros).index];
    const resultado = { tipo, bairro: b.nome, efeitos: [] };
    if (['acidente', 'roubo_furto', 'alagamento', 'congestionamento', 'perturbacao'].includes(tipo)) {
      const oc = this.criarOcorrencia({ tipo, bairro_id: b.id, lat, lng, origem: 'exercicio', descricao: 'Ocorrência simulada (modo exercício)', exercicio: 1 }, agora);
      resultado.ocorrencia = oc;
      resultado.efeitos.push(`Ocorrência registrada em ${b.nome}`);
      if (oc.agente_id) resultado.efeitos.push('Agente mais próximo despachado automaticamente');
      if (tipo === 'acidente' || tipo === 'alagamento' || tipo === 'congestionamento') {
        const radares = [...this.fluxos.values()].sort((p, q) => haversine(lat, lng, p.lat, p.lng) - haversine(lat, lng, q.lat, q.lng)).slice(0, 2);
        for (const r of radares) r.anomalia = { mult: tipo === 'congestionamento' ? 0.45 : 0.2, de: agora, ate: agora + 25 * 60000 };
        resultado.efeitos.push(`Fluxo de veículos reduzido nos radares ${radares.map((r) => r.serie).join(', ')} (o motor deve detectar em 1–3 min)`);
      }
    } else if (tipo === 'furto_camera') {
      const cams = this.db.all("SELECT id, serie, lat, lng FROM equipamentos WHERE tipo = 'camera' AND situacao = 'operacional'");
      const c = cams[nearest(lat, lng, cams).index];
      this.silenciosos.add(c.id);
      this.db.run('UPDATE equipamentos SET ultimo_sinal = ? WHERE id = ?', [agora - 85000, c.id]);
      this.criarOcorrencia({ tipo: 'vandalismo_equipamento', bairro_id: b.id, lat: c.lat, lng: c.lng, origem: 'exercicio', descricao: `Câmera ${c.serie} parou de transmitir`, exercicio: 1 }, agora);
      resultado.efeitos.push(`Câmera ${c.serie} parou de transmitir — o cadastro ainda diz "operacional"; o motor detecta pelo sinal ausente`);
    } else if (tipo === 'chuva_forte') {
      // A chuva passa a existir de verdade no "mundo" simulado (mais acidentes e alagamentos)
      // e entra na previsão meteorológica que o motor lê.
      [28, 34, 22, 12].forEach((mm, k) => truth.definirChuvaExtra(inicioHora(agora) + k * HORA, mm));
      seed.atualizarClima(this.db, agora - HORA, agora);
      this.motor.invalidar();
      resultado.efeitos.push('Chuva forte nas próximas 4 horas: o risco de acidentes e de alagamento em bairros de baixada foi recalculado (veja a Cidade Preditiva)');
      this.alertar({ nivel: 'alto', categoria: 'preventivo', titulo: 'Alerta meteorológico: chuva forte nas próximas horas (EXERCÍCIO)', detalhe: 'Risco de acidentes e alagamentos recalculado. Verifique bairros de baixada.', bairro_id: null, lat: this.city.center.lat, lng: this.city.center.lng });
    } else {
      throw new Error('Tipo de exercício desconhecido');
    }
    this.db.run('INSERT INTO auditoria(ts, ator, acao, entidade, entidade_id, detalhes) VALUES(?,?,?,?,?,?)', [agora, ator, 'exercicio', 'cidade', null, JSON.stringify({ tipo, lat, lng, bairro: b.nome })]);
    return resultado;
  }

  // ------------------------------------------------------------- estado
  /** Sem sinal = cadastro diz "operacional", mas não há heartbeat há mais de 90 s (detectado pelo timestamp). */
  estaSemSinal(e, agora = Date.now()) {
    return e.situacao === 'operacional' && !MOVEIS.has(e.tipo) && (e.ultimo_sinal || 0) < agora - SEM_SINAL_MS;
  }
  listaSemSinal(agora = Date.now()) {
    return this.db.all("SELECT id, tipo, situacao, ultimo_sinal FROM equipamentos WHERE situacao = 'operacional' AND ultimo_sinal < ?", [agora - SEM_SINAL_MS])
      .filter((e) => this.estaSemSinal(e, agora)).map((e) => e.id);
  }

  kpis() {
    const r = this.db.get(`SELECT COUNT(*) AS total,
      SUM(situacao = 'operacional') AS operacionais,
      SUM(situacao IN ('mau_funcionamento','manutencao','furtado')) AS indisponiveis,
      SUM(situacao = 'nao_instalado') AS nao_instalados,
      SUM(situacao = 'desativado') AS desativados,
      SUM(manut_tipo = 'imediata' OR (manut_data IS NOT NULL AND manut_data < ? AND situacao != 'nao_instalado')) AS manut_urgente
      FROM equipamentos`, [Date.now() + 7 * DIA]);
    const ag = this.db.get(`SELECT SUM(status IN ('patrulha','ocorrencia','deslocamento','base')) AS ativos, SUM(status = 'ocorrencia') AS em_ocorrencia, COUNT(*) AS total FROM agentes`);
    const oc = this.db.get("SELECT COUNT(*) AS abertas FROM ocorrencias WHERE status != 'encerrada'");
    const hoje = this.db.get('SELECT COUNT(*) AS n FROM ocorrencias WHERE inicio >= ?', [inicioDia(Date.now())]);
    const base = r.total - r.nao_instalados - r.desativados;
    const semSinal = this.listaSemSinal().length;
    return {
      ...r, operacionais_efetivos: r.operacionais - semSinal, sem_sinal: semSinal,
      disponibilidade: base ? +((r.operacionais - semSinal) / base).toFixed(4) : 1,
      agentes_ativos: ag.ativos || 0, agentes_em_ocorrencia: ag.em_ocorrencia || 0, agentes_total: ag.total,
      ocorrencias_abertas: oc.abertas, ocorrencias_hoje: hoje.n,
      alertas_ativos: this.alertas.filter((a) => !a.reconhecido && Date.now() - a.ts < 6 * HORA).length,
    };
  }

  estadoAoVivo(agora, mudancas = { ocorrencias: [], equipamentos: [], alertas: [] }) {
    return {
      agora, kpis: this.kpis(),
      agentes: this.db.all("SELECT id, lat, lng, status, tipo, bairro_id, ocorrencia_id FROM agentes WHERE status NOT IN ('fora_turno','afastado')"),
      moveis: (this._moveis || []).map((v) => ({ id: v.id, lat: +v.lat.toFixed(6), lng: +v.lng.toFixed(6) })),
      novasOcorrencias: mudancas.ocorrencias.filter((o) => o.tipo),
      ocorrenciasEncerradas: mudancas.ocorrencias.filter((o) => !o.tipo).map((o) => o.id),
      equipamentosAlterados: mudancas.equipamentos,
      ocorrenciasAtualizadas: mudancas.atualizadas || [],
      semSinal: this.listaSemSinal(),
    };
  }

  emitir(evento, dados) {
    const msg = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
    for (const res of this.ouvintes) { try { res.write(msg); } catch { this.ouvintes.delete(res); } }
  }
}

module.exports = { Simulador };
