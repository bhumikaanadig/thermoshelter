"""Opt-in live Firebase Authentication and Cloud Firestore HTTP acceptance check.

Requires a running FastAPI service, an enabled Firestore project, Firebase Admin
ADC, and Anonymous sign-in. It creates two temporary anonymous Auth users and
tagged records, then removes only those users and records. The shared materials
collection is intentionally seeded and left in place.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import subprocess
from statistics import fmean
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.material_catalog import fallback_materials
from api.persistence import FirestoreRepository, get_firebase_admin_app, verify_firebase_id_token

def firebase_anonymous_sign_in(api_key: str, web_origin: str) -> tuple[str, str, str]:
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={api_key}"
    request = Request(
        url,
        data=json.dumps({"returnSecureToken": True}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Referer": web_origin},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(f"Firebase anonymous sign-in failed (HTTP {error.code}).") from error
    except URLError as error:
        raise RuntimeError(f"Could not reach Firebase Authentication: {error.reason}") from error
    token = result.get("idToken")
    uid = result.get("localId")
    refresh_token = result.get("refreshToken")
    if not all(isinstance(value, str) and value for value in (token, uid, refresh_token)):
        raise RuntimeError("Firebase did not return an anonymous ID token, UID, and refresh token.")
    return token, uid, refresh_token


def firebase_refresh_anonymous_token(api_key: str, refresh_token: str) -> tuple[str, str]:
    url = f"https://securetoken.googleapis.com/v1/token?key={api_key}"
    body = urlencode({"grant_type": "refresh_token", "refresh_token": refresh_token}).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(f"Firebase ID-token refresh failed (HTTP {error.code}).") from error
    except URLError as error:
        raise RuntimeError(f"Could not reach Firebase token refresh: {error.reason}") from error
    token = result.get("id_token")
    uid = result.get("user_id")
    if not isinstance(token, str) or not isinstance(uid, str):
        raise RuntimeError("Firebase did not return a refreshed ID token and UID.")
    return token, uid


def fetch_open_meteo_profile() -> dict:
    """Fetch the next complete Leh local day using the same Open-Meteo fields as the UI."""
    query = urlencode({
        "latitude": "34.1526",
        "longitude": "77.5771",
        "hourly": "temperature_2m,shortwave_radiation,wind_speed_10m,relative_humidity_2m",
        "temperature_unit": "celsius",
        "wind_speed_unit": "ms",
        "timezone": "auto",
        "forecast_days": "3",
    })
    request = Request(
        f"https://api.open-meteo.com/v1/forecast?{query}",
        headers={"Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(f"Open-Meteo forecast failed (HTTP {error.code}).") from error
    except URLError as error:
        raise RuntimeError(f"Could not reach Open-Meteo: {error.reason}") from error

    hourly = body.get("hourly", {})
    zone_name = body.get("timezone")
    timestamps = hourly.get("time")
    fields = ("temperature_2m", "shortwave_radiation", "wind_speed_10m", "relative_humidity_2m")
    if not isinstance(zone_name, str) or not isinstance(timestamps, list):
        raise RuntimeError("Open-Meteo returned an incomplete forecast profile.")
    if any(not isinstance(hourly.get(field), list) or len(hourly[field]) != len(timestamps) for field in fields):
        raise RuntimeError("Open-Meteo returned an incomplete hourly weather series.")

    local_today = datetime.now(ZoneInfo(zone_name)).date().isoformat()
    future_dates = sorted({str(timestamp)[:10] for timestamp in timestamps if str(timestamp)[:10] > local_today})
    if not future_dates:
        raise RuntimeError("Open-Meteo returned no future local forecast day.")
    forecast_date = future_dates[0]
    indices = [index for index, value in enumerate(timestamps) if str(value).startswith(f"{forecast_date}T")]
    if len(indices) != 24:
        raise RuntimeError(f"Open-Meteo returned {len(indices)} hours for the selected local day; expected 24.")

    display_points = []
    hourly_climate = []
    for hour, index in enumerate(indices):
        timestamp = str(timestamps[index])
        if timestamp[11:16] != f"{hour:02d}:00":
            raise RuntimeError("Open-Meteo's selected forecast day is not a midnight-to-midnight hourly profile.")
        values = [hourly[field][index] for field in fields]
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in values):
            raise RuntimeError("Open-Meteo returned a nonnumeric forecast value.")
        outdoor, solar, wind, humidity = map(float, values)
        display_points.append({
            "Hour": hour,
            "localTime": timestamp,
            "Outdoor_Temperature_C": outdoor,
            "Solar_Radiation_W_m2": solar,
            "Wind_Speed_m_s": wind,
            "relativeHumidityPercent": humidity,
        })
        hourly_climate.append({
            "Hour": hour,
            "Outdoor_Temperature_C": outdoor,
            "Solar_Radiation_W_m2": solar,
            "Wind_Speed_m_s": wind,
        })

    temperatures = [point["Outdoor_Temperature_C"] for point in display_points]
    solar_values = [point["Solar_Radiation_W_m2"] for point in display_points]
    winds = [point["Wind_Speed_m_s"] for point in display_points]
    humidities = [point["relativeHumidityPercent"] for point in display_points]
    return {
        "source": "Open-Meteo Forecast API",
        "sourceUrl": "https://open-meteo.com/en/docs",
        "license": "CC BY 4.0",
        "location": "Leh, Ladakh",
        "latitude": 34.1526,
        "longitude": 77.5771,
        "timezone": zone_name,
        "localDate": forecast_date,
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "hourlyClimate": hourly_climate,
        "displayPoints": display_points,
        "caseClimateSummary": {
            "External_Temperature_C": fmean(temperatures),
            "Solar_Radiation_W_m2": max(solar_values),
            "Daily_Solar_Energy_kWh_m2": sum(solar_values) / 1000,
            "Wind_Speed_m_s": fmean(winds),
            "Relative_Humidity_percent": fmean(humidities),
        },
    }


def build_application_payloads(design: dict, materials: dict, climate: dict,
                               weather_profile: dict) -> dict:
    helper = ROOT / "api" / "test_firebase_cloud_payloads.mjs"
    try:
        completed = subprocess.run(
            ["node", str(helper)],
            input=json.dumps({
                "design": design,
                "materials": materials,
                "climate": climate,
                "weatherProfile": weather_profile,
            }, allow_nan=False),
            text=True,
            capture_output=True,
            check=True,
            cwd=ROOT,
            timeout=60,
        )
    except FileNotFoundError as error:
        raise RuntimeError("Node.js is required to run the application's real V3 payload builders.") from error
    except subprocess.CalledProcessError as error:
        raise RuntimeError(f"The application payload builder failed (exit {error.returncode}).") from error
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("The application payload builder returned invalid JSON.") from error


def api_request(base_url: str, path: str, token: str | None = None,
                payload: dict | None = None) -> tuple[int, dict]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    request = Request(f"{base_url.rstrip('/')}{path}", data=data, headers=headers,
                      method="POST" if payload is not None else "GET")
    try:
        with urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {"detail": "The API returned an unreadable error."}
        return error.code, body
    except URLError as error:
        raise RuntimeError(f"Could not reach the FastAPI service at {base_url}: {error.reason}") from error


def expect_api(base_url: str, method: str, path: str, token: str,
               payload: dict | None = None, status: int = 200) -> dict:
    actual_status, body = api_request(base_url, path, token, payload)
    if actual_status != status:
        raise AssertionError(f"{method} {path}: expected HTTP {status}, got {actual_status}.")
    return body


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")
    project_id = os.getenv("FIREBASE_PROJECT_ID", "").strip()
    api_key = (os.getenv("THERMOSHELTER_FIREBASE_TEST_API_KEY")
               or os.getenv("VITE_FIREBASE_API_KEY", "")).strip()
    web_origin = os.getenv("THERMOSHELTER_FIREBASE_TEST_ORIGIN", "http://localhost:5173/").strip()
    if project_id != "thermoshelter-df048":
        raise SystemExit("FIREBASE_PROJECT_ID is missing or does not match the configured THERMOSHELTER project.")
    if os.getenv("THERMOSHELTER_FIRESTORE_ENABLED", "false").lower() != "true":
        raise SystemExit("Set THERMOSHELTER_FIRESTORE_ENABLED=true in the API and test-runner environments.")
    if not api_key:
        raise SystemExit("Set THERMOSHELTER_FIREBASE_TEST_API_KEY or VITE_FIREBASE_API_KEY for anonymous auth.")

    repository = FirestoreRepository()
    if not repository.enabled:
        raise SystemExit("Firestore is not enabled. Check API environment and Admin ADC configuration.")
    configured_credential = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if configured_credential and not Path(configured_credential).is_file():
        raise SystemExit("The configured Google credential file is not available to this test process.")

    # Keep any SDK initialization details out of the console; they can include local credential paths.
    import logging
    logging.getLogger("thermoshelter.persistence").disabled = True
    try:
        admin_app = get_firebase_admin_app(project_id)
        if admin_app.project_id != project_id:
            raise RuntimeError("Firebase Admin resolved a different project.")
        client = repository._client()  # noqa: SLF001 - verify the actual Admin/Firestore connection.
        seeded = repository.seed_materials()
        material_rows = repository.list_materials()
    except Exception as error:
        raise SystemExit(f"Firebase Admin or Firestore initialization failed ({error.__class__.__name__}).") from None

    material_rows = repository.list_materials()
    material_ids = {row.get("id") for row in material_rows}
    if material_ids != set(fallback_materials()):
        raise AssertionError(f"Firestore material IDs differ from the existing catalog: {sorted(material_ids)}")

    material_status, material_body = api_request(base_url, "/materials")
    if material_status != 200 or material_body.get("source") != "firestore":
        raise AssertionError("The running FastAPI service is not reading the complete Firestore material catalog.")
    materials = material_body["materials"]

    design = {
        "location": "leh", "occupants": 4, "target": 18, "priority": "comfort",
        "geometry": {"length": 5, "width": 4.8, "height": 2.8, "orientation": "S",
                     "windowArea": 2.4, "doorArea": 1.8},
        "layers": ["stone", "insulation", "concrete"], "layerThicknesses": None,
    }
    climate = {
        "name": "Leh, Ladakh", "mean": -5, "amp": 9, "solar": 850,
        "wind": 12, "humidity": 32, "elevation": "3,500 m", "season": "Winter reference",
    }
    weather_profile = fetch_open_meteo_profile()
    application_payloads = build_application_payloads(design, materials, climate, weather_profile)
    summary_input = application_payloads["summaryPayload"]
    hourly_payload = application_payloads["hourlyPayload"]
    optimization_candidates = application_payloads["candidates"]
    if len(optimization_candidates) != 36:
        raise AssertionError(f"The existing app optimization generated {len(optimization_candidates)} candidates; expected 36.")

    users: list[str] = []
    test_documents: list[tuple[str, str]] = []
    cleanup_failures: list[str] = []
    try:
        first_token, first_uid, first_refresh_token = firebase_anonymous_sign_in(api_key, web_origin)
        users.append(first_uid)
        second_token, second_uid, _ = firebase_anonymous_sign_in(api_key, web_origin)
        users.append(second_uid)
        if first_uid == second_uid:
            raise AssertionError("Two anonymous sign-ins returned the same UID.")
        if verify_firebase_id_token(first_token).get("uid") != first_uid:
            raise AssertionError("Admin SDK did not verify the first Firebase ID token.")
        if verify_firebase_id_token(second_token).get("uid") != second_uid:
            raise AssertionError("Admin SDK did not verify the second Firebase ID token.")
        refreshed_token, refreshed_uid = firebase_refresh_anonymous_token(api_key, first_refresh_token)
        if refreshed_uid != first_uid or verify_firebase_id_token(refreshed_token).get("uid") != first_uid:
            raise AssertionError("Firebase token refresh did not preserve the authenticated UID.")
        first_token = refreshed_token

        # Ensure the running API itself is enforcing Firebase auth before touching records.
        status, _ = api_request(base_url, "/designs")
        if status != 401:
            raise AssertionError(f"Unauthenticated GET /designs returned HTTP {status}, expected 401.")
        status, _ = api_request(base_url, "/designs", token="malformed")
        if status != 401:
            raise AssertionError(f"Malformed bearer token returned HTTP {status}, expected 401.")

        saved = expect_api(base_url, "POST", "/designs", first_token, {
            "name": "Disposable cloud acceptance design", "design": design,
            "climate": climate, "materials": materials,
        }, status=201)["design"]
        test_documents.append(("designs", saved["id"]))
        assert saved.get("owner_uid") == first_uid
        assert saved.get("saved") is True
        assert saved.get("created_at") and saved.get("updated_at")
        assert saved["design"] == {"inputs": design, "climate": climate, "materials": materials}

        loaded = expect_api(base_url, "GET", f"/designs/{saved['id']}", first_token)["design"]
        assert loaded["owner_uid"] == first_uid
        assert loaded["design"] == saved["design"]
        assert loaded["created_at"] == saved["created_at"]
        listed = expect_api(base_url, "GET", "/designs", first_token)["designs"]
        assert any(row["id"] == saved["id"] for row in listed)
        assert expect_api(base_url, "GET", "/designs", second_token)["designs"] == []
        expect_api(base_url, "GET", f"/designs/{saved['id']}", second_token, status=404)
        overwrite = api_request(base_url, "/designs", second_token, {
            "name": "Unauthorized replacement", "design_id": saved["id"],
            "design": {**design, "target": 99}, "climate": climate, "materials": materials,
        })
        if overwrite[0] != 404:
            raise AssertionError("A second UID could modify another owner's saved design.")
        assert expect_api(base_url, "GET", f"/designs/{saved['id']}", first_token)["design"]["design"]["inputs"] == design

        summary_status, summary_result = api_request(base_url, "/predict", payload=summary_input)
        if summary_status != 200 or summary_result.get("model_version") != "V3":
            raise AssertionError(f"POST /predict failed during cloud acceptance: {summary_status}")
        if summary_result.get("input_summary") != summary_input or len(summary_result.get("predictions", {})) != 6:
            raise AssertionError("POST /predict did not return the app-built 21-input, six-output V3 result.")
        summary_record = expect_api(base_url, "POST", "/records/predictions", first_token, {
            "design": design, "climate": climate, "materials": materials,
            "design_id": saved["id"], "model_version": "V3", "prediction_kind": "summary",
            "result": summary_result, "diagnostics": {"warnings": summary_result.get("warnings", [])},
        }, status=201)["prediction"]
        test_documents.append(("predictions", summary_record["id"]))
        assert summary_record.get("owner_uid") == first_uid
        assert summary_record.get("design_id") == saved["id"]
        assert summary_record.get("model_version") == "V3"
        assert summary_record.get("result") == summary_result
        assert summary_record.get("input_snapshot") == {
            "design": design, "climate": climate, "materials": materials,
        }
        assert summary_record.get("created_at")

        hourly_status, hourly_result = api_request(base_url, "/predict-hourly", payload=hourly_payload)
        if (hourly_status != 200 or hourly_result.get("hours") != list(range(24))
                or len(hourly_result.get("predicted_indoor_temperature_C", [])) != 24):
            raise AssertionError(f"POST /predict-hourly failed during cloud acceptance: {hourly_status}")
        hourly_profile = weather_profile
        hourly_record = expect_api(base_url, "POST", "/records/predictions", first_token, {
            "design": design, "climate": climate, "materials": materials,
            "design_id": saved["id"], "model_version": "V3-Hourly-v1", "prediction_kind": "hourly",
            "result": hourly_result, "diagnostics": hourly_result.get("diagnostics", {}),
            "weather_profile": hourly_profile,
        }, status=201)["prediction"]
        test_documents.append(("hourlyPredictions", hourly_record["id"]))
        assert hourly_record.get("owner_uid") == first_uid
        assert hourly_record.get("design_id") == saved["id"]
        assert hourly_record.get("model_version") == "V3-Hourly-v1"
        assert hourly_record.get("result") == hourly_result
        assert len(hourly_record["result"].get("predicted_indoor_temperature_C", [])) == 24
        assert hourly_record["result"].get("hours") == list(range(24))
        assert hourly_record.get("weather_profile") == weather_profile
        assert hourly_record.get("created_at")

        # Use the application's 36-candidate builder, then persist each actual API response.
        def run_candidate(candidate: dict) -> dict:
            candidate_status, candidate_result = api_request(
                base_url, "/predict", payload=candidate["payload"],
            )
            if candidate_status != 200 or candidate_result.get("model_version") != "V3":
                raise AssertionError("An application-generated V3 optimization request failed.")
            if candidate_result.get("input_summary") != candidate["payload"]:
                raise AssertionError("A V3 optimization response does not match its submitted input.")
            if len(candidate_result.get("predictions", {})) != 6:
                raise AssertionError("A V3 optimization response did not contain six outputs.")
            return {
                "label": candidate["label"],
                "configuration": candidate["configuration"],
                "search_factors": candidate["searchFactors"],
                "input": candidate["payload"],
                "prediction": candidate_result,
                "diagnostics": candidate["diagnostics"],
            }

        with ThreadPoolExecutor(max_workers=8) as pool:
            candidates = list(pool.map(run_candidate, optimization_candidates))
        for candidate in candidates:
            candidate["target_deviation_C"] = abs(
                candidate["prediction"]["predictions"]["Average_Air_Temperature_C"] - design["target"]
            )
        selected = min(candidates, key=lambda row: row["target_deviation_C"])
        selected_candidate = {
            "label": selected["label"], "configuration": selected["configuration"],
            "prediction": selected["prediction"],
            "target_deviation_C": selected["target_deviation_C"],
        }
        optimization_record = expect_api(base_url, "POST", "/records/optimization-runs", first_token, {
            "design": design, "climate": climate, "materials": materials,
            "design_id": saved["id"],
            "search_scope": {"method": "existing app V3 material, thickness, and geometry search"},
            "candidate_count": len(candidates), "candidates": candidates,
            "selected_candidate": selected_candidate,
            "metric": "Absolute V3 average-temperature target gap (°C)",
        }, status=201)["optimization_run"]
        test_documents.append(("optimizationRuns", optimization_record["id"]))
        assert optimization_record.get("owner_uid") == first_uid
        assert optimization_record.get("design_id") == saved["id"]
        assert optimization_record.get("candidate_count") == 36
        assert len(optimization_record.get("candidates", [])) == 36
        assert optimization_record.get("candidates") == candidates
        assert optimization_record.get("selected_candidate") == selected_candidate
        assert optimization_record.get("created_at")

        # Ownership is checked at both read and write boundaries through FastAPI.
        expect_api(base_url, "POST", "/records/predictions", second_token, {
            "design": design, "climate": climate, "materials": materials,
            "design_id": saved["id"], "model_version": "V3", "prediction_kind": "summary",
            "result": summary_result, "diagnostics": {},
        }, status=404)
        expect_api(base_url, "POST", "/records/optimization-runs", second_token, {
            "design": design, "climate": climate, "materials": materials,
            "design_id": saved["id"], "search_scope": {}, "candidate_count": 0,
            "candidates": [], "selected_candidate": None, "metric": "test",
        }, status=404)
        expect_api(base_url, "GET", f"/designs/{saved['id']}/history", second_token, status=404)
        history = expect_api(base_url, "GET", f"/designs/{saved['id']}/history", first_token)
        summary_readback = next(row for row in history["predictions"] if row["id"] == summary_record["id"])
        hourly_readback = next(row for row in history["hourly_predictions"] if row["id"] == hourly_record["id"])
        optimization_readback = next(row for row in history["optimization_runs"]
                                     if row["id"] == optimization_record["id"])
        assert summary_readback["result"] == summary_result
        assert summary_readback["input_snapshot"] == summary_record["input_snapshot"]
        assert summary_readback["owner_uid"] == first_uid and summary_readback["created_at"]
        assert hourly_readback["result"] == hourly_result
        assert hourly_readback["weather_profile"]["localDate"] == weather_profile["localDate"]
        assert len(hourly_readback["result"]["predicted_indoor_temperature_C"]) == 24
        assert optimization_readback["candidates"] == candidates
        assert optimization_readback["selected_candidate"] == selected_candidate
        assert optimization_readback["owner_uid"] == first_uid and optimization_readback["created_at"]

        print("Firebase Admin project, Firestore, anonymous Auth, token refresh, and ID-token verification: PASS")
        print(f"Firestore material catalog: PASS ({len(material_ids)} IDs; created this run: {seeded})")
        print("Design save/load, ownership, and cross-UID read/write isolation: PASS")
        print("App-built V3 result and Open-Meteo 24-hour result persistence/readback: PASS")
        print("Existing 36-candidate optimization persistence/readback and history: PASS")
    finally:
        for collection, document_id in reversed(test_documents):
            try:
                client.collection(collection).document(document_id).delete()
            except Exception as error:
                cleanup_failures.append(f"{collection}:{error.__class__.__name__}")
        if users:
            from firebase_admin import auth
            for uid in users:
                try:
                    auth.delete_user(uid)
                except Exception as error:
                    cleanup_failures.append(f"temporary-auth-user:{error.__class__.__name__}")
        if cleanup_failures:
            print("Cleanup warning: one or more disposable test records/accounts could not be deleted.")
            if sys.exc_info()[0] is None:
                raise RuntimeError("Cloud acceptance passed, but temporary test data cleanup was incomplete.")


if __name__ == "__main__":
    main()
