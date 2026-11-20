# Construção de atributos e adaptador de inferência do ensemble meteorológico candidato.
import numpy as np
import pandas as pd
from config import WEATHER_TIMEZONE

# A ordem das entradas deve coincidir com a usada no treinamento e no manifesto.
MODEL_VERSION = 'weather-v6-simple-mean-isotonic-v1'
MODEL_NAMES = ('original', 'balanced', 'balanced_subsample')
FEATURES = ('temperature_2m','relative_humidity_2m','pressure_msl','cloud_cover','temp_humidity','pressure_diff','hour_of_day')
WEIGHTS = {'original':1/3,'balanced':1/3,'balanced_subsample':1/3}
RAW_FIELDS = ('temperature_2m','relative_humidity_2m','pressure_msl','cloud_cover','pressure_msl_previous_hour')

class SimpleMeanCalibratedEnsemble:
    RAW_FIELDS = RAW_FIELDS

    def __init__(self, models, calibrators, threshold=0.5, model_version=MODEL_VERSION):
        if set(models) != set(MODEL_NAMES) or set(calibrators) != set(MODEL_NAMES):
            raise ValueError('O bundle deve conter os três modelos e seus calibradores.')
        self.models = models
        self.calibrators = calibrators
        self.threshold = float(threshold)
        self.model_version = str(model_version)
        if not 0 <= self.threshold <= 1:
            raise ValueError('O limiar deve estar entre 0 e 1.')

    # Prepara as variáveis calculadas no formato esperado pelos modelos treinados.
    @staticmethod
    def prepare_features(weather, reference_time):
        missing = [field for field in RAW_FIELDS if field not in weather]
        extra = [field for field in weather if field not in RAW_FIELDS]
        if missing or extra:
            raise ValueError(f'Entradas inválidas; ausentes={missing}, extras={extra}.')
        values = {field: float(weather[field]) for field in RAW_FIELDS}
        if not np.isfinite(list(values.values())).all():
            raise ValueError('As entradas meteorológicas devem ser finitas.')
        timestamp = pd.Timestamp(reference_time)
        if timestamp.tzinfo is None:
            raise ValueError('reference_time precisa conter fuso horário.')
        local_time = timestamp.tz_convert(WEATHER_TIMEZONE)
        row = {
            'temperature_2m': values['temperature_2m'],
            'relative_humidity_2m': values['relative_humidity_2m'],
            'pressure_msl': values['pressure_msl'],
            'cloud_cover': values['cloud_cover'],
            'temp_humidity': values['temperature_2m'] * values['relative_humidity_2m'],
            'pressure_diff': values['pressure_msl'] - values['pressure_msl_previous_hour'],
            'hour_of_day': local_time.hour,
        }
        return pd.DataFrame([[row[name] for name in FEATURES]], columns=FEATURES)

    def predict_one(self, weather, reference_time):
        features = self.prepare_features(weather, reference_time)
        # Cada modelo gera uma probabilidade, que passa por sua calibração.
        calibrated = {}
        for name in MODEL_NAMES:
            model = self.models[name]
            classes = list(model.classes_)
            if 1 not in classes:
                raise ValueError(f'O modelo {name} não contém a classe positiva 1.')
            raw = float(model.predict_proba(features)[0, classes.index(1)])
            calibrated[name] = float(np.clip(self.calibrators[name].predict([raw])[0], 0, 1))
        # Combina as três probabilidades e compara a média com o limiar de decisão.
        probability = float(sum(WEIGHTS[name] * calibrated[name] for name in MODEL_NAMES))
        return {
            'rain_probability': probability,
            'rain_predicted': probability >= self.threshold,
            'decision_threshold': self.threshold,
            'model_version': self.model_version,
        }
