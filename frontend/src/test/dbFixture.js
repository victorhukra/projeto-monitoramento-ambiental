// Respostas do Supabase no MESMO formato das consultas de forecastRepo.js (aliases do .sql).
// Usado só nos testes automáticos: a página nunca mostra estes dados.
const pad = (n) => String(n).padStart(2, '0');

// 24 registros de 30/09/2026, do mais recente (23h) para o mais antigo (00h): base do resumo do dia nos testes
const RAIN_AT = { 13: 3.9, 20: 0.7, 1: 0.5 };
export const last24 = Array.from({ length: 24 }, (_, i) => {
  const h = 23 - i;
  return { horario: `2026-09-30T${pad(h)}:00:00`, temperatura_c: 20 + (h % 6), chuva_mm: RAIN_AT[h] ?? 0, vento_ms: h === 12 ? 4.83 : 2 };
});

export const current = {
  data_hora: '2026-09-30T23:00:00', cidade: 'Londrina', temperatura_c: 23.6, sensacao_termica_c: 25.7, umidade_pct: 76, vento_ms: 2.36, chuva_mm: 0,
};

// 7 dias (24 a 30/09) de hora em hora, do mais recente para o mais antigo
export const lastDays = Array.from({ length: 7 * 24 }, (_, i) => {
  const day = 30 - Math.floor(i / 24), h = 23 - (i % 24);
  return { horario: `2026-09-${pad(day)}T${pad(h)}:00:00`, temperatura_c: 18 + (h % 8), chuva_mm: day === 29 && h === 20 ? 4.3 : 0 };
});

export const station = { latitude: -23.304, longitude: -51.186 };

// Setembro de 2024, 2025 e 2026 (30 dias × 24 h). Chove 2 mm às 10h em alguns dias.
export const monthHours = (year, month) => {
  if (month !== 9 || year < 2024 || year > 2026) return [];
  const rainyDays = { 2024: [1, 2, 3], 2025: [1, 2, 3, 4, 5, 6], 2026: [1, 29, 30] }[year];
  return Array.from({ length: 720 }, (_, i) => {
    const day = 1 + Math.floor(i / 24), h = i % 24;
    return { horario: `${year}-09-${pad(day)}T${pad(h)}:00:00`, chuva_mm: h === 10 && rainyDays.includes(day) ? 2 : 0 };
  });
};
