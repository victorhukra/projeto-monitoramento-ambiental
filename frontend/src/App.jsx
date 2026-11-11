import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getForecast } from './services/weatherApi.js';
import { Empty, ErroComNovaTentativa } from './components/Panels.jsx';
import DiaPorData from './components/DiaPorData.jsx';
import MesPorData from './components/MesPorData.jsx';
import SemanaPorData from './components/SemanaPorData.jsx';
import HistoricoBusca from './components/HistoricoBusca.jsx';
import PrevisaoExperimental from './components/PrevisaoExperimental.jsx';
import StatusBackend from './components/StatusBackend.jsx';
import PeriodComparison from './components/PeriodComparison.jsx';
import { fmtDateTime, fmtFullDateTime } from './lib/format.js';
import { mensagemParaUsuario } from './lib/mensagensErro.js';

// O mapa (Leaflet) carrega à parte, para não pesar o carregamento inicial da página.
const CityMap = lazy(() => import('./components/CityMap.jsx'));

const NAV = [['agora', 'Agora'], ['semana', 'Semana'], ['mapa', 'Mapa'], ['dados', 'Histórico'], ['comparar', 'Comparar dias'], ['integracao', 'Previsão']];

// Duas rotas sem roteador: "/" é o painel (Mapa, Agora, Semana e Dados são seções dele) e "/integracao" é outra tela.
const RAIZ = import.meta.env.BASE_URL;
const ROTA_INTEGRACAO = `${RAIZ}integracao`;
const telaDaUrl = () => (window.location.pathname.replace(/\/+$/, '') === ROTA_INTEGRACAO ? 'integracao' : 'painel');
const lerTemaSalvo = () => {
  try {
    const tema = window.localStorage.getItem('chuva-londrina:tema');
    return tema === 'claro' || tema === 'escuro' ? tema : null;
  } catch {
    return null;
  }
};
const temaDoSistema = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';

export default function App() {
  const [menu, setMenu] = useState(false);
  const [tema, setTema] = useState(() => lerTemaSalvo() ?? temaDoSistema());
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [tela, setTela] = useState(telaDaUrl);
  const [painelMontado, setPainelMontado] = useState(() => telaDaUrl() === 'painel');
  const [alvo, setAlvo] = useState(null); // seção para rolar depois da troca de tela
  const [historicoVersao, setHistoricoVersao] = useState(0); // muda a cada previsão salva → histórico recarrega
  const [tentativa, setTentativa] = useState(0); // "Tentar novamente": refaz a consulta do painel
  const historicoRef = useRef(null);
  const irParaHistorico = () => { historicoRef.current?.scrollIntoView(); historicoRef.current?.focus({ preventScroll: true }); };

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = tema;
  }, [tema]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const atualizarTemaDoSistema = () => {
      if (lerTemaSalvo() === null) setTema(media.matches ? 'escuro' : 'claro');
    };
    media.addEventListener?.('change', atualizarTemaDoSistema);
    return () => media.removeEventListener?.('change', atualizarTemaDoSistema);
  }, []);

  function alternarTema() {
    const proximo = tema === 'escuro' ? 'claro' : 'escuro';
    try { window.localStorage.setItem('chuva-londrina:tema', proximo); } catch { /* preferência vale enquanto a página estiver aberta */ }
    setTema(proximo);
  }

  useEffect(() => {
    const voltar = () => {
      const proximaTela = telaDaUrl();
      setTela(proximaTela); // botões voltar/avançar do navegador
      if (proximaTela === 'painel') setPainelMontado(true);
    };
    window.addEventListener('popstate', voltar);
    return () => window.removeEventListener('popstate', voltar);
  }, []);

  // A seção só existe depois que o painel aparece, por isso a rolagem fica num efeito.
  // O foco vai para o título da tela nova (o leitor de tela anuncia a troca) quando a tela muda;
  // dentro do painel, só rola até a seção.
  const tituloRef = useRef(null);
  const telaAnterior = useRef(tela);
  useEffect(() => {
    if (!alvo) return;
    const trocouDeTela = telaAnterior.current !== tela;
    telaAnterior.current = tela;
    if (alvo.id === 'integracao') window.scrollTo(0, 0);
    else document.getElementById(alvo.id)?.scrollIntoView();
    if (trocouDeTela) tituloRef.current?.focus({ preventScroll: true });
  }, [alvo, tela]);

  useEffect(() => {
    document.title = tela === 'integracao' ? 'Previsão de chuva — Chuva Londrina' : 'Chuva Londrina — Monitoramento de chuva';
  }, [tela]);

  function irPara(e, id) {
    e.preventDefault();
    setMenu(false);
    const destino = id === 'integracao' ? ROTA_INTEGRACAO : RAIZ;
    if (window.location.pathname !== destino) window.history.pushState(null, '', destino);
    setTela(id === 'integracao' ? 'integracao' : 'painel');
    if (id !== 'integracao') setPainelMontado(true);
    setAlvo({ id });
  }

  // Resultados com erro não ficam no cache de weatherApi.js, então uma nova tentativa consulta o banco de novo.
  useEffect(() => {
    const ctrl = new AbortController();
    getForecast({ signal: ctrl.signal })
      .then((data) => setState({ loading: false, data, error: null }))
      .catch((e) => e.name !== 'AbortError' && setState((s) => ({ ...s, loading: false, error: mensagemParaUsuario(e) })));
    return () => ctrl.abort();
  }, [tentativa]);

  function tentarDeNovo() {
    setState((s) => ({ ...s, loading: true, error: null }));
    setTentativa((t) => t + 1);
  }

  const { data, loading, error } = state;
  const meta = data?.meta;
  const errs = meta?.errors ?? {}; // erro por consulta (allSettled)
  const carregando = loading && !data; // primeira carga: os blocos mostram "Carregando…", não "sem registros"
  // Um único aviso para as falhas do painel (os blocos afetados mostram só "Dados indisponíveis no momento").
  // Só as consultas que alimentam blocos desta tela: "current" (data da atualização), "days" (últimos 7 dias) e
  // "station" (mapa). O resumo do dia (DiaPorData) faz as próprias consultas e mostra os próprios avisos.
  const falhas = ['current', 'days', 'station'].map((k) => errs[k]).filter(Boolean);
  const falhaTotal = error ?? meta?.dbError ?? null; // nenhuma consulta funcionou
  let aviso = null;
  if (falhaTotal) aviso = `Não foi possível carregar os dados. ${falhaTotal}`;
  else if (falhas.length) aviso = `Parte dos dados não pôde ser carregada. ${falhas[0]}`;
  // Com o aviso no topo (ou enquanto ele ainda pode aparecer, na carga), as seções não repetem o alerta:
  // mostram só "Dados indisponíveis", e o "Tentar novamente" do topo refaz as consultas delas também.
  const avisoNoTopo = Boolean(aviso) || loading;

  return (
    <>
      <header className="top">
        <div className="wrap">
          <a className="brand" href={RAIZ} onClick={(e) => irPara(e, 'mapa')} aria-label="Chuva Londrina, ir para o início">
            <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#2563EB" strokeWidth="1.8" strokeLinecap="round">
              <path d="M7 15a4 4 0 0 1 .6-7.95A5.5 5.5 0 0 1 18 8.5 3.5 3.5 0 0 1 17.5 15z" /><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" />
            </svg>
            <span><b>Chuva Londrina</b><small>Monitoramento de chuva</small></span>
          </a>
          <nav id="nav" className={menu ? 'open' : ''} aria-label="Principal">
            {NAV.map(([id, n]) => <a key={id} href={id === 'integracao' ? ROTA_INTEGRACAO : RAIZ} aria-current={id === tela ? 'page' : undefined} onClick={(e) => irPara(e, id)}>{n}</a>)}
          </nav>
          <div className="nav-actions">
            <button className="theme-toggle" type="button" onClick={alternarTema} aria-label={`Ativar modo ${tema === 'escuro' ? 'claro' : 'escuro'}`} aria-pressed={tema === 'escuro'} title={`Ativar modo ${tema === 'escuro' ? 'claro' : 'escuro'}`}>
              {tema === 'escuro' ? (
                <svg key={tema} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
              ) : (
                <svg key={tema} viewBox="0 0 24 24" aria-hidden="true"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></svg>
              )}
            </button>
            <button className="menu-btn" aria-expanded={menu} aria-controls="nav" onClick={() => setMenu(!menu)}>Menu</button>
          </div>
        </div>
      </header>

      {tela === 'integracao' && (
      <main className="wrap">
        <h1 ref={tituloRef} tabIndex={-1}>Previsão de chuva</h1>
        <p className="meta">Escolha um dia e um horário do passado e veja se o sistema teria previsto chuva na hora seguinte.</p>
        <StatusBackend />
        <div className="pilha">
          <PrevisaoExperimental onPrevisaoSalva={() => setHistoricoVersao((v) => v + 1)} onConsultarHistorico={irParaHistorico} />
          <HistoricoBusca ref={historicoRef} atualizacao={historicoVersao} />
          <p className="note">Estas simulações usam dados do passado, inclusive de períodos que o sistema usou para aprender. Elas servem para demonstrar o funcionamento e não medem a precisão real das previsões.</p>
        </div>
      </main>
      )}
      {painelMontado && (
      <main className="wrap dashboard" hidden={tela === 'integracao'}>
        <div className="page-intro">
          <div>
            <p className="eyebrow">MONITORAMENTO METEOROLÓGICO</p>
            <h1 ref={tituloRef} tabIndex={-1}>Clima em Londrina</h1>
            <p className="intro-copy">Acompanhe as condições observadas e a chuva na cidade.</p>
          </div>
          <p className="meta update-chip">
            <span className={`update-dot${loading ? ' is-loading' : ''}`} aria-hidden="true" />
            {meta?.updatedAt ? `Atualizado até ${fmtDateTime(meta.updatedAt)}`
              : carregando ? 'Carregando dados recentes…' : 'Atualização indisponível'}
            {loading && !carregando && ' · atualizando'}
          </p>
        </div>
        {aviso && !loading && <ErroComNovaTentativa onTentar={tentarDeNovo}>{aviso}</ErroComNovaTentativa>}

        <section id="agora" className="today-section" aria-labelledby="t-agora">
          <DiaPorData atualizacao={tentativa} avisoNoTopo={avisoNoTopo} />
        </section>

        <section id="semana" className="forecast-section" aria-labelledby="t-semana">
          <SemanaPorData recentes={data?.daily} erroRecentes={errs.days} carregandoRecentes={carregando} atualizacao={tentativa} avisoNoTopo={avisoNoTopo} />
        </section>

        <section id="mapa" aria-labelledby="t-mapa">
          <div className="card map-card">
            <h2 id="t-mapa">Mapa de Londrina</h2>
            <Suspense fallback={<Empty>Carregando mapa…</Empty>}>
              <CityMap station={data?.station} city={data?.city} at={meta?.updatedAt} loading={carregando} visible={tela === 'painel'} />
            </Suspense>
          </div>
        </section>

        <section id="dados" className="grid2">
          <MesPorData atualizacao={tentativa} avisoNoTopo={avisoNoTopo} />
          <div className="card compare-card"><PeriodComparison latestDate={meta?.updatedAt} atualizacao={tentativa} avisoNoTopo={avisoNoTopo} /></div>
        </section>

      </main>
      )}

      <footer className="wrap foot">
        {/* Fontes reunidas só aqui (no mapa fica apenas o crédito obrigatório do OpenStreetMap) */}
        <div className="sources">
          <span><b>Chuva Londrina</b> · protótipo acadêmico · UTFPR Londrina</span>
          <span>Fonte dos dados: {meta?.source ?? (carregando ? 'carregando…' : 'não informada')} · Último dado recebido: {fmtFullDateTime(meta?.updatedAt) ?? (carregando ? 'carregando…' : 'indisponível')}</span>
          <span>Limite municipal: IBGE (malha municipal 2022) · Mapa: © OpenStreetMap</span>
        </div>
        <a href={RAIZ} onClick={(e) => irPara(e, 'mapa')}>Voltar ao início</a>
      </footer>
    </>
  );
}
