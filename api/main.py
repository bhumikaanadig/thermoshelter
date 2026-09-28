"""FastAPI wrapper for the saved THERMOSHELTER V3 surrogate."""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, model_validator


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ML_DIR = PROJECT_ROOT / "ml"
for import_path in (PROJECT_ROOT, ML_DIR):
    resolved_import_path = str(import_path)
    if resolved_import_path not in sys.path:
        sys.path.insert(0, resolved_import_path)

# Use the existing V3 helper for every prediction. Its shared helper applies
# the artifact's saved feature order, preprocessing, output constraints, and
# training-range warnings.
from predict import _load_bundle  # noqa: E402
from predict_v3 import DEFAULT_MODEL, predict_shelter  # noqa: E402
from predict_hourly import predict_hourly  # noqa: E402
try:  # noqa: E402
    from .material_catalog import fallback_materials
    from .persistence import (
        FirestoreRepository,
        PersistenceNotFound,
        PersistenceUnavailable,
        InvalidFirebaseToken,
        is_firestore_configured,
        repository_for_app,
        verify_firebase_id_token,
    )
except ImportError:  # Support running ``uvicorn main:app`` from the api folder.
    from material_catalog import fallback_materials
    from persistence import (
        FirestoreRepository,
        PersistenceNotFound,
        PersistenceUnavailable,
        InvalidFirebaseToken,
        is_firestore_configured,
        repository_for_app,
        verify_firebase_id_token,
    )


logger = logging.getLogger("thermoshelter.api")
MODEL_PATH = DEFAULT_MODEL.resolve()

DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
)
configured_origins = os.getenv("THERMOSHELTER_CORS_ORIGINS")
CORS_ORIGINS = (
    [origin.strip() for origin in configured_origins.split(",") if origin.strip()]
    if configured_origins
    else list(DEFAULT_CORS_ORIGINS)
)


Finite = Annotated[float, Field(allow_inf_nan=False)]
Positive = Annotated[float, Field(gt=0, allow_inf_nan=False)]
NonNegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]

NUMERIC_FIELDS = {
    "Thermal_Conductivity_W_mK",
    "Density_kg_m3",
    "Specific_Heat_J_kgK",
    "Wall_Thickness_m",
    "Shelter_Length_m",
    "Shelter_Width_m",
    "Shelter_Height_m",
    "Opening_Area_m2",
    "Window_Area_m2",
    "Door_Area_m2",
    "Orientation_deg",
    "External_Temperature_C",
    "Initial_Air_Temperature_C",
    "Solar_Radiation_W_m2",
    "Daily_Solar_Energy_kWh_m2",
    "Wind_Speed_m_s",
    "Relative_Humidity_percent",
    "Simulation_Duration_h",
    "Time_Step_min",
}


class ShelterInput(BaseModel):
    """All required V3 inputs with broad physical sanity limits."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    Material: str = Field(min_length=1, max_length=128)
    Material_Category: str = Field(min_length=1, max_length=128)
    Thermal_Conductivity_W_mK: Annotated[Positive, Field(le=500)]
    Density_kg_m3: Annotated[Positive, Field(le=30_000)]
    Specific_Heat_J_kgK: Annotated[Positive, Field(le=10_000)]
    Wall_Thickness_m: Annotated[Positive, Field(le=5)]
    Shelter_Length_m: Annotated[Positive, Field(le=100)]
    Shelter_Width_m: Annotated[Positive, Field(le=100)]
    Shelter_Height_m: Annotated[Positive, Field(le=100)]
    Opening_Area_m2: Annotated[NonNegative, Field(le=10_000)]
    Window_Area_m2: Annotated[NonNegative, Field(le=10_000)]
    Door_Area_m2: Annotated[NonNegative, Field(le=10_000)]
    Orientation_deg: Annotated[Finite, Field(ge=0, le=360)]
    External_Temperature_C: Annotated[Finite, Field(ge=-100, le=100)]
    Initial_Air_Temperature_C: Annotated[Finite, Field(ge=-100, le=100)]
    Solar_Radiation_W_m2: Annotated[NonNegative, Field(le=2_000)]
    Daily_Solar_Energy_kWh_m2: Annotated[NonNegative, Field(le=50)]
    Wind_Speed_m_s: Annotated[NonNegative, Field(le=150)]
    Relative_Humidity_percent: Annotated[Finite, Field(ge=0, le=100)]
    Simulation_Duration_h: Annotated[Positive, Field(le=24)]
    Time_Step_min: Annotated[Positive, Field(le=60)]

    @model_validator(mode="before")
    @classmethod
    def reject_boolean_numbers(cls, value: object) -> object:
        if isinstance(value, dict):
            boolean_fields = [
                name
                for name, item in value.items()
                if name in NUMERIC_FIELDS and isinstance(item, bool)
            ]
            if boolean_fields:
                raise ValueError(
                    "Boolean values are not valid numeric inputs: "
                    + ", ".join(boolean_fields)
                )
        return value


def _validate_v3_categories(payload: ShelterInput) -> None:
    """Reject categories the saved V3 model has never seen."""
    metadata = _load_bundle(str(MODEL_PATH)).get("metadata", {})
    supported_values = metadata.get("categorical_values", {})
    for field in ("Material", "Material_Category"):
        allowed = supported_values.get(field)
        if not isinstance(allowed, list) or not allowed:
            raise RuntimeError(f"The saved V3 model has no supported-value list for {field}.")
        value = getattr(payload, field)
        if value not in allowed:
            raise ValueError(
                f"Unsupported {field} value {value!r}; supported values are {allowed}."
            )


class ThermalPredictions(BaseModel):
    Average_Air_Temperature_C: float
    Minimum_Air_Temperature_C: float
    Maximum_Air_Temperature_C: float
    Solar_Heat_Input_W: float
    Heat_Transfer_Rate_W: float
    Thermal_Energy_Loss_Wh: float


class PredictResponse(BaseModel):
    model_version: Literal["V3"]
    input_summary: ShelterInput
    predictions: ThermalPredictions
    warnings: list[str]


class HourlyClimatePoint(BaseModel):
    """One real forecast or measured weather point for one requested hour."""

    model_config = ConfigDict(extra="forbid")

    Hour: Annotated[int, Field(strict=True, ge=0, le=23)]
    Outdoor_Temperature_C: Annotated[Finite, Field(ge=-100, le=100)]
    Solar_Radiation_W_m2: Annotated[NonNegative, Field(le=2_500)]
    Wind_Speed_m_s: Annotated[NonNegative, Field(le=150)]

    @model_validator(mode="before")
    @classmethod
    def reject_boolean_numbers(cls, value: object) -> object:
        if isinstance(value, dict):
            boolean_fields = [
                name for name, item in value.items()
                if name in {"Hour", "Outdoor_Temperature_C", "Solar_Radiation_W_m2", "Wind_Speed_m_s"}
                and isinstance(item, bool)
            ]
            if boolean_fields:
                raise ValueError("Boolean values are not valid hourly climate inputs: " + ", ".join(boolean_fields))
        return value


class HourlyPredictRequest(BaseModel):
    """Case design plus an explicit 24-point weather profile; no weather is synthesized."""

    model_config = ConfigDict(extra="forbid")

    case_inputs: ShelterInput
    hourly_climate: Annotated[list[HourlyClimatePoint], Field(min_length=24, max_length=24)]

    @model_validator(mode="after")
    def require_each_hour_once(self) -> "HourlyPredictRequest":
        hours = [point.Hour for point in self.hourly_climate]
        if sorted(hours) != list(range(24)):
            raise ValueError("hourly_climate must contain each Hour from 0 through 23 exactly once.")
        return self


class HourlyDiagnostic(BaseModel):
    field: str
    observed_range: list[float]
    hours: list[int] | None = None
    values: list[float] | None = None
    value: float | None = None


class HourlyDiagnostics(BaseModel):
    out_of_observed_range: list[HourlyDiagnostic]
    message: str | None


class HourlyPredictResponse(BaseModel):
    model_version: Literal["V3-Hourly-v1"]
    hours: list[int]
    predicted_indoor_temperature_C: list[float]
    diagnostics: HourlyDiagnostics


class SaveDesignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=1, max_length=120)]
    design: dict[str, Any]
    climate: dict[str, Any] = Field(default_factory=dict)
    materials: dict[str, Any] = Field(default_factory=dict)
    design_id: str | None = Field(default=None, min_length=1, max_length=128)


class PersistPredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    design: dict[str, Any]
    climate: dict[str, Any] = Field(default_factory=dict)
    materials: dict[str, Any] = Field(default_factory=dict)
    design_id: str | None = Field(default=None, min_length=1, max_length=128)
    model_version: Literal["V3", "V3-Hourly-v1"]
    prediction_kind: Literal["summary", "hourly"]
    result: dict[str, Any]
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    weather_profile: dict[str, Any] | None = None


class PersistOptimizationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    design: dict[str, Any]
    climate: dict[str, Any] = Field(default_factory=dict)
    materials: dict[str, Any] = Field(default_factory=dict)
    design_id: str | None = Field(default=None, min_length=1, max_length=128)
    search_scope: dict[str, Any]
    candidate_count: Annotated[int, Field(ge=0, le=500)]
    candidates: Annotated[list[dict[str, Any]], Field(max_length=500)]
    selected_candidate: dict[str, Any] | None = None
    metric: Annotated[str, Field(min_length=1, max_length=256)]

    @model_validator(mode="after")
    def candidate_count_matches_payload(self) -> "PersistOptimizationRequest":
        if self.candidate_count != len(self.candidates):
            raise ValueError("candidate_count must match the number of stored candidates.")
        return self


app = FastAPI(
    title="THERMOSHELTER API",
    description="FastAPI service for the saved V3 summary model and the separate hourly surrogate.",
    version="3.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/health", tags=["health"])
def health() -> dict[str, str | bool]:
    """Report whether the API is running and the V3 bundle can be loaded."""
    try:
        _load_bundle(str(MODEL_PATH))
    except Exception:
        logger.exception("The V3 model bundle could not be loaded")
        raise HTTPException(
            status_code=503,
            detail={
                "status": "unavailable",
                "api_running": True,
                "model_loaded": False,
                "model_version": "V3",
            },
        ) from None
    return {
        "status": "ok",
        "api_running": True,
        "model_loaded": True,
        "model_version": "V3",
    }


@app.post("/predict", response_model=PredictResponse, tags=["prediction"])
def predict(payload: ShelterInput) -> PredictResponse:
    """Return the six case-level thermal summary predictions from V3."""
    input_summary = payload.model_dump()
    try:
        _validate_v3_categories(payload)
        result = predict_shelter(input_summary, model_path=MODEL_PATH)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception:
        logger.exception("V3 inference failed")
        raise HTTPException(
            status_code=503,
            detail="V3 inference is temporarily unavailable.",
        ) from None

    return PredictResponse(
        model_version="V3",
        input_summary=payload,
        predictions=ThermalPredictions(**result["predictions"]),
        warnings=result.get("warnings", []),
    )


@app.post("/predict-hourly", response_model=HourlyPredictResponse, tags=["hourly prediction"])
def predict_hourly_endpoint(payload: HourlyPredictRequest) -> HourlyPredictResponse:
    """Predict 24 hourly indoor temperatures from a caller-supplied weather profile."""
    try:
        result = predict_hourly(
            payload.case_inputs.model_dump(),
            [point.model_dump() for point in payload.hourly_climate],
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except FileNotFoundError:
        raise HTTPException(
            status_code=503,
            detail="The separate hourly surrogate artifact is unavailable.",
        ) from None
    except Exception:
        logger.exception("Hourly surrogate inference failed")
        raise HTTPException(status_code=503, detail="Hourly inference is temporarily unavailable.") from None

    return HourlyPredictResponse(**result)


bearer_scheme = HTTPBearer(auto_error=False)


def authenticated_uid(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    """Return only the UID authenticated by Firebase Admin; never trust request data."""
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Sign in to access saved THERMOSHELTER data.")
    try:
        return verify_firebase_id_token(credentials.credentials)["uid"]
    except InvalidFirebaseToken:
        raise HTTPException(status_code=401, detail="Your saved-data session has expired. Please try again.") from None
    except PersistenceUnavailable:
        logger.exception("Firebase Authentication is not available for a persistence request")
        raise HTTPException(status_code=503, detail="Cloud persistence is currently unavailable.") from None
    except Exception:
        logger.exception("Firebase Authentication failed unexpectedly")
        raise HTTPException(status_code=503, detail="Cloud persistence is currently unavailable.") from None


def _firestore_repository_for_persistence():
    repository = repository_for_app(app)
    if not is_firestore_configured(repository):
        raise HTTPException(
            status_code=503,
            detail="Cloud persistence is currently unavailable.",
        )
    return repository


def _persistence_http_error(error: Exception) -> HTTPException:
    if isinstance(error, PersistenceNotFound):
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, ValueError):
        return HTTPException(status_code=422, detail=str(error))
    if isinstance(error, PersistenceUnavailable):
        return HTTPException(status_code=503, detail=str(error))
    logger.exception("Firestore persistence request failed", exc_info=error)
    return HTTPException(status_code=503, detail="Firestore persistence is temporarily unavailable.")


def _valid_material_record(material_id: str, material: dict) -> bool:
    import math

    if not isinstance(material_id, str) or not material_id or not isinstance(material, dict):
        return False
    if not all(isinstance(material.get(field), str) and material[field].strip()
               for field in ("name", "category")):
        return False
    for field in ("k", "rho", "cp", "t", "alpha"):
        value = material.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            return False
    return (
        material["k"] > 0 and material["rho"] > 0 and material["cp"] > 0
        and material["t"] > 0 and 0 <= material["alpha"] <= 1
    )


@app.get("/materials", tags=["materials"])
def get_materials() -> dict[str, Any]:
    """Return Firestore materials when valid, otherwise preserve the local catalog."""
    repository = repository_for_app(app)
    if is_firestore_configured(repository):
        try:
            rows = repository.list_materials()
            remote = {row.get("id"): row for row in rows if isinstance(row, dict)}
            expected_material_ids = set(fallback_materials())
            if set(remote) == expected_material_ids and all(
                _valid_material_record(key, value) for key, value in remote.items()
            ):
                return {"materials": remote, "source": "firestore", "warning": None}
            warning = (
                "The cloud material catalog is incomplete; the original project values are shown."
                if not rows or set(remote) != expected_material_ids else
                "The cloud material catalog is malformed; the original project values are shown."
            )
            return {"materials": fallback_materials(), "source": "local_fallback", "warning": warning}
        except Exception:
            logger.exception("Firestore materials could not be loaded; using the local material catalog")
            return {
                "materials": fallback_materials(),
                "source": "local_fallback",
                "warning": "Cloud materials are unavailable; the original project values are shown.",
            }
    return {
        "materials": fallback_materials(),
        "source": "local_fallback",
        "warning": "Cloud materials are not configured; the original project material values are shown.",
    }


@app.get("/designs", tags=["persistence"])
def list_designs(owner_uid: Annotated[str, Depends(authenticated_uid)]) -> dict[str, Any]:
    repository = _firestore_repository_for_persistence()
    try:
        return {"designs": repository.list_saved_designs(owner_uid)}
    except Exception as error:
        raise _persistence_http_error(error) from error


@app.post("/designs", status_code=201, tags=["persistence"])
def save_design(payload: SaveDesignRequest, owner_uid: Annotated[str, Depends(authenticated_uid)]) -> dict[str, Any]:
    repository = _firestore_repository_for_persistence()
    try:
        record = repository.save_design(
            design=payload.design,
            name=payload.name,
            design_id=payload.design_id,
            climate=payload.climate,
            materials=payload.materials,
            owner_uid=owner_uid,
        )
        return {"design": record}
    except Exception as error:
        raise _persistence_http_error(error) from error


@app.get("/designs/{design_id}", tags=["persistence"])
def load_design(design_id: str, owner_uid: Annotated[str, Depends(authenticated_uid)]) -> dict[str, Any]:
    repository = _firestore_repository_for_persistence()
    try:
        return {"design": repository.get_design(design_id, owner_uid)}
    except Exception as error:
        raise _persistence_http_error(error) from error


@app.get("/designs/{design_id}/history", tags=["persistence"])
def load_design_history(design_id: str, owner_uid: Annotated[str, Depends(authenticated_uid)]) -> dict[str, Any]:
    repository = _firestore_repository_for_persistence()
    try:
        return {"design_id": design_id, **repository.list_design_history(design_id, owner_uid)}
    except Exception as error:
        raise _persistence_http_error(error) from error


@app.post("/records/predictions", status_code=201, tags=["persistence"])
def save_prediction_record(payload: PersistPredictionRequest,
                           owner_uid: Annotated[str, Depends(authenticated_uid)]) -> dict[str, Any]:
    if (payload.prediction_kind == "summary" and payload.model_version != "V3") or (
        payload.prediction_kind == "hourly" and payload.model_version != "V3-Hourly-v1"
    ):
        raise HTTPException(status_code=422, detail="Prediction kind and model version do not match.")
    repository = _firestore_repository_for_persistence()
    try:
        record = repository.save_prediction(
            design=payload.design,
            climate=payload.climate,
            materials=payload.materials,
            design_id=payload.design_id,
            model_version=payload.model_version,
            prediction_kind=payload.prediction_kind,
            result=payload.result,
            diagnostics=payload.diagnostics,
            owner_uid=owner_uid,
            weather_profile=payload.weather_profile,
        )
        return {"prediction": record}
    except Exception as error:
        raise _persistence_http_error(error) from error


@app.post("/records/optimization-runs", status_code=201, tags=["persistence"])
def save_optimization_record(payload: PersistOptimizationRequest,
                              owner_uid: Annotated[str, Depends(authenticated_uid)]) -> dict[str, Any]:
    repository = _firestore_repository_for_persistence()
    try:
        record = repository.save_optimization_run(
            design=payload.design,
            climate=payload.climate,
            materials=payload.materials,
            design_id=payload.design_id,
            search_scope=payload.search_scope,
            candidate_count=payload.candidate_count,
            candidates=payload.candidates,
            selected_candidate=payload.selected_candidate,
            metric=payload.metric,
            owner_uid=owner_uid,
        )
        return {"optimization_run": record}
    except Exception as error:
        raise _persistence_http_error(error) from error
