"""Consulta e valida as medidas meteorológicas de T e T−1h."""

import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ..errors import ServiceError
from ..models.weather_repository import RepositoryUnavailable


TIMEZONE = 'America/Sao_Paulo'
FIELDS = ('temperature_2m', 'relative_humidity_2m', 'pressure_msl', 'cloud_cover')
_LOCAL_TIMEZONE = ZoneInfo(TIMEZONE)


def parse_reference_time(value):
    """Converte o horário recebido para Londrina e exige hora cheia com fuso."""
    if not value:
        raise ServiceError(422, 'INVALID_REFERENCE_TIME', 'Informe o horário de referência.', 'reference_time')

    try:
        reference = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if reference.tzinfo is None:
            raise ValueError
        local_time = reference.astimezone(_LOCAL_TIMEZONE)
    except (ValueError, OverflowError):
        raise ServiceError(422, 'INVALID_REFERENCE_TIME', 'O horário deve incluir fuso válido.', 'reference_time') from None

    if local_time.minute or local_time.second or local_time.microsecond:
        raise ServiceError(422, 'INVALID_REFERENCE_TIME', 'Selecione um horário em hora cheia.', 'reference_time')

    return local_time


def _database_time(local_time):
    """Formata a hora local sem fuso, conforme está armazenada no banco."""
    return local_time.replace(tzinfo=None).isoformat(sep=' ')


def _single_row(repository, local_time):
    """Busca um registro no horário indicado e rejeita resultados ambíguos."""
    try:
        rows = repository.rows_at(_database_time(local_time))
    except RepositoryUnavailable:
        raise ServiceError(503, 'DATABASE_UNAVAILABLE', 'Não foi possível consultar os dados meteorológicos.') from None

    if len(rows) > 1:
        raise ServiceError(422, 'AMBIGUOUS_WEATHER_RECORD', 'Há mais de um registro para o horário solicitado.', 'reference_time')

    return rows[0] if rows else None


def _validated_weather_values(current, previous):
    """Monta as cinco medidas usadas pelo modelo e valida seus valores."""
    values = {field: current.get(field) for field in FIELDS}
    values['pressure_msl_previous_hour'] = previous.get('pressure_msl')

    try:
        for field, value in values.items():
            if isinstance(value, bool) or value is None:
                raise ValueError(field)

            numeric_value = float(value)
            if not math.isfinite(numeric_value):
                raise ValueError(field)
            values[field] = numeric_value
    except (TypeError, ValueError) as error:
        field = str(error) if str(error) in values else 'weather'
        raise ServiceError(422, 'INVALID_WEATHER_INPUT', 'Há uma medida ausente ou inválida no horário selecionado.', field) from None

    humidity_is_valid = 0 <= values['relative_humidity_2m'] <= 100
    cloud_cover_is_valid = 0 <= values['cloud_cover'] <= 100
    pressure_is_valid = (
        values['pressure_msl'] > 0
        and values['pressure_msl_previous_hour'] > 0
    )

    if not (humidity_is_valid and cloud_cover_is_valid and pressure_is_valid):
        raise ServiceError(422, 'INVALID_WEATHER_INPUT', 'Uma medida está fora do intervalo permitido pelo contrato.', 'weather')

    return values


def get_weather_inputs(repository, reference_value):
    """Busca T e exatamente T−1h e devolve as entradas validadas para a previsão."""
    reference_time = parse_reference_time(reference_value)
    previous_time = reference_time - timedelta(hours=1)

    current = _single_row(repository, reference_time)
    if current is None:
        raise ServiceError(404, 'WEATHER_RECORD_NOT_FOUND', 'Não há registro meteorológico para esse horário.', 'reference_time')

    previous = _single_row(repository, previous_time)
    if previous is None:
        raise ServiceError(422, 'MISSING_PREVIOUS_HOUR', 'Falta o registro meteorológico de exatamente T−1h.', 'reference_time')

    weather_values = _validated_weather_values(current, previous)

    return {
        'location': 'Londrina-PR',
        'mode': 'historical',
        'reference_time': reference_time.isoformat(),
        'previous_reference_time': previous_time.isoformat(),
        'forecast_start': reference_time.isoformat(),
        'forecast_end': (reference_time + timedelta(hours=1)).isoformat(),
        'weather': weather_values,
        'source_record_id': current.get('id'),
        'previous_source_record_id': previous.get('id'),
    }
