// Pedido de previsão cujo resultado ainda é incerto (enviando, timeout, falha de rede ou 5xx).
// Fica no sessionStorage para sobreviver a um recarregamento da página: "Tentar novamente" reenvia
// a MESMA Idempotency-Key e o MESMO corpo, e o backend devolve o registro já salvo, se houver.
// O armazenamento pode falhar (aba privada, bloqueio): nesse caso o pedido vale só enquanto a página está aberta.

const CHAVE = 'chuva-londrina:previsao-pendente';

export function lerPendente() {
  try {
    const p = JSON.parse(sessionStorage.getItem(CHAVE) ?? 'null');
    return p && typeof p.chave === 'string' && p.corpo && typeof p.corpo.reference_time === 'string' ? p : null;
  } catch {
    return null;
  }
}

export function salvarPendente(pedido) {
  try { sessionStorage.setItem(CHAVE, JSON.stringify(pedido)); } catch { /* sem armazenamento: segue só em memória */ }
}

export function limparPendente() {
  try { sessionStorage.removeItem(CHAVE); } catch { /* idem */ }
}
