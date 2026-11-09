import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ErroAmigavel, MSG } from '../lib/mensagensErro.js';

const repo = vi.hoisted(() => ({ getYearsWithData: vi.fn(), getMonthsWithData: vi.fn(), getMonthHours: vi.fn(), getDayHours: vi.fn() }));
vi.mock('../services/forecastRepo.js', () => repo);
const { default: PeriodComparison } = await import('./PeriodComparison.jsx');

const SETEMBRO = Array.from({ length: 30 }, (_, i) => ({ horario: `2026-09-${String(i + 1).padStart(2, '0')}T10:00:00`, chuva_mm: 0, temperatura_c: 20 }));
// Textos visíveis dos selects (Dia 1): o primeiro option de cada campo de Ano, Mês e Dia.
const campos = () => ['Ano', 'Mês', 'Dia'].map((rotulo) => screen.getAllByLabelText(rotulo)[0]);
const textos = (select) => [...select.options].map((o) => o.textContent);

let log;
beforeEach(() => {
  Object.values(repo).forEach((f) => f.mockReset());
  repo.getMonthsWithData.mockResolvedValue([9]);
  repo.getMonthHours.mockResolvedValue(SETEMBRO);
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => log.mockRestore());

describe('Comparar dois dias: carregando, sem dados e falha são estados diferentes', () => {
  it('carregando: "Buscando anos…"', () => {
    repo.getYearsWithData.mockReturnValue(new Promise(() => {}));
    render(<PeriodComparison latestDate="2026-09-30T23:00:00-03:00" />);
    const [ano, mes, dia] = campos();
    expect(textos(ano)).toEqual(['Buscando anos…']);
    expect(textos(mes)).toEqual(['Buscando meses…']);
    expect(textos(dia)).toEqual(['Buscando datas…']);
  });

  it('consulta feita e sem dados: "Sem anos com dados"', async () => {
    repo.getYearsWithData.mockResolvedValue([]);
    repo.getMonthsWithData.mockResolvedValue([]);
    render(<PeriodComparison latestDate="2026-09-30T23:00:00-03:00" />);
    await waitFor(() => expect(textos(campos()[0])).toEqual(['Sem anos com dados']));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha na consulta de anos: "Indisponível" (nunca "Sem anos com dados"), cadeia interrompida e nova tentativa', async () => {
    repo.getYearsWithData.mockRejectedValueOnce(new ErroAmigavel(MSG.conexao));
    render(<PeriodComparison latestDate="2026-09-30T23:00:00-03:00" />);
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível consultar as datas disponíveis. Sem conexão com o serviço.');
    const [ano, mes, dia] = campos();
    expect(textos(ano)).toEqual(['Indisponível']);
    expect(textos(mes)).toEqual(['Indisponível']); // não fica "Buscando meses…" para sempre
    expect(textos(dia)).toEqual(['Indisponível']);
    expect(document.body.textContent).not.toMatch(/Sem anos com dados|Buscando/);
    expect(repo.getMonthsWithData).not.toHaveBeenCalled(); // meses e dias não são consultados depois da falha
    expect(screen.getByRole('button', { name: 'Comparar' }).disabled).toBe(true);

    repo.getYearsWithData.mockResolvedValueOnce([2025, 2026]);
    fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(textos(campos()[0])).toEqual(['2025', '2026']));
    await waitFor(() => expect(textos(campos()[1])).toEqual(['Setembro']));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Comparar' }).disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha na consulta de meses: ano continua disponível; mês e dia "Indisponível"; trocar o ano tenta de novo', async () => {
    repo.getYearsWithData.mockResolvedValue([2025, 2026]);
    repo.getMonthsWithData.mockRejectedValueOnce(new ErroAmigavel(MSG.dadosIndisponiveis));
    render(<PeriodComparison latestDate="2026-09-30T23:00:00-03:00" />);
    await screen.findByRole('alert');
    const [ano, mes, dia] = campos();
    expect(textos(ano)).toEqual(['2025', '2026']);
    expect(ano.disabled).toBe(false);
    expect(textos(mes)).toEqual(['Indisponível']);
    expect(textos(dia)).toEqual(['Indisponível']);
    expect(repo.getMonthHours).not.toHaveBeenCalled();

    fireEvent.change(ano, { target: { value: '2025' } }); // comportamento existente: trocar o ano recarrega os meses
    await waitFor(() => expect(textos(campos()[1])).toEqual(['Setembro']));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Comparar dois dias: gráficos', () => {
  it('mesmo padrão dos gráficos por hora: SVG com eixo, valor acima da barra e rótulo curto do dia', async () => {
    repo.getYearsWithData.mockResolvedValue([2025, 2026]);
    // dia 1 (2025): 6,5 mm e 18 °C; dia 2 (2026): 2 mm e 24 °C
    repo.getDayHours.mockImplementation(async (_s, year) => (year === 2025
      ? [{ horario: '2025-09-30T10:00:00', chuva_mm: 6.5, temperatura_c: 18 }]
      : [{ horario: '2026-09-30T10:00:00', chuva_mm: 2, temperatura_c: 24 }]));
    render(<PeriodComparison latestDate="2026-09-30T23:00:00-03:00" />);
    const botao = screen.getByRole('button', { name: 'Comparar' });
    await waitFor(() => expect(botao.disabled).toBe(false));
    fireEvent.click(botao);

    const chuva = await screen.findByRole('img', { name: 'Chuva acumulada: Dia 1 · 30/09/2025, 6,5 mm; Dia 2 · 30/09/2026, 2 mm' });
    expect(chuva.tagName.toLowerCase()).toBe('svg');
    expect(chuva.querySelectorAll('rect')).toHaveLength(2);
    expect(chuva.textContent).toContain('6,5 mm');
    expect(chuva.textContent).toContain('Dia 1 · 30/09/2025');
    expect(screen.getByRole('heading', { name: 'Chuva acumulada (mm)' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Temperatura média: .*18 °C.*24 °C$/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Temperatura média (°C)' })).toBeTruthy();
  });

  it('dia sem dados: sem barra e com "sem dados" no lugar do valor', async () => {
    repo.getYearsWithData.mockResolvedValue([2025, 2026]);
    repo.getDayHours.mockImplementation(async (_s, year) => (year === 2025 ? [] : [{ horario: '2026-09-30T10:00:00', chuva_mm: 2, temperatura_c: 24 }]));
    render(<PeriodComparison latestDate="2026-09-30T23:00:00-03:00" />);
    const botao = screen.getByRole('button', { name: 'Comparar' });
    await waitFor(() => expect(botao.disabled).toBe(false));
    fireEvent.click(botao);
    const chuva = await screen.findByRole('img', { name: /^Chuva acumulada:/ });
    expect(chuva.querySelectorAll('rect')).toHaveLength(1);
    expect(chuva.textContent).toContain('sem dados');
  });
});
