import { useCallback, useEffect, useState } from 'react';
import { api, definirOperador, operador } from './api';
import { Modal } from './componentes/ui';
import { Provedor, useApp } from './contexto';
import { Icone } from './icones';
import Agentes from './paginas/Agentes';
import Central from './paginas/Central';
import Inventario from './paginas/Inventario';
import Manifesto from './paginas/Manifesto';
import Previsao from './paginas/Previsao';
import Registro from './paginas/Registro';
import type { Meta } from './types';
import { classe } from './util';

const PAGINAS: { id: string; nome: string; icone: string; titulo: string; sub: string }[] = [
  { id: 'central', nome: 'Central', icone: 'central', titulo: 'Central de Operações', sub: 'O que está acontecendo em Marília agora' },
  { id: 'previsao', nome: 'Preditiva', icone: 'previsao', titulo: 'Cidade Preditiva', sub: 'O que pode acontecer — e por quê' },
  { id: 'inventario', nome: 'Inventário', icone: 'inventario', titulo: 'Inventário Inteligente', sub: 'Equipamentos de segurança e trânsito' },
  { id: 'agentes', nome: 'Agentes', icone: 'agentes', titulo: 'Agentes', sub: 'Trânsito, Guarda Municipal e Polícia Militar' },
  { id: 'registro', nome: 'Registro', icone: 'registro', titulo: 'Registro', sub: 'Passagem de turno e auditoria' },
  { id: 'manifesto', nome: 'Como funciona', icone: 'fogo', titulo: 'Como funciona', sub: 'O manifesto e a engenharia do F.O.G.O.' },
];

function lerHash() { const h = location.hash.replace('#/', ''); return PAGINAS.some((p) => p.id === h) ? h : 'central'; }

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [erro, setErro] = useState('');
  const [pagina, setPagina] = useState(lerHash());
  // Navegação pelo hash: o botão Voltar do navegador funciona entre as telas.
  const navegar = useCallback((p: string) => { setPagina(p); if (location.hash !== `#/${p}`) location.hash = `#/${p}`; }, []);
  useEffect(() => {
    const f = () => setPagina(lerHash());
    window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f);
  }, []);
  useEffect(() => { api.get<Meta>('/api/meta').then(setMeta).catch((e) => setErro(e.message)); }, []);
  if (erro) return <div className="vazio" style={{ paddingTop: 120 }}>Não foi possível falar com o servidor do F.O.G.O.: {erro}<br />Verifique se o comando <code>npm start</code> está rodando.</div>;
  if (!meta) return <div className="vazio" style={{ paddingTop: 160 }}><Icone nome="fogo" tamanho={42} cor="var(--brasa)" /><div className="mono" style={{ marginTop: 12 }}>Acendendo o F.O.G.O.…</div></div>;
  return <Provedor meta={meta} onNavegar={navegar}><Casca pagina={pagina} navegar={navegar} /></Provedor>;
}

function Casca({ pagina, navegar }: { pagina: string; navegar: (p: string) => void }) {
  const { conectado, alertas } = useApp();
  const [telao, setTelao] = useState(false);
  const [agora, setAgora] = useState(Date.now());
  const [editOp, setEditOp] = useState(false);
  const [nomeOp, setNomeOp] = useState(operador());
  const [boasVindas, setBoasVindas] = useState(() => { try { return !localStorage.getItem('fogo.visto'); } catch { return true; } });
  const fecharBoasVindas = (destino?: string) => { try { localStorage.setItem('fogo.visto', '1'); } catch { /* ok */ } setBoasVindas(false); if (destino) navegar(destino); };
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const alternarTelao = useCallback(() => {
    setTelao((t) => {
      const n = !t;
      try { if (n) document.documentElement.requestFullscreen?.(); else if (document.fullscreenElement) document.exitFullscreen(); } catch { /* ok */ }
      return n;
    });
  }, []);
  const p = PAGINAS.find((x) => x.id === pagina)!;
  const naoLidos = alertas.filter((a) => !a.reconhecido && (a.nivel === 'critico' || a.nivel === 'alto')).length;
  const local = new Date(agora - 3 * 3600e3);
  const relogio = `${local.toISOString().slice(11, 19)}`;
  return (
    <div className={classe('app', telao && 'telao')}>
      <nav className="rail" aria-label="Navegação principal">
        <div className="logo" title="F.O.G.O."><Icone nome="fogo" tamanho={30} cor="var(--brasa)" traco={1.7} /></div>
        {PAGINAS.map((x) => (
          <button key={x.id} className={classe(pagina === x.id && 'ativo')} onClick={() => navegar(x.id)} aria-current={pagina === x.id ? 'page' : undefined}>
            <Icone nome={x.icone} tamanho={21} />{x.nome}
            {x.id === 'central' && naoLidos > 0 && <span style={{ position: 'absolute', top: 6, right: 12, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--brasa)', color: '#1a0a00', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 4px' }}>{naoLidos}</span>}
          </button>
        ))}
        <div className="espaco" />
        <button onClick={alternarTelao} title="Modo telão (T)"><Icone nome="tela" tamanho={20} />Telão</button>
      </nav>
      <div className="conteudo">
        <header className="topo">
          <div><h1>{p.titulo}</h1><div className="sub">{p.sub}</div></div>
          <div className="dir">
            <span className={classe('aovivo', !conectado && 'off')}><i />{conectado ? 'Ao vivo' : 'Reconectando'}</span>
            <span className="relogio" title="Horário de Marília">Marília · {relogio}</span>
            <button className="chip-op" onClick={() => setEditOp(true)} title="Nome usado na auditoria"><b>{nomeOp.slice(0, 2).toUpperCase()}</b>{nomeOp}</button>
          </div>
        </header>
        {pagina === 'central' && <Central telao={telao} alternarTelao={alternarTelao} />}
        {pagina === 'previsao' && <Previsao />}
        {pagina === 'inventario' && <Inventario />}
        {pagina === 'agentes' && <Agentes />}
        {pagina === 'registro' && <Registro />}
        {pagina === 'manifesto' && <Manifesto />}
        {pagina !== 'central' && <div className="aviso-sim">Dados simulados para demonstração. Geografia real de Marília/SP (OpenStreetMap). Perfis de ocorrência dos bairros são fictícios.</div>}
      </div>
      {boasVindas && <Modal onFechar={() => fecharBoasVindas()}>
        <div className="linha" style={{ gap: 12, marginBottom: 10 }}><Icone nome="fogo" tamanho={34} cor="var(--brasa)" /><div><h2 style={{ fontSize: 21 }}>Bem-vindo ao F.O.G.O.</h2><div className="suave" style={{ fontSize: 13 }}>Central de Operações de Marília · dados simulados ao vivo</div></div></div>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#d9d5ce', margin: '6px 0 12px' }}>Uma cidade que pensa à frente, sem caixa-preta: toda previsão mostra o porquê, e toda recomendação espera a sua aprovação. Experimente nesta ordem:</p>
        <ol style={{ fontSize: 13.5, lineHeight: 1.7, paddingLeft: 20, margin: 0, color: 'var(--suave)' }}>
          <li><b style={{ color: 'var(--texto)' }}>Máquina do tempo</b>, na Central: veja de 24 h atrás até 24 h à frente.</li>
          <li><b style={{ color: 'var(--texto)' }}>Modo exercício</b>: injete um acidente ou o furto de uma câmera e veja o sistema reagir.</li>
          <li><b style={{ color: 'var(--texto)' }}>Cidade preditiva</b>: clique numa célula do mapa de calor para ver o porquê do risco.</li>
          <li><b style={{ color: 'var(--texto)' }}>Prova</b>: o quanto o modelo acertou nos últimos 7 dias.</li>
        </ol>
        <div className="linha" style={{ justifyContent: 'flex-end', marginTop: 18, gap: 8 }}>
          <button className="btn" onClick={() => fecharBoasVindas('manifesto')}>Como funciona</button>
          <button className="btn prim" onClick={() => fecharBoasVindas('central')}><Icone nome="central" />Abrir a Central</button>
        </div>
      </Modal>}
      {editOp && <Modal onFechar={() => setEditOp(false)}>
        <h3 style={{ marginBottom: 6 }}>Quem está operando?</h3>
        <div className="suave" style={{ fontSize: 13, marginBottom: 12 }}>O nome aparece na trilha de auditoria de cada alteração e decisão.</div>
        <input className="inp" autoFocus value={nomeOp} onChange={(e) => setNomeOp(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { definirOperador(nomeOp || 'Operador'); setEditOp(false); } }} />
        <div className="linha" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button className="btn prim" onClick={() => { definirOperador(nomeOp || 'Operador'); setEditOp(false); }}>Salvar</button></div>
      </Modal>}
    </div>
  );
}
