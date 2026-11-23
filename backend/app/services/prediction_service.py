"""Executa o modelo v6 com entradas meteorológicas históricas validadas."""

import json
import logging
import os
from urllib.error import URLError
from urllib.request import Request, urlopen

from ..errors import ServiceError

logger = logging.getLogger(__name__)


def _validate_result(model, inputs, result):
    """Confere se o resultado do modelo respeita o contrato esperado pela API."""
    probability = float(result['rain_probability'])
    threshold = float(result['decision_threshold'])

    if not 0 <= probability <= 1 or not 0 <= threshold <= 1:
        raise ValueError

    predicted = result['rain_predicted']
    if not isinstance(predicted, bool) or predicted != (probability >= threshold):
        raise ValueError

    if result['model_version'] != model.model_version:
        raise ValueError


def _predict_remotely(inputs):
    """Solicita a inferência ao container dedicado quando configurado pelo Compose."""
    base_url = os.getenv('PROCESSING_URL', '').rstrip('/')
    if not base_url:
        return None

    payload = json.dumps({
        'weather': inputs['weather'],
        'reference_time': inputs['reference_time'],
    }).encode('utf-8')
    request = Request(
        f'{base_url}/predict',
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urlopen(request, timeout=120) as response:
            return json.load(response)
    except (URLError, TimeoutError, ValueError) as error:
        logger.warning('Serviço de processamento indisponível: %s', error)
        raise ServiceError(503, 'PROCESSING_UNAVAILABLE', 'O serviço de processamento não está disponível.') from None


def predict(model, inputs):
    """Gera a previsão no serviço dedicado (Compose) ou localmente (execução de desenvolvimento)."""
    if model is None and not os.getenv('PROCESSING_URL'):
        raise ServiceError(503, 'MODEL_UNAVAILABLE', 'O modelo v6 não está disponível.')

    try:
        result = _predict_remotely(inputs)
        if result is None:
            result = model.predict_one(inputs['weather'], inputs['reference_time'])
        _validate_result(model, inputs, result)
    except ServiceError:
        raise
    except Exception:
        logger.exception(
            'O modelo não gerou uma resposta válida para reference_time=%s',
            inputs.get('reference_time'),
        )
        raise ServiceError(503, 'MODEL_PREDICTION_FAILED', 'O modelo não conseguiu gerar uma resposta válida.') from None

    return {**inputs, **result}
