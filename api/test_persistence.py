"""Route and repository contract checks using a small in-memory Firestore double."""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from api import main
from api.material_catalog import fallback_materials
from api.persistence import FirestoreRepository, PersistenceNotFound, validate_document_size


class ApiLifespanTest(unittest.TestCase):
    def test_startup_loads_the_v3_bundle_before_health_reports_ready(self):
        loaded_paths = []

        def fake_load_bundle(path):
            loaded_paths.append(path)
            return {"metadata": {}}

        with patch.object(main, "_load_bundle", side_effect=fake_load_bundle):
            with TestClient(main.app) as client:
                self.assertEqual(len(loaded_paths), 1)
                response = client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model_loaded"], True)
        self.assertEqual(len(loaded_paths), 2)


class Snapshot:
    def __init__(self, document_id: str, value: dict | None):
        self.id = document_id
        self.exists = value is not None
        self._value = copy.deepcopy(value)

    def to_dict(self):
        return copy.deepcopy(self._value)


class Document:
    def __init__(self, client, collection_name: str, document_id: str):
        self.client = client
        self.collection_name = collection_name
        self.id = document_id

    def get(self):
        value = self.client.data.get(self.collection_name, {}).get(self.id)
        return Snapshot(self.id, value)

    def set(self, value: dict, merge: bool = False):
        collection = self.client.data.setdefault(self.collection_name, {})
        previous = collection.get(self.id, {}) if merge else {}
        collection[self.id] = {**copy.deepcopy(previous), **copy.deepcopy(value)}

    def create(self, value: dict):
        collection = self.client.data.setdefault(self.collection_name, {})
        if self.id in collection:
            raise RuntimeError("AlreadyExists")
        collection[self.id] = copy.deepcopy(value)


class Query:
    def __init__(self, collection, predicate=None):
        self.collection = collection
        self.predicates = list(predicate or [])

    def where(self, field, operator, value):
        if operator != "==":
            raise AssertionError(f"Unsupported fake query operator: {operator}")
        return Query(self.collection, [*self.predicates, (field, value)])

    def stream(self):
        values = self.collection.client.data.get(self.collection.name, {})
        return [
            Snapshot(document_id, value)
            for document_id, value in values.items()
            if all(value.get(field) == expected for field, expected in self.predicates)
        ]


class Collection(Query):
    def __init__(self, client, name):
        self.client = client
        self.name = name
        super().__init__(self)

    def document(self, document_id=None):
        if document_id is None:
            import uuid
            document_id = uuid.uuid4().hex
        return Document(self.client, self.name, document_id)


class Batch:
    def __init__(self):
        self.pending = []

    def set(self, document, value, merge=False):
        self.pending.append((document, value, merge))

    def commit(self):
        for document, value, merge in self.pending:
            document.set(value, merge=merge)


class MemoryFirestore:
    def __init__(self):
        self.data = {}

    def collection(self, name):
        return Collection(self, name)

    def batch(self):
        return Batch()


class PersistenceRoutesTest(unittest.TestCase):
    def setUp(self):
        self.repository = FirestoreRepository(
            project_id="local-test",
            enabled=True,
        )
        self.owner_uid = "firebase-user-a"
        self.other_uid = "firebase-user-b"
        self.repository._firestore_client = MemoryFirestore()
        main.app.state.persistence_repository = self.repository

    def tearDown(self):
        if hasattr(main.app.state, "persistence_repository"):
            del main.app.state.persistence_repository

    @staticmethod
    def design_payload():
        return {
            "location": "leh",
            "occupants": 4,
            "target": 18,
            "priority": "comfort",
            "geometry": {
                "length": 5,
                "width": 4.8,
                "height": 2.8,
                "orientation": "S",
                "windowArea": 2.4,
                "doorArea": 1.8,
            },
            "layers": ["stone", "insulation", "concrete"],
            "layerThicknesses": None,
        }

    def save_named_design(self):
        request = main.SaveDesignRequest(
            name="Leh winter shelter",
            design=self.design_payload(),
            climate={"name": "Leh, Ladakh", "mean": -5},
            materials={"stone": fallback_materials()["stone"]},
        )
        return main.save_design(request, owner_uid=self.owner_uid)["design"]

    def test_a_original_materials_are_seeded_and_read(self):
        self.assertEqual(self.repository.seed_materials(), 7)
        self.repository._firestore_client.collection("materials").document("stone").set({"k": 1.71}, merge=True)
        self.assertEqual(self.repository.seed_materials(), 0)
        response = main.get_materials()
        self.assertEqual(response["source"], "firestore")
        self.assertEqual(response["materials"]["stone"]["k"], 1.71)
        self.assertEqual(response["materials"]["insulation"]["rho"], 40)

    def test_malformed_firestore_materials_fall_back_without_breaking_the_api(self):
        self.repository.seed_materials()
        self.repository._firestore_client.collection("materials").document("stone").set(
            {"name": 17, "k": float("nan")}, merge=True,
        )
        response = main.get_materials()
        self.assertEqual(response["source"], "local_fallback")
        self.assertEqual(set(response["materials"]), set(fallback_materials()))
        self.assertIn("malformed", response["warning"])

    def test_incomplete_cloud_material_set_falls_back_to_the_complete_catalog(self):
        self.repository._firestore_client.data["materials"] = {
            "stone": fallback_materials()["stone"],
        }
        response = main.get_materials()
        self.assertEqual(response["source"], "local_fallback")
        self.assertEqual(set(response["materials"]), set(fallback_materials()))
        self.assertIn("incomplete", response["warning"])

    def test_b_c_and_g_design_save_load_and_restore_exact_inputs(self):
        saved = self.save_named_design()
        self.assertTrue(saved["id"])
        self.assertTrue(saved["saved"])
        listed = main.list_designs(owner_uid=self.owner_uid)["designs"]
        self.assertEqual([design["id"] for design in listed], [saved["id"]])
        loaded = main.load_design(saved["id"], owner_uid=self.owner_uid)["design"]
        self.assertEqual(loaded["design"]["inputs"], self.design_payload())
        self.assertEqual(loaded["design"]["climate"]["name"], "Leh, Ladakh")

    def test_other_uid_cannot_list_load_update_or_read_history(self):
        saved = self.save_named_design()
        self.assertEqual(main.list_designs(owner_uid=self.other_uid)["designs"], [])
        for action in (
            lambda: main.load_design(saved["id"], owner_uid=self.other_uid),
            lambda: main.load_design_history(saved["id"], owner_uid=self.other_uid),
        ):
            with self.assertRaises(HTTPException) as denied:
                action()
            self.assertEqual(denied.exception.status_code, 404)
        with self.assertRaises(PersistenceNotFound):
            self.repository.save_design(
                design=self.design_payload(), name="Attempted takeover", design_id=saved["id"], owner_uid=self.other_uid,
            )
        with self.assertRaises(PersistenceNotFound):
            self.repository.save_prediction(
                design=self.design_payload(), climate=None, materials=None, design_id=saved["id"], model_version="V3",
                prediction_kind="summary", result={"predictions": {}}, diagnostics=None, owner_uid=self.other_uid,
            )
        with self.assertRaises(PersistenceNotFound):
            self.repository.save_optimization_run(
                design=self.design_payload(), climate=None, materials=None, design_id=saved["id"],
                search_scope={}, candidate_count=0,
                candidates=[], selected_candidate=None, metric="target gap", owner_uid=self.other_uid,
            )
        unchanged = main.load_design(saved["id"], owner_uid=self.owner_uid)["design"]
        self.assertEqual(unchanged["owner_uid"], self.owner_uid)
        self.assertEqual(unchanged["name"], "Leh winter shelter")

    def test_d_and_e_summary_and_hourly_predictions_are_stored(self):
        design = self.save_named_design()
        summary = main.save_prediction_record(main.PersistPredictionRequest(
            design=self.design_payload(),
            design_id=design["id"],
            model_version="V3",
            prediction_kind="summary",
            result={"predictions": {"Average_Air_Temperature_C": 17.2}},
            diagnostics={"numericOutOfRange": []},
        ), owner_uid=self.owner_uid)["prediction"]
        hourly_profile = {
            "source": "Open-Meteo Forecast API",
            "localDate": "2026-09-28",
            "hourlyClimate": [{"Hour": hour, "Outdoor_Temperature_C": 2.0} for hour in range(24)],
        }
        hourly = main.save_prediction_record(main.PersistPredictionRequest(
            design=self.design_payload(),
            design_id=design["id"],
            model_version="V3-Hourly-v1",
            prediction_kind="hourly",
            result={"hours": list(range(24)), "predicted_indoor_temperature_C": [18.0] * 24},
            diagnostics={"out_of_observed_range": []},
            weather_profile=hourly_profile,
        ), owner_uid=self.owner_uid)["prediction"]
        history = main.load_design_history(design["id"], owner_uid=self.owner_uid)
        self.assertEqual(summary["model_version"], "V3")
        self.assertEqual(hourly["model_version"], "V3-Hourly-v1")
        self.assertEqual(hourly["model_name"], "V3 Hourly Surrogate")
        self.assertEqual(len(hourly["result"]["predicted_indoor_temperature_C"]), 24)
        self.assertEqual(len(summary["input_snapshot"]["design"]), len(self.design_payload()))
        self.assertEqual(history["hourly_predictions"][0]["id"], hourly["id"])
        self.assertEqual(history["hourly_predictions"][0]["weather_profile"]["localDate"], "2026-09-28")
        self.assertEqual(len(history["predictions"]), 1)

    def test_f_optimization_run_and_selected_candidate_are_stored(self):
        design = self.save_named_design()
        candidates = [
            {"label": "Stone · 0.2 m", "prediction": {"average_C": 17.4}},
            {"label": "Brick · 0.2 m", "prediction": {"average_C": 16.9}},
        ]
        result = main.save_optimization_record(main.PersistOptimizationRequest(
            design=self.design_payload(),
            design_id=design["id"],
            search_scope={"method": "balanced V3 screen"},
            candidate_count=2,
            candidates=candidates,
            selected_candidate=candidates[0],
            metric="Absolute target gap in °C",
        ), owner_uid=self.owner_uid)["optimization_run"]
        history = main.load_design_history(design["id"], owner_uid=self.owner_uid)
        self.assertEqual(result["result_type"], "surrogate_design_space_search")
        self.assertEqual(result["owner_uid"], self.owner_uid)
        self.assertEqual(result["candidate_count"], len(result["candidates"]))
        self.assertEqual(history["optimization_runs"][0]["selected_candidate"]["label"], "Stone · 0.2 m")

    def test_invalid_or_unavailable_records_return_safe_errors(self):
        with self.assertRaises(HTTPException) as missing:
            main.load_design("not-present", owner_uid=self.owner_uid)
        self.assertEqual(missing.exception.status_code, 404)
        with self.assertRaises(ValueError):
            validate_document_size({"large": "x" * 900_000})
        main.app.state.persistence_repository.enabled = False
        main.app.state.persistence_repository.writes_allowed = False
        with self.assertRaises(HTTPException) as disabled:
            main.list_designs(owner_uid=self.owner_uid)
        self.assertEqual(disabled.exception.status_code, 503)

    def test_missing_and_invalid_bearer_tokens_fail_closed(self):
        with self.assertRaises(HTTPException) as missing:
            main.authenticated_uid(None)
        self.assertEqual(missing.exception.status_code, 401)

        original = main.verify_firebase_id_token
        try:
            def fake_verify(token):
                if token == "valid":
                    return {"uid": self.owner_uid}
                raise main.InvalidFirebaseToken("invalid")
            main.verify_firebase_id_token = fake_verify
            from fastapi.security import HTTPAuthorizationCredentials
            self.assertEqual(
                main.authenticated_uid(HTTPAuthorizationCredentials(scheme="Bearer", credentials="valid")),
                self.owner_uid,
            )
            with self.assertRaises(HTTPException) as invalid:
                main.authenticated_uid(HTTPAuthorizationCredentials(scheme="Bearer", credentials="expired"))
            self.assertEqual(invalid.exception.status_code, 401)
        finally:
            main.verify_firebase_id_token = original

    def test_client_cannot_set_owner_uid(self):
        with self.assertRaises(ValueError):
            main.SaveDesignRequest(name="Spoofed", design=self.design_payload(), owner_uid=self.other_uid)


if __name__ == "__main__":
    unittest.main(verbosity=2)
