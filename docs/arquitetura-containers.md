# Arquitetura Docker da versão integrada — entrega de 23/11

O `compose.yaml` declara os quatro serviços requeridos para a versão integrada:

| Serviço | Responsabilidade | Comunicação/publicação |
|---|---|---|
| `frontend` | Interface React/Vite e visualização dos dados. | Publica `127.0.0.1:5173`; usa a URL da API e as variáveis públicas do Supabase no build. |
| `backend` | API Flask, validação, consulta dos dados meteorológicos e histórico de previsões. | Publica `127.0.0.1:8000`; chama `processamento:8100` e acessa o Supabase com credencial privada. |
| `processamento` | Inferência do modelo meteorológico validado. | API na rede interna do Compose, porta 8100 sem publicação ao host. |
| `banco` | PostgreSQL 15 local, schema/amostra e persistência em volume Docker. | Publica `127.0.0.1:5432`; executa `banco/init/` no primeiro uso do volume vazio. |

## Fluxos e limites da integração

O fluxo de previsão implementado é:

```text
Frontend → Backend → Processamento → Backend → Supabase
```

O Frontend também consulta dados de visualização diretamente no Supabase. O Backend envia as entradas meteorológicas validadas ao serviço Python por `PROCESSING_URL=http://processamento:8100`, recebe o resultado e persiste o histórico no Supabase.

O serviço `banco` inicializa um PostgreSQL local com scripts de schema e dados de demonstração, e mantém seu estado no volume `postgres_data`. **Esse PostgreSQL local não é automaticamente sincronizado com o Supabase e não é o armazenamento usado pelo fluxo de previsão descrito acima.** Para demonstrar consulta, inferência e histórico pela aplicação, as tabelas e permissões do Supabase, as variáveis do `.env` e os artefatos do modelo precisam estar disponíveis.

Dentro da rede Docker, use nomes de serviço, não `localhost`: `http://backend:8000` e `http://processamento:8100`. Do computador host, os endereços publicados são `http://localhost:5173` e `http://localhost:8000`.

O Dockerfile de processamento copia os artefatos de `backend/src/models/` para `/app/models/`. Ambos os arquivos (`weather_ensemble.joblib` e `manifest.json`) devem estar presentes e corresponder entre si; o serviço verifica hash e contrato do modelo ao iniciar.

## Subida e verificação

Na raiz do repositório, após criar e configurar `.env` e colocar os artefatos corretos do modelo:

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 banco processamento backend frontend
curl http://localhost:8000/health
```

Para validar o fluxo completo, não basta ver containers em execução: confira que o health check do processamento está saudável, que o Backend acessa os horários no Supabase, execute uma previsão pela interface e verifique seu aparecimento no histórico. Para validar apenas o banco local, consulte [COMANDOS_DOCKER_AVALIACAO.md](../banco/COMANDOS_DOCKER_AVALIACAO.md).
