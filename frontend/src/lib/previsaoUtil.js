import { MEDIDAS } from './camposPrevisao.js';

// Alguma das 5 medidas usadas no POST difere da busca anterior? (o registro mudou entre a consulta e a execução)
export const entradasMudaram = (usadas, consultadas) =>
  Boolean(usadas && consultadas) && MEDIDAS.some((m) => usadas[m.id] !== consultadas[m.id]);

// Junta páginas do histórico sem duplicar: o mesmo prediction_id (ou request_id) aparece uma vez só.
export function juntarSemDuplicar(atuais, novos) {
  const id = (p) => p.predictionId ?? p.requestId;
  const vistos = new Set(atuais.map(id));
  return [...atuais, ...novos.filter((p) => id(p) == null || (!vistos.has(id(p)) && vistos.add(id(p))))];
}

// Erros que garantem que nada foi gravado e que não adianta repetir com a mesma chave (4xx, exceto "em processamento").
// Os demais (rede, timeout, 5xx, 409 REQUEST_IN_PROGRESS) mantêm o pedido pendente para "Tentar novamente".
export const erroDefinitivo = (e) => e?.status >= 400 && e.status < 500 && e.code !== 'REQUEST_IN_PROGRESS';
