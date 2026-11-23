# Arquitetura Docker para a versão integrada

O Compose define quatro serviços para atender à arquitetura de entrega:

| Serviço | Responsabilidade |
|---|---|
| `frontend` | Interface e visualização. |
| `backend` | API, validação dos pedidos, consultas meteorológicas e persistência das previsões. |
| `processamento` | Inferência com o modelo v6 e validação dos artefatos. |
| `banco` | PostgreSQL local com scripts de inicialização e volume persistente. |

O fluxo de previsão é: Front-end → Backend → Processamento → Backend → banco; a resposta volta ao Front-end para exibição. O Backend envia somente os dados tabulares validados, não credenciais do Supabase. O serviço de processamento fica na rede interna do Compose, acessível pelo hostname `processamento:8100` e sem porta publicada no host.

A comunicação é configurada em `compose.yaml` por `PROCESSING_URL`. Para execução local do Backend fora do Compose, essa variável pode ficar ausente; nesse modo o Backend mantém a inferência local para preservar o fluxo de desenvolvimento existente.

O artefato e o manifesto usados pela imagem de processamento são copiados de `backend/src/models/` durante o build. Confirme que ambos são a versão aprovada e correspondem ao hash do manifesto antes de construir as imagens. O processamento de imagem GOES permanece no endpoint atual do Backend nesta entrega; não é entrada do modelo de previsão tabular.

## Comandos de validação

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 processamento backend
curl http://localhost:8000/health
```

O health check do serviço `processamento` verifica se a API interna iniciou. Para validar o fluxo completo, consulte horários, solicite uma previsão pela interface e confirme que o resultado aparece no histórico. Não use `docker compose down -v` em dados que precisem ser preservados.
