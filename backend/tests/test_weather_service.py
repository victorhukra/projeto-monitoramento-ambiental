"""Testa a busca e validação dos registros de T e T−1h."""
import unittest
from datetime import datetime
from app.errors import ServiceError
from app.services.weather_service import get_weather_inputs

class Repository:
    def __init__(self, rows): self.rows = rows
    def rows_at(self, timestamp): return self.rows.get(timestamp, [])

def row(hour, **overrides):
    value = {'id': hour, 'time': f'2026-09-01 {hour}:00:00', 'temperature_2m': 20,
             'relative_humidity_2m': 70, 'pressure_msl': 1000, 'cloud_cover': 40}
    value.update(overrides); return value

class WeatherServiceTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository({'2026-09-01 14:00:00':[row('14')], '2026-09-01 13:00:00':[row('13')]})

    def test_returns_exact_t_and_previous_hour(self):
        result=get_weather_inputs(self.repo,'2026-09-01T14:00:00-03:00')
        self.assertEqual(result['weather']['pressure_msl_previous_hour'],1000)
        self.assertEqual(result['previous_reference_time'],'2026-09-01T13:00:00-03:00')

    def test_rejects_naive_time_and_non_hour(self):
        for value in ('2026-09-01T14:00:00','2026-09-01T14:30:00-03:00'):
            with self.assertRaises(ServiceError): get_weather_inputs(self.repo,value)

    def test_missing_t_is_404_and_previous_is_422(self):
        with self.assertRaisesRegex(ServiceError,'WEATHER_RECORD_NOT_FOUND'):
            get_weather_inputs(Repository({}),'2026-09-01T14:00:00-03:00')
        with self.assertRaisesRegex(ServiceError,'MISSING_PREVIOUS_HOUR'):
            get_weather_inputs(Repository({'2026-09-01 14:00:00':[row('14')]}),'2026-09-01T14:00:00-03:00')

    def test_rejects_duplicate_and_null_measurements(self):
        with self.assertRaisesRegex(ServiceError,'AMBIGUOUS_WEATHER_RECORD'):
            get_weather_inputs(Repository({'2026-09-01 14:00:00':[row('14'),row('14')]}),'2026-09-01T14:00:00-03:00')
        with self.assertRaisesRegex(ServiceError,'INVALID_WEATHER_INPUT'):
            get_weather_inputs(Repository({'2026-09-01 14:00:00':[row('14',cloud_cover=None)],'2026-09-01 13:00:00':[row('13')]}),'2026-09-01T14:00:00-03:00')
