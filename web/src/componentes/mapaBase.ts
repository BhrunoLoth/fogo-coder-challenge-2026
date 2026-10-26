import L from 'leaflet';

/**
 * Mapa de fundo SEM chave de API.
 * 1º OpenStreetMap padrão, escurecido por filtro CSS (combina com a identidade "brasa").
 * Se falhar (sem internet, bloqueio de rede), cai para o Esri World Dark Gray.
 * Se nenhum carregar, o sistema segue funcionando: regiões, marcadores e previsões
 * não dependem do mapa de fundo.
 */
const PROVEDORES = [
  {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    opcoes: { maxZoom: 19, className: 'tiles-osm-escuro', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  },
  {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    opcoes: { maxZoom: 16, attribution: 'Tiles &copy; Esri' },
  },
];

export function adicionarMapaBase(mapa: L.Map) {
  let indice = 0, erros = 0;
  let camada = L.tileLayer(PROVEDORES[0].url, PROVEDORES[0].opcoes as L.TileLayerOptions).addTo(mapa);
  const aoErrar = () => {
    erros++;
    if (erros >= 6 && indice < PROVEDORES.length - 1) {
      mapa.removeLayer(camada);
      indice++; erros = 0;
      camada = L.tileLayer(PROVEDORES[indice].url, PROVEDORES[indice].opcoes as L.TileLayerOptions).addTo(mapa);
      camada.on('tileerror', aoErrar);
      camada.bringToBack();
    }
  };
  camada.on('tileerror', aoErrar);
  return camada;
}
