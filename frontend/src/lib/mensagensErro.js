// Mensagens de erro mostradas ao usuário: um único lugar para traduzir falhas técnicas em linguagem simples.
// Regra: a tela recebe só o texto amigável; o detalhe técnico (status, código, mensagem original) vai para o
// console (registrarErro) e fica preservado no próprio erro (cause, status, code, detalhe) para diagnóstico.
// Cada mensagem diz o motivo e o que fazer. A tela pode antepor a ação: "Não foi possível gerar a previsão. <mensagem>".

export const MSG = {
  conexao: 'Sem conexão com o serviço. Verifique sua internet e tente novamente.',
  demora: 'O serviço está demorando para responder. Aguarde um pouco e tente novamente.',
  indisponivel: 'O serviço está indisponível no momento. Tente novamente em alguns minutos.',
  dadosIndisponiveis: 'O serviço de dados está indisponível no momento. Tente novamente em alguns minutos.',
  configuracao: 'O sistema está temporariamente indisponível. Tente novamente mais tarde.',
  respostaInvalida: 'O serviço enviou uma resposta que não conseguimos ler. Tente novamente.',
  pedidoInvalido: 'Não foi possível processar o pedido. Recarregue a página e tente novamente.',
  muitasTentativas: 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.',
  generico: 'Ocorreu um problema inesperado. Tente novamente.',
};

// Códigos do envelope { error: { code } } do backend (backend/app). Código desconhecido cai na regra por status.
const POR_CODIGO = {
  WEATHER_RECORD_NOT_FOUND: 'Não temos medições para este horário. Escolha outro horário.',
  MISSING_PREVIOUS_HOUR: 'Faltam medições da hora anterior a este horário. Escolha outro horário.',
  INVALID_WEATHER_INPUT: 'As medições deste horário estão incompletas. Escolha outro horário.',
  AMBIGUOUS_WEATHER_RECORD: 'Há medições repetidas para este horário. Escolha outro horário.',
  INVALID_REFERENCE_TIME: 'O horário escolhido não é válido. Escolha um horário da lista.',
  INVALID_DATE: 'A data escolhida não é válida. Escolha outra data.',
  INVALID_HISTORY_FILTER: 'O período escolhido não é válido. Confira as datas e tente novamente.',
  INVALID_CURSOR: 'Não foi possível carregar mais resultados. Faça a consulta novamente.',
  IDEMPOTENCY_CONFLICT: 'Este pedido não pôde ser concluído. Gere a previsão novamente.',
  REQUEST_IN_PROGRESS: 'Este pedido ainda está sendo processado. Aguarde um pouco antes de tentar de novo.',
  INVALID_IDEMPOTENCY_KEY: MSG.pedidoInvalido,
  INVALID_REQUEST: MSG.pedidoInvalido,
  MODEL_UNAVAILABLE: 'O serviço de previsão está indisponível no momento. Tente novamente mais tarde.',
  MODEL_PREDICTION_FAILED: 'Não foi possível calcular a previsão agora. Tente novamente mais tarde.',
  DATABASE_UNAVAILABLE: MSG.dadosIndisponiveis,
  HISTORY_UNAVAILABLE: 'O histórico está indisponível no momento. Tente novamente em alguns minutos.',
  PREDICTION_WRITE_FAILED: 'Não conseguimos confirmar se a previsão foi salva. Tente novamente.',
};

export function mensagemPorStatus(status) {
  if (status === 408 || status === 504) return MSG.demora;
  if (status === 429) return MSG.muitasTentativas;
  if (status >= 500) return MSG.indisponivel;
  if (status >= 400) return MSG.pedidoInvalido;
  return MSG.generico;
}

// Texto amigável para uma resposta de erro da API: primeiro pelo código, depois pelo status HTTP.
export const mensagemApi = (status, code) => POR_CODIGO[code] ?? mensagemPorStatus(status);

// Registro técnico para a equipe (console do navegador). Nunca aparece na tela.
export function registrarErro(contexto, detalhes) {
  console.error(`[Chuva Londrina] ${contexto}`, detalhes);
}

// Erro com texto amigável em "message" e o detalhe técnico preservado nas demais propriedades.
export class ErroAmigavel extends Error {
  constructor(mensagem, { cause, status = null, code = null, detalhe = null } = {}) {
    super(mensagem, { cause });
    this.name = 'ErroAmigavel';
    this.status = status;
    this.code = code;
    this.detalhe = detalhe;
    this.amigavel = true; // marca verificada em mensagemParaUsuario (instanceof falha entre cópias do módulo)
  }
}

export const cancelado = () => new DOMException('A solicitação foi cancelada.', 'AbortError');

// Falha de uma consulta ao Supabase ({ message, code, details, hint } do PostgREST e o status HTTP).
// - "AbortError: …": a própria tela cancelou a consulta → AbortError, que as telas ignoram (sem log).
// - status 0: a requisição não chegou ao servidor (rede, bloqueio, servidor fora do ar).
// - demais: o servidor respondeu com erro (permissão, tempo limite da consulta, tabela etc.).
export function erroDeConsulta(error, status, contexto = 'Falha na consulta de dados') {
  const original = String(error?.message ?? '');
  if (/^AbortError\b/.test(original)) return cancelado();
  registrarErro(contexto, { status, code: error?.code, message: original, details: error?.details, hint: error?.hint });
  return new ErroAmigavel(status ? MSG.dadosIndisponiveis : MSG.conexao, {
    cause: error, status: status ?? null, code: error?.code || null, detalhe: original || null,
  });
}

// Banco ou API sem as variáveis de ambiente: instrução técnica só no console, texto genérico na tela.
export function erroDeConfiguracao(instrucaoTecnica) {
  registrarErro('Configuração ausente', instrucaoTecnica);
  return new ErroAmigavel(MSG.configuracao, { code: 'NOT_CONFIGURED', detalhe: instrucaoTecnica });
}

// Texto de qualquer erro para exibir na tela. Só repassa error.message quando o erro já é amigável;
// qualquer outro (ex.: TypeError de um defeito no código) vira texto genérico e é registrado no console.
export function mensagemParaUsuario(erro) {
  if (erro?.amigavel === true && typeof erro.message === 'string') return erro.message;
  registrarErro('Erro inesperado', erro);
  return MSG.generico;
}
