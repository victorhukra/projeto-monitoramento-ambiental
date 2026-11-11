import base64
import json
import logging
from datetime import datetime
from uuid import UUID
from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException
from .errors import ServiceError
from .model_service import ModelLoadError, load_model
from .settings import Settings
from .weather_repository import WeatherRepository, RepositoryUnavailable, DuplicateRequest
from .weather_service import get_weather_inputs
from .prediction_service import predict
from .availability_service import available_period, available_times
from src.models.weather_ensemble import MODEL_VERSION

logger=logging.getLogger(__name__)
# Respostas de erro HTTP padronizadas (mesmo envelope dos ServiceError), sem detalhes internos.
HTTP_ERRORS={
    400:('BAD_REQUEST','Não foi possível entender o pedido.'),
    405:('METHOD_NOT_ALLOWED','Operação não permitida neste endereço.'),
    413:('PAYLOAD_TOO_LARGE','O pedido enviado é grande demais.'),
}
INTERNAL_ERROR={'error':{'code':'INTERNAL_ERROR','message':'Ocorreu um erro inesperado. Tente novamente em alguns minutos.'}}

def encode_cursor(row):
    raw=json.dumps([row['created_at'],row['prediction_id']],separators=(',',':')).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')
def decode_cursor(value):
    try:
        stamp,identifier=json.loads(base64.urlsafe_b64decode(value+'='*(-len(value)%4)))
        if datetime.fromisoformat(stamp.replace('Z','+00:00')).tzinfo is None: raise ValueError
        UUID(identifier)
        return stamp,identifier
    except Exception: raise ServiceError(422,'INVALID_CURSOR','Cursor de paginação inválido.','cursor') from None
def same_instant(left,right):
    try:
        a=datetime.fromisoformat(left.replace('Z','+00:00'));b=datetime.fromisoformat(right.replace('Z','+00:00'))
        return a.tzinfo is not None and b.tzinfo is not None and a == b
    except (AttributeError,ValueError): return False
def public_prediction(row):
    fields=('prediction_id','request_id','created_at','location','mode','is_mock','model_version','reference_time','previous_reference_time','forecast_start','forecast_end','temperature_2m','relative_humidity_2m','pressure_msl','cloud_cover','pressure_msl_previous_hour','rain_probability','rain_predicted','decision_threshold','input_source')
    return {field:row.get(field) for field in fields}
def create_app(settings=None,repository=None,model=None):
    # Sem configuração de log do servidor (ex.: flask run), usa a saída padrão com nível INFO.
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(name)s: %(message)s')
    settings=settings or Settings.from_env(); app=Flask(__name__); app.config['MAX_CONTENT_LENGTH']=16*1024
    model_error=False
    if model is None and settings.model_path and settings.manifest_path:
        try:model=load_model(settings.model_path,settings.manifest_path)
        except ModelLoadError:
            model_error=True
            logger.exception('Falha ao carregar o modelo (MODEL_PATH=%s, MODEL_MANIFEST_PATH=%s)',settings.model_path,settings.manifest_path)
    elif model is None:
        logger.warning('Modelo não configurado: defina MODEL_PATH e MODEL_MANIFEST_PATH.')
    if repository is None and settings.supabase_url and settings.supabase_key:
        repository=WeatherRepository(settings.supabase_url,settings.supabase_key)
    app.extensions.update(weather_model=model,weather_repository=repository)
    @app.after_request
    def cors(response):
        origin = request.headers.get('Origin')

        allowed_origins = {
            value.strip().rstrip('/')
            for value in settings.frontend_origin.split(',')
            if value.strip()
        }

        if origin and origin.rstrip('/') in allowed_origins:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Vary'] = 'Origin'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Idempotency-Key'
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'

        return response
    @app.route('/',defaults={'path':''},methods=['OPTIONS'])
    @app.route('/<path:path>',methods=['OPTIONS'])
    def preflight(path):return '',204
    def database():
        if repository is None:raise ServiceError(503,'DATABASE_UNAVAILABLE','O banco não está configurado.')
        return repository
    @app.get('/health')
    def health():return jsonify(status='ok',service='backend-londrina',model_loaded=bool(model),model_error=model_error,database_configured=bool(repository),integration_ready=bool(model and repository),model_version=model.model_version if model else MODEL_VERSION)
    @app.get('/available-times')
    def available():
        # Sem ?date: período com dados. Com ?date=AAAA-MM-DD: horários elegíveis (T e T−1h válidos) do dia.
        repo=database();day=request.args.get('date')
        return jsonify(available_times(repo,day) if day is not None else available_period(repo))
    @app.get('/weather-inputs')
    def weather_inputs():
        result=get_weather_inputs(database(),request.args.get('reference_time'));result.pop('source_record_id',None);result.pop('previous_source_record_id',None);return jsonify(result)
    @app.post('/internal/predict')
    def internal_predict():return jsonify(predict(model,get_weather_inputs(database(),request.args.get('reference_time'))))
    @app.post('/predict')
    def create_prediction():
        repo=database()
        try:request_id=str(UUID(request.headers.get('Idempotency-Key','')))
        except (ValueError,AttributeError):raise ServiceError(422,'INVALID_IDEMPOTENCY_KEY','Envie um UUID válido no cabeçalho Idempotency-Key.','Idempotency-Key') from None
        body=request.get_json(silent=True)
        if not isinstance(body,dict) or set(body)!={'mode','reference_time'} or body.get('mode')!='historical':raise ServiceError(422,'INVALID_REQUEST','O corpo deve conter mode=historical e reference_time.')
        if not isinstance(body['reference_time'],str):raise ServiceError(422,'INVALID_REFERENCE_TIME','Informe reference_time válido.','reference_time')
        try:existing=repo.prediction_by_request_id(request_id)
        except RepositoryUnavailable:raise ServiceError(503,'DATABASE_UNAVAILABLE','Não foi possível consultar o pedido anterior.') from None
        if existing:
            row=existing[0]
            if not same_instant(row.get('reference_time',''),body['reference_time']) or row.get('mode')!='historical':raise ServiceError(409,'IDEMPOTENCY_CONFLICT','A chave já foi usada com outros dados.')
            return jsonify(public_prediction(row)),200
        result=predict(model,get_weather_inputs(repo,body['reference_time']))
        payload={'request_id':request_id,'location':result['location'],'reference_time':result['reference_time'],'previous_reference_time':result['previous_reference_time'],'forecast_start':result['forecast_start'],'forecast_end':result['forecast_end'],**result['weather'],'rain_probability':result['rain_probability'],'rain_predicted':result['rain_predicted'],'decision_threshold':result['decision_threshold'],'model_version':result['model_version'],'mode':'historical','is_mock':False,'input_source':'dataset','source_record_id':result.get('source_record_id'),'previous_source_record_id':result.get('previous_source_record_id')}
        try:saved=repo.insert_prediction(payload)
        except DuplicateRequest:
            try:rows=repo.prediction_by_request_id(request_id)
            except RepositoryUnavailable:raise ServiceError(503,'DATABASE_UNAVAILABLE','Não foi possível recuperar o resultado já gravado.') from None
            if not rows:raise ServiceError(503,'PREDICTION_WRITE_FAILED','Não foi possível confirmar a gravação concorrente.')
            saved=rows[0]
            if not same_instant(saved.get('reference_time',''),result['reference_time']) or saved.get('mode')!='historical':raise ServiceError(409,'IDEMPOTENCY_CONFLICT','A chave já foi usada com outros dados.')
            return jsonify(public_prediction(saved)),200
        except RepositoryUnavailable:raise ServiceError(503,'PREDICTION_WRITE_FAILED','Não foi possível salvar a previsão.') from None
        return jsonify(public_prediction(saved)),201
    @app.get('/predictions')
    def predictions():
        repo=database();start=request.args.get('created_from');end=request.args.get('created_to')
        try:
            for value in (start,end):
                if not value or datetime.fromisoformat(value.replace('Z','+00:00')).tzinfo is None:raise ValueError
            limit=int(request.args.get('limit','20'))
            if not 1<=limit<=100:raise ValueError
            cursor=decode_cursor(request.args['cursor']) if request.args.get('cursor') else None
        except (ValueError,TypeError):raise ServiceError(422,'INVALID_HISTORY_FILTER','Use timestamps com fuso e limit entre 1 e 100.') from None
        try:rows=repo.history(start,end,limit,cursor)
        except RepositoryUnavailable:raise ServiceError(503,'HISTORY_UNAVAILABLE','Não foi possível consultar o histórico.') from None
        more=len(rows)>limit;items=rows[:limit]
        return jsonify(items=[public_prediction(row) for row in items],next_cursor=encode_cursor(items[-1]) if more and items else None)
    @app.delete('/predictions/<prediction_id>')
    def delete_prediction(prediction_id):
        try: prediction_id=str(UUID(prediction_id))
        except (ValueError,AttributeError): raise ServiceError(422,'INVALID_PREDICTION_ID','Identificador de previsão inválido.','prediction_id') from None
        repo=database()
        try: deleted=repo.delete_prediction(prediction_id)
        except RepositoryUnavailable: raise ServiceError(503,'DELETE_UNAVAILABLE','Não foi possível excluir a previsão.') from None
        if not deleted: raise ServiceError(404,'PREDICTION_NOT_FOUND','Previsão não encontrada.')
        return '',204
    @app.errorhandler(ServiceError)
    def handle_service_error(error):
        if error.status>=500:logger.warning('%s %s → %s %s: %s',request.method,request.path,error.status,error.code,error.message)
        body,status=error.response();return jsonify(body),status
    @app.errorhandler(404)
    def not_found(_):return jsonify(error={'code':'NOT_FOUND','message':'Rota inexistente.'}),404
    @app.errorhandler(HTTPException)
    def handle_http_error(error):
        # Demais erros HTTP do Flask/Werkzeug (405, 400, 413…): mesmo status, corpo JSON no envelope padrão.
        status=error.code or 500
        if status>=500:logger.error('%s %s → erro HTTP %s',request.method,request.path,status)
        code,message=HTTP_ERRORS.get(status,('HTTP_ERROR','Não foi possível concluir o pedido.'))
        return jsonify(error={'code':code,'message':message}),status
    @app.errorhandler(Exception)
    def handle_unexpected(error):
        # Exceção não prevista: stack trace só no log; a resposta não traz detalhes internos.
        logger.exception('Erro inesperado em %s %s',request.method,request.path)
        return jsonify(INTERNAL_ERROR),500
    return app
app=create_app()
