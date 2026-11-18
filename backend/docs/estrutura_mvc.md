# Organização do backend

A API usa uma adaptação de MVC para respostas JSON: não há páginas HTML no backend.

- **Modelos e dados:** `weather_repository.py` acessa o Supabase; `src/models/` contém o modelo de aprendizado de máquina. Os serviços `weather_service.py`, `availability_service.py` e `prediction_service.py` concentram as regras de dados, disponibilidade e previsão.
- **Controladores:** `app/controllers.py` registra as rotas, valida as informações HTTP e coordena os serviços e o repositório.
- **Visões:** `app/views.py` define a apresentação pública de previsões e a codificação dos cursores; as respostas são serializadas em JSON pelo Flask.
- **Inicialização:** `app/main.py` cria a aplicação, configura dependências, CORS e tratamento de erros. A função `create_app` também permite injetar repositório e modelo nos testes.

Fluxo de uma previsão: a rota `/predict` valida a requisição e a chave de idempotência, busca os dados históricos pelo serviço meteorológico, executa o modelo pelo serviço de previsão, salva o resultado no repositório e devolve apenas os campos públicos definidos na visão. Em uma gravação concorrente, a chave é consultada novamente para evitar duplicatas.

Para executar os testes a partir da pasta `backend`, instale as dependências e rode `python -m unittest discover -s tests`.
