import { MEDIDAS, fmtValor } from '../lib/camposPrevisao.js';
import { fmtDataHoraCurta, fmtJanela, pct } from '../lib/format.js';
import { entradasMudaram } from '../lib/previsaoUtil.js';

const IconeChuva = () => (
  <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M7 15a4 4 0 0 1 .6-7.95A5.5 5.5 0 0 1 18 8.5 3.5 3.5 0 0 1 17.5 15z" /><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" />
  </svg>
);
const IconeSol = () => (
  <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

// Previsão devolvida pelo backend: o front só exibe, não recalcula a classe nem usa o limiar.
// previsao: objeto de services/previsaoApi.js (normalizarPrevisao).
// consultadas: medidas da busca anterior (GET /weather-inputs), para avisar se mudaram.
export default function ResultadoPrevisao({ previsao, legenda, consultadas, reenvio }) {
  const { vaiChover, probabilidadePct, isMock, weather } = previsao;
  const completo = previsao.forecastStart != null;
  return (
    <div className="card previsao" role="status" aria-label="Resultado da previsão">
      {isMock && <p className="selo selo-mock">Resultado fictício para desenvolvimento</p>}
      <p className={`veredito ${vaiChover ? 'chuva' : 'seco'}`}>
        {vaiChover ? <IconeChuva /> : <IconeSol />}
        <strong>{vaiChover ? 'Chuva prevista' : 'Sem chuva prevista'}</strong>
      </p>
      <p className="prob"><strong>{pct(probabilidadePct)}</strong> de probabilidade estimada de chuva</p>
      {legenda && <p className="note">{legenda}</p>}
      {reenvio && <p className="note">Esta previsão já tinha sido salva antes. Mostramos o resultado salvo, sem criar uma previsão repetida.</p>}

      {completo && (
        <>
          <dl className="ficha">
            <div><dt>Período previsto</dt><dd>{fmtJanela(previsao.forecastStart, previsao.forecastEnd)}</dd></div>
            <div><dt>Gerada em</dt><dd>{fmtDataHoraCurta(previsao.createdAt) ?? 'não informado'}</dd></div>
          </dl>
          {/* Informações para quem quer conferir o cálculo: ficam disponíveis, mas recolhidas. */}
          <details className="detalhes-tecnicos">
            <summary>Detalhes técnicos</summary>
            <dl className="ficha">
              <div><dt>Modo</dt><dd>{previsao.mode === 'historical' ? 'Simulação histórica' : previsao.mode ?? 'não informado'}</dd></div>
              <div><dt>Limiar de decisão</dt><dd>{previsao.limiarPct == null ? 'não informado' : `${pct(previsao.limiarPct)} (a partir desta probabilidade, o resultado é “chuva prevista”)`}</dd></div>
              <div><dt>Versão do modelo</dt><dd><code>{previsao.modelVersion ?? 'não informada'}</code></dd></div>
              <div><dt>ID da previsão</dt><dd><code>{previsao.predictionId ?? 'não informado'}</code></dd></div>
            </dl>
          </details>
          {entradasMudaram(weather, consultadas) && (
            <p className="aviso" role="alert">As medições deste horário foram atualizadas depois da sua busca. Abaixo estão os valores realmente usados na previsão.</p>
          )}
          <h3 className="subtitulo">Medições usadas na previsão</h3>
          <TabelaMedidas weather={weather} referenceTime={previsao.referenceTime} previousReferenceTime={previsao.previousReferenceTime} />
        </>
      )}
    </div>
  );
}

// As 5 medidas (somente leitura), com unidade e o horário a que cada uma se refere.
export function TabelaMedidas({ weather, referenceTime, previousReferenceTime }) {
  return (
    <ul className="medidas">
      {MEDIDAS.map((m) => (
        <li key={m.id}>
          <span className="lbl">{m.rotulo}</span>
          <strong>{fmtValor(weather?.[m.id], m.unidade)}</strong>
          <small>{fmtDataHoraCurta(m.momento === 'T' ? referenceTime : previousReferenceTime) ?? 'horário não informado'}</small>
        </li>
      ))}
    </ul>
  );
}
