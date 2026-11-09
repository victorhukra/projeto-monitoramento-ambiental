"""Respostas de erro padronizadas e registro dos detalhes técnicos no log."""
import io
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from app.errors import ServiceError
from app.main import create_app
from app.prediction_service import predict
from app.settings import Settings
from app.weather_repository import RepositoryUnavailable, WeatherRepository


class ExplodingRepository:
    """Simula um defeito não previsto (não é um ServiceError nem uma falha conhecida do banco)."""
    def time_bounds(self):
        raise RuntimeError('detalhe interno: senha=123 em /srv/app')


class BrokenModel:
    model_version = 'x'
    def predict_one(self, weather, reference_time):
        raise ZeroDivisionError('falha interna do modelo')


def client(repository=None):
    return create_app(settings=Settings(), repository=repository).test_client()


class HttpErrorTests(unittest.TestCase):
    def test_unexpected_exception_is_json_500_without_internal_details(self):
        with self.assertLogs('app.main', level='ERROR') as logs:
            response = client(ExplodingRepository()).get('/available-times')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json['error']['code'], 'INTERNAL_ERROR')
        self.assertNotIn('senha', response.get_data(as_text=True))
        self.assertNotIn('Traceback', response.get_data(as_text=True))
        # o detalhe técnico fica no log, com o stack trace
        self.assertIn('RuntimeError', '\n'.join(logs.output))

    def test_method_not_allowed_is_json_405(self):
        response = client().get('/predict')
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response.json['error']['code'], 'METHOD_NOT_ALLOWED')

    def test_unknown_route_answers_json(self):
        # A rota curinga de OPTIONS (preflight CORS) faz o Flask responder 405 a caminhos desconhecidos.
        # Comportamento anterior mantido; o que muda é o corpo, agora JSON no envelope padrão em vez de HTML.
        response = client().get('/nao-existe')
        self.assertIn(response.status_code, (404, 405))
        self.assertIn(response.json['error']['code'], ('NOT_FOUND', 'METHOD_NOT_ALLOWED'))

    def test_service_errors_keep_status_and_code(self):
        response = client().get('/available-times')  # sem repositório configurado
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json['error']['code'], 'DATABASE_UNAVAILABLE')

    def test_model_failure_is_logged_and_returns_503(self):
        with self.assertLogs('app.prediction_service', level='ERROR') as logs:
            with self.assertRaisesRegex(ServiceError, 'MODEL_PREDICTION_FAILED'):
                predict(BrokenModel(), {'weather': {}, 'reference_time': '2026-09-01T14:00:00-03:00'})
        self.assertIn('ZeroDivisionError', '\n'.join(logs.output))

    def test_model_load_failure_is_logged(self):
        from pathlib import Path
        settings = Settings(model_path=Path('nao-existe.joblib'), manifest_path=Path('nao-existe.json'))
        with self.assertLogs('app.main', level='ERROR') as logs:
            app = create_app(settings=settings)
        self.assertTrue(app.test_client().get('/health').json['model_error'])
        self.assertIn('Falha ao carregar o modelo', '\n'.join(logs.output))


class RepositoryLoggingTests(unittest.TestCase):
    def setUp(self):
        self.repo = WeatherRepository('https://exemplo.supabase.co', 'chave-secreta')

    def test_connection_failure_is_logged_without_credentials(self):
        with patch('app.weather_repository.urlopen', side_effect=URLError('timed out')):
            with self.assertLogs('app.weather_repository', level='ERROR') as logs:
                with self.assertRaises(RepositoryUnavailable):
                    self.repo.time_bounds()
        output = '\n'.join(logs.output)
        self.assertIn('timed out', output)
        self.assertNotIn('chave-secreta', output)

    def test_http_error_logs_status_and_postgrest_code(self):
        body = io.BytesIO(b'{"code":"42501","message":"permission denied for table dataset_weather_goes"}')
        error = HTTPError('https://exemplo.supabase.co/rest/v1/x', 401, 'Unauthorized', {}, body)
        with patch('app.weather_repository.urlopen', side_effect=error):
            with self.assertLogs('app.weather_repository', level='ERROR') as logs:
                with self.assertRaises(RepositoryUnavailable):
                    self.repo.rows_at('2026-09-01 14:00:00')
        output = '\n'.join(logs.output)
        self.assertIn('401', output)
        self.assertIn('42501', output)
        self.assertNotIn('chave-secreta', output)


if __name__ == '__main__':
    unittest.main()
