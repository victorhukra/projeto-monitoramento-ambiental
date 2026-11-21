# Execução dos contêineres com Docker

Este guia executa o projeto no computador usando Docker Compose. Ele cria três contêineres:

- **frontend**: disponibiliza a interface em `http://localhost:5173`;
- **backend**: disponibiliza a API em `http://localhost:8000`;
- **banco**: executa o servidor **PostgreSQL 15** local (`127.0.0.1:5432`) com volume persistente (`postgres_data`), criando e populando automaticamente as tabelas (`dataset_weather_goes`, `caracteristicas_goes_stat`, `resultados_previsoes_ia`), índices e a View `clima_atual` a partir de `banco/init/`.

Para acesso rápido ao banco local via terminal (`psql`), consulte também [`banco/COMANDOS_DOCKER_AVALIACAO.md`](../banco/COMANDOS_DOCKER_AVALIACAO.md). O backend e o frontend continuam conectados ao Supabase via variáveis de ambiente no `.env`.

## 1. Pré-requisitos

- Docker e o plugin Docker Compose instalados e com permissão de uso.
- Acesso ao projeto Supabase, com suas tabelas, dados e permissões configurados.
- O arquivo `backend/src/models/weather_ensemble.joblib`, correspondente ao manifesto `backend/src/models/manifest.json`. O modelo não é versionado no Git; sem ele, a API inicia, mas não consegue gerar previsões.

Execute os comandos seguintes na raiz do projeto:

```bash
cd /projeto-monitoramento-ambiental
```

## 2. Configurar o ambiente

Se ainda não existir um `.env` na raiz, crie-o a partir do exemplo:

```bash
cp .env.example .env
```

Preencha as três variáveis com os dados do seu projeto Supabase:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA
SUPABASE_SERVICE_ROLE_KEY=SUA_CHAVE_SECRETA
```

Use a URL sem barra `/` no final. A chave pública `anon` ou `publishable` é usada pelo frontend. A chave `service_role` é secreta e é usada pelo backend; não a compartilhe nem a coloque no frontend ou no Git. O arquivo `.env` está incluído no `.gitignore`.

Os caminhos do modelo e a origem local do frontend já são definidos em `compose.yaml`; não precisam ser configurados no `.env` para essa execução. Os arquivos `frontend/.env` e `backend/.env` também não são necessários para o Compose.

## 3. Construir e iniciar

```bash
docker compose up --build -d
```

Na primeira execução, o Docker baixa as imagens e instala as dependências; isso pode levar alguns minutos. O parâmetro `-d` mantém os contêineres em execução em segundo plano.

Confira o estado dos serviços:

```bash
docker compose ps
```

Os serviços `frontend`, `backend` e `banco` devem aparecer em execução. Isso confirma que os processos iniciaram, mas ainda não confirma a conexão com o Supabase.

## 4. Verificar o funcionamento

1. Abra [http://localhost:8000/health](http://localhost:8000/health). Confira se `model_loaded` e `database_configured` aparecem como `true`. Esse endpoint informa a configuração dos componentes, mas não testa uma consulta ao banco.
2. Abra [http://localhost:8000/available-times](http://localhost:8000/available-times). Uma resposta com `min_date` e `max_date` confirma que o backend conseguiu consultar o Supabase; valores `null` podem indicar uma tabela vazia.
3. Abra [http://localhost:5173](http://localhost:5173) e confira se o painel carrega os dados. Para testar uma previsão, escolha um horário que tenha dados válidos tanto em T quanto em T−1 hora.

## 5. Logs, reinício e parada

Para consultar os logs recentes:

```bash
docker compose logs --tail=100 frontend backend banco
```

Para acompanhar os logs continuamente, use `docker compose logs -f`. Pressione `Ctrl+C` para parar de acompanhar; os contêineres continuam em execução.

Para parar e remover os contêineres e a rede do Compose:

```bash
docker compose down
```

Para iniciar novamente, use `docker compose up -d`. Se alterar código, o arquivo do modelo ou as configurações no `.env`, reconstrua e recrie os serviços:

```bash
docker compose up --build -d
```

As variáveis do frontend são incorporadas à imagem durante o build. Em especial, alterações na URL ou na chave pública exigem reconstruir o frontend.

## 6. Problemas comuns

| Problema | Verificação |
| --- | --- |
| `VITE_SUPABASE_ANON_KEY` ausente | Confira se a variável está preenchida no `.env` da raiz e execute o comando a partir da raiz do projeto. |
| `model_loaded: false` em `/health` | Confira se o arquivo `.joblib` existe, corresponde ao manifesto e reconstrua o backend. Consulte `docker compose logs backend`. |
| `/available-times` retorna erro | Confira a URL, a chave `service_role`, as permissões e a existência da tabela no Supabase. Consulte os logs do backend e do serviço `banco`. |
| O painel não carrega dados | Confira a URL e a chave pública, além das permissões e políticas RLS do Supabase. Consulte os logs do frontend e o console do navegador. |
| Porta 5173 ou 8000 ocupada | Pare o programa que estiver usando a porta ou ajuste as portas e URLs correspondentes no Compose. |

Não publique credenciais ao compartilhar logs ou capturas de tela.
