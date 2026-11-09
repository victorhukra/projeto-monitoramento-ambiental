import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErroAmigavel } from '../lib/mensagensErro.js';

const api = vi.hoisted(() => ({ listarPrevisoes: vi.fn() }));
vi.mock('../services/previsaoApi.js', () => api);
const { default: HistoricoBusca } = await import('./HistoricoBusca.jsx');

beforeEach(() => api.listarPrevisoes.mockReset());

describe('Histórico de previsões', () => {
  it('validação das datas: mensagem certa para campo vazio e para ordem invertida, ligada aos campos', async () => {
    api.listarPrevisoes.mockResolvedValue({ itens: [], proximoCursor: null });
    render(<HistoricoBusca />);
    await screen.findByText(/Nenhuma previsão gerada/);
    const de = screen.getByLabelText('Geradas de');
    const ate = screen.getByLabelText('até');

    fireEvent.change(de, { target: { value: '' } });
    expect(screen.getByText('Preencha as duas datas.')).toBeTruthy();
    expect(de.getAttribute('aria-invalid')).toBe('true');
    expect(de.getAttribute('aria-describedby')).toBe('hist-erro');

    fireEvent.change(de, { target: { value: '2026-11-09' } });
    fireEvent.change(ate, { target: { value: '2026-11-01' } });
    expect(screen.getByText('A data inicial não pode ser depois da data final.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Consultar' }).disabled).toBe(true);

    fireEvent.change(ate, { target: { value: '2026-11-09' } });
    expect(screen.queryByText(/Preencha|não pode ser depois/)).toBeNull();
    expect(de.getAttribute('aria-invalid')).toBe('false');
  });

  it('falha na consulta: aviso amigável e "Tentar novamente" refaz a consulta', async () => {
    api.listarPrevisoes.mockRejectedValueOnce(new ErroAmigavel('O histórico está indisponível no momento. Tente novamente em alguns minutos.'));
    api.listarPrevisoes.mockResolvedValueOnce({ itens: [], proximoCursor: null });
    render(<HistoricoBusca />);
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível consultar o histórico. O histórico está indisponível no momento.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText(/Nenhuma previsão gerada/)).toBeTruthy();
    expect(api.listarPrevisoes).toHaveBeenCalledTimes(2);
  });

  it('tabela mostra só o que interessa ao usuário, sem versão do modelo nem ID da previsão', async () => {
    api.listarPrevisoes.mockResolvedValue({
      itens: [{
        predictionId: 'abcdef12-3456-7890-abcd-ef1234567890', requestId: 'r1', createdAt: '2026-11-07T15:00:00Z',
        referenceTime: '2026-09-01T14:00:00-03:00', forecastStart: '2026-09-01T14:00:00-03:00', forecastEnd: '2026-09-01T15:00:00-03:00',
        vaiChover: true, probabilidadePct: 72, isMock: false, modelVersion: 'weather-v6-simple-mean-isotonic-v1',
      }],
      proximoCursor: null,
    });
    render(<HistoricoBusca />);
    const tabela = await screen.findByRole('table');
    const colunas = [...tabela.querySelectorAll('th')].map((th) => th.textContent);
    expect(colunas).toEqual(['Gerada em', 'Horário simulado', 'Período previsto', 'Resultado', 'Probabilidade estimada']);
    expect(tabela.textContent).not.toMatch(/weather-v6|abcdef12/);
  });
});
