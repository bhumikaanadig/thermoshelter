"""Inference helper for the separate THERMOSHELTER V3 Hourly Surrogate."""

from __future__ import annotations

import argparse
import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping, Sequence

import joblib
import numpy as np
import pandas as pd

try:
    from .inspect_hourly_dataset import (
        BASE_FEATURES,
        CASE_COLUMN_RENAMES,
        HOURLY_CLIMATE_COLUMNS,
        HOURLY_COLUMN_RENAMES,
        MODEL_FEATURES,
    )
except ImportError:  # Supports `python ml/predict_hourly.py` from the project root.
    from inspect_hourly_dataset import (
        BASE_FEATURES,
        CASE_COLUMN_RENAMES,
        HOURLY_CLIMATE_COLUMNS,
        HOURLY_COLUMN_RENAMES,
        MODEL_FEATURES,
    )


DEFAULT_MODEL = Path(__file__).resolve().parent / "artifacts" / "v3" / "thermal_hourly_surrogate_v1.joblib"
PROFILE_HOUR_COLUMN = "Hour"
VERSION = "V3-Hourly-v1"


@lru_cache(maxsize=4)
def _load_bundle(model_path: str) -> dict[str, Any]:
    path = Path(model_path)
    if not path.is_file():
        raise FileNotFoundError(f"Hourly model artifact not found: {path}")
    bundle = joblib.load(path)
    required = {"model_version", "estimator", "features", "categorical_values", "numeric_feature_ranges"}
    missing = sorted(required - set(bundle))
    if missing:
        raise ValueError(f"Hourly model artifact is missing required fields: {missing}")
    if bundle["model_version"] != VERSION:
        raise ValueError(f"Unsupported hourly model version: {bundle['model_version']!r}")
    if bundle["features"] != MODEL_FEATURES:
        raise ValueError("Hourly model feature order does not match the inference helper.")
    return bundle


def _number(value: Any, field: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a finite number, not a boolean.")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be numeric; received {value!r}.") from None
    if not math.isfinite(number):
        raise ValueError(f"{field} must be finite; received {value!r}.")
    return number


def _validate_case_inputs(case_inputs: Mapping[str, Any], bundle: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(case_inputs, Mapping):
        raise ValueError("case_inputs must be one object containing the 21 V3 case inputs.")
    missing = [field for field in BASE_FEATURES if field not in case_inputs or case_inputs[field] is None]
    extra = sorted(set(case_inputs) - set(BASE_FEATURES))
    if missing:
        raise ValueError(f"Missing required case input fields: {missing}")
    if extra:
        raise ValueError(f"Unexpected case input fields (Case_ID and output columns are not model inputs): {extra}")

    clean: dict[str, Any] = {}
    supported = bundle["categorical_values"]
    for field in BASE_FEATURES:
        value = case_inputs[field]
        if field in {"Material", "Material_Category"}:
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{field} must be a non-empty string.")
            normalized = value.strip()
            if normalized not in supported.get(field, []):
                raise ValueError(
                    f"Unsupported {field} value {normalized!r}; supported values are "
                    f"{supported.get(field, [])}."
                )
            clean[field] = normalized
        else:
            clean[field] = _number(value, field)
    return clean


def _validate_hourly_climate(hourly_climate: Sequence[Mapping[str, Any]]) -> list[dict[str, float | int]]:
    if not isinstance(hourly_climate, Sequence) or isinstance(hourly_climate, (str, bytes)):
        raise ValueError("hourly_climate must be a list of 24 hourly climate records.")
    if len(hourly_climate) != 24:
        raise ValueError(f"hourly_climate must contain exactly 24 records; received {len(hourly_climate)}.")

    required = {PROFILE_HOUR_COLUMN, *HOURLY_CLIMATE_COLUMNS}
    by_hour: dict[int, dict[str, float | int]] = {}
    for index, point in enumerate(hourly_climate):
        if not isinstance(point, Mapping):
            raise ValueError(f"hourly_climate[{index}] must be an object.")
        missing = sorted(required - set(point))
        extra = sorted(set(point) - required)
        if missing or extra:
            raise ValueError(f"hourly_climate[{index}] fields differ; missing={missing}, unexpected={extra}.")
        raw_hour = point[PROFILE_HOUR_COLUMN]
        if isinstance(raw_hour, bool) or not isinstance(raw_hour, (int, np.integer)):
            raise ValueError(f"hourly_climate[{index}].Hour must be an integer from 0 to 23.")
        hour = int(raw_hour)
        if not 0 <= hour <= 23:
            raise ValueError(f"hourly_climate[{index}].Hour must be from 0 to 23; received {hour}.")
        if hour in by_hour:
            raise ValueError(f"Duplicate hourly climate record for Hour={hour}.")
        row: dict[str, float | int] = {PROFILE_HOUR_COLUMN: hour}
        for field in HOURLY_CLIMATE_COLUMNS:
            row[field] = _number(point[field], f"hourly_climate[{index}].{field}")
        by_hour[hour] = row
    if set(by_hour) != set(range(24)):
        raise ValueError("hourly_climate must include exactly the hours 0 through 23.")
    return [by_hour[hour] for hour in range(24)]


def build_hourly_features(
    case_inputs: Mapping[str, Any],
    hourly_climate: Sequence[Mapping[str, Any]],
    bundle: dict[str, Any],
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Validate inputs and build feature rows in the saved model's order."""
    clean_case = _validate_case_inputs(case_inputs, bundle)
    clean_climate = _validate_hourly_climate(hourly_climate)
    rows: list[dict[str, Any]] = []
    for point in clean_climate:
        hour = int(point[PROFILE_HOUR_COLUMN])
        row = {CASE_COLUMN_RENAMES.get(field, field): value for field, value in clean_case.items()}
        row["Hour_sin"] = math.sin(2 * math.pi * hour / 24.0)
        row["Hour_cos"] = math.cos(2 * math.pi * hour / 24.0)
        for field, value in point.items():
            if field != PROFILE_HOUR_COLUMN:
                row[HOURLY_COLUMN_RENAMES.get(field, field)] = value
        rows.append(row)
    frame = pd.DataFrame(rows, columns=MODEL_FEATURES)
    diagnostics: list[dict[str, Any]] = []
    for feature, bounds in bundle["numeric_feature_ranges"].items():
        values = frame[feature].astype(float).to_numpy()
        outside = (values < float(bounds["min"])) | (values > float(bounds["max"]))
        if outside.any():
            diagnostic: dict[str, Any] = {
                "field": feature,
                "observed_range": [float(bounds["min"]), float(bounds["max"])],
            }
            if feature in {"Outdoor_Temperature_C", "Hourly_Solar_Radiation_W_m2", "Hourly_Wind_Speed_m_s"}:
                diagnostic["hours"] = np.flatnonzero(outside).astype(int).tolist()
                diagnostic["values"] = values[outside].astype(float).tolist()
            else:
                diagnostic["value"] = float(values[0])
            diagnostics.append(diagnostic)
    return frame, {
        "out_of_observed_range": diagnostics,
        "message": (
            "Some inputs are outside the observed training range. The model generated a prediction; "
            "reliability may be lower for these conditions."
            if diagnostics else None
        ),
    }


def predict_hourly(
    case_inputs: Mapping[str, Any],
    hourly_climate: Sequence[Mapping[str, Any]],
    model_path: str | Path | None = None,
) -> dict[str, Any]:
    """Predict indoor temperatures for the supplied actual hourly climate profile.

    The helper never derives or fabricates hourly weather. The caller must
    supply the 24 observed or forecast points for outdoor temperature,
    radiation, and wind from Hour 0 through Hour 23.
    """
    resolved_model = str(Path(model_path or DEFAULT_MODEL).resolve())
    bundle = _load_bundle(resolved_model)
    features, diagnostics = build_hourly_features(case_inputs, hourly_climate, bundle)
    values = np.asarray(bundle["estimator"].predict(features), dtype=float).reshape(-1)
    if values.shape != (24,) or not np.isfinite(values).all():
        raise ValueError(f"Hourly estimator must return 24 finite temperatures; received shape {values.shape}.")
    return {
        "model_version": VERSION,
        "hours": list(range(24)),
        "predicted_indoor_temperature_C": values.tolist(),
        "diagnostics": diagnostics,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path,
                        help="JSON with case_inputs and 24 hourly_climate records")
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        payload = json.loads(args.input.read_text(encoding="utf-8"))
        result = predict_hourly(payload["case_inputs"], payload["hourly_climate"], args.model)
    except (json.JSONDecodeError, OSError, KeyError, ValueError) as error:
        parser.error(str(error))
    output = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
        print(f"Wrote hourly prediction to {args.output.resolve()}")
    else:
        print(output)


if __name__ == "__main__":
    main()
