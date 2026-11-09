import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErroAmigavel } from '../lib/mensagensErro.js';

const api = vi.hoisted(() => ({ getDataPeriod: vi.fn(), getDayReport: vi.fn() }));
vi.mock('../services/weatherApi.js', () => api);
const { default: DiaPorData } = await import('./DiaPorData.jsx');

const relatorio = (date) => ({
  date, hours: 24, totalMm: 0, rainPeak: { mm: 0, t: null }, tempMax: null, tempMin: null,
  humidityAvg: null, windAvgKmh: null, windMax: null, climate: null, climateError: null,
  hourly: [{ t: `${date}T00:00:00-03:00`, mm: 0, tempC: 20 }, { t: `${date}T01:00:00-03:00`, mm: 0, tempC: 21 }],
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getDataPeriod.mockResolvedValue({ minDate: '2024-01-01', maxDate: '2026-09-30' });
  api.getDayReport.mockImplementation(async (date) => relatorio(date));
});

describe('Resumo do dia: nova tentativa', () => {
  it('o "Tentar novamente" do topo refaz o dia escolhido, sem voltar ao mais recente', async () => {
    const { rerender } = render(<DiaPorData atualizacao={0} />);
    await screen.findByRole('group', { name: 'Indicadores de 30/09/2026' });
    fireEvent.change(screen.getByLabelText('Ver o dia'), { target: { value: '2025-05-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar dia' }));
    await screen.findByRole('group', { name: 'Indicadores de 01/05/2025' });

    rerender(<DiaPorData atualizacao={1} />);
    await waitFor(() => expect(api.getDataPeriod).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getDayReport).toHaveBeenLastCalledWith('2025-05-01', expect.anything()));
    expect(await screen.findByRole('group', { name: 'Indicadores de 01/05/2025' })).toBeTruthy();
    expect(screen.getByLabelText('Ver o dia').value).toBe('2025-05-01');
  });

  it('com aviso no topo, a falha aparece só como texto neutro; sem ele, com aviso e botão próprios', async () => {
    api.getDayReport.mockRejectedValue(new ErroAmigavel('O serviço está temporariamente indisponível.'));
    const { rerender } = render(<DiaPorData avisoNoTopo />);
    expect(await screen.findByText('Dados indisponíveis no momento.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<DiaPorData avisoNoTopo={false} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar os dados deste dia.');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });
});
