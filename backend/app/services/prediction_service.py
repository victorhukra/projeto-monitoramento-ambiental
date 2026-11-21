"""Executa o modelo v6 com entradas meteorológicas históricas validadas."""

import logging

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


def predict(model, inputs):
    """Gera a previsão e combina as entradas usadas com o resultado do modelo."""
    if model is None:
        raise ServiceError(503, 'MODEL_UNAVAILABLE', 'O modelo v6 não está disponível.')

    try:
        result = model.predict_one(inputs['weather'], inputs['reference_time'])
        _validate_result(model, inputs, result)
    except Exception:
        logger.exception(
            'O modelo não gerou uma resposta válida para reference_time=%s',
            inputs.get('reference_time'),
        )
        raise ServiceError(503, 'MODEL_PREDICTION_FAILED', 'O modelo não conseguiu gerar uma resposta válida.') from None

    return {**inputs, **result}
