"""Acesso via REST ao Supabase para registros de dados meteorológicos e previsões."""
import json
import logging
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# Detalhes das falhas ficam só no log (tabela, método, status e erro do PostgREST); nunca a chave nem a URL completa.
logger=logging.getLogger(__name__)
_MAX_DETAIL=500

class RepositoryUnavailable(RuntimeError): pass
class DuplicateRequest(RuntimeError): pass

class WeatherRepository:
    def __init__(self, base_url, api_key, timeout=8):
        self.base_url=base_url.rstrip('/'); self.api_key=api_key; self.timeout=timeout
    def _request(self, table, query, method='GET', payload=None, prefer=None):
        headers={'apikey':self.api_key,'Authorization':f'Bearer {self.api_key}','Accept':'application/json'}
        if payload is not None: headers['Content-Type']='application/json'
        if prefer: headers['Prefer']=prefer
        req=Request(f'{self.base_url}/rest/v1/{table}?{urlencode(query)}',headers=headers,
                    data=json.dumps(payload).encode() if payload is not None else None,method=method)
        try:
            with urlopen(req,timeout=self.timeout) as response:
                return json.load(response) if response.status != 204 else None
        except HTTPError as exc:
            body=exc.read().decode(errors='replace')
            try: code=json.loads(body).get('code')
            except (ValueError,AttributeError): code=None
            if exc.code==409 and code=='23505': raise DuplicateRequest from None
            logger.error('Supabase respondeu com erro: tabela=%s método=%s status=%s código=%s corpo=%s',
                         table,method,exc.code,code,body[:_MAX_DETAIL])
            raise RepositoryUnavailable from None
        except (URLError,TimeoutError) as exc:
            logger.error('Falha de comunicação com o Supabase: tabela=%s método=%s erro=%r',table,method,getattr(exc,'reason',exc))
            raise RepositoryUnavailable from None
        except ValueError as exc:
            logger.error('Resposta do Supabase não é JSON válido: tabela=%s método=%s erro=%s',table,method,exc)
            raise RepositoryUnavailable from None
    def rows_at(self,timestamp):
        query={'select':'id,time,temperature_2m,relative_humidity_2m,pressure_msl,cloud_cover','time':f'eq.{timestamp}','limit':'2'}
        return self._request('dataset_weather_goes',query)
    def time_bounds(self):
        """Primeiro e último horário da tabela meteorológica (texto como o banco devolve) ou (None, None)."""
        first=self._request('dataset_weather_goes',{'select':'time','order':'time.asc','limit':'1'})
        last=self._request('dataset_weather_goes',{'select':'time','order':'time.desc','limit':'1'})
        return (first[0]['time'] if first else None, last[0]['time'] if last else None)
    def rows_between(self,start,end):
        """Registros com start <= time < end (horário local, sem fuso, como gravado no banco)."""
        query={'select':'id,time,temperature_2m,relative_humidity_2m,pressure_msl,cloud_cover',
               'and':f'(time.gte.{start},time.lt.{end})','order':'time.asc','limit':'200'}
        return self._request('dataset_weather_goes',query)
    def prediction_by_request_id(self,request_id):
        return self._request('resultados_previsoes_ia',{'select':'*','request_id':f'eq.{request_id}','limit':'2'})
    def insert_prediction(self,payload):
        rows=self._request('resultados_previsoes_ia',{'select':'*'},'POST',payload,'return=representation')
        if not isinstance(rows,list) or len(rows)!=1:
            logger.error('Gravação da previsão sem a linha esperada na resposta: %s',type(rows).__name__ if not isinstance(rows,list) else f'{len(rows)} linhas')
            raise RepositoryUnavailable
        return rows[0]
    def history(self,start,end,limit,cursor):
        query={'select':'*','and':f'(created_at.gte.{start},created_at.lt.{end})','order':'created_at.desc,prediction_id.desc','limit':str(limit+1)}
        if cursor:
            query['or']=f'(created_at.lt.{cursor[0]},and(created_at.eq.{cursor[0]},prediction_id.lt.{cursor[1]}))'
        return self._request('resultados_previsoes_ia',query)
    def delete_prediction(self,prediction_id):
        return self._request('resultados_previsoes_ia',{'prediction_id':f'eq.{prediction_id}','select':'prediction_id'},'DELETE',prefer='return=representation')
