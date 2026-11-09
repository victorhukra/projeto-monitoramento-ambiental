import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErroAmigavel, MSG, erroDeConfiguracao, erroDeConsulta, mensagemApi, mensagemParaUsuario } from './mensagensErro.js';

let log;
beforeEach(() => { log = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => log.mockRestore());

describe('mensagemApi (código do backend → texto amigável)', () => {
  it('usa o código quando ele é conhecido', () => {
    expect(mensagemApi(422, 'MISSING_PREVIOUS_HOUR')).toBe('Faltam medições da hora anterior a este horário. Escolha outro horário.');
    expect(mensagemApi(404, 'WEATHER_RECORD_NOT_FOUND')).toMatch(/Não temos medições para este horário/);
    expect(mensagemApi(503, 'DATABASE_UNAVAILABLE')).toBe(MSG.dadosIndisponiveis);
  });
  it('código desconhecido ou ausente: regra pelo status HTTP', () => {
    expect(mensagemApi(500, null)).toBe(MSG.indisponivel);
    expect(mensagemApi(503, 'CODIGO_NOVO')).toBe(MSG.indisponivel);
    expect(mensagemApi(504, null)).toBe(MSG.demora);
    expect(mensagemApi(429, null)).toBe(MSG.muitasTentativas);
    expect(mensagemApi(405, 'METHOD_NOT_ALLOWED')).toBe(MSG.pedidoInvalido);
  });
  it('nenhuma mensagem contém termos técnicos', () => {
    const codigos = ['WEATHER_RECORD_NOT_FOUND', 'MISSING_PREVIOUS_HOUR', 'INVALID_WEATHER_INPUT', 'IDEMPOTENCY_CONFLICT', 'INVALID_IDEMPOTENCY_KEY', 'MODEL_UNAVAILABLE', 'INVALID_CURSOR', 'INVALID_HISTORY_FILTER'];
    const textos = [...codigos.map((c) => mensagemApi(422, c)), ...Object.values(MSG)];
    for (const t of textos) expect(t).not.toMatch(/backend|banco|API|HTTP|UUID|Idempotency|T−1h|fuso|cursor|modelo v6|contrato|\d{3}/i);
  });
});

describe('erroDeConsulta (falha do Supabase)', () => {
  it('servidor respondeu com erro: texto amigável, detalhe técnico preservado e registrado', () => {
    const original = { message: 'permission denied for table dataset_weather_goes', code: '42501', details: null, hint: null };
    const e = erroDeConsulta(original, 401);
    expect(e).toBeInstanceOf(ErroAmigavel);
    expect(e.message).toBe(MSG.dadosIndisponiveis);
    expect(e).toMatchObject({ status: 401, code: '42501', detalhe: original.message, cause: original });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls[0])).toContain('permission denied');
  });
  it('sem resposta do servidor (status 0): falha de conexão', () => {
    const e = erroDeConsulta({ message: 'TypeError: Failed to fetch', code: '' }, 0);
    expect(e.message).toBe(MSG.conexao);
    expect(e.message).not.toMatch(/fetch/i);
  });
  it('consulta cancelada pela tela vira AbortError, sem registro no console', () => {
    const e = erroDeConsulta({ message: 'AbortError: signal is aborted without reason', code: '' }, 0);
    expect(e.name).toBe('AbortError');
    expect(log).not.toHaveBeenCalled();
  });
});

describe('mensagemParaUsuario', () => {
  it('repassa só mensagens amigáveis', () => {
    expect(mensagemParaUsuario(new ErroAmigavel('Texto claro.'))).toBe('Texto claro.');
  });
  it('erro técnico inesperado vira texto genérico e vai para o console', () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'map')");
    expect(mensagemParaUsuario(bug)).toBe(MSG.generico);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Erro inesperado'), bug);
  });
});

describe('erroDeConfiguracao', () => {
  it('instrução técnica só no console; a tela recebe texto genérico', () => {
    const e = erroDeConfiguracao('preencha VITE_API_URL no .env');
    expect(e.message).toBe(MSG.configuracao);
    expect(e.detalhe).toContain('VITE_API_URL');
    expect(JSON.stringify(log.mock.calls[0])).toContain('VITE_API_URL');
  });
});
