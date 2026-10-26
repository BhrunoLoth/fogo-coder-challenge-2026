import { useEffect, type ReactNode } from 'react';
import { Icone } from '../icones';
import { corRisco, nivelDe, nomeNivel } from '../util';

export function Gaveta({ titulo, sub, onFechar, children, rodape, larga, icone }: { titulo: ReactNode; sub?: ReactNode; onFechar: () => void; children: ReactNode; rodape?: ReactNode; larga?: boolean; icone?: ReactNode }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onFechar]);
  return (
    <>
      <div className="veu" onClick={onFechar} />
      <aside className={`gaveta${larga ? ' larga' : ''}`} role="dialog" aria-label={typeof titulo === 'string' ? titulo : undefined}>
        <div className="cab">
          {icone}
          <div style={{ minWidth: 0 }}>
            <h2>{titulo}</h2>
            {sub && <div className="suave" style={{ fontSize: 12.5, marginTop: 2 }}>{sub}</div>}
          </div>
          <button className="btn icone fantasma" style={{ marginLeft: 'auto' }} onClick={onFechar} aria-label="Fechar"><Icone nome="fechar" /></button>
        </div>
        <div className="corpo">{children}</div>
        {rodape && <div className="rodape">{rodape}</div>}
      </aside>
    </>
  );
}

export function Modal({ onFechar, children }: { onFechar: () => void; children: ReactNode }) {
  return (<><div className="veu" onClick={onFechar} /><div className="modal">{children}</div></>);
}

export function SeloSituacao({ cor, nome }: { cor: string; nome: string }) {
  return <span className="selo" style={{ color: cor, background: `color-mix(in srgb, ${cor} 14%, transparent)` }}><i />{nome}</span>;
}

export function SeloRisco({ risco, comNome = false }: { risco: number; comNome?: boolean }) {
  return <span className="selo risco" style={{ background: corRisco(risco) }}>{risco}{comNome ? ` · ${nomeNivel[nivelDe(risco)]}` : ''}</span>;
}

export function Kpi({ rotulo, valor, sufixo, detalhe, barra, cor }: { rotulo: string; valor: ReactNode; sufixo?: string; detalhe?: ReactNode; barra?: number; cor?: string }) {
  return (
    <div className="painel kpi">
      <span className="rotulo">{rotulo}</span>
      <span className="v" style={cor ? { color: cor } : undefined}>{valor}{sufixo && <small>{sufixo}</small>}</span>
      {detalhe && <span className="d">{detalhe}</span>}
      {barra !== undefined && <div className="barra"><i style={{ width: `${Math.max(0, Math.min(1, barra)) * 100}%` }} /></div>}
    </div>
  );
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return <div className="vazio"><span className="mono">{texto}</span></div>;
}
