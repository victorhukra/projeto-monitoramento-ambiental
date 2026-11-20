"""Apresentação das previsões e cursores usados pela API JSON."""
import base64
import json
from datetime import datetime
from uuid import UUID

from ..errors import ServiceError


def encode_cursor(row):
    """Identifica a última linha por data e ID para desempatar a paginação."""
    raw = json.dumps([row['created_at'], row['prediction_id']], separators=(',', ':')).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


# Recupera a posição da página e rejeita cursores malformados.
def decode_cursor(value):
    try:
        stamp, identifier = json.loads(base64.urlsafe_b64decode(value + '=' * (-len(value) % 4)))
        if datetime.fromisoformat(stamp.replace('Z', '+00:00')).tzinfo is None:
            raise ValueError
        UUID(identifier)
        return (stamp, identifier)
    except Exception:
        raise ServiceError(422, 'INVALID_CURSOR', 'Cursor de paginação inválido.', 'cursor') from None


# Compara instantes com fuso, mesmo quando escritos com offsets diferentes.
def same_instant(left, right):
    try:
        a = datetime.fromisoformat(left.replace('Z', '+00:00'))
        b = datetime.fromisoformat(right.replace('Z', '+00:00'))
        return a.tzinfo is not None and b.tzinfo is not None and (a == b)
    except (AttributeError, ValueError):
        return False


def public_prediction(row):
    """Expõe apenas os campos previstos no contrato público da API."""
    fields = (
        'prediction_id', 'request_id', 'created_at', 'location', 'mode', 'is_mock',
        'model_version', 'reference_time', 'previous_reference_time', 'forecast_start',
        'forecast_end', 'temperature_2m', 'relative_humidity_2m', 'pressure_msl',
        'cloud_cover', 'pressure_msl_previous_hour', 'rain_probability', 'rain_predicted',
        'decision_threshold', 'input_source',
    )
    return {field: row.get(field) for field in fields}
