import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exemplos do contrato v6 (fictícios), como o backend responde.
const ENTRADAS = {
  location: 'Londrina-PR', mode: 'historical',
  reference_time: '2026-09-01T14:00:00-03:00', previous_reference_time: '2026-09-01T13:00:00-03:00',
  forecast_start: '2026-09-01T14:00:00-03:00', forecast_end: '2026-09-01T15:00:00-03:00',
  weather: { temperature_2m: 24.7, relative_humidity_2m: 74, pressure_msl: 1008.9, cloud_cover: 97, pressure_msl_previous_hour: 1009.4 },
};
// Como o backend Flask devolve: linha salva em resultados_previsoes_ia, com as medidas no nível de cima.
const PREVISAO = {
  ...Object.fromEntries(Object.entries(ENTRADAS).filter(([k]) => k !== 'weather')), ...ENTRADAS.weather, input_source: 'dataset', prediction_id: '550e8400-e29b-41d4-a716-446655440000', request_id: '7d55d4c2-9ec1-4a8e-8a15-9ef091a4a408',
  created_at: '2026-11-07T15:00:00Z', is_mock: false, model_version: 'weather-v6-simple-mean-isotonic-v1',
  horizon_hours: 1, rain_probability: 0.72, rain_predicted: true, decision_threshold: 0.5,
};

const resposta = (status, corpo) => Promise.resolve(new Response(corpo == null ? '' : JSON.stringify(corpo), { status }));

let api, fetchMock;
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', 'http://api.test/');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  api = await import('./previsaoApi.js');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('previsaoApi (contrato v6)', () => {
  it('período disponível', async () => {
    fetchMock.mockReturnValue(resposta(200, { min_date: '2020-01-01', max_date: '2026-09-30', timezone: 'America/Sao_Paulo' }));
    expect(await api.buscarPeriodo()).toEqual({ minDate: '2020-01-01', maxDate: '2026-09-30', timezone: 'America/Sao_Paulo' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/available-times');
  });

  it('horários do dia: data na query; dia sem horários é lista vazia', async () => {
    fetchMock.mockReturnValue(resposta(200, { date: '2026-09-01', times: [] }));
    expect(await api.buscarHorarios('2026-09-01')).toEqual([]);
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/available-times?date=2026-09-01');
  });

  it('entradas: reference_time codificado e 5 medidas normalizadas', async () => {
    fetchMock.mockReturnValue(resposta(200, ENTRADAS));
    const r = await api.buscarEntradas('2026-09-01T14:00:00-03:00');
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/weather-inputs?reference_time=2026-09-01T14%3A00%3A00-03%3A00');
    expect(r.weather).toEqual({ temperatura: 24.7, umidade: 74, pressao: 1008.9, nebulosidade: 97, pressaoAnterior: 1009.4 });
    expect(r.previousReferenceTime).toBe('2026-09-01T13:00:00-03:00');
  });

  it('erro no envelope { error: { code, message } } vira ApiError legível', async () => {
    fetchMock.mockReturnValue(resposta(422, { error: { code: 'MISSING_PREVIOUS_HOUR', message: 'Falta a pressão da hora anterior.', field: 'reference_time' } }));
    const e = await api.buscarEntradas('2026-09-01T00:00:00-03:00').catch((x) => x);
    expect(e).toBeInstanceOf(api.ApiError);
    expect(e).toMatchObject({ status: 422, code: 'MISSING_PREVIOUS_HOUR', message: 'Falta a pressão da hora anterior.', incerto: false });
  });

  it('POST /predict: só modo e horário no corpo, Idempotency-Key no cabeçalho; 201 = criada', async () => {
    fetchMock.mockReturnValue(resposta(201, PREVISAO));
    const chave = '7d55d4c2-9ec1-4a8e-8a15-9ef091a4a408';
    const { previsao, criada } = await api.gerarPrevisao(api.corpoPrevisao('2026-09-01T14:00:00-03:00'), chave);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/predict');
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe(chave);
    expect(JSON.parse(init.body)).toEqual({ mode: 'historical', reference_time: '2026-09-01T14:00:00-03:00' });
    expect(criada).toBe(true);
    expect(previsao).toMatchObject({ vaiChover: true, probabilidadePct: 72, limiarPct: 50, modelVersion: 'weather-v6-simple-mean-isotonic-v1', requestId: chave, isMock: false });
    // medidas efetivamente usadas, lidas do nível de cima da resposta
    expect(previsao.weather).toEqual({ temperatura: 24.7, umidade: 74, pressao: 1008.9, nebulosidade: 97, pressaoAnterior: 1009.4 });
  });

  it('POST /predict: 200 (reenvio concluído) também é sucesso', async () => {
    fetchMock.mockReturnValue(resposta(200, PREVISAO));
    const { criada } = await api.gerarPrevisao(api.corpoPrevisao(PREVISAO.reference_time), PREVISAO.request_id);
    expect(criada).toBe(false);
  });

  it('POST /predict: 409 IDEMPOTENCY_CONFLICT preserva o código', async () => {
    fetchMock.mockReturnValue(resposta(409, { error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Chave já usada.' } }));
    const e = await api.gerarPrevisao(api.corpoPrevisao(PREVISAO.reference_time), PREVISAO.request_id).catch((x) => x);
    expect(e).toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('falha de rede é "incerta" (pode ter gravado) e não repete sozinho', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const e = await api.gerarPrevisao(api.corpoPrevisao(PREVISAO.reference_time), PREVISAO.request_id).catch((x) => x);
    expect(e.incerto).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('probabilidade fora de 0–1 não vira previsão', async () => {
    fetchMock.mockReturnValue(resposta(201, { ...PREVISAO, rain_probability: 72 }));
    await expect(api.gerarPrevisao(api.corpoPrevisao(PREVISAO.reference_time), PREVISAO.request_id)).rejects.toThrow(/escala/);
  });

  it('histórico: intervalo e cursor na query; devolve itens e próximo cursor', async () => {
    fetchMock.mockReturnValue(resposta(200, { items: [PREVISAO], next_cursor: 'abc' }));
    const r = await api.listarPrevisoes({ createdFrom: '2026-11-01T00:00:00-03:00', createdTo: '2026-11-09T00:00:00-03:00', limit: 20, cursor: 'xyz' });
    const qs = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(Object.fromEntries(qs)).toEqual({ created_from: '2026-11-01T00:00:00-03:00', created_to: '2026-11-09T00:00:00-03:00', limit: '20', cursor: 'xyz' });
    expect(r.proximoCursor).toBe('abc');
    expect(r.itens[0].predictionId).toBe(PREVISAO.prediction_id);
  });
});
