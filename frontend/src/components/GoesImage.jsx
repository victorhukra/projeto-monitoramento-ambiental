import { useState } from 'react';

const BASE_URL = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

export default function GoesImage({ referenceTime }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  if (!BASE_URL) {
    return (
      <section className="goes-image card" aria-labelledby="goes-title">
        <h3 id="goes-title" className="subtitulo">Imagem de satélite GOES</h3>
        <p className="err" role="alert">Backend não configurado: confira VITE_API_URL no arquivo .env do Front-end.</p>
      </section>
    );
  }


  const url = `${BASE_URL}/goes-image?reference_time=${encodeURIComponent(referenceTime)}`;


  return (
    <section className="goes-image card" aria-labelledby="goes-title">
      <h3 id="goes-title" className="subtitulo">Imagem de satélite GOES</h3>
      <p className="note">Imagem infravermelha correspondente ao horário selecionado.</p>
      {loading && !error && <p className="empty" role="status">Carregando imagem de satélite…</p>}
      {error ? (
        <p className="empty" role="status">Imagem GOES indisponível para este horário.</p>
      ) : (
        <img
          className="goes-image-preview"
          src={url}
          alt={`Imagem de satélite GOES referente a ${referenceTime}`}
          onLoad={() => setLoading(false)}
          onError={() => { setLoading(false); setError(true); }}
        />
      )}
    </section>
  );
}
