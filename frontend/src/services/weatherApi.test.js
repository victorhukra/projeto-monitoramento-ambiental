import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as db from '../test/dbFixture.js';
import { ErroAmigavel, MSG } from '../lib/mensagensErro.js';

// Cada teste carrega o módulo do zero (o cache de 5 min fica dentro dele).
// Falhas simuladas como forecastRepo.js as entrega: erro amigável (o detalhe técnico já foi para o console).
// tecnico: lista de consultas que falham com um erro cru (ex.: defeito no código), que nunca deve chegar à tela.
// dias: substitui os registros da consulta "últimos dias" (do mais recente para o mais antigo, como a real).
const load = async ({ configured = true, fail = [], tecnico = [], dias = db.lastDays } = {}) => {
  vi.resetModules();
  vi.doMock('../lib/supabase.js', () => ({ supabase: configured ? {} : null }));
  const answer = (name, value) => (
    tecnico.includes(name) ? () => Promise.reject(new TypeError(`detalhe interno de ${name}`))
      : fail.includes(name) ? () => Promise.reject(new ErroAmigavel(`falha em ${name}`))
        : () => Promise.resolve(value));
  vi.doMock('./forecastRepo.js', () => ({
    getCurrent: answer('current', db.current), getLastDays: answer('days', dias),
    // mesmo filtro da consulta real: [fim−6 dias, fim+1 dia), em ordem crescente
    getDaysEnding: (_s, fim) => Promise.resolve([...dias].reverse().filter((r) => {
      const d = r.horario.slice(0, 10), inicio = new Date(Date.parse(`${fim}T12:00:00Z`) - 6 * 864e5).toISOString().slice(0, 10);
      return d >= inicio && d <= fim;
    })),
    getStation: answer('station', db.station),
    // resumo do dia: 30/09/2026 tem os 24 registros da 1.2; qualquer outro dia, nenhum registro
    getDayDetail: fail.includes('dia') ? () => Promise.reject(new ErroAmigavel('falha em dia'))
      : (_s, date) => Promise.resolve(date === '2026-09-30' ? [...db.last24].reverse().map((r) => ({ ...r, umidade_pct: 70 + (Number(r.horario.slice(11, 13)) % 2) * 10 })) : []),
    getMonthHours: fail.includes('history') ? () => Promise.reject(new ErroAmigavel('falha em history')) : (_s, y, m) => Promise.resolve(db.monthHours(y, m)),
  }));
  const mod = await import('./weatherApi.js');
  return Object.assign(mod.getForecast, { getWeekEnding: mod.getWeekEnding, getDayReport: mod.getDayReport });
};

// 24 a 30/09/2026 de hora em hora, do mais recente para o mais antigo, SEM o dia 26 e com o dia 27 só das 12h às 23h.
const pad = (n) => String(n).padStart(2, '0');
const DIAS_COM_LACUNAS = Array.from({ length: 7 * 24 }, (_, i) => {
  const dia = 30 - Math.floor(i / 24), h = 23 - (i % 24);
  return { horario: `2026-09-${pad(dia)}T${pad(h)}:00:00`, temperatura_c: 18 + (h % 8), chuva_mm: h === 10 ? 1 : 0 };
}).filter((r) => {
  const dia = Number(r.horario.slice(8, 10)), h = Number(r.horario.slice(11, 13));
  return dia !== 26 && !(dia === 27 && h < 12);
});
const ALL = ['current', 'days', 'station'];

describe('getForecast (sempre dados do banco)', () => {
  let log;
  beforeEach(() => { vi.resetModules(); log = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => log.mockRestore());

  it('sem .env configurado: texto genérico na tela, instrução técnica só no console, nenhum número inventado', async () => {
    const getForecast = await load({ configured: false });
    const e = await getForecast().catch((x) => x);
    expect(e.message).toBe(MSG.configuracao);
    expect(e.detalhe).toMatch(/VITE_SUPABASE_URL/);
    expect(JSON.stringify(log.mock.calls)).toContain('VITE_SUPABASE_URL');
  });

  it('erro técnico inesperado numa consulta não chega à tela: vira texto genérico e vai para o console', async () => {
    const d = await (await load({ tecnico: ['days'] }))();
    expect(d.meta.errors.days).toBe(MSG.generico);
    expect(JSON.stringify(d)).not.toContain('detalhe interno');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Erro inesperado'), expect.any(TypeError));
  });

  it('banco fora do ar: avisa o erro e todos os blocos ficam vazios (sem demonstração)', async () => {
    const d = await (await load({ fail: ALL }))();
    expect(d.meta.dbError).toMatch(/falha em/);
    expect(d.city).toBeNull();
    expect(d.daily).toEqual([]);
    expect(d.station).toBeNull();
    expect(d).not.toHaveProperty('alert');
  });

  it('últimos 7 dias (padrão): todos os dias do calendário, com dia sem medições e dia parcial identificados', async () => {
    const d = await (await load({ dias: DIAS_COM_LACUNAS }))();
    expect(d.daily.map((x) => x.date)).toEqual(['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30']);
    const [, , semDados, parcial, normal] = d.daily;
    expect(semDados).toEqual({ date: '2026-09-26', rainMm: null, tMin: null, tMax: null, hours: 0 }); // nunca "0 mm"
    expect(parcial).toMatchObject({ date: '2026-09-27', hours: 12, rainMm: 0 }); // 12h às 23h: a chuva das 10h não existe
    expect(normal).toMatchObject({ date: '2026-09-28', hours: 24, rainMm: 1 });
  });

  it('últimos 7 dias: visão padrão e semana escolhida interpretam os mesmos registros do mesmo jeito', async () => {
    const getForecast = await load({ dias: DIAS_COM_LACUNAS });
    const padrao = (await getForecast()).daily;
    const escolhida = await getForecast.getWeekEnding('2026-09-30');
    expect(padrao).toEqual(escolhida);
  });

  it('busca só o que a página inicial mostra: data da atualização, 7 dias e ponto do mapa', async () => {
    const d = await (await load())();
    expect(Object.keys(d).sort()).toEqual(['city', 'daily', 'meta', 'station']);
    expect(d.meta.updatedAt).toBe('2026-09-30T23:00:00-03:00');
    expect(d.city).toEqual({ rainMm: 0, tempC: 23.6 });
    expect(d.station).toEqual({ lat: -23.304, lon: -51.186 });
    expect(d.meta.dbError).toBeNull();
    expect(Object.values(d.meta.errors).every((e) => e == null)).toBe(true);
  });

  it('uma consulta com erro afeta só o bloco dela', async () => {
    const d = await (await load({ fail: ['station'] }))();
    expect(d.meta.errors.station).toMatch(/falha em station/);
    expect(d.station).toBeNull();
    expect(d.city.tempC).toBe(23.6);
    expect(d.daily).toHaveLength(7);
  });
});

describe('getDayReport (resumo de um dia escolhido)', () => {
  afterEach(() => vi.doUnmock('./forecastRepo.js'));
  it('calcula os indicadores com os registros do dia', async () => {
    const { getDayReport } = await load();
    const dia = await getDayReport('2026-09-30');
    expect(dia.hours).toBe(24);
    expect(dia.totalMm).toBe(5.1); // 3,9 + 0,7 + 0,5
    expect(dia.rainPeak).toEqual({ mm: 3.9, t: '2026-09-30T13:00:00-03:00' });
    expect(dia.tempMax.c).toBe(25); // 20 + (h % 6), máximo 25
    expect(dia.tempMin.c).toBe(20);
    expect(dia.humidityAvg).toBe(75); // metade das horas com 70%, metade com 80%
    expect(dia.windMax).toEqual({ kmh: 4.83 * 3.6, t: '2026-09-30T12:00:00-03:00' });
    expect(dia.hourly).toHaveLength(24);
    expect(dia.hourly[0].t).toBe('2026-09-30T00:00:00-03:00'); // do mais antigo para o mais recente
    // chance histórica: setembros de 2024 (3 dias) e 2025 (6 dias) com chuva → 9 de 60 dias
    expect(dia.climate).toMatchObject({ pct: 15, monthLabel: 'setembro', fromYear: 2024, toYear: 2025 });
    expect(dia.climateError).toBeNull();
  });
  it('dia sem registros: hours 0 e nenhum valor inventado', async () => {
    const { getDayReport } = await load();
    const dia = await getDayReport('2025-01-15');
    expect(dia).toMatchObject({ hours: 0, totalMm: null, rainPeak: null, tempMax: null, windAvgKmh: null, humidityAvg: null });
  });
  it('falha no histórico não derruba o resumo: só a chance fica indisponível', async () => {
    const { getDayReport } = await load({ fail: ['history'] });
    const dia = await getDayReport('2026-09-30');
    expect(dia.hours).toBe(24);
    expect(dia.climate).toBeNull();
    expect(dia.climateError).toBe('falha em history');
  });
  it('falha nos registros do dia vira um erro amigável', async () => {
    const { getDayReport } = await load({ fail: ['dia'] });
    await expect(getDayReport('2026-09-30')).rejects.toThrow('falha em dia');
  });
  it('data inválida e banco não configurado', async () => {
    const { getDayReport } = await load();
    await expect(getDayReport('30/09/2026')).rejects.toThrow('A data escolhida não é válida');
    const semBanco = await load({ configured: false });
    // texto genérico na tela; a instrução técnica (VITE_SUPABASE_URL…) fica só no console
    const erro = await semBanco.getDayReport('2026-09-30').catch((e) => e);
    expect(erro.message).toMatch(/temporariamente/);
    expect(erro.message).not.toMatch(/VITE_/);
  });
});
