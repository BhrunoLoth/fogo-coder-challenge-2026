import { useEffect, useState } from 'react';
import { api } from '../api';
import { Carregando, Kpi } from '../componentes/ui';
import { useApp } from '../contexto';
import { Icone } from '../icones';
import { classe, dataHora, hora, horaMin, num, pct } from '../util';

const ACOES: Record<string, string> = {
  carga_inicial: 'Carga inicial da cidade', criar: 'Cadastrou', editar: 'Editou', excluir: 'Excluiu', mudanca_situacao: 'Mudou situação',
  manutencao: 'Registrou manutenção', aprovar_reforco: 'Aprovou reforço', descartar_reforco: 'Descartou recomendação',
  reconhecer_alerta: 'Reconheceu alerta', exercicio: 'Iniciou exercício',
};

export default function Registro() {
  const [aba, setAba] = useState<'turno' | 'auditoria'>('turno');
  return (
    <div className="pagina">
      <div className="abas">
        <button className={classe(aba === 'turno' && 'ativo')} onClick={() => setAba('turno')}><Icone nome="relogio" tamanho={15} />Passagem de turno</button>
        <button className={classe(aba === 'auditoria' && 'ativo')} onClick={() => setAba('auditoria')}><Icone nome="registro" tamanho={15} />Trilha de auditoria</button>
      </div>
      {aba === 'turno' ? <Turno /> : <Auditoria />}
    </div>
  );
}

function Turno() {
  const { nomeOc, bairro, situacao } = useApp();
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get('/api/relatorio-turno').then(setD); }, []);
  if (!d) return <Carregando />;
  const total = d.porTipo.reduce((s: number, x: any) => s + x.n, 0);
  return (
    <div className="coluna" style={{ gap: 16 }}>
      <div className="linha entre">
        <div><h2 style={{ fontSize: 20 }}>Relatório de passagem de turno</h2><div className="suave">Gerado automaticamente · últimas 8 horas ({horaMin(d.de)} – {horaMin(d.ate)})</div></div>
        <button className="btn" onClick={() => window.print()}>Imprimir</button>
      </div>
      <div className="grade g4">
        <Kpi rotulo="Ocorrências no turno" valor={total} detalhe={`${d.kpis.ocorrencias_abertas} ainda abertas`} />
        <Kpi rotulo="Disponibilidade agora" valor={pct(d.kpis.disponibilidade)} detalhe={`${d.kpis.indisponiveis} indisponíveis · ${d.kpis.sem_sinal} sem sinal`} />
        <Kpi rotulo="Agentes em atividade" valor={d.kpis.agentes_ativos} detalhe={`${d.kpis.agentes_em_ocorrencia} em ocorrência`} />
        <Kpi rotulo="Decisões registradas" valor={d.decisoes.length} detalhe="aprovações, descartes, alertas, manutenções" />
      </div>
      <div className="grade g3">
        <div className="painel"><div className="cab"><h3>O que aconteceu</h3></div><div className="corpo">
          {d.porTipo.map((x: any) => <div key={x.tipo} className="linha entre" style={{ padding: '5px 0', borderBottom: '1px solid #1d2026' }}><span>{nomeOc(x.tipo)}</span><b className="mono">{x.n}</b></div>)}
          <div className="rotulo" style={{ margin: '14px 0 6px' }}>Bairros mais demandados</div>
          {d.porBairro.map((x: any) => <div key={x.nome} className="linha entre" style={{ padding: '4px 0' }}><span>{x.nome}</span><span className="mono suave">{x.n}</span></div>)}
        </div></div>
        <div className="painel"><div className="cab"><h3>Equipamentos que mudaram</h3></div><div className="corpo">
          {!d.mudancas.length && <div className="fraco">Nenhuma mudança de situação no turno.</div>}
          {d.mudancas.slice(0, 12).map((m: any) => <div key={m.id} style={{ padding: '5px 0', borderBottom: '1px solid #1d2026', fontSize: 13 }}>
            <span className="mono fraco">{horaMin(m.ts)}</span> · <b className="mono">{m.serie}</b> → <span style={{ color: situacao(m.para)?.cor }}>{situacao(m.para)?.nome}</span><div className="fraco" style={{ fontSize: 12 }}>{m.motivo}</div></div>)}
        </div></div>
        <div className="painel"><div className="cab"><h3>Para o próximo turno ficar de olho</h3></div><div className="corpo">
          {d.eventos.map((e: any) => <div key={e.id} className="destaque" style={{ marginBottom: 10, padding: 12 }}><b>{e.nome}</b><div className="suave" style={{ fontSize: 12.5 }}>{dataHora(e.inicio)} · {e.local}</div></div>)}
          {d.proximas8h.map((h: any, i: number) => <div key={i} className="linha entre" style={{ padding: '6px 0', borderBottom: '1px solid #1d2026' }}><span>{bairro(h.bairro_id)?.nome} <span className="fraco">às {hora(h.hora)}</span></span><span className="selo risco" style={{ background: h.risco >= 75 ? '#ff3d2e' : h.risco >= 50 ? '#ff7a1a' : '#f2b33d' }}>{h.risco}</span></div>)}
        </div></div>
      </div>
      <div className="painel"><div className="cab"><h3>Decisões humanas do turno</h3></div><div className="corpo">
        {!d.decisoes.length && <div className="fraco">Nenhuma decisão registrada ainda neste turno.</div>}
        {d.decisoes.map((a: any) => <div key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid #1d2026', fontSize: 13 }}><span className="mono fraco">{horaMin(a.ts)}</span> · <b>{a.ator}</b> {ACOES[a.acao] || a.acao} <span className="suave">{resumo(a.detalhes)}</span></div>)}
      </div></div>
    </div>
  );
}

function resumo(d: any) {
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return d; } }
  if (!d) return '';
  if (d.para && d.agente) return `${d.agente} → ${d.para}`;
  if (d.titulo) return d.titulo;
  if (d.tipo && d.bairro) return `${d.tipo} em ${d.bairro}`;
  if (d.serie) return d.serie;
  if (d.de && d.para) return `${d.de} → ${d.para}${d.motivo ? ` (${d.motivo})` : ''}`;
  if (d.campos) return `campos: ${d.campos.join(', ')}`;
  if (d.nome) return d.nome;
  if (d.tipo) return d.tipo;
  return '';
}

function Auditoria() {
  const [xs, setXs] = useState<any[] | null>(null);
  const [filtro, setFiltro] = useState('');
  useEffect(() => { api.get<any[]>('/api/auditoria?limite=400').then(setXs); }, []);
  if (!xs) return <Carregando />;
  const lista = xs.filter((a) => !filtro || a.acao === filtro);
  return (
    <div className="painel">
      <div className="cab"><h3>Quem fez o quê, e quando</h3><span className="suave" style={{ fontSize: 12.5 }}>toda alteração e toda decisão sobre recomendações fica registrada</span>
        <div className="dir"><select className="inp" style={{ width: 230, height: 32 }} value={filtro} onChange={(e) => setFiltro(e.target.value)}><option value="">Todas as ações</option>{Object.entries(ACOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div></div>
      <div className="corpo" style={{ maxHeight: 'calc(100vh - 230px)', overflow: 'auto' }}>
        <table className="tabela"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Entidade</th><th>Detalhes</th></tr></thead>
          <tbody>{lista.map((a) => <tr key={a.id}><td className="mono">{dataHora(a.ts)}</td><td>{a.ator}</td><td>{ACOES[a.acao] || a.acao}</td><td className="suave">{a.entidade}{a.entidade_id ? ` #${a.entidade_id}` : ''}</td><td className="suave" style={{ fontSize: 12.5 }}>{resumo(a.detalhes)}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
