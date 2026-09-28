"""HTTP verification for the separate hourly surrogate and existing V3 route."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = PROJECT_ROOT / "ml" / "artifacts" / "v3"


def get_json(url: str) -> dict:
    with urlopen(url, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json(url: str, payload: dict) -> dict:
    request = Request(
        url,
        data=json.dumps(payload, allow_nan=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def expect_422(url: str, payload: dict, label: str) -> None:
    try:
        post_json(url, payload)
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        if error.code != 422:
            raise AssertionError(f"{label}: expected HTTP 422, got {error.code}: {body}") from error
        return
    raise AssertionError(f"{label}: invalid payload unexpectedly passed validation")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8001")
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")

    summary_input = json.loads((ARTIFACT_DIR / "example_input.json").read_text(encoding="utf-8"))
    summary_expected = json.loads((ARTIFACT_DIR / "example_prediction.json").read_text(encoding="utf-8"))
    hourly_example = json.loads((ARTIFACT_DIR / "hourly_example_prediction.json").read_text(encoding="utf-8"))
    inspection = json.loads((ARTIFACT_DIR / "hourly_dataset_inspection.json").read_text(encoding="utf-8"))

    try:
        health = get_json(f"{base_url}/health")
        summary = post_json(f"{base_url}/predict", summary_input)
        hourly_request = {
            "case_inputs": hourly_example["case_inputs"],
            "hourly_climate": hourly_example["hourly_climate"],
        }
        hourly_request["case_inputs"]["Design_Context"] = {
            "location": "Leh, Ladakh",
            "occupants": 4,
            "primary_material": "Stone",
        }
        hourly = post_json(f"{base_url}/predict-hourly", hourly_request)
        changed_design_request = json.loads(json.dumps(hourly_request))
        changed_design_request["case_inputs"]["Shelter_Length_m"] = min(
            6.0, changed_design_request["case_inputs"]["Shelter_Length_m"] + 0.5
        )
        changed_design = post_json(f"{base_url}/predict-hourly", changed_design_request)
        out_of_range_request = json.loads(json.dumps(hourly_request))
        out_of_range_request["case_inputs"]["Wall_Thickness_m"] = 0.45
        out_of_range = post_json(f"{base_url}/predict-hourly", out_of_range_request)
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"API returned HTTP {error.code}: {body}") from error
    except URLError as error:
        raise SystemExit(f"Could not reach {base_url}: {error.reason}") from error

    assert health["status"] == "ok" and health["model_loaded"] is True and health["model_version"] == "V3", health
    assert summary["model_version"] == "V3", summary
    expected_summary = summary_expected["predictions"]
    assert set(summary["predictions"]) == set(expected_summary)
    for name, value in summary["predictions"].items():
        assert isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)), (
            f"V3 {name} is not finite numeric output: {value!r}"
        )
        assert math.isclose(float(value), float(expected_summary[name]), rel_tol=1e-9, abs_tol=1e-9), (
            f"V3 {name} differs from the existing saved example"
        )

    assert hourly["model_version"] == "V3-Hourly-v1", hourly
    assert hourly["hours"] == list(range(24)), hourly["hours"]
    values = hourly["predicted_indoor_temperature_C"]
    assert len(values) == 24 and all(isinstance(value, (int, float)) and math.isfinite(float(value)) for value in values)
    expected_hourly = hourly_example["prediction"]["predicted_indoor_temperature_C"]
    assert all(math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=1e-9) for a, b in zip(values, expected_hourly)), (
        "HTTP hourly response differs from the verified unseen-case helper example"
    )

    case_inputs = hourly_request["case_inputs"]
    expected_case_fields = {
        "Material", "Material_Category", "Thermal_Conductivity_W_mK", "Density_kg_m3",
        "Specific_Heat_J_kgK", "Wall_Thickness_m", "Shelter_Length_m", "Shelter_Width_m",
        "Shelter_Height_m", "Opening_Area_m2", "Window_Area_m2", "Door_Area_m2",
        "Orientation_deg", "External_Temperature_C", "Initial_Air_Temperature_C",
        "Solar_Radiation_W_m2", "Daily_Solar_Energy_kWh_m2", "Wind_Speed_m_s",
        "Relative_Humidity_percent", "Simulation_Duration_h", "Time_Step_min",
    }
    assert len(case_inputs) == 21 and set(case_inputs) == expected_case_fields, set(case_inputs)
    weather = hourly_request["hourly_climate"]
    assert len(weather) == 24 and [point["Hour"] for point in weather] == list(range(24))
    for field in ("Outdoor_Temperature_C", "Solar_Radiation_W_m2", "Wind_Speed_m_s"):
        series = [point[field] for point in weather]
        assert len(series) == 24 and all(isinstance(value, (int, float)) and math.isfinite(float(value)) for value in series)
    assert changed_design_request["case_inputs"]["Shelter_Length_m"] != case_inputs["Shelter_Length_m"]
    changed_values = changed_design["predicted_indoor_temperature_C"]
    assert len(changed_values) == 24 and all(math.isfinite(float(value)) for value in changed_values)
    assert any(not math.isclose(float(left), float(right), rel_tol=1e-9, abs_tol=1e-9)
               for left, right in zip(values, changed_values)), (
        "Changing shelter length did not change any hourly prediction for the selected test case"
    )

    wall_range = None
    # The saved inspection and separate model metadata are intentionally not
    # exposed by the API. The expected observed wall-thickness range is from
    # the audited fit rows and also appears in the hourly example diagnostics.
    for entry in out_of_range["diagnostics"]["out_of_observed_range"]:
        if entry["field"] == "Wall_Thickness_m":
            wall_range = entry
            break
    assert out_of_range["hours"] == list(range(24)) and len(out_of_range["predicted_indoor_temperature_C"]) == 24
    assert wall_range is not None and wall_range["value"] == 0.45, (
        "Wall thickness 0.45 m was not forwarded unchanged and diagnosed informationally"
    )
    assert out_of_range["diagnostics"]["message"], "Expected an informational out-of-range note"
    assert inspection["case_id_is_model_feature"] is False
    assert "Case_ID" not in inspection["model_feature_columns"]

    unsupported = json.loads(json.dumps(hourly_request))
    unsupported["case_inputs"]["Material"] = "Unsupported material"
    expect_422(f"{base_url}/predict-hourly", unsupported, "unsupported material")
    incomplete_profile = json.loads(json.dumps(hourly_request))
    incomplete_profile["hourly_climate"].pop()
    expect_422(f"{base_url}/predict-hourly", incomplete_profile, "23-point climate profile")

    print("GET /health: existing V3 summary artifact loads")
    print("POST /predict: all six values are finite and match the saved V3 example")
    print("POST /predict-hourly: exactly 24 finite predictions for hours 0–23; matches held-out helper example")
    print("POST /predict-hourly: request contains 21 model inputs, design context, and 24 outdoor/solar/wind records")
    print("POST /predict-hourly with changed shelter length: prediction changes")
    print("POST /predict-hourly with Wall_Thickness_m=0.45: prediction succeeds; unchanged value is reported as out of range")
    print("Unsupported category and incomplete weather profiles return HTTP 422")
    print("Hourly API smoke test passed")


if __name__ == "__main__":
    main()
