"""Acesso ao Supabase por meio da API REST."""

import json
import logging
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


logger = logging.getLogger(__name__)
_MAX_DETAIL = 500


class RepositoryUnavailable(RuntimeError):
    """Indica que o Supabase não respondeu de forma utilizável."""


class DuplicateRequest(RuntimeError):
    """Indica que o request_id já existe no banco."""


class WeatherRepository:
    """Centraliza as consultas e gravações feitas pelo Backend no Supabase."""

    WEATHER_TABLE = 'dataset_weather_goes'
    PREDICTIONS_TABLE = 'resultados_previsoes_ia'

    def __init__(self, base_url, api_key, timeout=8):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.timeout = timeout

    def _request_headers(self, payload, prefer):
        """Monta os cabeçalhos HTTP sem expor a chave nos logs."""
        headers = {
            'apikey': self.api_key,
            'Authorization': f'Bearer {self.api_key}',
            'Accept': 'application/json',
        }

        if payload is not None:
            headers['Content-Type'] = 'application/json'
        if prefer:
            headers['Prefer'] = prefer

        return headers

    def _request(self, table, query, method='GET', payload=None, prefer=None):
        """Executa uma requisição REST e converte falhas em exceções do repositório."""
        # Monta uma chamada PostgREST; a chave segue apenas nos cabeçalhos.
        url = f'{self.base_url}/rest/v1/{table}?{urlencode(query)}'
        body = json.dumps(payload).encode() if payload is not None else None

        request = Request(
            url,
            headers=self._request_headers(payload, prefer),
            data=body,
            method=method,
        )

        try:
            with urlopen(request, timeout=self.timeout) as response:
                if response.status == 204:
                    return None
                return json.load(response)

        except HTTPError as error:
            response_body = error.read().decode(errors='replace')
            error_code = self._error_code(response_body)

            # A restrição única permite reconhecer pedidos concorrentes duplicados.
            if error.code == 409 and error_code == '23505':
                raise DuplicateRequest from None

            logger.error(
                'Supabase respondeu com erro: tabela=%s método=%s status=%s '
                'código=%s corpo=%s',
                table, method, error.code, error_code,
                response_body[:_MAX_DETAIL],
            )
            raise RepositoryUnavailable from None

        except (URLError, TimeoutError) as error:
            logger.error(
                'Falha de comunicação com o Supabase: tabela=%s método=%s erro=%r',
                table, method, getattr(error, 'reason', error),
            )
            raise RepositoryUnavailable from None

        except ValueError as error:
            logger.error(
                'Resposta do Supabase não é JSON válido: tabela=%s método=%s erro=%s',
                table, method, error,
            )
            raise RepositoryUnavailable from None

    @staticmethod
    def _error_code(response_body):
        """Extrai o código do erro JSON retornado pelo PostgREST."""
        try:
            return json.loads(response_body).get('code')
        except (ValueError, AttributeError):
            return None

    def rows_at(self, timestamp):
        """Busca até dois registros meteorológicos para um horário exato."""
        query = {
            'select': (
                'id,time,temperature_2m,relative_humidity_2m,'
                'pressure_msl,cloud_cover'
            ),
            'time': f'eq.{timestamp}',
            'limit': '2',
        }
        return self._request(self.WEATHER_TABLE, query)

    def time_bounds(self):
        """Retorna o primeiro e o último horário meteorológico disponível."""
        first = self._request(
            self.WEATHER_TABLE,
            {'select': 'time', 'order': 'time.asc', 'limit': '1'},
        )
        last = self._request(
            self.WEATHER_TABLE,
            {'select': 'time', 'order': 'time.desc', 'limit': '1'},
        )
        first_time = first[0]['time'] if first else None
        last_time = last[0]['time'] if last else None
        return first_time, last_time

    def rows_between(self, start, end):
        """Busca registros em um intervalo: start <= time < end."""
        query = {
            'select': (
                'id,time,temperature_2m,relative_humidity_2m,'
                'pressure_msl,cloud_cover'
            ),
            'and': f'(time.gte.{start},time.lt.{end})',
            'order': 'time.asc',
            'limit': '200',
        }
        return self._request(self.WEATHER_TABLE, query)

    def prediction_by_request_id(self, request_id):
        """Procura uma previsão já gravada para uma chave de idempotência."""
        query = {
            'select': '*',
            'request_id': f'eq.{request_id}',
            'limit': '2',
        }
        return self._request(self.PREDICTIONS_TABLE, query)

    def insert_prediction(self, payload):
        """Grava uma previsão e retorna exatamente a linha criada."""
        rows = self._request(
            self.PREDICTIONS_TABLE,
            {'select': '*'},
            method='POST',
            payload=payload,
            prefer='return=representation',
        )

        if not isinstance(rows, list) or len(rows) != 1:
            row_count = len(rows) if isinstance(rows, list) else type(rows).__name__
            logger.error(
                'Gravação da previsão sem a linha esperada na resposta: %s',
                row_count,
            )
            raise RepositoryUnavailable

        return rows[0]

    def history(self, start, end, limit, cursor):
        """Consulta o histórico ordenado e prepara a próxima página."""
        query = {
            'select': '*',
            'and': f'(created_at.gte.{start},created_at.lt.{end})',
            'order': 'created_at.desc,prediction_id.desc',
            # Uma linha extra indica se existe outra página.
            'limit': str(limit + 1),
        }

        if cursor:
            created_at, prediction_id = cursor
            query['or'] = (
                f'(created_at.lt.{created_at},'
                f'and(created_at.eq.{created_at},'
                f'prediction_id.lt.{prediction_id}))'
            )

        return self._request(self.PREDICTIONS_TABLE, query)

    def delete_prediction(self, prediction_id):
        """Remove uma previsão pelo identificador e retorna a linha removida."""
        query = {
            'prediction_id': f'eq.{prediction_id}',
            'select': 'prediction_id',
        }
        return self._request(
            self.PREDICTIONS_TABLE,
            query,
            method='DELETE',
            prefer='return=representation',
        )
