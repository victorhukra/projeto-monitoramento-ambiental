"""Executa a inferência meteorológica em serviço isolado."""
import hashlib
import json
import logging
import os
import warnings
from pathlib import Path

import joblib
from flask import Flask, jsonify, request

from src.models.weather_ensemble import FEATURES, MODEL_VERSION, RAW_FIELDS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def load_model():
    """Valida o manifesto e carrega o artefato uma única vez ao iniciar."""
    model_path = Path(os.environ["MODEL_PATH"])
    manifest_path = Path(os.environ["MODEL_MANIFEST_PATH"])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    if digest != manifest.get("bundle_sha256"):
        raise RuntimeError("O hash do modelo não corresponde ao manifesto.")
    if manifest.get("model_version") != MODEL_VERSION:
        raise RuntimeError("A versão do modelo não corresponde ao manifesto.")
    if tuple(manifest.get("features", ())) != FEATURES:
        raise RuntimeError("As features do modelo não correspondem ao manifesto.")
    if tuple(manifest.get("required_weather_inputs", ())) != RAW_FIELDS:
        raise RuntimeError("As entradas do modelo não correspondem ao manifesto.")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        model = joblib.load(model_path)
    if model.model_version != MODEL_VERSION or model.threshold != manifest.get("threshold"):
        raise RuntimeError("O artefato carregado diverge do manifesto.")
    return model


app = Flask(__name__)
model = load_model()


@app.get("/health")
def health():
    return jsonify(status="ok", service="processamento", model_loaded=True, model_version=model.model_version)


@app.post("/predict")
def predict():
    body = request.get_json(silent=True)
    if not isinstance(body, dict) or set(body) != {"weather", "reference_time"}:
        return jsonify(error={"code": "INVALID_REQUEST", "message": "Envie weather e reference_time."}), 422
    try:
        result = model.predict_one(body["weather"], body["reference_time"])
        probability = float(result["rain_probability"])
        threshold = float(result["decision_threshold"])
        if not (0 <= probability <= 1 and 0 <= threshold <= 1):
            raise ValueError("Probabilidade ou limiar fora do intervalo permitido.")
        if result["rain_predicted"] != (probability >= threshold):
            raise ValueError("Classe prevista incompatível com a probabilidade.")
        if result["model_version"] != model.model_version:
            raise ValueError("Versão de modelo inesperada.")
        return jsonify(result)
    except (KeyError, TypeError, ValueError) as error:
        return jsonify(error={"code": "INVALID_WEATHER_INPUT", "message": str(error)}), 422
    except Exception:
        logger.exception("Falha na inferência")
        return jsonify(error={"code": "PROCESSING_FAILED", "message": "O processamento não conseguiu gerar uma previsão."}), 503
