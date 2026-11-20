-- ============================================================================
-- PROJETO INTEGRADOR - UTFPR (CÂMPUS LONDRINA)
-- SCRIPT OPCIONAL: IMPORTAÇÃO COMPLETA DAS 59.160 HORAS VIA CSV EXTERNO
--
-- USO: Caso deseje carregar o dataset integral (dataset_weather.csv, ~12 MB)
--      no container Docker local (PostgreSQL 15), execute no PowerShell:
--
--   Get-Content -Raw dataset_weather.csv | docker compose exec -T banco psql -U postgres -d projeto_integrador -f -
--   (ou monte o arquivo em /tmp/dataset_weather.csv e rode este script)
-- ============================================================================

CREATE TEMP TABLE tmp_weather_csv (
    time TIMESTAMP,
    image_link VARCHAR(500),
    temperature_2m NUMERIC(5, 2),
    relative_humidity_2m NUMERIC(5, 2),
    dew_point_2m NUMERIC(5, 2),
    apparent_temperature NUMERIC(5, 2),
    weather_code NUMERIC,
    cloud_cover NUMERIC(5, 2),
    pressure_msl NUMERIC(6, 2),
    surface_pressure NUMERIC,
    wind_speed_10m NUMERIC(5, 2),
    wind_direction_10m NUMERIC,
    wind_gusts_10m NUMERIC,
    shortwave_radiation NUMERIC,
    direct_radiation NUMERIC,
    diffuse_radiation NUMERIC,
    direct_normal_irradiance NUMERIC,
    is_day NUMERIC,
    sunshine_duration NUMERIC,
    soil_moisture_0_to_7cm NUMERIC,
    rain NUMERIC,
    precipitation NUMERIC(5, 2)
);

-- Exemplo de leitura via caminho montado no container:
COPY tmp_weather_csv FROM '/tmp/dataset_weather.csv' WITH (FORMAT csv, HEADER true);

INSERT INTO dataset_weather_goes (
    time, image_link, temperature_2m, relative_humidity_2m, dew_point_2m,
    apparent_temperature, weather_code, cloud_cover, pressure_msl,
    wind_speed_10m, precipitation
)
SELECT
    time, image_link, temperature_2m, relative_humidity_2m, dew_point_2m,
    apparent_temperature, ROUND(weather_code)::INT, cloud_cover, pressure_msl,
    wind_speed_10m, COALESCE(precipitation, 0.0)
FROM tmp_weather_csv
ON CONFLICT (time) DO NOTHING;

DROP TABLE tmp_weather_csv;
