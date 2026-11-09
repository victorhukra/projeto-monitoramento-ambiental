// Comunicação HTTP com o backend. TODO o contrato (rotas, nomes dos campos, formato) fica só neste arquivo.
// Contrato: docs "Demandas ao Frontend — busca histórica e previsão de chuva" (v6, 08/11/2026) e o
// backend Flask (backend/app/main.py). Todos os dados vêm do backend real, que lê e grava no Supabase.

const BASE_URL = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

const TIMEOUT_MS = 10_000;
const TIMEOUT_PREVISAO_MS = 30_000; // o POST consulta o banco, roda o modelo e grava: pode demorar mais

const ROTAS = {
  saude: '/health',
  horarios: '/available-times', // sem ?date: período; com ?date=AAAA-MM-DD: horários do dia
  entradas: '/weather-inputs', // ?reference_time=<ISO com fuso>
  prever: '/predict',
  previsoes: '/predictions', // ?created_from&created_to&limit&cursor
};

// id da medida na tela (lib/camposPrevisao.js) → nome do campo no JSON do backend
// (dentro de "weather" em /weather-inputs; no nível de cima em /predict e /predictions)
const MEDIDAS_JSON = {
  temperatura: 'temperature_2m',
  umidade: 'relative_humidity_2m',
  pressao: 'pressure_msl',
  nebulosidade: 'cloud_cover',
  pressaoAnterior: 'pressure_msl_previous_hour',
};

const NAO_CONFIGURADO = 'Backend não configurado: preencha VITE_API_URL no arquivo .env e reinicie o npm run dev.';

export const backendConfigurado = () => Boolean(BASE_URL);

// Erro da API com o código do envelope { error: { code, message, field } }.
// incerto=true: não houve resposta confirmada (rede/timeout); o pedido pode ou não ter sido gravado.
export class ApiError extends Error {
  constructor(mensagem, { status = null, code = null, field = null, incerto = false, cause } = {}) {
    super(mensagem, { cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
    this.incerto = incerto;
  }
}

const MENSAGEM_STATUS = {
  404: 'O registro não está disponível para esse horário.',
  409: 'Conflito com um pedido anterior.',
  422: 'Os dados enviados ou os dados do banco para esse horário são inválidos.',
  503: 'Serviço indisponível no momento (modelo, banco ou gravação). Tente novamente mais tarde.',
};

export function erroHttp(status, corpo) {
  const env = corpo?.error && typeof corpo.error === 'object' ? corpo.error : null;
  const msgServidor = env?.message ?? corpo?.message ?? corpo?.detail ?? (typeof corpo?.error === 'string' ? corpo.error : null);
  const mensagem = typeof msgServidor === 'string' && msgServidor.trim()
    ? msgServidor.trim()
    : MENSAGEM_STATUS[status] ?? `O servidor respondeu com erro ${status}.`;
  return new ApiError(mensagem, { status, code: env?.code ?? null, field: env?.field ?? null });
}

async function requisitar(rota, { signal, method = 'GET', json, headers = {}, timeoutMs = TIMEOUT_MS } = {}) {
  if (!BASE_URL) throw new ApiError(NAO_CONFIGURADO);
  const ctrl = new AbortController();
  let estourou = false;
  const timer = setTimeout(() => { estourou = true; ctrl.abort(); }, timeoutMs);
  const cancelar = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  signal?.addEventListener('abort', cancelar, { once: true });
  try {
    const res = await fetch(`${BASE_URL}${rota}`, {
      method,
      headers: { Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : undefined,
      signal: ctrl.signal,
    });
    const texto = await res.text();
    let corpo = null;
    try { corpo = texto ? JSON.parse(texto) : null; } catch { /* corpo não é JSON: só o status importa */ }
    return { status: res.status, ok: res.ok, corpo };
  } catch (e) {
    if (estourou) throw new ApiError(`O servidor demorou mais de ${timeoutMs / 1000} segundos para responder.`, { incerto: true, cause: e });
    if (e?.name === 'AbortError') throw e; // cancelado pela tela (ex.: seleção mudou)
    throw new ApiError('Não foi possível conectar ao backend. Verifique a internet e se o servidor está no ar.', { incerto: true, cause: e });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancelar);
  }
}

const numero = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const texto = (v) => (typeof v === 'string' && v.trim() ? v : null);
const inesperada = (detalhe) => new ApiError(`Resposta inesperada do servidor${detalhe ? `: ${detalhe}` : ''}.`);

function normalizarWeather(w) {
  return Object.fromEntries(Object.entries(MEDIDAS_JSON).map(([id, nome]) => [id, numero(w?.[nome])]));
}

// Resposta de GET /weather-inputs (só apresenta as entradas; não gera previsão).
function normalizarEntradas(c) {
  if (!texto(c?.reference_time) || !c?.weather) throw inesperada('faltam o horário ou as medidas');
  return {
    location: c.location ?? null,
    mode: c.mode ?? null,
    referenceTime: c.reference_time,
    previousReferenceTime: c.previous_reference_time ?? null,
    forecastStart: c.forecast_start ?? null,
    forecastEnd: c.forecast_end ?? null,
    weather: normalizarWeather(c.weather),
  };
}

// Resposta do POST /predict e itens de GET /predictions. Só converte o formato: a classificação é do
// backend (rain_predicted); o front não usa o limiar para recalcular nada.
// O backend devolve as 5 medidas no nível de cima da linha salva; aceita também um objeto "weather".
export function normalizarPrevisao(c) {
  const probabilidade = numero(c?.rain_probability);
  if (typeof c?.rain_predicted !== 'boolean' || probabilidade == null) throw inesperada('faltam a classificação ou a probabilidade');
  if (probabilidade < 0 || probabilidade > 1) throw inesperada('probabilidade fora da escala de 0 a 1');
  const limiar = numero(c.decision_threshold);
  return {
    predictionId: c.prediction_id ?? null,
    requestId: c.request_id ?? null,
    createdAt: c.created_at ?? null,
    location: c.location ?? null,
    mode: c.mode ?? null,
    isMock: c.is_mock === true,
    modelVersion: c.model_version ?? null,
    referenceTime: c.reference_time ?? null,
    previousReferenceTime: c.previous_reference_time ?? null,
    forecastStart: c.forecast_start ?? null,
    forecastEnd: c.forecast_end ?? null,
    weather: normalizarWeather(c.weather && typeof c.weather === 'object' ? c.weather : c),
    vaiChover: c.rain_predicted,
    probabilidadePct: probabilidade * 100,
    limiarPct: limiar == null ? null : limiar * 100,
  };
}

// ---------------------------------------------------------------- rotas

// GET /health → { status, model_loaded, model_error, database_configured, integration_ready, model_version }.
export async function verificarSaude({ signal } = {}) {
  const { ok, status, corpo } = await requisitar(ROTAS.saude, { signal });
  if (!ok) throw erroHttp(status, corpo);
  return corpo ?? {};
}

// GET /available-times → { minDate, maxDate, timezone } (datas "AAAA-MM-DD" ou null).
export async function buscarPeriodo({ signal } = {}) {
  const { ok, status, corpo } = await requisitar(ROTAS.horarios, { signal });
  if (!ok) throw erroHttp(status, corpo);
  return { minDate: corpo?.min_date ?? null, maxDate: corpo?.max_date ?? null, timezone: corpo?.timezone ?? null };
}

// GET /available-times?date=AAAA-MM-DD → lista de horários elegíveis (ISO com fuso). Dia sem horários: [].
export async function buscarHorarios(data, { signal } = {}) {
  const { ok, status, corpo } = await requisitar(`${ROTAS.horarios}?${new URLSearchParams({ date: data })}`, { signal });
  if (!ok) throw erroHttp(status, corpo);
  if (!Array.isArray(corpo?.times)) throw inesperada('lista de horários ausente');
  return corpo.times.filter((t) => typeof t === 'string');
}

// GET /weather-inputs?reference_time=… → entradas do horário T (4 medidas) e pressão de T−1h.
export async function buscarEntradas(referenceTime, { signal } = {}) {
  const { ok, status, corpo } = await requisitar(`${ROTAS.entradas}?${new URLSearchParams({ reference_time: referenceTime })}`, { signal });
  if (!ok) throw erroHttp(status, corpo);
  return normalizarEntradas(corpo);
}

// Corpo do POST /predict. Só horário e modo: o backend busca as medidas de novo.
export const corpoPrevisao = (referenceTime) => ({ mode: 'historical', reference_time: referenceTime });

// POST /predict com Idempotency-Key. Devolve { previsao, criada } (criada: 201; reenvio já concluído: 200).
// Não repete sozinho: em rede/timeout lança ApiError com incerto=true e a tela oferece "Tentar novamente".
export async function gerarPrevisao(corpo, chave, { signal } = {}) {
  const { ok, status, corpo: resp } = await requisitar(ROTAS.prever, {
    signal, method: 'POST', json: corpo, headers: { 'Idempotency-Key': chave }, timeoutMs: TIMEOUT_PREVISAO_MS,
  });
  if (!ok) throw erroHttp(status, resp);
  return { previsao: normalizarPrevisao(resp), criada: status === 201 };
}

// GET /predictions → { itens, proximoCursor }. Intervalo [createdFrom, createdTo) em ISO com fuso.
export async function listarPrevisoes({ createdFrom, createdTo, limit = 20, cursor } = {}, { signal } = {}) {
  const qs = new URLSearchParams({ created_from: createdFrom, created_to: createdTo, limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  const { ok, status, corpo } = await requisitar(`${ROTAS.previsoes}?${qs}`, { signal });
  if (!ok) throw erroHttp(status, corpo);
  if (!Array.isArray(corpo?.items)) throw inesperada('lista de previsões ausente');
  return { itens: corpo.items.map(normalizarPrevisao), proximoCursor: corpo.next_cursor ?? null };
}

