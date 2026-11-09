import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ErroAmigavel } from '../lib/mensagensErro.js';

const T14 = '2026-09-01T14:00:00-03:00';
const T15 = '2026-09-01T15:00:00-03:00';
const WEATHER = { temperatura: 24.7, umidade: 74, pressao: 1008.9, nebulosidade: 97, pressaoAnterior: 1009.4 };
const entradas = (t) => ({ referenceTime: t, previousReferenceTime: '2026-09-01T13:00:00-03:00', forecastStart: t, forecastEnd: T15, weather: WEATHER });
const previsao = (extra = {}) => ({
  predictionId: '550e8400-e29b-41d4-a716-446655440000', requestId: 'k', createdAt: '2026-11-07T15:00:00Z', mode: 'historical',
  isMock: false, modelVersion: 'weather-v6-simple-mean-isotonic-v1', referenceTime: T14, previousReferenceTime: '2026-09-01T13:00:00-03:00',
  forecastStart: T14, forecastEnd: T15, weather: WEATHER, vaiChover: true, probabilidadePct: 72, limiarPct: 50, ...extra,
});

const api = vi.hoisted(() => ({
  buscarPeriodo: vi.fn(), buscarHorarios: vi.fn(), buscarEntradas: vi.fn(), gerarPrevisao: vi.fn(),
}));
vi.mock('../services/previsaoApi.js', () => ({
  ...api,
  corpoPrevisao: (t) => ({ mode: 'historical', reference_time: t }),
}));
const { default: PrevisaoExperimental } = await import('./PrevisaoExperimental.jsx');

// Erros como services/previsaoApi.js os entrega: texto amigável + status/code/incerto preservados.
class ErroIncerto extends ErroAmigavel { incerto = true; }

beforeEach(() => {
  sessionStorage.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.buscarPeriodo.mockResolvedValue({ minDate: '2020-01-01', maxDate: '2026-09-01', timezone: 'America/Sao_Paulo' });
  api.buscarHorarios.mockResolvedValue([T14, T15]);
  api.buscarEntradas.mockImplementation(async (t) => entradas(t));
});

const gerarBtn = () => screen.getByRole('button', { name: /Gerar (nova )?previsão/ });
async function buscarDados() {
  await screen.findByRole('option', { name: '14:00' });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar dados' }));
  await screen.findByText('Medições deste horário');
}

describe('Previsão experimental', () => {
  it('identifica a simulação histórica e usa o período do serviço no calendário', async () => {
    render(<PrevisaoExperimental />);
    expect(screen.getByText('Simulação histórica')).toBeTruthy();
    const data = await screen.findByLabelText('Data');
    expect(data.min).toBe('2020-01-01');
    expect(data.max).toBe('2026-09-01');
    expect(api.buscarHorarios).toHaveBeenCalledWith('2026-09-01', expect.anything());
  });

  it('só libera a previsão depois de uma busca válida, que mostra as 5 medidas', async () => {
    render(<PrevisaoExperimental />);
    await screen.findByRole('option', { name: '14:00' });
    expect(gerarBtn().disabled).toBe(true);
    await buscarDados();
    expect(screen.getByText('Pressão ao nível do mar (hora anterior)')).toBeTruthy();
    expect(screen.getByText('1.009,4 hPa')).toBeTruthy();
    expect(gerarBtn().disabled).toBe(false);
  });

  it('mudar a hora limpa os dados e exige nova busca', async () => {
    render(<PrevisaoExperimental />);
    await buscarDados();
    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: T15 } });
    expect(screen.queryByText('Medições deste horário')).toBeNull();
    expect(gerarBtn().disabled).toBe(true);
  });

  it('gera com chave nova, mostra o resultado do backend e avisa o histórico', async () => {
    api.gerarPrevisao.mockResolvedValue({ previsao: previsao(), criada: true });
    const salva = vi.fn();
    render(<PrevisaoExperimental onPrevisaoSalva={salva} />);
    await buscarDados();
    fireEvent.click(gerarBtn());
    const resultado = await screen.findByRole('status', { name: 'Resultado da previsão' });
    expect(within(resultado).getByText('Chuva prevista')).toBeTruthy();
    expect(resultado.textContent).toContain('72%');
    expect(resultado.textContent).toContain('weather-v6-simple-mean-isotonic-v1');
    const [corpo, chave] = api.gerarPrevisao.mock.calls[0];
    expect(corpo).toEqual({ mode: 'historical', reference_time: T14 });
    expect(chave).toMatch(/^[0-9a-f-]{36}$/);
    expect(salva).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0); // sucesso confirmado: nada pendente
  });

  it('falha de rede: não mostra previsão, guarda o pedido e "Tentar novamente" reusa a MESMA chave', async () => {
    api.gerarPrevisao.mockRejectedValueOnce(new ErroIncerto('Sem conexão com o serviço. Verifique sua internet e tente novamente.'));
    api.gerarPrevisao.mockResolvedValueOnce({ previsao: previsao(), criada: false });
    render(<PrevisaoExperimental />);
    await buscarDados();
    fireEvent.click(gerarBtn());
    await screen.findByText('Não conseguimos confirmar se a previsão foi salva.');
    expect(screen.queryByText('Sem chuva prevista')).toBeNull();
    expect(gerarBtn().disabled).toBe(true); // nova previsão só depois de resolver o pedido incerto
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText(/já tinha sido salva antes/);
    const [c1, k1] = api.gerarPrevisao.mock.calls[0];
    const [c2, k2] = api.gerarPrevisao.mock.calls[1];
    expect(k2).toBe(k1);
    expect(c2).toEqual(c1);
  });

  it('pedido incerto sobrevive ao recarregar a página', async () => {
    sessionStorage.setItem('chuva-londrina:previsao-pendente', JSON.stringify({ chave: 'abc', corpo: { mode: 'historical', reference_time: T14 } }));
    render(<PrevisaoExperimental />);
    expect(await screen.findByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Esquecer este pedido' }));
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('falha ao consultar as datas: "Tentar novamente" consulta de novo e libera o formulário', async () => {
    api.buscarPeriodo.mockRejectedValueOnce(new ErroAmigavel('Sem conexão com o serviço. Verifique sua internet e tente novamente.'));
    render(<PrevisaoExperimental />);
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível consultar as datas disponíveis. Sem conexão com o serviço.');
    fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByLabelText('Data')).toBeTruthy();
    expect(api.buscarPeriodo).toHaveBeenCalledTimes(2);
  });

  it('detalhes técnicos do resultado ficam numa seção recolhida', async () => {
    api.gerarPrevisao.mockResolvedValue({ previsao: previsao(), criada: true });
    render(<PrevisaoExperimental />);
    await buscarDados();
    fireEvent.click(gerarBtn());
    const resultado = await screen.findByRole('status', { name: 'Resultado da previsão' });
    const detalhes = resultado.querySelector('details');
    expect(detalhes.open).toBe(false);
    expect(detalhes.querySelector('summary').textContent).toBe('Detalhes técnicos');
    expect(detalhes.textContent).toContain('weather-v6-simple-mean-isotonic-v1');
    expect(detalhes.textContent).toContain('Limiar de decisão');
    // fora da seção recolhida: só o que o usuário precisa
    expect(resultado.textContent.replace(detalhes.textContent, '')).not.toMatch(/weather-v6|Limiar|ID da previsão/);
  });

  it('erro definitivo (422) aparece como erro, nunca como "sem chuva"', async () => {
    api.gerarPrevisao.mockRejectedValue(new ErroAmigavel('Faltam medições da hora anterior a este horário. Escolha outro horário.', { status: 422, code: 'MISSING_PREVIOUS_HOUR' }));
    render(<PrevisaoExperimental />);
    await buscarDados();
    fireEvent.click(gerarBtn());
    await screen.findByText(/Não foi possível gerar a previsão. Faltam medições da hora anterior/);
    expect(screen.queryByText(/chuva prevista/i)).toBeNull();
    await waitFor(() => expect(sessionStorage.length).toBe(0));
  });
});
