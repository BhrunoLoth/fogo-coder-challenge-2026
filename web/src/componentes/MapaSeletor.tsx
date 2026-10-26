import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useApp } from '../contexto';
import { adicionarMapaBase } from './mapaBase';

/** Mapa pequeno para escolher a localização com um clique (preenche GPS automaticamente). */
export function MapaSeletor({ lat, lng, onEscolher, cor = '#ff6a1a' }: { lat: number | null; lng: number | null; onEscolher: (lat: number, lng: number) => void; cor?: string }) {
  const { meta } = useApp();
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const mk = useRef<L.Marker | null>(null);
  const cb = useRef(onEscolher);
  cb.current = onEscolher;

  useEffect(() => {
    if (!div.current) return;
    const m = L.map(div.current, { zoomControl: true, attributionControl: false });
    const c = meta.cidade.centro;
    m.setView(lat && lng ? [lat, lng] : [c.lat, c.lng], lat && lng ? 15 : 13);
    adicionarMapaBase(m);
    for (const b of meta.bairros) L.polygon(b.poligono, { color: '#3a3f4a', weight: 1, fillOpacity: 0, interactive: false }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => cb.current(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)));
    mapa.current = m;
    setTimeout(() => m.invalidateSize(), 80);
    return () => { m.remove(); mapa.current = null; mk.current = null; };
  }, []);

  useEffect(() => {
    const m = mapa.current; if (!m || lat == null || lng == null) return;
    const icone = L.divIcon({ className: '', html: `<div class="mk mk-pulso" style="--c:${cor};width:18px;height:18px"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
    if (!mk.current) mk.current = L.marker([lat, lng], { icon: icone }).addTo(m);
    else mk.current.setLatLng([lat, lng]);
    if (!m.getBounds().contains([lat, lng])) m.panTo([lat, lng]);
  }, [lat, lng]);

  return <div ref={div} style={{ height: 220, borderRadius: 10, border: '1px solid var(--borda2)', overflow: 'hidden' }} />;
}
