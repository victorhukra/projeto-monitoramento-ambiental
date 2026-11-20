"""Verifica a preparação das variáveis que entram no modelo de previsão."""
import unittest
from src.models.weather_ensemble import SimpleMeanCalibratedEnsemble, FEATURES

class FeatureTests(unittest.TestCase):
    def setUp(self):
        self.weather = dict(temperature_2m=20, relative_humidity_2m=80,
                            pressure_msl=1005, cloud_cover=70,
                            pressure_msl_previous_hour=1007)

    def test_feature_order_and_local_hour(self):
        frame = SimpleMeanCalibratedEnsemble.prepare_features(self.weather, '2025-01-01T18:00:00Z')
        self.assertEqual(tuple(frame.columns), FEATURES)
        self.assertEqual(frame.iloc[0].tolist(), [20, 80, 1005, 70, 1600, -2, 15])

    def test_requires_previous_pressure(self):
        del self.weather['pressure_msl_previous_hour']
        with self.assertRaises(ValueError):
            SimpleMeanCalibratedEnsemble.prepare_features(self.weather, '2025-01-01T15:00:00-03:00')

    def test_rejects_missing_timezone(self):
        with self.assertRaises(ValueError):
            SimpleMeanCalibratedEnsemble.prepare_features(self.weather, '2025-01-01T15:00:00')

    def test_rejects_nonfinite(self):
        self.weather['pressure_msl'] = float('nan')
        with self.assertRaises(ValueError):
            SimpleMeanCalibratedEnsemble.prepare_features(self.weather, '2025-01-01T15:00:00-03:00')
