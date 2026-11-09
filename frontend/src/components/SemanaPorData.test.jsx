import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../services/weatherApi.js', () => ({
  getDataPeriod: async () => ({ minDate: '2024-06-01', maxDate: '2026-09-30' }),
  getWeekEnding: async () => [],
}));
const { default: SemanaPorData } = await import('./SemanaPorData.jsx');

// Como getForecast entrega a visão padrão: 7 dias do calendário, com dia sem medições e dia parcial.
const RECENTES = [
  { date: '2026-09-24', rainMm: 1, tMin: 18, tMax: 25, hours: 24 },
  { date: '2026-09-25', rainMm: 0, tMin: 18, tMax: 25, hours: 24 },
  { date: '2026-09-26', rainMm: null, tMin: null, tMax: null, hours: 0 },
  { date: '2026-09-27', rainMm: 0, tMin: 19, tMax: 25, hours: 12 },
  { date: '2026-09-28', rainMm: 2, tMin: 18, tMax: 25, hours: 24 },
  { date: '2026-09-29', rainMm: 0, tMin: 18, tMax: 25, hours: 24 },
  { date: '2026-09-30', rainMm: 0, tMin: 18, tMax: 25, hours: 24 },
];

describe('Últimos 7 dias (visão padrão)', () => {
  it('subtítulo corresponde aos cartões; dia sem medições e dia parcial sinalizados', async () => {
    render(<SemanaPorData recentes={RECENTES} />);
    const dias = screen.getAllByRole('listitem');
    expect(dias).toHaveLength(7);
    expect(dias[0].textContent).toMatch(/24/);
    expect(dias[6].textContent).toMatch(/30/);
    expect(screen.getByText(/registros observados de 24\/09\/2026 a 30\/09\/2026/)).toBeTruthy();
    expect(dias[2].textContent).toMatch(/sáb\., 26\s*sem medições/);
    expect(dias[2].textContent).not.toContain('mm');
    expect(dias[3].textContent).toContain('dados de 12 das 24 horas');
    expect(dias[4].textContent).not.toContain('das 24 horas');
    await screen.findByLabelText('Ver 7 dias até'); // termina o carregamento do período antes de encerrar o teste
  });
});
