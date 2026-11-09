import { mm, pct, kmh, celsius, beaufort, fmtDateTime, fmtHour, fmtDay } from '../lib/format.js';

export const Empty = ({ children }) => <p className="empty">{children}</p>;

// "das 00h às 23h de qua., 30" ou, se passar da meia-noite, "das 14h de ter., 29 às 13h de qua., 30".
const span = (from, to) => {
  const [d1, d2] = [fmtDay(from.slice(0, 10)), fmtDay(to.slice(0, 10))];
  return d1 === d2 ? `das ${fmtHour(from)} às ${fmtHour(to)} de ${d2}` : `das ${fmtHour(from)} de ${d1} às ${fmtHour(to)} de ${d2}`;
};

// Chuva acumulada: soma dos 24 registros mais recentes do banco (consulta 1.2).
export function Rain24h({ rain, error }) {
  return (
    <section className="card total" aria-labelledby="t-acumulado">
      <h3 id="t-acumulado">Chuva acumulada nas últimas 24h</h3>
      {error ? <p className="err" role="alert">Não foi possível ler o banco: {error}</p>
        : !rain ? <Empty>Sem registros das últimas 24 horas.</Empty>
        : (
          <>
            <strong>{mm(rain.mm)}</strong>
            <p>{rain.mm > 0 ? '' : 'sem chuva no período · '}{span(rain.from, rain.to)}</p>
          </>
        )}
      <p className="note">Soma dos 24 registros mais recentes · cidade toda</p>
    </section>
  );
}

// "at" é a data_hora do último registro do banco (não necessariamente a hora atual).
// climate: chance histórica de chuva no mês do último registro (não é previsão).
// rainPeak: maior chuva em 1 hora nos últimos 24 registros (peakError: erro dessa consulta).
export function Indicators({ city, climate, rainPeak, peakError, at, error }) {
  if (error) return <p className="err" role="alert">Não foi possível ler o banco: {error}</p>;
  if (!city) return <Empty>Indicadores indisponíveis.</Empty>;
  const wind = [beaufort(city.windKmh), city.windMaxKmh != null && `máx. ${kmh(city.windMaxKmh)}${city.windMaxAt ? ` às ${fmtHour(city.windMaxAt)}` : ''} (últimas 24h)`];
  const chance = climate?.pct != null
    ? `dias de ${climate.monthLabel} com chuva (${climate.fromYear}–${climate.toYear}) · não é previsão`
    : 'não foi possível calcular com o histórico';
  const peak = peakError ? [null, 'não foi possível ler o banco']
    : !rainPeak ? [null, 'sem registros das últimas 24 horas']
    : rainPeak.mm > 0 ? [rainPeak.mm, `em 1 hora, às ${fmtHour(rainPeak.t)} de ${fmtDay(rainPeak.t.slice(0, 10))}`]
    : [0, 'sem chuva nas últimas 24 horas'];
  const cards = [
    ['Maior chuva nas últimas 24h', mm(peak[0]), peak[1]],
    ['Chance histórica de chuva', pct(climate?.pct), chance],
    ['Umidade relativa', pct(city.humidity), `temperatura: ${celsius(city.tempC)} · sensação ${celsius(city.feelsC)}`],
    ['Vento', kmh(city.windKmh), wind.filter(Boolean).join(' · ') || 'sem histórico das últimas 24h'],
  ];
  return (
    <div className="grid4" role="group" aria-label={at ? `Indicadores do registro de ${fmtDateTime(at)}` : 'Indicadores'}>
      {cards.map(([t, v, s]) => <div className="card kpi" key={t}><span className="lbl">{t}</span><strong>{v}</strong><span className="sub">{s}</span></div>)}
    </div>
  );
}

const deg = (v) => (v == null ? '—' : `${Math.round(v)}°`);

// 7 dias observados: chuva acumulada no dia e temperatura máx./mín. (só leitura).
// hours (opcional): quantos registros horários o dia tem no banco. 0 = sem registros; < 24 = dia incompleto.
export function LastDays({ days, error }) {
  if (error) return <p className="err" role="alert">Não foi possível ler o banco: {error}</p>;
  if (!days?.length) return <Empty>Sem registros dos últimos dias.</Empty>;
  return (
    <ul className="week" aria-label="Chuva e temperatura dos últimos 7 dias">
      {days.map((d) => (
        <li key={d.date} className={`day${d.hours === 0 ? ' vazio' : ''}`}>
          <b>{fmtDay(d.date)}</b>
          {d.hours === 0 ? <span>sem registros</span> : (
            <>
              <span>{mm(d.rainMm)}</span>
              <small>{deg(d.tMax)} / {deg(d.tMin)}</small>
              {typeof d.hours === 'number' && d.hours < 24 && <small className="parcial">dados parciais ({d.hours}h)</small>}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

// Consulta 1.3: últimos registros com chuva > 0. Tabela só de leitura.
export function RainEvents({ events, error }) {
  return (
    <section className="card" aria-labelledby="t-eventos">
      <h2 id="t-eventos">Últimos eventos de chuva</h2>
      <p className="note">Registros com chuva acima de 0 mm · 15 mais recentes · cidade toda</p>
      {error ? <p className="err" role="alert">Não foi possível ler o banco: {error}</p>
        : !events?.length ? <Empty>Nenhum evento de chuva registrado.</Empty>
        : (
          <div className="scroll">
            <table>
              <thead><tr><th>Data e hora</th><th>Chuva</th><th>Temperatura</th><th>Nuvens</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.t}><td>{fmtDateTime(e.t) ?? 'indisponível'}</td><td>{mm(e.mm)}</td><td>{celsius(e.tempC)}</td><td>{pct(e.cloudPct)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

// Mês do último registro do banco: acumulado (até o último registro) x média do mesmo mês nos anos anteriores.
export function MonthPanel({ month, error, rotulo = 'Este mês' }) {
  if (error) return <p className="err" role="alert">Não foi possível ler o banco: {error}</p>;
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
      <div className="bar-row"><span>{rotulo}: {mm(a)}</span><div className="bar"><i style={{ width: `${(a / max) * 100}%`, background: '#2563EB' }} /></div></div>
      {h != null && <div className="bar-row"><span>Média histórica: {mm(h)}</span><div className="bar"><i style={{ width: `${(h / max) * 100}%`, background: '#BBD5F2' }} /></div></div>}
      {verdict && <p><strong>O acumulado está {verdict}.</strong></p>}
    </div>
  );
}
