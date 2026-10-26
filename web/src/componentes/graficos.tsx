/**
 * Gráficos em SVG puro (sem biblioteca), coerentes com a proposta do projeto:
 * tudo legível, tudo nosso.
 */
import { useState } from 'react';

export function Sparkline({ valores, largura = 120, altura = 28, cor = 'var(--brasa)', preencher = true }: { valores: number[]; largura?: number; altura?: number; cor?: string; preencher?: boolean }) {
  if (!valores.length) return null;
  const max = Math.max(...valores, 1), min = Math.min(...valores, 0);
  const x = (i: number) => (i / Math.max(1, valores.length - 1)) * largura;
  const y = (v: number) => altura - 2 - ((v - min) / (max - min || 1)) * (altura - 4);
  const d = valores.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg width={largura} height={altura} style={{ display: 'block' }}>
      {preencher && <path d={`${d}L${largura},${altura}L0,${altura}Z`} fill={cor} opacity={0.12} />}
      <path d={d} fill="none" stroke={cor} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

type Serie = { nome: string; cor: string; valores: (number | null)[]; tracejado?: boolean; area?: boolean };

/** Gráfico de linhas com eixos, grade e tooltip ao passar o mouse. */
export function Linhas({ series, rotulos, altura = 220, formatoY = (v: number) => String(Math.round(v)), minY, maxY, marcadores = [] }: {
  series: Serie[]; rotulos: string[]; altura?: number; formatoY?: (v: number) => string; minY?: number; maxY?: number;
  marcadores?: { indice: number; texto: string; cor?: string }[];
}) {
  const [foco, setFoco] = useState<number | null>(null);
  const L = 800, M = { t: 14, r: 14, b: 26, l: 46 };
  const W = L - M.l - M.r, H = altura - M.t - M.b;
  const todos = series.flatMap((s) => s.valores.filter((v): v is number => v !== null));
  const min = minY ?? Math.min(0, ...todos);
  // Escala "redonda" (1, 2, 2.5, 5 × 10^n) para os rótulos do eixo ficarem legíveis.
  const bruto = (maxY ?? Math.max(...todos, 1) * 1.05) - min;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto / 4 || 1)));
  const passoY = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p * 4 >= bruto) || pot * 10;
  const max = maxY ?? min + passoY * 4;
  const n = rotulos.length;
  const x = (i: number) => M.l + (i / Math.max(1, n - 1)) * W;
  const y = (v: number) => M.t + H - ((v - min) / (max - min || 1)) * H;
  const ticks = 4;
  const passo = Math.max(1, Math.ceil(n / 8));
  return (
    <div style={{ position: 'relative' }}>
      <svg className="svg-graf" viewBox={`0 0 ${L} ${altura}`} width="100%" preserveAspectRatio="none" style={{ display: 'block', height: altura }}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * L; setFoco(Math.max(0, Math.min(n - 1, Math.round(((px - M.l) / W) * (n - 1))))); }}
        onMouseLeave={() => setFoco(null)}>
        {Array.from({ length: ticks + 1 }, (_, k) => { const v = min + ((max - min) * k) / ticks; return (
          <g key={k}><line className="eixo" x1={M.l} x2={L - M.r} y1={y(v)} y2={y(v)} strokeDasharray={k ? '2 4' : undefined} />
            <text x={M.l - 8} y={y(v) + 3} textAnchor="end">{formatoY(v)}</text></g>); })}
        {rotulos.map((r, i) => (i % passo === 0 ? <text key={i} x={x(i)} y={altura - 8} textAnchor="middle">{r}</text> : null))}
        {marcadores.map((m, k) => (
          <g key={k}><line x1={x(m.indice)} x2={x(m.indice)} y1={M.t} y2={M.t + H} stroke={m.cor || 'var(--brasa2)'} strokeDasharray="3 3" opacity={0.7} />
            <text x={x(m.indice) + 4} y={M.t + 10} style={{ fill: m.cor || 'var(--brasa2)' }}>{m.texto}</text></g>))}
        {series.map((s, si) => {
          const pts = s.valores.map((v, i) => (v === null ? null : [x(i), y(v)] as const));
          let d = ''; let aberto = false;
          pts.forEach((p) => { if (!p) { aberto = false; return; } d += `${aberto ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`; aberto = true; });
          const primeiro = pts.findIndex(Boolean), ultimo = pts.length - 1 - [...pts].reverse().findIndex(Boolean);
          return (
            <g key={si}>
              {s.area && primeiro >= 0 && <path d={`${d}L${x(ultimo)},${y(min)}L${x(primeiro)},${y(min)}Z`} fill={s.cor} opacity={0.1} />}
              <path d={d} fill="none" stroke={s.cor} strokeWidth={2} strokeDasharray={s.tracejado ? '5 4' : undefined} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {foco !== null && <line x1={x(foco)} x2={x(foco)} y1={M.t} y2={M.t + H} stroke="#fff" opacity={0.25} />}
        {foco !== null && series.map((s, si) => s.valores[foco] !== null ? <circle key={si} cx={x(foco)} cy={y(s.valores[foco] as number)} r={3.5} fill={s.cor} /> : null)}
      </svg>
      {foco !== null && (
        <div style={{ position: 'absolute', top: 6, left: `${Math.min(70, (x(foco) / L) * 100)}%`, background: '#1b1e25', border: '1px solid var(--borda2)', borderRadius: 8, padding: '6px 9px', fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          <div className="fraco mono">{rotulos[foco]}</div>
          {series.map((s) => s.valores[foco] !== null && <div key={s.nome} className="linha"><i style={{ width: 8, height: 8, borderRadius: 2, background: s.cor, display: 'inline-block' }} />{s.nome}: <b className="mono">{formatoY(s.valores[foco] as number)}</b></div>)}
        </div>
      )}
      <div className="linha" style={{ gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
        {series.map((s) => <span key={s.nome} className="linha suave" style={{ fontSize: 12 }}><i style={{ width: 14, height: 3, background: s.cor, display: 'inline-block', borderRadius: 2 }} />{s.nome}</span>)}
      </div>
    </div>
  );
}

/** Barras horizontais simples com rótulo e valor. */
export function BarrasH({ itens, formato = (v: number) => String(v), cor = 'var(--brasa)' }: { itens: { rotulo: string; valor: number; cor?: string; extra?: string }[]; formato?: (v: number) => string; cor?: string }) {
  const max = Math.max(...itens.map((i) => i.valor), 1e-9);
  return (
    <div className="coluna" style={{ gap: 7 }}>
      {itens.map((i) => (
        <div key={i.rotulo} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 38%) 1fr 64px', gap: 10, alignItems: 'center', fontSize: 12.5 }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={i.rotulo}>{i.rotulo}</span>
          <div className="barra" style={{ marginTop: 0, height: 8 }}><i style={{ width: `${(i.valor / max) * 100}%`, background: i.cor || cor }} /></div>
          <span className="mono" style={{ textAlign: 'right' }}>{formato(i.valor)}</span>
        </div>
      ))}
    </div>
  );
}

/** Gráfico de calibração: previsto x observado (diagonal = perfeito). */
export function Calibracao({ pontos }: { pontos: { previsto: number; observado: number; n: number }[] }) {
  const S = 240, M = 30, W = S - 2 * M;
  const max = Math.max(0.5, ...pontos.map((p) => Math.max(p.previsto, p.observado))) * 1.05;
  const t = (v: number) => (v / max) * W;
  return (
    <svg className="svg-graf" viewBox={`0 0 ${S} ${S}`} width="100%" style={{ maxWidth: 300, display: 'block' }}>
      <rect x={M} y={M} width={W} height={W} fill="none" className="eixo" />
      <line x1={M} y1={M + W} x2={M + W} y2={M} stroke="#555b66" strokeDasharray="4 4" />
      {[0, 0.25, 0.5, 0.75, 1].map((k) => <text key={k} x={M - 5} y={M + W - k * W + 3} textAnchor="end">{Math.round(k * max * 100)}%</text>)}
      {[0, 0.5, 1].map((k) => <text key={k} x={M + k * W} y={S - 10} textAnchor="middle">{Math.round(k * max * 100)}%</text>)}
      {pontos.map((p, i) => <circle key={i} cx={M + t(p.previsto)} cy={M + W - t(p.observado)} r={Math.max(3, Math.min(9, Math.sqrt(p.n) / 3))} fill="var(--brasa)" opacity={0.85} />)}
      <text x={M + W / 2} y={14} textAnchor="middle" style={{ fill: 'var(--suave)' }}>observado × previsto</text>
    </svg>
  );
}
