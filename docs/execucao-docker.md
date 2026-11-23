# Execução local com Docker Compose

Este guia descreve como configurar e executar localmente a aplicação. O Compose inicia a interface `frontend`, a API `backend`, o serviço Python `processamento` e o PostgreSQL `banco`.

| Serviço | Endereço no host | Observação |
|---|---|---|
| Frontend | http://localhost:5173 | Aplicação React/Vite. |
| Backend | http://localhost:8000 | API Flask; `/health` informa o estado da API. |
| Processamento | Não publicado; porta interna 8100 | Acessível ao Backend pelo nome `processamento`. |
| Banco | `127.0.0.1:5432` | PostgreSQL 15, volume persistente e carga inicial local. |

O Backend e a interface usam o Supabase configurado para a aplicação. O PostgreSQL local é um banco separado, inicializado com schema e dados de exemplo; não é sincronizado com o Supabase nem usado pelo fluxo atual da aplicação.

## Pré-requisitos

- Docker instalado e em execução, com Docker Compose v2.
- Acesso autorizado ao projeto Supabase, às tabelas e às permissões necessárias.
- Os artefatos compatíveis `weather_ensemble.joblib` e `manifest.json`.
- Portas 5173, 8000 e 5432 disponíveis.

Antes de construir as imagens, coloque os artefatos em `backend/src/models/`. O Dockerfile de processamento copia os arquivos desse diretório; sem ambos, o build não será concluído.

## Configurar variáveis

Na raiz do repositório, crie o arquivo local:

```bash
cp .env.example .env
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edite `.env` e informe as credenciais válidas:

```dotenv
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_chave_secreta
VITE_SUPABASE_ANON_KEY=sua_chave_publica
```

Confirme também que `VITE_SUPABASE_URL` corresponde ao projeto. A chave `SUPABASE_SERVICE_ROLE_KEY` é secreta e deve ficar somente no Backend. A chave pública usada pelo Frontend deve seguir as políticas RLS do Supabase. Não versionize nem compartilhe o `.env`.

## Construir, iniciar e verificar

Execute a partir da raiz:

```bash
docker compose up --build -d
docker compose ps
```

Na primeira execução, Docker baixa as imagens e constrói os módulos. Consulte os logs:

```bash
docker compose logs --tail=100 banco processamento backend frontend
```

Verifique a API em http://localhost:8000/health e acesse a interface em http://localhost:5173. O serviço de processamento não publica uma porta no host; o Backend acessa `http://processamento:8100` dentro da rede Docker.

## Consultar o PostgreSQL local

Os scripts `banco/init/01_schema.sql` e `banco/init/02_dados.sql` são executados automaticamente quando o volume de dados está vazio. Para abrir o cliente PostgreSQL:

```bash
docker compose exec banco psql -U postgres -d projeto_integrador
```

No `psql`, consulte as tabelas, views e amostra:

```sql
\dt
\dv
SELECT count(*) FROM dataset_weather_goes;
SELECT time, temperature_2m, relative_humidity_2m, precipitation
FROM dataset_weather_goes ORDER BY time DESC LIMIT 5;
```

Saia com `\q`. Veja [Consultas e comandos do PostgreSQL](../banco/COMANDOS_DOCKER_AVALIACAO.md) para mais exemplos.

## Parar, reiniciar e preservar os dados

```bash
docker compose down
```

Esse comando remove containers e rede, mas preserva o volume nomeado `postgres_data`. Para iniciar novamente:

```bash
docker compose up -d
```

Se houver mudanças no código, no modelo ou nas configurações incorporadas às imagens, reconstrua:

```bash
docker compose up --build -d
```

**Atenção:** `docker compose down -v` também remove volumes associados e pode apagar os dados locais. Os scripts de inicialização não são executados novamente em um volume existente. Use `down -v` apenas quando quiser apagar intencionalmente os dados locais.

## Solução de problemas

| Sintoma | Verificação |
|---|---|
| Serviço de processamento falha no build | Os dois artefatos existem em `backend/src/models/` e formam um par compatível? |
| Processamento não fica saudável | Consulte `docker compose logs processamento`; confira a validação do manifesto e do modelo. |
| Backend não retorna horários | Confira URL, credencial privada, tabela e permissões do Supabase; consulte os logs do Backend. |
| Frontend não exibe dados | Confira URL, chave pública e políticas RLS do Supabase; confira o console do navegador. |
| Erro de CORS | Confira se a origem do navegador está incluída em `FRONTEND_ORIGIN`. |
| Porta 5173, 8000 ou 5432 ocupada | Libere a porta ou ajuste o mapeamento e as configurações correspondentes. |
| Banco local parece vazio após reiniciar | Confira o volume `postgres_data`; scripts de init só executam quando o diretório de dados está vazio. |

Não exponha valores do `.env` ao compartilhar logs ou capturas de tela.
