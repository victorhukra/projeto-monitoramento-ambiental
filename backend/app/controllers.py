"""Controladores HTTP para consultas meteorológicas e previsões."""
from datetime import datetime
from uuid import UUID

from flask import jsonify, request

from .availability_service import available_period, available_times
from .errors import ServiceError
from .prediction_service import predict
from .views import decode_cursor, encode_cursor, public_prediction, same_instant
from .weather_repository import DuplicateRequest, RepositoryUnavailable
from .weather_service import get_weather_inputs
from src.models.weather_ensemble import MODEL_VERSION


def register_routes(app, repository, model, model_error):
    """Registra os controladores HTTP; serviços e repositório executam as regras e o acesso aos dados."""

    def database():
        if repository is None:
            raise ServiceError(503, 'DATABASE_UNAVAILABLE', 'O banco não está configurado.')
        return repository

    def ensure_same_request(row, reference_time):
        # A mesma chave só pode representar a mesma previsão, inclusive em fuso diferente.
        if row.get('mode') != 'historical' or not same_instant(row.get('reference_time', ''), reference_time):
            raise ServiceError(409, 'IDEMPOTENCY_CONFLICT', 'A chave já foi usada com outros dados.')

    @app.get('/health')
    def health():
        return jsonify(status='ok', service='backend-londrina', model_loaded=bool(model), model_error=model_error, database_configured=bool(repository), integration_ready=bool(model and repository), model_version=model.model_version if model else MODEL_VERSION)

    @app.get('/available-times')
    def available():
        repo = database()
        day = request.args.get('date')
        return jsonify(available_times(repo, day) if day is not None else available_period(repo))

    @app.get('/weather-inputs')
    def weather_inputs():
        result = get_weather_inputs(database(), request.args.get('reference_time'))
        result.pop('source_record_id', None)
        result.pop('previous_source_record_id', None)
        return jsonify(result)

    @app.post('/internal/predict')
    def internal_predict():
        return jsonify(predict(model, get_weather_inputs(database(), request.args.get('reference_time'))))

    @app.post('/predict')
    def create_prediction():
        repo = database()
        try:
            request_id = str(UUID(request.headers.get('Idempotency-Key', '')))
        except (ValueError, AttributeError):
            raise ServiceError(422, 'INVALID_IDEMPOTENCY_KEY', 'Envie um UUID válido no cabeçalho Idempotency-Key.', 'Idempotency-Key') from None
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or set(body) != {'mode', 'reference_time'} or body.get('mode') != 'historical':
            raise ServiceError(422, 'INVALID_REQUEST', 'O corpo deve conter mode=historical e reference_time.')
        if not isinstance(body['reference_time'], str):
            raise ServiceError(422, 'INVALID_REFERENCE_TIME', 'Informe reference_time válido.', 'reference_time')
        try:
            existing = repo.prediction_by_request_id(request_id)
        except RepositoryUnavailable:
            raise ServiceError(503, 'DATABASE_UNAVAILABLE', 'Não foi possível consultar o pedido anterior.') from None
        if existing:
            row = existing[0]
            ensure_same_request(row, body['reference_time'])
            return (jsonify(public_prediction(row)), 200)
        result = predict(model, get_weather_inputs(repo, body['reference_time']))
        # Os identificadores de origem são gravados para rastreabilidade, mas não são públicos.
        payload = {
            'request_id': request_id,
            'location': result['location'],
            'reference_time': result['reference_time'],
            'previous_reference_time': result['previous_reference_time'],
            'forecast_start': result['forecast_start'],
            'forecast_end': result['forecast_end'],
            **result['weather'],
            'rain_probability': result['rain_probability'],
            'rain_predicted': result['rain_predicted'],
            'decision_threshold': result['decision_threshold'],
            'model_version': result['model_version'],
            'mode': 'historical',
            'is_mock': False,
            'input_source': 'dataset',
            'source_record_id': result.get('source_record_id'),
            'previous_source_record_id': result.get('previous_source_record_id'),
        }
        try:
            saved = repo.insert_prediction(payload)
        except DuplicateRequest:
            # Outra requisição pode ter gravado a mesma chave após a consulta inicial.
            try:
                rows = repo.prediction_by_request_id(request_id)
            except RepositoryUnavailable:
                raise ServiceError(503, 'DATABASE_UNAVAILABLE', 'Não foi possível recuperar o resultado já gravado.') from None
            if not rows:
                raise ServiceError(503, 'PREDICTION_WRITE_FAILED', 'Não foi possível confirmar a gravação concorrente.')
            saved = rows[0]
            ensure_same_request(saved, result['reference_time'])
            return (jsonify(public_prediction(saved)), 200)
        except RepositoryUnavailable:
            raise ServiceError(503, 'PREDICTION_WRITE_FAILED', 'Não foi possível salvar a previsão.') from None
        return (jsonify(public_prediction(saved)), 201)

    @app.get('/predictions')
    def predictions():
        repo = database()
        start = request.args.get('created_from')
        end = request.args.get('created_to')
        try:
            for value in (start, end):
                if not value or datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo is None:
                    raise ValueError
            limit = int(request.args.get('limit', '20'))
            if not 1 <= limit <= 100:
                raise ValueError
            cursor = decode_cursor(request.args['cursor']) if request.args.get('cursor') else None
        except (ValueError, TypeError):
            raise ServiceError(422, 'INVALID_HISTORY_FILTER', 'Use timestamps com fuso e limit entre 1 e 100.') from None
        try:
            rows = repo.history(start, end, limit, cursor)
        except RepositoryUnavailable:
            raise ServiceError(503, 'HISTORY_UNAVAILABLE', 'Não foi possível consultar o histórico.') from None
        # O repositório busca uma linha extra para indicar se há próxima página.
        more = len(rows) > limit
        items = rows[:limit]
        return jsonify(items=[public_prediction(row) for row in items], next_cursor=encode_cursor(items[-1]) if more and items else None)

    @app.delete('/predictions/<prediction_id>')
    def delete_prediction(prediction_id):
        try:
            prediction_id = str(UUID(prediction_id))
        except (ValueError, AttributeError):
            raise ServiceError(422, 'INVALID_PREDICTION_ID', 'Identificador de previsão inválido.', 'prediction_id') from None
        repo = database()
        try:
            deleted = repo.delete_prediction(prediction_id)
        except RepositoryUnavailable:
            raise ServiceError(503, 'DELETE_UNAVAILABLE', 'Não foi possível excluir a previsão.') from None
        if not deleted:
            raise ServiceError(404, 'PREDICTION_NOT_FOUND', 'Previsão não encontrada.')
        return ('', 204)
