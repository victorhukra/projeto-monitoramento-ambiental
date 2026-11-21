-- ============================================================================
-- PROJETO INTEGRADOR - UTFPR (CÂMPUS LONDRINA)
-- SISTEMA INTELIGENTE DE MONITORAMENTO METEOROLÓGICO E PREVISÃO DE CHUVA COM IA
--
-- ARQUIVO: banco/init/01_schema.sql
-- AMBIENTE: PostgreSQL 15 (Docker Local & Supabase Cloud)
-- LOCALIDADE: Londrina - PR (Lat: -23.304000, Long: -51.186000)
--
-- EQUIPE DE BANCO DE DADOS:
--   - Gustavo Costa (Líder Técnico / Infraestrutura, RLS & Integração)
--   - Verônica Soreano (Modelagem Relacional & Schema DDL)
--   - Samuel Rosa (Consultas Analíticas, Índices B-Tree & Massa de Dados)
--   - Luna Maria (Governança, Dicionário de Dados & Relatórios)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. PAPÉIS DE SEGURANÇA (COMPATIBILIDADE DOCKER LOCAL <-> SUPABASE CLOUD)
-- Cria os papéis utilizados pelas políticas de RLS caso o banco esteja sendo
-- inicializado em uma imagem PostgreSQL 15 padrão do Docker.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. TABELA PRINCIPAL: dataset_weather_goes
-- Armazena a série temporal meteorológica horária real (59.160 registros de
-- 2020 a 2026) pareada aos caminhos das matrizes GOES-16 Banda 13 no campo
-- 'image_link' (Arquitetura Híbrida: números no Postgres, .npz no Storage).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dataset_weather_goes (
    id SERIAL PRIMARY KEY,                                  -- Chave primária artificial sequencial
    time TIMESTAMP NOT NULL,                                -- Carimbo de data/hora UTC da medição
    image_link VARCHAR(500),                                -- Caminho da matriz .npz do satélite GOES-16
    temperature_2m NUMERIC(5, 2),                           -- Temperatura do ar a 2 metros (°C)
    relative_humidity_2m NUMERIC(5, 2),                     -- Umidade relativa do ar (%)
    dew_point_2m NUMERIC(5, 2),                             -- Ponto de orvalho (°C)
    apparent_temperature NUMERIC(5, 2),                     -- Sensação térmica calculada (°C)
    weather_code INT,                                       -- Código WMO padronizado de condição do tempo
    cloud_cover NUMERIC(5, 2),                              -- Cobertura total de nuvens (%)
    pressure_msl NUMERIC(6, 2),                             -- Pressão atmosférica ao nível do mar (hPa)
    wind_speed_10m NUMERIC(5, 2),                           -- Velocidade do vento a 10 metros (m/s)
    precipitation NUMERIC(5, 2) DEFAULT 0.0,                -- Precipitação acumulada na hora (mm)
    cidade VARCHAR(50) DEFAULT 'Londrina - PR',             -- Município de referência da estação
    latitude NUMERIC(9, 6) DEFAULT -23.304000,              -- Latitude geográfica da estação
    longitude NUMERIC(9, 6) DEFAULT -51.186000              -- Longitude geográfica da estação
);

COMMENT ON TABLE dataset_weather_goes IS 'Série histórica horária de Londrina-PR (59.160 registros, 2020-2026) pareada ao satélite GOES-16.';

-- Índice B-Tree exclusivo: garante no kernel do Postgres no máximo 1 registro por hora
-- e acelera a junção T / T-1h para < 1.5ms (O(log N)).
CREATE UNIQUE INDEX IF NOT EXISTS idx_weather_goes_time_unique 
    ON dataset_weather_goes (time);

-- Índice secundário para consultas de eventos chuvosos e filtros de tempestades
CREATE INDEX IF NOT EXISTS idx_weather_goes_precipitation 
    ON dataset_weather_goes (precipitation);

-- ----------------------------------------------------------------------------
-- 2. TABELA DE SATÉLITE: caracteristicas_goes_stat
-- Armazena estatísticas térmicas extraídas do canal infravermelho (10.3 µm)
-- das matrizes do satélite NOAA GOES-16, vinculadas à medição horária.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caracteristicas_goes_stat (
    id SERIAL PRIMARY KEY,
    weather_id INT NOT NULL REFERENCES dataset_weather_goes(id) ON DELETE CASCADE,
    media NUMERIC(8, 3),                                    -- Média da temperatura de brilho (K ou °C)
    desvio_padrao NUMERIC(8, 3),                            -- Dispersão térmica dos pixels na cena
    minimo NUMERIC(8, 3),                                   -- Temperatura mínima (topo de nuvens convectivas)
    maximo NUMERIC(8, 3),                                   -- Temperatura máxima registrada
    mediana NUMERIC(8, 3)                                   -- Mediana estatística dos pixels
);

COMMENT ON TABLE caracteristicas_goes_stat IS 'Resumo estatístico térmico das matrizes do satélite GOES-16 Banda 13.';

CREATE INDEX IF NOT EXISTS idx_caract_goes_weather_id 
    ON caracteristicas_goes_stat (weather_id);

-- ----------------------------------------------------------------------------
-- 3. TABELA DE PREDIÇÕES DA IA: resultados_previsoes_ia
-- Persistência oficial das inferências do modelo v6 (23 colunas tipadas).
-- Possui idempotência nativa via 'request_id UUID NOT NULL UNIQUE' para evitar
-- duplicação em requisições simultâneas ou cliques duplos.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resultados_previsoes_ia (
    prediction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Identificador único da previsão gerada
    request_id UUID NOT NULL UNIQUE,                          -- Chave obrigatória de idempotência (erro 23505 se duplicar)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),            -- Data/hora da gravação no banco
    location TEXT NOT NULL DEFAULT 'Londrina-PR',             -- Localidade alvo da predição
    
    -- Janelas Temporais da Inferência
    reference_time TIMESTAMPTZ NOT NULL,                      -- Horário T escolhido para simulação
    previous_reference_time TIMESTAMPTZ NOT NULL,             -- Horário anterior T - 1h
    forecast_start TIMESTAMPTZ NOT NULL,                      -- Início do horizonte previsto (T)
    forecast_end TIMESTAMPTZ NOT NULL,                        -- Fim do horizonte previsto (T + 1h)
    
    -- 5 Variáveis Meteorológicas de Entrada do Modelo Tabular v6
    temperature_2m DOUBLE PRECISION NOT NULL,
    relative_humidity_2m DOUBLE PRECISION NOT NULL,
    pressure_msl DOUBLE PRECISION NOT NULL,
    cloud_cover DOUBLE PRECISION NOT NULL,
    pressure_msl_previous_hour DOUBLE PRECISION NOT NULL,     -- Pressão da hora anterior (cálculo de delta)
    
    -- Saídas Calibradas e Metadados de Governança de IA
    rain_probability DOUBLE PRECISION NOT NULL CHECK (rain_probability BETWEEN 0 AND 1),
    rain_predicted BOOLEAN NOT NULL,                          -- Decisão binária (true = chuva prevista)
    decision_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.5, -- Limiar de decisão adotado (50%)
    model_version TEXT DEFAULT 'weather-v6-simple-mean-isotonic-v1',
    mode TEXT NOT NULL DEFAULT 'historical',                  -- Modo de execução ('historical' / 'realtime')
    is_mock BOOLEAN NOT NULL DEFAULT false,                   -- Flag de auditoria (separa testes simulados de IA real)
    input_source TEXT NOT NULL DEFAULT 'dataset',             -- Origem das features
    
    -- Chaves Estrangeiras Opcionais para Rastreabilidade até o Registro Origem e Sessão
    source_record_id INT REFERENCES dataset_weather_goes(id) ON DELETE SET NULL,
    previous_source_record_id INT REFERENCES dataset_weather_goes(id) ON DELETE SET NULL,
    session_id UUID                                           -- UUID de sessão do navegador (isolamento de histórico 1:N)
);

COMMENT ON TABLE resultados_previsoes_ia IS 'Auditoria de predições de chuva (modelo v6) com idempotência por request_id e isolamento por session_id.';

CREATE INDEX IF NOT EXISTS idx_previsoes_session_created 
    ON resultados_previsoes_ia (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_previsoes_created_at 
    ON resultados_previsoes_ia (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_previsoes_reference_time 
    ON resultados_previsoes_ia (reference_time DESC);

-- ----------------------------------------------------------------------------
-- 4. VIEW DE CONSUMO DO FRONTEND: clima_atual
-- Retorna a medição climática mais recente de Londrina para os cards iniciais.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW clima_atual AS
SELECT 
    time AS data_hora,
    temperature_2m AS temperatura_c,
    apparent_temperature AS sensacao_c,
    relative_humidity_2m AS umidade_pct,
    wind_speed_10m AS vento_ms,
    precipitation AS chuva_mm
FROM dataset_weather_goes
ORDER BY time DESC
LIMIT 1;

-- ----------------------------------------------------------------------------
-- 5. SEGURANÇA: ROW LEVEL SECURITY (RLS) E PERMISSÕES
-- Princípio do Menor Privilégio:
--   - anon/authenticated: leitura liberada apenas na série histórica e satélite.
--   - resultados_previsoes_ia: acesso público revogado; apenas service_role
--     (Backend Flask) pode consultar, inserir e excluir previsões.
-- ----------------------------------------------------------------------------
ALTER TABLE dataset_weather_goes ENABLE ROW LEVEL SECURITY;
ALTER TABLE caracteristicas_goes_stat ENABLE ROW LEVEL SECURITY;
ALTER TABLE resultados_previsoes_ia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir SELECT publico anon para dataset_weather_goes" ON dataset_weather_goes;
CREATE POLICY "Permitir SELECT publico anon para dataset_weather_goes"
    ON dataset_weather_goes FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Permitir SELECT publico anon para caracteristicas_goes_stat" ON caracteristicas_goes_stat;
CREATE POLICY "Permitir SELECT publico anon para caracteristicas_goes_stat"
    ON caracteristicas_goes_stat FOR SELECT
    TO anon, authenticated
    USING (true);

REVOKE SELECT ON resultados_previsoes_ia FROM anon, authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON dataset_weather_goes, caracteristicas_goes_stat, clima_atual TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
