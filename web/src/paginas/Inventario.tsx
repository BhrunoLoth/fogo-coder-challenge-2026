import { useEffect, useMemo, useState } from 'react';
import { api, ErroApi } from '../api';
import { EquipamentoDetalhe, iconeDoTipo } from '../componentes/detalhes';
import { MapaSeletor } from '../componentes/MapaSeletor';
import { Gaveta, Kpi, SeloSituacao } from '../componentes/ui';
import { useApp } from '../contexto';
import { Icone } from '../icones';
import type { Equipamento } from '../types';
import { classe, data, pct, relativo } from '../util';

const hojeISO = (ts: number | null) => (ts ? new Date(ts - 3 * 3600e3).toISOString().slice(0, 10) : '');
const deISO = (s: string) => (s ? new Date(`${s}T12:00:00-03:00`).getTime() : null);

export default function Inventario() {
  const { meta, tipoEq, situacao, versao, destino, toast, bump } = useApp();
  const [lista, setLista] = useState<Equipamento[]>([]);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [sit, setSit] = useState('');
  const [bairro, setBairro] = useState('');
  const [urgente, setUrgente] = useState(false);
  const [ordem, setOrdem] = useState<{ col: string; asc: boolean }>({ col: 'tipo', asc: true });
  const [verId, setVerId] = useState<number | null>(null);
  const [editar, setEditar] = useState<Partial<Equipamento> | null>(null);

  useEffect(() => { api.get<Equipamento[]>('/api/equipamentos').then(setLista); }, [versao]);
  useEffect(() => {
    if (destino?.pagina !== 'inventario') return;
    if (destino.bairro) setBairro(String(destino.bairro));
    if (destino.equipamento) api.get<Equipamento>(`/api/equipamentos/${destino.equipamento}`).then((e) => setEditar(e));
  }, [destino]);

  const filtrada = useMemo(() => {
    const q = busca.toLowerCase();
    const xs = lista.filter((e) => (!tipo || e.tipo === tipo) && (!sit || e.situacao === sit) && (!bairro || e.bairro_id === Number(bairro))
      && (!urgente || e.manut_tipo === 'imediata' || (e.manut_data && e.manut_data < Date.now() + 7 * 864e5 && e.situacao !== 'nao_instalado'))
      && (!q || `${e.serie} ${e.marca} ${e.modelo} ${e.rua} ${e.bairro} ${tipoEq(e.tipo).nome}`.toLowerCase().includes(q)));
    const v = (e: Equipamento) => ({ tipo: tipoEq(e.tipo).nome, serie: e.serie, bairro: e.bairro || '', situacao: situacao(e.situacao).nome, manut: e.manut_data || 9e15 } as any)[ordem.col];
    return xs.sort((a, b) => (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * (ordem.asc ? 1 : -1));
  }, [lista, busca, tipo, sit, bairro, urgente, ordem]);

  const instalados = lista.filter((e) => !['nao_instalado', 'desativado'].includes(e.situacao));
  const ops = instalados.filter((e) => e.situacao === 'operacional').length;
  const th = (col: string, nome: string, cls = '') => <th className={cls} style={{ cursor: 'pointer' }} onClick={() => setOrdem((o) => ({ col, asc: o.col === col ? !o.asc : true }))}>{nome}{ordem.col === col ? (ordem.asc ? ' ↑' : ' ↓') : ''}</th>;

  const exportarCsv = () => {
    const cab = ['id', 'tipo', 'serie', 'marca', 'modelo', 'orgao', 'situacao', 'bairro', 'rua', 'referencia', 'cep', 'lat', 'lng', 'manut_tipo', 'manut_data'];
    const linhas = filtrada.map((e) => cab.map((c) => { const v = c === 'manut_data' ? (e.manut_data ? data(e.manut_data) : '') : (e as any)[c]; return `"${String(v ?? '').replace(/"/g, '""')}"`; }).join(';'));
    const blob = new Blob(['﻿' + cab.join(';') + '\n' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'inventario-fogo.csv'; a.click();
  };

  return (
    <div className="pagina">
      <div className="grade g4" style={{ marginBottom: 16 }}>
        <Kpi rotulo="Equipamentos cadastrados" valor={lista.length} detalhe={`${meta.tiposEquipamento.length} tipos diferentes`} />
        <Kpi rotulo="Disponibilidade" valor={pct(instalados.length ? ops / instalados.length : 1)} detalhe={`${ops} operacionais de ${instalados.length} instalados`} barra={instalados.length ? ops / instalados.length : 1} />
        <Kpi rotulo="Manutenção urgente" valor={lista.filter((e) => e.manut_tipo === 'imediata' || (e.manut_data && e.manut_data < Date.now() + 7 * 864e5 && e.situacao !== 'nao_instalado')).length} cor="var(--brasa2)" detalhe="imediata ou nos próximos 7 dias" />
        <Kpi rotulo="Aguardando instalação" valor={lista.filter((e) => e.situacao === 'nao_instalado').length} detalhe="já cadastrados, ainda não instalados" />
      </div>
      <div className="painel">
        <div className="cab" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="linha" style={{ position: 'relative', flex: '1 1 240px' }}>
            <span style={{ position: 'absolute', left: 10, top: 9 }} className="fraco"><Icone nome="busca" tamanho={16} /></span>
            <input className="inp" style={{ paddingLeft: 34 }} placeholder="Buscar por série, marca, modelo, rua…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <select className="inp" style={{ width: 210 }} value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos os tipos</option>{meta.tiposEquipamento.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</select>
          <select className="inp" style={{ width: 180 }} value={sit} onChange={(e) => setSit(e.target.value)}><option value="">Todas as situações</option>{meta.situacoes.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>
          <select className="inp" style={{ width: 180 }} value={bairro} onChange={(e) => setBairro(e.target.value)}><option value="">Todos os bairros</option>{meta.bairros.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}</select>
          <label className="check"><input type="checkbox" checked={urgente} onChange={(e) => setUrgente(e.target.checked)} />Manutenção urgente</label>
          <div className="dir">
            <button className="btn" onClick={exportarCsv}>Exportar CSV</button>
            <button className="btn prim" onClick={() => setEditar({ tipo: 'camera', situacao: 'operacional', manut_tipo: 'nenhuma', atributos: {}, cidade: 'Marília', uf: 'SP' })}><Icone nome="mais" />Novo equipamento</button>
          </div>
        </div>
        <div style={{ maxHeight: 'calc(100vh - 290px)', overflow: 'auto' }}>
          <table className="tabela">
            <thead><tr>{th('tipo', 'Tipo')}{th('serie', 'Série')}<th>Marca / modelo</th>{th('bairro', 'Localização')}{th('situacao', 'Situação')}{th('manut', 'Manutenção')}<th></th></tr></thead>
            <tbody>
              {filtrada.map((e) => {
                const s = situacao(e.situacao), t = tipoEq(e.tipo);
                const urg = e.manut_tipo === 'imediata' || (e.manut_data && e.manut_data < Date.now() + 7 * 864e5 && e.situacao !== 'nao_instalado');
                return (
                  <tr key={e.id} className="clicavel" onClick={() => setVerId(e.id)}>
                    <td><span className="linha"><span className="mk" style={{ ['--c' as any]: s.cor, width: 26, height: 26, flex: 'none' }}><Icone nome={iconeDoTipo(e.tipo)} tamanho={14} cor="#f3efe8" /></span>{t.nome}</span></td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{e.serie}</td>
                    <td className="uma-linha" style={{ width: '16%' }} title={`${e.marca} ${e.modelo}`}>{e.marca} <span className="suave">{e.modelo}</span></td>
                    <td className="uma-linha" style={{ width: '30%' }} title={`${e.rua}${e.referencia ? `, ${e.referencia}` : ''}`}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.rua}{e.referencia ? `, ${e.referencia}` : ''}</div><div className="fraco" style={{ fontSize: 12 }}>{e.bairro}{e.zona && e.zona !== e.bairro ? ` · ${e.zona}` : ''}</div></td>
                    <td><SeloSituacao cor={s.cor} nome={s.nome} /></td>
                    <td style={{ color: urg ? 'var(--brasa2)' : undefined }}>{e.manut_tipo === 'imediata' ? 'Imediata' : e.manut_data ? <>{data(e.manut_data)}<div className="fraco" style={{ fontSize: 12 }}>{relativo(e.manut_data)}</div></> : <span className="fraco">—</span>}</td>
                    <td><button className="btn peq fantasma" onClick={(ev) => { ev.stopPropagation(); setEditar(e); }}><Icone nome="editar" tamanho={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filtrada.length && <div className="vazio">Nenhum equipamento com esses filtros.</div>}
        </div>
      </div>
      {verId && <EquipamentoDetalhe id={verId} onFechar={() => setVerId(null)} onEditar={(e) => { setVerId(null); setEditar(e); }} />}
      {editar && <FormEquipamento inicial={editar} onFechar={() => setEditar(null)} onSalvo={() => { setEditar(null); bump(); }} />}
    </div>
  );
}

function FormEquipamento({ inicial, onFechar, onSalvo }: { inicial: Partial<Equipamento>; onFechar: () => void; onSalvo: () => void }) {
  const { meta, tipoEq, toast } = useApp();
  const [f, setF] = useState<any>({ ...inicial, atributos: { ...(inicial.atributos || {}) } });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [bairroAuto, setBairroAuto] = useState<string>(inicial.bairro || '');
  const [ruas, setRuas] = useState<string[]>([]);
  const t = tipoEq(f.tipo);
  const novo = !inicial.id;
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const setAttr = (k: string, v: any) => setF((x: any) => ({ ...x, atributos: { ...x.atributos, [k]: v } }));

  const escolherPonto = async (lat: number, lng: number) => {
    setF((x: any) => ({ ...x, lat, lng }));
    try {
      const r = await api.get<{ bairro: string; cep: string; ruas: string[] }>(`/api/geo/reverso?lat=${lat}&lng=${lng}`);
      setBairroAuto(r.bairro); setRuas(r.ruas);
      setF((x: any) => ({ ...x, cep: x.cep || r.cep }));
    } catch { /* ok */ }
  };
  const buscarCep = async () => {
    try {
      const r = await api.get<{ bairro: string; lat: number; lng: number; ruas: string[]; exato: boolean; cep: string }>(`/api/cep/${f.cep || ''}`);
      setBairroAuto(r.bairro); setRuas(r.ruas);
      setF((x: any) => ({ ...x, cep: r.cep, lat: x.lat ?? r.lat, lng: x.lng ?? r.lng, rua: x.rua || r.ruas[0] || '' }));
      toast(r.exato ? `CEP de ${r.bairro}` : `CEP aproximado para a região de ${r.bairro} (base local, sem internet)`, 'info');
    } catch (e: any) { setErros((x) => ({ ...x, cep: e.erros?.cep || e.message })); }
  };

  const salvar = async () => {
    setSalvando(true); setErros({});
    try {
      if (novo) await api.post('/api/equipamentos', f); else await api.put(`/api/equipamentos/${inicial.id}`, f);
      toast(novo ? 'Equipamento cadastrado' : 'Alterações salvas', 'ok');
      onSalvo();
    } catch (e) {
      if (e instanceof ErroApi && e.erros) { setErros(e.erros); toast('Revise os campos destacados', 'erro'); } else toast((e as Error).message, 'erro');
    } finally { setSalvando(false); }
  };
  const excluir = async () => {
    if (!confirm(`Excluir o equipamento ${inicial.serie}? Essa ação fica registrada na auditoria.`)) return;
    try { await api.del(`/api/equipamentos/${inicial.id}`); toast('Equipamento excluído', 'ok'); onSalvo(); } catch (e: any) { toast(e.message, 'erro'); }
  };
  const campo = (k: string, rotulo: string, el: React.ReactNode) => <div className="campo"><label>{rotulo}</label>{el}{erros[k] && <span className="erro">{erros[k]}</span>}</div>;

  return (
    <Gaveta larga onFechar={onFechar} titulo={novo ? 'Novo equipamento' : `Editar ${inicial.serie}`} sub="Todos os dados ficam registrados na trilha de auditoria"
      rodape={<>{!novo && <button className="btn perigo" style={{ marginRight: 'auto' }} onClick={excluir}><Icone nome="lixo" />Excluir</button>}<button className="btn" onClick={onFechar}>Cancelar</button><button className="btn prim" disabled={salvando} onClick={salvar}><Icone nome="check" />{salvando ? 'Salvando…' : 'Salvar'}</button></>}>
      <div className="rotulo" style={{ marginBottom: 10 }}>Identificação</div>
      <div className="grade g2" style={{ marginBottom: 18 }}>
        {campo('tipo', 'Tipo de equipamento', <select className="inp" value={f.tipo} onChange={(e) => { const nt = tipoEq(e.target.value); setF((x: any) => ({ ...x, tipo: e.target.value, orgao: nt.orgao, atributos: {} })); }}>{meta.tiposEquipamento.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>)}
        {campo('serie', 'Número de série *', <input className={classe('inp', erros.serie && 'invalido')} value={f.serie || ''} onChange={(e) => set('serie', e.target.value)} placeholder="Ex.: CAM-02041" />)}
        {campo('marca', 'Marca', <input className="inp" value={f.marca || ''} onChange={(e) => set('marca', e.target.value)} />)}
        {campo('modelo', 'Modelo', <input className="inp" value={f.modelo || ''} onChange={(e) => set('modelo', e.target.value)} />)}
        {campo('orgao', 'Órgão responsável', <select className="inp" value={f.orgao || t.orgao} onChange={(e) => set('orgao', e.target.value)}>{meta.orgaos.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}</select>)}
        {campo('situacao', 'Situação', <select className="inp" value={f.situacao} onChange={(e) => set('situacao', e.target.value)}>{meta.situacoes.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>)}
      </div>

      <div className="rotulo" style={{ marginBottom: 10 }}>Localização {t.movel && <span className="fraco" style={{ textTransform: 'none', letterSpacing: 0 }}>· equipamento móvel: informe a base</span>}</div>
      <div className="grade g2" style={{ marginBottom: 10 }}>
        <div className="coluna">
          {campo('cep', 'CEP', <div className="linha"><input className={classe('inp', erros.cep && 'invalido')} value={f.cep || ''} onChange={(e) => set('cep', e.target.value)} placeholder="17500-000" /><button className="btn" onClick={buscarCep}>Buscar</button></div>)}
          {campo('rua', 'Rua / avenida', <><input className="inp" list="ruas" value={f.rua || ''} onChange={(e) => set('rua', e.target.value)} /><datalist id="ruas">{ruas.map((r) => <option key={r} value={r} />)}</datalist></>)}
          {campo('referencia', 'Referência', <input className="inp" value={f.referencia || ''} onChange={(e) => set('referencia', e.target.value)} placeholder='"número 181", "oposto ao 181", "KM 203", "S/N"…' />)}
          <div className="grade g2" style={{ gap: 10 }}>
            {campo('cidade', 'Cidade', <input className="inp" value={f.cidade || 'Marília'} onChange={(e) => set('cidade', e.target.value)} />)}
            {campo('uf', 'UF', <input className="inp" value={f.uf || 'SP'} maxLength={2} onChange={(e) => set('uf', e.target.value.toUpperCase())} />)}
          </div>
        </div>
        <div className="coluna">
          <MapaSeletor lat={f.lat ?? null} lng={f.lng ?? null} onEscolher={escolherPonto} />
          <div className="linha entre" style={{ fontSize: 12.5 }}>
            <span className={classe('mono', (erros.lat || erros.lng) ? '' : 'suave')} style={{ color: erros.lat || erros.lng ? 'var(--perigo)' : undefined }}>{f.lat != null ? `GPS ${Number(f.lat).toFixed(5)}, ${Number(f.lng).toFixed(5)}` : 'Clique no mapa para marcar o GPS'}</span>
            {bairroAuto && <span className="selo">{bairroAuto}</span>}
          </div>
        </div>
      </div>

      <div className="rotulo" style={{ margin: '16px 0 10px' }}>Manutenção</div>
      <div className="grade g3" style={{ marginBottom: 18 }}>
        {campo('manut_tipo', 'Necessidade', <select className="inp" value={f.manut_tipo} onChange={(e) => set('manut_tipo', e.target.value)}>{meta.manutencaoTipos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select>)}
        {campo('manut_data', 'Próxima manutenção', <input type="date" className={classe('inp', erros.manut_data && 'invalido')} value={hojeISO(f.manut_data)} onChange={(e) => set('manut_data', deISO(e.target.value))} />)}
        {campo('manut_periodicidade_dias', 'Periodicidade (dias)', <input type="number" min={1} className={classe('inp', erros.manut_periodicidade_dias && 'invalido')} value={f.manut_periodicidade_dias || ''} onChange={(e) => set('manut_periodicidade_dias', e.target.value ? Number(e.target.value) : null)} disabled={f.manut_tipo !== 'periodica'} />)}
      </div>

      <div className="rotulo" style={{ marginBottom: 10 }}>Características de {t.nome.toLowerCase()}</div>
      <div className="grade g2">
        {t.atributos.map((a) => (
          <div key={a.key} className="campo">
            {a.tipo === 'bool' ? <label className="check" style={{ height: 36 }}><input type="checkbox" checked={!!f.atributos[a.key]} onChange={(e) => setAttr(a.key, e.target.checked)} />{a.label}</label> : <>
              <label>{a.label}{a.unidade ? ` (${a.unidade})` : ''}</label>
              {a.tipo === 'select' ? <select className="inp" value={f.atributos[a.key] || ''} onChange={(e) => setAttr(a.key, e.target.value)}><option value="">—</option>{a.opcoes!.map((o) => <option key={o}>{o}</option>)}</select>
                : <input className={classe('inp', erros[`atributos.${a.key}`] && 'invalido')} type={a.tipo === 'number' ? 'number' : 'text'} min={a.min} max={a.max} value={f.atributos[a.key] ?? ''} onChange={(e) => setAttr(a.key, a.tipo === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />}
            </>}
            {erros[`atributos.${a.key}`] && <span className="erro">{erros[`atributos.${a.key}`]}</span>}
          </div>
        ))}
      </div>
    </Gaveta>
  );
}
