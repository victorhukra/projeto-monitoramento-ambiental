import { useEffect, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtHour, mm, celsius } from '../lib/format.js';

const chartColors = {
  grid: 'var(--line)',
  text: 'var(--muted)',
  bar: 'var(--chart-bar)',
  blue: 'var(--blue)',
  navy: 'var(--navy)',
  card: 'var(--card)',
  area: 'var(--chart-area)',
};

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

function ChartTooltip({ active, label, payload, formatar }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <p key={item.dataKey}>{formatar(item.value)}</p>
      ))}
    </div>
  );
}

function ChartShell({ label, children, className = '', eager = false }) {
  const container = useRef(null);
  const suportaIntersectionObserver = typeof window !== 'undefined' && 'IntersectionObserver' in window;
  const [visible, setVisible] = useState(() => eager || !suportaIntersectionObserver);

  useEffect(() => {
    const element = container.current;
    if (eager || !element || !suportaIntersectionObserver) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.12) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: [0.12] });
    observer.observe(element);
    return () => observer.disconnect();
  }, [eager, suportaIntersectionObserver]);

  return (
    <div ref={container} className={`chart ${className}`} role="img" aria-label={label} data-visible={visible}>
      {visible && (
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}

const tick = { fill: chartColors.text, fontSize: 12 };
const axisLine = { stroke: chartColors.grid };
const grid = { stroke: chartColors.grid, strokeDasharray: '3 3', vertical: false };
const horaTickInterval = (length) => (length > 12 ? 2 : 0);

// Séries por hora. Os valores completos também ficam numa tabela acessível para leitores de tela.
export function RainBars({ data, label = 'Chuva registrada por hora, em milímetros', destaque }) {
  const rows = (data ?? []).filter((d) => d.mm != null).map((d) => ({ ...d, hora: fmtHour(d.t) }));
  if (!rows.length) return <p className="empty">Gráfico indisponível: sem registros de chuva para o período.</p>;
  const ymax = Math.max(5, Math.ceil(Math.max(...rows.map((d) => d.mm)) / 5) * 5);

  return (
    <>
      <ChartShell label={label} eager>
        <BarChart data={rows} margin={{ top: 14, right: 10, bottom: 4, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid {...grid} />
          <XAxis dataKey="hora" interval={horaTickInterval(rows.length)} tick={tick} tickLine={false} axisLine={axisLine} />
          <YAxis domain={[0, ymax]} tickCount={3} width={42} tick={tick} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip formatar={mm} />} cursor={{ fill: chartColors.area }} animationDuration={180} />
          <Bar dataKey="mm" name="Chuva" fill={chartColors.bar} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive animationBegin={100} animationDuration={1050} animationEasing="ease-out">
            {rows.map((row) => <Cell key={row.t} fill={row.t === destaque ? chartColors.blue : chartColors.bar} />)}
          </Bar>
        </BarChart>
      </ChartShell>
      <TabelaDeValores titulo={label} coluna="Chuva" linhas={rows.map((d) => [d.hora, mm(d.mm)])} />
    </>
  );
}

export function TempLine({ data, label = 'Temperatura registrada por hora, em graus Celsius', destaque }) {
  const rows = (data ?? []).filter((d) => d.tempC != null).map((d) => ({ ...d, hora: fmtHour(d.t) }));
  if (rows.length < 2) return <p className="empty">Gráfico indisponível: registros de temperatura insuficientes.</p>;
  const values = rows.map((d) => d.tempC);
  const ymin = Math.floor(Math.min(...values) / 5) * 5;
  const ymax = Math.max(ymin + 5, Math.ceil(Math.max(...values) / 5) * 5);
  const selected = rows.find((d) => d.t === destaque);

  return (
    <>
      <ChartShell label={label} eager>
        <AreaChart data={rows} margin={{ top: 14, right: 10, bottom: 4, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid {...grid} />
          <XAxis dataKey="hora" interval={horaTickInterval(rows.length)} tick={tick} tickLine={false} axisLine={axisLine} />
          <YAxis domain={[ymin, ymax]} tickCount={3} width={46} tick={tick} tickFormatter={(value) => `${value}°`} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip formatar={celsius} />} cursor={{ stroke: chartColors.grid }} animationDuration={180} />
          <Area dataKey="tempC" name="Temperatura" type="monotone" stroke={chartColors.blue} strokeWidth={2.5} fill={chartColors.area} fillOpacity={1} dot={false} activeDot={{ r: 5, fill: chartColors.blue, stroke: chartColors.card, strokeWidth: 2 }} isAnimationActive animationBegin={140} animationDuration={1250} animationEasing="ease-in-out" />
          {selected && <ReferenceDot x={selected.hora} y={selected.tempC} r={5} fill={chartColors.navy} stroke={chartColors.card} strokeWidth={2} />}
        </AreaChart>
      </ChartShell>
      <TabelaDeValores titulo={label} coluna="Temperatura" linhas={rows.map((d) => [d.hora, celsius(d.tempC)])} />
    </>
  );
}

// Comparação de dois períodos. A descrição inclui todos os valores para tecnologias assistivas.
export function ComparisonBars({ values, formatar, label }) {
  const rows = (values ?? []).map((item) => ({ ...item, value: item.value == null ? null : Number(item.value) }));
  const max = Math.max(0, ...rows.map((d) => d.value ?? 0));
  const ymax = Math.max(5, Math.ceil(max / 5) * 5);
  if (!rows.length) return <p className="empty">Gráfico indisponível: sem períodos para comparar.</p>;

  return (
    <ChartShell label={label} className="chart-comparison">
      <BarChart data={rows} margin={{ top: 28, right: 12, bottom: 4, left: 4 }} accessibilityLayer={false}>
        <CartesianGrid {...grid} />
        <XAxis dataKey="label" tick={tick} tickFormatter={(_, index) => `Dia ${index + 1}`} tickLine={false} axisLine={axisLine} interval={0} />
        <YAxis domain={[0, ymax]} tickCount={3} width={42} tick={tick} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltip formatar={formatar} />} cursor={{ fill: chartColors.area }} animationDuration={180} />
        <Bar dataKey="value" name="Valor" fill={chartColors.bar} radius={[4, 4, 0, 0]} maxBarSize={100} isAnimationActive animationBegin={100} animationDuration={1050} animationEasing="ease-out">
          {rows.map((row, index) => <Cell key={`${row.label}-${index}`} fill={index === rows.length - 1 ? chartColors.blue : chartColors.bar} />)}
          <LabelList dataKey="value" position="top" formatter={(value) => (value == null ? '' : formatar(value))} className="chart-value-label" />
        </Bar>
      </BarChart>
    </ChartShell>
  );
}
