# Monitoramento ambiental — Londrina

Aplicação web do projeto de monitoramento ambiental e **simulação histórica da probabilidade de chuva na próxima hora**, usando dados meteorológicos armazenados no Supabase e o modelo v6.

Este README descreve como configurar e executar a versão presente neste repositório. Os documentos em `docs/integration/` detalham os contratos entre as equipes; `docs/originals/` contém READMEs antigos apenas para consulta.

## 1. O que a aplicação contém

- **Frontend:** React 18 + Vite. Apresenta o painel meteorológico, consulta dados do Supabase e possui o fluxo de busca histórica e previsão experimental.
- **Backend:** Flask. Consulta os registros meteorológicos no Supabase, valida os dados de T e T−1h, executa o modelo v6 e grava/consulta as previsões.
- **Banco:** Supabase, acessado pelo Backend via REST para a inferência e pelo Frontend para as consultas de visualização já existentes.
- **Modelo:** pacote serializado `weather_ensemble.joblib` acompanhado de `manifest.json`. O modelo é carregado na inicialização do Backend, não treinado a cada previsão.

### Rotas do Backend implementadas

| Método | Rota | Função |
|---|---|---|
| `GET` | `/health` | Estado do Backend, modelo e banco |
| `GET` | `/available-times` | Primeiro e último dia disponível no dataset |
| `GET` | `/available-times?date=AAAA-MM-DD` | Horários elegíveis do dia |
| `GET` | `/weather-inputs?reference_time=...` | Medidas de T e pressão de T−1h, sem gerar previsão |
| `POST` | `/predict` | Executa o modelo e persiste a previsão |
| `GET` | `/predictions` | Consulta o histórico de previsões |
| `POST` | `/internal/predict` | Rota interna de inferência sem persistência; não é usada pelo fluxo normal do Frontend |

O fluxo principal da interface é:

1. Selecionar uma data e um horário disponibilizados pelo Backend.
2. Buscar e visualizar as medidas meteorológicas daquele instante.
3. Solicitar a previsão experimental.
4. O Backend consulta novamente os dados, executa o modelo v6 e grava o resultado.
5. O Frontend apresenta o resultado e atualiza o histórico.

A simulação é **histórica**: não representa uma previsão meteorológica ao vivo e não aceita qualquer data futura.

## 2. Requisitos

Instale:

- **Git**
- **Python 3.14** (versão usada na validação deste projeto)
- **Node.js e npm** compatíveis com o `frontend/package-lock.json` (validação realizada com Node 26.13.0 e npm 11.20.0)
- Acesso ao projeto Supabase utilizado pela equipe
- Os arquivos do modelo v6, quando for necessário gerar previsões reais

Os comandos abaixo usam PowerShell no Windows. No macOS/Linux, adapte a ativação do ambiente virtual e a cópia dos arquivos `.env`.

## 3. Baixar o projeto

```powershell
git clone https://github.com/victorhukra/projeto-monitoramento-ambiental.git
cd projeto-monitoramento-ambiental
```

O ZIP também pode ser extraído diretamente; nesse caso, entre na pasta `projeto-monitoramento-ambiental-main`.

## 4. Configurar e executar o Backend

Abra um terminal na raiz do projeto:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements-lock.txt
```

Crie o arquivo de configuração local a partir do exemplo:

```powershell
Copy-Item .env.example .env
```

Edite `backend/.env`:

```dotenv
# Caminhos absolutos para os dois artefatos do modelo v6
MODEL_PATH=C:/dados-monitoramento/model/weather_ensemble.joblib
MODEL_MANIFEST_PATH=C:/dados-monitoramento/model/manifest.json

# Credenciais do projeto Supabase usadas exclusivamente pelo Backend
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_chave_service_role

# Origem do Frontend permitida pelo CORS
FRONTEND_ORIGIN=http://localhost:5173
```

**Importante sobre a configuração:**

- O Backend carrega automaticamente as variáveis de `backend/.env` ao inicializar.
- `MODEL_PATH` e `MODEL_MANIFEST_PATH` devem apontar para os arquivos reais fornecidos pelo responsável pelo treinamento. O manifesto é validado junto com o hash SHA-256, versão, features e entradas esperadas.
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são necessários para as consultas e gravações do Backend. A chave `service_role` é secreta: nunca a coloque no Frontend, no Git ou em mensagens públicas.
- `FRONTEND_ORIGIN` deve corresponder exatamente à origem em que o Vite será executado. Se mudar a porta ou o host do Frontend, atualize essa variável e reinicie o Backend.
- Sem as credenciais do banco, o servidor pode iniciar, mas as rotas que consultam dados retornarão indisponibilidade.
- Sem o modelo e seu manifesto, o servidor pode iniciar, mas `/health` indicará que o modelo não foi carregado e `/predict` não conseguirá gerar uma previsão real.

Inicie o Backend, ainda dentro de `backend/`:

```powershell
python -m flask --app app.main run --host 127.0.0.1 --port 8000
```

Mantenha esse terminal aberto. Em outro terminal, teste:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

A resposta inclui `model_loaded`, `database_configured` e `integration_ready`. Para o fluxo real de previsão, os três componentes precisam estar configurados corretamente. `status: ok` sozinho significa apenas que o servidor respondeu.

### Testes do Backend

Com o ambiente virtual ativado e dentro de `backend/`:

```powershell
python -m unittest discover -s tests -v
```

## 5. Configurar e executar o Frontend

Abra outro terminal na raiz do projeto:

```powershell
cd frontend
npm ci
Copy-Item .env.example .env
```

Edite `frontend/.env`:

```dotenv
# Configuração do Supabase usada pelas consultas de visualização do Frontend
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua_chave_publica_anon_ou_publishable

# URL base do Backend Flask, sem barra no final
VITE_API_URL=http://127.0.0.1:8000
```

Observações:

- Use somente a chave pública `anon` ou `publishable` no Frontend. **Nunca use `service_role` ou `sb_secret` no navegador.**
- A leitura direta do Supabase pelo Frontend depende das políticas/permissões RLS configuradas no projeto.
- `VITE_API_URL` aponta para o Backend Flask. Se o Backend estiver em outro endereço, ajuste o valor.
- Variáveis `VITE_*` são incorporadas ao código do navegador. Não coloque segredos nelas.
- Sempre reinicie o Vite depois de alterar o `.env`.

Inicie o Frontend:

```powershell
npm run dev -- --host 127.0.0.1
```

Acesse:

- Aplicação: http://127.0.0.1:5173/
- Tela de integração: http://127.0.0.1:5173/integracao

Deixe os terminais do Backend e do Frontend abertos enquanto utiliza a aplicação.

### Testes e build do Frontend

Dentro de `frontend/`:

```powershell
npm test
npm run lint
npm run build
```

## 6. Banco de dados e modelo

### Supabase

O Backend acessa o Supabase pela API REST e espera encontrar:

- Tabela meteorológica `dataset_weather_goes`, com `id`, `time`, `temperature_2m`, `relative_humidity_2m`, `pressure_msl` e `cloud_cover`.
- Tabela de previsões `resultados_previsoes_ia`, com os campos utilizados para armazenar o resultado, incluindo `request_id`, `prediction_id`, `created_at`, os dados meteorológicos e os campos da previsão.

O horário armazenado na tabela meteorológica deve seguir a convenção adotada pela equipe para Londrina. O serviço interpreta os horários na zona `America/Sao_Paulo`.

A migration `backend/sql/20261108_secure_prediction_access.sql` ajusta a obrigatoriedade de `request_id` e as permissões da tabela de resultados para que o Backend use a função `service_role`. Ela **não cria as tabelas nem substitui a configuração inicial do banco**. A equipe responsável pelo Supabase deve revisar e aplicar essa migration no projeto correto, depois de confirmar os dados existentes e as permissões.

### Modelo v6

O modelo precisa ser entregue separadamente como:

- `weather_ensemble.joblib`
- `manifest.json`

Mantenha os arquivos fora do repositório, por exemplo em `C:/dados-monitoramento/model/`, e informe os caminhos absolutos em `backend/.env`. O Backend verifica o manifesto e carrega o modelo uma vez durante a inicialização.

O modelo utiliza quatro medidas em T — temperatura, umidade relativa, pressão e cobertura de nuvens — e a pressão de exatamente T−1h. O Backend calcula as features derivadas exigidas pela v6. Não é necessário enviar as sete features pelo Frontend e não ocorre treinamento a cada clique.

Sem os artefatos válidos do modelo, a aplicação pode abrir e o Backend pode responder ao health check, mas não deve ser considerada pronta para gerar previsões reais.

## 7. Contrato de geração e histórico

O Frontend envia para `POST /predict` somente:

```json
{
  "mode": "historical",
  "reference_time": "2026-09-01T14:00:00-03:00"
}
```

Também envia o cabeçalho `Idempotency-Key` com um UUID. A chave deve ser mantida ao tentar novamente o mesmo pedido após timeout ou falha de rede. Não gere outra chave para contornar um pedido de resultado incerto.

- `201`: previsão gravada pela primeira vez.
- `200`: pedido repetido com a mesma chave e os mesmos dados; o Backend devolve o resultado já gravado.
- `409`: conflito de idempotência ou pedido em processamento.
- `422`: chave, horário ou dados inválidos.
- `503`: banco, modelo ou gravação indisponível.

O histórico usa `GET /predictions` com `created_from`, `created_to`, `limit` e, quando necessário, `cursor`. O intervalo de datas considera o momento em que a previsão foi **gerada**, não o horário histórico escolhido como referência.

## 8. Documentação complementar

- [Alinhamento das três equipes](docs/integration/alinhamento_tres_equipes_integracao.md)
- [Demandas ao Frontend — busca histórica e previsão](docs/integration/demandas_frontend_busca_e_previsao.md)
- [Demandas ao Banco — busca histórica e previsão](docs/integration/demandas_banco_busca_e_previsao.md)
- [Continuidade, origem dos arquivos e pendências](docs/continuidade.md)
- [Histórico e referências do projeto](docs/historico/README.md)

Os documentos em `docs/originals/` e `docs/historico/` são materiais de referência e registro; não substituem as instruções de execução deste README.

## 9. Problemas comuns

| Problema | O que conferir |
|---|---|
| Frontend informa que o Backend não está configurado | `VITE_API_URL` no `frontend/.env`; reinicie o Vite |
| Erro de conexão com o Backend | Backend em execução, endereço/porta e `FRONTEND_ORIGIN` |
| Erro de CORS no navegador | `FRONTEND_ORIGIN` deve corresponder exatamente ao host e à porta do Frontend |
| `/health` mostra `database_configured: false` | `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` em `backend/.env` |
| `/health` mostra `model_loaded: false` | Caminhos, existência e compatibilidade do `.joblib` e do `manifest.json` |
| `/predict` retorna `MISSING_PREVIOUS_HOUR` | Não existe registro meteorológico válido exatamente uma hora antes de T |
| Não aparecem datas/horários | Verifique a tabela `dataset_weather_goes`, seus registros e os campos obrigatórios |
| Frontend não carrega dados do painel | `VITE_SUPABASE_URL`, chave pública e políticas RLS |
