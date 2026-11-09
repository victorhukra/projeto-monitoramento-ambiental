import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Indicators, Rain24h, LastDays, MonthPanel } from './Panels.jsx';

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
  it('erro da consulta aparece no lugar do bloco', () => {
    render(<LastDays days={[]} error="sem permissão" />);
    expect(screen.getByRole('alert').textContent).toContain('sem permissão');
  });
});

describe('Indicators', () => {
  const city = { rainMm: 0, windKmh: 8.5, windMaxKmh: 17.4, windMaxAt: '2026-09-30T12:00:00-03:00' };
  const climate = { pct: 27, monthLabel: 'setembro', fromYear: 2020, toYear: 2025 };
  it('é um grupo nomeado', () => {
    render(<Indicators city={{ rainMm: 1 }} at="2026-09-30T23:00:00-03:00" />);
    expect(screen.getByRole('group', { name: /^Indicadores do registro de/ })).toBeTruthy();
  });
  it('vento: descrição Beaufort e máxima das 24 h, sem demonstração', () => {
    render(<Indicators city={city} climate={climate} />);
    const vento = screen.getByText('Vento').closest('.kpi');
    expect(vento.textContent).toContain('brisa leve · máx. 17 km/h às 12h (últimas 24h)');
    expect(vento.textContent).not.toMatch(/demonstração/);
    expect(vento.textContent).not.toMatch(/direção|rajada/);
  });
  it('maior chuva das últimas 24 h no lugar de "Chuva no último registro"', () => {
    render(<Indicators city={city} climate={climate} rainPeak={{ mm: 3.9, t: '2026-09-30T13:00:00-03:00' }} />);
    const card = screen.getByText('Maior chuva nas últimas 24h').closest('.kpi');
    expect(card.textContent).toContain('3,9 mm');
    expect(card.textContent).toContain('em 1 hora, às 13h de qua., 30');
    expect(screen.queryByText('Chuva no último registro')).toBeNull();
  });
  it('maior chuva: sem chuva nas 24 h e erro da consulta', () => {
    const { rerender } = render(<Indicators city={city} climate={climate} rainPeak={{ mm: 0, t: null }} />);
    expect(screen.getByText('Maior chuva nas últimas 24h').closest('.kpi').textContent).toContain('sem chuva nas últimas 24 horas');
    rerender(<Indicators city={city} climate={climate} rainPeak={null} peakError="sem permissão" />);
    expect(screen.getByText('Maior chuva nas últimas 24h').closest('.kpi').textContent).toContain('não foi possível ler o banco');
  });
  it('chance histórica no lugar da probabilidade, avisando que não é previsão', () => {
    render(<Indicators city={city} climate={climate} />);
    const card = screen.getByText('Chance histórica de chuva').closest('.kpi');
    expect(card.textContent).toContain('27%');
    expect(card.textContent).toContain('dias de setembro com chuva (2020–2025) · não é previsão');
    expect(card.textContent).not.toMatch(/demonstração/);
    expect(screen.queryByText('Probabilidade')).toBeNull();
  });
});

describe('Rain24h', () => {
  const rain = { mm: 6.5, from: '2026-09-30T00:00:00-03:00', to: '2026-09-30T23:00:00-03:00' };
  it('soma da chuva nas últimas 24h, com o período dos registros', () => {
    const { container } = render(<Rain24h rain={rain} />);
    expect(screen.getByRole('heading', { name: 'Chuva acumulada nas últimas 24h' })).toBeTruthy();
    expect(container.querySelector('strong').textContent).toBe('6,5 mm');
    expect(container.textContent).toContain('das 00h às 23h de qua., 30');
  });
  it('período que atravessa a meia-noite mostra os dois dias', () => {
    const { container } = render(<Rain24h rain={{ mm: 1, from: '2026-09-29T14:00:00-03:00', to: '2026-09-30T13:00:00-03:00' }} />);
    expect(container.textContent).toContain('das 14h de ter., 29 às 13h de qua., 30');
  });
  it('sem chuva no período', () => {
    const { container } = render(<Rain24h rain={{ ...rain, mm: 0 }} />);
    expect(container.querySelector('strong').textContent).toBe('0 mm');
    expect(container.textContent).toContain('sem chuva no período');
  });
  it('erro da consulta aparece no lugar do valor', () => {
    render(<Rain24h rain={null} error="sem permissão" />);
    expect(screen.getByRole('alert').textContent).toContain('sem permissão');
  });
});
