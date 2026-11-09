import { useEffect, useState } from 'react';
import { verificarSaude } from '../services/previsaoApi.js';
import { mensagemParaUsuario, registrarErro } from '../lib/mensagensErro.js';
import { ErroComNovaTentativa } from './Panels.jsx';

// Disponibilidade do serviço de previsão (GET /health), em linguagem simples.
// O detalhe técnico (modelo não carregado, banco não configurado, versão) fica só no console.
// Sem VITE_API_URL, verificarSaude lança um erro amigável e deixa a instrução técnica no console.
export default function StatusBackend() {
  const [saude, setSaude] = useState({ status: 'carregando' });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    verificarSaude({ signal: ctrl.signal })
      .then((corpo) => {
        const problemas = [corpo.model_loaded === false && 'modelo não carregado', corpo.database_configured === false && 'banco não configurado'].filter(Boolean);
        if (problemas.length) registrarErro('Serviço de previsão com problemas (GET /health)', { problemas, corpo });
        setSaude({ status: problemas.length ? 'com-problemas' : 'ok' });
      })
      .catch((e) => e?.name !== 'AbortError' && setSaude({ status: 'erro', mensagem: mensagemParaUsuario(e) }));
    return () => ctrl.abort();
  }, [tentativa]);

  function tentarDeNovo() {
    setSaude({ status: 'carregando' });
    setTentativa((t) => t + 1);
  }

  if (saude.status === 'carregando') return <p className="note status-backend">Verificando se o serviço de previsão está disponível…</p>;
  if (saude.status === 'erro') {
    return <ErroComNovaTentativa onTentar={tentarDeNovo}>O serviço de previsão não está disponível agora. {saude.mensagem}</ErroComNovaTentativa>;
  }
  if (saude.status === 'com-problemas') {
    return <p className="err status-backend" role="alert">O serviço de previsão está com problemas e não consegue gerar previsões agora. Tente novamente mais tarde.</p>;
  }
  return (
    <p className="note status-backend">
      <span className="ponto ok" aria-hidden="true" /> Serviço de previsão disponível
    </p>
  );
}
