import { supabase } from '../lib/supabase.js';
import { getCurrent, getDayDetail, getDaysEnding, getLastDays, getMonthDetail, getMonthHours, getStation, getTimeBounds } from './forecastRepo.js';
import { dbTimeToIso } from '../lib/format.js';
import { dailyFromHours, monthDays, rainChance, monthSummary } from '../lib/daily.js';
import { ErroAmigavel, MSG, cancelado, erroDeConfiguracao, mensagemParaUsuario } from '../lib/mensagensErro.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // depois disso a consulta é refeita
// wind_speed_10m está em m/s: no teste de 27/10/2026 o máximo da tabela foi 8,98 e a média recente 2,5.
const WIND_TO_KMH = 3.6;
// Instrução para quem desenvolve: vai só para o console; a tela mostra um texto genérico (lib/mensagensErro.js).
const NOT_CONFIGURED = 'Banco não configurado: preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env e reinicie o npm run dev.';
// Histórico: mesmo mês dos anos anteriores ao escolhido (até 10 anos; anos sem dados são ignorados).
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
const aborted = cancelado;
// Texto amigável do erro de uma consulta (allSettled), para o bloco correspondente da tela.
const failure = (r) => (r.status === 'rejected' ? mensagemParaUsuario(r.reason) : null);
const hours = (rows) => arr(rows).map((r) => ({ t: dbTimeToIso(r?.horario), mm: r?.chuva_mm, tempC: r?.temperatura_c }));

// Os 7 dias do calendário que terminam em endDate (inclusive), do mais antigo para o mais recente, a partir de
// registros horários ({ t, mm, tempC }). Usada pela visão padrão de "Últimos 7 dias" e pela semana escolhida, para
// que as duas interpretem os dados do mesmo jeito. hours = registros do dia: 0 = dia sem medições (valores null,
// nunca chuva zero); < 24 = dia parcial. Nada é inventado.
function seteDiasAte(endDate, linhas) {
  const byDate = new Map(dailyFromHours(linhas, Infinity).map((d) => [d.date, d]));
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

// Data local ("AAAA-MM-DD") do registro mais recente de uma lista de registros horários.
const ultimaData = (linhas) => linhas.map((r) => r.t?.slice(0, 10)).filter(Boolean).sort().at(-1) ?? null;

// Consultas ao banco usadas pela página inicial: último registro (data da atualização e mapa), 7 dias e ponto
// de medição. O resumo do dia, o histórico do mês e a comparação fazem as próprias consultas.
// allSettled: uma consulta com erro afeta só o bloco dela.
async function getObserved(signal) {
  const [current, days, station] = await Promise.allSettled([getCurrent(signal), getLastDays(signal), getStation(signal)]);
  if (signal?.aborted) throw aborted();
  return {
    current: current.value ?? null, days: days.value ?? [], station: station.value ?? null,
    errors: { current: failure(current), days: failure(days), station: failure(station) },
  };
}

// Converte as respostas do banco (aliases snake_case das consultas) para o formato da tela.
// Tudo vem do banco: o que falhar fica vazio e o bloco mostra o erro (nunca há dado inventado).
function merge({ current: c, days, station, errors }) {
  const errs = Object.values(errors).filter(Boolean);
  const dbError = errs.length === Object.keys(errors).length ? errs[0] : null; // todas as consultas falharam
  const linhasDias = hours(days);
  const fimDias = ultimaData(linhasDias); // os 7 dias terminam no dia do registro mais recente
  return {
    meta: { updatedAt: dbTimeToIso(c?.data_hora), source: `Banco do projeto (Supabase)${c?.cidade ? ` · ${c.cidade}` : ''}`, errors, dbError },
    city: errors.current || !c ? null : { rainMm: c.chuva_mm, tempC: c.temperatura_c }, // legenda do ponto no mapa
    daily: fimDias ? seteDiasAte(fimDias, linhasDias) : [],
    station: station ? { lat: station.latitude, lon: station.longitude } : null,
  };
}

// Converte para o formato consumido pela UI.
// Campos ausentes ou inválidos viram null/[]; os componentes já exibem "indisponível" nesses casos.
function normalize(raw) {
  if (!raw || typeof raw !== 'object') throw new ErroAmigavel(MSG.respostaInvalida, { detalhe: 'resposta sem objeto' });
  const m = raw.meta ?? {};
  const lat = num(raw.station?.lat), lon = num(raw.station?.lon);
  return {
    meta: { updatedAt: str(m.updatedAt), source: str(m.source), dbError: str(m.dbError), errors: flags(m.errors, str) },
    city: raw.city ? { rainMm: num(raw.city.rainMm), tempC: num(raw.city.tempC) } : null,
    daily: arr(raw.daily).filter((d) => d?.date).map((d) => ({ date: String(d.date), rainMm: num(d.rainMm), tMin: num(d.tMin), tMax: num(d.tMax), hours: num(d.hours) })),
    station: lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null,
  };
}

// Período coberto pelo banco, em datas locais "AAAA-MM-DD": { minDate, maxDate } (null se a tabela estiver vazia).
export async function getDataPeriod({ signal } = {}) {
  if (!supabase) throw erroDeConfiguracao(NOT_CONFIGURED);
  const hit = fresh('periodo');
  if (hit) return hit;
  const { first, last } = await getTimeBounds(signal);
  const day = (v) => dbTimeToIso(v)?.slice(0, 10) ?? null;
  const data = { minDate: day(first), maxDate: day(last) };
  cache.set('periodo', { at: Date.now(), data });
  return data;
}

// Os 7 dias que terminam em endDate (inclusive), do mais antigo para o mais recente (mesma lógica da visão padrão).
export async function getWeekEnding(endDate, { signal } = {}) {
  if (!supabase) throw erroDeConfiguracao(NOT_CONFIGURED);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(endDate))) throw new ErroAmigavel('A data escolhida não é válida. Escolha outra data.');
  const rows = await getDaysEnding(signal, endDate);
  if (signal?.aborted) throw aborted();
  return seteDiasAte(endDate, hours(rows));
}

// Resumo de um dia escolhido ("AAAA-MM-DD"), só com registros do banco:
// - os registros de hora em hora (gráficos) e os indicadores calculados a partir deles;
// - a chance histórica de chuva no mesmo mês dos até 10 anos anteriores (não é previsão).
// hours = 0 quando o banco não tem registros nesse dia (nada é inventado). Se só o histórico falhar,
// o resumo continua e climateError explica o card da chance.
export async function getDayReport(date, { signal } = {}) {
  if (!supabase) throw erroDeConfiguracao(NOT_CONFIGURED);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new ErroAmigavel('A data escolhida não é válida. Escolha outra data.');
  const key = `dia:${date}`;
  const hit = fresh(key);
  if (hit) return hit;
  const [year, month] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  const anteriores = Array.from({ length: HISTORY_YEARS }, (_, i) => year - HISTORY_YEARS + i);
  const [dia, historico] = await Promise.allSettled([
    getDayDetail(signal, date),
    Promise.all(anteriores.map((y) => getMonthHours(signal, y, month))),
  ]);
  if (signal?.aborted) throw aborted();
  if (dia.status === 'rejected') throw dia.reason;

  const linhas = arr(dia.value).map((r) => {
    const vento = num(r?.vento_ms);
    return { t: dbTimeToIso(r?.horario), mm: num(r?.chuva_mm), tempC: num(r?.temperatura_c), humidity: num(r?.umidade_pct), windKmh: vento == null ? null : vento * WIND_TO_KMH };
  }).filter((r) => r.t);
  // Registro com o maior (ou menor) valor de um campo; null se nenhum registro tiver o campo.
  const extremo = (campo, maior = true) => linhas.filter((r) => r[campo] != null)
    .reduce((a, r) => (!a || (maior ? r[campo] > a[campo] : r[campo] < a[campo]) ? r : a), null);
  const media = (campo) => {
    const v = linhas.map((r) => r[campo]).filter((x) => x != null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const comChuva = linhas.filter((r) => r.mm != null);
  const [pico, tMax, tMin, vMax] = [extremo('mm'), extremo('tempC'), extremo('tempC', false), extremo('windKmh')];

  let climate = null;
  if (historico.status === 'fulfilled') {
    const porAno = anteriores.map((y, i) => [y, hours(historico.value[i])]).filter(([, rows]) => rows.length);
    if (porAno.length) climate = { ...rainChance(porAno.flatMap(([, rows]) => rows)), monthLabel: monthName(month), fromYear: porAno[0][0], toYear: porAno.at(-1)[0] };
  }
  const data = {
    date, hours: linhas.length,
    hourly: linhas.map(({ t, mm, tempC }) => ({ t, mm, tempC })),
    totalMm: comChuva.length ? Math.round(comChuva.reduce((s, r) => s + r.mm, 0) * 10) / 10 : null,
    rainPeak: pico ? { mm: pico.mm, t: pico.mm > 0 ? pico.t : null } : null,
    tempMax: tMax ? { c: tMax.tempC, t: tMax.t } : null,
    tempMin: tMin ? { c: tMin.tempC, t: tMin.t } : null,
    humidityAvg: media('humidity'),
    windAvgKmh: media('windKmh'),
    windMax: vMax ? { kmh: vMax.windKmh, t: vMax.t } : null,
    climate,
    climateError: failure(historico),
  };
  if (!data.climateError) cache.set(key, { at: Date.now(), data }); // com erro no histórico, tenta de novo na próxima
  return data;
}

// Relatório de um mês escolhido (ano, mês 1–12), só com registros do banco:
// - acumulado do mês x média do mesmo mês nos até 10 anos anteriores que têm o mês quase completo (monthSummary);
// - os dias do mês com chuva, temperatura máx./mín., umidade e nuvens médias e a parte do acumulado de cada dia.
export async function getMonthReport(year, month, { signal } = {}) {
  if (!supabase) throw erroDeConfiguracao(NOT_CONFIGURED);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new ErroAmigavel('O mês escolhido não é válido. Escolha outro mês.');
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
    until: linhas.at(-1)?.t ?? null,
    accumulatedMm: linhas.length ? resumo.accumulatedMm : null,
    historicalAvgMm: resumo.historicalAvgMm, fromYear: resumo.fromYear, toYear: resumo.toYear,
    days: monthDays(linhas),
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

export async function getForecast({ signal } = {}) {
  if (signal?.aborted) throw aborted();

  const hit = fresh('dados');
  if (hit) return hit;
  if (!supabase) throw erroDeConfiguracao(NOT_CONFIGURED);
  const data = normalize(merge(await getObserved(signal)));
  if (signal?.aborted) throw aborted();
  if (!data.meta.dbError && !Object.values(data.meta.errors).some(Boolean)) cache.set('dados', { at: Date.now(), data }); // com erro, tenta de novo na próxima
  return data;
}
