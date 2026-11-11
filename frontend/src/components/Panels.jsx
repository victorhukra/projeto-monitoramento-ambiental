import { mm, pct, kmh, celsius, beaufort, fmtHour, fmtDay, fmtDataIso } from '../lib/format.js';

export const Empty = ({ children }) => <p className="empty">{children}</p>;

// Bloco cuja consulta falhou. O motivo e o botão "Tentar novamente" aparecem uma única vez, no aviso
// do topo da seção (ErroComNovaTentativa); aqui fica só um texto neutro, sem repetir o alerta em cada bloco.
export const Indisponivel = () => <Empty>Dados indisponíveis no momento.</Empty>;

// Aviso de falha com uma ação para refazer a consulta.
export function ErroComNovaTentativa({ children, onTentar }) {
  return (
    <div className="err erro-acao" role="alert">
      <p>{children}</p>
      <button type="button" className="link" onClick={onTentar}>Tentar novamente</button>
    </div>
  );
}

// Falha de um bloco do painel. Se a página já mostra o aviso geral no topo (com "Tentar novamente", que refaz
// também este bloco), aqui fica só o texto neutro; senão, o bloco mostra o próprio aviso e botão.
export function AvisoDeFalha({ avisoNoTopo = false, onTentar, children }) {
  return avisoNoTopo ? <Indisponivel /> : <ErroComNovaTentativa onTentar={onTentar}>{children}</ErroComNovaTentativa>;
}

// Indicadores de um dia escolhido, calculados com os registros de hora em hora do banco (getDayReport).
// climate: chance histórica de chuva no mesmo mês dos anos anteriores (não é previsão).
export function Indicators({ dia }) {
  const juntar = (...partes) => partes.filter(Boolean).join(' · ');
  const temp = dia.tempMax
    ? [celsius(dia.tempMax.c), juntar(dia.tempMin && `mín. ${celsius(dia.tempMin.c)}`, dia.humidityAvg != null && `umidade média ${pct(dia.humidityAvg)}`)]
    : [celsius(null), 'sem registros de temperatura no dia'];
  const chuva = !dia.rainPeak ? [null, 'sem registros de chuva no dia']
    : dia.rainPeak.mm > 0 ? [dia.rainPeak.mm, `às ${fmtHour(dia.rainPeak.t)} · total do dia ${mm(dia.totalMm)}`]
    : [0, 'sem chuva no dia'];
  const { climate } = dia;
  const anos = climate && (climate.fromYear === climate.toYear ? climate.fromYear : `${climate.fromYear}–${climate.toYear}`);
  const chance = dia.climateError ? 'dados indisponíveis no momento'
    : climate?.pct != null ? `dias de ${climate.monthLabel} com chuva (${anos}) · não é previsão`
    : 'sem histórico deste mês nos anos anteriores';
  const vento = dia.windAvgKmh != null
    ? juntar(beaufort(dia.windAvgKmh), dia.windMax && `máx. ${kmh(dia.windMax.kmh)} às ${fmtHour(dia.windMax.t)}`)
    : 'sem registros de vento no dia';
  const cards = [
    ['Temperatura máxima', ...temp],
    ['Maior chuva em 1 hora', mm(chuva[0]), chuva[1]],
    ['Chance histórica de chuva', pct(climate?.pct), chance],
    ['Vento médio', kmh(dia.windAvgKmh), vento],
  ];
  return (
    <div className="grid4" role="group" aria-label={`Indicadores de ${fmtDataIso(dia.date)}`}>
      {cards.map(([t, v, s]) => <div className="card kpi" key={t}><span className="lbl">{t}</span><strong>{v}</strong><span className="sub">{s}</span></div>)}
    </div>
  );
}

const deg = (v) => (v == null ? '—' : `${Math.round(v)}°`);

function WeatherIcon({ rainy }) {
  return rainy ? (
    <svg className="weather-icon rainy" viewBox="0 0 36 36" aria-hidden="true">
      <path d="M10.2 21.5a7.1 7.1 0 0 1 .4-14.2A9.3 9.3 0 0 1 28 10.8a5.4 5.4 0 0 1-1.2 10.7H10.2Z" />
      <path d="m12 25-1.3 3.2m7-3.2-1.3 3.2m7-3.2-1.3 3.2" />
    </svg>
  ) : (
    <svg className="weather-icon sunny" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="6" />
      <path d="M18 3.5v4m0 21v4m14.5-14.5h-4m-21 0h-4m24.8-10.3-2.8 2.8m-14.9 14.9-2.8 2.8m20.5 0-2.8-2.8M8.1 8.1 5.3 5.3" />
    </svg>
  );
}

// 7 dias observados: chuva acumulada no dia e temperatura máx./mín. (só leitura).
// hours (opcional): quantos registros horários o dia tem no banco. 0 = sem medições; < 24 = dia parcial.
export function LastDays({ days, error, loading = false }) {
  if (error) return <Indisponivel />;
  if (loading) return <Empty>Carregando os últimos dias…</Empty>;
  if (!days?.length) return <Empty>Sem registros dos últimos dias.</Empty>;
  return (
    <ul className="week" aria-label="Chuva e temperatura dos últimos 7 dias">
      {days.map((d) => (
        <li key={d.date} className={`day${d.hours === 0 ? ' vazio' : ''}`}>
          <b>{fmtDay(d.date)}</b>
          {d.hours === 0 ? <span>sem medições</span> : (
            <>
              {d.rainMm != null && <WeatherIcon rainy={d.rainMm > 0} />}
              <span className="day-rain">{mm(d.rainMm)}</span>
              <small>{deg(d.tMax)} / {deg(d.tMin)}</small>
              {typeof d.hours === 'number' && d.hours < 24 && <small className="parcial">dados de {d.hours} das 24 horas</small>}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

// Mês do último registro do banco: acumulado (até o último registro) x média do mesmo mês nos anos anteriores.
export function MonthPanel({ month, error, rotulo = 'Este mês' }) {
  if (error) return <Indisponivel />;
  if (!month || month.accumulatedMm == null) return <Empty>Histórico mensal indisponível.</Empty>;
  const { accumulatedMm: a, historicalAvgMm: h } = month;
  const max = Math.max(a, h ?? 0, 1);
  const verdict = h == null ? null : a < h * 0.9 ? 'abaixo da média' : a > h * 1.1 ? 'acima da média' : 'próximo da média';
  return (
    <div>
      <p className="note">
        Acumulado de {month.label}{month.until ? ` (até ${fmtDay(month.until.slice(0, 10))})` : ''}
        {h != null && <> vs. média de {month.monthName ?? 'mesmo mês'}{month.fromYear ? ` em ${month.fromYear === month.toYear ? month.fromYear : `${month.fromYear}–${month.toYear}`}` : ''}</>}.
      </p>
      <div className="bar-row"><span>{rotulo}: {mm(a)}</span><div className="bar"><i style={{ width: `${(a / max) * 100}%`, background: 'var(--blue)' }} /></div></div>
      {h != null && <div className="bar-row"><span>Média histórica: {mm(h)}</span><div className="bar"><i style={{ width: `${(h / max) * 100}%`, background: 'var(--light)' }} /></div></div>}
      {verdict && <p><strong>O acumulado está {verdict}.</strong></p>}
    </div>
  );
}
