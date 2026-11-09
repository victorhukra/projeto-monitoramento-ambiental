import { useEffect, useRef, useState } from 'react';
import { buscarEntradas, buscarHorarios, buscarPeriodo, corpoPrevisao, gerarPrevisao } from '../services/previsaoApi.js';
import { fmtDataHoraCurta, fmtDataIso, fmtHoraMin, fmtJanela } from '../lib/format.js';
import { lerPendente, limparPendente, salvarPendente } from '../lib/pedidoPendente.js';
import { erroDefinitivo } from '../lib/previsaoUtil.js';
import ResultadoPrevisao, { TabelaMedidas } from './ResultadoPrevisao.jsx';
import { Empty, ErroComNovaTentativa } from './Panels.jsx';
import { mensagemParaUsuario } from '../lib/mensagensErro.js';

// Fluxo principal (contrato v6): escolher data e hora T → Buscar dados → Gerar previsão experimental.
// O front não calcula features nem a classificação: mostra o que o backend devolve.

const novaChave = () => crypto.randomUUID();

export default function PrevisaoExperimental({ onPrevisaoSalva, onConsultarHistorico }) {
  const [periodo, setPeriodo] = useState({ status: 'carregando' }); // carregando | sucesso (minDate, maxDate) | erro
  const [data, setData] = useState('');
  const [horarios, setHorarios] = useState({ status: 'ocioso', lista: [] }); // ocioso | carregando | sucesso | erro
  const [hora, setHora] = useState(''); // ISO com fuso devolvido pelo backend
  const [entradas, setEntradas] = useState({ status: 'ocioso' }); // ocioso | carregando | sucesso (dados) | erro
  const [envio, setEnvio] = useState({ status: 'ocioso' }); // ocioso | enviando | sucesso | erro | incerto
  const [pendente, setPendente] = useState(lerPendente); // pedido de resultado incerto (sobrevive ao recarregar)

  const reqPeriodo = useRef(null);
  const reqHorarios = useRef(null);
  const reqEntradas = useRef(null);
  const reqEnvio = useRef(null);

  // Data mudou: invalida tudo o que dependia da seleção anterior e carrega os horários do novo dia.
  function mudarData(valor) {
    reqHorarios.current?.abort();
    reqEntradas.current?.abort();
    setData(valor);
    setHora('');
    setEntradas({ status: 'ocioso' });
    setEnvio({ status: 'ocioso' });
    if (!valor) { setHorarios({ status: 'ocioso', lista: [] }); return; }
    const ctrl = (reqHorarios.current = new AbortController());
    setHorarios({ status: 'carregando', lista: [] });
    buscarHorarios(valor, { signal: ctrl.signal })
      .then((lista) => {
        if (ctrl.signal.aborted) return; // resposta atrasada de outra data
        setHorarios({ status: 'sucesso', lista });
        if (lista.length) setHora(lista[0]);
      })
      .catch((e) => e?.name !== 'AbortError' && !ctrl.signal.aborted && setHorarios({ status: 'erro', lista: [], mensagem: mensagemParaUsuario(e) }));
  }
  const mudarDataRef = useRef(mudarData);

  // Período disponível. Também usada pelo "Tentar novamente": tem o próprio AbortController para que a nova
  // tentativa nunca cancele um POST de previsão em andamento (reqEnvio).
  function carregarPeriodo() {
    reqPeriodo.current?.abort();
    const ctrl = (reqPeriodo.current = new AbortController());
    setPeriodo({ status: 'carregando' });
    buscarPeriodo({ signal: ctrl.signal })
      .then((p) => {
        if (ctrl.signal.aborted) return;
        setPeriodo({ status: 'sucesso', ...p });
        if (p.maxDate) mudarDataRef.current(p.maxDate); // começa pelo dia mais recente disponível
      })
      .catch((e) => e?.name !== 'AbortError' && !ctrl.signal.aborted && setPeriodo({ status: 'erro', mensagem: mensagemParaUsuario(e) }));
  }
  const carregarPeriodoRef = useRef(carregarPeriodo);

  useEffect(() => {
    carregarPeriodoRef.current();
    return () => {
      reqPeriodo.current?.abort();
      reqHorarios.current?.abort();
      reqEntradas.current?.abort();
      reqEnvio.current?.abort();
    };
  }, []);

  function mudarHora(valor) {
    reqEntradas.current?.abort();
    setHora(valor);
    setEntradas({ status: 'ocioso' });
    setEnvio({ status: 'ocioso' });
  }

  async function buscar(e) {
    e.preventDefault();
    if (!hora) return;
    reqEntradas.current?.abort();
    const ctrl = (reqEntradas.current = new AbortController());
    setEnvio({ status: 'ocioso' });
    setEntradas({ status: 'carregando', referenceTime: hora });
    try {
      const dados = await buscarEntradas(hora, { signal: ctrl.signal });
      if (!ctrl.signal.aborted) setEntradas({ status: 'sucesso', referenceTime: hora, dados });
    } catch (err) {
      if (err?.name !== 'AbortError' && !ctrl.signal.aborted) setEntradas({ status: 'erro', referenceTime: hora, mensagem: mensagemParaUsuario(err), code: err.code });
    }
  }

  // Envia um pedido (novo ou reenvio de um incerto). A chave e o corpo do pedido nunca mudam aqui.
  async function enviar(pedido) {
    salvarPendente(pedido);
    setPendente(pedido);
    const ctrl = (reqEnvio.current = new AbortController());
    setEnvio({ status: 'enviando', pedido });
    try {
      const { previsao, criada } = await gerarPrevisao(pedido.corpo, pedido.chave, { signal: ctrl.signal });
      limparPendente();
      setPendente(null);
      setEnvio({ status: 'sucesso', previsao, reenvio: !criada, consultadas: pedido.consultadas });
      onPrevisaoSalva?.(previsao);
    } catch (err) {
      if (err?.name === 'AbortError') return; // componente saiu da tela: o pedido continua salvo como pendente
      if (erroDefinitivo(err)) {
        limparPendente();
        setPendente(null);
        setEnvio({ status: 'erro', mensagem: mensagemParaUsuario(err), code: err.code });
      } else {
        // Sem resposta confirmada, 409 em processamento ou 5xx: mantém a chave e o corpo para "Tentar novamente".
        setEnvio({ status: err.incerto ? 'incerto' : 'erro', mensagem: mensagemParaUsuario(err), code: err.code, manterPendente: true });
      }
    }
  }

  function gerar() {
    if (entradas.status !== 'sucesso' || entradas.referenceTime !== hora) return;
    enviar({ chave: novaChave(), corpo: corpoPrevisao(hora), consultadas: entradas.dados.weather, criadoEm: new Date().toISOString() });
  }

  function descartarPendente() {
    limparPendente();
    setPendente(null);
    setEnvio({ status: 'ocioso' });
  }

  const enviando = envio.status === 'enviando';
  const bloqueado = enviando; // durante o POST a seleção fica travada: abortar não desfaz a gravação no servidor
  const entradasValidas = entradas.status === 'sucesso' && entradas.referenceTime === hora;
  const podeGerar = entradasValidas && !enviando && !pendente;
  const janela = entradasValidas ? entradas.dados : null;
  const semPeriodo = periodo.status === 'sucesso' && (!periodo.minDate || !periodo.maxDate);

  return (
    <section className="card" aria-labelledby="t-previsao">
      <div className="titulo-linha">
        <h2 id="t-previsao">Previsão experimental</h2>
        <span className="selo">Simulação histórica</span>
      </div>
      <p className="note">
        Escolha uma data e uma hora (horário de Londrina). O sistema busca as medições desse momento e a pressão da hora
        anterior e estima se vai chover na hora seguinte. Usa dados do passado: não é uma previsão ao vivo.
      </p>

      {periodo.status === 'carregando' && <Empty>Carregando as datas disponíveis…</Empty>}
      {periodo.status === 'erro' && <ErroComNovaTentativa onTentar={carregarPeriodo}>Não foi possível consultar as datas disponíveis. {periodo.mensagem}</ErroComNovaTentativa>}
      {semPeriodo && <Empty>Nenhum horário disponível.</Empty>}

      {periodo.status === 'sucesso' && !semPeriodo && (
        <form onSubmit={buscar} aria-describedby="prev-periodo">
          <p className="note" id="prev-periodo">Dados de {fmtDataIso(periodo.minDate)} a {fmtDataIso(periodo.maxDate)}. Nem todos os dias têm registros.</p>
          <div className="acoes">
            <div className="campo">
              <label htmlFor="prev-data">Data</label>
              <input id="prev-data" type="date" required min={periodo.minDate} max={periodo.maxDate} value={data}
                onChange={(e) => mudarData(e.target.value)} disabled={bloqueado} />
            </div>
            <div className="campo">
              <label htmlFor="prev-hora">Hora</label>
              <select id="prev-hora" value={hora} onChange={(e) => mudarHora(e.target.value)}
                disabled={bloqueado || horarios.status !== 'sucesso' || !horarios.lista.length}>
                {horarios.status === 'carregando' && <option value="">Carregando…</option>}
                {horarios.status === 'sucesso' && !horarios.lista.length && <option value="">Sem horários</option>}
                {horarios.status !== 'sucesso' && horarios.status !== 'carregando' && <option value="">—</option>}
                {horarios.lista.map((t) => <option key={t} value={t}>{fmtHoraMin(t)}</option>)}
              </select>
            </div>
            <button type="submit" className="btn" disabled={!hora || bloqueado || entradas.status === 'carregando'}>
              {entradas.status === 'carregando' ? 'Buscando…' : 'Buscar dados'}
            </button>
          </div>
          {horarios.status === 'erro' && <ErroComNovaTentativa onTentar={() => mudarData(data)}>Não foi possível listar os horários. {horarios.mensagem}</ErroComNovaTentativa>}
          {horarios.status === 'sucesso' && !horarios.lista.length && (
            <p className="empty">Não há horários com dados completos em {fmtDataIso(data)}. Escolha outra data.</p>
          )}
          {hora && <p className="note">Previsão para: <strong>{fmtJanela(janela?.forecastStart ?? hora, janela?.forecastEnd ?? umaHoraDepois(hora))}</strong></p>}
        </form>
      )}

      <div aria-live="polite">
        {entradas.status === 'carregando' && <Empty>Buscando as medidas de {fmtDataHoraCurta(entradas.referenceTime)}…</Empty>}
        {entradas.status === 'erro' && <p className="err" role="alert">Não foi possível buscar os dados. {entradas.mensagem}</p>}
        {entradasValidas && (
          <div className="entradas">
            <h3 className="subtitulo">Medições deste horário</h3>
            <TabelaMedidas weather={entradas.dados.weather} referenceTime={entradas.dados.referenceTime} previousReferenceTime={entradas.dados.previousReferenceTime} />
          </div>
        )}
      </div>

      {pendente && !enviando && (
        <div className="aviso" role="alert">
          <p>
            <strong>{envio.status === 'incerto' ? 'Não conseguimos confirmar se a previsão foi salva.' : 'A última previsão pode não ter sido concluída.'}</strong>{' '}
            Horário escolhido: {fmtDataHoraCurta(pendente.corpo.reference_time)}.
            {envio.mensagem ? ` ${envio.mensagem}` : ''}
          </p>
          <p className="note">Você pode conferir no histórico se ela foi salva ou tentar de novo. Tentar de novo não cria previsões repetidas. “Esquecer este pedido” só fecha este aviso: se a previsão tiver sido salva, ela continua no histórico.</p>
          <div className="acoes">
            <button type="button" className="btn" onClick={() => enviar(pendente)}>Tentar novamente</button>
            {onConsultarHistorico && <button type="button" className="link" onClick={onConsultarHistorico}>Consultar histórico</button>}
            <button type="button" className="link" onClick={descartarPendente}>Esquecer este pedido</button>
          </div>
        </div>
      )}

      <div className="acoes gerar">
        <button type="button" className="btn" onClick={gerar} disabled={!podeGerar}>
          {enviando ? 'Gerando…' : envio.status === 'sucesso' ? 'Gerar nova previsão' : 'Gerar previsão experimental'}
        </button>
        {!entradasValidas && !enviando && <p className="note">Busque os dados do horário escolhido para liberar a previsão.</p>}
        {enviando && <p className="note" role="status">Calculando a previsão e salvando o resultado…</p>}
      </div>

      {envio.status === 'erro' && !envio.manterPendente && (
        <p className="err" role="alert">
          Não foi possível gerar a previsão. {envio.mensagem}
        </p>
      )}
      {envio.status === 'sucesso' && (
        <ResultadoPrevisao previsao={envio.previsao} reenvio={envio.reenvio} consultadas={envio.consultadas}
          legenda={`Referência ${fmtDataHoraCurta(envio.previsao.referenceTime)} · previsão para a hora seguinte`} />
      )}
    </section>
  );
}

// Só para exibir a janela antes da busca (T+1h). Depois da busca, a tela usa forecast_start/forecast_end do backend.
function umaHoraDepois(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t + 3_600_000).toISOString();
}
