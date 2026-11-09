import unittest
from app.main import create_app
from app.settings import Settings


def row(stamp, **overrides):
    value = {'id': stamp, 'time': stamp, 'temperature_2m': 20, 'relative_humidity_2m': 70, 'pressure_msl': 1000, 'cloud_cover': 40}
    value.update(overrides)
    return value


class Repository:
    def __init__(self, rows): self.rows = rows
    def rows_at(self, timestamp): return [r for r in self.rows if r['time'].replace('T', ' ') == timestamp]
    def time_bounds(self): return (self.rows[0]['time'], self.rows[-1]['time']) if self.rows else (None, None)
    def rows_between(self, start, end):
        self.last_range = (start, end)
        return [r for r in self.rows if start <= r['time'].replace('T', ' ') < end]


class AvailabilityTests(unittest.TestCase):
    def client(self, rows):
        self.repo = Repository(rows)
        return create_app(settings=Settings(), repository=self.repo).test_client()

    def test_period_uses_first_and_last_record(self):
        response = self.client([row('2020-01-01T00:00:00'), row('2026-09-30T23:00:00')]).get('/available-times')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'min_date': '2020-01-01', 'max_date': '2026-09-30', 'timezone': 'America/Sao_Paulo'})

    def test_empty_table_returns_null_period(self):
        response = self.client([]).get('/available-times')
        self.assertEqual(response.json['min_date'], None)
        self.assertEqual(response.json['max_date'], None)

    def test_only_hours_with_valid_t_and_previous_hour(self):
        rows = [
            row('2026-08-31T23:00:00'),                       # T−1h da meia-noite
            row('2026-09-01T00:00:00'),                       # elegível (anterior no dia de antes)
            row('2026-09-01T01:00:00'),                       # elegível
            row('2026-09-01T03:00:00'),                       # sem 02:00 → não elegível
            row('2026-09-01T04:00:00', cloud_cover=None),     # medida nula → não elegível
            row('2026-09-01T05:00:00'),                       # anterior (04h) tem pressão válida → elegível
            row('2026-09-01T06:00:00'), row('2026-09-01T06:00:00'),  # duplicado → não elegível
        ]
        response = self.client(rows).get('/available-times?date=2026-09-01')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['times'], ['2026-09-01T00:00:00-03:00', '2026-09-01T01:00:00-03:00', '2026-09-01T05:00:00-03:00'])
        self.assertEqual(self.repo.last_range, ('2026-08-31 23:00:00', '2026-09-02 00:00:00'))

    def test_day_without_records_is_empty_list(self):
        response = self.client([]).get('/available-times?date=2026-09-01')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['times'], [])

    def test_invalid_date_is_422(self):
        response = self.client([]).get('/available-times?date=01/09/2026')
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json['error']['code'], 'INVALID_DATE')
