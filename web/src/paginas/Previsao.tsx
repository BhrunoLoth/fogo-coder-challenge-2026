import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Explicacao, PainelFatores } from '../componentes/detalhes';
import { BarrasH, Calibracao, Linhas, Sparkline } from '../componentes/graficos';
import { Carregando, Kpi, SeloRisco } from '../componentes/ui';
import { useApp } from '../contexto';
import { Icone } from '../icones';
import type { Previsao as TPrev } from '../types';
import { classe, corRisco, data, dataCurta, diaSemana, hora, horaMin, mult, num, pct } from '../util';

type Aba = 'janela' | 'reforco' | 'manutencao' | 'anomalias' | 'prova' | 'tendencias';

export default function Previsao() {
  const { destino } = useApp();
  const [aba, setAba] = useState<Aba>('janela');
  useEffect(() => { if (destino?.pagina === 'previsao') setAba('janela'); }, [destino]);
  const abas: [Aba, string, string][] = [
    ['janela', 'Próximas 24 horas', 'previsao'], ['reforco', 'Reforço de agentes', 'agentes'], ['manutencao', 'Manutenção preditiva', 'chave'],
    ['anomalias', 'Anomalias ao vivo', 'ondas'], ['prova', 'Prova: o modelo acerta?', 'check'], ['tendencias', 'Tendências', 'previsao'],
  ];
  return (
    <div className="pagina">
      <div className="abas">{abas.map(([id, nome, ic]) => <button key={id} className={classe(aba === id && 'ativo')} onClick={() => setAba(id)}><Icone nome={ic} tamanho={15} />{nome}</button>)}</div>
      {aba === 'janela' && <Janela bairroInicial={destino?.pagina === 'previsao' ? destino.bairro : undefined} />}
      {aba === 'reforco' && <Reforco />}
      {aba === 'manutencao' && <Manutencao />}
      {aba === 'anomalias' && <Anomalias />}
      {aba === 'prova' && <Prova />}
      {aba === 'tendencias' && <Tendencias />}
    </div>
  );
}

// ------------------------------------------------------------------ 24 horas
function Janela({ bairroInicial }: { bairroInicial?: number }) {
  const { meta, bairro, nomeOc } = useApp();
  const [p, setP] = useState<TPrev | null>(null);
  const [sel, setSel] = useState<{ bairro: number; hora: number } | null>(null);
  useEffect(() => { api.get<TPrev>('/api/previsao?horas=24').then((d) => {
    setP(d);
    const alvo = bairroInicial ? d.matriz.find((m) => m.bairro_id === bairroInicial) : null;
    const h = alvo ? alvo.pico : d.hotspots[0];
    if (h) setSel({ bairro: alvo ? alvo.bairro_id : d.hotspots[0].bairro_id, hora: h.hora });
  }); }, [bairroInicial]);
  if (!p) return <Carregando texto="Calculando o futuro…" />;
  const linhas = p.matriz.slice().sort((a, b) => b.pico.risco - a.pico.risco);
  const horas = p.curva.map((c) => c.hora);
  const totalEsperado = p.curva.reduce((s, c) => s + c.esperado, 0);
  const pico = p.curva.reduce((a, b) => (b.esperado > a.esperado ? b : a));
  const chuvaTotal = p.curva.reduce((s, c) => s + c.chuva, 0);
  const tiposTotais = meta.tiposOcorrencia.map((t) => ({ rotulo: t.nome, valor: p.curva.reduce((s, c) => s + (c.porTipo[t.id] || 0), 0) })).sort((a, b) => b.valor - a.valor);
  const marcadores = [
    ...p.eventos.map((e) => ({ indice: Math.max(0, horas.findIndex((h) => h >= e.inicio - 3600e3)), texto: `⚑ ${e.nome.split(' (')[0]}` })),
    ...(chuvaTotal ? [{ indice: p.curva.findIndex((c) => c.chuva > 0), texto: '☂ chuva prevista', cor: '#4ea8ff' }] : []),
  ].filter((m) => m.indice >= 0);
  return (
    <div className="coluna" style={{ gap: 16 }}>
      <div className="grade g4">
        <Kpi rotulo="Ocorrências relevantes esperadas" valor={num(totalEsperado, 0)} detalhe="nas próximas 24h (exceto estacionamento)" />
        <Kpi rotulo="Hora mais crítica da cidade" valor={hora(pico.hora)} detalhe={`${num(pico.esperado, 1)} ocorrências esperadas na hora`} cor="var(--brasa2)" />
        <Kpi rotulo="Bairros com risco crítico" valor={linhas.filter((l) => l.pico.risco >= 75).length} detalhe={`de ${linhas.length} bairros em algum momento`} />
        <Kpi rotulo="Chuva prevista" valor={num(chuvaTotal, 1)} sufixo=" mm" detalhe={chuvaTotal ? `começa às ${hora(p.curva.find((c) => c.chuva > 0)!.hora)}` : 'tempo seco nas próximas 24h'} />
      </div>
      {p.eventos.length > 0 && <div className="destaque linha" style={{ gap: 14 }}><Icone nome="estadio" tamanho={26} cor="var(--brasa2)" />
        <div><b>{p.eventos.map((e) => `${e.nome} — ${e.local}`).join(' · ')}</b><div className="suave" style={{ fontSize: 13 }}>{p.eventos.map((e) => `Início ${dataCurta(e.inicio)} às ${horaMin(e.inicio)}, público estimado ${num(e.publico_estimado)} pessoas. O modelo aprendeu com eventos anteriores no local: ${Object.entries(p.modelo.efeitoEvento).filter(([, v]) => v > 1.1).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${(meta.tiposOcorrencia.find((t) => t.id === k)?.nome || k).toLowerCase()} ${mult(v)}`).join(', ') || 'efeito pequeno'}.`).join(' ')}</div></div></div>}

      <div className="grade g-21">
        <div className="painel">
          <div className="cab"><h3>Mapa de calor: bairro × hora</h3><span className="suave" style={{ fontSize: 12.5 }}>clique em uma célula para ver o porquê</span>
            <div className="dir legenda-risco"><span><i style={{ background: corRisco(10) }} />baixo</span><span><i style={{ background: corRisco(30) }} />moderado</span><span><i style={{ background: corRisco(60) }} />alto</span><span><i style={{ background: corRisco(90) }} />crítico</span></div></div>
          <div className="corpo" style={{ overflowX: 'auto' }}>
            <div className="matriz" style={{ gridTemplateColumns: `150px repeat(${horas.length}, minmax(18px, 1fr))`, minWidth: 640 }}>
              <div />
              {horas.map((h) => <div key={h} className="hora">{hora(h).replace('h', '')}</div>)}
              {linhas.map((l) => (<Fragment key={l.bairro_id}>
                <div className="nome" onClick={() => setSel({ bairro: l.bairro_id, hora: l.pico.hora })} title={bairro(l.bairro_id)?.nome}>{bairro(l.bairro_id)?.nome}</div>
                {l.serie.map((s) => {
                  const ev = p.eventos.some((e) => (e.bairro_id === l.bairro_id) && s.hora >= e.inicio - 2 * 3600e3 && s.hora <= e.fim + 3600e3);
                  return <div key={`${l.bairro_id}-${s.hora}`} className={classe('cel', ev && 'ev', sel && sel.bairro === l.bairro_id && sel.hora === s.hora && 'sel')}
                    style={{ background: corRisco(s.risco), opacity: 0.25 + (s.risco / 100) * 0.75 }}
                    title={`${bairro(l.bairro_id)?.nome} às ${hora(s.hora)} — risco ${s.risco} (${num(s.desvio, 2)}× o normal)`}
                    onClick={() => setSel({ bairro: l.bairro_id, hora: s.hora })} />;
                })}
              </Fragment>))}
            </div>
            <div className="fraco" style={{ fontSize: 11.5, marginTop: 8 }}>● = janela de evento programado. Bairros ordenados pelo pico de risco. Índice 0–100 em escala logarítmica do score esperado (peso da gravidade × ocorrências).</div>
          </div>
        </div>
        <div className="painel">
          <div className="cab"><h3>{sel ? `${bairro(sel.bairro)?.nome} · ${hora(sel.hora)}` : 'Explicação'}</h3></div>
          <div className="corpo">{sel ? <Explicacao bairroId={sel.bairro} horaTs={sel.hora} /> : <div className="fraco">Selecione uma célula.</div>}</div>
        </div>
      </div>

      <div className="grade g-21">
        <div className="painel">
          <div className="cab"><h3>Ocorrências esperadas por hora (cidade)</h3></div>
          <div className="corpo">
            <Linhas rotulos={horas.map(hora)} marcadores={marcadores} formatoY={(v) => num(v, 1)}
              series={[{ nome: 'Ocorrências relevantes esperadas', cor: 'var(--brasa)', valores: p.curva.map((c) => c.esperado), area: true },
                { nome: 'Acidentes', cor: '#ff3d2e', valores: p.curva.map((c) => c.porTipo.acidente) },
                { nome: 'Roubo / furto', cor: '#a78bfa', valores: p.curva.map((c) => c.porTipo.roubo_furto) },
                { nome: 'Chuva (mm/h ÷ 10)', cor: '#4ea8ff', valores: p.curva.map((c) => c.chuva / 10), tracejado: true }]} />
          </div>
        </div>
        <div className="painel">
          <div className="cab"><h3>Composição prevista (24h)</h3></div>
          <div className="corpo"><BarrasH itens={tiposTotais} formato={(v) => num(v, 0)} /></div>
        </div>
      </div>

      <div className="painel">
        <div className="cab"><h3>Pontos de atenção (onde e quando agir)</h3><span className="suave" style={{ fontSize: 12.5 }}>priorizados por risco e por quanto fogem do normal</span></div>
        <div className="corpo">
          <table className="tabela">
            <thead><tr><th>Bairro</th><th>Quando</th><th>Risco</th><th>Fora do normal</th><th>Principal causa</th><th>Fatores que mais pesaram</th></tr></thead>
            <tbody>{p.hotspots.slice(0, 10).map((h, i) => {
              const fat = h.fatores.filter((f) => !['horario', 'dia'].includes(f.id) && Math.abs(Math.log(f.mult)) > 0.05).sort((a, b) => Math.abs(Math.log(b.mult)) - Math.abs(Math.log(a.mult)));
              return (
                <tr key={i} className="clicavel" onClick={() => setSel({ bairro: h.bairro_id, hora: h.hora })}>
                  <td style={{ fontWeight: 500 }}>{bairro(h.bairro_id)?.nome}</td>
                  <td className="mono">{diaSemana(h.hora)} {hora(h.hora)}</td>
                  <td><SeloRisco risco={h.risco} comNome /></td>
                  <td className="mono" style={{ color: h.desvio > 1.2 ? 'var(--brasa2)' : undefined }}>{num(h.desvio, 2)}×</td>
                  <td>{h.tipos[0]?.nome} <span className="fraco">({pct(h.tipos[0]?.prob || 0, 0)})</span></td>
                  <td className="suave" style={{ fontSize: 12.5 }}>{fat.length ? fat.slice(0, 2).map((f) => `${f.nome} ${mult(f.mult)}`).join(' · ') : 'padrão habitual do horário'}</td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      </div>
      <div className="fraco" style={{ fontSize: 12 }}>Modelo treinado com {num(p.modelo.ocorrenciasUsadas)} ocorrências das últimas {p.modelo.semanas} semanas em {p.modelo.tempoTreinoMs} ms · retreinado a cada hora cheia · nenhuma API externa de IA.</div>
    </div>
  );
}

// ------------------------------------------------------------- reforço
type Mov = { agente_id: number; agente: string; matricula: string; tipoAgente: string; foco: string; de: { nome: string }; para: { bairro_id: number; nome: string }; km: number; minutos: number; ganho: number; motivo: string };
function Reforco() {
  const { meta, toast, bump } = useApp();
  const [d, setD] = useState<{ movimentos: Mov[]; agentesDisponiveis: number; geradoEm: number } | null>(null);
  const [feitos, setFeitos] = useState<Record<number, string>>({});
  const [enviando, setEnviando] = useState<number | null>(null);
  const carregar = () => api.get<any>('/api/despacho').then(setD);
  useEffect(() => { carregar(); }, []);
  if (!d) return <Carregando />;
  const decidir = async (m: Mov, aprovar: boolean) => {
    if (enviando !== null || feitos[m.agente_id]) return; // evita duplo clique
    setEnviando(m.agente_id);
    try {
      if (aprovar) await api.post('/api/despacho/aplicar', { agente_id: m.agente_id, bairro_id: m.para.bairro_id, motivo: m.motivo });
      else await api.post('/api/despacho/descartar', { agente_id: m.agente_id, bairro_id: m.para.bairro_id, justificativa: 'Descartado pelo operador' });
      setFeitos((f) => ({ ...f, [m.agente_id]: aprovar ? 'aprovado' : 'descartado' }));
      toast(aprovar ? `${m.agente} a caminho de ${m.para.nome}` : 'Recomendação descartada (registrado)', aprovar ? 'ok' : 'info');
      bump();
    } catch (e: any) { toast(e.message, 'erro'); } finally { setEnviando(null); }
  };
  return (
    <div className="grade g-21">
      <div className="painel">
        <div className="cab"><h3>Recomendações para as próximas 3 horas</h3><div className="dir"><span className="fraco" style={{ fontSize: 12 }}>{d.agentesDisponiveis} agentes livres considerados</span><button className="btn peq" onClick={carregar}>Recalcular</button></div></div>
        <div className="corpo coluna" style={{ gap: 10 }}>
          {!d.movimentos.length && <div className="vazio">A distribuição atual já está equilibrada com a demanda prevista. Nenhum deslocamento necessário.</div>}
          {d.movimentos.map((m) => (
            <div key={m.agente_id} className="painel" style={{ padding: 14, background: 'var(--painel2)', opacity: feitos[m.agente_id] ? 0.55 : 1 }}>
              <div className="linha entre" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="linha"><Icone nome={m.foco === 'transito' ? 'moto' : 'escudo'} cor="var(--brasa2)" />
                  <div><b>{m.agente}</b> <span className="mono fraco">{m.matricula}</span><div className="suave" style={{ fontSize: 12.5 }}>{meta.tiposAgente.find((t) => t.id === m.tipoAgente)?.nome}</div></div></div>
                <div className="linha" style={{ fontSize: 14 }}><span className="suave">{m.de.nome}</span><Icone nome="seta" tamanho={16} cor="var(--brasa)" /><b>{m.para.nome}</b><span className="selo mono">{num(m.km, 1)} km · ~{m.minutos} min</span></div>
              </div>
              <div style={{ fontSize: 13, marginTop: 8 }}>{m.motivo}</div>
              <div className="linha" style={{ marginTop: 10 }}>
                {feitos[m.agente_id] ? <span className={`selo ${feitos[m.agente_id] === 'aprovado' ? 'nivel-baixo' : 'nivel-info'}`}>{feitos[m.agente_id]}</span> : <>
                  <button className="btn ok peq" disabled={enviando !== null} onClick={() => decidir(m, true)}><Icone nome="check" tamanho={14} />{enviando === m.agente_id ? 'Enviando…' : 'Aprovar deslocamento'}</button>
                  <button className="btn peq fantasma" disabled={enviando !== null} onClick={() => decidir(m, false)}>Descartar</button></>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="painel">
        <div className="cab"><h3>Como a recomendação é feita</h3></div>
        <div className="corpo" style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--suave)' }}>
          <p><b style={{ color: 'var(--texto)' }}>1. Demanda prevista.</b> Para cada bairro, soma-se o risco esperado das próximas 3 horas, separado em <i>trânsito</i> (acidentes, congestionamento…) e <i>segurança</i> (roubo, perturbação…).</p>
          <p><b style={{ color: 'var(--texto)' }}>2. Distribuição ideal.</b> Os agentes livres são repartidos proporcionalmente à demanda pelo <b style={{ color: 'var(--brasa2)' }}>método de Hamilton</b> (maiores restos) — o mesmo usado para dividir cadeiras de um parlamento, sem "sumir" nem "criar" agentes no arredondamento.</p>
          <p><b style={{ color: 'var(--texto)' }}>3. Menor deslocamento.</b> Quem sobra numa região é ligado a quem falta em outra pelo <b style={{ color: 'var(--brasa2)' }}>algoritmo Húngaro</b>, que minimiza a distância total percorrida (Haversine).</p>
          <p><b style={{ color: 'var(--texto)' }}>4. Humano no comando.</b> Nada é aplicado sozinho: o gestor aprova ou descarta, e a decisão fica registrada na auditoria.</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------- manutenção
function Manutencao() {
  const { tipoEq, bairro, irPara } = useApp();
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get('/api/manutencao-preditiva').then(setD); }, []);
  if (!d) return <Carregando />;
  const modelos = Object.entries(d.modelos as Record<string, any>).sort((a, b) => a[1].mtbf - b[1].mtbf);
  const marcaPior = d.marcas.find((m: any) => m.significativo);
  return (
    <div className="coluna" style={{ gap: 16 }}>
      <div className="grade g3">
        <Kpi rotulo="Falhas esperadas (30 dias)" valor={num(d.falhasEsperadas30d, 0)} detalhe="soma das probabilidades de todos os equipamentos operacionais" />
        <Kpi rotulo="Alto risco de falha" valor={d.ranking.filter((r: any) => r.prob30 >= 0.2).length} detalhe="equipamentos com 20% ou mais de chance de falhar em 30 dias" cor="var(--brasa2)" />
        <Kpi rotulo="Marca problemática detectada" valor={marcaPior ? marcaPior.marca : 'nenhuma'} cor={marcaPior ? 'var(--perigo)' : undefined} detalhe={marcaPior ? `falha ${num(marcaPior.fator, 2)}× o esperado (${marcaPior.falhas} falhas × ${num(marcaPior.esperado, 0)} esperadas, p < 1%)` : 'nenhuma marca foge do esperado com significância'} />
      </div>
      <div className="grade g-21">
        <div className="painel">
          <div className="cab"><h3>Fila de manutenção preventiva sugerida</h3><span className="suave" style={{ fontSize: 12.5 }}>prioridade = probabilidade × criticidade × risco da região</span></div>
          <div className="corpo" style={{ maxHeight: 560, overflow: 'auto' }}>
            <table className="tabela">
              <thead><tr><th>Equipamento</th><th>Local</th><th className="num">Falha em 30d</th><th>Agendar até</th><th>Por quê</th></tr></thead>
              <tbody>{d.ranking.slice(0, 25).map((r: any) => (
                <tr key={r.equipamento_id} className="clicavel" onClick={() => irPara({ pagina: 'central', equipamento: r.equipamento_id })}>
                  <td><div style={{ fontWeight: 500 }}>{tipoEq(r.tipo).nome}</div><div className="mono fraco" style={{ fontSize: 12 }}>{r.serie} · {r.marca}</div></td>
                  <td>{bairro(r.bairro_id)?.nome}</td>
                  <td className="num" style={{ color: r.prob30 >= 0.2 ? 'var(--brasa)' : undefined, fontWeight: 600 }}>{pct(r.prob30, 0)}</td>
                  <td className="mono">{r.sugerirAte ? data(r.sugerirAte) : '—'}</td>
                  <td className="suave" style={{ fontSize: 12 }}>{r.motivos.slice(1).join(' · ') || r.motivos[0]}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </div>
        <div className="coluna" style={{ gap: 16 }}>
          <div className="painel">
            <div className="cab"><h3>Confiabilidade por marca</h3></div>
            <div className="corpo">
              <BarrasH itens={d.marcas.filter((m: any) => m.equipamentos >= 3).slice(0, 8).map((m: any) => ({ rotulo: m.marca, valor: m.fator, cor: m.significativo ? 'var(--perigo)' : m.fator < 0.85 ? 'var(--ok)' : 'var(--brasa2)' }))} formato={(v) => `${num(v, 2)}×`} />
              <div className="fraco" style={{ fontSize: 11.5, marginTop: 10 }}>Falhas observadas ÷ falhas esperadas pelo modelo do tipo. Em vermelho: excesso estatisticamente significativo (Poisson, p &lt; 1%). Útil para a próxima licitação.</div>
            </div>
          </div>
          <div className="painel">
            <div className="cab"><h3>Modelo de Weibull por tipo</h3></div>
            <div className="corpo" style={{ maxHeight: 300, overflow: 'auto' }}>
              <table className="tabela"><thead><tr><th>Tipo</th><th className="num">k</th><th className="num">MTBF</th></tr></thead>
                <tbody>{modelos.map(([t, m]) => <tr key={t}><td>{tipoEq(t).nome}</td><td className="num">{m.k}</td><td className="num">{m.mtbf} d</td></tr>)}</tbody></table>
              <div className="fraco" style={{ fontSize: 11.5, marginTop: 8 }}>k &gt; 1 indica desgaste (falha aumenta com o tempo), o que justifica manutenção preventiva. Ajustado por máxima verossimilhança com dados censurados.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ anomalias
function Anomalias() {
  const { bairro, irPara, situacao } = useApp();
  const [an, setAn] = useState<any[]>([]);
  const [fl, setFl] = useState<any[]>([]);
  useEffect(() => {
    const f = () => { api.get<any[]>('/api/anomalias').then(setAn); api.get<any[]>('/api/fluxos').then(setFl); };
    f(); const t = setInterval(f, 5000); return () => clearInterval(t);
  }, []);
  const ord = fl.slice().sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return (
    <div className="grade g2">
      <div className="painel">
        <div className="cab"><h3>Comportamentos fora do padrão (agora)</h3><span className="aovivo"><i />ao vivo</span></div>
        <div className="corpo coluna" style={{ gap: 10 }}>
          {!an.length && <div className="vazio">Nenhuma anomalia no momento. Dica: use o <b>modo exercício</b> na Central (acidente ou furto de câmera) e volte aqui.</div>}
          {an.map((a, i) => (
            <div key={i} className="painel" style={{ padding: 12, background: 'var(--painel2)', cursor: 'pointer' }} onClick={() => irPara({ pagina: 'central', lat: a.lat, lng: a.lng, equipamento: a.equipamento_id })}>
              <div className="linha entre"><b>{a.titulo}</b><span className={`selo ${a.gravidade === 'alta' ? 'nivel-critico' : 'nivel-alto'}`}>{a.tipo === 'sem_sinal' ? 'sem sinal' : a.tipo === 'fluxo' ? 'fluxo' : 'pico'}</span></div>
              <div className="suave" style={{ fontSize: 13, marginTop: 4 }}>{a.detalhe}</div>
              <div className="fraco" style={{ fontSize: 12, marginTop: 4 }}>{bairro(a.bairro_id)?.nome}</div>
            </div>
          ))}
          <div className="fraco" style={{ fontSize: 12, lineHeight: 1.6 }}>
            <b>Sem sinal:</b> equipamento marcado como operacional que não envia heartbeat há mais de 90 s (3 batidas perdidas).<br />
            <b>Fluxo:</b> radar comparado ao "pulso da cidade" — se ele cai e os outros não, há algo naquela via (z-score de Poisson nos últimos 5 min).<br />
            <b>Pico:</b> mais ocorrências nas últimas 3 h do que o modelo considera plausível (cauda de Poisson &lt; 0,2%, com pelo menos 4 ocorrências).
          </div>
        </div>
      </div>
      <div className="painel">
        <div className="cab"><h3>Telemetria dos radares</h3><span className="suave" style={{ fontSize: 12.5 }}>veículos/min, últimos 30 min</span></div>
        <div className="corpo" style={{ maxHeight: 640, overflow: 'auto' }}>
          <table className="tabela"><thead><tr><th>Radar</th><th>Bairro</th><th>Fluxo</th><th className="num">z</th></tr></thead>
            <tbody>{ord.map((f) => (
              <tr key={f.id} className="clicavel" onClick={() => irPara({ pagina: 'central', lat: f.lat, lng: f.lng, equipamento: f.id })}>
                <td className="mono">{f.serie}</td><td>{bairro(f.bairro_id)?.nome}</td>
                <td><Sparkline valores={f.ultimos} largura={140} altura={24} cor={Math.abs(f.z) >= 3.5 ? 'var(--perigo)' : 'var(--brasa)'} /></td>
                <td className="num" style={{ color: Math.abs(f.z) >= 3.5 ? 'var(--perigo)' : undefined }}>{num(f.z, 1)}</td>
              </tr>))}</tbody></table>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ prova
function Prova() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get('/api/backtest').then(setD); }, []);
  if (!d) return <Carregando texto="Treinando 7 modelos no passado e comparando com o que aconteceu…" />;
  const r = d.resumo;
  return (
    <div className="coluna" style={{ gap: 16 }}>
      <div className="destaque">
        <div className="rotulo" style={{ color: 'var(--brasa2)' }}>Como provamos que a previsão funciona</div>
        <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6 }}>Para cada um dos últimos 7 dias, o F.O.G.O. treina o modelo <b>só com o que aconteceu antes daquele dia</b>, prevê o dia hora a hora e compara com o que realmente ocorreu. Nenhuma previsão "vê" o futuro. E o motor nunca acessa os parâmetros do simulador: aprende apenas pelo histórico, como faria com dados reais. (Para o clima, usa-se a chuva observada no dia, já que previsões meteorológicas antigas não ficam guardadas.)</div>
      </div>
      <div className="grade g4">
        <Kpi rotulo="Pontos quentes acertados" valor={pct(r.taxaTop, 0)} detalhe={`dos 10% bairro-horas de maior risco tiveram ocorrência (média geral: ${pct(r.taxaGeral, 0)})`} cor="var(--brasa2)" />
        <Kpi rotulo="Ganho sobre o acaso" valor={`${num(r.lift, 1)}×`} detalhe="mais ocorrências onde o F.O.G.O. apontou do que numa escolha aleatória" />
        <Kpi rotulo="Ocorrências capturadas" valor={pct(r.capturadas, 0)} detalhe="das ocorrências do dia caíram nos 10% de bairro-horas apontados" />
        <Kpi rotulo="Contra a média histórica" valor={`${num(r.lift, 1)}× vs ${num(r.liftIngenuo, 1)}×`} detalhe="ganho do F.O.G.O. vs. apontar só os bairros mais movimentados" />
      </div>
      <div className="grade g-21">
        <div className="painel">
          <div className="cab"><h3>Ontem: previsto × aconteceu (cidade, por hora)</h3></div>
          <div className="corpo">
            <Linhas rotulos={d.curvaOntem.map((c: any) => hora(c.hora))} formatoY={(v) => num(v, 0)}
              series={[{ nome: 'Previsto pelo F.O.G.O. (treinado até anteontem)', cor: 'var(--brasa)', valores: d.curvaOntem.map((c: any) => c.previsto), area: true },
                { nome: 'Aconteceu', cor: '#ece8e1', valores: d.curvaOntem.map((c: any) => c.observado), tracejado: true }]} />
          </div>
        </div>
        <div className="painel">
          <div className="cab"><h3>Calibração</h3></div>
          <div className="corpo">
            <Calibracao pontos={d.calibracao} />
            <div className="fraco" style={{ fontSize: 12, marginTop: 6 }}>Quando o F.O.G.O. diz "20% de chance", acontece em cerca de 20% das vezes? Pontos sobre a diagonal = probabilidades honestas.</div>
          </div>
        </div>
      </div>
      <div className="painel">
        <div className="cab"><h3>Dia a dia</h3></div>
        <div className="corpo">
          <table className="tabela"><thead><tr><th>Dia</th><th className="num">Acerto nos pontos quentes</th><th className="num">Taxa geral</th><th className="num">Ganho sobre o acaso</th><th className="num">Ocorrências capturadas</th><th className="num">Média histórica (comparação)</th></tr></thead>
            <tbody>{d.dias.map((x: any) => <tr key={x.dia}><td>{diaSemana(x.dia + 12 * 3600e3)} {dataCurta(x.dia + 12 * 3600e3)}</td><td className="num">{pct(x.taxaTop, 0)}</td><td className="num">{pct(x.taxaGeral, 0)}</td><td className="num">{num(x.lift, 1)}×</td><td className="num">{pct(x.capturadas, 0)}</td><td className="num fraco">{num(x.liftIngenuo, 1)}×</td></tr>)}</tbody></table>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ tendências
function Tendencias() {
  const { meta } = useApp();
  const [d, setD] = useState<any>(null);
  const [tipoOc, setTipoOc] = useState('acidente');
  useEffect(() => { api.get('/api/tendencias').then(setD); }, []);
  const mm7 = useMemo(() => (xs: number[]) => xs.map((_, i) => { const j = xs.slice(Math.max(0, i - 6), i + 1); return j.reduce((s, x) => s + x, 0) / j.length; }), []);
  if (!d) return <Carregando />;
  const serieOc = d.ocorrenciasDia.map((x: any) => x[tipoOc]);
  return (
    <div className="coluna" style={{ gap: 16 }}>
      <div className="grade g2">
        <div className="painel">
          <div className="cab"><h3>Disponibilidade dos equipamentos (90 dias)</h3></div>
          <div className="corpo"><Linhas rotulos={d.disponibilidade.map((x: any) => dataCurta(x.dia + 12 * 3600e3))} formatoY={(v) => `${num(v, 1)}%`} minY={90} maxY={100}
            series={[{ nome: 'Disponibilidade média diária', cor: 'var(--ok)', valores: d.disponibilidade.map((x: any) => x.disponibilidade * 100), area: true }]} /></div>
        </div>
        <div className="painel">
          <div className="cab"><h3>Ocorrências por dia</h3><div className="dir"><select className="inp" style={{ height: 30, width: 220 }} value={tipoOc} onChange={(e) => setTipoOc(e.target.value)}>{meta.tiposOcorrencia.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</select></div></div>
          <div className="corpo"><Linhas rotulos={d.ocorrenciasDia.map((x: any) => dataCurta(x.dia + 12 * 3600e3))} formatoY={(v) => num(v, 0)}
            series={[{ nome: 'Por dia', cor: '#6c727d', valores: serieOc }, { nome: 'Média móvel de 7 dias', cor: 'var(--brasa)', valores: mm7(serieOc) }]} /></div>
        </div>
      </div>
      <div className="grade g3">
        <div className="painel">
          <div className="cab"><h3>Mudanças detectadas nos bairros</h3></div>
          <div className="corpo coluna" style={{ gap: 8 }}>
            {!d.tendenciasBairro.length && <div className="fraco">Nenhuma mudança estatisticamente relevante.</div>}
            {d.tendenciasBairro.map((t: any) => (
              <div key={t.bairro + t.tipo} className="linha entre" style={{ padding: '6px 0', borderBottom: '1px solid #1d2026' }}>
                <div><b>{t.bairro}</b><div className="suave" style={{ fontSize: 12.5 }}>{t.nome} · {t.ocorrencias14d} nos últimos 14 dias</div></div>
                <span className={`selo ${t.fator > 1 ? 'nivel-critico' : 'nivel-baixo'}`}>{t.fator > 1 ? '▲' : '▼'} {mult(t.fator)}</span>
              </div>))}
            <div className="fraco" style={{ fontSize: 11.5 }}>Últimos 14 dias comparados ao mesmo intervalo de 4 a 8 semanas atrás. Só aparece o que tem menos de 0,4% de chance de ser acaso (teste de Poisson).</div>
          </div>
        </div>
        <div className="painel">
          <div className="cab"><h3>Disponibilidade por tipo</h3><span className="suave" style={{ fontSize: 12 }}>7 dias vs. 30 anteriores</span></div>
          <div className="corpo coluna" style={{ gap: 6 }}>
            {d.porTipo.map((t: any) => (
              <div key={t.tipo} className="linha entre" style={{ fontSize: 13 }}>
                <span>{t.nome}</span><span className="mono">{pct(t.ultimos7, 1)} <span style={{ color: t.variacao < -0.005 ? 'var(--perigo)' : t.variacao > 0.005 ? 'var(--ok)' : 'var(--fraco)' }}>{Math.abs(t.variacao) < 0.0005 ? '±0,0' : `${t.variacao > 0 ? '+' : '−'}${num(Math.abs(t.variacao) * 100, 1)}`} p.p.</span></span>
              </div>))}
          </div>
        </div>
        <div className="painel">
          <div className="cab"><h3>Utilização</h3><span className="suave" style={{ fontSize: 12 }}>total da frota por dia · 90 dias</span></div>
          <div className="corpo coluna" style={{ gap: 14 }}>
            {d.uso.map((u: any) => (
              <div key={u.tipo}><div className="linha entre" style={{ fontSize: 13 }}><span>{u.nome}</span><span className="mono suave">{num(u.serie.at(-2)?.valor || 0)} {u.unidade} <span style={{ color: u.variacao > 0.05 ? 'var(--ok)' : u.variacao < -0.05 ? 'var(--perigo)' : 'var(--fraco)' }}>{u.variacao >= 0 ? '+' : '−'}{pct(Math.abs(u.variacao), 0)}</span></span></div>
                <Sparkline valores={u.serie.map((s: any) => s.valor)} largura={320} altura={34} /></div>))}
          </div>
        </div>
      </div>
    </div>
  );
}
