import { useEffect, useState } from 'react';
import { backendConfigurado, verificarSaude } from '../services/previsaoApi.js';

// Linha de status do backend (GET /health): servidor no ar, modelo v6 carregado e banco configurado.
export default function StatusBackend() {
  const [saude, setSaude] = useState(() => (backendConfigurado() ? { status: 'carregando' } : { status: 'sem-config' }));

  useEffect(() => {
    if (!backendConfigurado()) return undefined;
    const ctrl = new AbortController();
    verificarSaude({ signal: ctrl.signal })
      .then((corpo) => setSaude({ status: 'ok', corpo }))
      .catch((e) => e?.name !== 'AbortError' && setSaude({ status: 'erro', mensagem: e.message }));
    return () => ctrl.abort();
  }, []);

  if (saude.status === 'sem-config') {
    return <p className="err" role="alert">Backend não configurado: preencha <code>VITE_API_URL</code> no arquivo <code>.env</code> (ex.: http://localhost:5000) e reinicie o <code>npm run dev</code>.</p>;
  }
  if (saude.status === 'carregando') return <p className="note status-backend">Verificando o backend…</p>;
  if (saude.status === 'erro') return <p className="err status-backend" role="alert">Backend indisponível: {saude.mensagem}</p>;

  const { model_loaded: modelo, database_configured: banco, model_version: versao } = saude.corpo;
  const problemas = [modelo === false && 'o modelo não foi carregado', banco === false && 'o banco não está configurado'].filter(Boolean);
  return (
    <div className="status-backend">
      <p className="note">
        <span className={`ponto ${problemas.length ? 'falha' : 'ok'}`} aria-hidden="true" /> Backend no ar
        {modelo && versao && <> · modelo <code>{versao}</code></>}
        {banco && ' · banco conectado'}
      </p>
      {problemas.length > 0 && <p className="err" role="alert">O backend respondeu, mas {problemas.join(' e ')}. As previsões não funcionarão até isso ser resolvido.</p>}
    </div>
  );
}
