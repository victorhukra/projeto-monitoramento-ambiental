"""Lista os horários históricos que têm entradas válidas em T e T−1h."""

from collections import defaultdict
from datetime import date, datetime, timedelta
import math
from zoneinfo import ZoneInfo

from ..errors import ServiceError
from ..models.weather_repository import RepositoryUnavailable
from .weather_service import FIELDS


TIMEZONE = 'America/Sao_Paulo'
_LOCAL_TIMEZONE = ZoneInfo(TIMEZONE)


def _local_naive(value):
    """Converte o horário do banco para a hora local, sem informação de fuso."""
    moment = datetime.fromisoformat(str(value).replace(' ', 'T').replace('Z', '+00:00'))
    if moment.tzinfo is not None:
        moment = moment.astimezone(_LOCAL_TIMEZONE).replace(tzinfo=None)
    return moment


def _number(value):
    """Converte um valor em número finito; devolve None se for inválido."""
    if isinstance(value, bool) or value is None:
        return None

    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    return number if math.isfinite(number) else None


def _valid_t(row):
    """Verifica se T tem as quatro medidas necessárias em faixas aceitas."""
    values = {field: _number(row.get(field)) for field in FIELDS}
    if any(value is None for value in values.values()):
        return False

    humidity_is_valid = 0 <= values['relative_humidity_2m'] <= 100
    cloud_cover_is_valid = 0 <= values['cloud_cover'] <= 100
    pressure_is_valid = values['pressure_msl'] > 0
    return humidity_is_valid and cloud_cover_is_valid and pressure_is_valid


def _valid_previous(row):
    """Verifica se T−1h possui uma pressão positiva e válida."""
    pressure = _number(row.get('pressure_msl'))
    return pressure is not None and pressure > 0


def _db_text(moment):
    """Formata a hora local para consultar a coluna time do banco."""
    return moment.isoformat(sep=' ')


def _rows_for_day(repository, start):
    """Busca do banco as horas do dia e a hora anterior necessária ao primeiro T."""
    interval_start = _db_text(start - timedelta(hours=1))
    interval_end = _db_text(start + timedelta(days=1))

    try:
        return repository.rows_between(interval_start, interval_end)
    except RepositoryUnavailable:
        raise ServiceError(503, 'DATABASE_UNAVAILABLE', 'Não foi possível consultar os horários disponíveis.') from None


def _group_rows_by_time(rows):
    """Agrupa os registros por hora para identificar dados ausentes ou duplicados."""
    rows_by_time = defaultdict(list)

    for row in rows or []:
        try:
            moment = _local_naive(row['time'])
        except (KeyError, TypeError, ValueError):
            continue
        rows_by_time[moment].append(row)

    return rows_by_time


def _eligible_times(day_start, rows_by_time):
    """Retorna somente as horas com um registro válido em T e em T−1h."""
    eligible = []

    for hour in range(24):
        current_time = day_start + timedelta(hours=hour)
        previous_time = current_time - timedelta(hours=1)
        current_rows = rows_by_time.get(current_time, [])
        previous_rows = rows_by_time.get(previous_time, [])

        has_one_valid_record = (
            len(current_rows) == 1
            and len(previous_rows) == 1
            and _valid_t(current_rows[0])
            and _valid_previous(previous_rows[0])
        )
        if has_one_valid_record:
            eligible.append(current_time.replace(tzinfo=_LOCAL_TIMEZONE).isoformat())

    return eligible


def available_period(repository):
    """Retorna as datas mínima e máxima presentes na tabela meteorológica."""
    try:
        first, last = repository.time_bounds()
    except RepositoryUnavailable:
        raise ServiceError(503, 'DATABASE_UNAVAILABLE', 'Não foi possível consultar o período disponível.') from None

    minimum_date = _local_naive(first).date().isoformat() if first else None
    maximum_date = _local_naive(last).date().isoformat() if last else None

    return {
        'min_date': minimum_date,
        'max_date': maximum_date,
        'timezone': TIMEZONE,
    }


def available_times(repository, date_value):
    """Lista as horas elegíveis de uma data no formato AAAA-MM-DD."""
    try:
        day = date.fromisoformat(date_value or '')
    except ValueError:
        raise ServiceError(422, 'INVALID_DATE', 'Informe a data no formato AAAA-MM-DD.', 'date') from None

    day_start = datetime.combine(day, datetime.min.time())
    rows = _rows_for_day(repository, day_start)
    rows_by_time = _group_rows_by_time(rows)
    times = _eligible_times(day_start, rows_by_time)

    return {
        'date': day.isoformat(),
        'timezone': TIMEZONE,
        'times': times,
    }
