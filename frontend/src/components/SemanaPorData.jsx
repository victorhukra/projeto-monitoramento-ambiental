import { useEffect, useRef, useState } from 'react';
import { getDataPeriod, getWeekEnding } from '../services/weatherApi.js';
import { fmtDataIso, fmtDay, somarDias } from '../lib/format.js';
import { AvisoDeFalha, LastDays } from './Panels.jsx';
import { mensagemParaUsuario } from '../lib/mensagensErro.js';

// "Últimos 7 dias" com escolha de data: mostra os 7 dias que terminam na data escolhida.
// Os limites do calendário vêm do banco (primeiro e último registro), nunca de datas fixas no código.
// recentes/erroRecentes: os 7 dias mais recentes, já carregados pelo painel (usados enquanto nenhuma data é escolhida).
// carregandoRecentes: o painel ainda está buscando esses 7 dias.
// atualizacao / avisoNoTopo: "Tentar novamente" do topo da página e aviso geral já exibido (ver AvisoDeFalha).
export default function SemanaPorData({ recentes, erroRecentes, carregandoRecentes = false, atualizacao = 0, avisoNoTopo = false }) {
  const [periodo, setPeriodo] = useState({ status: 'carregando' });
  const [data, setData] = useState('');
  const [escolha, setEscolha] = useState(null); // { status: carregando | sucesso | erro, data, dias, mensagem }
  const pedido = useRef(null);
  const semanaEscolhida = useRef(null); // fim da semana escolhida (null = os 7 dias mais recentes)
  const [tentativa, setTentativa] = useState(0); // "Tentar novamente" na consulta do período

  // Busca os 7 dias que terminam em "fim" (usada pelo formulário e pelas novas tentativas).
  async function buscarSemana(fim) {
    pedido.current?.abort();
    const ctrl = (pedido.current = new AbortController());
    semanaEscolhida.current = fim;
    setEscolha({ status: 'carregando', data: fim });
    try {
      const dias = await getWeekEnding(fim, { signal: ctrl.signal });
      if (!ctrl.signal.aborted) setEscolha({ status: 'sucesso', data: fim, dias });
    } catch (err) {
      if (err?.name !== 'AbortError' && !ctrl.signal.aborted) setEscolha({ status: 'erro', data: fim, mensagem: mensagemParaUsuario(err) });
    }
  }
  const buscarSemanaRef = useRef(buscarSemana); // só usa setters e refs: a primeira versão serve sempre

  // Período do banco; numa nova tentativa, refaz também a semana que estava escolhida.
  useEffect(() => {
    const ctrl = new AbortController();
    getDataPeriod({ signal: ctrl.signal })
      .then((p) => {
        setPeriodo({ status: 'sucesso', ...p });
        if (p.maxDate) setData(semanaEscolhida.current ?? p.maxDate);
        if (semanaEscolhida.current) buscarSemanaRef.current(semanaEscolhida.current);
      })
      .catch((e) => e?.name !== 'AbortError' && setPeriodo({ status: 'erro', mensagem: mensagemParaUsuario(e) }));
    return () => { ctrl.abort(); pedido.current?.abort(); };
  }, [tentativa, atualizacao]);

  function tentarPeriodoDeNovo() {
    setPeriodo({ status: 'carregando' });
    setTentativa((t) => t + 1);
  }

  const { minDate, maxDate } = periodo;
  const foraDoPeriodo = !data || (minDate && data < minDate) || (maxDate && data > maxDate);

  function mostrar(e) {
    e.preventDefault();
    if (!foraDoPeriodo) buscarSemana(data);
  }

  function voltarAoRecente() {
    pedido.current?.abort();
    semanaEscolhida.current = null;
    setEscolha(null);
    if (maxDate) setData(maxDate);
  }

  const fimAtual = escolha?.data ?? recentes?.at(-1)?.date;
  const inicioAtual = fimAtual ? somarDias(fimAtual, -6) : null;
  const antesDoInicio = escolha?.status === 'sucesso' && minDate && inicioAtual < minDate;

  return (
    <>
      <div className="semana-topo">
        <div>
          <h2 id="t-semana">{escolha ? `7 dias até ${fmtDay(escolha.data)}` : 'Últimos 7 dias'}</h2>
          <p className="note">
            Chuva acumulada no dia · temperatura máxima / mínima · registros observados
            {fimAtual ? ` de ${fmtDataIso(inicioAtual)} a ${fmtDataIso(fimAtual)}` : ''}
          </p>
        </div>
        {periodo.status === 'sucesso' && minDate && maxDate && (
          <form className="acoes semana-form" onSubmit={mostrar}>
            <div className="campo">
              <label htmlFor="semana-data">Ver 7 dias até</label>
              <input id="semana-data" type="date" min={minDate} max={maxDate} value={data} required
                onChange={(e) => setData(e.target.value)} aria-describedby="semana-limites" />
            </div>
            <button type="submit" className="btn" disabled={foraDoPeriodo || escolha?.status === 'carregando'}>
              {escolha?.status === 'carregando' ? 'Buscando…' : 'Mostrar semana'}
            </button>
            {escolha && <button type="button" className="link" onClick={voltarAoRecente}>Mais recentes</button>}
            <p className="note" id="semana-limites">Dados de {fmtDataIso(minDate)} a {fmtDataIso(maxDate)}.</p>
          </form>
        )}
      </div>
      {periodo.status === 'erro' && (
        <AvisoDeFalha avisoNoTopo={avisoNoTopo} onTentar={tentarPeriodoDeNovo}>Não foi possível consultar as datas disponíveis. {periodo.mensagem}</AvisoDeFalha>
      )}
      {data && foraDoPeriodo && periodo.status === 'sucesso' && (
        <p className="campo-erro" role="alert">Escolha uma data entre {fmtDataIso(minDate)} e {fmtDataIso(maxDate)}.</p>
      )}

      <div aria-live="polite">
        {!escolha && <LastDays days={recentes} error={erroRecentes} loading={carregandoRecentes} />}
        {escolha?.status === 'carregando' && <p className="empty">Buscando os 7 dias até {fmtDataIso(escolha.data)}…</p>}
        {escolha?.status === 'erro' && (
          <AvisoDeFalha avisoNoTopo={avisoNoTopo} onTentar={() => buscarSemana(escolha.data)}>Não foi possível carregar estes dados. {escolha.mensagem}</AvisoDeFalha>
        )}
        {escolha?.status === 'sucesso' && <LastDays days={escolha.dias} />}
        {antesDoInicio && <p className="note">Não temos dados antes de {fmtDataIso(minDate)}.</p>}
      </div>
    </>
  );
}
