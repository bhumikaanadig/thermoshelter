"""Small server-side Firestore adapter for THERMOSHELTER persistence."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

try:
    from .material_catalog import fallback_materials
except ImportError:  # Support the historical ``import main`` test pattern.
    from material_catalog import fallback_materials


logger = logging.getLogger("thermoshelter.persistence")
MAX_DOCUMENT_BYTES = 850_000


class PersistenceUnavailable(RuntimeError):
    """Firestore is not configured or could not be reached."""


class PersistenceNotFound(RuntimeError):
    """A requested persisted document does not exist."""


class InvalidFirebaseToken(RuntimeError):
    """A Firebase ID token is missing, invalid, expired, or revoked."""


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validate_document_size(value: Any) -> None:
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ValueError("Persistence data must be finite, JSON-serializable values.") from error
    if len(encoded) > MAX_DOCUMENT_BYTES:
        raise ValueError("This record is too large to store in Firestore. Reduce the saved candidate detail.")


class FirestoreRepository:
    """Lazily create an Admin SDK client using Application Default Credentials.

    Private documents are scoped by the verified Firebase UID supplied by the API.
    Admin credentials stay on the API host.
    """

    def __init__(self, project_id: str | None = None, enabled: bool | None = None):
        self.project_id = project_id if project_id is not None else os.getenv("FIREBASE_PROJECT_ID", "").strip()
        enabled_value = os.getenv("THERMOSHELTER_FIRESTORE_ENABLED", "false").lower() == "true"
        self.enabled = bool(self.project_id) and (enabled_value if enabled is None else enabled)
        # Kept as a compatibility property for callers that distinguish read/write readiness.
        # Every private route independently requires a verified Firebase ID token.
        self.writes_allowed = self.enabled
        self._firestore_client = None

    def _client(self):
        if not self.enabled:
            raise PersistenceUnavailable("Firestore is not configured. Set FIREBASE_PROJECT_ID and enable it on the API.")
        if self._firestore_client is not None:
            return self._firestore_client
        try:
            from firebase_admin import credentials, firestore

            firebase_app = get_firebase_admin_app(self.project_id, credentials=credentials)
            self._firestore_client = firestore.client(app=firebase_app)
        except Exception as error:
            logger.exception("Could not initialize the Firestore Admin client")
            raise PersistenceUnavailable("Firestore is unavailable. Check API credentials and project configuration.") from error
        return self._firestore_client

    def _require_write_access(self) -> None:
        if not self.enabled:
            raise PersistenceUnavailable("Firestore persistence is disabled or not configured on this API.")

    @staticmethod
    def _doc_dict(snapshot) -> dict | None:
        if not snapshot.exists:
            return None
        return {**(snapshot.to_dict() or {}), "id": snapshot.id}

    def list_materials(self) -> list[dict]:
        client = self._client()
        docs = list(client.collection("materials").stream())
        rows = [self._doc_dict(doc) for doc in docs]
        rows = [row for row in rows if row]
        rows.sort(key=lambda row: row["id"])
        return rows

    def seed_materials(self) -> int:
        if not self.enabled:
            raise PersistenceUnavailable("Firestore is not configured for the material seed operation.")
        client = self._client()
        collection = client.collection("materials")
        materials = fallback_materials()
        seeded = 0
        for material_id, item in materials.items():
            reference = collection.document(material_id)
            if reference.get().exists:
                # Existing catalog records may have valid local edits; a repeat seed never overwrites them.
                continue
            data = {key: value for key, value in item.items() if key != "id"}
            now = utc_timestamp()
            data.update({"created_at": now, "updated_at": now})
            try:
                reference.create(data)
                seeded += 1
            except Exception as error:
                # A concurrent seed may have created this deterministic ID after our read.
                if error.__class__.__name__ not in {"AlreadyExists", "AlreadyExistsError"}:
                    raise
        return seeded

    def list_saved_designs(self, owner_uid: str) -> list[dict]:
        docs = (self._client().collection("designs")
                .where("owner_uid", "==", owner_uid)
                .where("saved", "==", True).stream())
        rows = [self._doc_dict(doc) for doc in docs]
        rows = [row for row in rows if row and row.get("saved") is True]
        rows.sort(key=lambda row: row.get("updated_at", ""), reverse=True)
        return rows

    def get_design(self, design_id: str, owner_uid: str) -> dict:
        snapshot = self._client().collection("designs").document(design_id).get()
        result = self._doc_dict(snapshot)
        if not result or result.get("owner_uid") != owner_uid or result.get("saved") is not True:
            raise PersistenceNotFound("Saved design was not found.")
        return result

    def _write_design(self, design: dict, name: str, saved: bool, owner_uid: str,
                      design_id: str | None = None, weather_profile: dict | None = None) -> dict:
        client = self._client()
        document_id = design_id or uuid4().hex
        reference = client.collection("designs").document(document_id)
        previous = self._doc_dict(reference.get())
        if previous and previous.get("owner_uid") != owner_uid:
            raise PersistenceNotFound("Saved design was not found.")
        now = utc_timestamp()
        record = {
            "owner_uid": owner_uid,
            "name": name.strip() or "Untitled shelter",
            "saved": saved,
            "design": design,
            "weather_profile": weather_profile,
            "created_at": previous.get("created_at", now) if previous else now,
            "updated_at": now,
        }
        validate_document_size(record)
        reference.set(record)
        return {"id": document_id, **record}

    def save_design(self, design: dict, name: str, owner_uid: str, design_id: str | None = None,
                    climate: dict | None = None, materials: dict | None = None) -> dict:
        self._require_write_access()
        snapshot = {"inputs": design, "climate": climate or {}, "materials": materials or {}}
        return self._write_design(snapshot, name, True, owner_uid, design_id)

    def _ensure_scenario(self, design: dict, climate: dict | None, materials: dict | None,
                         weather_profile: dict | None, owner_uid: str) -> str:
        scenario = self._write_design(
            {"inputs": design, "climate": climate or {}, "materials": materials or {}},
            "Prediction scenario", False, owner_uid, weather_profile=weather_profile,
        )
        return scenario["id"]

    def save_prediction(self, *, design: dict, climate: dict | None, materials: dict | None,
                        design_id: str | None, model_version: str, prediction_kind: str,
                        result: dict, diagnostics: dict | None,
                        owner_uid: str, weather_profile: dict | None = None) -> dict:
        self._require_write_access()
        client = self._client()
        if design_id:
            self.get_design(design_id, owner_uid)
        else:
            design_id = self._ensure_scenario(design, climate, materials, weather_profile, owner_uid)
        now = utc_timestamp()
        record = {
            "owner_uid": owner_uid,
            "design_id": design_id,
            "model_version": model_version,
            "model_name": "V3 Hourly Surrogate" if prediction_kind == "hourly" else "V3",
            "prediction_kind": prediction_kind,
            "input_snapshot": {"design": design, "climate": climate or {}, "materials": materials or {}},
            "result": result,
            "diagnostics": diagnostics or {},
            "weather_profile": weather_profile,
            "created_at": now,
        }
        validate_document_size(record)
        collection = "hourlyPredictions" if prediction_kind == "hourly" else "predictions"
        reference = client.collection(collection).document()
        reference.set(record)
        return {"id": reference.id, **record}

    def list_design_history(self, design_id: str, owner_uid: str) -> dict[str, list[dict]]:
        self.get_design(design_id, owner_uid)
        predictions_query = (self._client().collection("predictions")
                             .where("owner_uid", "==", owner_uid)
                             .where("design_id", "==", design_id).stream())
        hourly_query = (self._client().collection("hourlyPredictions")
                        .where("owner_uid", "==", owner_uid)
                        .where("design_id", "==", design_id).stream())
        runs_query = (self._client().collection("optimizationRuns")
                      .where("owner_uid", "==", owner_uid)
                      .where("design_id", "==", design_id).stream())
        predictions = [self._doc_dict(doc) for doc in predictions_query]
        hourly_predictions = [self._doc_dict(doc) for doc in hourly_query]
        optimization_runs = [self._doc_dict(doc) for doc in runs_query]
        predictions = sorted((row for row in predictions if row), key=lambda row: row.get("created_at", ""), reverse=True)
        hourly_predictions = sorted((row for row in hourly_predictions if row), key=lambda row: row.get("created_at", ""), reverse=True)
        optimization_runs = sorted((row for row in optimization_runs if row), key=lambda row: row.get("created_at", ""), reverse=True)
        return {"predictions": predictions, "hourly_predictions": hourly_predictions,
                "optimization_runs": optimization_runs}

    def save_optimization_run(self, *, design: dict, climate: dict | None, materials: dict | None,
                              design_id: str | None, search_scope: dict, candidate_count: int,
                              candidates: list[dict], selected_candidate: dict | None,
                              metric: str, owner_uid: str) -> dict:
        self._require_write_access()
        client = self._client()
        if design_id:
            self.get_design(design_id, owner_uid)
        else:
            design_id = self._ensure_scenario(design, climate, materials, None, owner_uid)
        now = utc_timestamp()
        record = {
            "owner_uid": owner_uid,
            "design_id": design_id,
            "model_version": "V3",
            "result_type": "surrogate_design_space_search",
            "search_scope": search_scope,
            "candidate_count": candidate_count,
            "candidates": candidates,
            "selected_candidate": selected_candidate,
            "metric": metric,
            "created_at": now,
        }
        validate_document_size(record)
        reference = client.collection("optimizationRuns").document()
        reference.set(record)
        return {"id": reference.id, **record}


def repository_for_app(app) -> FirestoreRepository:
    """Allow tests to inject an in-memory repository without Firebase credentials."""
    repository = getattr(app.state, "persistence_repository", None)
    if repository is not None:
        return repository
    if not hasattr(app.state, "firestore_repository"):
        app.state.firestore_repository = FirestoreRepository()
    return app.state.firestore_repository


def get_firebase_admin_app(project_id: str | None = None, credentials=None):
    """Return the configured Admin app, lazily initialized from ADC."""
    try:
        import firebase_admin
        from firebase_admin import credentials as admin_credentials
    except ImportError as error:
        raise PersistenceUnavailable("Firebase Admin SDK is unavailable on this API host.") from error

    project = (project_id or os.getenv("FIREBASE_PROJECT_ID", "")).strip()
    if not project:
        raise PersistenceUnavailable("Firebase project is not configured on this API host.")
    try:
        firebase_app = firebase_admin.get_app()
    except ValueError:
        firebase_app = firebase_admin.initialize_app(
            (credentials or admin_credentials).ApplicationDefault(),
            options={"projectId": project},
        )
    if firebase_app.project_id and firebase_app.project_id != project:
        raise PersistenceUnavailable("Firebase Admin is initialized for a different project.")
    return firebase_app


def verify_firebase_id_token(token: str) -> dict[str, Any]:
    """Verify a browser Firebase ID token and return its trusted decoded claims."""
    try:
        from firebase_admin import auth
        app = get_firebase_admin_app()
        claims = auth.verify_id_token(token, app=app)
    except ImportError as error:
        raise PersistenceUnavailable("Firebase Admin SDK is unavailable on this API host.") from error
    except PersistenceUnavailable:
        raise
    except ValueError as error:
        raise InvalidFirebaseToken("Invalid Firebase ID token.") from error
    except Exception as error:
        from firebase_admin import auth
        invalid_types = tuple(
            candidate for name in ("InvalidIdTokenError", "ExpiredIdTokenError", "RevokedIdTokenError", "UserDisabledError")
            if (candidate := getattr(auth, name, None)) is not None
        )
        if invalid_types and isinstance(error, invalid_types):
            raise InvalidFirebaseToken("Invalid Firebase ID token.") from error
        logger.exception("Firebase ID token verification is unavailable")
        raise PersistenceUnavailable("Firebase Authentication is temporarily unavailable.") from error
    if not isinstance(claims, dict) or not isinstance(claims.get("uid"), str) or not claims["uid"]:
        raise InvalidFirebaseToken("Invalid Firebase ID token.")
    return claims


def is_firestore_configured(repository: FirestoreRepository) -> bool:
    return bool(getattr(repository, "enabled", False))
