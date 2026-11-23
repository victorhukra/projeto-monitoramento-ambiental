# Serviço de processamento Python

O módulo `processamento/` executa a inferência do modelo meteorológico v6 em um container próprio. O back-end continua responsável por validar a solicitação, consultar os dados de T e T−1h, chamar este serviço e persistir a resposta; o front-end não acessa o processamento diretamente.

## API interna

- `GET /health`: informa se o serviço iniciou e carregou o modelo.
- `POST /predict`: recebe `{ "weather": {...}, "reference_time": "..." }` e retorna probabilidade, classe prevista, limiar e versão do modelo.

A comunicação é pela rede interna do Compose usando o nome `processamento`. Não há porta publicada para o host.

## Execução e verificação

Na raiz do repositório, com as variáveis Supabase configuradas no `.env`:

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 processamento backend
curl http://localhost:8000/health
```

A primeira construção pode levar mais tempo porque instala as dependências do modelo e copia o artefato, que é grande. O health check do serviço confirma que a API está disponível; a rota `/health` do backend e uma previsão real devem ser verificadas também.

## Escopo

O container carrega `weather_ensemble.joblib` e `manifest.json`, confere hash, versão e contrato das features e calcula as previsões. O treinamento do modelo não é executado a cada requisição. O endpoint existente `/goes-image` ainda é servido pelo Backend nesta etapa; mover esse processamento de imagem para o container Python pode ser feito posteriormente sem alterar o fluxo da previsão tabular.

A pasta `doc/` contém instruções para que cada desenvolvedor registre sua própria contribuição. Não invente nomes ou atividades; crie um `.txt` individual para cada pessoa que trabalhou neste módulo.
