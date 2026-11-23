# Monitoramento Ambiental — Londrina

Versão integrada do Projeto Integrador de Monitoramento Ambiental com dados meteorológicos históricos, interface web e simulação experimental da probabilidade de chuva para uma hora. Esta documentação descreve o estado desta branch e orienta a demonstração da **entrega integrada de 23/11/2026**.

> A simulação utiliza registros históricos e um modelo já treinado. Não é uma previsão meteorológica ao vivo, e o modelo não é treinado a cada requisição.

## O que está integrado

O `compose.yaml` declara quatro serviços:

| Serviço | Responsabilidade | Acesso |
|---|---|---|
| `frontend` | Interface React/Vite para consultar dados e interagir com a simulação. | http://localhost:5173 |
| `backend` | API Flask, validação da solicitação, consulta das entradas e persistência do histórico de previsões. | http://localhost:8000 |
| `processamento` | Serviço Python interno que carrega e valida os artefatos do modelo e executa a inferência. | Rede interna do Compose, porta 8100; sem porta publicada no host |
| `banco` | PostgreSQL 15 local, inicializado com schema, amostra de dados e volume persistente. | `127.0.0.1:5432` |

Fluxo de previsão: **Frontend → Backend → Processamento → Backend → Supabase**. O Backend consulta os dados meteorológicos no Supabase, envia as entradas validadas ao serviço `processamento` e grava a previsão no Supabase. O Frontend também lê dados do Supabase para os elementos de visualização existentes.

O PostgreSQL local é inicializado separadamente pelos scripts em `banco/init/` e serve para demonstrar schema, dados iniciais e persistência local. Na configuração atual, o fluxo da aplicação descrito acima usa o Supabase; o PostgreSQL local não substitui nem sincroniza automaticamente as tabelas do Supabase. Para a demonstração completa de consulta, inferência e histórico, configure o Supabase e os artefatos do modelo.

## Pré-requisitos

- Git e Docker com o plugin Docker Compose.
- Acesso ao projeto Supabase da equipe e suas tabelas/permissões.
- Artefatos de modelo compatíveis: `weather_ensemble.joblib` e `manifest.json`.
- Portas locais 5173, 8000 e 5432 disponíveis.

O arquivo do modelo não deve ser presumido como disponível no clone: a imagem de processamento o copia de `backend/src/models/` durante o build. Obtenha os dois artefatos da equipe responsável pelo modelo, confirme que pertencem à mesma versão e coloque-os nesse diretório antes de construir as imagens. Não versionar chaves secretas ou credenciais.

## Configuração e execução com Docker Compose

Clone e acesse a branch de entrega integrada:

```bash
git clone --branch entrega-integrada-processamento https://github.com/victorhukra/projeto-monitoramento-ambiental.git
cd projeto-monitoramento-ambiental
cp .env.example .env
```

No Windows PowerShell, use `Copy-Item .env.example .env` no lugar de `cp`.

Edite o `.env` da raiz e configure:

```dotenv
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_chave_secreta
VITE_SUPABASE_ANON_KEY=sua_chave_publica
```

O exemplo já contém `VITE_SUPABASE_URL`; confirme que corresponde ao projeto Supabase autorizado pela equipe. `SUPABASE_SERVICE_ROLE_KEY` é segredo, deve ser usado somente pelo Backend e nunca pode ser publicado, enviado ao Frontend ou commitado. A chave `VITE_SUPABASE_ANON_KEY` é pública e fica exposta no navegador; as leituras dependem das políticas RLS corretas. Não compartilhe o `.env` nem logs que revelem credenciais.

Construa e inicie os quatro serviços a partir da raiz:

```bash
docker compose up --build -d
docker compose ps
```

Verifique os logs e o estado da API:

```bash
docker compose logs --tail=100 banco processamento backend frontend
curl http://localhost:8000/health
```

Abra http://localhost:5173. O endpoint `/health` informa estado do Backend, modelo e configuração do banco; confirme que o modelo e as integrações estão prontos. A disponibilidade do processo/container, isoladamente, não comprova o fluxo funcional.

## Demonstração integrada

1. Abra a interface e confirme que os dados meteorológicos são exibidos.
2. Escolha uma data e horário disponíveis no histórico.
3. Consulte as entradas meteorológicas do horário escolhido.
4. Solicite a simulação de chuva para esse horário.
5. Confirme que a resposta apresenta a probabilidade/classe prevista e que a previsão aparece no histórico.
6. Consulte os logs dos serviços se algum passo falhar; não exiba credenciais na apresentação.

A simulação é histórica. O Backend exige dados válidos no instante `T` e, para a entrada temporal do modelo, pressão da hora anterior `T−1h`. A disponibilidade de horários depende dos dados configurados no Supabase e não significa que qualquer data futura possa ser selecionada.

### Rotas principais do Backend

| Método | Rota | Uso |
|---|---|---|
| `GET` | `/health` | Estado do Backend, modelo e configuração do banco. |
| `GET` | `/available-times` | Intervalo de datas disponível. |
| `GET` | `/available-times?date=AAAA-MM-DD` | Horários elegíveis em uma data. |
| `GET` | `/weather-inputs?reference_time=...` | Entradas meteorológicas disponíveis sem executar inferência. |
| `POST` | `/predict` | Executa a inferência integrada e persiste o resultado. |
| `GET` | `/predictions` | Consulta o histórico de previsões. |
| `DELETE` | `/predictions/<prediction_id>` | Remove uma previsão específica do histórico. |
| `POST` | `/internal/predict` | Inferência interna sem persistência; não é o fluxo normal da interface. |

O serviço de processamento expõe internamente `GET /health` e `POST /predict`. Ele é acessado pelo Backend por `http://processamento:8100`, usando o nome do serviço na rede Compose.

## Banco local, dados iniciais e persistência

O serviço `banco` usa PostgreSQL 15 e monta `banco/init/` em `/docker-entrypoint-initdb.d`. Na primeira inicialização de um volume vazio, os scripts em ordem de nome criam o schema e carregam dados de demonstração:

- `banco/init/01_schema.sql`: tabelas, índices, view `clima_atual` e permissões locais.
- `banco/init/02_dados.sql`: amostra inicial de medições e registros de exemplo. O script documenta 792 medições horárias.

A inicialização automática ocorre somente quando o diretório de dados está vazio. Para conferir as tabelas e a amostra local:

```bash
docker compose exec banco psql -U postgres -d projeto_integrador
```

No `psql`:

```sql
\dt
\dv
SELECT count(*) FROM dataset_weather_goes;
SELECT time, temperature_2m, relative_humidity_2m, precipitation
FROM dataset_weather_goes ORDER BY time DESC LIMIT 5;
```

Saia com `\q`. O volume nomeado `postgres_data` preserva os dados locais entre reinicializações. `docker compose down` remove os containers, mas mantém o volume; **`docker compose down -v` apaga o volume e os dados locais**. Os scripts de inicialização não são reaplicados em volume já existente.

A tabela meteorológica também é esperada no Supabase como `dataset_weather_goes`; a aplicação espera a tabela de previsões `resultados_previsoes_ia`. Os dados do PostgreSQL local não são sincronizados com o Supabase. Para requisitos e configuração do schema remoto, consulte o SQL e a migration documentados em `backend/sql/`.

## Modelo e processamento

O serviço `processamento` carrega `weather_ensemble.joblib` e `manifest.json` na inicialização. A validação verifica hash SHA-256, versão, features e entradas requeridas; inconsistências impedem a inicialização do serviço. As variáveis de caminho no Compose são:

- Processamento: `/app/models/weather_ensemble.joblib` e `/app/models/manifest.json`.
- Backend: `/app/src/models/weather_ensemble.joblib` e `/app/src/models/manifest.json`.

Os arquivos da imagem de processamento são copiados de `backend/src/models/`. Use o par de artefatos aprovado pela equipe e reconstrua as imagens depois de atualizá-los:

```bash
docker compose up --build -d
```

## Testes dos módulos

Os testes abaixo são locais e exigem as dependências dos módulos instaladas:

```bash
# Backend: a partir de backend/
python -m unittest discover -s tests -v

# Frontend: a partir de frontend/
npm ci
npm test
npm run lint
npm run build
```

Para a entrega integrada, além dos testes unitários, demonstre o fluxo real com os quatro serviços, Supabase e modelo configurados. Registre nos documentos individuais os comandos e resultados efetivamente observados; este README não declara testes como executados em uma máquina específica.

## Problemas comuns

| Sintoma | O que conferir |
|---|---|
| Compose não inicia | Docker ativo, portas 5173/8000/5432 livres e `.env` preenchido na raiz. |
| Build do processamento falha ao copiar o modelo | Presença e nomes dos dois arquivos em `backend/src/models/`; valide que são o par correto. |
| `model_loaded: false` ou serviço `processamento` não fica saudável | Compatibilidade entre artefato e manifesto; consulte `docker compose logs processamento backend`. |
| `/available-times` falha ou não retorna horários | URL/chave secreta do Supabase, tabela e permissões; consulte logs do Backend. |
| Interface não carrega dados | URL e chave pública do Supabase e políticas RLS; confira console do navegador. |
| Erro de CORS | Origem do Frontend deve corresponder a `FRONTEND_ORIGIN` configurada no Compose. |
| Inferência indica ausência de hora anterior | Confirme registro meteorológico válido exatamente em `T−1h`. |
| Dados locais desapareceram | Confirme que não foi usado `docker compose down -v`; confira o volume `postgres_data`. |

Para parar os serviços sem apagar o banco local:

```bash
docker compose down
```

## Estrutura relevante

```text
backend/       API Flask, configuração, testes e SQL de integração
banco/init/    schema e dados iniciais do PostgreSQL local
banco/doc/     documentação individual do módulo Banco
frontend/      aplicação React/Vite
processamento/ serviço Python de inferência e sua documentação
compose.yaml   orquestração dos quatro serviços
docs/          arquitetura, execução e documentos de integração/histórico
```

Cada módulo deve manter sua pasta `doc/` e um arquivo `.txt` individual para cada desenvolvedor que efetivamente contribuiu nele. `processamento/doc/INSTRUCOES.txt` é somente um modelo: não substitui os relatos individuais. Não invente nomes, tarefas, testes ou commits; registre contribuições reais em `frontend/doc/`, `backend/doc/`, `banco/doc/` e `processamento/doc/` conforme a participação de cada pessoa.

## Situação da entrega de 23/11/2026

A branch contém o Compose com os quatro serviços, scripts de criação e população do PostgreSQL local, volume persistente e integração entre Backend e serviço Python. A demonstração de ponta a ponta depende também da configuração e acesso ao Supabase e da disponibilidade do modelo compatível. Antes da apresentação, confirme em uma máquina limpa os comandos de instalação, os quatro serviços saudáveis, consulta de dados, processamento de uma amostra, gravação e visualização da previsão. O PostgreSQL local inicializado e o Supabase são fontes distintas nesta configuração; não apresente o primeiro como se estivesse alimentando automaticamente o fluxo da aplicação.

A versão integrada desta branch é a referência de código para a apresentação. Verifique o compartilhamento de acesso ao repositório com o professor e mantenha os arquivos individuais de contribuição atualizados.

## Documentação complementar

- [Arquitetura dos containers](docs/arquitetura-containers.md)
- [Execução com Docker Compose](docs/execucao-docker.md)
- [Comandos para demonstração do PostgreSQL](banco/COMANDOS_DOCKER_AVALIACAO.md)
- [Documentação do serviço de processamento](processamento/README.md)
