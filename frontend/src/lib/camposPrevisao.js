// Os 4 dados da previsão como aparecem na tela. Os nomes no JSON do backend ficam só em services/previsaoApi.js.
export const CAMPOS = [
  { id: 'temperatura', rotulo: 'Temperatura', unidade: '°C', min: -10, max: 50 },
  { id: 'umidade', rotulo: 'Umidade relativa', unidade: '%', min: 0, max: 100 },
  { id: 'pressao', rotulo: 'Pressão ao nível do mar', unidade: 'hPa', min: 900, max: 1100 },
  { id: 'nebulosidade', rotulo: 'Nebulosidade', unidade: '%', min: 0, max: 100 },
];

// As 5 medidas que o backend devolve para a previsão experimental: as 4 acima em T e a pressão de T−1h.
// "momento" diz a qual horário a medida se refere (T ou T−1h), para a tela mostrar o horário certo.
export const MEDIDAS = [
  ...CAMPOS.map((c) => ({ ...c, momento: 'T' })),
  { id: 'pressaoAnterior', rotulo: 'Pressão ao nível do mar (hora anterior)', unidade: 'hPa', min: 900, max: 1100, momento: 'T-1h' },
];

export const fmtValor = (v, unidade) =>
  v == null ? 'indisponível' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${unidade === '%' ? '' : ' '}${unidade}`;
