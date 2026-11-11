import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { getDataPeriod, getDayReport } from '../services/weatherApi.js';
import { fmtDataIso, mm } from '../lib/format.js';
import { AvisoDeFalha, Empty, Indicators } from './Panels.jsx';
import DateInput from './DateInput.jsx';
import { mensagemParaUsuario } from '../lib/mensagensErro.js';

const DATA_POR_EXTENSO = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});
const dataPorExtenso = (iso) => DATA_POR_EXTENSO.format(new Date(`${iso}T12:00:00Z`));

const RainBars = lazy(() => import('./Charts.jsx').then((charts) => ({ default: charts.RainBars })));
const TempLine = lazy(() => import('./Charts.jsx').then((charts) => ({ default: charts.TempLine })));

// Resumo de um dia: indicadores e gráficos de chuva e temperatura hora a hora, só com registros do banco.
// Abre no dia mais recente do banco; o calendário só aceita datas entre o primeiro e o último registro,
// e um dia sem registros dentro desse período é avisado (nunca mostra valores inventados).
// atualizacao: muda quando o "Tentar novamente" do topo da página é usado → refaz também as consultas daqui.
// avisoNoTopo: a página já mostra um aviso de falha com "Tentar novamente"; então uma falha aqui aparece só
// como texto neutro, sem repetir o alerta. Sem aviso no topo, este bloco mostra o próprio aviso e botão.
export default function DiaPorData({ atualizacao = 0, avisoNoTopo = false }) {
  const [periodo, setPeriodo] = useState({ status: 'carregando' });
  const [data, setData] = useState('');
  const [dia, setDia] = useState({ status: 'carregando' }); // carregando | sucesso | erro | vazio
  const pedido = useRef(null);
  const diaEscolhido = useRef(null); // último dia pedido: uma nova tentativa refaz este dia, não volta ao mais recente
  const [tentativa, setTentativa] = useState(0); // "Tentar novamente" na consulta do período

  const buscarDia = useCallback(async (d) => {
    pedido.current?.abort();
    const ctrl = (pedido.current = new AbortController());
    diaEscolhido.current = d;
    setDia({ status: 'carregando', data: d });
    try {
      const relatorio = await getDayReport(d, { signal: ctrl.signal });
      if (!ctrl.signal.aborted) setDia({ status: 'sucesso', data: d, relatorio });
    } catch (err) {
      if (err?.name !== 'AbortError' && !ctrl.signal.aborted) setDia({ status: 'erro', data: d, mensagem: mensagemParaUsuario(err) });
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    getDataPeriod({ signal: ctrl.signal })
      .then((p) => {
        setPeriodo({ status: 'sucesso', ...p });
        if (!p.maxDate) return setDia({ status: 'vazio' });
        const d = diaEscolhido.current ?? p.maxDate; // primeira carga: o dia mais recente do banco
        setData(d);
        buscarDia(d);
      })
      .catch((e) => {
        if (e?.name === 'AbortError') return;
        setPeriodo({ status: 'erro', mensagem: mensagemParaUsuario(e) });
        setDia({ status: 'erro-periodo' });
      });
    return () => { ctrl.abort(); pedido.current?.abort(); };
  }, [tentativa, atualizacao, buscarDia]);

  function tentarPeriodoDeNovo() {
    setPeriodo({ status: 'carregando' });
    setDia({ status: 'carregando' });
    setTentativa((t) => t + 1);
  }

  const { minDate, maxDate } = periodo;
  const foraDoPeriodo = !data || (minDate && data < minDate) || (maxDate && data > maxDate);

  function mostrar(e) {
    e.preventDefault();
    if (!foraDoPeriodo) buscarDia(data);
  }

  function voltarAoRecente() {
    setData(maxDate);
    buscarDia(maxDate);
  }

  const r = dia.relatorio;
  const carregando = dia.status === 'carregando';
  const semRegistros = dia.status === 'sucesso' && r.hours === 0;
  const parcial = dia.status === 'sucesso' && r.hours > 0 && r.hours < 24;

  return (
    <>
      <div className="semana-topo">
        <div>
          <h2 id="t-agora">Resumo do dia</h2>
          <p className="note">
            Registros observados · cidade toda
            {parcial ? ` · dados de ${r.hours} das 24 horas` : ''}
          </p>
        </div>
        {periodo.status === 'sucesso' && minDate && maxDate && (
          <form className="acoes semana-form" onSubmit={mostrar}>
            <div className="campo">
              <label htmlFor="dia-data">Ver o dia</label>
              <DateInput id="dia-data" min={minDate} max={maxDate} value={data} required label="Ver o dia"
                onChange={setData} aria-describedby="dia-limites" />
            </div>
            <button type="submit" className="btn" disabled={foraDoPeriodo || carregando}>
              {carregando ? 'Buscando…' : 'Mostrar dia'}
            </button>
            {dia.data && dia.data !== maxDate && <button type="button" className="link" onClick={voltarAoRecente}>Dia mais recente</button>}
            <p className="note" id="dia-limites">Dados de {fmtDataIso(minDate)} a {fmtDataIso(maxDate)}.</p>
          </form>
        )}
      </div>
      {dia.data && <h3 className="day-report-date">{dataPorExtenso(dia.data)}</h3>}
      {periodo.status === 'erro' && (
        <AvisoDeFalha avisoNoTopo={avisoNoTopo} onTentar={tentarPeriodoDeNovo}>Não foi possível consultar as datas disponíveis. {periodo.mensagem}</AvisoDeFalha>
      )}
      {data && foraDoPeriodo && periodo.status === 'sucesso' && (
        <p className="campo-erro" role="alert">Escolha uma data entre {fmtDataIso(minDate)} e {fmtDataIso(maxDate)}.</p>
      )}

      <div aria-live="polite">
        {carregando && (
          <>
            <Empty>Carregando indicadores…</Empty>
            <div className="grid2">
              <div className="card"><h3>Chuva por hora (mm)</h3><Empty>Carregando gráfico…</Empty></div>
              <div className="card"><h3>Temperatura por hora (°C)</h3><Empty>Carregando gráfico…</Empty></div>
            </div>
          </>
        )}
        {dia.status === 'erro' && (
          <AvisoDeFalha avisoNoTopo={avisoNoTopo} onTentar={() => buscarDia(dia.data)}>Não foi possível carregar os dados deste dia. {dia.mensagem}</AvisoDeFalha>
        )}
        {dia.status === 'vazio' && <Empty>O banco ainda não tem registros.</Empty>}
        {semRegistros && <Empty>Não há registros em {fmtDataIso(r.date)}. Escolha outra data.</Empty>}
        {dia.status === 'sucesso' && r.hours > 0 && (
          <>
            <Indicators dia={r} />
            <div className="grid2">
              <div className="card"><h3>Chuva por hora (mm)</h3>
                <p className="note">Total do dia: {mm(r.totalMm)}{r.rainPeak?.t ? ' · maior chuva em destaque' : ''}</p>
                <Suspense fallback={<Empty>Carregando gráfico…</Empty>}>
                  <RainBars data={r.hourly} destaque={r.rainPeak?.t ?? null} label={`Chuva registrada em ${fmtDataIso(r.date)}, por hora, em milímetros`} />
                </Suspense></div>
              <div className="card"><h3>Temperatura por hora (°C)</h3>
                <p className="note">Temperatura máxima em destaque</p>
                <Suspense fallback={<Empty>Carregando gráfico…</Empty>}>
                  <TempLine data={r.hourly} destaque={r.tempMax?.t ?? null} label={`Temperatura registrada em ${fmtDataIso(r.date)}, por hora, em graus Celsius`} />
                </Suspense></div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
