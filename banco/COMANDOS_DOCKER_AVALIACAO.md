# 🐳 Roteiro Prático de Docker & PostgreSQL (Avaliação Individual)

**Projeto Integrador — UTFPR (Câmpus Londrina)**  
**Objetivo:** Guia exato passo a passo para cada integrante da equipe de Banco de Dados (**Gustavo, Verônica, Samuel e Luna**) subir o banco do zero, demonstrar tabelas/views/consultas no terminal, sair e dropar tudo para o próximo colega ser avaliado.

---

## 📋 Passo 0: Preparação Inicial (só na 1ª vez na máquina)
Abra o terminal (PowerShell ou Bash) dentro da pasta raiz do projeto e crie o arquivo `.env` a partir do exemplo:
```powershell
# No Windows (PowerShell):
Copy-Item .env.example .env

# No Linux / Mac / Git Bash:
cp .env.example .env
```

---

## 🚀 Passo 1: Subir o Banco de Dados com Docker
Execute o comando abaixo para iniciar o container do PostgreSQL 15 em segundo plano (`-d`):
```bash
docker compose up -d banco
```
Confira se o container ficou saudável (`healthy`):
```bash
docker compose ps
```
> **Dica para mostrar ao professor:** Se quiser provar que o banco criou as tabelas e populou os dados automaticamente pela pasta `banco/init/`, rode:
> ```bash
> docker compose logs banco
> ```

---

## 💻 Passo 2: Entrar no Banco (`psql` dentro do container)
Para abrir o terminal interativo do PostgreSQL direto dentro do container:
```bash
docker compose exec banco psql -U postgres -d projeto_integrador
```
*(O prompt vai mudar para `projeto_integrador=#` indicando que você está dentro do banco!).*

---

## 🔍 Passo 3: Mostrar o Banco & Fazer `SELECT` (Para o Professor Ver)
Comandos essenciais dentro do `projeto_integrador=#`:

**1. Listar todas as tabelas criadas:**
```sql
\dt
```

**2. Listar as Views criadas:**
```sql
\dv
```

**3. Ver a estrutura/colunas da tabela de previsões (ou do dataset):**
```sql
\d resultados_previsoes_ia
```

**4. Provar que o banco já subiu populado automaticamente com dados reais de Londrina:**
```sql
SELECT count(*) AS total_registros FROM dataset_weather_goes;
```
*(No ambiente Docker padrão, inicia com **792 registros** reais cobrindo todo Setembro/2026 + datas de teste, respeitando o limite de 1 MB do Git. No Supabase Cloud constam as 59.160 horas completas).*

**5. Fazer `SELECT` enxuto nas tabelas (cabe perfeitamente na tela do terminal sem quebrar linha!):**
```sql
-- Mostrar 5 registros da série meteorológica (dataset_weather_goes):
SELECT time, temperature_2m, relative_humidity_2m, precipitation 
FROM dataset_weather_goes 
ORDER BY time DESC 
LIMIT 5;

-- Mostrar as previsões salvas na tabela da IA (resultados_previsoes_ia):
SELECT reference_time, temperature_2m, rain_probability, rain_predicted 
FROM resultados_previsoes_ia;

-- Mostrar a View oficial (clima_atual):
SELECT * FROM clima_atual;
```
> **Dica de Ouro do `psql`:** Se em algum momento você fizer um `SELECT *` em uma tabela com muitas colunas e a tabela ficar "quebrada/torta" no terminal, basta digitar **`\x`** e apertar Enter! O `\x` ativa o *Modo Cartão Vertical* (mostra uma coluna embaixo da outra, super organizado). Digite `\x` de novo para voltar ao normal.

**6. Mostrar a junção temporal que alimenta a IA (Horário T e T-1h com `EXPLAIN ANALYZE`):**
```sql
SELECT 
    t.time, 
    t.temperature_2m, 
    t.pressure_msl, 
    t_prev.pressure_msl AS pressao_hora_anterior
FROM dataset_weather_goes t
JOIN dataset_weather_goes t_prev ON t_prev.time = t.time - INTERVAL '1 hour'
WHERE t.time = '2026-09-30 13:00:00';
```

---

## 🚪 Passo 4: Sair do Banco (`psql`)
Para sair do terminal do PostgreSQL e voltar para o seu terminal normal:
```sql
\q
```
*(Pressione Enter).*

---

## 💾 Passo 5 (Opcional): Provar Persistência (Parar sem apagar os dados)
Se o professor perguntar *"E se o container cair ou reiniciar, perde os dados?"*:
```bash
# Para e remove o container, MAS MANTÉM o volume 'postgres_data':
docker compose down

# Sobe novamente:
docker compose up -d banco
```
*(Ao entrar no `psql` de novo, todas as tabelas e eventuais registros inseridos continuam salvos!).*

---

## 💣 Passo 6: DROPAR / TIRAR TUDO (Para o Próximo Colega Testar!)
Quando você terminar a sua avaliação individual e for passar a vez para o próximo integrante (ex: Gustavo termina e passa para o Samuel), rode este comando **com o `-v`** (`--volumes`):
```bash
docker compose down -v
```
> **O que o `-v` faz?**
> * Derruba o container do banco;
> * **Apaga permanentemente o volume `postgres_data`** (zera 100% o disco do banco).
> * Assim, quando o próximo colega rodar `docker compose up -d banco`, o Docker detectará que o banco está vazio e **executará os scripts da pasta `banco/init/` tudo de novo do zero**!
