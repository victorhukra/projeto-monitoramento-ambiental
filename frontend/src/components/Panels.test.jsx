import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Indicators, LastDays, MonthPanel } from './Panels.jsx';

describe('MonthPanel', () => {
  const month = { label: 'setembro de 2026', monthName: 'setembro', accumulatedMm: 262.5, historicalAvgMm: 74.1, fromYear: 2020, toYear: 2025, until: '2026-09-30T23:00:00-03:00', source: 'Banco do projeto (Supabase)' };
  it('acumulado do mês do banco x média dos anos anteriores', () => {
    const { container } = render(<MonthPanel month={month} />);
    expect(container.textContent).toContain('Acumulado de setembro de 2026 (até qua., 30) vs. média de setembro em 2020–2025.');
    expect(container.textContent).toContain('Este mês: 262,5 mm');
    expect(container.textContent).toContain('Média histórica: 74,1 mm');
    expect(screen.getByText('O acumulado está acima da média.')).toBeTruthy();
    expect(container.textContent).not.toContain('Fonte'); // a fonte fica só no rodapé
  });
  it('sem anos anteriores: mostra só o acumulado, sem aviso nem comparação', () => {
    const { container } = render(<MonthPanel month={{ ...month, historicalAvgMm: null, fromYear: null, toYear: null }} />);
    expect(container.textContent).toContain('Este mês: 262,5 mm');
    expect(container.textContent).not.toMatch(/Média histórica|média de|indisponível/);
    expect(container.querySelector('.note').textContent).toBe('Acumulado de setembro de 2026 (até qua., 30).');
  });
});

describe('LastDays', () => {
  const days = [{ date: '2026-09-29', rainMm: 7.9, tMin: 18.2, tMax: 26.6 }, { date: '2026-09-30', rainMm: 1.4, tMin: 19, tMax: 25.1 }];
  it('lista os dias com chuva e temperaturas, sem botões', () => {
    render(<LastDays days={days} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('7,9 mm');
    expect(items[0].textContent).toContain('27° / 18°');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
  it('dia incompleto: informa quantas das 24 horas têm dados (não "20h", que parece horário)', () => {
    render(<LastDays days={[{ ...days[0], hours: 20 }]} />);
    expect(screen.getByRole('listitem').textContent).toContain('dados de 20 das 24 horas');
    expect(screen.getByRole('listitem').textContent).not.toMatch(/\(20h\)/);
  });
  it('dia sem medições: "sem medições", nunca "0 mm" nem temperaturas', () => {
    render(<LastDays days={[{ date: '2026-09-26', rainMm: null, tMin: null, tMax: null, hours: 0 }]} />);
    const dia = screen.getByRole('listitem');
    expect(dia.textContent).toContain('sem medições');
    expect(dia.textContent).not.toMatch(/mm|°/);
    expect(dia.className).toContain('vazio');
  });
  it('carregando: mostra "Carregando…", não "sem registros"', () => {
    const { container } = render(<LastDays days={undefined} loading />);
    expect(container.textContent).toBe('Carregando os últimos dias…');
  });
  it('erro da consulta: texto neutro no lugar do bloco, sem repetir o alerta (ele fica no topo do painel)', () => {
    const { container } = render(<LastDays days={[]} error="sem permissão" />);
    expect(container.textContent).toBe('Dados indisponíveis no momento.');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Indicators (resumo de um dia)', () => {
  const dia = {
    date: '2026-09-30', hours: 24, totalMm: 5.1,
    rainPeak: { mm: 3.9, t: '2026-09-30T13:00:00-03:00' },
    tempMax: { c: 26.6, t: '2026-09-30T11:00:00-03:00' }, tempMin: { c: 19.8, t: '2026-09-30T05:00:00-03:00' },
    humidityAvg: 75.6, windAvgKmh: 8.5, windMax: { kmh: 17.4, t: '2026-09-30T12:00:00-03:00' },
    climate: { pct: 27, monthLabel: 'setembro', fromYear: 2020, toYear: 2025 }, climateError: null,
  };
  const card = (nome) => screen.getByText(nome).closest('.kpi');
  it('é um grupo nomeado com a data do dia', () => {
    render(<Indicators dia={dia} />);
    expect(screen.getByRole('group', { name: 'Indicadores de 30/09/2026' })).toBeTruthy();
  });
  it('temperatura máxima, com a mínima e a umidade média no complemento', () => {
    render(<Indicators dia={dia} />);
    expect(card('Temperatura máxima').querySelector('strong').textContent).toBe('27 °C');
    expect(card('Temperatura máxima').textContent).toContain('mín. 20 °C · umidade média 76%');
  });
  it('maior chuva em 1 hora, com o horário e o total do dia', () => {
    render(<Indicators dia={dia} />);
    expect(card('Maior chuva em 1 hora').textContent).toContain('3,9 mm');
    expect(card('Maior chuva em 1 hora').textContent).toContain('às 13h · total do dia 5,1 mm');
  });
  it('maior chuva: dia sem chuva e dia sem registros de chuva', () => {
    const { rerender } = render(<Indicators dia={{ ...dia, rainPeak: { mm: 0, t: null }, totalMm: 0 }} />);
    expect(card('Maior chuva em 1 hora').textContent).toContain('0 mmsem chuva no dia');
    rerender(<Indicators dia={{ ...dia, rainPeak: null, totalMm: null }} />);
    expect(card('Maior chuva em 1 hora').textContent).toContain('sem registros de chuva no dia');
  });
  it('vento médio: descrição Beaufort e máxima do dia, sem direção ou rajada', () => {
    render(<Indicators dia={dia} />);
    expect(card('Vento médio').querySelector('strong').textContent).toBe('9 km/h');
    expect(card('Vento médio').textContent).toContain('brisa leve · máx. 17 km/h às 12h');
    expect(card('Vento médio').textContent).not.toMatch(/direção|rajada|últimas 24h/);
  });
  it('chance histórica avisa que não é previsão; um ano só aparece sem intervalo', () => {
    const { rerender } = render(<Indicators dia={dia} />);
    expect(card('Chance histórica de chuva').textContent).toContain('27%');
    expect(card('Chance histórica de chuva').textContent).toContain('dias de setembro com chuva (2020–2025) · não é previsão');
    rerender(<Indicators dia={{ ...dia, climate: { ...dia.climate, fromYear: 2024, toYear: 2024 } }} />);
    expect(card('Chance histórica de chuva').textContent).toContain('(2024)');
  });
  it('chance histórica: sem histórico e falha na consulta', () => {
    const { rerender } = render(<Indicators dia={{ ...dia, climate: null }} />);
    expect(card('Chance histórica de chuva').textContent).toContain('sem histórico deste mês nos anos anteriores');
    rerender(<Indicators dia={{ ...dia, climate: null, climateError: 'falhou' }} />);
    expect(card('Chance histórica de chuva').textContent).toContain('dados indisponíveis no momento');
  });
});
