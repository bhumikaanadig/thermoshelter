"""Live HTTP smoke test for the THERMOSHELTER V3 API."""

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
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
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


def verify_cors_preflight(url: str, origin: str) -> None:
    request = Request(
        url,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
        method="OPTIONS",
    )
    with urlopen(request, timeout=20) as response:
        allowed_origin = response.headers.get("access-control-allow-origin")
        allowed_methods = response.headers.get("access-control-allow-methods", "")
        allowed_headers = response.headers.get("access-control-allow-headers", "").lower()
        assert response.status == 200, f"Unexpected CORS preflight status: {response.status}"
        assert allowed_origin == origin, f"Vite origin was not allowed: {allowed_origin!r}"
        assert "POST" in allowed_methods, f"POST is not allowed by CORS: {allowed_methods!r}"
        assert "authorization" in allowed_headers, f"Authorization is not allowed by CORS: {allowed_headers!r}"


def verify_private_routes_reject_missing_auth(base_url: str) -> None:
    try:
        with urlopen(f"{base_url}/designs", timeout=20) as response:
            raise AssertionError(f"Unauthenticated persistence request unexpectedly returned HTTP {response.status}")
    except HTTPError as error:
        if error.code != 401:
            body = error.read().decode("utf-8", errors="replace")
            raise AssertionError(f"Expected unauthenticated persistence to return 401, got {error.code}: {body}") from error


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--cors-origin", default="http://localhost:5173")
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")

    example_input = json.loads((ARTIFACT_DIR / "example_input.json").read_text(encoding="utf-8"))
    expected = json.loads((ARTIFACT_DIR / "example_prediction.json").read_text(encoding="utf-8"))

    try:
        health = get_json(f"{base_url}/health")
        prediction = post_json(f"{base_url}/predict", example_input)
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"API returned HTTP {error.code}: {body}") from error
    except URLError as error:
        raise SystemExit(f"Could not reach {base_url}: {error.reason}") from error

    assert health == {
        "status": "ok",
        "api_running": True,
        "model_loaded": True,
        "model_version": "V3",
    }, f"Unexpected /health response: {health}"
    assert prediction["model_version"] == "V3", prediction
    assert prediction["input_summary"] == example_input, "API input summary differs from the supplied example"

    values = prediction.get("predictions", {})
    expected_values = expected.get("predictions", {})
    assert set(values) == set(expected_values), f"Unexpected prediction fields: {sorted(values)}"
    for name, value in values.items():
        assert isinstance(value, (int, float)) and not isinstance(value, bool), (
            f"{name} is not numeric: {value!r}"
        )
        assert math.isfinite(float(value)), f"{name} is not finite: {value!r}"
        assert math.isclose(float(value), float(expected_values[name]), rel_tol=1e-9, abs_tol=1e-9), (
            f"{name} differs from the saved V3 example: {value} vs {expected_values[name]}"
        )

    missing_required = dict(example_input)
    missing_required.pop("Material")
    expect_422(f"{base_url}/predict", missing_required, "missing required field")

    out_of_range = dict(example_input)
    out_of_range["Relative_Humidity_percent"] = 101
    expect_422(f"{base_url}/predict", out_of_range, "relative humidity range")

    invalid_dimension = dict(example_input)
    invalid_dimension["Shelter_Length_m"] = -1
    expect_422(f"{base_url}/predict", invalid_dimension, "negative shelter length")

    unsupported_category = dict(example_input)
    unsupported_category["Material_Category"] = "Unsupported category"
    expect_422(f"{base_url}/predict", unsupported_category, "unsupported material category")

    unsupported_material = dict(example_input)
    unsupported_material["Material"] = "Unsupported material"
    expect_422(f"{base_url}/predict", unsupported_material, "unsupported material")

    valid_extrapolation = dict(example_input)
    valid_extrapolation["Shelter_Length_m"] = 6.5
    extrapolation_prediction = post_json(f"{base_url}/predict", valid_extrapolation)
    assert extrapolation_prediction["input_summary"]["Shelter_Length_m"] == 6.5
    assert any("Shelter_Length_m=6.5 is outside the training range" in warning
               for warning in extrapolation_prediction.get("warnings", [])), (
        "A physically valid out-of-training-range length should be accepted with a warning."
    )

    design_context = {
        "location": "Leh, Ladakh",
        "occupants": 4,
        "primary_material": "Stone",
    }
    contextual_prediction = post_json(f"{base_url}/predict", {
        **example_input,
        "Design_Context": design_context,
    })
    assert contextual_prediction["input_summary"]["Design_Context"] == design_context
    assert contextual_prediction["predictions"] == prediction["predictions"], (
        "Design context must not alter the completed V3 model's outputs."
    )
    invalid_context = {**example_input, "Design_Context": {**design_context, "occupants": 0}}
    expect_422(f"{base_url}/predict", invalid_context, "nonpositive design-context occupant count")

    verify_cors_preflight(f"{base_url}/predict", args.cors_origin)
    verify_private_routes_reject_missing_auth(base_url)

    print("GET /health:")
    print(json.dumps(health, indent=2))
    print("POST /predict:")
    print(json.dumps(prediction, indent=2))
    print("Validation passed: missing, physically invalid, and unsupported categorical inputs return HTTP 422.")
    print("Training-range check passed: valid length 6.5 m was predicted and returned with an extrapolation warning.")
    print(f"CORS check passed for Authorization and Content-Type from {args.cors_origin}.")
    print("Design context is echoed for traceability and does not affect V3 inference.")
    print("Private persistence routes reject requests without a Firebase bearer token.")
    print("API smoke test passed: all six outputs are finite numeric values and match the saved V3 example.")


if __name__ == "__main__":
    main()
