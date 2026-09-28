"""Validated inference helper for the saved THERMOSHELTER surrogate."""

from __future__ import annotations

import argparse
import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import pandas as pd


DEFAULT_MODEL = Path(__file__).resolve().parent / "artifacts" / "v2" / "thermal_surrogate_v2.joblib"
CATEGORICAL_FEATURES = {"Material", "Material_Category"}
POSITIVE_FEATURES = {
    "Thermal_Conductivity_W_mK", "Density_kg_m3", "Specific_Heat_J_kgK",
    "Wall_Thickness_m", "Shelter_Length_m", "Shelter_Width_m", "Shelter_Height_m",
    "Simulation_Duration_h", "Time_Step_min",
}
NONNEGATIVE_FEATURES = {
    "Opening_Area_m2", "Window_Area_m2", "Door_Area_m2",
    "Solar_Radiation_W_m2", "Daily_Solar_Energy_kWh_m2", "Wind_Speed_m_s",
}


@lru_cache(maxsize=4)
def _load_bundle(model_path: str) -> dict:
    path = Path(model_path)
    if not path.is_file():
        raise FileNotFoundError(f"Model artifact not found: {path}")
    bundle = joblib.load(path)
    for key in ("models", "features", "targets", "metadata"):
        if key not in bundle:
            raise ValueError(f"Model artifact is missing required key: {key}")
    return bundle


def predict_shelter(input_data: dict[str, Any], model_path: str | Path | None = None) -> dict:
    """Return six summary predictions for one complete shelter input mapping.

    Raises ValueError for missing, unexpected, nonnumeric, non-finite, or
    physically invalid inputs. Warnings identify extrapolation beyond the
    numeric ranges and material names represented in the training cases.
    """
    if not isinstance(input_data, dict):
        raise ValueError("input_data must be one JSON-style object/dictionary.")
    resolved_model = str(Path(model_path or DEFAULT_MODEL).resolve())
    bundle = _load_bundle(resolved_model)
    features = list(bundle["features"])
    missing = [feature for feature in features if feature not in input_data or input_data[feature] is None]
    unexpected = [key for key in input_data if key not in features]
    if missing:
        raise ValueError(f"Missing required input fields: {missing}")
    if unexpected:
        raise ValueError(f"Unexpected input fields (remove or map them first): {unexpected}")

    row: dict[str, Any] = {}
    for feature in features:
        value = input_data[feature]
        if feature in CATEGORICAL_FEATURES:
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{feature} must be a non-empty string.")
            row[feature] = value.strip()
        else:
            if isinstance(value, bool):
                raise ValueError(f"{feature} must be a finite number, not a boolean.")
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                raise ValueError(f"{feature} must be numeric; got {value!r}.") from None
            if not math.isfinite(numeric):
                raise ValueError(f"{feature} must be finite; got {value!r}.")
            row[feature] = numeric

    for feature in POSITIVE_FEATURES:
        if row[feature] <= 0:
            raise ValueError(f"{feature} must be greater than zero.")
    for feature in NONNEGATIVE_FEATURES:
        if row[feature] < 0:
            raise ValueError(f"{feature} must be zero or greater.")
    if not 0 <= row["Orientation_deg"] <= 360:
        raise ValueError("Orientation_deg must be between 0 and 360 degrees.")
    if not 0 <= row["Relative_Humidity_percent"] <= 100:
        raise ValueError("Relative_Humidity_percent must be between 0 and 100.")

    warnings: list[str] = []
    metadata = bundle["metadata"]
    for feature, bounds in metadata.get("feature_ranges", {}).items():
        value = row[feature]
        if value < bounds["min"] or value > bounds["max"]:
            warnings.append(
                f"{feature}={value:g} is outside the training range "
                f"[{bounds['min']:g}, {bounds['max']:g}]; prediction is extrapolation."
            )
    for feature in CATEGORICAL_FEATURES:
        known = metadata.get("categorical_values", {}).get(feature, [])
        if row[feature] not in known:
            warnings.append(f"{feature}={row[feature]!r} was not present in training; verify its properties/category mapping.")
    if abs(row["Opening_Area_m2"] - row["Window_Area_m2"] - row["Door_Area_m2"]) > 1e-6:
        warnings.append("Opening_Area_m2 differs from window area + door area; this relationship was exact in the source data.")

    x = pd.DataFrame([row], columns=features)
    predictions = {}
    for target in bundle["targets"]:
        value = float(bundle["models"][target].predict(x)[0])
        constraints = metadata.get("output_constraints", {}).get(target, {})
        if "minimum" in constraints:
            value = max(float(constraints["minimum"]), value)
        if "maximum" in constraints:
            value = min(float(constraints["maximum"]), value)
        predictions[target] = value
    return {"predictions": predictions, "warnings": warnings}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="JSON file containing one shelter configuration")
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL, help="Saved .joblib model bundle")
    parser.add_argument("--output", type=Path, help="Optional path for the JSON prediction result")
    args = parser.parse_args()
    try:
        input_data = json.loads(args.input.read_text(encoding="utf-8"))
        result = predict_shelter(input_data, args.model)
    except (json.JSONDecodeError, OSError, ValueError) as error:
        parser.error(str(error))
    output = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
        print(f"Wrote prediction to {args.output}")
    else:
        print(output)


if __name__ == "__main__":
    main()
