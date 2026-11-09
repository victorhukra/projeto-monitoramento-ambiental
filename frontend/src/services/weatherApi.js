import { supabase } from '../lib/supabase.js';
import { getCurrent, getDaysEnding, getLast24h, getLastDays, getMonthDetail, getMonthHours, getRainEvents, getStation, getTimeBounds } from './forecastRepo.js';
import { dbTimeToIso } from '../lib/format.js';
import { dailyFromHours, monthDays, rainChance, monthSummary } from '../lib/daily.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // depois disso a consulta é refeita
// wind_speed_10m está em m/s: no teste de 27/10/2026 o máximo da tabela foi 8,98 e a média recente 2,5.
const WIND_TO_KMH = 3.6;
const NOT_CONFIGURED = 'Banco não configurado: preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env e reinicie o npm run dev.';
// Histórico: mesmo mês dos anos anteriores ao último registro (até 10 anos; anos sem dados são ignorados).
const HISTORY_YEARS = 10;
const monthName = (month) => new Date(Date.UTC(2000, month - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
const cache = new Map();

const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v) => (v == null || v === '' ? null : String(v));
const flags = (o, fn) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).map(([k, v]) => [k, fn(v)]));
const fresh = (key) => {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.data : null;
};
const aborted = () => new DOMException('A solicitação foi cancelada.', 'AbortError');
const failure = (r) => (r.status === 'rejected' ? r.reason?.message || 'erro desconhecido' : null);
const hours = (rows) => arr(rows).map((r) => ({ t: dbTimeToIso(r?.horario), mm: r?.chuva_mm, tempC: r?.temperatura_c, windMs: r?.vento_ms }));

// Mês do último registro, no ano dele e nos anteriores. Uma busca serve a dois blocos:
// - climate: chance histórica (% de dias com chuva ≥ 1 mm nos anos anteriores) → card de indicadores;
// - month: acumulado do mês no ano do último registro x média do mês nos anos anteriores → "Histórico do mês".
async function getHistory(signal, lastTime) {
  const [year, month] = [Number(String(lastTime).slice(0, 4)), Number(String(lastTime).slice(5, 7))];
  if (!year || !month) throw new Error('último registro sem data');
  const years = Array.from({ length: HISTORY_YEARS + 1 }, (_, i) => year - HISTORY_YEARS + i); // anos anteriores + o atual
  const perYear = await Promise.all(years.map((y) => getMonthHours(signal, y, month)));
  const byYear = Object.fromEntries(years.map((y, i) => [y, hours(perYear[i])]));
  const previous = years.filter((y) => y < year && byYear[y].length);
  const name = monthName(month);
  return {
    climate: previous.length
      ? { ...rainChance(previous.flatMap((y) => byYear[y])), monthLabel: name, fromYear: previous[0], toYear: previous.at(-1) }
      : null,
    month: { ...monthSummary(byYear, year, month), label: `${name} de ${year}`, monthName: name, until: dbTimeToIso(lastTime), source: 'Banco do projeto (Supabase)' },
  };
}

// Consultas ao banco. allSettled: uma consulta com erro afeta só o bloco dela.
async function getObserved(signal) {
  const [current, series, days, events, station] = await Promise.allSettled(
    [getCurrent(signal), getLast24h(signal), getLastDays(signal), getRainEvents(signal), getStation(signal)],
  );
  if (signal?.aborted) throw aborted();
  // o histórico depende da data do último registro, por isso vem depois das outras consultas
  const history = current.value?.data_hora
    ? (await Promise.allSettled([getHistory(signal, current.value.data_hora)]))[0]
    : { status: 'rejected', reason: new Error('depende do último registro') };
  if (signal?.aborted) throw aborted();
  return {
    history: history.value ?? null,
    current: current.value ?? null, series: series.value ?? [], days: days.value ?? [], events: events.value ?? [], station: station.value ?? null,
    errors: { current: failure(current), series: failure(series), days: failure(days), events: failure(events), station: failure(station), history: failure(history) },
  };
}

// Converte as respostas do banco (aliases snake_case das consultas) para o formato da tela.
// Tudo vem do banco: o que falhar fica vazio e o bloco mostra o erro (nunca há dado inventado).
function merge({ current: c, series, days, events, station, history, errors }) {
  const errs = Object.values(errors).filter(Boolean);
  const dbError = errs.length === Object.keys(errors).length ? errs[0] : null; // todas as consultas falharam

  const at = dbTimeToIso(c?.data_hora);
  const rows = hours(series).reverse(); // 1.2 vem do mais recente para o mais antigo
  const last = Date.parse(rows.at(-1)?.t);
  const wind = num(c?.vento_ms);
  const windy = rows.filter((r) => num(r.windMs) != null);
  const peak = windy.reduce((a, r) => (!a || r.windMs > a.windMs ? r : a), null); // máxima das últimas 24 h
  const rainy = rows.filter((r) => num(r.mm) != null);
  const wettest = rainy.reduce((a, r) => (!a || r.mm > a.mm ? r : a), null); // maior chuva em 1 hora nas últimas 24 h
  const total = Math.round(rainy.reduce((sum, r) => sum + r.mm, 0) * 10) / 10; // chuva acumulada nas últimas 24 h
  return {
    meta: { updatedAt: at, source: `Banco do projeto (Supabase)${c?.cidade ? ` · ${c.cidade}` : ''}`, errors, dbError },
    city: errors.current || !c ? null : {
      rainMm: c?.chuva_mm, tempC: c?.temperatura_c, feelsC: c?.sensacao_termica_c, humidity: c?.umidade_pct,
      windKmh: wind == null ? null : wind * WIND_TO_KMH,
      windMaxKmh: peak ? peak.windMs * WIND_TO_KMH : null, windMaxAt: peak?.t ?? null,
    },
    climate: history?.climate ?? null,
    month: history?.month ?? null,
    hourly: rows.map((r) => ({ t: r.t, mm: r.mm, tempC: r.tempC, offset: Math.round((Date.parse(r.t) - last) / 3600e3) })), // offset: horas até o último registro (≤ 0)
    rainPeak: wettest ? { mm: wettest.mm, t: wettest.mm > 0 ? wettest.t : null } : null,
    rain24h: rainy.length ? { mm: total, from: rows[0].t, to: rows.at(-1).t } : null,
    daily: dailyFromHours(hours(days)),
    rainEvents: arr(events).map((e) => ({ t: dbTimeToIso(e?.data_hora), mm: e?.chuva_mm, tempC: e?.temperatura_c, cloudPct: e?.nuvens_pct })),
    station: station ? { lat: station.latitude, lon: station.longitude } : null,
  };
}

// Converte para o formato consumido pela UI.
// Campos ausentes ou inválidos viram null/[]; os componentes já exibem "indisponível" nesses casos.
function normalize(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('A resposta veio em um formato inesperado.');
  const m = raw.meta ?? {};
  const c = raw.city;
  const mo = raw.month;
  const cl = raw.climate;
  const lat = num(raw.station?.lat), lon = num(raw.station?.lon);
  return {
    meta: {
      updatedAt: str(m.updatedAt), source: str(m.source), dbError: str(m.dbError), errors: flags(m.errors, str),
    },
    city: c ? {
      rainMm: num(c.rainMm), tempC: num(c.tempC), feelsC: num(c.feelsC), humidity: num(c.humidity),
      windKmh: num(c.windKmh), windMaxKmh: num(c.windMaxKmh), windMaxAt: str(c.windMaxAt),
    } : null,
    climate: cl && num(cl.pct) != null ? { pct: num(cl.pct), monthLabel: str(cl.monthLabel), fromYear: num(cl.fromYear), toYear: num(cl.toYear) } : null,
    hourly: arr(raw.hourly).filter((h) => h?.t && num(h.offset) != null).map((h) => ({ t: String(h.t), offset: num(h.offset), mm: num(h.mm), tempC: num(h.tempC) })),
    rainEvents: arr(raw.rainEvents).filter((e) => e?.t).map((e) => ({ t: String(e.t), mm: num(e.mm), tempC: num(e.tempC), cloudPct: num(e.cloudPct) })),
    daily: arr(raw.daily).filter((d) => d?.date).map((d) => ({ date: String(d.date), rainMm: num(d.rainMm), tMin: num(d.tMin), tMax: num(d.tMax) })),
    station: lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null,
    rainPeak: raw.rainPeak && num(raw.rainPeak.mm) != null ? { mm: num(raw.rainPeak.mm), t: str(raw.rainPeak.t) } : null,
    rain24h: raw.rain24h && num(raw.rain24h.mm) != null ? { mm: num(raw.rain24h.mm), from: str(raw.rain24h.from), to: str(raw.rain24h.to) } : null,
    month: mo ? {
      label: str(mo.label), monthName: str(mo.monthName), accumulatedMm: num(mo.accumulatedMm), historicalAvgMm: num(mo.historicalAvgMm),
      fromYear: num(mo.fromYear), toYear: num(mo.toYear), until: str(mo.until), source: str(mo.source),
    } : null,
  };
}

// Período coberto pelo banco, em datas locais "AAAA-MM-DD": { minDate, maxDate } (null se a tabela estiver vazia).
export async function getDataPeriod({ signal } = {}) {
  if (!supabase) throw new Error(NOT_CONFIGURED);
  const hit = fresh('periodo');
  if (hit) return hit;
  const { first, last } = await getTimeBounds(signal);
  const day = (v) => dbTimeToIso(v)?.slice(0, 10) ?? null;
  const data = { minDate: day(first), maxDate: day(last) };
  cache.set('periodo', { at: Date.now(), data });
  return data;
}

// Os 7 dias que terminam em endDate (inclusive), do mais antigo para o mais recente.
// Dias sem nenhum registro no banco aparecem com valores null (a tela mostra "sem registros"); nada é inventado.
export async function getWeekEnding(endDate, { signal } = {}) {
  if (!supabase) throw new Error(NOT_CONFIGURED);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(endDate))) throw new Error('Data inválida.');
  const rows = await getDaysEnding(signal, endDate);
  if (signal?.aborted) throw aborted();
  const byDate = new Map(dailyFromHours(hours(rows), 7).map((d) => [d.date, d]));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${endDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6 + i);
    const date = d.toISOString().slice(0, 10);
    const found = byDate.get(date);
    return found
      ? { date, rainMm: num(found.rainMm), tMin: num(found.tMin), tMax: num(found.tMax), hours: found.hours }
      : { date, rainMm: null, tMin: null, tMax: null, hours: 0 };
  });
}

// Relatório de um mês escolhido (ano, mês 1–12), só com registros do banco:
// - acumulado do mês x média do mesmo mês nos até 10 anos anteriores que têm o mês quase completo (monthSummary);
// - os dias do mês com chuva, temperatura máx./mín., umidade e nuvens médias e a parte do acumulado de cada dia.
export async function getMonthReport(year, month, { signal } = {}) {
  if (!supabase) throw new Error(NOT_CONFIGURED);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('Mês inválido.');
  const key = `mes:${year}-${month}`;
  const hit = fresh(key);
  if (hit) return hit;
  const anteriores = Array.from({ length: HISTORY_YEARS }, (_, i) => year - HISTORY_YEARS + i);
  const [detalhe, ...porAno] = await Promise.all([getMonthDetail(signal, year, month), ...anteriores.map((y) => getMonthHours(signal, y, month))]);
  if (signal?.aborted) throw aborted();
  const linhas = arr(detalhe).map((r) => ({
    t: dbTimeToIso(r?.horario), mm: num(r?.chuva_mm), tempC: num(r?.temperatura_c), humidity: num(r?.umidade_pct), cloudPct: num(r?.nuvens_pct),
  }));
  const byYear = { [year]: linhas, ...Object.fromEntries(anteriores.map((y, i) => [y, hours(porAno[i])])) };
  const resumo = monthSummary(byYear, year, month);
  const name = monthName(month);
  const data = {
    year, month, monthName: name, label: `${name} de ${year}`,
    hours: linhas.length, expectedHours: new Date(Date.UTC(year, month, 0)).getUTCDate() * 24,
    from: linhas[0]?.t ?? null, until: linhas.at(-1)?.t ?? null,
    accumulatedMm: linhas.length ? resumo.accumulatedMm : null,
    historicalAvgMm: resumo.historicalAvgMm, fromYear: resumo.fromYear, toYear: resumo.toYear,
    days: monthDays(linhas),
    source: 'Banco do projeto (Supabase)',
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

export async function getForecast({ signal } = {}) {
  if (signal?.aborted) throw aborted();

  const hit = fresh('dados');
  if (hit) return hit;
  if (!supabase) throw new Error(NOT_CONFIGURED);
  const data = normalize(merge(await getObserved(signal)));
  if (signal?.aborted) throw aborted();
  if (!data.meta.dbError && !Object.values(data.meta.errors).some(Boolean)) cache.set('dados', { at: Date.now(), data }); // com erro, tenta de novo na próxima
  return data;
}
