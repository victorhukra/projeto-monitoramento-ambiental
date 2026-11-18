import unittest
from app.main import create_app
from app.settings import Settings

class EmptyRepository:
    def rows_at(self, timestamp):
        return []

class AppTests(unittest.TestCase):
    def setUp(self):
        self.client = create_app(settings=Settings(), repository=EmptyRepository()).test_client()

    def test_health_reports_component_states(self):
        response = self.client.get('/health')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json['integration_ready'])
        self.assertFalse(response.json['model_loaded'])
        self.assertTrue(response.json['database_configured'])

    def test_missing_reference_time_is_422(self):
        response = self.client.get('/weather-inputs')
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json['error']['code'], 'INVALID_REFERENCE_TIME')

    def test_missing_t_record_is_404(self):
        response = self.client.get('/weather-inputs?reference_time=2026-09-01T14:00:00-03:00')
        self.assertEqual(response.status_code, 404)

    def test_predict_requires_idempotency_key(self):
        response = self.client.post('/predict', json={})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json['error']['code'], 'INVALID_IDEMPOTENCY_KEY')

    def test_history_requires_valid_interval(self):
        response = self.client.get('/predictions')
        self.assertEqual(response.status_code, 422)

class PredictionReplayTests(unittest.TestCase):
    def test_replay_accepts_equivalent_time_and_hides_internal_fields(self):
        class Repository:
            def prediction_by_request_id(self, request_id):
                return [{'reference_time': '2026-09-01T17:00:00+00:00',
                         'mode': 'historical', 'source_record_id': 'private'}]

        client = create_app(settings=Settings(), repository=Repository()).test_client()
        headers = {'Idempotency-Key': '4f038c52-c898-4a6c-ad0d-79c7e17fbe17'}
        response = client.post('/predict', headers=headers, json={
            'mode': 'historical', 'reference_time': '2026-09-01T14:00:00-03:00',
        })
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('source_record_id', response.json)

        response = client.post('/predict', headers=headers, json={
            'mode': 'historical', 'reference_time': '2026-09-01T15:00:00-03:00',
        })
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json['error']['code'], 'IDEMPOTENCY_CONFLICT')
