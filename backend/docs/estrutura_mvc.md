# Organização do backend

A API usa uma adaptação de MVC para respostas JSON; não há páginas HTML no backend.

- **`app/models/`**: acesso aos dados do Supabase. O modelo de aprendizado de máquina fica em `src/models/`.
- **`app/controllers/`**: rotas, validação das requisições HTTP e coordenação dos serviços.
- **`app/views/`**: campos públicos e cursores das respostas JSON.
- **`app/services/`**: regras de disponibilidade, dados meteorológicos, carregamento do modelo e previsão.
- **`app/main.py`**: criação da aplicação, dependências, CORS e tratamento de erros. `create_app` permite injetar repositório e modelo nos testes.
- **`app/settings.py` e `app/errors.py`**: configuração e erros compartilhados.

Na rota `/predict`, o controlador valida a requisição e a chave de idempotência. Os serviços buscam os dados históricos e executam o modelo; o repositório salva o resultado e a visão seleciona os campos públicos. Em uma gravação concorrente, a chave é consultada novamente para evitar duplicatas.

Para executar os testes a partir de `backend`, instale as dependências e rode `python -m unittest discover -s tests`.
