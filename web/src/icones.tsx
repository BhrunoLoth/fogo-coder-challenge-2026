/** Ícones desenhados para o F.O.G.O. (traço 24×24). Usados na interface e nos marcadores do mapa. */
export const PATHS: Record<string, string> = {
  radar: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M8.8 8.8a4.5 4.5 0 0 0 0 6.4M15.2 8.8a4.5 4.5 0 0 1 0 6.4',
  camera: 'M3 8h11l3-2v8l-3-2H3zM7 12v4M5 18h6',
  semaforo: 'M9 3h6v14H9zM12 6.5v.01M12 10v.01M12 13.5v.01M12 17v4',
  balanca: 'M4 20h16M6 20V9h12v11M9 9V6h6v3M9 14h6',
  fiscal: 'M3 15l2-5h11l3 5v3H3zM6 18v1M17 18v1M8 10l1-3h4l1 3M12 7V4',
  cancela: 'M4 21V7M2 21h4M4 9h17M8 9l-2 3M12 9l-2 3M16 9l-2 3M20 9l-2 3',
  totem: 'M8 3h8v18H8zM10 6h4v4h-4zM10 14h4M10 17h4',
  taxi: 'M4 16v-4l2-5h12l2 5v4zM4 16v2M20 16v2M7 13h.01M17 13h.01M10 4h4v3',
  mototaxi: 'M5 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M19 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M8 17h6l3-6h-4l-2 3M14 6h3',
  escolar: 'M4 5h16v11H4zM4 10h16M7 16v2M17 16v2M7 13h.01M17 13h.01',
  patinete: 'M6 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 18h8l-2-12h3',
  moto: 'M5 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M19 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M8 17l4-6h4l3 6M12 11l-2-3H7',
  viatura: 'M3 16v-4l2-5h14l2 5v4zM3 16v2M21 16v2M9 4h6M9 4v3M15 4v3M7 13h.01M17 13h.01',
  sensor: 'M12 3c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10zM9 14h6',
  painel: 'M3 5h18v10H3zM12 15v6M8 21h8M6 9h12M6 12h8',
  agente: 'M12 7m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M6 21v-2a6 6 0 0 1 12 0v2M8.5 4.5h7',
  // Interface
  central: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  inventario: 'M4 7l8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10',
  agentes: 'M9 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M3 20v-1a6 6 0 0 1 12 0v1M16 5a3 3 0 0 1 0 6M18 20v-1a5 5 0 0 0-2-4',
  previsao: 'M12 3a9 9 0 1 0 9 9M12 7v5l3 3M17 3h4v4M21 3l-6 6',
  registro: 'M6 3h12v18H6zM9 7h6M9 11h6M9 15h4',
  fogo: 'M12 3c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 1.5-5 3-6.5 0 2.5 1 4 2.5 4.5-.5-4 .5-7.5.5-10z',
  sino: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  filtro: 'M3 5h18l-7 8v6l-4 2v-8z',
  camadas: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  alvo: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 2v3M12 19v3M2 12h3M19 12h3',
  tela: 'M3 4h18v12H3zM8 20h8M12 16v4',
  mais: 'M12 5v14M5 12h14',
  fechar: 'M6 6l12 12M18 6L6 18',
  editar: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  lixo: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  check: 'M5 12l4 4L19 6',
  chave: 'M14 4a6 6 0 0 0-5.6 8.2L3 17.6V21h3.4l5.4-5.4A6 6 0 1 0 14 4zM16 8h.01',
  relogio: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2',
  chuva: 'M7 15a4 4 0 1 1 1-7.9A5 5 0 0 1 17.5 8 3.5 3.5 0 0 1 17 15zM8 18l-1 2M12 18l-1 2M16 18l-1 2',
  estadio: 'M3 9c0-2 4-4 9-4s9 2 9 4-4 4-9 4-9-2-9-4zM3 9v6c0 2 4 4 9 4s9-2 9-4V9',
  raio: 'M13 2L4 14h7l-1 8 9-12h-7z',
  busca: 'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-5-5',
  info: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v6M12 7.5v.01',
  seta: 'M5 12h14M13 6l6 6-6 6',
  play: 'M7 4l13 8-13 8z',
  ondas: 'M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0M2 17c2-3 4-3 6 0s4 3 6 0 4-3 6 0',
  escudo: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
};

export function Icone({ nome, tamanho = 18, cor = 'currentColor', traco = 1.8, className }: { nome: string; tamanho?: number; cor?: string; traco?: number; className?: string }) {
  return (
    <svg className={className} width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke={cor} strokeWidth={traco} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[nome] || PATHS.info} />
    </svg>
  );
}

/** HTML do marcador (Leaflet divIcon): ícone do tipo + anel na cor da situação. */
export function marcadorHtml(nome: string, cor: string, opts: { pulso?: boolean; tamanho?: number; apagado?: boolean } = {}) {
  const t = opts.tamanho || 26;
  return `<div class="mk${opts.pulso ? ' mk-pulso' : ''}${opts.apagado ? ' mk-apagado' : ''}" style="--c:${cor};width:${t}px;height:${t}px">
    <svg width="${t * 0.62}" height="${t * 0.62}" viewBox="0 0 24 24" fill="none" stroke="#f3efe8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[nome] || PATHS.info}"/></svg></div>`;
}
