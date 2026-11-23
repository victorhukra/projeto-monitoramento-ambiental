# Execução dos containers com Docker Compose

Este guia descreve a execução local da versão integrada de 23/11/2026. O Compose declara quatro serviços: interface `frontend`, API `backend`, serviço Python `processamento` e PostgreSQL local `banco`.

| Serviço | Endereço/porta no host | Observação |
|---|---|---|
| Frontend | http://localhost:5173 | Aplicação React/Vite servida pelo container. |
| Backend | http://localhost:8000 | API Flask; `/health` verifica o estado da API. |
| Processamento | Não publicado; porta interna 8100 | Acessível ao Backend pelo nome `processamento`. |
| Banco | `127.0.0.1:5432` | PostgreSQL 15, volume `postgres_data` e carga inicial local. |

> O PostgreSQL local inicializado pelo Compose não é sincronizado com o Supabase. Nesta versão, o Backend consulta e grava os dados da aplicação no Supabase; o serviço PostgreSQL local demonstra o schema, os dados iniciais e a persistência local.

## Pré-requisitos

- Docker instalado e em execução, com plugin Docker Compose.
- Acesso autorizado ao projeto Supabase da equipe, tabelas e permissões configuradas.
- `weather_ensemble.joblib` e `manifest.json` compatíveis, obtidos com a equipe responsável pelo modelo.
- Portas 5173, 8000 e 5432 disponíveis.

O Dockerfile de `processamento` copia o modelo de `backend/src/models/` no build. Confirme que os dois arquivos estão nesse diretório antes de subir o Compose. Eles não devem ser considerados disponíveis apenas por clonar o repositório.

## Configurar variáveis

Na raiz do repositório, crie o arquivo local:

```bash
cp .env.example .env
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edite `.env` e configure as credenciais do Supabase:

```dotenv
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_chave_secreta
VITE_SUPABASE_ANON_KEY=sua_chave_publica
```

Confirme também que `VITE_SUPABASE_URL` existente no exemplo corresponde ao projeto configurado. A chave `service_role` é secreta e deve ficar somente no Backend. A chave pública é usada pelo Frontend; suas consultas dependem de políticas RLS. Não versione nem compartilhe `.env` ou credenciais.

## Construir, iniciar e verificar

Execute a partir da raiz:

```bash
docker compose up --build -d
docker compose ps
```

Na primeira execução, Docker baixa imagens e constrói os módulos. Confira os logs:

```bash
docker compose logs --tail=100 banco processamento backend frontend
```

Verifique a API em http://localhost:8000/health e acesse a interface em http://localhost:5173. Um status de container em execução não confirma sozinho que modelo, Supabase e fluxo estão prontos. Confirme as informações de saúde, consulte horários, execute uma previsão histórica e verifique o resultado no histórico. O serviço de processamento não tem porta publicada para o host.

## Demonstrar o PostgreSQL local

Os scripts `banco/init/01_schema.sql` e `banco/init/02_dados.sql` são executados na primeira inicialização, quando o volume de dados está vazio. Para consultar as tabelas e registros iniciais:

```bash
docker compose exec banco psql -U postgres -d projeto_integrador
```

Dentro do `psql`:

```sql
\dt
\dv
SELECT count(*) FROM dataset_weather_goes;
SELECT time, temperature_2m, relative_humidity_2m, precipitation
FROM dataset_weather_goes ORDER BY time DESC LIMIT 5;
```

Saia com `\q`. Veja [COMANDOS_DOCKER_AVALIACAO.md](../banco/COMANDOS_DOCKER_AVALIACAO.md) para mais consultas de demonstração.

## Parar, reiniciar e preservar os dados

```bash
docker compose down
```

Esse comando remove containers e rede, mas preserva o volume nomeado `postgres_data`. Para subir novamente:

```bash
docker compose up -d
```

Se mudar código, modelo ou configurações incorporadas às imagens, reconstrua:

```bash
docker compose up --build -d
```

**Atenção:** `docker compose down -v` remove volumes associados e pode apagar definitivamente os dados locais. Os scripts de inicialização não são executados de novo em um volume já existente.

## Solução de problemas

| Sintoma | Verificação |
|---|---|
| Serviço de processamento falha no build | Artefatos `.joblib` e `manifest.json` existem em `backend/src/models/` e são compatíveis. |
| Processamento não fica saudável | Consulte `docker compose logs processamento`; confirme validação do manifesto e modelo. |
| Backend não retorna horários | Confira URL, credencial privada, tabela e permissões do Supabase; consulte logs do Backend. |
| Frontend não exibe dados | Confira URL/chave pública do Supabase e políticas RLS. |
| Erro de CORS | A origem do navegador deve corresponder a `FRONTEND_ORIGIN` configurada no Compose. |
| Porta 5173, 8000 ou 5432 ocupada | Libere a porta ou ajuste o mapeamento e as URLs correspondentes. |
| Banco local parece vazio após reiniciar | Confirme o volume `postgres_data`; scripts de init só executam em diretório de dados vazio. |

Não exponha valores do `.env` ao compartilhar logs ou capturas de tela.
