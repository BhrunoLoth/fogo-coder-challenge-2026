import { useEffect, useMemo, useState } from 'react';
import { api, ErroApi } from '../api';
import { AgenteDetalhe } from '../componentes/detalhes';
import { Gaveta, Kpi } from '../componentes/ui';
import { useApp } from '../contexto';
import { Icone } from '../icones';
import type { Agente, Equipamento } from '../types';
import { classe } from '../util';

export default function Agentes() {
  const { meta, versao, vivo, bump } = useApp();
  const [lista, setLista] = useState<Agente[]>([]);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [status, setStatus] = useState('');
  const [ver, setVer] = useState<number | null>(null);
  const [editar, setEditar] = useState<Partial<Agente> | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { api.get<Agente[]>('/api/agentes').then(setLista); }, [versao, tick]);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 15000); return () => clearInterval(t); }, []);
  const statusVivo = useMemo(() => new Map((vivo?.agentes || []).map((a) => [a.id, a.status])), [vivo]);
  const st = (a: Agente) => statusVivo.get(a.id) || a.status;

  const filtrada = lista.filter((a) => (!tipo || a.tipo === tipo) && (!status || st(a) === status)
    && (!busca || `${a.nome} ${a.matricula} ${a.bairro}`.toLowerCase().includes(busca.toLowerCase())));
  const ativos = lista.filter((a) => meta.statusAgente.find((s) => s.id === st(a))?.ativo);

  return (
    <div className="pagina">
      <div className="grade" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Kpi rotulo="Agentes cadastrados" valor={lista.length} detalhe="trânsito, guarda municipal e polícia" />
        <Kpi rotulo="Em atividade agora" valor={ativos.length} detalhe={`${lista.filter((a) => st(a) === 'ocorrencia').length} atendendo ocorrência`} cor="var(--ok)" />
        {meta.tiposAgente.map((t) => <Kpi key={t.id} rotulo={({ agente_transito: 'Agentes de trânsito', guarda_municipal: 'Guardas municipais', policial_militar: 'Policiais militares' } as Record<string, string>)[t.id] || t.nome} valor={lista.filter((a) => a.tipo === t.id).length} detalhe={`${ativos.filter((a) => a.tipo === t.id).length} em atividade`} />)}
      </div>
      <div className="painel">
        <div className="cab" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input className="inp" style={{ flex: '1 1 240px' }} placeholder="Buscar por nome, matrícula ou bairro…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <select className="inp" style={{ width: 200 }} value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos os tipos</option>{meta.tiposAgente.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</select>
          <select className="inp" style={{ width: 210 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos os status</option>{meta.statusAgente.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>
          <div className="dir"><button className="btn prim" onClick={() => setEditar({ tipo: 'agente_transito', turno: 'manha', status: 'fora_turno', bairro_id: meta.bairros[0].id })}><Icone nome="mais" />Novo agente</button></div>
        </div>
        <div style={{ maxHeight: 'calc(100vh - 290px)', overflow: 'auto' }}>
          <table className="tabela">
            <thead><tr><th>Nome</th><th>Matrícula</th><th>Tipo</th><th>Turno</th><th>Bairro de atuação</th><th>Status</th><th>Veículo</th><th></th></tr></thead>
            <tbody>{filtrada.map((a) => {
              const s = meta.statusAgente.find((x) => x.id === st(a))!;
              return (
                <tr key={a.id} className="clicavel" onClick={() => setVer(a.id)}>
                  <td style={{ fontWeight: 500 }}>{a.nome}</td><td className="mono">{a.matricula}</td>
                  <td>{meta.tiposAgente.find((t) => t.id === a.tipo)?.nome}</td>
                  <td className="suave">{meta.turnos.find((t) => t.id === a.turno)?.nome}</td>
                  <td>{a.bairro}</td>
                  <td><span className="selo" style={{ color: s.cor, background: `color-mix(in srgb, ${s.cor} 14%, transparent)` }}><i />{s.nome}</span></td>
                  <td className="mono suave">{a.veiculo_serie || '—'}</td>
                  <td><button className="btn peq fantasma" onClick={(e) => { e.stopPropagation(); setEditar(a); }}><Icone nome="editar" tamanho={14} /></button></td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      </div>
      {ver && <AgenteDetalhe id={ver} onFechar={() => setVer(null)} />}
      {editar && <FormAgente inicial={editar} onFechar={() => setEditar(null)} onSalvo={() => { setEditar(null); bump(); }} />}
    </div>
  );
}

function FormAgente({ inicial, onFechar, onSalvo }: { inicial: Partial<Agente>; onFechar: () => void; onSalvo: () => void }) {
  const { meta, toast } = useApp();
  const [f, setF] = useState<any>({ ...inicial });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [frota, setFrota] = useState<Equipamento[]>([]);
  const novo = !inicial.id;
  useEffect(() => { api.get<Equipamento[]>('/api/equipamentos?tipo=moto_agente,viatura_gcm,viatura_pm').then(setFrota); }, []);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const salvar = async () => {
    try {
      if (novo) await api.post('/api/agentes', f); else await api.put(`/api/agentes/${inicial.id}`, f);
      toast(novo ? 'Agente cadastrado' : 'Alterações salvas', 'ok'); onSalvo();
    } catch (e) { if (e instanceof ErroApi && e.erros) { setErros(e.erros); toast('Revise os campos destacados', 'erro'); } else toast((e as Error).message, 'erro'); }
  };
  const excluir = async () => { if (!confirm(`Excluir ${inicial.nome}?`)) return; await api.del(`/api/agentes/${inicial.id}`); toast('Agente excluído', 'ok'); onSalvo(); };
  const campo = (k: string, rotulo: string, el: React.ReactNode) => <div className="campo"><label>{rotulo}</label>{el}{erros[k] && <span className="erro">{erros[k]}</span>}</div>;
  return (
    <Gaveta onFechar={onFechar} titulo={novo ? 'Novo agente' : `Editar ${inicial.nome}`} sub="Agentes de trânsito, guardas municipais e policiais fazem parte da visão integrada"
      rodape={<>{!novo && <button className="btn perigo" style={{ marginRight: 'auto' }} onClick={excluir}><Icone nome="lixo" />Excluir</button>}<button className="btn" onClick={onFechar}>Cancelar</button><button className="btn prim" onClick={salvar}><Icone nome="check" />Salvar</button></>}>
      <div className="grade g2">
        {campo('nome', 'Nome completo *', <input className={classe('inp', erros.nome && 'invalido')} value={f.nome || ''} onChange={(e) => set('nome', e.target.value)} />)}
        {campo('matricula', 'Matrícula *', <input className={classe('inp', erros.matricula && 'invalido')} value={f.matricula || ''} onChange={(e) => set('matricula', e.target.value)} />)}
        {campo('tipo', 'Tipo', <select className="inp" value={f.tipo} onChange={(e) => set('tipo', e.target.value)}>{meta.tiposAgente.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</select>)}
        {campo('turno', 'Turno', <select className="inp" value={f.turno} onChange={(e) => set('turno', e.target.value)}>{meta.turnos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</select>)}
        {campo('status', 'Status', <select className="inp" value={f.status} onChange={(e) => set('status', e.target.value)}>{meta.statusAgente.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>)}
        {campo('bairro_id', 'Bairro de atuação', <select className="inp" value={f.bairro_id} onChange={(e) => set('bairro_id', Number(e.target.value))}>{meta.bairros.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}</select>)}
        {campo('telefone', 'Telefone', <input className="inp" value={f.telefone || ''} onChange={(e) => set('telefone', e.target.value)} placeholder="(14) 9 0000-0000" />)}
        {campo('veiculo_id', 'Veículo vinculado', <select className="inp" value={f.veiculo_id || ''} onChange={(e) => set('veiculo_id', e.target.value ? Number(e.target.value) : null)}><option value="">Nenhum</option>{frota.map((v) => <option key={v.id} value={v.id}>{v.serie} · {v.marca} {v.modelo}</option>)}</select>)}
      </div>
    </Gaveta>
  );
}
