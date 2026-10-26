import { Fragment, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../contexto';
import { Icone } from '../icones';
import type { Equipamento, Fator, Regiao, TipoExplicado } from '../types';
import { data, dataCurta, dataHora, hora, horaMin, mult, num, pct, relativo } from '../util';
import { Sparkline } from './graficos';
import { Carregando, Gaveta, SeloRisco, SeloSituacao } from './ui';

export const iconeDoTipo = (tipo: string) => ({ viatura_gcm: 'viatura', viatura_pm: 'viatura', moto_agente: 'moto', fiscal_autonomo: 'fiscal', sensor_alagamento: 'sensor' } as Record<string, string>)[tipo] || tipo;

type Detalhe = Equipamento & {
  semSinal: boolean; manutencoes: { id: number; data: number; tipo: string; motivo: string }[];
  historicoSituacao: { id: number; ts: number; de: string | null; para: string; motivo: string }[];
  telemetria: { dia: number; disponibilidade: number; leituras: number; erros: number }[];
  preditivo: { prob30: number; idade: number; sugerirAte: number | null; motivos: string[]; fatorMarca: number; razaoErros: number } | null;
  modeloTipo: { k: number; eta: number; mtbf: number; falhas: number; n: number } | null;
  fluxo: { obs: number; esp: number; z: number; ultimos: number[] } | null;
  auditoria: { id: number; ts: number; ator: string; acao: string; detalhes: string }[];
};

export function EquipamentoDetalhe({ id, onFechar, onEditar }: { id: number; onFechar: () => void; onEditar?: (e: Equipamento) => void }) {
  const { tipoEq, situacao, meta, toast, bump, versao } = useApp();
  const [d, setD] = useState<Detalhe | null>(null);
  const carregar = () => api.get<Detalhe>(`/api/equipamentos/${id}`).then(setD).catch((e) => toast(e.message, 'erro'));
  useEffect(() => { carregar(); }, [id, versao]);
  if (!d) return <Gaveta titulo="Equipamento" onFechar={onFechar}><Carregando /></Gaveta>;
  const t = tipoEq(d.tipo), s = situacao(d.situacao);
  const orgao = meta.orgaos.find((o) => o.id === d.orgao)?.nome;
  const manut = meta.manutencaoTipos.find((m) => m.id === d.manut_tipo)?.nome;
  const acao = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg, 'ok'); bump(); carregar(); } catch (e: any) { toast(e.message, 'erro'); } };
  const atrasada = d.manut_data && d.manut_data < Date.now() && d.situacao !== 'nao_instalado';
  return (
    <Gaveta onFechar={onFechar} larga
      icone={<div className="mk" style={{ ['--c' as any]: s.cor, width: 40, height: 40 }}><Icone nome={iconeDoTipo(d.tipo)} cor="#f3efe8" /></div>}
      titulo={<span className="linha">{t.nome}<span className="mono suave" style={{ fontSize: 14 }}>{d.serie}</span></span>}
      sub={<span className="linha" style={{ flexWrap: 'wrap' }}><SeloSituacao cor={s.cor} nome={s.nome} />{d.semSinal && <span className="selo nivel-critico"><i />Sem sinal (detectado pelo F.O.G.O.)</span>}<span>{d.marca} {d.modelo}</span></span>}
      rodape={<>
        {d.semSinal && <button className="btn perigo" onClick={() => acao(() => api.post(`/api/equipamentos/${id}/situacao`, { situacao: 'mau_funcionamento', motivo: 'Operador confirmou a perda de sinal detectada pelo F.O.G.O.' }), 'Situação atualizada')}>Confirmar falha</button>}
        {d.situacao !== 'operacional' && d.situacao !== 'nao_instalado' && d.situacao !== 'desativado' && <button className="btn ok" onClick={() => acao(() => api.post(`/api/equipamentos/${id}/manutencao`, { tipo: 'corretiva' }), 'Manutenção corretiva registrada')}><Icone nome="chave" />Registrar reparo</button>}
        {d.situacao === 'operacional' && <button className="btn" onClick={() => acao(() => api.post(`/api/equipamentos/${id}/manutencao`, { tipo: 'preventiva' }), 'Manutenção preventiva registrada')}><Icone nome="chave" />Registrar preventiva</button>}
        {onEditar && <button className="btn prim" onClick={() => onEditar(d)}><Icone nome="editar" />Editar</button>}
      </>}>
      <div className="grade g2" style={{ marginBottom: 18 }}>
        <div className="painel" style={{ padding: 14 }}>
          <div className="rotulo" style={{ marginBottom: 8 }}>Localização</div>
          <div style={{ fontWeight: 500 }}>{d.rua}{d.referencia ? `, ${d.referencia}` : ''}</div>
          <div className="suave">{d.bairro} · {d.cidade}/{d.uf} · CEP {d.cep}</div>
          <div className="mono fraco" style={{ fontSize: 12, marginTop: 4 }}>{d.lat.toFixed(5)}, {d.lng.toFixed(5)}</div>
        </div>
        <div className="painel" style={{ padding: 14 }}>
          <div className="rotulo" style={{ marginBottom: 8 }}>Manutenção</div>
          <div style={{ fontWeight: 500, color: d.manut_tipo === 'imediata' || atrasada ? 'var(--perigo)' : undefined }}>{manut}{atrasada ? ' — atrasada' : ''}</div>
          <div className="suave">{d.manut_data ? `Próxima: ${data(d.manut_data)} (${relativo(d.manut_data)})` : 'Sem data definida'}{d.manut_periodicidade_dias ? ` · a cada ${d.manut_periodicidade_dias} dias` : ''}</div>
          <div className="fraco" style={{ fontSize: 12, marginTop: 4 }}>Última: {d.ultima_manut ? data(d.ultima_manut) : '—'} · Instalado: {d.instalado_em ? data(d.instalado_em) : 'ainda não'}</div>
        </div>
      </div>

      {d.preditivo && (
        <div className="destaque" style={{ marginBottom: 18 }}>
          <div className="linha entre">
            <div><div className="rotulo" style={{ color: 'var(--brasa2)' }}>Manutenção preditiva</div>
              <div style={{ marginTop: 4 }}>Probabilidade de falhar nos próximos 30 dias</div></div>
            <div className="grande" style={{ color: d.preditivo.prob30 > 0.25 ? 'var(--brasa)' : 'var(--texto)' }}>{pct(d.preditivo.prob30, 0)}</div>
          </div>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: 'var(--suave)', fontSize: 13 }}>{d.preditivo.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
          {d.preditivo.sugerirAte && <div style={{ marginTop: 8, fontSize: 13 }}>Sugestão: agendar preventiva até <b>{data(d.preditivo.sugerirAte)}</b> (antes de o risco passar de 20%).</div>}
          {d.modeloTipo && <div className="fraco" style={{ fontSize: 11.5, marginTop: 8 }}>Modelo de Weibull do tipo: forma k = {d.modeloTipo.k}, vida característica η = {Math.round(d.modeloTipo.eta)} dias, MTBF ≈ {d.modeloTipo.mtbf} dias ({d.modeloTipo.falhas} falhas observadas em {d.modeloTipo.n} intervalos).</div>}
        </div>
      )}

      {d.fluxo && (
        <div className="painel" style={{ padding: 14, marginBottom: 18 }}>
          <div className="linha entre"><div className="rotulo">Telemetria ao vivo · veículos por minuto (30 min)</div>
            <span className={`selo ${Math.abs(d.fluxo.z) >= 3.5 ? 'nivel-critico' : 'nivel-baixo'}`}>z = {d.fluxo.z.toFixed(1)}</span></div>
          <div style={{ marginTop: 8 }}><Sparkline valores={d.fluxo.ultimos} largura={680} altura={46} /></div>
          <div className="suave" style={{ fontSize: 12.5, marginTop: 6 }}>Últimos 5 min: {d.fluxo.obs} veículos · esperado pelo pulso da cidade: {Math.round(d.fluxo.esp)}</div>
        </div>
      )}

      <div className="grade g2" style={{ marginBottom: 18 }}>
        <div>
          <div className="rotulo" style={{ marginBottom: 8 }}>Características ({t.nome})</div>
          <dl className="defs">
            <dt>Órgão responsável</dt><dd>{orgao}</dd>
            {t.atributos.map((a) => {
              const v = d.atributos[a.key];
              return <Fragment key={a.key}><dt>{a.label}</dt><dd>{v === undefined || v === '' ? '—' : a.tipo === 'bool' ? (v ? 'Sim' : 'Não') : `${v}${a.unidade ? ` ${a.unidade}` : ''}`}</dd></Fragment>;
            })}
          </dl>
        </div>
        <div>
          <div className="rotulo" style={{ marginBottom: 8 }}>Disponibilidade · 30 dias</div>
          {d.telemetria.length ? <>
            <Sparkline valores={d.telemetria.map((x) => x.disponibilidade * 100)} largura={300} altura={40} cor="var(--ok)" />
            <div className="rotulo" style={{ margin: '12px 0 6px' }}>Erros por dia</div>
            <Sparkline valores={d.telemetria.map((x) => x.erros)} largura={300} altura={36} cor="var(--aviso)" />
          </> : <div className="fraco">Sem telemetria (equipamento ainda não instalado).</div>}
        </div>
      </div>

      <div className="grade g2">
        <div>
          <div className="rotulo" style={{ marginBottom: 8 }}>Histórico de situação</div>
          {d.historicoSituacao.map((h) => <div key={h.id} style={{ fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid #1d2026' }}>
            <span className="mono fraco">{data(h.ts)} {horaMin(h.ts)}</span> · {h.de ? `${situacao(h.de)?.nome} → ` : ''}<b>{situacao(h.para)?.nome}</b><div className="fraco">{h.motivo}</div></div>)}
        </div>
        <div>
          <div className="rotulo" style={{ marginBottom: 8 }}>Manutenções ({(d as any).manutencoesTotal ?? d.manutencoes.length})</div>
          {d.manutencoes.length ? d.manutencoes.slice(0, 8).map((m) => <div key={m.id} style={{ fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid #1d2026' }}>
            <span className="mono fraco">{data(m.data)}</span> · <b style={{ color: m.tipo === 'corretiva' ? 'var(--aviso)' : 'var(--ok)' }}>{m.tipo}</b><div className="fraco">{m.motivo}</div></div>) : <div className="fraco">Nenhuma registrada.</div>}
        </div>
      </div>
    </Gaveta>
  );
}

export function AgenteDetalhe({ id, onFechar }: { id: number; onFechar: () => void }) {
  const { meta, nomeOc } = useApp();
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get(`/api/agentes/${id}`).then(setD); }, [id]);
  if (!d) return <Gaveta titulo="Agente" onFechar={onFechar}><Carregando /></Gaveta>;
  const st = meta.statusAgente.find((s) => s.id === d.status)!;
  const tipo = meta.tiposAgente.find((t) => t.id === d.tipo)!;
  return (
    <Gaveta onFechar={onFechar} titulo={d.nome} sub={<span className="linha"><span className="selo" style={{ color: st.cor }}><i />{st.nome}</span>{tipo.nome} · {d.matricula}</span>}
      icone={<div className="mk" style={{ ['--c' as any]: st.cor, width: 40, height: 40 }}><Icone nome="agente" cor="#f3efe8" /></div>}>
      <dl className="defs" style={{ marginBottom: 18 }}>
        <dt>Órgão</dt><dd>{meta.orgaos.find((o) => o.id === d.orgao)?.nome}</dd>
        <dt>Turno</dt><dd>{meta.turnos.find((t) => t.id === d.turno)?.nome}</dd>
        <dt>Bairro de atuação</dt><dd>{d.bairro}</dd>
        <dt>Telefone</dt><dd>{d.telefone || '—'}</dd>
        <dt>Veículo</dt><dd>{d.veiculo_serie || '—'}</dd>
      </dl>
      {d.ocorrencia && <div className="destaque" style={{ marginBottom: 18 }}><div className="rotulo" style={{ color: 'var(--brasa2)' }}>Atendendo agora</div><div style={{ marginTop: 4 }}>{nomeOc(d.ocorrencia.tipo)} · desde {dataHora(d.ocorrencia.inicio)}</div></div>}
      <div className="rotulo" style={{ marginBottom: 8 }}>Últimos atendimentos</div>
      {d.atendimentos.length ? d.atendimentos.map((o: any) => <div key={o.id} style={{ fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid #1d2026' }}><span className="mono fraco">{dataHora(o.inicio)}</span> · {nomeOc(o.tipo)} · {o.bairro}</div>) : <div className="fraco">Nenhum atendimento registrado ainda.</div>}
    </Gaveta>
  );
}

type Explicacao = { risco: number; nivel: string; desvio: number; fatores: Fator[]; tipos: TipoExplicado[]; considerado: string[]; hora: number };

export function PainelFatores({ fatores }: { fatores: Fator[] }) {
  return (
    <div>
      {fatores.map((f) => {
        const l = Math.log(f.mult), w = Math.min(50, Math.abs(l) * 45);
        return (
          <div className="fator" key={f.id}>
            <span>{f.nome}</span>
            <span className="mult" style={{ color: f.mult > 1.05 ? 'var(--brasa2)' : f.mult < 0.95 ? 'var(--ok)' : 'var(--suave)' }}>{mult(f.mult)}</span>
            <div className="trilho"><i style={{ left: l >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: l >= 0 ? 'var(--brasa)' : 'var(--ok)' }} /></div>
          </div>
        );
      })}
    </div>
  );
}

export function Explicacao({ bairroId, horaTs }: { bairroId: number; horaTs: number }) {
  const [e, setE] = useState<Explicacao | null>(null);
  useEffect(() => { setE(null); api.get<Explicacao>(`/api/previsao/explicar?bairro=${bairroId}&hora=${horaTs}`).then(setE); }, [bairroId, horaTs]);
  if (!e) return <Carregando texto="Calculando explicação…" />;
  return (
    <div className="coluna" style={{ gap: 14 }}>
      <div className="linha" style={{ gap: 12 }}>
        <SeloRisco risco={e.risco} comNome />
        <span className="suave">às {hora(e.hora)} de {dataCurta(e.hora)} · <b style={{ color: e.desvio > 1.2 ? 'var(--brasa2)' : 'var(--texto)' }}>{num(e.desvio, 2)}×</b> o normal para o horário</span>
      </div>
      <div>
        <div className="rotulo" style={{ marginBottom: 6 }}>Por que esse risco? (fatores multiplicativos)</div>
        <PainelFatores fatores={e.fatores} />
      </div>
      <div>
        <div className="rotulo" style={{ marginBottom: 6 }}>O que pode acontecer (na hora)</div>
        {e.tipos.map((t) => (
          <div key={t.tipo} className="linha entre" style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px solid #1d2026' }}>
            <span>{t.nome}</span><span className="mono suave">{pct(t.prob, 1)} de chance · {pct(t.contribuicao, 0)} do risco</span>
          </div>
        ))}
      </div>
      <div>
        <div className="rotulo" style={{ marginBottom: 6 }}>Informações consideradas</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--suave)', fontSize: 12.5 }}>{e.considerado.map((c) => <li key={c}>{c}</li>)}</ul>
      </div>
    </div>
  );
}

export function RegiaoDetalhe({ regiao, onFechar }: { regiao: Regiao; onFechar: () => void }) {
  const { irPara } = useApp();
  const horaAlvo = regiao.pico6h ? regiao.pico6h.hora : Date.now();
  return (
    <Gaveta onFechar={onFechar} titulo={regiao.nome} sub={`Zona ${regiao.zona} · região de influência calculada por diagrama de Voronoi`}
      rodape={<><button className="btn" onClick={() => { onFechar(); irPara({ pagina: 'inventario', bairro: regiao.bairro_id }); }}>Ver equipamentos</button>
        <button className="btn prim" onClick={() => { onFechar(); irPara({ pagina: 'previsao', bairro: regiao.bairro_id }); }}>Ver previsão completa</button></>}>
      <div className="grade g3" style={{ marginBottom: 16 }}>
        <div className="painel kpi"><span className="rotulo">Risco agora</span><span className="v"><SeloRisco risco={regiao.riscoAgora} /></span></div>
        <div className="painel kpi"><span className="rotulo">Equipamentos</span><span className="v">{regiao.operacionais}<small>/{regiao.equipamentos}</small></span><span className="d">{pct(regiao.disponibilidade, 0)} disponíveis</span></div>
        <div className="painel kpi"><span className="rotulo">Agentes ativos</span><span className="v">{regiao.agentesAtivos}</span><span className="d">{regiao.ocorrenciasAbertas} ocorrência(s) aberta(s)</span></div>
      </div>
      {regiao.motivos.length > 0 && <div className="destaque" style={{ marginBottom: 16 }}><div className="rotulo" style={{ color: 'var(--brasa2)', marginBottom: 6 }}>Exige atenção</div>{regiao.motivos.map((m) => <div key={m}>• {m}</div>)}</div>}
      <h3 style={{ fontSize: 15, marginBottom: 10 }}>Pico de risco nas próximas 6 horas</h3>
      <Explicacao bairroId={regiao.bairro_id} horaTs={horaAlvo} />
    </Gaveta>
  );
}
