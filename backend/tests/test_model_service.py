import unittest
from app.model_service import load_model
from app.prediction_service import predict
from app.errors import ServiceError
from app.settings import Settings

class ModelTests(unittest.TestCase):
    def test_loads_verified_v6_and_predicts(self):
        # Usa o pacote configurado em MODEL_PATH/MODEL_MANIFEST_PATH (backend/.env); sem ele, o teste é pulado.
        settings=Settings.from_env()
        if not (settings.model_path and settings.manifest_path and settings.model_path.is_file()):
            self.skipTest('Modelo v6 não configurado em MODEL_PATH/MODEL_MANIFEST_PATH.')
        model=load_model(settings.model_path,settings.manifest_path)
        inputs={'location':'Londrina-PR','mode':'historical','reference_time':'2025-01-01T15:00:00-03:00',
                'weather':{'temperature_2m':20,'relative_humidity_2m':80,'pressure_msl':1005,'cloud_cover':70,'pressure_msl_previous_hour':1007}}
        result=predict(model,inputs)
        self.assertEqual(result['model_version'],'weather-v6-simple-mean-isotonic-v1')
        self.assertEqual(result['rain_predicted'],result['rain_probability']>=result['decision_threshold'])

    def test_model_missing_is_503(self):
        with self.assertRaisesRegex(ServiceError,'MODEL_UNAVAILABLE'):
            predict(None,{})
