'use strict';
/**
 * MOTOR DO F.O.G.O.
 * Orquestra os modelos e mantém caches. Lê apenas o banco de dados (e a telemetria
 * ao vivo que chega do "campo"), nunca os parâmetros ocultos do simulador.
 */
const { HORA, DIA, inicioHora, inicioDia, horaLocal } = require('../lib/time');
const { haversine } = require('../lib/geo');
const { TIPOS_OCORRENCIA, TIPO_OC, TIPO_EQ, TIPO_AG, STATUS_AG } = require('../domain/catalog');
const risco = require('./risco');
const manutencao = require('./manutencao');
const { voronoi, hungaro, hamilton, poissonCaudaSuperior, poissonCaudaInferior } = require('./algoritmos');

const RELEVANTES = new Set(['acidente', 'congestionamento', 'via_obstruida', 'roubo_furto', 'perturbacao', 'alagamento']);

class Motor {
  constructor(db, city) {
    this.db = db;
    this.city = city;
    this.modelo = null;
    this.cache = {};
    this.bairros = db.all('SELECT * FROM bairros ORDER BY id');
    this.celulas = voronoi(this.bairros, city.bbox);
  }

  // ------------------------------------------------------------------ dados
  dados() {
    return {
      bairros: this.bairros,
      ocorrencias: this.db.all('SELECT id, tipo, bairro_id, inicio, exercicio FROM ocorrencias WHERE inicio >= ?', [Date.now() - 100 * DIA]),
      clima: new Map(this.db.all('SELECT hora, chuva_mm FROM clima WHERE previsao = 0').map((r) => [r.hora, r.chuva_mm])),
      eventos: this.eventos(),
    };
  }

  eventos() {
    return this.db.all('SELECT * FROM eventos_cidade ORDER BY inicio').map((e) => {
      const b = this.bairros.find((x) => x.id === e.bairro_id) || this.bairros[0];
      const vizinhos = this.bairros.filter((x) => x.id !== b.id)
        .sort((p, q) => haversine(p.lat, p.lng, b.lat, b.lng) - haversine(q.lat, q.lng, b.lat, b.lng)).slice(0, 2).map((x) => x.id);
      return { ...e, vizinhos };
    });
  }

  camerasFora() {
    const m = {};
    for (const r of this.db.all("SELECT bairro_id, COUNT(*) AS n FROM equipamentos WHERE tipo = 'camera' AND situacao IN ('furtado','mau_funcionamento','manutencao') GROUP BY bairro_id")) m[r.bairro_id] = r.n;
    return m;
  }

  chuvaPrevista() {
    return new Map(this.db.all('SELECT hora, chuva_mm FROM clima WHERE previsao = 1').map((r) => [r.hora, r.chuva_mm]));
  }

  /** Retreina o modelo de risco a cada hora cheia (ou quando forçado). */
  garantirModelo(forcar = false) {
    const fim = inicioHora(Date.now());
    if (!forcar && this.modelo && this.modelo.treinadoAte === fim) return this.modelo;
    const t = Date.now();
    this.modelo = risco.treinar(this.dados(), fim);
    this.modelo.tempoTreinoMs = Date.now() - t;
    this.cache = {};
    return this.modelo;
  }

  /** Limpa caches derivados do estado atual (o backtest do dia é preservado: depende só do passado). */
  invalidar() { for (const k of Object.keys(this.cache)) if (!k.startsWith('bt:')) delete this.cache[k]; }

  // ------------------------------------------------------------- previsão
  previsao(horas = 24) {
    const chave = `prev:${horas}:${inicioHora(Date.now())}`;
    if (this.cache[chave] && Date.now() - this.cache[chave].ts < 60000) return this.cache[chave].v;
    const m = this.garantirModelo();
    const ctx = { chuvaPrevista: this.chuvaPrevista(), eventos: this.eventos(), camerasFora: this.camerasFora() };
    const agora = Date.now();
    const janela = risco.preverJanela(m, agora, horas, ctx);
    const porBairro = {};
    for (const p of janela) {
      const x = porBairro[p.bairro_id] || (porBairro[p.bairro_id] = { bairro_id: p.bairro_id, serie: [], pico: null, esperado: 0 });
      x.serie.push({ hora: p.hora, risco: p.risco, desvio: p.desvio });
      x.esperado += p.porTipo.filter((t) => RELEVANTES.has(t.tipo)).reduce((s, t) => s + t.lambda, 0);
      if (!x.pico || p.risco > x.pico.risco) x.pico = { hora: p.hora, risco: p.risco, desvio: p.desvio };
    }
    // Curva da cidade: ocorrências relevantes esperadas por hora.
    const curva = [];
    for (let k = 0; k < horas; k++) {
      const h = inicioHora(agora) + k * HORA;
      const ps = janela.filter((p) => p.hora === h);
      curva.push({
        hora: h, chuva: ctx.chuvaPrevista.get(h) || 0,
        esperado: +ps.reduce((s, p) => s + p.porTipo.filter((t) => RELEVANTES.has(t.tipo)).reduce((a, t) => a + t.lambda, 0), 0).toFixed(2),
        porTipo: Object.fromEntries(TIPOS_OCORRENCIA.map((t) => [t.id, +ps.reduce((s, p) => s + p.porTipo.find((x) => x.tipo === t.id).lambda, 0).toFixed(3)])),
      });
    }
    // Pontos quentes: maior risco, com preferência ao que foge do normal.
    const hotspots = janela.slice().sort((a, b) => (b.risco * Math.min(2, b.desvio)) - (a.risco * Math.min(2, a.desvio))).slice(0, 12)
      .map((p) => ({ bairro_id: p.bairro_id, hora: p.hora, risco: p.risco, nivel: risco.nivel(p.risco), desvio: p.desvio, evento: p.evento ? p.evento.nome : null, chuvaMm: p.chuvaMm, ...risco.explicar(p) }));
    const eventos = ctx.eventos.filter((e) => e.fim >= agora && e.inicio <= agora + horas * HORA);
    const v = {
      geradoEm: agora, horas, modelo: this.resumoModelo(),
      matriz: Object.values(porBairro).map((x) => ({ ...x, esperado: +x.esperado.toFixed(2), nivelPico: risco.nivel(x.pico.risco) })),
      curva, hotspots, eventos,
      chuva: curva.filter((c) => c.chuva > 0).map((c) => ({ hora: c.hora, mm: c.chuva })),
    };
    this.cache[chave] = { ts: Date.now(), v };
    return v;
  }

  resumoModelo() {
    const m = this.garantirModelo();
    return {
      treinadoAte: m.treinadoAte, semanas: risco.SEMANAS_TREINO, ocorrenciasUsadas: m.nOcorrencias, tempoTreinoMs: m.tempoTreinoMs,
      efeitoChuva: Object.fromEntries(TIPOS_OCORRENCIA.filter((t) => t.id !== 'alagamento').map((t) => [t.id, m.chuva[t.id].map((x) => +x.toFixed(2))])),
      efeitoEvento: Object.fromEntries(TIPOS_OCORRENCIA.filter((t) => t.id !== 'alagamento').map((t) => [t.id, +m.evento[t.id].toFixed(2)])),
    };
  }

  explicar(bairroId, hora) {
    const m = this.garantirModelo();
    const b = this.bairros.find((x) => x.id === bairroId);
    if (!b) return null;
    const h = inicioHora(hora);
    const prev = this.chuvaPrevista();
    const ctx = { chuvaMm: prev.get(h) || 0, eventos: this.eventos(), camerasFora: this.camerasFora() };
    const p = risco.preverHora(m, b, h, ctx);
    const ex = risco.explicar(p);
    const historico = this.db.get('SELECT COUNT(*) AS n FROM ocorrencias WHERE bairro_id = ? AND inicio >= ? AND exercicio = 0', [b.id, m.inicio]).n;
    return {
      bairro: b, hora: h, risco: p.risco, nivel: risco.nivel(p.risco), desvio: p.desvio, ...ex,
      considerado: [
        `${historico} ocorrências deste bairro nas últimas ${risco.SEMANAS_TREINO} semanas`,
        `Padrão de horário e dia da semana aprendido de ${m.nOcorrencias} ocorrências da cidade`,
        `Previsão de chuva para o horário: ${ctx.chuvaMm} mm/h (${risco.NOME_FAIXA[p.faixaChuva]})`,
        p.evento ? `Evento programado: ${p.evento.nome} (${p.evento.publico_estimado || '?'} pessoas)` : 'Nenhum evento programado na região',
        `Câmeras fora de operação no bairro: ${ctx.camerasFora[b.id] || 0}`,
      ],
    };
  }

  // -------------------------------------------------------------- backtest
  /**
   * PROVA: treina o modelo só com dados ATÉ o início de ontem, prevê ontem hora a
   * hora e compara com o que realmente aconteceu. Também compara com uma linha de
   * base ingênua ("média histórica do bairro") para mostrar o ganho real.
   */
  backtest(dias = 7) {
    const chave = `bt:${inicioDia(Date.now())}:${dias}`;
    if (this.cache[chave]) return this.cache[chave];
    const dados = this.dados();
    const resultados = [];
    const calib = Array.from({ length: 10 }, () => ({ prev: 0, obs: 0, n: 0 }));
    let curvaOntem = null;
    for (let d = dias; d >= 1; d--) {
      const d0 = inicioDia(Date.now()) - d * DIA;
      const m = risco.treinar(dados, d0);
      const obs = new Map();
      for (const o of dados.ocorrencias) {
        if (o.inicio < d0 || o.inicio >= d0 + DIA || o.exercicio) continue;
        const k = `${o.bairro_id}:${inicioHora(o.inicio)}`;
        if (!obs.has(k)) obs.set(k, []);
        obs.get(k).push(o.tipo);
      }
      const linhas = [];
      const curva = [];
      for (let h = d0; h < d0 + DIA; h += HORA) {
        let prevH = 0, obsH = 0;
        for (const b of this.bairros) {
          const p = risco.preverHora(m, b, h, { chuvaMm: dados.clima.get(h) || 0, eventos: dados.eventos, camerasFora: {} });
          const tipos = obs.get(`${b.id}:${h}`) || [];
          const lamRel = p.porTipo.filter((t) => RELEVANTES.has(t.tipo)).reduce((s, t) => s + t.lambda, 0);
          const nRel = tipos.filter((t) => RELEVANTES.has(t)).length;
          const bi = m.idx[b.id];
          const ingenuo = TIPOS_OCORRENCIA.filter((t) => RELEVANTES.has(t.id)).reduce((s, t) => s + (t.id === 'alagamento' ? 0 : m.base[t.id][bi] / 24), 0);
          linhas.push({ risco: p.risco, lam: lamRel, n: nRel, ingenuo });
          const pr = 1 - Math.exp(-lamRel);
          const bin = Math.min(9, Math.floor(pr * 10));
          calib[bin].prev += pr; calib[bin].obs += nRel > 0 ? 1 : 0; calib[bin].n++;
          prevH += lamRel; obsH += nRel;
        }
        curva.push({ hora: h, previsto: +prevH.toFixed(2), observado: obsH });
      }
      const mae = linhas.reduce((s, l) => s + Math.abs(l.lam - l.n), 0) / linhas.length;
      const maeIng = linhas.reduce((s, l) => s + Math.abs(l.ingenuo - l.n), 0) / linhas.length;
      const ord = linhas.slice().sort((a, b) => b.lam - a.lam);
      const topN = Math.round(linhas.length * 0.1);
      const taxaTop = ord.slice(0, topN).filter((l) => l.n > 0).length / topN;
      // Linha de base: ordenar só pela média histórica do bairro (sem horário, dia, chuva, evento...).
      const ordIng = linhas.slice().sort((a, b) => b.ingenuo - a.ingenuo);
      const taxaTopIng = ordIng.slice(0, topN).filter((l) => l.n > 0).length / topN;
      const taxaGeral = linhas.filter((l) => l.n > 0).length / linhas.length;
      const capturadas = ord.slice(0, topN).reduce((s, l) => s + l.n, 0) / Math.max(1, linhas.reduce((s, l) => s + l.n, 0));
      resultados.push({ dia: d0, mae: +mae.toFixed(3), maeIngenuo: +maeIng.toFixed(3), ganho: +(1 - mae / maeIng).toFixed(3), taxaTop: +taxaTop.toFixed(3), taxaGeral: +taxaGeral.toFixed(3), lift: +(taxaTop / taxaGeral).toFixed(2), liftIngenuo: +(taxaTopIng / taxaGeral).toFixed(2), capturadas: +capturadas.toFixed(3) });
      if (d === 1) curvaOntem = curva;
    }
    const media = (k) => +(resultados.reduce((s, r) => s + r[k], 0) / resultados.length).toFixed(3);
    const v = {
      dias: resultados, curvaOntem,
      resumo: { ganho: media('ganho'), lift: media('lift'), liftIngenuo: media('liftIngenuo'), taxaTop: media('taxaTop'), taxaGeral: media('taxaGeral'), capturadas: media('capturadas') },
      calibracao: calib.filter((c) => c.n >= 5).map((c, i) => ({ previsto: +(c.prev / c.n).toFixed(3), observado: +(c.obs / c.n).toFixed(3), n: c.n })),
    };
    this.cache[chave] = v;
    return v;
  }

  // ------------------------------------------------------------- regiões
  regioes() {
    const agora = Date.now();
    const prev = this.previsao(6);
    const eqs = this.db.all('SELECT bairro_id, situacao, manut_tipo, manut_data FROM equipamentos');
    const ocs = this.db.all("SELECT bairro_id, tipo FROM ocorrencias WHERE status != 'encerrada'");
    const ags = this.db.all("SELECT bairro_id, status FROM agentes");
    return this.bairros.map((b, i) => {
      const e = eqs.filter((x) => x.bairro_id === b.id);
      const instalados = e.filter((x) => !['nao_instalado', 'desativado'].includes(x.situacao));
      const op = instalados.filter((x) => x.situacao === 'operacional').length;
      const disp = instalados.length ? op / instalados.length : 1;
      const abertas = ocs.filter((x) => x.bairro_id === b.id);
      const graves = abertas.filter((x) => TIPO_OC[x.tipo].peso >= 2.5).length;
      const ativos = ags.filter((x) => x.bairro_id === b.id && STATUS_AG[x.status] && STATUS_AG[x.status].ativo).length;
      const pb = prev.matriz.find((x) => x.bairro_id === b.id);
      const riscoAgora = pb ? pb.serie[0].risco : 0;
      const pico6h = pb ? pb.pico : null;
      const manutUrg = e.filter((x) => x.manut_tipo === 'imediata' || (x.manut_data && x.manut_data < agora + 7 * DIA && x.situacao !== 'nao_instalado')).length;
      const motivos = [];
      if (riscoAgora >= 75) motivos.push(`Risco crítico agora (${riscoAgora})`);
      else if (riscoAgora >= 50) motivos.push(`Risco alto agora (${riscoAgora})`);
      if (graves) motivos.push(`${graves} ocorrência(s) grave(s) em aberto`);
      if (disp < 0.9) motivos.push(`Disponibilidade de equipamentos em ${Math.round(disp * 100)}%`);
      if (!ativos && riscoAgora >= 40) motivos.push('Nenhum agente ativo no bairro');
      const estado = riscoAgora >= 75 || graves >= 2 || disp < 0.7 ? 'critico' : riscoAgora >= 50 || graves >= 1 || disp < 0.9 || (!ativos && riscoAgora >= 40) ? 'atencao' : 'normal';
      return {
        bairro_id: b.id, nome: b.nome, zona: b.zona, poligono: this.celulas[i], estado, motivos,
        equipamentos: e.length, operacionais: op, disponibilidade: +disp.toFixed(3), manutUrgente: manutUrg,
        ocorrenciasAbertas: abertas.length, graves, agentesAtivos: ativos, riscoAgora, pico6h,
      };
    });
  }

  // ------------------------------------------------------------- despacho
  /**
   * Reforço de agentes para as próximas 3 horas:
   *  1) demanda prevista por bairro, separada por foco (trânsito x segurança)
   *  2) alocação ideal proporcional à demanda (método de Hamilton)
   *  3) quem sobra onde está "sobrando" vai para onde falta, com o menor
   *     deslocamento total possível (algoritmo Húngaro, distância de Haversine)
   */
  despacho() {
    const m = this.garantirModelo();
    const agora = Date.now();
    const ctx = { chuvaPrevista: this.chuvaPrevista(), eventos: this.eventos(), camerasFora: this.camerasFora() };
    const janela = risco.preverJanela(m, agora, 3, ctx);
    const agentes = this.db.all("SELECT * FROM agentes WHERE status IN ('patrulha','base','deslocamento')");
    const planos = [];
    for (const foco of ['transito', 'seguranca']) {
      const tiposFoco = TIPOS_OCORRENCIA.filter((t) => t.foco === foco).map((t) => t.id);
      const demanda = this.bairros.map((b) => janela.filter((p) => p.bairro_id === b.id)
        .reduce((s, p) => s + p.porTipo.filter((t) => tiposFoco.includes(t.tipo)).reduce((a, t) => a + t.peso * t.lambda, 0), 0));
      const ags = agentes.filter((a) => TIPO_AG[a.tipo].foco === foco);
      if (!ags.length) continue;
      const alvo = hamilton(ags.length, demanda);
      const atual = this.bairros.map((b) => ags.filter((a) => a.bairro_id === b.id).length);
      // Agentes "excedentes": em bairros com mais agentes que o alvo (os mais distantes do centro saem primeiro).
      const excedentes = [];
      this.bairros.forEach((b, i) => {
        const extra = atual[i] - alvo[i];
        if (extra > 0) {
          ags.filter((a) => a.bairro_id === b.id && a.status !== 'deslocamento')
            .slice(0, extra).forEach((a) => excedentes.push(a));
        }
      });
      const vagas = [];
      this.bairros.forEach((b, i) => { for (let k = 0; k < alvo[i] - atual[i]; k++) vagas.push(i); });
      if (!excedentes.length || !vagas.length) continue;
      // Matriz de custo: distância (km). Vagas em bairros de demanda maior ganham leve prioridade.
      const linhas = excedentes.length <= vagas.length ? excedentes : excedentes.slice(0, vagas.length);
      const custo = linhas.map((a) => vagas.map((vi) => haversine(a.lat, a.lng, this.bairros[vi].lat, this.bairros[vi].lng)));
      const atrib = hungaro(custo);
      linhas.forEach((a, li) => {
        const vi = vagas[atrib[li]];
        if (vi === undefined) return;
        const destino = this.bairros[vi];
        const origemIdx = this.bairros.findIndex((b) => b.id === a.bairro_id);
        const km = custo[li][atrib[li]];
        const ganho = demanda[vi] / Math.max(1, atual[vi] + 1) - demanda[origemIdx] / Math.max(1, atual[origemIdx]);
        if (ganho <= 0.05) return;
        // Motivo coerente com o tipo de agente: só os tipos de ocorrência do foco dele.
        const demandaFoco = (p) => p.porTipo.filter((t) => tiposFoco.includes(t.tipo)).reduce((a, t) => a + t.peso * t.lambda, 0);
        const picoDestino = janela.filter((p) => p.bairro_id === destino.id).sort((x, y) => demandaFoco(y) - demandaFoco(x))[0];
        const principais = picoDestino.porTipo.filter((t) => tiposFoco.includes(t.tipo) && t.tipo !== 'estacionamento_irregular')
          .sort((x, y) => y.peso * y.lambda - x.peso * x.lambda).slice(0, 2).map((t) => TIPO_OC[t.tipo].nome.toLowerCase());
        planos.push({
          agente_id: a.id, agente: a.nome, matricula: a.matricula, tipoAgente: a.tipo, foco,
          de: { bairro_id: a.bairro_id, nome: this.bairros[origemIdx] ? this.bairros[origemIdx].nome : '?' },
          para: { bairro_id: destino.id, nome: destino.nome, lat: destino.lat, lng: destino.lng },
          km: +km.toFixed(1), minutos: Math.max(3, Math.round((km / 30) * 60)), ganho: +ganho.toFixed(2),
          motivo: `Pico de demanda de ${foco === 'transito' ? 'trânsito' : 'segurança'} às ${String(horaLocal(picoDestino.hora)).padStart(2, '0')}h em ${destino.nome} (risco ${picoDestino.risco}): ${principais.join(' e ')}. Cobertura atual ${atual[vi]}, ideal ${alvo[vi]}.`,
        });
      });
    }
    planos.sort((a, b) => b.ganho - a.ganho);
    return { geradoEm: agora, horizonteHoras: 3, movimentos: planos.slice(0, 10), agentesDisponiveis: agentes.length };
  }

  // ------------------------------------------------------------ manutenção
  manutencao() {
    const chave = `man:${inicioHora(Date.now())}`;
    if (this.cache[chave]) return this.cache[chave];
    const riscoBairro = {};
    for (const x of this.previsao(24).matriz) riscoBairro[x.bairro_id] = x.pico.risco;
    const r = manutencao.analisar({
      equipamentos: this.db.all('SELECT * FROM equipamentos'), manutencoes: this.db.all('SELECT * FROM manutencoes'),
      telemetria: this.db.all('SELECT * FROM telemetria_diaria WHERE dia >= ?', [Date.now() - 40 * DIA]), agora: Date.now(), riscoBairro,
    });
    r.ranking = r.ranking.slice(0, 40);
    this.cache[chave] = r;
    return r;
  }

  // ------------------------------------------------------------- anomalias
  /**
   * Detecção de comportamento fora do padrão:
   *  - equipamento "operacional" que parou de enviar sinal (heartbeat)
   *  - fluxo de veículos muito diferente do esperado (z-score de Poisson acumulado)
   *  - pico de ocorrências estatisticamente improvável no bairro (cauda de Poisson)
   */
  anomalias(fluxos) {
    const agora = Date.now();
    const out = [];
    const silenciosos = this.db.all(`SELECT id, serie, tipo, bairro_id, ultimo_sinal, lat, lng FROM equipamentos
      WHERE situacao = 'operacional' AND ultimo_sinal < ?`, [agora - 90000]); // 3 heartbeats de 30 s perdidos
    for (const e of silenciosos) {
      if (TIPO_EQ[e.tipo].movel) continue;
      out.push({ tipo: 'sem_sinal', gravidade: TIPO_EQ[e.tipo].criticidade >= 3 ? 'alta' : 'media', equipamento_id: e.id, bairro_id: e.bairro_id, lat: e.lat, lng: e.lng,
        titulo: `${TIPO_EQ[e.tipo].nome} ${e.serie} sem comunicação`, detalhe: `Último sinal há ${Math.round((agora - e.ultimo_sinal) / 1000)} s (3 ou mais batidas perdidas), mas o cadastro diz "operacional". Possível furto, vandalismo ou falha de energia.` });
    }
    for (const f of fluxos || []) {
      if (f.z <= -3.5 || f.z >= 3.5) {
        out.push({ tipo: 'fluxo', gravidade: Math.abs(f.z) > 6 ? 'alta' : 'media', equipamento_id: f.id, bairro_id: f.bairro_id, lat: f.lat, lng: f.lng,
          titulo: `Fluxo ${f.z < 0 ? 'muito abaixo' : 'muito acima'} do esperado (${f.serie})`,
          detalhe: `${f.obs} veículos nos últimos 5 min; esperado ≈ ${Math.round(f.esp)} pelo pulso da cidade (z = ${f.z.toFixed(1).replace('.', ',')}). ${f.z < 0 ? 'Possível bloqueio à frente, acidente ou falha do sensor.' : 'Possível desvio de tráfego para esta via.'}` });
      }
    }
    // Pico de ocorrências nas últimas 3 horas.
    const m = this.garantirModelo();
    const desde = agora - 3 * HORA;
    const recentes = this.db.all('SELECT bairro_id, tipo FROM ocorrencias WHERE inicio >= ?', [desde]);
    const prev = this.chuvaPrevista();
    const clima = new Map(this.db.all('SELECT hora, chuva_mm FROM clima WHERE hora >= ?', [desde - HORA]).map((r) => [r.hora, r.chuva_mm]));
    const eventos = this.eventos();
    for (const b of this.bairros) {
      const n = recentes.filter((o) => o.bairro_id === b.id && RELEVANTES.has(o.tipo)).length;
      if (n < 4) continue;
      let lam = 0;
      for (let h = inicioHora(desde); h <= agora; h += HORA) {
        const frac = Math.min(1, (Math.min(agora, h + HORA) - Math.max(desde, h)) / HORA);
        const p = risco.preverHora(m, b, h, { chuvaMm: clima.get(h) ?? prev.get(h) ?? 0, eventos, camerasFora: {} });
        lam += frac * p.porTipo.filter((t) => RELEVANTES.has(t.tipo)).reduce((s, t) => s + t.lambda, 0);
      }
      const pval = poissonCaudaSuperior(n, lam);
      if (pval < 0.002) {
        out.push({ tipo: 'pico', gravidade: pval < 0.0005 ? 'alta' : 'media', bairro_id: b.id, lat: b.lat, lng: b.lng,
          titulo: `Pico atípico de ocorrências em ${b.nome}`,
          detalhe: `${n} ocorrências nas últimas 3h; o esperado era ${lam.toFixed(1).replace('.', ',')}. A chance de isso ser acaso é de ${(pval * 100).toFixed(2).replace('.', ',')}%.` });
      }
    }
    return out;
  }

  // ------------------------------------------------------------ tendências
  tendencias() {
    const chave = `tend:${inicioHora(Date.now())}`;
    if (this.cache[chave]) return this.cache[chave];
    const agora = Date.now();
    const de = inicioDia(agora) - 90 * DIA;
    const disp = this.db.all(`SELECT t.dia, e.tipo, AVG(t.disponibilidade) AS d, SUM(t.leituras) AS l, SUM(t.erros) AS er
      FROM telemetria_diaria t JOIN equipamentos e ON e.id = t.equipamento_id WHERE t.dia >= ? GROUP BY t.dia, e.tipo ORDER BY t.dia`, [de]);
    const dias = [...new Set(disp.map((r) => r.dia))];
    const dispGeral = dias.map((d) => {
      const rs = disp.filter((r) => r.dia === d);
      return { dia: d, disponibilidade: +(rs.reduce((s, r) => s + r.d, 0) / rs.length).toFixed(4) };
    });
    const porTipo = {};
    for (const r of disp) (porTipo[r.tipo] = porTipo[r.tipo] || []).push({ dia: r.dia, d: +r.d.toFixed(4), leituras: r.l });
    const resumoTipo = Object.entries(porTipo).map(([tipo, s]) => {
      const ult = s.slice(-7), ant = s.slice(-37, -7);
      const a = ult.reduce((x, r) => x + r.d, 0) / Math.max(1, ult.length), b = ant.reduce((x, r) => x + r.d, 0) / Math.max(1, ant.length);
      return { tipo, nome: TIPO_EQ[tipo].nome, ultimos7: +a.toFixed(4), anteriores30: +b.toFixed(4), variacao: +(a - b).toFixed(4) };
    }).sort((x, y) => x.variacao - y.variacao);
    const UNID = { totem: 'transações/dia', cancela: 'aberturas/dia', patinete: 'viagens/dia', taxi: 'corridas/dia' };
    const uso = ['patinete', 'totem', 'cancela', 'taxi'].map((tipo) => {
      const serie = (porTipo[tipo] || []).map((r) => ({ dia: r.dia, valor: r.leituras }));
      const ult = serie.slice(-7), ini = serie.slice(0, 7);
      const media = (xs) => xs.reduce((a, x) => a + x.valor, 0) / Math.max(1, xs.length);
      return { tipo, nome: TIPO_EQ[tipo].nome, unidade: UNID[tipo], serie, variacao: ini.length ? media(ult) / media(ini) - 1 : 0 };
    });
    const ocDia = this.db.all(`SELECT tipo, CAST((inicio - ?) / ? AS INTEGER) AS d, COUNT(*) AS n FROM ocorrencias WHERE inicio >= ? AND exercicio = 0 GROUP BY tipo, d`, [de, DIA, de]);
    const ocorrenciasDia = [];
    for (let i = 0; i < 90; i++) {
      const linha = { dia: de + i * DIA };
      for (const t of TIPOS_OCORRENCIA) linha[t.id] = (ocDia.find((r) => r.tipo === t.id && r.d === i) || { n: 0 }).n;
      ocorrenciasDia.push(linha);
    }
    // Mudança de padrão por bairro: últimos 14 dias contra o mesmo intervalo de 4 a 8 semanas atrás.
    // Só reportamos o que é estatisticamente improvável de ser acaso (teste de Poisson, p < 0,4%,
    // rigoroso porque testamos ~120 combinações bairro × tipo ao mesmo tempo).
    const recentes = this.db.all('SELECT bairro_id, tipo, COUNT(*) AS n FROM ocorrencias WHERE inicio >= ? AND exercicio = 0 GROUP BY bairro_id, tipo', [agora - 14 * DIA]);
    const antigas = this.db.all('SELECT bairro_id, tipo, COUNT(*) AS n FROM ocorrencias WHERE inicio >= ? AND inicio < ? AND exercicio = 0 GROUP BY bairro_id, tipo', [agora - 56 * DIA, agora - 28 * DIA]);
    const tendBairros = [];
    for (const b of this.bairros) {
      for (const t of TIPOS_OCORRENCIA) {
        if (t.id === 'alagamento' || t.id === 'estacionamento_irregular') continue;
        const obs = (recentes.find((r) => r.bairro_id === b.id && r.tipo === t.id) || { n: 0 }).n;
        const esp = (antigas.find((r) => r.bairro_id === b.id && r.tipo === t.id) || { n: 0 }).n / 2;
        if (esp < 3 && obs < 6) continue;
        const sobe = obs > esp;
        const p = sobe ? poissonCaudaSuperior(obs, esp) : poissonCaudaInferior(obs, esp);
        const fator = (obs + 2) / (esp + 2);
        if (p < 0.004 && Math.abs(Math.log(fator)) > 0.2) tendBairros.push({ bairro_id: b.id, bairro: b.nome, tipo: t.id, nome: t.nome, fator: +fator.toFixed(2), ocorrencias14d: obs, esperado14d: +esp.toFixed(1), p: +p.toFixed(4) });
      }
    }
    tendBairros.sort((a, b) => a.p - b.p);
    const v = { disponibilidade: dispGeral, porTipo: resumoTipo, uso, ocorrenciasDia, tendenciasBairro: tendBairros.slice(0, 8), marcas: this.manutencao().marcas };
    this.cache[chave] = v;
    return v;
  }
}

module.exports = { Motor, RELEVANTES };
