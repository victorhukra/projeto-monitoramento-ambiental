import { StrictMode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as db from './test/dbFixture.js';

// A página só mostra dados do banco: nos testes, o "banco" são as respostas de dbFixture.js.
vi.mock('./lib/supabase.js', () => ({ supabase: {} }));
vi.mock('./services/forecastRepo.js', async () => {
  const fx = await import('./test/dbFixture.js');
  return {
    getCurrent: async () => fx.current, getLastDays: async () => fx.lastDays,
    getStation: async () => fx.station, getMonthHours: async (_s, y, m) => fx.monthHours(y, m),
    getMonthDetail: async (_s, y, m) => fx.monthHours(y, m).map((r, i) => ({ ...r, temperatura_c: 15 + (i % 10), umidade_pct: 70, nuvens_pct: 50 })),
    getTimeBounds: async () => ({ first: '2024-09-01T00:00:00', last: '2026-09-30T23:00:00' }),
    // mesmo filtro da consulta real: [fim−6 dias, fim+1 dia), a partir dos setembros do fixture
    getDaysEnding: async (_s, end) => [2024, 2025, 2026].flatMap((y) => fx.monthHours(y, 9))
      .filter((r) => {
        const d = r.horario.slice(0, 10), shift = (n) => new Date(Date.parse(`${end}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
        return d >= shift(-6) && d <= end;
      })
      .map((r) => ({ ...r, temperatura_c: 20 })),
    getDayHours: async (_s, y, m, d) => fx.monthHours(y, m).filter((row) => Number(row.horario.slice(8, 10)) === d),
    // resumo do dia: 30/09/2026 usa os 24 registros da 1.2 (chuva 3,9 mm às 13h); os outros dias, os setembros do fixture
    getDayDetail: async (_s, date) => (date === '2026-09-30'
      ? [...fx.last24].reverse().map((r) => ({ ...r, umidade_pct: 76 }))
      : fx.monthHours(Number(date.slice(0, 4)), Number(date.slice(5, 7)))
        .filter((r) => r.horario.startsWith(date))
        .map((r) => ({ ...r, temperatura_c: 20, umidade_pct: 70, vento_ms: 2 }))),
    getMonthsWithData: async (_s, y) => Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => fx.monthHours(y, m).length),
    getYearsWithData: async (_s, first, last) => Array.from({ length: last - first + 1 }, (_, i) => first + i)
      .filter((y) => Array.from({ length: 12 }, (_, i) => i + 1).some((m) => fx.monthHours(y, m).length)),
  };
});
const { default: App } = await import('./App.jsx');

const ready = () => screen.findByText(/Dados atualizados até qua\., 30 de set\., 23:00/);

describe('App (dados do banco)', () => {
  it('carrega sob StrictMode e encerra o "atualizando…"', async () => {
    render(<StrictMode><App /></StrictMode>);
    await ready();
    await waitFor(() => expect(screen.queryByText(/atualizando/)).toBeNull());
    expect(await screen.findByRole('group', { name: 'Indicadores de 30/09/2026' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Chuva por hora (mm)' })).toBeTruthy();
    expect(screen.queryByText(/últimas 24h/)).toBeNull();
  });
  it('durante a primeira carga mostra "Carregando…", nunca "sem registros" ou "indisponível"', async () => {
    const { container } = render(<App />);
    expect(screen.getByText('Carregando indicadores…')).toBeTruthy();
    expect(screen.getByText('Carregando os últimos dias…')).toBeTruthy();
    expect(screen.getAllByText('Carregando gráfico…')).toHaveLength(2);
    expect(container.textContent).not.toMatch(/Sem registros|sem medições|indisponíve/);
    await ready();
    await waitFor(() => expect(screen.queryByText('Carregando indicadores…')).toBeNull());
    expect(screen.queryByText('Carregando gráfico…')).toBeNull();
  });
  it('mapa ocupa a seção sozinho (sem o card de chuva acumulada nem "Clima atual")', async () => {
    render(<App />);
    await ready();
    expect(document.querySelector('#mapa').querySelectorAll(':scope > .card')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Chuva acumulada nas últimas 24h' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Clima atual' })).toBeNull();
    expect(screen.queryByText(/Alerta/)).toBeNull();
  });
  it('resumo do dia: abre no dia mais recente do banco, com calendário limitado ao período', async () => {
    render(<App />);
    await ready();
    const kpi = (await screen.findByText('Maior chuva em 1 hora')).closest('.kpi');
    expect(kpi.closest('#agora')).toBeTruthy();
    expect(kpi.textContent).toContain('3,9 mm');
    expect(kpi.textContent).toContain('às 13h · total do dia 5,1 mm'); // 3,9 + 0,7 + 0,5 no fixture
    const data = screen.getByLabelText('Ver o dia');
    expect(data.value).toBe('2026-09-30');
    expect(data.min).toBe('2024-09-01');
    expect(data.max).toBe('2026-09-30');
    expect(screen.queryByRole('button', { name: 'Dia mais recente' })).toBeNull();
  });
  it('resumo do dia: escolher uma data mostra os cards e gráficos daquele dia', async () => {
    render(<App />);
    await ready();
    const data = await screen.findByLabelText('Ver o dia');
    await screen.findByRole('group', { name: 'Indicadores de 30/09/2026' });
    fireEvent.change(data, { target: { value: '2025-09-03' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar dia' }));
    const grupo = await screen.findByRole('group', { name: 'Indicadores de 03/09/2025' });
    expect(within(grupo).getByText('Maior chuva em 1 hora').closest('.kpi').textContent).toContain('2 mm'); // 2 mm às 10h no fixture
    // chance histórica: só setembro de 2024 é anterior a 2025 no fixture (3 de 30 dias com chuva)
    expect(within(grupo).getByText('Chance histórica de chuva').closest('.kpi').textContent).toContain('10%dias de setembro com chuva (2024)');
    expect(within(grupo).getByText('Vento médio').closest('.kpi').textContent).toContain('7 km/h'); // 2 m/s
    expect(screen.getByRole('img', { name: 'Chuva registrada em 03/09/2025, por hora, em milímetros' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dia mais recente' }));
    expect(await screen.findByRole('group', { name: 'Indicadores de 30/09/2026' })).toBeTruthy();
    expect(screen.getByLabelText('Ver o dia').value).toBe('2026-09-30');
  });
  it('resumo do dia: dia dentro do período mas sem registros avisa, sem inventar valores', async () => {
    render(<App />);
    await ready();
    const data = await screen.findByLabelText('Ver o dia');
    await screen.findByRole('group', { name: 'Indicadores de 30/09/2026' });
    fireEvent.change(data, { target: { value: '2025-01-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar dia' }));
    expect(await screen.findByText('Não há registros em 15/01/2025. Escolha outra data.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: /^Indicadores/ })).toBeNull();
  });
  it('resumo do dia: data fora do período bloqueia a busca', async () => {
    render(<App />);
    await ready();
    const data = await screen.findByLabelText('Ver o dia');
    fireEvent.change(data, { target: { value: '2027-01-01' } });
    expect(screen.getByText('Escolha uma data entre 01/09/2024 e 30/09/2026.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mostrar dia' }).disabled).toBe(true);
  });
  it('nenhum bloco de demonstração', async () => {
    const { container } = render(<App />);
    await ready();
    expect(container.textContent).not.toMatch(/demonstração/i);
  });
  it('mapa de Londrina no topo, com o ponto de medição', async () => {
    render(<App />);
    await ready();
    expect(screen.getByRole('heading', { name: 'Mapa de Londrina' })).toBeTruthy();
    // o mapa carrega à parte (lazy): espera o elemento do mapa, não a seção
    expect(await screen.findByRole('region', { name: /limite do município/ })).toBeTruthy();
    expect(await screen.findByText(/Ponto de medição dos dados/)).toBeTruthy();
  });
  it('últimos 7 dias observados', async () => {
    render(<App />);
    await ready();
    expect(screen.getByRole('heading', { name: /^Últimos 7 dias/ })).toBeTruthy();
    expect(screen.getByRole('list', { name: /últimos 7 dias/ }).querySelectorAll('li')).toHaveLength(7);
  });
  it('últimos 7 dias: calendário limitado ao período do banco', async () => {
    render(<App />);
    await ready();
    const data = await screen.findByLabelText('Ver 7 dias até');
    expect(data.min).toBe('2024-09-01');
    expect(data.max).toBe('2026-09-30');
  });
  it('últimos 7 dias: escolher uma data mostra os 7 dias que terminam nela', async () => {
    render(<App />);
    await ready();
    const data = await screen.findByLabelText('Ver 7 dias até');
    fireEvent.change(data, { target: { value: '2025-09-07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar semana' }));
    const lista = await screen.findByRole('list', { name: /últimos 7 dias/ });
    await waitFor(() => expect(lista.textContent).toContain('2 mm')); // chove 2 mm nos dias 1 a 6 de set./2025 no fixture
    const dias = screen.getByRole('list', { name: /últimos 7 dias/ }).querySelectorAll('li');
    expect(dias).toHaveLength(7);
    expect(dias[0].textContent).toMatch(/01/);
    expect(dias[6].textContent).toMatch(/07/);
    expect(dias[6].textContent).toContain('0 mm');
    expect(screen.getByRole('heading', { name: /^7 dias até/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mais recentes' }));
    expect(screen.getByRole('heading', { name: 'Últimos 7 dias' })).toBeTruthy();
  });
  it('histórico do mês: escolher outro mês mostra o acumulado e os 10 dias mais chuvosos', async () => {
    render(<App />);
    await ready();
    expect(await screen.findByRole('heading', { name: 'Dias mais chuvosos de setembro de 2026' })).toBeTruthy();
    const form = within(screen.getByRole('form', { name: 'Escolher mês do histórico' }));
    fireEvent.change(form.getByLabelText('Ano'), { target: { value: '2025' } });
    fireEvent.change(form.getByLabelText('Mês'), { target: { value: '9' } });
    fireEvent.click(form.getByRole('button', { name: 'Mostrar mês' }));
    expect(await screen.findByText('Acumulado em setembro de 2025: 12 mm')).toBeTruthy(); // 6 dias × 2 mm no fixture
    const tabela = screen.getByRole('heading', { name: 'Dias mais chuvosos de setembro de 2025' }).closest('section');
    const linhas = tabela.querySelectorAll('tbody tr');
    expect(linhas).toHaveLength(10);
    expect(linhas[0].textContent).toContain('2 mm');
    expect(linhas[0].textContent).toContain('17%'); // 2 de 12 mm
    expect(linhas[6].textContent).toContain('0 mm'); // só 6 dias choveram
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos os 30 dias' }));
    expect(tabela.querySelectorAll('tbody tr')).toHaveLength(30);
  });
  it('fonte só no rodapé, com o dia e o horário do último dado recebido', async () => {
    render(<App />);
    await ready();
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toContain('Fonte dos dados: Banco do projeto (Supabase) · Londrina');
    expect(footer.textContent).toContain('Último dado recebido: 30/09/2026 às 23:00');
    expect(footer.textContent).toContain('Limite municipal: IBGE (malha municipal 2022)');
    expect(footer.textContent).toContain('Mapa: © OpenStreetMap');
    const main = screen.getByRole('main');
    expect(main.textContent).not.toMatch(/Fonte/);
    expect(main.querySelector('.meta').textContent).toContain('Dados atualizados até qua., 30 de set., 23:00');
  });
  it('comparar dois dias: campos na ordem Ano → Mês → Dia e diferença em frase', async () => {
    render(<App />);
    await ready();
    const secao = within(screen.getByRole('heading', { name: 'Comparar dois dias' }).closest('section'));
    const rotulos = [...secao.getAllByRole('combobox')].slice(0, 3).map((c) => c.labels[0].textContent);
    expect(rotulos).toEqual(['Ano', 'Mês', 'Dia']);
    const botao = secao.getByRole('button', { name: 'Comparar' });
    await waitFor(() => expect(botao.disabled).toBe(false));
    fireEvent.click(botao);
    // padrão: 30/09/2025 (sem chuva no fixture) x 30/09/2026 (2 mm); o fixture não tem temperatura nesses meses
    expect(await secao.findByText(/No dia 2 choveu 2 mm a mais que no dia 1\./)).toBeTruthy();
    expect(secao.getByText(/Sem dados suficientes para comparar a temperatura\./)).toBeTruthy();
    expect(secao.getByRole('heading', { name: 'Dia 1: 30 de setembro de 2025' })).toBeTruthy();
  });
  it('não mostra nada de regiões', async () => {
    const { container } = render(<App />);
    await ready();
    expect(container.textContent).not.toMatch(/regi[ãa]o|regiões/i);
  });
  it('usa os dados do fixture (prova de que nada vem de outro lugar)', async () => {
    render(<App />);
    await ready();
    expect(await screen.findByText('Este mês: 6 mm')).toBeTruthy(); // 3 dias × 2 mm em setembro/2026 no fixture
    expect(db.current.cidade).toBe('Londrina');
  });
});
