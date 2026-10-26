import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Alerta, EstadoVivo, Meta } from './types';

type Toast = { id: number; texto: string; tipo: 'ok' | 'erro' | 'info' | 'fogo' };
type Ctx = {
  meta: Meta;
  vivo: EstadoVivo | null;
  conectado: boolean;
  alertas: Alerta[];
  reconhecer: (id: number) => Promise<void>;
  versao: number; // muda quando equipamentos/agentes são alterados (para recarregar listas)
  bump: () => void;
  toast: (texto: string, tipo?: Toast['tipo']) => void;
  tipoEq: (id: string) => Meta['tiposEquipamento'][number];
  situacao: (id: string) => Meta['situacoes'][number];
  bairro: (id: number | null | undefined) => Meta['bairros'][number] | undefined;
  nomeOc: (id: string) => string;
  irPara: (destino: Destino) => void;
  destino: Destino | null;
};
export type Destino = { pagina: string; lat?: number; lng?: number; equipamento?: number; agente?: number; bairro?: number; ts?: number };

const Contexto = createContext<Ctx | null>(null);
export const useApp = () => useContext(Contexto)!;

export function Provedor({ meta, children, onNavegar }: { meta: Meta; children: ReactNode; onNavegar: (p: string) => void }) {
  const [vivo, setVivo] = useState<EstadoVivo | null>(null);
  const [conectado, setConectado] = useState(false);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [versao, setVersao] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [destino, setDestino] = useState<Destino | null>(null);
  const seq = useRef(1);

  const toast = useCallback((texto: string, tipo: Toast['tipo'] = 'info') => {
    const id = seq.current++;
    setToasts((t) => [...t.slice(-3), { id, texto, tipo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tipo === 'erro' ? 7000 : 5000);
  }, []);

  useEffect(() => {
    api.get<Alerta[]>('/api/alertas').then(setAlertas).catch(() => {});
    const es = new EventSource('/api/stream');
    es.addEventListener('open', () => setConectado(true));
    es.addEventListener('error', () => setConectado(false));
    es.addEventListener('tick', (e) => {
      const d = JSON.parse((e as MessageEvent).data) as EstadoVivo;
      setVivo(d); setConectado(true);
      if (d.equipamentosAlterados.length) setVersao((v) => v + 1);
    });
    es.addEventListener('alerta', (e) => {
      const a = JSON.parse((e as MessageEvent).data) as Alerta;
      setAlertas((xs) => [a, ...xs.filter((x) => x.id !== a.id)].slice(0, 120));
      if (a.nivel === 'critico') toast(`⚠ ${a.titulo}`, 'fogo');
    });
    es.addEventListener('equipamento', () => setVersao((v) => v + 1));
    return () => es.close();
  }, [toast]);

  const reconhecer = useCallback(async (id: number) => {
    await api.post(`/api/alertas/${id}/reconhecer`);
    setAlertas((xs) => xs.map((a) => (a.id === id ? { ...a, reconhecido: true } : a)));
  }, []);

  const valor = useMemo<Ctx>(() => {
    const tipos = Object.fromEntries(meta.tiposEquipamento.map((t) => [t.id, t]));
    const sits = Object.fromEntries(meta.situacoes.map((s) => [s.id, s]));
    const bairros = Object.fromEntries(meta.bairros.map((b) => [b.id, b]));
    const ocs = Object.fromEntries(meta.tiposOcorrencia.map((o) => [o.id, o.nome]));
    return {
      meta, vivo, conectado, alertas, reconhecer, versao, bump: () => setVersao((v) => v + 1), toast,
      tipoEq: (id) => tipos[id], situacao: (id) => sits[id], bairro: (id) => (id ? bairros[id] : undefined), nomeOc: (id) => ocs[id] || id,
      irPara: (d) => { setDestino({ ...d, ts: Date.now() }); onNavegar(d.pagina); }, destino,
    };
  }, [meta, vivo, conectado, alertas, reconhecer, versao, toast, onNavegar, destino]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tipo}`}>{t.texto}</div>)}
      </div>
    </Contexto.Provider>
  );
}
