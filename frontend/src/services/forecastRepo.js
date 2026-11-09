// Consultas da Seção 1 de consultas_oficiais.sql (equipe do banco), traduzidas para PostgREST.
// Só leitura. Cada função devolve as linhas cruas (aliases do SQL) ou lança erro.
import { supabase } from '../lib/supabase.js';
import { erroDeConsulta } from '../lib/mensagensErro.js';

const TABLE = 'dataset_weather_goes';

// Erro do Supabase: o detalhe técnico vai para o console e a tela recebe um texto amigável (lib/mensagensErro.js).
const run = async (query) => {
  const { data, error, status } = await query;
  if (error) throw erroDeConsulta(error, status);
  return data;
};

const hasRowsBetween = async (signal, start, end) => {
  const rows = await run(supabase.from(TABLE)
    .select('time')
    .gte('time', start)
    .lt('time', end)
    .limit(1)
    .abortSignal(signal));
  return rows.length > 0;
};

export const getMonthsWithData = async (signal, year) => {
  const months = await Promise.all(Array.from({ length: 12 }, (_, index) => index + 1)
    .map(async (month) => {
      const start = `${year}-${String(month).padStart(2, '0')}-01T00:00:00`;
      const next = month === 12 ? `${year + 1}-01-01T00:00:00` : `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00`;
      return { month, available: await hasRowsBetween(signal, start, next) };
    }));
  return months.filter(({ available }) => available).map(({ month }) => month);
};

export const getYearsWithData = async (signal, firstYear, lastYear) => {
  const years = await Promise.all(Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index)
    .map(async (year) => ({
      year,
      available: await hasRowsBetween(signal, `${year}-01-01T00:00:00`, `${year + 1}-01-01T00:00:00`),
    })));
  return years.filter(({ available }) => available).map(({ year }) => year);
};

// 1.1 / view clima_atual: último registro (data_hora, cidade, temperatura_c, sensacao_termica_c, umidade_pct, vento_ms, chuva_mm)
export const getCurrent = (signal) =>
  run(supabase.from('clima_atual').select('*').abortSignal(signal).maybeSingle());

// Últimos 7 dias: horário, temperatura e chuva, com registros suficientes para 7 dias completos de hora em hora
// (7 × 24 + 23, para o caso de o último dia ainda estar pela metade). O agrupamento por dia é feito no frontend.
export const getLastDays = (signal) =>
  run(supabase.from(TABLE)
    .select('horario:time, temperatura_c:temperature_2m, chuva_mm:precipitation')
    .order('time', { ascending: false })
    .limit(7 * 24 + 23)
    .abortSignal(signal));

// Primeiro e último horário do banco: limites do calendário de "Últimos 7 dias".
export const getTimeBounds = async (signal) => {
  const edge = (ascending) => run(supabase.from(TABLE).select('time').order('time', { ascending }).limit(1).abortSignal(signal).maybeSingle());
  const [first, last] = await Promise.all([edge(true), edge(false)]);
  return { first: first?.time ?? null, last: last?.time ?? null };
};

// 7 dias que terminam em endDate ("AAAA-MM-DD", inclusive): registros horários de endDate−6 00:00 até endDate+1 00:00.
// Até 7 × 24 = 168 linhas (com folga), abaixo do limite de 1000 do PostgREST.
export const getDaysEnding = (signal, endDate) => {
  const shift = (n) => {
    const d = new Date(`${endDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return run(supabase.from(TABLE)
    .select('horario:time, temperatura_c:temperature_2m, chuva_mm:precipitation')
    .gte('time', `${shift(-6)}T00:00:00`)
    .lt('time', `${shift(1)}T00:00:00`)
    .order('time', { ascending: true })
    .limit(200)
    .abortSignal(signal));
};

// Ponto de medição para o mapa (colunas latitude/longitude do dataset; não estão no .sql da equipe).
export const getStation = (signal) =>
  run(supabase.from(TABLE).select('latitude, longitude').order('time', { ascending: false }).limit(1).abortSignal(signal).maybeSingle());

// Registros horários de um mês inteiro (ex.: setembro de 2023), para a chance histórica de chuva.
// Inclui margem para dias com horário de verão; continua abaixo do limite de 1000 linhas do PostgREST.
export const getMonthHours = (signal, year, month) => {
  const pad = (n) => String(n).padStart(2, '0');
  const next = month === 12 ? `${year + 1}-01` : `${year}-${pad(month + 1)}`;
  return run(supabase.from(TABLE)
    .select('horario:time, chuva_mm:precipitation, temperatura_c:temperature_2m')
    .gte('time', `${year}-${pad(month)}-01T00:00:00`)
    .lt('time', `${next}-01T00:00:00`)
    .limit(750)
    .abortSignal(signal));
};

// Registros horários de um mês com as medidas usadas no detalhe por dia (chuva, temperatura, umidade, nuvens).
// 31 × 24 = 744 linhas no máximo, abaixo do limite de 1000 do PostgREST.
export const getMonthDetail = (signal, year, month) => {
  const pad = (n) => String(n).padStart(2, '0');
  const next = month === 12 ? `${year + 1}-01` : `${year}-${pad(month + 1)}`;
  return run(supabase.from(TABLE)
    .select('horario:time, chuva_mm:precipitation, temperatura_c:temperature_2m, umidade_pct:relative_humidity_2m, nuvens_pct:cloud_cover')
    .gte('time', `${year}-${pad(month)}-01T00:00:00`)
    .lt('time', `${next}-01T00:00:00`)
    .order('time', { ascending: true })
    .limit(800)
    .abortSignal(signal));
};

// Registros horários de um dia ("AAAA-MM-DD", horário de Londrina) com as medidas do resumo do dia:
// chuva, temperatura, umidade e vento. 24 linhas por dia (limite com folga).
export const getDayDetail = (signal, date) => {
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
  return run(supabase.from(TABLE)
    .select('horario:time, chuva_mm:precipitation, temperatura_c:temperature_2m, umidade_pct:relative_humidity_2m, vento_ms:wind_speed_10m')
    .gte('time', `${date}T00:00:00`)
    .lt('time', `${next}T00:00:00`)
    .order('time', { ascending: true })
    .limit(30)
    .abortSignal(signal));
};

// Registros horários de um dia, usados para comparar datas específicas.
export const getDayHours = (signal, year, month, day) => {
  const start = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return run(supabase.from(TABLE)
    .select('horario:time, chuva_mm:precipitation, temperatura_c:temperature_2m')
    .gte('time', `${start}T00:00:00`)
    .lt('time', `${end}T00:00:00`)
    .limit(25)
    .abortSignal(signal));
};
