"""In-process FastAPI regression tests for the existing V3 routes."""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from api.main import app


ARTIFACT_DIR = Path(__file__).resolve().parents[1] / "ml" / "artifacts" / "v3"
SUMMARY_INPUT = json.loads((ARTIFACT_DIR / "example_input.json").read_text(encoding="utf-8"))
HOURLY_EXAMPLE = json.loads((ARTIFACT_DIR / "hourly_example_prediction.json").read_text(encoding="utf-8"))
SUMMARY_OUTPUTS = {
    "Average_Air_Temperature_C",
    "Minimum_Air_Temperature_C",
    "Maximum_Air_Temperature_C",
    "Solar_Heat_Input_W",
    "Heat_Transfer_Rate_W",
    "Thermal_Energy_Loss_Wh",
}
TEST_MATERIALS = {
    "stone": {"k": 1.70, "rho": 2200, "cp": 840, "t": 0.30},
    "brick": {"k": 0.72, "rho": 1800, "cp": 840, "t": 0.20},
    "insulation": {"k": 0.035, "rho": 40, "cp": 1400, "t": 0.05},
    "concrete": {"k": 1.40, "rho": 2300, "cp": 880, "t": 0.10},
}


def build_case_payload(case):
    layers = [case["material"], "insulation", "concrete"]
    baseline_thickness = sum(TEST_MATERIALS[layer]["t"] for layer in layers)
    thicknesses = [round(TEST_MATERIALS[layer]["t"] / baseline_thickness * case["wall"], 6)
                   for layer in layers[:-1]]
    thicknesses.append(round(case["wall"] - sum(thicknesses), 6))
    wall = round(sum(thicknesses), 6)
    resistance = sum(thickness / TEST_MATERIALS[layer]["k"]
                     for layer, thickness in zip(layers, thicknesses))
    mass_per_area = sum(thickness * TEST_MATERIALS[layer]["rho"]
                        for layer, thickness in zip(layers, thicknesses))
    heat_capacity_per_area = sum(thickness * TEST_MATERIALS[layer]["rho"] * TEST_MATERIALS[layer]["cp"]
                                 for layer, thickness in zip(layers, thicknesses))
    return {
        "Material": "Composite insulated wall",
        "Material_Category": "Composite",
        "Thermal_Conductivity_W_mK": wall / resistance,
        "Density_kg_m3": mass_per_area / wall,
        "Specific_Heat_J_kgK": heat_capacity_per_area / mass_per_area,
        "Wall_Thickness_m": wall,
        "Shelter_Length_m": case["length"],
        "Shelter_Width_m": case["width"],
        "Shelter_Height_m": case["height"],
        "Opening_Area_m2": case["window"] + case["door"],
        "Window_Area_m2": case["window"],
        "Door_Area_m2": case["door"],
        "Orientation_deg": case["orientation"],
        "External_Temperature_C": case["weather"]["External_Temperature_C"],
        "Initial_Air_Temperature_C": case["target"],
        "Solar_Radiation_W_m2": case["weather"]["Solar_Radiation_W_m2"],
        "Daily_Solar_Energy_kWh_m2": case["weather"]["Daily_Solar_Energy_kWh_m2"],
        "Wind_Speed_m_s": case["weather"]["Wind_Speed_m_s"],
        "Relative_Humidity_percent": case["weather"]["Relative_Humidity_percent"],
        "Simulation_Duration_h": 24,
        "Time_Step_min": 30,
        "Design_Context": {
            "location": case["location"],
            "occupants": case["occupants"],
            "primary_material": case["material"].title(),
        },
    }


class V3RouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)

    def test_health_and_material_catalog_are_ready(self):
        health = self.client.get("/health")
        self.assertEqual(health.status_code, 200)
        self.assertTrue(health.json()["model_loaded"])
        self.assertEqual(health.json()["model_version"], "V3")

        materials = self.client.get("/materials")
        self.assertEqual(materials.status_code, 200)
        self.assertEqual(len(materials.json()["materials"]), 7)

    def test_cors_preflight_allows_the_development_frontend_request(self):
        response = self.client.options("/predict", headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://localhost:5173")

    def test_valid_v3_prediction_echoes_inputs_and_returns_six_finite_outputs(self):
        response = self.client.post("/predict", json=SUMMARY_INPUT)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["model_version"], "V3")
        self.assertEqual(body["input_summary"], SUMMARY_INPUT)
        self.assertEqual(set(body["predictions"]), SUMMARY_OUTPUTS)
        self.assertTrue(all(math.isfinite(value) for value in body["predictions"].values()))

    def test_requested_leh_and_bengaluru_cases_return_real_v3_predictions(self):
        # Bengaluru climate numbers are deterministic forecast-shaped test fixtures,
        # not live observations; the app sources them from Open-Meteo at run time.
        cases = [
            {
                "location": "Leh, Ladakh", "length": 6, "width": 5, "height": 3,
                "occupants": 4, "window": 2, "door": 2, "orientation": 90,
                "target": 18, "material": "stone", "wall": 0.30,
                "weather": {
                    "External_Temperature_C": -12.8, "Solar_Radiation_W_m2": 850,
                    "Daily_Solar_Energy_kWh_m2": 5.1, "Wind_Speed_m_s": 12,
                    "Relative_Humidity_percent": 32,
                },
            },
            {
                "location": "Bengaluru, Karnataka", "length": 8, "width": 6, "height": 3.2,
                "occupants": 6, "window": 4.5, "door": 2.4, "orientation": 180,
                "target": 22, "material": "brick", "wall": 0.23,
                "weather": {
                    "External_Temperature_C": 24.2, "Solar_Radiation_W_m2": 910,
                    "Daily_Solar_Energy_kWh_m2": 5.6, "Wind_Speed_m_s": 2.7,
                    "Relative_Humidity_percent": 61.5,
                },
            },
        ]
        responses = []
        for case in cases:
            payload = build_case_payload(case)
            response = self.client.post("/predict", json=payload)
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()
            self.assertEqual(body["input_summary"], payload)
            self.assertEqual(set(body["predictions"]), SUMMARY_OUTPUTS)
            self.assertTrue(all(math.isfinite(value) for value in body["predictions"].values()))
            self.assertEqual(body["input_summary"]["Wall_Thickness_m"], case["wall"])
            responses.append(body)
        self.assertNotEqual(responses[0]["input_summary"], responses[1]["input_summary"])
        self.assertNotEqual(responses[0]["predictions"], responses[1]["predictions"])
        bengaluru_warnings = " ".join(responses[1]["warnings"])
        self.assertIn("Shelter_Length_m=8", bengaluru_warnings)
        self.assertIn("Shelter_Width_m=6", bengaluru_warnings)

    def test_invalid_input_is_rejected_and_out_of_range_values_are_preserved_with_diagnostics(self):
        invalid = dict(SUMMARY_INPUT, Shelter_Length_m=-1)
        self.assertEqual(self.client.post("/predict", json=invalid).status_code, 422)

        extrapolation = dict(SUMMARY_INPUT, Shelter_Length_m=6.5)
        response = self.client.post("/predict", json=extrapolation)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["input_summary"]["Shelter_Length_m"], 6.5)
        self.assertNotEqual(body["predictions"], self.client.post("/predict", json=SUMMARY_INPUT).json()["predictions"])
        self.assertTrue(any("Shelter_Length_m=6.5 is outside the training range" in warning
                            for warning in body["warnings"]))

    def test_hourly_route_returns_twenty_four_finite_temperatures(self):
        response = self.client.post("/predict-hourly", json={
            "case_inputs": HOURLY_EXAMPLE["case_inputs"],
            "hourly_climate": HOURLY_EXAMPLE["hourly_climate"],
        })
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["model_version"], "V3-Hourly-v1")
        self.assertEqual(body["hours"], list(range(24)))
        self.assertEqual(len(body["predicted_indoor_temperature_C"]), 24)
        self.assertTrue(all(math.isfinite(value) for value in body["predicted_indoor_temperature_C"]))


if __name__ == "__main__":
    unittest.main()
