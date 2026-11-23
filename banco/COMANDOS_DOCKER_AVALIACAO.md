# Consultas e comandos do PostgreSQL local

Este documento reúne comandos úteis para iniciar o serviço PostgreSQL local, consultar sua estrutura e verificar a persistência dos dados. Execute os comandos na raiz do repositório.

## Iniciar o banco

Na primeira execução, crie o `.env` a partir do exemplo, caso ainda não exista:

```bash
cp .env.example .env
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Inicie o banco e confira o estado do serviço:

```bash
docker compose up -d banco
docker compose ps
```

Os scripts em `banco/init/` criam o schema e carregam os dados de exemplo quando o volume do banco está vazio. Para consultar os logs:

```bash
docker compose logs banco
```

## Abrir o cliente PostgreSQL

```bash
docker compose exec banco psql -U postgres -d projeto_integrador
```

No prompt do `psql`, os seguintes comandos mostram a estrutura e os dados disponíveis:

```sql
-- Listar tabelas e views
\dt
\dv

-- Inspecionar uma tabela
\d resultados_previsoes_ia

-- Contar medições carregadas
SELECT count(*) AS total_registros FROM dataset_weather_goes;

-- Consultar as medições mais recentes
SELECT time, temperature_2m, relative_humidity_2m, precipitation
FROM dataset_weather_goes
ORDER BY time DESC
LIMIT 5;

-- Consultar previsões armazenadas localmente, se houver registros
SELECT reference_time, temperature_2m, rain_probability, rain_predicted
FROM resultados_previsoes_ia;

-- Consultar a view
SELECT * FROM clima_atual;
```

Para verificar a junção temporal entre uma medição e a pressão da hora anterior, ajuste o timestamp para um horário disponível no dataset:

```sql
SELECT
    t.time,
    t.temperature_2m,
    t.pressure_msl,
    t_prev.pressure_msl AS pressao_hora_anterior
FROM dataset_weather_goes AS t
JOIN dataset_weather_goes AS t_prev
  ON t_prev.time = t.time - INTERVAL '1 hour'
WHERE t.time = '2026-09-30 13:00:00';
```

Saia do `psql` com `\q`.

## Persistência

O volume nomeado `postgres_data` mantém o banco local quando os containers são removidos e recriados:

```bash
docker compose down
docker compose up -d banco
```

`docker compose down -v` apaga também os volumes e os dados locais associados. Use essa opção somente se a remoção dos dados for intencional. Os scripts de `banco/init/` são executados automaticamente apenas quando o diretório de dados está vazio.

> O PostgreSQL local é separado do Supabase usado pela aplicação. Os dados e scripts locais não sincronizam alterações entre esses bancos.
