import math
import json
from pathlib import Path
import numpy as np
import pandas as pd
import xgboost as xgb

def train_and_export_models():
    # 1. Generate 50 days of synthetic data
    np.random.seed(42)
    records = []
    for day in range(50):
        day_of_week = day % 7
        is_weekend = 1 if day_of_week >= 5 else 0
        cloud_factor = np.random.uniform(0.0, 0.85) if (day % 4 == 0) else np.random.uniform(0.0, 0.25)
        temp_base = 24.0 + np.random.uniform(-3, 4)

        for slot in range(96):
            hour = slot * 0.25
            center = 12.25
            width = 2.5
            ideal_solar = 5.0 * math.exp(-((hour - center)**2) / (2 * (width**2))) if (6.5 <= hour <= 18.0) else 0.0
            actual_solar = max(0.0, ideal_solar * (1.0 - cloud_factor * 0.85) + np.random.normal(0, 0.06))

            temp = temp_base + 6.0 * math.sin(math.pi * (hour - 9) / 12) if (hour >= 6) else temp_base

            if is_weekend:
                base_load = 0.6 + np.random.normal(0, 0.04)
            else:
                base_load = (1.5 + np.random.normal(0, 0.08)) if (8.0 <= hour <= 19.0) else (0.8 + np.random.normal(0, 0.05))

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

    df = pd.DataFrame(records)

    # 2. 80/20 Train / Held-Out Test Split
    train_df = df[df["day"] < 40]
    test_df = df[df["day"] >= 40]

    features = ["slot", "hour", "day_of_week", "is_weekend", "cloud_cover", "temperature_c"]
    X_train = train_df[features]
    X_test = test_df[features]

    # Solar Model
    dtrain_solar = xgb.DMatrix(X_train, label=train_df["solar_kw"])
    dtest_solar = xgb.DMatrix(X_test, label=test_df["solar_kw"])
    solar_params = {"max_depth": 4, "eta": 0.1, "objective": "reg:squarederror", "verbosity": 0}
    solar_model = xgb.train(solar_params, dtrain_solar, num_boost_round=60)

    pred_test_solar = solar_model.predict(dtest_solar)
    y_test_solar = test_df["solar_kw"].values
    solar_mae = float(round(float(np.mean(np.abs(y_test_solar - pred_test_solar))), 3))
    solar_rmse = float(round(float(np.sqrt(np.mean((y_test_solar - pred_test_solar)**2))), 3))

    # Load Model
    dtrain_load = xgb.DMatrix(X_train, label=train_df["load_kw"])
    dtest_load = xgb.DMatrix(X_test, label=test_df["load_kw"])
    load_params = {"max_depth": 4, "eta": 0.1, "objective": "reg:squarederror", "verbosity": 0}
    load_model = xgb.train(load_params, dtrain_load, num_boost_round=50)

    pred_test_load = load_model.predict(dtest_load)
    y_test_load = test_df["load_kw"].values
    load_mae = float(round(float(np.mean(np.abs(y_test_load - pred_test_load))), 3))
    load_rmse = float(round(float(np.sqrt(np.mean((y_test_load - pred_test_load)**2))), 3))

    # Save models and metadata
    models_dir = Path(__file__).resolve().parent.parent / "app" / "forecast" / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    solar_model.save_model(str(models_dir / "solar_model.json"))
    load_model.save_model(str(models_dir / "load_model.json"))

    meta = {
        "training_days": 40,
        "test_days": 10,
        "train_samples": len(train_df),
        "test_samples": len(test_df),
        "features": features,
        "metrics": {
            "solar_mae_kw": solar_mae,
            "solar_rmse_kw": solar_rmse,
            "load_mae_kw": load_mae,
            "load_rmse_kw": load_rmse,
            "split": "80% train / 20% held-out test split (simulated data)",
            "description": "Computed on 20% held-out simulated test split"
        }
    }

    with open(models_dir / "forecast_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print("Pre-trained XGBoost models exported successfully!")
    print(f"Held-out Test Solar MAE: {solar_mae:.3f} kW, RMSE: {solar_rmse:.3f} kW")
    print(f"Held-out Test Load MAE: {load_mae:.3f} kW, RMSE: {load_rmse:.3f} kW")
    print(f"Solar model size: {(models_dir / 'solar_model.json').stat().st_size / 1024:.1f} KB")
    print(f"Load model size: {(models_dir / 'load_model.json').stat().st_size / 1024:.1f} KB")

if __name__ == "__main__":
    train_and_export_models()
