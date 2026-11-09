import { useEffect, useRef, useState } from 'react';
import { getDayHours, getMonthHours, getMonthsWithData, getYearsWithData } from '../services/forecastRepo.js';
import { ComparisonBars } from './Charts.jsx';
import { AvisoDeFalha } from './Panels.jsx';
import { mensagemParaUsuario } from '../lib/mensagensErro.js';
import { fmtDataIso, hojeEmLondrina } from '../lib/format.js';

const periodValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
// "Hoje" no horário de Londrina, calculado na hora do uso (uma página aberta na virada do dia não fica com a data velha).
const hoje = () => hojeEmLondrina().split('-').map(Number); // [ano, mês, dia]
const FIRST_DATA_YEAR = 2020;
const availableDays = (year, month) => {
  const [ano, mes, dia] = hoje();
  return year === ano && month === mes ? dia : daysInMonth(year, month);
};
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function summarize(rows) {
  const values = (key) => rows.map((row) => row[key]).filter((value) => value != null && value !== '' && Number.isFinite(Number(value))).map(Number);
  const rainValues = values('chuva_mm');
  const temperatures = values('temperatura_c');

  return {
    rain: rainValues.length ? rainValues.reduce((sum, value) => sum + value, 0) : null,
    temperature: temperatures.length
      ? temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length
      : null,
  };
}

function periodLabel(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Diferença do dia 2 em relação ao dia 1, em frase (arredondada a 1 casa, como os valores exibidos).
function comparacao(valor1, valor2, { semDados, igual, diferente }) {
  if (valor1 == null || valor2 == null) return semDados;
  const diferenca = Math.round((valor2 - valor1) * 10) / 10;
  return diferenca === 0 ? igual : diferente(number.format(Math.abs(diferenca)), diferenca > 0);
}

function metric(value, unit) {
  return value == null ? 'Sem dados' : `${number.format(value)} ${unit}`;
}

// Cartão com o gráfico de uma medida nos dois dias, no mesmo padrão dos gráficos por hora (Charts.jsx).
function ComparisonCard({ title, unit, periods, values }) {
  const itens = values.map((value, index) => ({ label: `Dia ${index + 1} · ${fmtDataIso(periods[index])}`, value }));
  const descricao = `${title}: ${itens.map(({ label, value }) => `${label}, ${metric(value, unit)}`).join('; ')}`;
  return (
    <div className="card">
      <h3>{title} ({unit})</h3>
      <p className="note">Barras a partir do zero · dia 2 em destaque</p>
      <ComparisonBars values={itens} formatar={(value) => metric(value, unit)} label={descricao} />
    </div>
  );
}

function initialPeriods(latestDate) {
  const [ano, mes, dia] = hoje();
  const padrao = [periodValue(new Date(ano - 1, mes - 1, Math.min(dia, daysInMonth(ano - 1, mes)))), hojeEmLondrina()];
  if (!latestDate) return padrao;
  const [year, month, day] = latestDate.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return padrao;
  const earlierDay = Math.min(day, daysInMonth(year - 1, month));
  return [periodValue(new Date(year - 1, month - 1, earlierDay)), latestDate.slice(0, 10)];
}

// atualizacao / avisoNoTopo: "Tentar novamente" do topo da página e aviso geral já exibido (ver AvisoDeFalha).
export default function PeriodComparison({ latestDate, atualizacao = 0, avisoNoTopo = false }) {
  const [periods, setPeriods] = useState(() => initialPeriods(latestDate));
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [datesWithData, setDatesWithData] = useState([[], []]);
  const [checkingDates, setCheckingDates] = useState([true, true]);
  const [availabilityError, setAvailabilityError] = useState(null);
  const [userSelectedDate, setUserSelectedDate] = useState(false);
  const [previousLatestDate, setPreviousLatestDate] = useState(latestDate);
  const [yearsWithData, setYearsWithData] = useState([]);
  const [checkingYears, setCheckingYears] = useState(true);
  const [monthsWithData, setMonthsWithData] = useState([[], []]);
  const [checkingMonths, setCheckingMonths] = useState([true, true]);
  const [tentativa, setTentativa] = useState(0); // "Tentar novamente" refaz a cadeia anos → meses → dias
  // Etapa da cadeia anos → meses → dias cuja consulta falhou (null = nenhuma). Interrompe as etapas seguintes e
  // separa, nos campos, "falha na consulta" (Indisponível) de "consulta feita, sem dados" e de "carregando".
  const [falhaEm, setFalhaEm] = useState(null);

  // Atualiza o estado do próprio componente apenas quando a referência muda.
  // Uma seleção já feita pelo usuário é preservada.
  if (latestDate !== previousLatestDate) {
    setPreviousLatestDate(latestDate);
    if (!userSelectedDate) setPeriods(initialPeriods(latestDate));
  }
  useEffect(() => {
    const controller = new AbortController();
    getYearsWithData(controller.signal, FIRST_DATA_YEAR, hoje()[0]).then((years) => {
      if (controller.signal.aborted) return;
      setYearsWithData(years);
      setPeriods((current) => current.map((value) => {
        const [year, month, day] = value.split('-').map(Number);
        if (years.includes(year) || !years.length) return value;
        const fallbackYear = years.at(-1);
        const fallbackMonth = month;
        const fallbackDay = Math.min(day, daysInMonth(fallbackYear, fallbackMonth));
        return periodValue(new Date(fallbackYear, fallbackMonth - 1, fallbackDay));
      }));
      setAvailabilityError(null);
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setAvailabilityError(mensagemParaUsuario(cause));
      setFalhaEm('anos');
      setCheckingMonths([false, false]);
      setCheckingDates([false, false]);
    }).finally(() => {
      if (!controller.signal.aborted) setCheckingYears(false);
    });
    return () => controller.abort();
  }, [tentativa]);

  // "Tentar novamente" do topo da página: se a verificação das datas tinha falhado, recomeça (ajuste de estado
  // durante a renderização, o mesmo padrão de latestDate acima, sem efeito extra).
  const [atualizacaoVista, setAtualizacaoVista] = useState(atualizacao);
  if (atualizacao !== atualizacaoVista) {
    setAtualizacaoVista(atualizacao);
    if (falhaEm) tentarDeNovo();
  }

  // Recomeça a verificação das datas disponíveis: os efeitos de meses e de dias rodam de novo em seguida.
  function tentarDeNovo() {
    setAvailabilityError(null);
    setFalhaEm(null);
    setCheckingYears(true);
    setCheckingMonths([true, true]);
    setCheckingDates([true, true]);
    setTentativa((t) => t + 1);
  }

  const year1 = Number(periods[0].slice(0, 4));
  const year2 = Number(periods[1].slice(0, 4));
  useEffect(() => {
    // Depois de uma falha (de anos ou destes meses) só consulta de novo quando o usuário pede: "Tentar novamente"
    // ou trocar o ano zeram falhaEm.
    if (checkingYears || falhaEm === 'anos' || falhaEm === 'meses') return undefined;
    const controller = new AbortController();
    const years = [year1, year2];
    Promise.all(years.map((year) => getMonthsWithData(controller.signal, year))).then((available) => {
      if (controller.signal.aborted) return;
      setMonthsWithData(available);
      setPeriods((current) => current.map((value, index) => {
        const [year, month, day] = value.split('-').map(Number);
        if (year !== years[index] || !available[index].length) return value;
        const selectedMonth = available[index].includes(month) ? month : available[index].at(-1);
        const validDay = Math.min(day, daysInMonth(year, selectedMonth));
        return periodValue(new Date(year, selectedMonth - 1, validDay));
      }));
      setAvailabilityError(null);
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setAvailabilityError(mensagemParaUsuario(cause));
      setFalhaEm('meses');
      setCheckingDates([false, false]);
    }).finally(() => {
      if (!controller.signal.aborted) setCheckingMonths([false, false]);
    });
    return () => controller.abort();
  }, [checkingYears, year1, year2, falhaEm]);
  const monthKey1 = periods[0].slice(0, 7);
  const monthKey2 = periods[1].slice(0, 7);

  useEffect(() => {
    if (checkingYears || checkingMonths.some(Boolean) || falhaEm) return undefined;
    const controller = new AbortController();
    const monthKeys = [monthKey1, monthKey2];

    // Cada mês sem dados produz uma lista vazia no mesmo fluxo assíncrono.
    Promise.all(monthKeys.map(async (key, index) => {
      const [year, month] = key.split('-').map(Number);
      if (!monthsWithData[index].includes(month)) return [];
      const rows = await getMonthHours(controller.signal, year, month);
      return [...new Set(rows
        .filter((row) => row.horario && (row.chuva_mm != null || row.temperatura_c != null))
        .map((row) => Number(String(row.horario).slice(8, 10)))
        .filter(Number.isInteger))].sort((a, b) => a - b);
    })).then((available) => {
      if (controller.signal.aborted) return;
      setDatesWithData(available);
      setPeriods((current) => current.map((value, index) => {
        if (value.slice(0, 7) !== monthKeys[index] || !available[index].length) return value;
        const selectedDay = Number(value.slice(8, 10));
        const day = available[index].includes(selectedDay) ? selectedDay : available[index].at(-1);
        return `${monthKeys[index]}-${String(day).padStart(2, '0')}`;
      }));
      setAvailabilityError(null);
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setAvailabilityError(mensagemParaUsuario(cause));
      setFalhaEm('dias');
    }).finally(() => {
      if (!controller.signal.aborted) setCheckingDates([false, false]);
    });

    return () => controller.abort();
  }, [monthKey1, monthKey2, checkingYears, checkingMonths, monthsWithData, falhaEm]);

  // Consulta da comparação: uma nova comparação ou a saída da tela cancelam a anterior,
  // para nenhuma resposta atrasada sobrescrever o resultado atual.
  const comparacaoEmAndamento = useRef(null);
  useEffect(() => () => comparacaoEmAndamento.current?.abort(), []);

  async function compare(event) {
    event.preventDefault();
    comparacaoEmAndamento.current?.abort();
    const controller = (comparacaoEmAndamento.current = new AbortController());
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const summaries = await Promise.all(periods.map(async (period) => {
        const [year, month, day] = period.split('-').map(Number);
        return summarize(await getDayHours(controller.signal, year, month, day));
      }));
      if (!controller.signal.aborted) setResult({ periods: [...periods], summaries }); // as datas comparadas, não as do formulário
    } catch (cause) {
      if (!controller.signal.aborted) setError(mensagemParaUsuario(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const comparisonDisabled = loading || checkingYears || checkingMonths.some(Boolean) || checkingDates.some(Boolean) || datesWithData.some((days) => !days.length);

  return (
    <section className="period-compare" aria-labelledby="t-comparar-periodos">
      <h2 id="t-comparar-periodos">Comparar dois dias</h2>
      <p className="note">Compare a chuva acumulada e a temperatura média de dois dias.</p>
      <form className="period-form" onSubmit={compare}>
        {periods.map((period, index) => {
          const [year, month, day] = period.split('-').map(Number);
          const updatePeriod = (nextYear, nextMonth, nextDay = day, reloadDates = false, reloadMonths = false) => {
            setUserSelectedDate(true);
            const validDay = Math.min(nextDay, availableDays(nextYear, nextMonth));
            setPeriods((current) => current.map((value, i) => i === index ? periodValue(new Date(nextYear, nextMonth - 1, validDay)) : value));
            if (reloadMonths || reloadDates) setFalhaEm(null);
            if (reloadMonths) {
              setCheckingMonths((current) => current.map((value, i) => i === index ? true : value));
              setMonthsWithData((current) => current.map((value, i) => i === index ? [] : value));
              setCheckingDates((current) => current.map((value, i) => i === index ? true : value));
              setDatesWithData((current) => current.map((value, i) => i === index ? [] : value));
              setAvailabilityError(null);
            } else if (reloadDates) {
              setCheckingDates((current) => current.map((value, i) => i === index ? true : value));
              setDatesWithData((current) => current.map((value, i) => i === index ? [] : value));
              setAvailabilityError(null);
            }
            setResult(null);
            setError(null);
          };

          return (
            <div className="period-selection" key={index}>
              <strong>Dia {index + 1}</strong>
              <div className="period-fields">
                <div className="campo">
                  <label htmlFor={`period-year-${index}`}>Ano</label>
                  <select id={`period-year-${index}`} value={yearsWithData.includes(year) ? year : ''} disabled={loading || checkingYears || !yearsWithData.length} onChange={(event) => updatePeriod(Number(event.target.value), month, day, true, true)}>
                    {checkingYears && <option value="">Buscando anos…</option>}
                    {!checkingYears && falhaEm === 'anos' && !yearsWithData.length && <option value="">Indisponível</option>}
                    {!checkingYears && !falhaEm && !yearsWithData.length && <option value="">Sem anos com dados</option>}
                    {yearsWithData.map((availableYear) => <option key={availableYear} value={availableYear}>{availableYear}</option>)}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor={`period-month-${index}`}>Mês</label>
                  <select id={`period-month-${index}`} value={monthsWithData[index].includes(month) ? month : ''} disabled={loading || checkingYears || checkingMonths[index] || !monthsWithData[index].length} onChange={(event) => updatePeriod(year, Number(event.target.value), day, true)}>
                    {checkingMonths[index] && <option value="">Buscando meses…</option>}
                    {!checkingMonths[index] && (falhaEm === 'anos' || falhaEm === 'meses') && !monthsWithData[index].length && <option value="">Indisponível</option>}
                    {!checkingMonths[index] && !falhaEm && !monthsWithData[index].length && <option value="">Sem meses com dados</option>}
                    {monthsWithData[index].map((availableMonth) => <option key={availableMonth} value={availableMonth}>{MONTHS[availableMonth - 1]}</option>)}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor={`period-day-${index}`}>Dia</label>
                  <select id={`period-day-${index}`} value={datesWithData[index].includes(day) ? day : ''} disabled={loading || checkingDates[index] || !datesWithData[index].length} onChange={(event) => updatePeriod(year, month, Number(event.target.value))}>
                    {checkingDates[index] && <option value="">Buscando datas…</option>}
                    {!checkingDates[index] && falhaEm && !datesWithData[index].length && <option value="">Indisponível</option>}
                    {!checkingDates[index] && !falhaEm && !datesWithData[index].length && <option value="">Sem datas com dados</option>}
                    {datesWithData[index].map((optionDay) => <option key={optionDay} value={optionDay}>{optionDay}</option>)}
                  </select>
                </div>
              </div>
            </div>
          );
        })}
        <button className="btn" type="submit" disabled={comparisonDisabled}>{loading ? 'Carregando…' : 'Comparar'}</button>
      </form>

      {availabilityError && (
        <AvisoDeFalha avisoNoTopo={avisoNoTopo} onTentar={tentarDeNovo}>Não foi possível consultar as datas disponíveis. {availabilityError}</AvisoDeFalha>
      )}
      {error && <p className="err" role="alert">Não foi possível comparar os dias. {error}</p>}
      {/* região sempre montada: o leitor de tela anuncia o resultado quando ele aparece */}
      <div aria-live="polite">
      {result && (
        <div className="period-results">
          {result.summaries.map((summary, index) => (
            <div className="period-result" key={`${result.periods[index]}-${index}`}>
              <h3>Dia {index + 1}: {periodLabel(result.periods[index])}</h3>
              <p>Chuva acumulada: <strong>{metric(summary.rain, 'mm')}</strong></p>
              <p>Temperatura média: <strong>{metric(summary.temperature, '°C')}</strong></p>
            </div>
          ))}
          <div className="period-charts">
            <ComparisonCard title="Chuva acumulada" unit="mm" periods={result.periods} values={result.summaries.map((summary) => summary.rain)} />
            <ComparisonCard title="Temperatura média" unit="°C" periods={result.periods} values={result.summaries.map((summary) => summary.temperature)} />
          </div>
          <p className="period-difference">
            {comparacao(result.summaries[0].rain, result.summaries[1].rain, {
              semDados: 'Sem dados suficientes para comparar a chuva.',
              igual: 'Choveu a mesma quantidade nos dois dias.',
              diferente: (valor, maior) => `No dia 2 choveu ${valor} mm a ${maior ? 'mais' : 'menos'} que no dia 1.`,
            })}{' '}
            {comparacao(result.summaries[0].temperature, result.summaries[1].temperature, {
              semDados: 'Sem dados suficientes para comparar a temperatura.',
              igual: 'A temperatura média foi a mesma nos dois dias.',
              diferente: (valor, maior) => `A temperatura média do dia 2 foi ${valor} °C ${maior ? 'maior' : 'menor'} que a do dia 1.`,
            })}
          </p>
        </div>
      )}
      </div>
    </section>
  );
}
