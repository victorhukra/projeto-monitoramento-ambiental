import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { listarPrevisoes } from '../services/previsaoApi.js';
import { fmtDataHoraCurta, fmtDataIso, fmtJanela, hojeEmLondrina, inicioDoDia, pct, somarDias } from '../lib/format.js';
import { juntarSemDuplicar } from '../lib/previsaoUtil.js';
import { Empty } from './Panels.jsx';

// Histórico de previsões executadas (GET /predictions). O filtro é pelo dia em que a previsão foi GERADA
// (created_at), não pela data histórica de referência: uma simulação de setembro feita hoje aparece hoje.
const POR_PAGINA = 20;

const HistoricoBusca = forwardRef(function HistoricoBusca({ atualizacao = 0 }, ref) {
  const hoje = hojeEmLondrina();
  const [de, setDe] = useState(() => somarDias(hoje, -6)); // últimos 7 dias, incluindo hoje
  const [ate, setAte] = useState(hoje);
  const [filtro, setFiltro] = useState(() => ({ de: somarDias(hoje, -6), ate: hoje }));
  const [lista, setLista] = useState({ status: 'carregando', itens: [], cursor: null }); // carregando | sucesso | erro
  const [maisCarregando, setMaisCarregando] = useState(false);
  const [erroMais, setErroMais] = useState(null);
  const pedido = useRef(null);

  // Intervalo [início do dia "de", início do dia seguinte a "até"), em horário de Londrina.
  const intervalo = useCallback((f) => ({ createdFrom: inicioDoDia(f.de), createdTo: inicioDoDia(somarDias(f.ate, 1)) }), []);

  // Primeira página: ao abrir, ao mudar o filtro e depois de cada previsão salva (atualizacao).
  useEffect(() => {
    pedido.current?.abort();
    const ctrl = (pedido.current = new AbortController());
    setLista((l) => ({ ...l, status: 'carregando' }));
    setErroMais(null);
    listarPrevisoes({ ...intervalo(filtro), limit: POR_PAGINA }, { signal: ctrl.signal })
      .then(({ itens, proximoCursor }) => !ctrl.signal.aborted && setLista({ status: 'sucesso', itens: juntarSemDuplicar([], itens), cursor: proximoCursor }))
      .catch((e) => e?.name !== 'AbortError' && !ctrl.signal.aborted && setLista({ status: 'erro', itens: [], cursor: null, mensagem: e.message }));
    return () => ctrl.abort();
  }, [filtro, atualizacao, intervalo]);

  async function carregarMais() {
    const ctrl = (pedido.current = new AbortController());
    setMaisCarregando(true);
    setErroMais(null);
    try {
      const { itens, proximoCursor } = await listarPrevisoes({ ...intervalo(filtro), limit: POR_PAGINA, cursor: lista.cursor }, { signal: ctrl.signal });
      setLista((l) => ({ ...l, itens: juntarSemDuplicar(l.itens, itens), cursor: proximoCursor }));
    } catch (e) {
      if (e?.name !== 'AbortError') setErroMais(e.message);
    } finally {
      setMaisCarregando(false);
    }
  }

  function consultar(e) {
    e.preventDefault();
    if (!de || !ate || de > ate) return;
    setFiltro({ de, ate });
  }

  const invalido = !de || !ate || de > ate;
  const carregando = lista.status === 'carregando';
  return (
    <section className="card" aria-labelledby="t-historico" ref={ref} tabIndex={-1}>
      <h2 id="t-historico">Histórico de previsões</h2>
      <p className="note">Previsões já executadas, da mais recente para a mais antiga. O filtro usa o dia em que a previsão foi gerada (horário de Londrina).</p>
      <form className="acoes" onSubmit={consultar}>
        <div className="campo">
          <label htmlFor="hist-de">Geradas de</label>
          <input id="hist-de" type="date" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="hist-ate">até</label>
          <input id="hist-ate" type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} />
        </div>
        <button type="submit" className="btn" disabled={invalido || carregando}>{carregando ? 'Consultando…' : 'Consultar'}</button>
      </form>
      {invalido && <p className="campo-erro">A data inicial precisa ser anterior ou igual à final.</p>}

      <div className="resultado" aria-live="polite">
        {carregando && !lista.itens.length && <Empty>Consultando o histórico…</Empty>}
        {lista.status === 'erro' && <p className="err" role="alert">Não foi possível consultar o histórico: {lista.mensagem}</p>}
        {lista.status === 'sucesso' && !lista.itens.length && (
          <Empty>Nenhuma previsão gerada entre {fmtDataIso(filtro.de)} e {fmtDataIso(filtro.ate)}.</Empty>
        )}
        {lista.itens.length > 0 && lista.status !== 'erro' && (
          <div className="scroll">
            <table>
              <caption className="sr">Previsões geradas entre {fmtDataIso(filtro.de)} e {fmtDataIso(filtro.ate)}</caption>
              <thead>
                <tr><th>Gerada em</th><th>Referência</th><th>Período previsto</th><th>Resultado</th><th>Probabilidade estimada</th><th>Versão</th><th>ID</th></tr>
              </thead>
              <tbody>
                {lista.itens.map((p) => (
                  <tr key={p.predictionId ?? `${p.requestId}-${p.createdAt}`}>
                    <td>{fmtDataHoraCurta(p.createdAt) ?? '—'}</td>
                    <td>{fmtDataHoraCurta(p.referenceTime) ?? '—'}</td>
                    <td>{fmtJanela(p.forecastStart, p.forecastEnd)}</td>
                    <td>{p.vaiChover ? 'Chuva prevista' : 'Sem chuva prevista'}{p.isMock && <span className="selo selo-mock">fictício</span>}</td>
                    <td>{pct(p.probabilidadePct)}</td>
                    <td><code>{p.modelVersion ?? '—'}</code></td>
                    <td><code title={p.predictionId ?? ''}>{p.predictionId ? `${p.predictionId.slice(0, 8)}…` : '—'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {lista.status === 'sucesso' && lista.cursor && (
          <div className="acoes mais">
            <button type="button" className="link" onClick={carregarMais} disabled={maisCarregando}>{maisCarregando ? 'Carregando…' : 'Carregar mais'}</button>
          </div>
        )}
        {erroMais && <p className="err" role="alert">Não foi possível carregar mais previsões: {erroMais}</p>}
      </div>
    </section>
  );
});

export default HistoricoBusca;
