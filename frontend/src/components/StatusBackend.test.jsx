import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErroAmigavel } from '../lib/mensagensErro.js';

const api = vi.hoisted(() => ({ verificarSaude: vi.fn() }));
vi.mock('../services/previsaoApi.js', () => api);
const { default: StatusBackend } = await import('./StatusBackend.jsx');

let log;
beforeEach(() => { api.verificarSaude.mockReset(); log = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => log.mockRestore());

// Nenhum estado pode mostrar jargão de infraestrutura.
const SEM_JARGAO = /backend|banco|modelo|API|v6/i;

describe('StatusBackend (disponibilidade do serviço de previsão)', () => {
  it('serviço no ar: mensagem simples, sem versão do modelo nem "banco conectado"', async () => {
    api.verificarSaude.mockResolvedValue({ status: 'ok', model_loaded: true, database_configured: true, model_version: 'weather-v6-x' });
    const { container } = render(<StatusBackend />);
    expect(screen.getByText(/Verificando se o serviço de previsão está disponível/)).toBeTruthy();
    expect(await screen.findByText(/Serviço de previsão disponível/)).toBeTruthy();
    expect(container.textContent).not.toMatch(SEM_JARGAO);
  });

  it('serviço responde mas não consegue prever: explica o efeito; o detalhe técnico vai para o console', async () => {
    api.verificarSaude.mockResolvedValue({ status: 'ok', model_loaded: false, database_configured: true });
    render(<StatusBackend />);
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('não consegue gerar previsões agora');
    expect(alerta.textContent).not.toMatch(SEM_JARGAO);
    expect(JSON.stringify(log.mock.calls)).toContain('modelo não carregado');
  });

  it('serviço fora do ar: mensagem amigável do erro', async () => {
    api.verificarSaude.mockRejectedValue(new ErroAmigavel('Sem conexão com o serviço. Verifique sua internet e tente novamente.'));
    render(<StatusBackend />);
    const alerta = await screen.findByRole('alert');
    expect(alerta.querySelector('p').textContent).toBe('O serviço de previsão não está disponível agora. Sem conexão com o serviço. Verifique sua internet e tente novamente.');
  });
});
