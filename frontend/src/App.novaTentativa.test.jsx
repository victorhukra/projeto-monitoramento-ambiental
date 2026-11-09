import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// Arquivo próprio: o cache de 5 minutos de weatherApi.js vive no módulo, então este teste precisa de um módulo novo.
// controle.fora = true simula o banco fora do ar (todas as consultas falham como forecastRepo.js falharia).
const controle = vi.hoisted(() => ({ fora: true, consultas: 0 }));

vi.mock('./lib/supabase.js', () => ({ supabase: {} }));
vi.mock('./services/forecastRepo.js', async () => {
  const fx = await import('./test/dbFixture.js');
  const { ErroAmigavel, MSG } = await import('./lib/mensagensErro.js');
  const consulta = (valor) => async () => {
    if (controle.fora) throw new ErroAmigavel(MSG.conexao);
    return valor;
  };
  return {
    getCurrent: async () => { controle.consultas += 1; return consulta(fx.current)(); },
    getLastDays: consulta(fx.lastDays), getStation: consulta(fx.station),
    getMonthHours: async (_s, y, m) => consulta(fx.monthHours(y, m))(),
    getMonthDetail: async (_s, y, m) => consulta(fx.monthHours(y, m))(),
    getTimeBounds: consulta({ first: '2024-09-01T00:00:00', last: '2026-09-30T23:00:00' }),
    getDaysEnding: consulta([]), getDayHours: consulta([]),
    getDayDetail: async () => consulta([...fx.last24].reverse())(),
    getMonthsWithData: consulta([9]), getYearsWithData: consulta([2025, 2026]),
  };
});
const { default: App } = await import('./App.jsx');

let log;
beforeEach(() => { log = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => log.mockRestore());

describe('Painel: falha e nova tentativa', () => {
  it('banco fora do ar: um único aviso com "Tentar novamente", que refaz a consulta e mostra os dados', async () => {
    render(<App />);
    const avisoPainel = await screen.findByText(/^Não foi possível carregar os dados\. Sem conexão com o serviço/);
    const alerta = avisoPainel.closest('[role="alert"]');
    // as seções (resumo do dia, semana, mês e comparação) não repetem o alerta: mostram só um texto neutro
    await waitFor(() => expect(screen.getAllByText('Dados indisponíveis no momento.').length).toBeGreaterThan(3));
    expect(screen.getAllByRole('alert')).toEqual([alerta]); // um único aviso na página inteira
    expect(screen.getAllByRole('button', { name: 'Tentar novamente' })).toHaveLength(1);
    // nenhuma mensagem técnica na área principal (o rodapé mantém o crédito da fonte dos dados)
    expect(screen.getByRole('main').textContent).not.toMatch(/fetch|supabase|VITE_|banco/i);

    const antes = controle.consultas;
    controle.fora = false;
    fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText(/Dados atualizados até qua\., 30 de set\., 23:00/)).toBeTruthy();
    expect(controle.consultas).toBe(antes + 1); // a nova tentativa consultou o banco de novo (sem cache)
    await waitFor(() => expect(screen.queryByText(/^Não foi possível carregar os dados\./)).toBeNull());
    // o mesmo botão refaz as seções: resumo do dia, semana, mês e comparação voltam sem nenhum aviso
    expect(await screen.findByRole('group', { name: 'Indicadores de 30/09/2026' })).toBeTruthy();
    expect(await screen.findByLabelText('Ver 7 dias até')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Comparar' }).disabled).toBe(false));
    await waitFor(() => expect(screen.queryByText('Dados indisponíveis no momento.')).toBeNull());
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
