import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Limite oficial do município: API de malhas do IBGE, código 4113700, qualidade máxima, malha municipal 2022
// (a mais recente que a API oferece). Arquivo estático: o site não consulta o IBGE a cada visita.
import boundary from '../data/londrina-ibge.json';
import { mm, celsius, fmtDateTime } from '../lib/format.js';

const coord = (v) => v.toFixed(3).replace('.', ',');

// Mapa de Londrina: OpenStreetMap + limite do município + ponto de medição dos dados (latitude/longitude do banco).
// Abre enquadrando o município inteiro.
export default function CityMap({ station, city, at, loading = false, visible = true }) {
  const el = useRef(null);
  const map = useRef(null);

  // Cria o mapa uma vez, com o limite do município.
  useEffect(() => {
    const m = L.map(el.current, { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', // crédito exigido pela licença do OSM; as demais fontes ficam no rodapé
    }).addTo(m);
    const area = L.geoJSON(boundary, { style: { color: '#2563EB', weight: 2, fillColor: '#2563EB', fillOpacity: 0.08 } }).addTo(m);
    m.fitBounds(area.getBounds(), { padding: [12, 12] }); // município inteiro ao carregar
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  // Ponto de medição: refeito quando chegam dados novos.
  useEffect(() => {
    if (!map.current || !station) return undefined;
    const tip = document.createElement('span'); // texto puro (sem innerHTML)
    tip.textContent = `Ponto de medição · chuva ${mm(city?.rainMm)} · ${celsius(city?.tempC)}${at ? ` · ${fmtDateTime(at)}` : ''}`;
    const marker = L.circleMarker([station.lat, station.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#173B67', fillOpacity: 1 })
      .bindTooltip(tip)
      .addTo(map.current);
    return () => marker.remove();
  }, [station, city, at]);

  // O painel fica montado ao trocar de tela para preservar os tiles e impedir o flash branco ao retornar.
  // Leaflet precisa recalcular as dimensões depois que o elemento sai de display:none.
  useEffect(() => {
    if (!visible || !map.current) return undefined;
    const frame = window.requestAnimationFrame(() => map.current?.invalidateSize({ pan: false, animate: false }));
    return () => window.cancelAnimationFrame(frame);
  }, [visible]);

  return (
    <>
      <div ref={el} className="city-map" role="region" aria-label="Mapa de Londrina com o limite do município e o ponto de medição" />
      <p className="note">
        {station ? `Ponto de medição dos dados: latitude ${coord(station.lat)}, longitude ${coord(station.lon)}.`
          : loading ? 'Carregando o ponto de medição…' : 'Ponto de medição indisponível.'}
        {' '}Linha azul: limite do município.
      </p>
    </>
  );
}
