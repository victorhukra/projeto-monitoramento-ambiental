import { useEffect, useRef, useState } from 'react';
import { getDataPeriod, getMonthReport } from '../services/weatherApi.js';
import { rankByRain } from '../lib/daily.js';
import { celsius, fmtDataIso, fmtDay, mm, pct } from '../lib/format.js';
import { Empty, MonthPanel } from './Panels.jsx';

// "Histórico do mês" com escolha de mês/ano: acumulado x média histórica e os dias mais chuvosos do mês.
// Limites (primeiro e último mês) vêm do banco; nada fixo no código. Começa no mês do último registro.
const MIN_DIAS = 10;
const NOMES = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2000, i, 15)).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' }));
const partes = (iso) => (iso ? { ano: Number(iso.slice(0, 4)), mes: Number(iso.slice(5, 7)) } : null);
const chaveMes = (ano, mes) => ano * 100 + mes;

export default function MesPorData() {
  const [periodo, setPeriodo] = useState({ status: 'carregando' });
  const [sel, setSel] = useState(null); // { ano, mes } em edição
  const [rel, setRel] = useState({ status: 'ocioso' }); // relatório exibido: carregando | sucesso | erro
  const [todos, setTodos] = useState(false); // mostrar todos os dias do mês, não só os 10 mais chuvosos
  const pedido = useRef(null);

  function carregar(ano, mes) {
    pedido.current?.abort();
    const ctrl = (pedido.current = new AbortController());
    setTodos(false);
    setRel({ status: 'carregando', ano, mes });
    getMonthReport(ano, mes, { signal: ctrl.signal })
      .then((dados) => !ctrl.signal.aborted && setRel({ status: 'sucesso', ano, mes, dados }))
      .catch((e) => e?.name !== 'AbortError' && !ctrl.signal.aborted && setRel({ status: 'erro', ano, mes, mensagem: e.message }));
  }
  const carregarRef = useRef(carregar);

  useEffect(() => {
    const ctrl = new AbortController();
    getDataPeriod({ signal: ctrl.signal })
      .then((p) => {
        setPeriodo({ status: 'sucesso', ...p });
        const ultimo = partes(p.maxDate);
        if (ultimo) { setSel(ultimo); carregarRef.current(ultimo.ano, ultimo.mes); }
      })
      .catch((e) => e?.name !== 'AbortError' && setPeriodo({ status: 'erro', mensagem: e.message }));
    return () => { ctrl.abort(); pedido.current?.abort(); };
  }, []);

  const min = partes(periodo.minDate), max = partes(periodo.maxDate);
  const anos = min && max ? Array.from({ length: max.ano - min.ano + 1 }, (_, i) => max.ano - i) : [];
  const mesValido = (ano, mes) => min && max && chaveMes(ano, mes) >= chaveMes(min.ano, min.mes) && chaveMes(ano, mes) <= chaveMes(max.ano, max.mes);
  // Ao trocar o ano, mantém o mês se ele existir no banco; senão usa o mês mais próximo do período.
  const mudarAno = (ano) => setSel((s) => ({ ano, mes: mesValido(ano, s.mes) ? s.mes : ano === min.ano ? min.mes : max.mes }));

  function mostrar(e) {
    e.preventDefault();
    if (sel && mesValido(sel.ano, sel.mes)) carregar(sel.ano, sel.mes);
  }

  const dados = rel.status === 'sucesso' ? rel.dados : null;
  const ehUltimo = max && rel.ano === max.ano && rel.mes === max.mes;
  const incompleto = dados && dados.hours > 0 && dados.hours < dados.expectedHours;
  const ranking = dados ? rankByRain(dados.days) : [];
  const lista = todos ? ranking : ranking.slice(0, MIN_DIAS);
  const diasComChuva = dados ? dados.days.filter((d) => d.rainMm > 0).length : 0;
  const carregando = rel.status === 'carregando';

  return (
    <>
      <div className="card">
        <h2>Histórico do mês</h2>
        {periodo.status === 'carregando' && <Empty>Consultando o período do banco…</Empty>}
        {periodo.status === 'erro' && <p className="err" role="alert">Não foi possível consultar o período do banco: {periodo.mensagem}</p>}
        {sel && min && max && (
          <form className="acoes mes-form" onSubmit={mostrar} aria-describedby="mes-limites" aria-label="Escolher mês do histórico">
            <div className="campo">
              <label htmlFor="mes-mes">Mês</label>
              <select id="mes-mes" value={sel.mes} onChange={(e) => setSel((s) => ({ ...s, mes: Number(e.target.value) }))}>
                {NOMES.map((n, i) => <option key={n} value={i + 1} disabled={!mesValido(sel.ano, i + 1)}>{n}</option>)}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="mes-ano">Ano</label>
              <select id="mes-ano" value={sel.ano} onChange={(e) => mudarAno(Number(e.target.value))}>
                {anos.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <button type="submit" className="btn" disabled={carregando || !mesValido(sel.ano, sel.mes)}>{carregando ? 'Buscando…' : 'Mostrar mês'}</button>
            <p className="note" id="mes-limites">Dados de {fmtDataIso(periodo.minDate)} a {fmtDataIso(periodo.maxDate)}.</p>
          </form>
        )}

        <div aria-live="polite">
          {carregando && <Empty>Buscando {NOMES[rel.mes - 1]} de {rel.ano} no banco…</Empty>}
          {rel.status === 'erro' && <p className="err" role="alert">Não foi possível ler o banco: {rel.mensagem}</p>}
          {dados && dados.hours === 0 && <Empty>Não há registros de {dados.label} no banco.</Empty>}
          {dados && dados.hours > 0 && (
            <>
              <MonthPanel month={dados} rotulo={ehUltimo ? 'Este mês' : `Acumulado em ${dados.label}`} />
              <p className="note">
                {diasComChuva} {diasComChuva === 1 ? 'dia' : 'dias'} com chuva em {dados.days.length} {dados.days.length === 1 ? 'dia' : 'dias'} com registros
                {incompleto ? ` · mês incompleto no banco (${dados.hours} de ${dados.expectedHours} horas)` : ''}.
              </p>
            </>
          )}
        </div>
        <div className="about"><h3>Como lemos os dados</h3>
          <p>Chuva somada a partir dos registros horários do banco (Supabase). A média histórica usa o mesmo mês dos até 10 anos anteriores que têm pelo menos 90% das horas registradas. Não é previsão.</p></div>
      </div>

      <section className="card" aria-labelledby="t-dias-chuvosos">
        <h2 id="t-dias-chuvosos">Dias mais chuvosos{dados ? ` de ${dados.label}` : ''}</h2>
        <p className="note">Ordenados pela chuva do dia · % do mês = parte do acumulado do mês que caiu no dia · cidade toda</p>
        {carregando && <Empty>Buscando os dias do mês…</Empty>}
        {rel.status === 'erro' && <p className="err" role="alert">Não foi possível ler o banco: {rel.mensagem}</p>}
        {dados && !dados.days.length && <Empty>Sem registros neste mês.</Empty>}
        {dados && dados.days.length > 0 && (
          <>
            <div className="scroll">
              <table>
                <thead>
                  <tr><th>#</th><th>Dia</th><th>Chuva</th><th>% do mês</th><th>Horas com chuva</th><th>Temp. máx. / mín.</th><th>Umidade média</th><th>Nuvens média</th></tr>
                </thead>
                <tbody>
                  {lista.map((d, i) => (
                    <tr key={d.date} className={d.rainMm > 0 ? undefined : 'seco'}>
                      <td>{i + 1}</td>
                      <td>{fmtDay(d.date)}{d.hours < 24 && <small className="parcial"> · {d.hours}h</small>}</td>
                      <td><strong>{mm(d.rainMm)}</strong></td>
                      <td>{d.pctMes == null ? '—' : <span className="pct-mes"><i style={{ width: `${Math.min(100, d.pctMes)}%` }} />{pct(d.pctMes)}</span>}</td>
                      <td>{d.rainyHours}</td>
                      <td>{celsius(d.tMax)} / {celsius(d.tMin)}</td>
                      <td>{pct(d.humidityAvg)}</td>
                      <td>{pct(d.cloudAvg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {dados.days.length > MIN_DIAS && (
              <div className="acoes mais">
                <button type="button" className="link" onClick={() => setTodos((t) => !t)}>
                  {todos ? `Mostrar só os ${MIN_DIAS} mais chuvosos` : `Ver todos os ${dados.days.length} dias`}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
