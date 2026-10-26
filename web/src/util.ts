// Horário de Marília (UTC-3, fixo), independentemente do fuso do computador.
const OFFSET = -3 * 3600e3;
const d = (ts: number) => new Date(ts + OFFSET);
const p2 = (n: number) => String(n).padStart(2, '0');

export const hora = (ts: number) => `${p2(d(ts).getUTCHours())}h`;
export const horaMin = (ts: number) => `${p2(d(ts).getUTCHours())}:${p2(d(ts).getUTCMinutes())}`;
export const data = (ts: number) => `${p2(d(ts).getUTCDate())}/${p2(d(ts).getUTCMonth() + 1)}/${d(ts).getUTCFullYear()}`;
export const dataCurta = (ts: number) => `${p2(d(ts).getUTCDate())}/${p2(d(ts).getUTCMonth() + 1)}`;
export const dataHora = (ts: number) => `${dataCurta(ts)} ${horaMin(ts)}`;
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const diaSemana = (ts: number) => DIAS[d(ts).getUTCDay()];

export function relativo(ts: number, agora = Date.now()) {
  const s = Math.round((agora - ts) / 1000);
  if (Math.abs(s) < 45) return 'agora';
  const fut = s < 0, a = Math.abs(s);
  const txt = a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} d`;
  return fut ? `em ${txt}` : `há ${txt}`;
}

export const pct = (x: number, casas = 1) => `${(x * 100).toFixed(casas).replace('.', ',')}%`;
export const num = (x: number, casas = 0) => x.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const mult = (x: number) => `×${x.toFixed(2).replace('.', ',')}`;

export function corRisco(r: number) {
  if (r >= 75) return '#ff3d2e';
  if (r >= 50) return '#ff7a1a';
  if (r >= 25) return '#f2b33d';
  return '#3a8f6a';
}
export const nomeNivel: Record<string, string> = { critico: 'Crítico', alto: 'Alto', moderado: 'Moderado', baixo: 'Baixo' };
export const nivelDe = (r: number) => (r >= 75 ? 'critico' : r >= 50 ? 'alto' : r >= 25 ? 'moderado' : 'baixo');

/** Escapa texto antes de colocar em HTML (tooltips do mapa): evita XSS com dados digitados. */
export function esc(v: unknown) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

export function classe(...xs: (string | false | null | undefined)[]) { return xs.filter(Boolean).join(' '); }
