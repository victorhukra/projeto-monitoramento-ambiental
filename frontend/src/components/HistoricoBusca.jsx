import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { excluirPrevisao, listarPrevisoes } from '../services/previsaoApi.js';
import { fmtDataHoraCurta, fmtDataIso, fmtJanela, hojeEmLondrina, inicioDoDia, pct, somarDias } from '../lib/format.js';
import { juntarSemDuplicar } from '../lib/previsaoUtil.js';
import { Empty, ErroComNovaTentativa } from './Panels.jsx';
import { mensagemParaUsuario } from '../lib/mensagensErro.js';

// Histórico de previsões executadas (GET /predictions). O filtro é pelo dia em que a previsão foi GERADA
// (created_at), não pela data histórica de referência: uma simulação de setembro feita hoje aparece hoje.
const POR_PAGINA = 20;

// Filtro padrão: últimos 7 dias, incluindo hoje (horário de Londrina), calculado na hora da consulta.
const ultimaSemana = () => {
  const hoje = hojeEmLondrina();
  return { de: somarDias(hoje, -6), ate: hoje };
};

const HistoricoBusca = forwardRef(function HistoricoBusca({ atualizacao = 0 }, ref) {
  const [de, setDe] = useState(() => ultimaSemana().de);
  const [ate, setAte] = useState(() => ultimaSemana().ate);
  // padrao: o usuário ainda não escolheu datas → cada consulta usa a semana de hoje (a página pode ficar aberta
  // na virada do dia, e a previsão gerada depois da meia-noite precisa aparecer).
  const [filtro, setFiltro] = useState({ padrao: true });
  const [lista, setLista] = useState({ status: 'carregando', itens: [], cursor: null }); // carregando | sucesso | erro
  const [maisCarregando, setMaisCarregando] = useState(false);
  const [erroMais, setErroMais] = useState(null);
  const [excluindo, setExcluindo] = useState(null);
  const [erroExclusao, setErroExclusao] = useState(null);
  const pedido = useRef(null);
  const [tentativa, setTentativa] = useState(0); // "Tentar novamente" refaz a primeira página

  // Intervalo [início do dia "de", início do dia seguinte a "até"), em horário de Londrina.
  const intervalo = useCallback((f) => ({ createdFrom: inicioDoDia(f.de), createdTo: inicioDoDia(somarDias(f.ate, 1)) }), []);

  // Primeira página: ao abrir, ao mudar o filtro e depois de cada previsão salva (atualizacao).
  // lista.consultado guarda as datas usadas na consulta exibida (legenda, mensagem e "Carregar mais").
  useEffect(() => {
    pedido.current?.abort();
    const ctrl = (pedido.current = new AbortController());
    const f = filtro.padrao ? ultimaSemana() : filtro;
    setLista((l) => ({ ...l, status: 'carregando' }));
    setErroMais(null);
    listarPrevisoes({ ...intervalo(f), limit: POR_PAGINA }, { signal: ctrl.signal })
      .then(({ itens, proximoCursor }) => {
        if (ctrl.signal.aborted) return;
        if (filtro.padrao) { setDe(f.de); setAte(f.ate); } // os campos acompanham a semana de hoje
        setLista({ status: 'sucesso', itens: juntarSemDuplicar([], itens), cursor: proximoCursor, consultado: f });
      })
      .catch((e) => e?.name !== 'AbortError' && !ctrl.signal.aborted && setLista({ status: 'erro', itens: [], cursor: null, consultado: f, mensagem: mensagemParaUsuario(e) }));
    return () => ctrl.abort();
  }, [filtro, atualizacao, intervalo, tentativa]);

  // Ao sair da tela, cancela também um "Carregar mais" em andamento.
  useEffect(() => () => pedido.current?.abort(), []);

  async function carregarMais() {
    pedido.current?.abort();
    const ctrl = (pedido.current = new AbortController());
    setMaisCarregando(true);
    setErroMais(null);
    try {
      const { itens, proximoCursor } = await listarPrevisoes({ ...intervalo(lista.consultado), limit: POR_PAGINA, cursor: lista.cursor }, { signal: ctrl.signal });
      if (!ctrl.signal.aborted) setLista((l) => ({ ...l, itens: juntarSemDuplicar(l.itens, itens), cursor: proximoCursor }));
    } catch (e) {
      if (e?.name !== 'AbortError' && !ctrl.signal.aborted) setErroMais(mensagemParaUsuario(e));
    } finally {
      if (!ctrl.signal.aborted) setMaisCarregando(false);
    }
  }

  async function excluir(p) {
    if (!p.predictionId || excluindo) return;
    setExcluindo(p.predictionId);
    setErroExclusao(null);
    try {
      await excluirPrevisao(p.predictionId);
      setLista((l) => ({ ...l, itens: l.itens.filter((item) => item.predictionId !== p.predictionId) }));
    } catch (e) {
      setErroExclusao(mensagemParaUsuario(e));
    } finally {
      setExcluindo(null);
    }
  }

  function consultar(e) {
    e.preventDefault();
    if (!de || !ate || de > ate) return;
    setFiltro({ padrao: false, de, ate });
  }

  // Validação das datas: mensagem específica, ligada aos campos (aria-describedby / aria-invalid).
  const erroDatas = !de || !ate ? 'Preencha as duas datas.' : de > ate ? 'A data inicial não pode ser depois da data final.' : null;
  const invalido = Boolean(erroDatas);
  const carregando = lista.status === 'carregando';
  return (
    <section className="card" aria-labelledby="t-historico" ref={ref} tabIndex={-1}>
      <h2 id="t-historico">Histórico de previsões</h2>
      <p className="note">Previsões já executadas, da mais recente para a mais antiga. O filtro usa o dia em que a previsão foi gerada (horário de Londrina).</p>
      <form className="acoes" onSubmit={consultar}>
        <div className="campo">
          <label htmlFor="hist-de">Geradas de</label>
          <input id="hist-de" type="date" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)}
            aria-invalid={invalido} aria-describedby={invalido ? 'hist-erro' : undefined} />
        </div>
        <div className="campo">
          <label htmlFor="hist-ate">até</label>
          <input id="hist-ate" type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)}
            aria-invalid={invalido} aria-describedby={invalido ? 'hist-erro' : undefined} />
        </div>
        <button type="submit" className="btn" disabled={invalido || carregando}>{carregando ? 'Consultando…' : 'Consultar'}</button>
      </form>
      {erroDatas && <p className="campo-erro" id="hist-erro">{erroDatas}</p>}

      <div className="resultado" aria-live="polite">
        {carregando && !lista.itens.length && <Empty>Consultando o histórico…</Empty>}
        {lista.status === 'erro' && <ErroComNovaTentativa onTentar={() => setTentativa((t) => t + 1)}>Não foi possível consultar o histórico. {lista.mensagem}</ErroComNovaTentativa>}
        {lista.status === 'sucesso' && !lista.itens.length && (
          <Empty>Nenhuma previsão gerada entre {fmtDataIso(lista.consultado.de)} e {fmtDataIso(lista.consultado.ate)}.</Empty>
        )}
        {lista.itens.length > 0 && lista.status !== 'erro' && (
          <div className="scroll">
            <table>
              <caption className="sr">Previsões geradas entre {fmtDataIso(lista.consultado.de)} e {fmtDataIso(lista.consultado.ate)}</caption>
              <thead>
                <tr><th>Gerada em</th><th>Horário simulado</th><th>Período previsto</th><th>Resultado</th><th>Probabilidade estimada</th><th aria-label="Ações"></th></tr>
              </thead>
              <tbody>
                {lista.itens.map((p) => (
                  <tr key={p.predictionId ?? `${p.requestId}-${p.createdAt}`}>
                    <td>{fmtDataHoraCurta(p.createdAt) ?? '—'}</td>
                    <td>{fmtDataHoraCurta(p.referenceTime) ?? '—'}</td>
                    <td>{fmtJanela(p.forecastStart, p.forecastEnd)}</td>
                    <td>{p.vaiChover ? 'Chuva prevista' : 'Sem chuva prevista'}{p.isMock && <span className="selo selo-mock">fictício</span>}</td>
                    <td>{pct(p.probabilidadePct)}</td>
                    <td className="celula-excluir"><button type="button" className="btn-lixeira" aria-label="Excluir previsão" title="Excluir previsão"
                      onClick={() => excluir(p)} disabled={!p.predictionId || excluindo !== null}>
                      {excluindo === p.predictionId ? '…' : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" /></svg>}
                    </button></td>
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
        {erroMais && <p className="err" role="alert">Não foi possível carregar mais previsões. {erroMais}</p>}
        {erroExclusao && <p className="err" role="alert">Não foi possível excluir a previsão. {erroExclusao}</p>}
      </div>
    </section>
  );
});

export default HistoricoBusca;
