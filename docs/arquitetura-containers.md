# Arquitetura da aplicação

O projeto é composto por quatro serviços definidos em `compose.yaml`:

| Serviço | Responsabilidade | Comunicação/publicação |
|---|---|---|
| `frontend` | Interface React/Vite e visualização dos dados. | Publica `127.0.0.1:5173`; usa a URL da API e as variáveis públicas do Supabase durante o build. |
| `backend` | API Flask, validação, consulta de dados meteorológicos e histórico de previsões. | Publica `127.0.0.1:8000`; chama `processamento:8100` e acessa o Supabase com credencial privada. |
| `processamento` | Carregamento e inferência do modelo meteorológico. | API disponível na rede interna do Compose, porta 8100, sem publicação no host. |
| `banco` | PostgreSQL 15 local, schema, amostra e persistência em volume Docker. | Publica `127.0.0.1:5432`; executa `banco/init/` na primeira inicialização do volume vazio. |

## Fluxo de dados

O fluxo de inferência é:

```text
Frontend → Backend → Processamento → Backend → Supabase
```

A interface também consulta dados de visualização diretamente no Supabase. O Backend valida a solicitação, obtém as entradas meteorológicas, chama o serviço Python pelo endereço `http://processamento:8100` e registra a previsão no Supabase.

O PostgreSQL local é inicializado com schema e dados de exemplo para exploração e desenvolvimento. Na configuração atual, ele não é sincronizado com o Supabase nem participa do fluxo de leitura e gravação da aplicação. Seu estado é mantido pelo volume `postgres_data`.

Dentro da rede Docker, os serviços devem comunicar-se pelos nomes definidos no Compose, e não por `localhost`. No computador host, os endereços publicados são `http://localhost:5173`, `http://localhost:8000` e `127.0.0.1:5432`.

## Modelo

O Dockerfile do serviço `processamento` copia `weather_ensemble.joblib` e `manifest.json` de `backend/src/models/` para a imagem. Os dois arquivos devem estar presentes e ser compatíveis antes do build. O serviço valida o manifesto e o artefato ao iniciar; o treinamento não ocorre a cada requisição.

## Inicialização

Configure o `.env` da raiz com os valores válidos do Supabase e disponibilize os artefatos do modelo. Em seguida:

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 banco processamento backend frontend
curl http://localhost:8000/health
```

Consulte [Execução local com Docker Compose](execucao-docker.md) para detalhes de configuração, inicialização, persistência e diagnóstico.
