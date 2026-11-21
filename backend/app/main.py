"""Cria a aplicação Flask e configura suas dependências e tratamento de erros."""
import logging
from datetime import datetime

from flask import Flask, jsonify, request, send_file
from werkzeug.exceptions import HTTPException

from .controllers.routes import register_routes
from .errors import ServiceError
from .goes_service import get_goes_png, GoesImageError
from .services.model_service import ModelLoadError, load_model
from .settings import Settings
from .models.weather_repository import WeatherRepository

logger = logging.getLogger(__name__)

# Mensagens padronizadas para erros HTTP que podem ocorrer antes de uma rota ser executada.
HTTP_ERRORS = {400: ('BAD_REQUEST', 'Não foi possível entender o pedido.'), 405: ('METHOD_NOT_ALLOWED', 'Operação não permitida neste endereço.'), 413: ('PAYLOAD_TOO_LARGE', 'O pedido enviado é grande demais.')}

INTERNAL_ERROR = {'error': {'code': 'INTERNAL_ERROR', 'message': 'Ocorreu um erro inesperado. Tente novamente em alguns minutos.'}}


def create_app(settings=None, repository=None, model=None):
    """Monta a API; os parâmetros opcionais permitem usar dependências de teste."""
    # Configura os registros no terminal e lê o ambiente quando nenhuma configuração foi passada.
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
    settings = settings or Settings.from_env()
    app = Flask(__name__)
    # Limita o tamanho das requisições para evitar corpos maiores que o necessário.
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024
    model_error = False
    # Carrega o modelo uma vez na inicialização, quando seus arquivos foram configurados.
    if model is None and settings.model_path and settings.manifest_path:
        try:
            model = load_model(settings.model_path, settings.manifest_path)
        except ModelLoadError:
            # A API continua disponível para informar o erro na rota de saúde.
            model_error = True
            logger.exception('Falha ao carregar o modelo (MODEL_PATH=%s, MODEL_MANIFEST_PATH=%s)', settings.model_path, settings.manifest_path)
    elif model is None:
        logger.warning('Modelo não configurado: defina MODEL_PATH e MODEL_MANIFEST_PATH.')
    # Cria o acesso ao Supabase apenas quando endereço e chave estão disponíveis.
    if repository is None and settings.supabase_url and settings.supabase_key:
        repository = WeatherRepository(settings.supabase_url, settings.supabase_key)
    # Guarda as dependências na aplicação para que possam ser consultadas posteriormente.
    app.extensions.update(weather_model=model, weather_repository=repository)

    # Após cada resposta, permite acesso pelo navegador somente às origens configuradas.
    @app.after_request
    def cors(response):
        origin = request.headers.get('Origin')
        allowed_origins = {value.strip().rstrip('/') for value in settings.frontend_origin.split(',') if value.strip()}
        if origin and origin.rstrip('/') in allowed_origins:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Vary'] = 'Origin'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Idempotency-Key'
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
        return response

    # Responde à verificação OPTIONS que o navegador pode enviar antes da requisição real.
    @app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
    @app.route('/<path:path>', methods=['OPTIONS'])
    def preflight(path):
        return ('', 204)
    # Registra as rotas que recebem pedidos e coordenam os serviços.
    register_routes(app, repository, model, model_error)

    # Converte erros conhecidos dos serviços em respostas JSON com o status adequado.
    @app.errorhandler(ServiceError)
    def handle_service_error(error):
        if error.status >= 500:
            logger.warning('%s %s → %s %s: %s', request.method, request.path, error.status, error.code, error.message)
        body, status = error.response()
        return (jsonify(body), status)

    # Mantém uma resposta JSON clara quando o endereço solicitado não existe.
    @app.errorhandler(404)
    def not_found(_):
        return (jsonify(error={'code': 'NOT_FOUND', 'message': 'Rota inexistente.'}), 404)

    # Trata outros erros HTTP do Flask, como método não permitido ou corpo muito grande.
    @app.errorhandler(HTTPException)
    def handle_http_error(error):
        status = error.code or 500
        if status >= 500:
            logger.error('%s %s → erro HTTP %s', request.method, request.path, status)
        code, message = HTTP_ERRORS.get(status, ('HTTP_ERROR', 'Não foi possível concluir o pedido.'))
        return (jsonify(error={'code': code, 'message': message}), status)

    # Registra erros inesperados no servidor sem expor detalhes internos ao cliente.
    @app.errorhandler(Exception)
    def handle_unexpected(error):
        logger.exception('Erro inesperado em %s %s', request.method, request.path)
        return (jsonify(INTERNAL_ERROR), 500)

    @app.get('/goes-image')
    def goes_image():
        raw = request.args.get('reference_time', '')
        try:
            t = datetime.fromisoformat(raw)
            if t.tzinfo is None:
                raise ValueError
        except ValueError:
            return jsonify(error={
                'code': 'INVALID_REFERENCE_TIME',
                'message': 'reference_time inválido.'
            }), 422

        try:
            path = get_goes_png(t)
        except GoesImageError as e:
            return jsonify(error={
                'code': 'GOES_NOT_FOUND',
                'message': str(e)
            }), 404
        except Exception:
            logger.exception('Falha ao obter imagem GOES')
            return jsonify(error={
                'code': 'GOES_UNAVAILABLE',
                'message': 'Não foi possível obter a imagem GOES.'
            }), 503

        return send_file(path, mimetype='image/png', max_age=86400)

    return app

# Instância usada pelo servidor para iniciar a API.
app = create_app()