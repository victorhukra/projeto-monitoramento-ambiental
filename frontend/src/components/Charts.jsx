import { fmtHour, mm, celsius } from '../lib/format.js';

// Gráficos SVG do painel. Cores e traços vêm de styles.css (classes .g-*, com as variáveis de :root).
const W = 480, H = 210, P = { l: 36, r: 10, t: 14, b: 28 };
// Com muitas barras, rotula uma a cada 3 (sempre incluindo o último registro) para não encavalar.
const showTick = (i, n) => n <= 12 || (n - 1 - i) % 3 === 0;
const emDestaque = (rows, t) => (t === undefined ? rows.at(-1) : rows.find((d) => d.t === t) ?? null);

function Frame({ ticks, fmtTick, ymin = 0, ymax, children, label }) {
  const y = (v) => P.t + (H - P.t - P.b) * (1 - (v - ymin) / (ymax - ymin));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="chart">
      {ticks.map((t) => (
        <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="g-grade" /><text x={P.l - 6} y={y(t) + 4} textAnchor="end" className="tick">{fmtTick(t)}</text></g>
      ))}
      {children(y)}
    </svg>
  );
}

// O <svg role="img"> só tem a descrição geral; os valores de cada hora ficam nesta tabela, visível apenas para
// leitores de tela (o <title> de cada barra/ponto aparece só ao passar o mouse).
// O .sr fica num <div>: uma <table> não encolhe abaixo da largura do conteúdo e alargaria a página no celular.
function TabelaDeValores({ titulo, coluna, linhas }) {
  return (
    <div className="sr">
      <table>
        <caption>{titulo}</caption>
        <thead><tr><th scope="col">Hora</th><th scope="col">{coluna}</th></tr></thead>
        <tbody>{linhas.map(([hora, valor]) => <tr key={hora}><th scope="row">{hora}</th><td>{valor}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

// Séries observadas, do mais antigo para o mais recente.
// destaque: horário (t) do registro em destaque; sem a prop, o último registro; null, nenhum.
// Barras e pontos não entram na ordem de Tab: os valores estão na tabela para leitores de tela.
export function RainBars({ data, label = 'Chuva registrada por hora, em milímetros', destaque }) {
  const rows = (data ?? []).filter((d) => d.mm != null);
  if (!rows.length) return <p className="empty">Gráfico indisponível: sem registros de chuva para o período.</p>;
  const ymax = Math.max(5, Math.ceil(Math.max(...rows.map((d) => d.mm)) / 5) * 5);
  const sel = emDestaque(rows, destaque);
  const bw = (W - P.l - P.r) / rows.length;
  return (
    <>
      <Frame ticks={[0, Math.round(ymax / 2), ymax]} fmtTick={(t) => t} ymax={ymax} label={label}>
        {(y) => rows.map((d, i) => (
          <g key={d.t}>
            <rect x={P.l + i * bw + 2} width={Math.max(1, bw - 4)} y={y(d.mm)} height={H - P.b - y(d.mm)} rx="3"
              className={d === sel ? 'g-barra on' : 'g-barra'}><title>{`${fmtHour(d.t)} · ${mm(d.mm)}`}</title></rect>
            {showTick(i, rows.length) && <text x={P.l + i * bw + bw / 2} y={H - 9} textAnchor="middle" className={d === sel ? 'tick on' : 'tick'}>{fmtHour(d.t)}</text>}
          </g>
        ))}
      </Frame>
      <TabelaDeValores titulo={label} coluna="Chuva" linhas={rows.map((d) => [fmtHour(d.t), mm(d.mm)])} />
    </>
  );
}

export function TempLine({ data, label = 'Temperatura registrada por hora, em graus Celsius', destaque }) {
  const rows = (data ?? []).filter((d) => d.tempC != null);
  if (rows.length < 2) return <p className="empty">Gráfico indisponível: registros de temperatura insuficientes.</p>;
  const vals = rows.map((d) => d.tempC);
  const ymin = Math.floor(Math.min(...vals) / 5) * 5;
  const ymax = Math.max(ymin + 5, Math.ceil(Math.max(...vals) / 5) * 5);
  const sel = emDestaque(rows, destaque);
  const step = (W - P.l - P.r) / (rows.length - 1);
  return (
    <>
      <Frame ticks={[ymin, Math.round((ymin + ymax) / 2), ymax]} fmtTick={(t) => `${t}°`} ymin={ymin} ymax={ymax} label={label}>
        {(y) => {
          const pts = rows.map((d, i) => [P.l + i * step, y(d.tempC), d]);
          const line = pts.map(([x, yy], i) => `${i ? 'L' : 'M'}${x},${yy}`).join(' ');
          return (
            <>
              <path d={`${line} L${pts.at(-1)[0]},${y(ymin)} L${P.l},${y(ymin)}Z`} className="g-area" />
              <path d={line} className="g-linha" />
              {pts.map(([x, yy, d], i) => (
                <g key={d.t}>
                  <circle cx={x} cy={yy} r={d === sel ? 6 : 3.5} className={d === sel ? 'g-ponto on' : 'g-ponto'}><title>{`${fmtHour(d.t)} · ${celsius(d.tempC)}`}</title></circle>
                  {showTick(i, rows.length) && <text x={x} y={H - 9} textAnchor={i === rows.length - 1 ? 'end' : 'middle'} className={d === sel ? 'tick on' : 'tick'}>{fmtHour(d.t)}</text>}
                </g>
              ))}
            </>
          );
        }}
      </Frame>
      <TabelaDeValores titulo={label} coluna="Temperatura" linhas={rows.map((d) => [fmtHour(d.t), celsius(d.tempC)])} />
    </>
  );
}

// Um valor por item (ex.: chuva acumulada em dois dias), no mesmo padrão visual dos gráficos por hora.
// As barras começam do zero; o valor fica acima da barra e o rótulo do item embaixo.
// values: [{ label, value }] (value null = sem dados: não desenha barra e escreve "sem dados").
// formatar: texto do valor (ex.: "6,5 mm"); o último item fica na cor de destaque, como o último registro.
// label: descrição com todos os valores (são poucos itens, então cabem no aria-label).
export function ComparisonBars({ values, formatar, label }) {
  const max = Math.max(0, ...values.map((d) => d.value ?? 0));
  const ymax = Math.max(5, Math.ceil(max / 5) * 5);
  const slot = (W - P.l - P.r) / values.length;
  const bw = Math.min(96, slot * 0.5);
  return (
    <Frame ticks={[0, Math.round(ymax / 2), ymax]} fmtTick={(t) => t} ymax={ymax} label={label}>
      {(y) => values.map((d, i) => {
        const cx = P.l + slot * i + slot / 2;
        const ultimo = i === values.length - 1;
        return (
          <g key={`${d.label}-${i}`}>
            {d.value != null && (
              <rect x={cx - bw / 2} width={bw} y={y(d.value)} height={H - P.b - y(d.value)} rx="3" className={ultimo ? 'g-barra on' : 'g-barra'}>
                <title>{`${d.label} · ${formatar(d.value)}`}</title>
              </rect>
            )}
            <text x={cx} y={(d.value != null ? y(d.value) : H - P.b) - 6} textAnchor="middle" className={d.value != null ? 'tick on' : 'tick'}>
              {d.value != null ? formatar(d.value) : 'sem dados'}
            </text>
            <text x={cx} y={H - 9} textAnchor="middle" className="tick">{d.label}</text>
          </g>
        );
      })}
    </Frame>
  );
}
