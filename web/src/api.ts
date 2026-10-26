/** Cliente da API do F.O.G.O. Envia o nome do operador para a trilha de auditoria. */
export function operador(): string {
  try { return localStorage.getItem('fogo.operador') || 'Operador'; } catch { return 'Operador'; }
}
export function definirOperador(nome: string) {
  try { localStorage.setItem('fogo.operador', nome); } catch { /* sem storage: segue com padrão */ }
}

export class ErroApi extends Error {
  constructor(msg: string, public status: number, public erros?: Record<string, string>) { super(msg); }
}

async function req<T>(metodo: string, url: string, corpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'X-Operador': encodeURIComponent(operador()) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroApi(dados.erro || `Erro ${r.status}`, r.status, dados.erros);
  return dados as T;
}

export const api = {
  get: <T,>(url: string) => req<T>('GET', url),
  post: <T,>(url: string, corpo?: unknown) => req<T>('POST', url, corpo ?? {}),
  put: <T,>(url: string, corpo: unknown) => req<T>('PUT', url, corpo),
  del: <T,>(url: string) => req<T>('DELETE', url),
};
