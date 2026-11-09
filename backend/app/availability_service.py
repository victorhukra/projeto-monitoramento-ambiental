"""Disponibilidade de horários para a simulação histórica (GET /available-times).

Um horário T é elegível quando há exatamente um registro em T com as quatro medidas válidas e exatamente
um registro em T−1h com pressão válida — as mesmas regras de get_weather_inputs. O backend valida de novo
em /weather-inputs e /predict; esta lista só orienta a tela.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta
import math
from zoneinfo import ZoneInfo

from .errors import ServiceError
from .weather_repository import RepositoryUnavailable
from .weather_service import FIELDS

TIMEZONE = 'America/Sao_Paulo'
_TZ = ZoneInfo(TIMEZONE)


def _local_naive(value):
    """Texto de horário do banco → datetime local sem fuso (a coluna guarda o horário de Londrina)."""
    moment = datetime.fromisoformat(str(value).replace(' ', 'T').replace('Z', '+00:00'))
    if moment.tzinfo is not None:
        moment = moment.astimezone(_TZ).replace(tzinfo=None)
    return moment


def _number(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _valid_t(row):
    values = {field: _number(row.get(field)) for field in FIELDS}
    if any(v is None for v in values.values()):
        return False
    return (0 <= values['relative_humidity_2m'] <= 100 and 0 <= values['cloud_cover'] <= 100
            and values['pressure_msl'] > 0)


def _valid_previous(row):
    pressure = _number(row.get('pressure_msl'))
    return pressure is not None and pressure > 0


def _db_text(moment):
    return moment.isoformat(sep=' ')


def available_period(repository):
    try:
        first, last = repository.time_bounds()
    except RepositoryUnavailable:
        raise ServiceError(503, 'DATABASE_UNAVAILABLE', 'Não foi possível consultar o período disponível.') from None
    to_date = lambda v: _local_naive(v).date().isoformat() if v else None
    return {'min_date': to_date(first), 'max_date': to_date(last), 'timezone': TIMEZONE}


def available_times(repository, date_value):
    try:
        day = date.fromisoformat(date_value or '')
    except ValueError:
        raise ServiceError(422, 'INVALID_DATE', 'Informe a data no formato AAAA-MM-DD.', 'date') from None
    start = datetime.combine(day, datetime.min.time())
    try:
        rows = repository.rows_between(_db_text(start - timedelta(hours=1)), _db_text(start + timedelta(days=1)))
    except RepositoryUnavailable:
        raise ServiceError(503, 'DATABASE_UNAVAILABLE', 'Não foi possível consultar os horários disponíveis.') from None
    by_time = defaultdict(list)
    for row in rows or []:
        try:
            by_time[_local_naive(row['time'])].append(row)
        except (KeyError, TypeError, ValueError):
            continue
    times = []
    for hour in range(24):
        moment = start + timedelta(hours=hour)
        current, previous = by_time.get(moment, []), by_time.get(moment - timedelta(hours=1), [])
        if len(current) == 1 and len(previous) == 1 and _valid_t(current[0]) and _valid_previous(previous[0]):
            times.append(moment.replace(tzinfo=_TZ).isoformat())
    return {'date': day.isoformat(), 'timezone': TIMEZONE, 'times': times}
