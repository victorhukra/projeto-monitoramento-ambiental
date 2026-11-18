"""Cria a aplicação Flask e configura suas dependências e tratamento de erros."""
import logging

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from .controllers import register_routes
from .errors import ServiceError
from .model_service import ModelLoadError, load_model
from .settings import Settings
from .weather_repository import WeatherRepository

logger = logging.getLogger(__name__)

HTTP_ERRORS = {400: ('BAD_REQUEST', 'Não foi possível entender o pedido.'), 405: ('METHOD_NOT_ALLOWED', 'Operação não permitida neste endereço.'), 413: ('PAYLOAD_TOO_LARGE', 'O pedido enviado é grande demais.')}

INTERNAL_ERROR = {'error': {'code': 'INTERNAL_ERROR', 'message': 'Ocorreu um erro inesperado. Tente novamente em alguns minutos.'}}


def create_app(settings=None, repository=None, model=None):
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
    settings = settings or Settings.from_env()
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024
    model_error = False
    if model is None and settings.model_path and settings.manifest_path:
        try:
            model = load_model(settings.model_path, settings.manifest_path)
        except ModelLoadError:
            model_error = True
            logger.exception('Falha ao carregar o modelo (MODEL_PATH=%s, MODEL_MANIFEST_PATH=%s)', settings.model_path, settings.manifest_path)
    elif model is None:
        logger.warning('Modelo não configurado: defina MODEL_PATH e MODEL_MANIFEST_PATH.')
    if repository is None and settings.supabase_url and settings.supabase_key:
        repository = WeatherRepository(settings.supabase_url, settings.supabase_key)
    app.extensions.update(weather_model=model, weather_repository=repository)

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

    @app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
    @app.route('/<path:path>', methods=['OPTIONS'])
    def preflight(path):
        return ('', 204)
    register_routes(app, repository, model, model_error)

    @app.errorhandler(ServiceError)
    def handle_service_error(error):
        if error.status >= 500:
            logger.warning('%s %s → %s %s: %s', request.method, request.path, error.status, error.code, error.message)
        body, status = error.response()
        return (jsonify(body), status)

    @app.errorhandler(404)
    def not_found(_):
        return (jsonify(error={'code': 'NOT_FOUND', 'message': 'Rota inexistente.'}), 404)

    @app.errorhandler(HTTPException)
    def handle_http_error(error):
        status = error.code or 500
        if status >= 500:
            logger.error('%s %s → erro HTTP %s', request.method, request.path, status)
        code, message = HTTP_ERRORS.get(status, ('HTTP_ERROR', 'Não foi possível concluir o pedido.'))
        return (jsonify(error={'code': code, 'message': message}), status)

    @app.errorhandler(Exception)
    def handle_unexpected(error):
        logger.exception('Erro inesperado em %s %s', request.method, request.path)
        return (jsonify(INTERNAL_ERROR), 500)
    return app


app = create_app()
