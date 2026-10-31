import math
from typing import Dict, List, Any, Tuple, Optional
import numpy as np
import pandas as pd
import xgboost as xgb
import requests

class SolarAndLoadForecaster:
    """Forecasting engine using XGBoost for solar irradiance generation
    and industrial factory load with Open-Meteo weather integration.
    """

    def __init__(self):
        self.solar_model: Optional[xgb.Booster] = None
        self.load_model: Optional[xgb.Booster] = None
        self.solar_mae: float = 0.18
        self.solar_rmse: float = 0.24
        self.load_mae: float = 0.12
        self.load_rmse: float = 0.16
        self._train_initial_models()

    def _generate_synthetic_training_data(self, n_days: int = 45) -> pd.DataFrame:
        """Generates realistic synthetic historical weather & industrial factory load data."""
        np.random.seed(42)
        records = []
        for day in range(n_days):
            day_of_week = day % 7 # 0 = Monday, 6 = Sunday
            is_weekend = 1 if day_of_week >= 5 else 0
            cloud_factor = np.random.uniform(0.0, 0.8) if (day % 4 == 0) else np.random.uniform(0.0, 0.25)
            temp_base = 24.0 + np.random.uniform(-3, 4)

            for slot in range(96):
                hour = slot * 0.25
                # Solar model: bell curve with cloud attenuation
                center = 12.25
                width = 2.5
                ideal_solar = 5.0 * math.exp(-((hour - center)**2) / (2 * (width**2))) if (6.5 <= hour <= 18.0) else 0.0
                actual_solar = max(0.0, ideal_solar * (1.0 - cloud_factor * 0.85) + np.random.normal(0, 0.08))

                # Temperature
                temp = temp_base + 6.0 * math.sin(math.pi * (hour - 9) / 12) if (hour >= 6) else temp_base

                # Factory base load: lower on weekend, higher during shifts (08:00 - 19:00)
                if is_weekend:
                    base_load = 0.6 + np.random.normal(0, 0.05)
                else:
                    if 8.0 <= hour <= 19.0:
                        base_load = 1.5 + np.random.normal(0, 0.1)
                    else:
                        base_load = 0.8 + np.random.normal(0, 0.06)

                records.append({
                    "day": day,
                    "slot": slot,
                    "hour": hour,
                    "day_of_week": day_of_week,
                    "is_weekend": is_weekend,
                    "cloud_cover": round(cloud_factor * 100, 1),
                    "temperature_c": round(temp, 1),
                    "solar_kw": round(actual_solar, 2),
                    "load_kw": round(max(0.2, base_load), 2)
                })

        return pd.DataFrame(records)

    def _train_initial_models(self):
        df = self._generate_synthetic_training_data(n_days=40)

        # Features
        features = ["slot", "hour", "day_of_week", "is_weekend", "cloud_cover", "temperature_c"]
        X = df[features]

        # Solar Model (native XGBoost)
        y_solar = df["solar_kw"]
        dtrain_solar = xgb.DMatrix(X, label=y_solar)
        solar_params = {
            "max_depth": 4,
            "eta": 0.1,
            "objective": "reg:squarederror",
            "verbosity": 0
        }
        self.solar_model = xgb.train(solar_params, dtrain_solar, num_boost_round=60)
        pred_solar = self.solar_model.predict(dtrain_solar)
        self.solar_mae = float(round(float(np.mean(np.abs(y_solar.values - pred_solar))), 3))
        self.solar_rmse = float(round(float(np.sqrt(np.mean((y_solar.values - pred_solar)**2))), 3))

        # Load Model (native XGBoost)
        y_load = df["load_kw"]
        dtrain_load = xgb.DMatrix(X, label=y_load)
        load_params = {
            "max_depth": 4,
            "eta": 0.1,
            "objective": "reg:squarederror",
            "verbosity": 0
        }
        self.load_model = xgb.train(load_params, dtrain_load, num_boost_round=50)
        pred_load = self.load_model.predict(dtrain_load)
        self.load_mae = float(round(float(np.mean(np.abs(y_load.values - pred_load))), 3))
        self.load_rmse = float(round(float(np.sqrt(np.mean((y_load.values - pred_load)**2))), 3))

    def fetch_open_meteo_weather(self, lat: float = 13.03, lon: float = 77.51) -> Optional[Dict[str, List[float]]]:
        """Fetches hourly weather forecast from Open-Meteo for Peenya, Bengaluru."""
        try:
            url = (
                f"https://api.open-meteo.com/v1/forecast?"
                f"latitude={lat}&longitude={lon}&hourly=temperature_2m,cloud_cover,direct_normal_irradiance"
                f"&forecast_days=1&timezone=Asia%2FKolkata"
            )
            resp = requests.get(url, timeout=0.8)
            if resp.status_code == 200:
                data = resp.json()
                hourly = data.get("hourly", {})
                # Interpolate 24 hourly points to 96 15-minute points
                cloud_24 = hourly.get("cloud_cover", [20.0]*24)
                temp_24 = hourly.get("temperature_2m", [28.0]*24)
                
                cloud_96 = np.interp(np.linspace(0, 23, 96), np.arange(24), cloud_24)
                temp_96 = np.interp(np.linspace(0, 23, 96), np.arange(24), temp_24)

                return {
                    "cloud_cover": [float(x) for x in cloud_96],
                    "temperature_c": [float(x) for x in temp_96]
                }
        except Exception:
            pass
        return None

    def predict_day(self, scenario: str = "sunny") -> Dict[str, Any]:
        """Generates 96-slot forecast for solar and factory base load."""
        weather = self.fetch_open_meteo_weather()
        if not weather:
            # Fallback to scenario-based weather
            if scenario == "overcast":
                weather = {"cloud_cover": [85.0]*96, "temperature_c": [23.5]*96}
            elif scenario == "partly_cloudy":
                weather = {"cloud_cover": [45.0]*96, "temperature_c": [26.0]*96}
            else:
                weather = {"cloud_cover": [10.0]*96, "temperature_c": [29.0]*96}

        rows = []
        for slot in range(96):
            hour = slot * 0.25
            rows.append({
                "slot": slot,
                "hour": hour,
                "day_of_week": 2, # Wednesday typical weekday
                "is_weekend": 0,
                "cloud_cover": weather["cloud_cover"][slot],
                "temperature_c": weather["temperature_c"][slot]
            })

        df_in = pd.DataFrame(rows)
        dtest = xgb.DMatrix(df_in)
        solar_pred = self.solar_model.predict(dtest)
        # Solar is zero at night
        for s in range(96):
            if s < 24 or s >= 72:
                solar_pred[s] = 0.0
            else:
                solar_pred[s] = max(0.0, float(solar_pred[s]))

        load_pred = self.load_model.predict(dtest)
        load_pred = [max(0.5, float(x)) for x in load_pred]

        return {
            "scenario": scenario,
            "solar_forecast": [round(float(x), 2) for x in solar_pred],
            "load_forecast": [round(float(x), 2) for x in load_pred],
            "weather": weather,
            "metrics": {
                "solar_mae_kw": self.solar_mae,
                "solar_rmse_kw": self.solar_rmse,
                "load_mae_kw": self.load_mae,
                "load_rmse_kw": self.load_rmse
            }
        }

forecaster = SolarAndLoadForecaster()
