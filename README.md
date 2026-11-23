# Monitoramento Ambiental — Londrina

Aplicação web para explorar dados meteorológicos históricos de Londrina e consultar uma simulação experimental da probabilidade de chuva para um horário selecionado. O projeto reúne uma interface React, uma API Flask, um serviço Python de inferência e um PostgreSQL local, orquestrados pelo Docker Compose.

> A simulação usa dados históricos e um modelo previamente treinado. Não é uma previsão meteorológica em tempo real, e o modelo não é treinado a cada requisição.

## Funcionalidades

- Consulta e visualização de dados meteorológicos históricos.
- Seleção de uma data e horário disponíveis e consulta das variáveis usadas pelo modelo.
- Inferência de probabilidade/classe de chuva por um serviço Python interno.
- Registro e consulta do histórico de previsões no Supabase.
- Banco PostgreSQL local com schema, dados de exemplo e volume persistente para explorar a estrutura do banco.

## Arquitetura

| Serviço | Responsabilidade | Endereço |
|---|---|---|
| `frontend` | Interface React/Vite para consultar dados e interagir com a simulação. | http://localhost:5173 |
| `backend` | API Flask, validação, consulta dos dados e integração com o serviço de processamento. | http://localhost:8000 |
| `processamento` | API Python interna que carrega o modelo e executa a inferência. | Rede Compose, `http://processamento:8100` |
| `banco` | PostgreSQL 15 local, inicializado com schema e amostra de dados. | `127.0.0.1:5432` |

O fluxo de inferência é **Frontend → Backend → Processamento → Backend → Supabase**. A interface também consulta dados de visualização no Supabase. O PostgreSQL local é inicializado pelo Compose para uso local e persistência de sua amostra; ele não é sincronizado com o Supabase nem é o banco usado pelo fluxo atual da aplicação.

## Pré-requisitos

- Git.
- Docker com Docker Compose v2.
- Acesso autorizado ao projeto Supabase configurado para a aplicação, com tabelas e permissões necessárias.
- Os artefatos compatíveis `weather_ensemble.joblib` e `manifest.json` do modelo.
- Portas locais 5173, 8000 e 5432 disponíveis.

O Dockerfile do serviço `processamento` copia os artefatos de `backend/src/models/`. Antes de construir as imagens, coloque os dois arquivos nesse diretório. Eles devem ser o par compatível aprovado para esta aplicação; sem eles, o build do serviço não será concluído.

## Configuração e execução local

Clone o repositório e entre na raiz:

```bash
git clone --branch entrega-integrada-processamento https://github.com/victorhukra/projeto-monitoramento-ambiental.git
cd projeto-monitoramento-ambiental
cp .env.example .env
```

No Windows PowerShell, use `Copy-Item .env.example .env` no lugar de `cp`.

Edite o `.env` local e configure as credenciais do Supabase:

```dotenv
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_chave_secreta
VITE_SUPABASE_ANON_KEY=sua_chave_publica
```

Confirme que `VITE_SUPABASE_URL` corresponde ao mesmo projeto. `SUPABASE_SERVICE_ROLE_KEY` é uma credencial privada usada pelo Backend: não a publique, não a inclua no código do Frontend e não compartilhe o `.env`. A chave pública do Frontend deve respeitar as políticas de acesso (RLS) configuradas no Supabase. Os valores de exemplo não substituem credenciais válidas.

Construa e inicie os serviços na raiz do repositório:

```bash
docker compose up --build -d
docker compose ps
```

Consulte os logs e verifique a API:

```bash
docker compose logs --tail=100 banco processamento backend frontend
curl http://localhost:8000/health
```

Acesse a interface em http://localhost:5173. O endpoint `/health` informa o estado do Backend e do modelo. O serviço de processamento não publica uma porta no host; o Backend o acessa pelo nome `processamento` na rede interna do Compose.

## Uso da aplicação e API

Escolha uma data e um horário disponíveis para consultar as entradas meteorológicas e solicitar uma simulação. O Backend exige dados válidos no instante `T` e, para a entrada temporal do modelo, pressão disponível em `T−1h`. A disponibilidade depende dos dados e permissões no Supabase. O resultado é gravado no histórico de previsões.

Rotas principais do Backend:

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Estado da API, do modelo e da configuração. |
| `GET` | `/available-times` | Intervalo de datas disponível. |
| `GET` | `/available-times?date=AAAA-MM-DD` | Horários elegíveis em uma data. |
| `GET` | `/weather-inputs?reference_time=...` | Entradas disponíveis sem executar inferência. |
| `POST` | `/predict` | Executa a inferência integrada e persiste o resultado. |
| `GET` | `/predictions` | Consulta o histórico de previsões. |
| `DELETE` | `/predictions/<prediction_id>` | Remove uma previsão do histórico. |

O serviço de processamento oferece `GET /health` e `POST /predict` somente na rede interna do Compose; não é uma API pública.

## PostgreSQL local e persistência

Na primeira execução com um volume vazio, o serviço `banco` executa os scripts SQL em `banco/init/`:

- `01_schema.sql`: tabelas, índices, view e permissões locais.
- `02_dados.sql`: registros meteorológicos de exemplo.

Para abrir o cliente PostgreSQL:

```bash
docker compose exec banco psql -U postgres -d projeto_integrador
```

Dentro do `psql`, por exemplo:

```sql
\dt
\dv
SELECT count(*) FROM dataset_weather_goes;
SELECT time, temperature_2m, relative_humidity_2m, precipitation
FROM dataset_weather_goes
ORDER BY time DESC
LIMIT 5;
```

Saia com `\q`. O volume nomeado `postgres_data` preserva os dados locais entre reinicializações. `docker compose down` remove os containers e mantém o volume; `docker compose down -v` também o apaga. Os scripts de inicialização só são executados automaticamente quando o diretório de dados está vazio.

## Testes dos módulos

Os testes locais requerem as dependências instaladas nos respectivos módulos:

```bash
# Backend: a partir de backend/
python -m unittest discover -s tests -v

# Frontend: a partir de frontend/
npm ci
npm test
npm run lint
npm run build
```

## Solução de problemas

| Sintoma | O que conferir |
|---|---|
| Compose não inicia | Docker ativo, portas 5173/8000/5432 disponíveis e `.env` preenchido na raiz. |
| Build do processamento falha ao copiar o modelo | Presença de `weather_ensemble.joblib` e `manifest.json` em `backend/src/models/`. |
| `model_loaded: false` ou processamento indisponível | Compatibilidade entre modelo e manifesto; consulte `docker compose logs processamento backend`. |
| API não retorna horários | URL, chave privada, tabela e permissões do Supabase; consulte os logs do Backend. |
| Interface não carrega dados | URL e chave pública do Supabase e políticas RLS; confira o console do navegador. |
| Erro de CORS | Confira se a origem do Frontend corresponde a `FRONTEND_ORIGIN`. |
| Inferência indica ausência de hora anterior | Confira se há registro meteorológico válido exatamente em `T−1h`. |
| Dados locais desapareceram | Confira se `docker compose down -v` foi executado e se o volume `postgres_data` existe. |

Para parar os serviços sem apagar o banco local:

```bash
docker compose down
```

## Estrutura do repositório

```text
backend/       API Flask, configuração, testes e integração com Supabase
banco/init/    schema e dados iniciais do PostgreSQL local
banco/doc/     documentação individual do módulo Banco
frontend/      aplicação React/Vite
processamento/ serviço Python de inferência
compose.yaml   orquestração dos quatro serviços
docs/          arquitetura, execução e documentação complementar
```

Cada módulo mantém sua pasta `doc/` para os registros individuais de contribuição dos desenvolvedores.

## Documentação complementar

- [Arquitetura dos containers](docs/arquitetura-containers.md)
- [Execução local com Docker Compose](docs/execucao-docker.md)
- [Consultas e comandos do PostgreSQL](banco/COMANDOS_DOCKER_AVALIACAO.md)
- [Serviço de processamento](processamento/README.md)
