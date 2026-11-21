"""Carrega e valida o modelo v6 empacotado, uma única vez, durante a inicialização da aplicação."""
import hashlib
import json
import warnings

import joblib

from src.models.weather_ensemble import FEATURES, MODEL_VERSION, RAW_FIELDS


class ModelLoadError(RuntimeError):
    pass


def load_model(model_path, manifest_path):
    """Fica responsável por carregar e validar o modelo v6 durante a inicialização do Backend, 
    conferindo o manifesto, o hash, a versão e as entradas esperadas."""
    
    if not model_path or not manifest_path:
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        # O hash confirma que o arquivo carregado corresponde ao manifesto.
        digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
        if digest != manifest.get('bundle_sha256'):
            raise ModelLoadError('O hash do modelo não corresponde ao manifesto.')
        if manifest.get('model_version') != MODEL_VERSION:
            raise ModelLoadError('A versão do modelo não corresponde à versão esperada.')
        if tuple(manifest.get('features', ())) != FEATURES:
            raise ModelLoadError('A ordem de features do manifesto é incompatível.')
        if tuple(manifest.get('required_weather_inputs', ())) != RAW_FIELDS:
            raise ModelLoadError('As entradas exigidas pelo manifesto são incompatíveis.')
        # Avisos de incompatibilidade ao carregar o pacote também impedem seu uso.
        with warnings.catch_warnings():
            warnings.simplefilter('error')
            model = joblib.load(model_path)
        if model.model_version != MODEL_VERSION or model.threshold != manifest.get('threshold'):
            raise ModelLoadError('O pacote carregado diverge do manifesto.')
        return model
    except ModelLoadError:
        raise
    except Exception as exc:
        raise ModelLoadError('Não foi possível verificar ou carregar o modelo v6.') from exc
