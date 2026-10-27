import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { AgenteDetalhe, EquipamentoDetalhe, iconeDoTipo, RegiaoDetalhe } from '../componentes/detalhes';
import { adicionarMapaBase } from '../componentes/mapaBase';
import { SeloRisco } from '../componentes/ui';
import { useApp } from '../contexto';
import { Icone, marcadorHtml } from '../icones';
import type { Agente, Equipamento, Ocorrencia, Regiao } from '../types';
import { classe, corRisco, dataCurta, esc, hora, horaMin, num, pct, relativo } from '../util';

const COR_NIVEL: Record<string, string> = { critico: '#ff3d2e', alto: '#ff7a1a', medio: '#4ea8ff', info: '#8a8f98' };
const COR_ESTADO: Record<string, string> = { normal: '#3ecf8e', atencao: '#ffb020', critico: '#ff4d4f' };
const EXERCICIOS = [
  { id: 'acidente', nome: 'Acidente de trânsito', icone: 'raio' },
  { id: 'furto_camera', nome: 'Furto de câmera', icone: 'camera' },
  { id: 'alagamento', nome: 'Alagamento', icone: 'sensor' },
  { id: 'roubo_furto', nome: 'Roubo / furto', icone: 'escudo' },
  { id: 'congestionamento', nome: 'Congestionamento', icone: 'taxi' },
  { id: 'chuva_forte', nome: 'Chuva forte (previsão)', icone: 'chuva' },
];

type Tempo = { offset: number; hora: number; modo: string; chuvaMm: number; risco: { bairro_id: number; risco: number; desvio: number; esperado: number }[]; ocorrencias: Ocorrencia[]; evento: { nome: string } | null };

export default function Central({ telao, alternarTelao }: { telao: boolean; alternarTelao: () => void }) {
  const app = useApp();
  const { meta, vivo, alertas, situacao, tipoEq, bairro, versao, toast, nomeOc, destino } = app;
  const divMapa = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camadas = useRef<Record<string, L.LayerGroup>>({});
  const marcEq = useRef(new Map<number, L.Marker>());
  const marcAg = useRef(new Map<number, L.Marker>());
  const marcOc = useRef(new Map<number, L.Marker>());

  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Map<number, Ocorrencia>>(new Map());
  const [regioes, setRegioes] = useState<Regiao[]>([]);
  const [tiposSel, setTiposSel] = useState<Set<string>>(new Set(meta.tiposEquipamento.map((t) => t.id)));
  const [sitSel, setSitSel] = useState<Set<string>>(new Set(meta.situacoes.map((s) => s.id)));
  const [zona, setZona] = useState('');
  const [bairroF, setBairroF] = useState('');
  const [orgao, setOrgao] = useState('');
  const [urgente, setUrgente] = useState(false);
  const [mostrar, setMostrar] = useState({ equipamentos: true, agentes: true, ocorrencias: true, regioes: true, referencias: true });
  const [modoRegiao, setModoRegiao] = useState<'saude' | 'risco'>('risco');
  const [aba, setAba] = useState<'alertas' | 'regioes' | 'ocorrencias'>('alertas');
  const [offset, setOffset] = useState(0);
  const [tempo, setTempo] = useState<Tempo | null>(null);
  const [tocando, setTocando] = useState(false);
  const [exercicio, setExercicio] = useState<string | null>(null);
  const [menuEx, setMenuEx] = useState(false);
  const [sel, setSel] = useState<{ tipo: 'eq' | 'ag' | 'regiao'; id: number } | null>(null);
  const [filtrosAbertos, setFiltrosAbertos] = useState(true);
  const [zoom, setZoom] = useState(13);
  const exRef = useRef<string | null>(null);
  exRef.current = exercicio;
  // Disparo do exercício: funciona clicando no mapa, numa região ou num marcador.
  const disparar = useRef<(lat: number, lng: number) => void>(() => {});
  disparar.current = async (lat: number, lng: number) => {
    const tipo = exRef.current; if (!tipo) return;
    setExercicio(null);
    try {
      const r = await api.post<{ bairro: string; efeitos: string[] }>('/api/exercicio', { tipo, lat, lng });
      toast(`Exercício em ${r.bairro}: ${r.efeitos.join(' · ')}`, 'fogo');
      app.bump();
    } catch (err: any) { toast(err.message, 'erro'); }
  };
  const detalhado = zoom >= 14.5; // ao aproximar, os ícones crescem

  // ------------------------------------------------------------ dados
  useEffect(() => { api.get<Equipamento[]>('/api/equipamentos').then(setEquipamentos); }, [versao]);
  useEffect(() => {
    const f = () => api.get<Agente[]>('/api/agentes').then(setAgentes);
    f(); const t = setInterval(f, 45000); return () => clearInterval(t);
  }, [versao]);
  useEffect(() => {
    api.get<Ocorrencia[]>('/api/ocorrencias?abertas=1&limite=500').then((xs) => setOcorrencias(new Map(xs.map((o) => [o.id, o]))));
  }, []);
  useEffect(() => {
    const f = () => api.get<Regiao[]>('/api/regioes').then(setRegioes);
    f(); const t = setInterval(f, 20000); return () => clearInterval(t);
  }, [versao]);
  useEffect(() => {
    if (!vivo) return;
    const atualizadas = vivo.ocorrenciasAtualizadas || [];
    if (!vivo.novasOcorrencias.length && !vivo.ocorrenciasEncerradas.length && !atualizadas.length) return;
    setOcorrencias((m) => {
      const n = new Map(m);
      vivo.novasOcorrencias.forEach((o) => n.set(o.id, o));
      atualizadas.forEach((u) => { const o = n.get(u.id); if (o) n.set(u.id, { ...o, status: u.status }); });
      vivo.ocorrenciasEncerradas.forEach((id) => n.delete(id));
      return n;
    });
  }, [vivo]);
  useEffect(() => {
    if (offset === 0) { setTempo(null); return; }
    api.get<Tempo>(`/api/maquina-do-tempo?offset=${offset}`).then(setTempo);
  }, [offset]);
  useEffect(() => {
    if (!tocando) return;
    const t = setInterval(() => setOffset((o) => { if (o >= 24) { setTocando(false); return 24; } return o + 1; }), 650);
    return () => clearInterval(t);
  }, [tocando]);

  // Navegação vinda de outras telas ("ver no mapa").
  useEffect(() => {
    if (!destino || destino.pagina !== 'central' || !mapa.current) return;
    if (destino.lat && destino.lng) mapa.current.flyTo([destino.lat, destino.lng], 16, { duration: 0.8 });
    if (destino.equipamento) setSel({ tipo: 'eq', id: destino.equipamento });
  }, [destino]);

  // Atalho de teclado: T = modo telão.
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if ((e.target as HTMLElement).tagName === 'INPUT') return; if (e.key === 't' || e.key === 'T') alternarTelao(); if (e.key === 'Escape') setExercicio(null); };
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f);
  }, [alternarTelao]);

  // ------------------------------------------------------------ mapa
  useEffect(() => {
    if (!divMapa.current || mapa.current) return;
    const bb = meta.cidade.bbox;
    const m = L.map(divMapa.current, { zoomControl: false, attributionControl: true, preferCanvas: false, zoomSnap: 0.25 });
    m.fitBounds([[bb.south, bb.west], [bb.north, bb.east]], { paddingTopLeft: [290, 120], paddingBottomRight: [370, 110] });
    m.on('zoomend', () => setZoom(m.getZoom()));
    setZoom(m.getZoom());
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    adicionarMapaBase(m);
    m.createPane('regioes'); m.getPane('regioes')!.style.zIndex = '350';
    for (const k of ['regioes', 'rotulos', 'referencias', 'tempo', 'equipamentos', 'ocorrencias', 'agentes']) camadas.current[k] = L.layerGroup().addTo(m);
    // Rótulos dos bairros e pontos de referência (fixos).
    for (const b of meta.bairros) {
      L.marker([b.lat, b.lng], { interactive: false, icon: L.divIcon({ className: '', html: `<div class="rotulo-bairro">${b.nome}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] }) }).addTo(camadas.current.rotulos);
    }
    for (const p of meta.cidade.pontos) {
      L.marker([p.lat, p.lng], { interactive: false, icon: L.divIcon({ className: '', html: `<div class="ponto-ref">◆ ${p.nome}</div>`, iconSize: [0, 0], iconAnchor: [-4, 6] }) }).addTo(camadas.current.referencias);
    }
    mapa.current = m;
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); mapa.current = null; };
  }, [meta]);

  useEffect(() => { setTimeout(() => mapa.current?.invalidateSize(), 60); }, [telao]);

  // Clique no mapa no modo exercício.
  useEffect(() => {
    const m = mapa.current; if (!m) return;
    const f = (e: L.LeafletMouseEvent) => { if (exRef.current) disparar.current(e.latlng.lat, e.latlng.lng); };
    m.on('click', f);
    divMapa.current!.style.cursor = exercicio ? 'crosshair' : '';
    return () => { m.off('click', f); };
  }, [exercicio]);

  // Regiões (Voronoi) coloridas por saúde, risco atual ou máquina do tempo.
  useEffect(() => {
    const g = camadas.current.regioes; if (!g) return;
    g.clearLayers();
    if (!mostrar.regioes) return;
    for (const r of regioes) {
      const riscoT = tempo ? tempo.risco.find((x) => x.bairro_id === r.bairro_id) : null;
      const valor = riscoT ? riscoT.risco : r.riscoAgora;
      const usarRisco = !!tempo || modoRegiao === 'risco';
      const cor = usarRisco ? corRisco(valor) : COR_ESTADO[r.estado];
      const op = usarRisco ? 0.06 + (valor / 100) * 0.36 : r.estado === 'normal' ? 0.05 : r.estado === 'atencao' ? 0.16 : 0.24;
      const poly = L.polygon(r.poligono, { pane: 'regioes', color: cor, weight: 1, opacity: 0.55, fillColor: cor, fillOpacity: op });
      const dica = tempo
        ? `<b>${esc(r.nome)}</b><br>${tempo.modo === 'passado' ? 'Risco calculado pelo modelo para aquela hora' : 'Risco previsto'}: <b>${valor}</b><br>Ocorrências esperadas na hora: ${num(riscoT?.esperado || 0, 2)}`
        : `<b>${esc(r.nome)}</b><br>Risco agora: <b>${r.riscoAgora}</b>${r.pico6h ? ` · pico ${r.pico6h.risco} às ${hora(r.pico6h.hora)}` : ''}<br>Equipamentos: ${r.operacionais}/${r.equipamentos} · Agentes ativos: ${r.agentesAtivos}${r.motivos.length ? '<br>⚠ ' + r.motivos.map(esc).join('<br>⚠ ') : ''}`;
      poly.bindTooltip(dica, { sticky: true });
      poly.on('click', (ev: L.LeafletMouseEvent) => { if (exRef.current) { L.DomEvent.stop(ev); disparar.current(ev.latlng.lat, ev.latlng.lng); } else setSel({ tipo: 'regiao', id: r.bairro_id }); });
      poly.addTo(g);
    }
  }, [regioes, modoRegiao, tempo, mostrar.regioes]);

  // Equipamentos filtrados.
  const filtrados = useMemo(() => equipamentos.filter((e) => tiposSel.has(e.tipo) && sitSel.has(e.situacao)
    && (!zona || e.zona === zona) && (!bairroF || e.bairro_id === Number(bairroF)) && (!orgao || e.orgao === orgao)
    && (!urgente || e.manut_tipo === 'imediata' || (e.manut_data && e.manut_data < Date.now() + 7 * 864e5 && e.situacao !== 'nao_instalado'))),
  [equipamentos, tiposSel, sitSel, zona, bairroF, orgao, urgente]);
  const semSinalChave = (vivo?.semSinal || []).join(',');

  useEffect(() => {
    const g = camadas.current.equipamentos; if (!g) return;
    g.clearLayers(); marcEq.current.clear();
    if (!mostrar.equipamentos) return;
    const semSinal = new Set(vivo?.semSinal || []);
    for (const e of filtrados) {
      const s = situacao(e.situacao), t = tipoEq(e.tipo);
      const silencio = semSinal.has(e.id);
      const cor = silencio ? '#ff4d4f' : s.cor;
      const alarme = silencio || e.situacao === 'furtado' || e.situacao === 'mau_funcionamento';
      const apagado = e.situacao === 'desativado' || e.situacao === 'nao_instalado';
      // Ícone do tipo + anel na cor da situação em qualquer zoom (menor na visão da cidade).
      const tam = detalhado ? (t.movel ? 20 : 26) : alarme ? 21 : t.movel ? 14 : 17;
      const html = marcadorHtml(iconeDoTipo(e.tipo), cor, { pulso: alarme, tamanho: tam, apagado, compacto: !detalhado });
      const mk = L.marker([e.lat, e.lng], {
        icon: L.divIcon({ className: '', html, iconSize: [tam, tam], iconAnchor: [tam / 2, tam / 2] }),
        riseOnHover: true, zIndexOffset: alarme ? 600 : 0,
      });
      mk.bindTooltip(`<b>${esc(t.nome)}</b> · ${esc(e.serie)}<br>${silencio ? '<span style="color:#ff6b6b">● SEM SINAL</span>' : esc(s.nome)} · ${esc(e.bairro)}<br><span style="color:#9aa0ab">${esc(e.rua)}${e.referencia ? ', ' + esc(e.referencia) : ''}</span>`, { direction: 'top', offset: [0, -tam / 2] });
      mk.on('click', () => { if (exRef.current) disparar.current(e.lat, e.lng); else setSel({ tipo: 'eq', id: e.id }); });
      mk.addTo(g); marcEq.current.set(e.id, mk);
    }
  }, [filtrados, mostrar.equipamentos, semSinalChave, detalhado]);

  // Posição ao vivo dos veículos.
  useEffect(() => {
    if (!vivo) return;
    for (const v of vivo.moveis) { const mk = marcEq.current.get(v.id); if (mk) mk.setLatLng([v.lat, v.lng]); }
  }, [vivo]);

  // Agentes ao vivo.
  useEffect(() => {
    const g = camadas.current.agentes; if (!g || !vivo) return;
    if (!mostrar.agentes) { g.clearLayers(); marcAg.current.clear(); return; }
    const nomes = new Map(agentes.map((a) => [a.id, a]));
    const vistos = new Set<number>();
    for (const a of vivo.agentes) {
      vistos.add(a.id);
      const st = meta.statusAgente.find((s) => s.id === a.status);
      const cor = st?.cor || '#fff';
      let mk = marcAg.current.get(a.id);
      // Agente: letra do tipo (T = trânsito, G = guarda municipal, P = polícia militar), cor = status.
      const letra = ({ agente_transito: 'T', guarda_municipal: 'G', policial_militar: 'P' } as Record<string, string>)[a.tipo || nomes.get(a.id)?.tipo || ''] || '';
      const html = `<div class="ag" style="--c:${cor}">${letra}</div>`;
      if (!mk) {
        mk = L.marker([a.lat, a.lng], { icon: L.divIcon({ className: '', html, iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 500 });
        mk.on('click', () => { const p = mk!.getLatLng(); if (exRef.current) disparar.current(p.lat, p.lng); else setSel({ tipo: 'ag', id: a.id }); });
        mk.addTo(g); marcAg.current.set(a.id, mk);
        (mk as any)._st = a.status + letra;
      } else {
        mk.setLatLng([a.lat, a.lng]);
        if ((mk as any)._st !== a.status + letra) { mk.setIcon(L.divIcon({ className: '', html, iconSize: [18, 18], iconAnchor: [9, 9] })); (mk as any)._st = a.status + letra; }
      }
      const info = nomes.get(a.id);
      mk.bindTooltip(`<b>${esc(info ? info.nome : 'Agente')}</b>${info ? ` · ${esc(info.matricula)}` : ''}<br>${esc(st?.nome)}`, { direction: 'top', offset: [0, -8] });
    }
    for (const [id, mk] of marcAg.current) if (!vistos.has(id)) { g.removeLayer(mk); marcAg.current.delete(id); }
  }, [vivo, agentes, mostrar.agentes]);

  // Ocorrências abertas (e, na máquina do tempo, as da hora escolhida).
  useEffect(() => {
    const g = camadas.current.ocorrencias; if (!g) return;
    g.clearLayers(); marcOc.current.clear();
    if (!mostrar.ocorrencias) return;
    const lista = tempo ? tempo.ocorrencias : [...ocorrencias.values()];
    for (const o of lista) {
      const tipo = meta.tiposOcorrencia.find((t) => t.id === o.tipo);
      const cor = !tipo ? '#fff' : tipo.peso >= 3 ? '#ff3d2e' : tipo.peso >= 2 ? '#ff7a1a' : tipo.peso >= 1 ? '#f2b33d' : '#9aa0ab';
      const mk = L.marker([o.lat, o.lng], { icon: L.divIcon({ className: '', html: `<div class="oc${o.exercicio ? ' ex' : ''}" style="--c:${cor}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 800 });
      mk.bindTooltip(`<b>${esc(nomeOc(o.tipo))}</b>${o.exercicio ? ' (exercício)' : ''}<br>${esc(bairro(o.bairro_id)?.nome)} · ${horaMin(o.inicio)} · ${o.status === 'aberta' ? 'aguardando agente' : o.status === 'atendimento' ? 'em atendimento' : esc(o.status)}`, { direction: 'top', offset: [0, -8] });
      mk.on('click', () => { if (exRef.current) disparar.current(o.lat, o.lng); });
      mk.addTo(g); marcOc.current.set(o.id, mk);
    }
  }, [ocorrencias, tempo, mostrar.ocorrencias]);

  useEffect(() => {
    const m = mapa.current; if (!m) return;
    const g = camadas.current;
    if (g.referencias) mostrar.referencias && zoom >= 13.75 ? m.addLayer(g.referencias) : m.removeLayer(g.referencias);
  }, [mostrar.referencias, zoom]);

  // ------------------------------------------------------------ derivados
  const k = vivo?.kpis;
  const piorRegiao = regioes.slice().sort((a, b) => b.riscoAgora - a.riscoAgora)[0];
  const regioesOrdenadas = regioes.slice().sort((a, b) => ({ critico: 2, atencao: 1, normal: 0 }[b.estado] - { critico: 2, atencao: 1, normal: 0 }[a.estado]) || b.riscoAgora - a.riscoAgora);
  const naoLidos = alertas.filter((a) => !a.reconhecido).length;
  const regiaoSel = sel?.tipo === 'regiao' ? regioes.find((r) => r.bairro_id === sel.id) : null;
  const alternar = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); fn(n); };
  const voar = (lat?: number, lng?: number) => { if (lat && lng) mapa.current?.flyTo([lat, lng], 16, { duration: 0.8 }); };

  const rotuloTempo = offset === 0 ? 'Agora — situação ao vivo' : offset < 0 ? `${-offset}h atrás · ${dataCurta(tempo?.hora || Date.now())} às ${tempo ? hora(tempo.hora) : ''} — o que aconteceu` : `daqui a ${offset}h · ${tempo ? `${dataCurta(tempo.hora)} às ${hora(tempo.hora)}` : ''} — o que o F.O.G.O. prevê`;

  return (
    <div className="pagina cheia">
      <div ref={divMapa} className="mapa" />

      {/* KPIs */}
      <div className="ov ov-kpis">
        <Kp rotulo="Equipamentos" v={k ? `${k.total}` : '—'} suf=" cadastrados" d={k ? `${k.operacionais_efetivos} operacionais (${pct(k.disponibilidade)} disponível)` : ''} barra={k?.disponibilidade} />
        <Kp rotulo="Indisponíveis" v={k ? `${k.indisponiveis + k.sem_sinal}` : '—'} cor={k && k.indisponiveis + k.sem_sinal > 0 ? 'var(--aviso)' : undefined} d={k ? `${k.sem_sinal} sem sinal · ${k.nao_instalados} não instalados` : ''} />
        <Kp rotulo="Manutenção urgente" v={k ? `${k.manut_urgente}` : '—'} cor={k && k.manut_urgente ? 'var(--brasa2)' : undefined} d="imediata ou em até 7 dias" />
        <Kp rotulo="Agentes em atividade" v={k ? `${k.agentes_ativos}` : '—'} suf={k ? `/${k.agentes_total}` : ''} d={k ? `${k.agentes_em_ocorrencia} atendendo ocorrência` : ''} />
        <Kp rotulo="Ocorrências abertas" v={k ? `${k.ocorrencias_abertas}` : '—'} d={k ? `${k.ocorrencias_hoje} registradas hoje` : ''} />
        <Kp rotulo="Maior risco agora" v={piorRegiao ? <SeloRisco risco={piorRegiao.riscoAgora} /> : '—'} d={piorRegiao ? piorRegiao.nome : ''} />
      </div>

      {exercicio && <div className="banner-exercicio"><Icone nome="alvo" /> Modo exercício: clique no mapa onde o incidente "{EXERCICIOS.find((e) => e.id === exercicio)?.nome}" deve acontecer <button className="btn peq fantasma" onClick={() => setExercicio(null)}>Cancelar (Esc)</button></div>}

      {/* Painel esquerdo: camadas e filtros */}
      <div className="ov ov-esq">
        <div className="vidro" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: '100%' }}>
          <div className="linha entre" style={{ padding: '12px 14px 8px' }}>
            <span className="linha" style={{ fontWeight: 600 }}><Icone nome="filtro" tamanho={16} /> Camadas e filtros</span>
            <button className="btn peq fantasma" onClick={() => setFiltrosAbertos((x) => !x)}>{filtrosAbertos ? 'ocultar' : 'mostrar'}</button>
          </div>
          {filtrosAbertos && <div className="rolavel">
            <div className="filtro-grupo">
              <div className="chips" style={{ marginTop: 0 }}>
                {([['equipamentos', 'Equipamentos'], ['agentes', 'Agentes'], ['ocorrencias', 'Ocorrências'], ['regioes', 'Regiões'], ['referencias', 'Referências']] as const).map(([id, nome]) => (
                  <button key={id} className={classe('chip', mostrar[id] && 'ativo')} onClick={() => setMostrar((m) => ({ ...m, [id]: !m[id] }))}>{nome}</button>
                ))}
              </div>
              <div className="linha" style={{ marginTop: 9, fontSize: 12 }}><span className="suave">Colorir regiões por</span>
                <div className="seg"><button className={classe(modoRegiao === 'risco' && 'ativo')} onClick={() => setModoRegiao('risco')}>Risco</button><button className={classe(modoRegiao === 'saude' && 'ativo')} onClick={() => setModoRegiao('saude')}>Saúde</button></div></div>
            </div>
            <div className="filtro-grupo">
              <div className="linha entre"><span className="rotulo">Tipo de equipamento</span><button className="btn peq fantasma" onClick={() => setTiposSel(tiposSel.size === meta.tiposEquipamento.length ? new Set() : new Set(meta.tiposEquipamento.map((t) => t.id)))}>{tiposSel.size === meta.tiposEquipamento.length ? 'nenhum' : 'todos'}</button></div>
              <div className="chips">
                {meta.tiposEquipamento.map((t) => <button key={t.id} title={t.nome} className={classe('chip', tiposSel.has(t.id) && 'ativo')} onClick={() => alternar(tiposSel, t.id, setTiposSel)}><Icone nome={iconeDoTipo(t.id)} tamanho={13} />{t.nome.split(' ')[0] === 'Viatura' ? t.nome.replace('Viatura da ', '') : t.nome.split(' (')[0].replace('de fiscalização', '').replace('de videomonitoramento', '').replace('de autoatendimento', '').trim()}</button>)}
              </div>
            </div>
            <div className="filtro-grupo">
              <span className="rotulo">Situação</span>
              <div className="chips">
                {meta.situacoes.map((s) => <button key={s.id} style={{ ['--c' as any]: s.cor }} className={classe('chip', sitSel.has(s.id) && 'ativo')} onClick={() => alternar(sitSel, s.id, setSitSel)}><i />{s.nome}</button>)}
              </div>
              <label className="check" style={{ marginTop: 9 }}><input type="checkbox" checked={urgente} onChange={(e) => setUrgente(e.target.checked)} />Só manutenção urgente</label>
            </div>
            <div className="filtro-grupo coluna">
              <select className="inp" value={zona} onChange={(e) => setZona(e.target.value)}><option value="">Todas as zonas</option>{meta.zonas.map((z) => <option key={z}>{z}</option>)}</select>
              <select className="inp" value={bairroF} onChange={(e) => setBairroF(e.target.value)}><option value="">Todos os bairros</option>{meta.bairros.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}</select>
              <select className="inp" value={orgao} onChange={(e) => setOrgao(e.target.value)}><option value="">Todos os órgãos</option>{meta.orgaos.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}</select>
              <div className="fraco" style={{ fontSize: 12 }}>Mostrando {filtrados.length} de {equipamentos.length} equipamentos</div>
            </div>
          </div>}
        </div>
        <div className="vidro" style={{ padding: 12, position: 'relative' }}>
          <div className="linha" style={{ gap: 6 }}>
            <button className={classe('btn', 'prim')} style={{ flex: 1 }} onClick={() => setMenuEx((x) => !x)}><Icone nome="alvo" />Modo exercício</button>
            <button className={classe('btn icone', telao && 'ativo')} title="Modo telão (T)" onClick={alternarTelao}><Icone nome="tela" /></button>
          </div>
          {menuEx && <div className="coluna" style={{ marginTop: 10, gap: 4 }}>
            <div className="fraco" style={{ fontSize: 12 }}>Escolha o incidente e clique no mapa:</div>
            {EXERCICIOS.map((e) => <button key={e.id} className="btn peq" style={{ justifyContent: 'flex-start' }} onClick={() => { setExercicio(e.id); setMenuEx(false); }}><Icone nome={e.icone} tamanho={14} />{e.nome}</button>)}
          </div>}
        </div>
      </div>

      {/* Painel direito: alertas, regiões, ocorrências */}
      <div className="ov ov-dir">
        <div className="vidro" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <div className="abas" style={{ margin: '0 6px', marginBottom: 0 }}>
            <button className={classe(aba === 'alertas' && 'ativo')} onClick={() => setAba('alertas')}><Icone nome="sino" tamanho={15} />Alertas {naoLidos > 0 && <span className="cont" style={{ background: 'var(--brasa-fundo)', color: 'var(--brasa2)' }}>{naoLidos}</span>}</button>
            <button className={classe(aba === 'regioes' && 'ativo')} onClick={() => setAba('regioes')}>Regiões</button>
            <button className={classe(aba === 'ocorrencias' && 'ativo')} onClick={() => setAba('ocorrencias')}>Ocorrências <span className="cont">{ocorrencias.size}</span></button>
          </div>
          <div className="rolavel" style={{ flex: 1 }}>
            {aba === 'alertas' && (alertas.length ? alertas.map((a) => (
              <div key={a.id} className={classe('alerta-item', a.reconhecido && 'lido')} onClick={() => { voar(a.lat, a.lng); if (a.ref?.tipo === 'equipamento') setSel({ tipo: 'eq', id: a.ref.id }); }}>
                <span className="bolinha" style={{ background: COR_NIVEL[a.nivel], boxShadow: `0 0 8px ${COR_NIVEL[a.nivel]}` }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="linha entre"><span className="h">{horaMin(a.ts)} · {a.categoria}</span>
                    {!a.reconhecido && <button className="btn peq fantasma" style={{ height: 22 }} onClick={(e) => { e.stopPropagation(); app.reconhecer(a.id); }}><Icone nome="check" tamanho={13} />ciente</button>}</div>
                  <div className="t">{a.titulo}</div>
                  <div className="dd">{a.detalhe}</div>
                </div>
              </div>)) : <div className="vazio">Nenhum alerta. A cidade está tranquila — por enquanto.</div>)}
            {aba === 'regioes' && regioesOrdenadas.map((r) => (
              <div key={r.bairro_id} className="alerta-item" onClick={() => { voar(bairro(r.bairro_id)?.lat, bairro(r.bairro_id)?.lng); setSel({ tipo: 'regiao', id: r.bairro_id }); }}>
                <span className="bolinha" style={{ background: COR_ESTADO[r.estado] }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="linha entre"><span className="t">{r.nome}</span><SeloRisco risco={r.riscoAgora} /></div>
                  <div className="dd">{r.motivos.length ? r.motivos.join(' · ') : `Operando normalmente · ${r.operacionais}/${r.equipamentos} equipamentos · ${r.agentesAtivos} agentes`}</div>
                </div>
              </div>))}
            {aba === 'ocorrencias' && ([...ocorrencias.values()].sort((a, b) => b.inicio - a.inicio).map((o) => (
              <div key={o.id} className="alerta-item" onClick={() => voar(o.lat, o.lng)}>
                <span className="bolinha" style={{ background: (meta.tiposOcorrencia.find((t) => t.id === o.tipo)?.peso || 0) >= 2.5 ? '#ff3d2e' : '#f2b33d' }} />
                <div style={{ flex: 1 }}><div className="t">{nomeOc(o.tipo)}{o.exercicio ? ' · exercício' : ''}</div><div className="dd">{bairro(o.bairro_id)?.nome} · {relativo(o.inicio)} · {o.status === 'aberta' ? 'aguardando agente' : o.status === 'atendimento' ? 'em atendimento' : o.status}</div></div>
              </div>)))}
          </div>
        </div>
      </div>

      {/* Máquina do tempo */}
      <div className="ov ov-base">
        <div className="vidro tempo">
          <div className="linha entre" style={{ marginBottom: 6 }}>
            <span className="linha"><Icone nome="relogio" tamanho={16} cor="var(--brasa2)" /><span className="modo">Máquina do tempo</span><span className="suave" style={{ fontSize: 12.5 }}>{rotuloTempo}</span></span>
            <span className="linha">
              {tempo?.evento && <span className="selo nivel-alto"><Icone nome="estadio" tamanho={12} />{tempo.evento.nome}</span>}
              {tempo && tempo.chuvaMm > 0 && <span className="selo nivel-medio"><Icone nome="chuva" tamanho={12} />{num(tempo.chuvaMm, 1)} mm/h</span>}
              {tempo && tempo.modo === 'passado' && <span className="selo">{tempo.ocorrencias.length} ocorrências · esperado {num(tempo.risco.reduce((s, r) => s + r.esperado, 0), 1)}</span>}
              <button className="btn peq" onClick={() => { if (offset >= 24) setOffset(-24); setTocando((t) => !t); }}><Icone nome={tocando ? 'fechar' : 'play'} tamanho={12} />{tocando ? 'Parar' : 'Reproduzir'}</button>
              <button className="btn peq" disabled={offset === 0} onClick={() => { setTocando(false); setOffset(0); }}>Agora</button>
            </span>
          </div>
          <input type="range" min={-24} max={24} step={1} value={offset} onChange={(e) => { setTocando(false); setOffset(Number(e.target.value)); }} aria-label="Máquina do tempo" />
          <div className="marcas"><span>−24h (histórico)</span><span>−12h</span><span style={{ color: 'var(--brasa2)' }}>agora</span><span>+12h</span><span>+24h (previsão)</span></div>
          <div className="legenda-risco" style={{ marginTop: 6 }}>Risco: <span><i style={{ background: corRisco(10) }} />baixo</span><span><i style={{ background: corRisco(30) }} />moderado</span><span><i style={{ background: corRisco(60) }} />alto</span><span><i style={{ background: corRisco(90) }} />crítico</span>
            <span style={{ marginLeft: 'auto' }}>ícone = tipo do equipamento · anel = situação · ◆ ocorrência · agentes: <b>T</b> trânsito, <b>G</b> guarda, <b>P</b> polícia</span></div>
        </div>
      </div>

      {sel?.tipo === 'eq' && <EquipamentoDetalhe id={sel.id} onFechar={() => setSel(null)} onEditar={(e) => { setSel(null); app.irPara({ pagina: 'inventario', equipamento: e.id }); }} />}
      {sel?.tipo === 'ag' && <AgenteDetalhe id={sel.id} onFechar={() => setSel(null)} />}
      {regiaoSel && <RegiaoDetalhe regiao={regiaoSel} onFechar={() => setSel(null)} />}
    </div>
  );
}

function Kp({ rotulo, v, suf, d, barra, cor }: { rotulo: string; v: React.ReactNode; suf?: string; d?: string; barra?: number; cor?: string }) {
  return (
    <div className="painel kpi">
      <span className="rotulo">{rotulo}</span>
      <span className="v" style={cor ? { color: cor } : undefined}>{v}{suf && <small>{suf}</small>}</span>
      {d && <span className="d">{d}</span>}
      {barra !== undefined && <div className="barra"><i style={{ width: `${barra * 100}%` }} /></div>}
    </div>
  );
}
