"""Valida a hora local solicitada e recupera os registros referentes a T e T-1h."""
import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ..errors import ServiceError
from ..models.weather_repository import RepositoryUnavailable

FIELDS = ('temperature_2m', 'relative_humidity_2m', 'pressure_msl', 'cloud_cover')


# Converte para o horário local e exige uma hora cheia com fuso informado.
def parse_reference_time(value):
    if not value:
        raise ServiceError(422, 'INVALID_REFERENCE_TIME', 'Informe o horário de referência.', 'reference_time')
    try:
        reference = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if reference.tzinfo is None:
            raise ValueError
        local = reference.astimezone(ZoneInfo('America/Sao_Paulo'))
    except (ValueError, OverflowError):
        raise ServiceError(422, 'INVALID_REFERENCE_TIME', 'O horário deve incluir fuso válido.', 'reference_time') from None
    if local.minute or local.second or local.microsecond:
        raise ServiceError(422, 'INVALID_REFERENCE_TIME', 'Selecione um horário em hora cheia.', 'reference_time')
    return local


def _database_time(local):
    return local.replace(tzinfo=None).isoformat(sep=' ')


# Mais de um registro para o mesmo horário tornaria a entrada ambígua.
def _single_row(repository, local):
    try:
        rows = repository.rows_at(_database_time(local))
    except RepositoryUnavailable:
        raise ServiceError(503, 'DATABASE_UNAVAILABLE', 'Não foi possível consultar os dados meteorológicos.') from None
    if len(rows) > 1:
        raise ServiceError(422, 'AMBIGUOUS_WEATHER_RECORD', 'Há mais de um registro para o horário solicitado.', 'reference_time')
    return rows[0] if rows else None


def get_weather_inputs(repository, reference_value):
    reference = parse_reference_time(reference_value)
    current = _single_row(repository, reference)
    if current is None:
        raise ServiceError(404, 'WEATHER_RECORD_NOT_FOUND', 'Não há registro meteorológico para esse horário.', 'reference_time')
    # O modelo usa a pressão da hora anterior para calcular a variação.
    previous = _single_row(repository, reference - timedelta(hours=1))
    if previous is None:
        raise ServiceError(422, 'MISSING_PREVIOUS_HOUR', 'Falta o registro meteorológico de exatamente T−1h.', 'reference_time')
    values = {field: current.get(field) for field in FIELDS}
    values['pressure_msl_previous_hour'] = previous.get('pressure_msl')
    # Converte as medidas para números e rejeita valores ausentes ou não finitos.
    try:
        for name, value in values.items():
            if isinstance(value, bool) or value is None:
                raise ValueError(name)
            values[name] = float(value)
            if not math.isfinite(values[name]):
                raise ValueError(name)
    except (TypeError, ValueError) as exc:
        field = str(exc) if str(exc) in values else 'weather'
        raise ServiceError(422, 'INVALID_WEATHER_INPUT', 'Há uma medida ausente ou inválida no horário selecionado.', field) from None
    outside_allowed_range = (
        not 0 <= values['relative_humidity_2m'] <= 100
        or not 0 <= values['cloud_cover'] <= 100
        or values['pressure_msl'] <= 0
        or values['pressure_msl_previous_hour'] <= 0
    )
    if outside_allowed_range:
        raise ServiceError(422, 'INVALID_WEATHER_INPUT', 'Uma medida está fora do intervalo permitido pelo contrato.', 'weather')
    return {'location': 'Londrina-PR', 'mode': 'historical',
            'reference_time': reference.isoformat(),
            'previous_reference_time': (reference-timedelta(hours=1)).isoformat(),
            'forecast_start': reference.isoformat(),
            'forecast_end': (reference+timedelta(hours=1)).isoformat(),
            'weather': values,
            'source_record_id': current.get('id'),
            'previous_source_record_id': previous.get('id')}
