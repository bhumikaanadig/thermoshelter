"""Train the separate hourly indoor-temperature surrogate without changing V3."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder

try:
    from .inspect_hourly_dataset import (
        BASE_FEATURES,
        CASE_COLUMN_RENAMES,
        CATEGORICAL_FEATURES,
        DEFAULT_ARTIFACT_DIR,
        HOURLY_COLUMN_RENAMES,
        MODEL_FEATURES,
        NUMERIC_FEATURES,
        PROJECT_ROOT,
        TARGET_COLUMN,
        load_hourly_dataset,
    )
    from .predict_hourly import DEFAULT_MODEL, predict_hourly
except ImportError:  # Supports `python ml/train_thermal_hourly_surrogate.py` from project root.
    from inspect_hourly_dataset import (
        BASE_FEATURES,
        CASE_COLUMN_RENAMES,
        CATEGORICAL_FEATURES,
        DEFAULT_ARTIFACT_DIR,
        HOURLY_COLUMN_RENAMES,
        MODEL_FEATURES,
        NUMERIC_FEATURES,
        PROJECT_ROOT,
        TARGET_COLUMN,
        load_hourly_dataset,
    )
    from predict_hourly import DEFAULT_MODEL, predict_hourly


SEED = 42
MATERIAL_HOLDOUT = ["Aluminum", "Polyurethane foam (PU)"]
SUMMARY_OUTPUTS = {
    "Average_Air_Temperature_C", "Minimum_Air_Temperature_C", "Maximum_Air_Temperature_C",
    "Average_Wall_Temperature_C", "Minimum_Wall_Temperature_C", "Maximum_Wall_Temperature_C",
    "Heat_Transfer_Rate_W", "Average_Heat_Flux_W_m2", "Maximum_Heat_Flux_W_m2",
    "Solar_Heat_Input_W", "Total_Heat_Transferred_Wh", "Indoor_Temperature_Rise_C",
    "Thermal_Energy_Loss_Wh",
}
HOURLY_NON_TARGET_OUTPUTS = {
    "Wall_Temperature_C", "Hourly_Heat_Transfer_Rate_W", "Hourly_Solar_Heat_Input_W",
}


def model_specs() -> list[dict[str, Any]]:
    """Small model-family/configuration set; validation MAE selects the winner."""
    return [
        {"name": "extra_trees_leaf1_all", "family": "ExtraTreesRegressor",
         "params": {"n_estimators": 300, "min_samples_leaf": 1, "max_features": 1.0}},
        {"name": "extra_trees_leaf2_80pct", "family": "ExtraTreesRegressor",
         "params": {"n_estimators": 400, "min_samples_leaf": 2, "max_features": 0.8}},
        {"name": "random_forest_leaf1_all", "family": "RandomForestRegressor",
         "params": {"n_estimators": 300, "min_samples_leaf": 1, "max_features": 1.0}},
        {"name": "random_forest_leaf2_80pct", "family": "RandomForestRegressor",
         "params": {"n_estimators": 400, "min_samples_leaf": 2, "max_features": 0.8}},
        {"name": "hist_gradient_150_leaf15", "family": "HistGradientBoostingRegressor",
         "params": {"max_iter": 150, "max_leaf_nodes": 15, "learning_rate": 0.05,
                    "l2_regularization": 1.0, "min_samples_leaf": 15}},
        {"name": "hist_gradient_250_leaf15", "family": "HistGradientBoostingRegressor",
         "params": {"max_iter": 250, "max_leaf_nodes": 15, "learning_rate": 0.08,
                    "l2_regularization": 1.0, "min_samples_leaf": 15}},
    ]


def make_estimator(spec: dict[str, Any], allow_unseen_categories: bool = False):
    params = dict(spec["params"])
    params["random_state"] = SEED
    if spec["family"] == "ExtraTreesRegressor":
        estimator = ExtraTreesRegressor(n_jobs=-1, **params)
    elif spec["family"] == "RandomForestRegressor":
        estimator = RandomForestRegressor(n_jobs=-1, **params)
    else:
        # Disable HistGradientBoosting's row-level early-stopping split. All
        # model selection uses the explicit Case_ID sequence validation set.
        estimator = HistGradientBoostingRegressor(early_stopping=False, **params)
    encoder = OneHotEncoder(
        handle_unknown="ignore" if allow_unseen_categories else "error",
        sparse_output=False,
        dtype=np.float64,
    )
    preprocessor = ColumnTransformer(
        transformers=[("categorical", encoder, CATEGORICAL_FEATURES)],
        remainder="passthrough",
        sparse_threshold=0,
        verbose_feature_names_out=False,
    )
    return make_pipeline(preprocessor, estimator)


def score(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    return {
        "mae_C": float(mean_absolute_error(actual, predicted)),
        "rmse_C": float(mean_squared_error(actual, predicted) ** 0.5),
        "r2": float(r2_score(actual, predicted)),
    }


def _case_column(name: str) -> str:
    return CASE_COLUMN_RENAMES.get(name, name)


def _hourly_column(name: str) -> str:
    return HOURLY_COLUMN_RENAMES.get(name, name)


def case_inputs_from_rows(rows: pd.DataFrame) -> dict[str, Any]:
    if rows.empty:
        raise ValueError("Cannot make a case input mapping from an empty sequence.")
    first = rows.sort_values("Hour").iloc[0]
    return {field: first[_case_column(field)] for field in BASE_FEATURES}


def climate_profile_from_rows(rows: pd.DataFrame) -> list[dict[str, Any]]:
    sorted_rows = rows.sort_values("Hour")
    return [
        {
            "Hour": int(row["Hour"]),
            **{field: float(row[_hourly_column(field)]) for field in [
                "Outdoor_Temperature_C", "Solar_Radiation_W_m2", "Wind_Speed_m_s",
            ]},
        }
        for _, row in sorted_rows.iterrows()
    ]


def case_level_ids(frame: pd.DataFrame) -> set[str]:
    return set(frame["Sequence_ID"].astype(str))


def _predict_rows(model, rows: pd.DataFrame) -> np.ndarray:
    ordered = rows.sort_values(["Sequence_ID", "Hour"], kind="stable")
    return np.asarray(model.predict(ordered[MODEL_FEATURES]), dtype=float)


def _evaluate_candidates(
    specs: list[dict[str, Any]],
    train: pd.DataFrame,
    validation: pd.DataFrame,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    comparisons: list[dict[str, Any]] = []
    y_train = train[TARGET_COLUMN].astype(float).to_numpy()
    y_validation = validation[TARGET_COLUMN].astype(float).to_numpy()
    for spec in specs:
        estimator = make_estimator(spec)
        estimator.fit(train[MODEL_FEATURES], y_train)
        predicted = np.asarray(estimator.predict(validation[MODEL_FEATURES]), dtype=float)
        result = {"name": spec["name"], "family": spec["family"], "params": spec["params"],
                  **score(y_validation, predicted)}
        comparisons.append(result)
    selected_result = min(comparisons, key=lambda item: (item["mae_C"], item["name"]))
    selected = next(spec for spec in specs if spec["name"] == selected_result["name"])
    return selected, comparisons


def _curve_metrics(frame: pd.DataFrame, predicted: np.ndarray) -> dict[str, Any]:
    ordered = frame.sort_values(["Sequence_ID", "Hour"], kind="stable").copy()
    ordered["predicted"] = predicted
    actual_max_steps: list[float] = []
    predicted_max_steps: list[float] = []
    actual_step_values: list[float] = []
    predicted_step_values: list[float] = []
    for _, group in ordered.groupby("Sequence_ID", sort=False):
        actual_steps = np.abs(np.diff(group[TARGET_COLUMN].astype(float).to_numpy()))
        predicted_steps = np.abs(np.diff(group["predicted"].astype(float).to_numpy()))
        actual_max_steps.append(float(actual_steps.max()))
        predicted_max_steps.append(float(predicted_steps.max()))
        actual_step_values.extend(actual_steps.tolist())
        predicted_step_values.extend(predicted_steps.tolist())
    return {
        "adjacent_hour_absolute_change_C": {
            "actual": {
                "median": float(np.median(actual_step_values)),
                "p95": float(np.quantile(actual_step_values, 0.95)),
                "maximum": float(max(actual_step_values)),
            },
            "predicted": {
                "median": float(np.median(predicted_step_values)),
                "p95": float(np.quantile(predicted_step_values, 0.95)),
                "maximum": float(max(predicted_step_values)),
            },
        },
        "per_case_maximum_adjacent_change_C": {
            "actual": {
                "median": float(np.median(actual_max_steps)),
                "p95": float(np.quantile(actual_max_steps, 0.95)),
                "maximum": float(max(actual_max_steps)),
            },
            "predicted": {
                "median": float(np.median(predicted_max_steps)),
                "p95": float(np.quantile(predicted_max_steps, 0.95)),
                "maximum": float(max(predicted_max_steps)),
            },
        },
    }


def _per_hour_metrics(frame: pd.DataFrame, predicted: np.ndarray) -> list[dict[str, Any]]:
    values = frame[["Sequence_ID", "Case_ID", "Dataset_Source", "Hour", TARGET_COLUMN]].copy()
    values["prediction"] = predicted
    results: list[dict[str, Any]] = []
    for hour, group in values.groupby("Hour", sort=True):
        actual = group[TARGET_COLUMN].astype(float).to_numpy()
        estimate = group["prediction"].astype(float).to_numpy()
        results.append({"hour": int(hour), "cases": int(group["Sequence_ID"].nunique()), **score(actual, estimate)})
    return results


def _curve_examples(
    frame: pd.DataFrame,
    prediction_rows: pd.DataFrame,
    predicted: np.ndarray,
    selected_case_ids: list[str],
) -> list[dict[str, Any]]:
    predicted_frame = prediction_rows[["Sequence_ID", "Hour"]].copy()
    predicted_frame["predicted"] = predicted
    examples: list[dict[str, Any]] = []
    for sequence_id in selected_case_ids:
        actual = frame[frame["Sequence_ID"].astype(str) == sequence_id].sort_values("Hour")
        estimates = predicted_frame[predicted_frame["Sequence_ID"].astype(str) == sequence_id].sort_values("Hour")
        if len(actual) != 24 or len(estimates) != 24:
            raise AssertionError(f"Held-out sequence {sequence_id} did not produce a complete 24-hour curve.")
        examples.append({
            "Sequence_ID": sequence_id,
            "Case_ID": str(actual.iloc[0]["Case_ID"]),
            "Dataset_Source": str(actual.iloc[0]["Dataset_Source"]),
            "hours": list(range(24)),
            "actual_indoor_temperature_C": actual[TARGET_COLUMN].astype(float).tolist(),
            "predicted_indoor_temperature_C": estimates["predicted"].astype(float).tolist(),
            "absolute_error_C": np.abs(
                actual[TARGET_COLUMN].astype(float).to_numpy() - estimates["predicted"].astype(float).to_numpy()
            ).tolist(),
        })
    return examples


def _material_holdout_diagnostic(combined: pd.DataFrame, specs: list[dict[str, Any]]) -> dict[str, Any]:
    heldout = combined[combined["Material"].isin(MATERIAL_HOLDOUT)].copy()
    remaining = combined[~combined["Material"].isin(MATERIAL_HOLDOUT)].copy()
    train = remaining[remaining["Recommended_Split"] == "train"]
    validation = remaining[remaining["Recommended_Split"] == "validation"]
    test_case_ids = set(heldout["Sequence_ID"].astype(str))
    train_case_ids = case_level_ids(train)
    validation_case_ids = case_level_ids(validation)
    if heldout.empty:
        raise AssertionError("No sequences are available for the material-held-out diagnostic.")
    if heldout["Material"].nunique() != len(MATERIAL_HOLDOUT):
        raise AssertionError("Material holdout group is not represented by all requested materials.")
    if train_case_ids & validation_case_ids or (train_case_ids | validation_case_ids) & test_case_ids:
        raise AssertionError("Material-held-out diagnostic has a sequence overlap.")

    selected, comparisons = _evaluate_candidates(specs, train, validation)
    fit = remaining[remaining["Recommended_Split"].isin(["train", "validation"])]
    estimator = make_estimator(selected, allow_unseen_categories=True)
    estimator.fit(fit[MODEL_FEATURES], fit[TARGET_COLUMN].astype(float).to_numpy())
    ordered_test = heldout.sort_values(["Sequence_ID", "Hour"], kind="stable")
    predicted = np.asarray(estimator.predict(ordered_test[MODEL_FEATURES]), dtype=float)
    result = {
        "purpose": "Additional diagnostic with Aluminum and Polyurethane foam withheld by material from all fitting/selection rows.",
        "heldout_materials": MATERIAL_HOLDOUT,
        "train_cases": len(train_case_ids),
        "validation_cases": len(validation_case_ids),
        "heldout_cases": len(test_case_ids),
        "heldout_hourly_rows": int(len(heldout)),
        "selected_model": selected,
        "validation_model_comparison": comparisons,
        "heldout_metrics": score(ordered_test[TARGET_COLUMN].astype(float).to_numpy(), predicted),
        "categorical_encoder_for_diagnostic": "handle_unknown=ignore to evaluate material categories absent from fit rows",
        "used_in_primary_model_selection": False,
    }
    return result


def _json_case_inputs(row: pd.Series) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for feature in BASE_FEATURES:
        value = row[_case_column(feature)]
        if feature not in CATEGORICAL_FEATURES:
            value = float(value)
            if not math.isfinite(value):
                raise ValueError(f"Non-finite case feature in held-out example: {feature}")
        else:
            value = str(value)
        result[feature] = value
    return result


def _case_column(name: str) -> str:
    return CASE_COLUMN_RENAMES.get(name, name)


def train_hourly_surrogate(data_dir: Path = PROJECT_ROOT, out_dir: Path = DEFAULT_ARTIFACT_DIR) -> dict[str, Any]:
    combined, inspection = load_hourly_dataset(data_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    combined_path = out_dir / "hourly_combined_training_data.csv"
    inspection_path = out_dir / "hourly_dataset_inspection.json"
    metrics_path = out_dir / "hourly_evaluation_metrics.json"
    report_path = out_dir / "hourly_training_report.md"
    example_path = out_dir / "hourly_example_prediction.json"
    curves_path = out_dir / "hourly_heldout_curve_examples.json"
    combined.to_csv(combined_path, index=False, float_format="%.12g")
    inspection_path.write_text(json.dumps(inspection, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    if "Case_ID" in MODEL_FEATURES or "Sequence_ID" in MODEL_FEATURES or "Dataset_Source" in MODEL_FEATURES:
        raise AssertionError("Case identity or source metadata leaked into the hourly model feature list.")
    if SUMMARY_OUTPUTS.intersection(MODEL_FEATURES) or HOURLY_NON_TARGET_OUTPUTS.intersection(MODEL_FEATURES):
        raise AssertionError("A case summary output or non-target hourly output leaked into model features.")
    for feature in MODEL_FEATURES:
        if feature not in combined.columns:
            raise AssertionError(f"Training feature is missing from combined dataset: {feature}")

    train = combined[combined["Recommended_Split"] == "train"].copy()
    validation = combined[combined["Recommended_Split"] == "validation"].copy()
    test = combined[combined["Recommended_Split"] == "test"].copy()
    train_cases, validation_cases, test_cases = map(case_level_ids, (train, validation, test))
    if train_cases & validation_cases or train_cases & test_cases or validation_cases & test_cases:
        raise AssertionError("A Case_ID sequence appears in more than one official split.")
    expected_hours = set(range(24))
    for split_name, frame in (("train", train), ("validation", validation), ("test", test)):
        per_case_hours = frame.groupby("Sequence_ID")["Hour"].apply(lambda values: set(values.astype(int)))
        if any(hours != expected_hours for hours in per_case_hours):
            raise AssertionError(f"The {split_name} split contains an incomplete hourly sequence.")

    y_train = train[TARGET_COLUMN].astype(float).to_numpy()
    y_validation = validation[TARGET_COLUMN].astype(float).to_numpy()
    y_test = test[TARGET_COLUMN].astype(float).to_numpy()
    if not np.isfinite(y_train).all() or not np.isfinite(y_validation).all() or not np.isfinite(y_test).all():
        raise AssertionError("Non-finite values reached model fitting or evaluation.")

    specs = model_specs()
    selected, comparisons = _evaluate_candidates(specs, train, validation)
    fit = combined[combined["Recommended_Split"].isin(["train", "validation"])].copy()
    estimator = make_estimator(selected)
    estimator.fit(fit[MODEL_FEATURES], fit[TARGET_COLUMN].astype(float).to_numpy())

    ordered_test = test.sort_values(["Sequence_ID", "Hour"], kind="stable").copy()
    test_predicted = np.asarray(estimator.predict(ordered_test[MODEL_FEATURES]), dtype=float)
    if len(test_predicted) != len(test) or not np.isfinite(test_predicted).all():
        raise AssertionError("The selected hourly model did not predict every held-out row with finite values.")
    heldout_metrics = score(ordered_test[TARGET_COLUMN].astype(float).to_numpy(), test_predicted)
    per_hour = _per_hour_metrics(ordered_test, test_predicted)

    errors = np.abs(ordered_test[TARGET_COLUMN].astype(float).to_numpy() - test_predicted)
    worst_index = int(np.argmax(errors))
    worst_row = ordered_test.iloc[worst_index]
    worst_error = {
        "Case_ID": str(worst_row["Case_ID"]),
        "Dataset_Source": str(worst_row["Dataset_Source"]),
        "Hour": int(worst_row["Hour"]),
        "actual_indoor_temperature_C": float(worst_row[TARGET_COLUMN]),
        "predicted_indoor_temperature_C": float(test_predicted[worst_index]),
        "absolute_error_C": float(errors[worst_index]),
    }

    per_case_test = ordered_test.groupby("Sequence_ID", sort=True).agg(
        average_target=(TARGET_COLUMN, "mean"),
    )
    quantiles = per_case_test["average_target"].quantile([0.15, 0.5, 0.85]).to_list()
    selected_examples: list[str] = []
    for target_quantile in quantiles:
        sequence_id = str((per_case_test["average_target"] - target_quantile).abs().idxmin())
        if sequence_id not in selected_examples:
            selected_examples.append(sequence_id)
    curve_examples = _curve_examples(ordered_test, ordered_test, test_predicted, selected_examples)

    curve_quality = _curve_metrics(ordered_test, test_predicted)
    if any(len(item["predicted_indoor_temperature_C"]) != 24 for item in curve_examples):
        raise AssertionError("A held-out case did not yield exactly 24 hourly estimates.")

    categorical_values = {
        field: sorted(fit[field].astype(str).unique().tolist()) for field in CATEGORICAL_FEATURES
    }
    numeric_feature_ranges: dict[str, dict[str, float]] = {}
    for feature in NUMERIC_FEATURES:
        values = fit[feature].astype(float).to_numpy()
        if not np.isfinite(values).all():
            raise AssertionError(f"Non-finite training feature reached model fitting: {feature}")
        numeric_feature_ranges[feature] = {"min": float(values.min()), "max": float(values.max())}
    v3_path = DEFAULT_ARTIFACT_DIR / "thermal_surrogate_v3.joblib"
    v3_hash_before = hashlib.sha256(v3_path.read_bytes()).hexdigest() if v3_path.is_file() else None
    bundle = {
        "model_version": "V3-Hourly-v1",
        "estimator": estimator,
        "features": MODEL_FEATURES,
        "target": TARGET_COLUMN,
        "categorical_features": CATEGORICAL_FEATURES,
        "categorical_values": categorical_values,
        "numeric_feature_ranges": numeric_feature_ranges,
        "metadata": {
            "selected_model": selected,
            "training_sequences": len(train_cases),
            "validation_sequences": len(validation_cases),
            "final_fit_sequences_train_plus_validation": len(train_cases | validation_cases),
            "heldout_test_sequences": len(test_cases),
            "source_workbooks": [item["filename"] for item in inspection["workbooks"]],
            "training_input_source": "workbook design-case fields plus explicitly supplied hourly climate rows",
            "source_data_type": inspection["dataset_type_counts_in_hourly_parent_cases"],
            "v3_artifact_sha256_before_hourly_training": v3_hash_before,
            "seed": SEED,
        },
    }
    model_path = out_dir / "thermal_hourly_surrogate_v1.joblib"
    joblib.dump(bundle, model_path, compress=3)

    material_holdout = _material_holdout_diagnostic(combined, specs)
    metrics = {
        "model_version": bundle["model_version"],
        "target": TARGET_COLUMN,
        "unit": "°C",
        "dataset_rows": int(len(combined)),
        "dataset_sequences": int(combined["Sequence_ID"].nunique()),
        "split_cases": {"train": len(train_cases), "validation": len(validation_cases), "test": len(test_cases)},
        "split_rows": {"train": int(len(train)), "validation": int(len(validation)), "test": int(len(test))},
        "sequence_overlap_across_splits": 0,
        "case_id_in_model_features": False,
        "selected_model": selected,
        "validation_model_comparison": comparisons,
        "heldout_test": heldout_metrics,
        "per_hour_heldout_test": per_hour,
        "worst_heldout_absolute_error": worst_error,
        "curve_quality": curve_quality,
        "material_heldout_diagnostic": material_holdout,
        "examples": curve_examples,
        "v3_artifact_sha256_before_training": v3_hash_before,
        "source_data_type": inspection["dataset_type_counts_in_hourly_parent_cases"],
    }
    metrics_path.write_text(json.dumps(metrics, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    curves_path.write_text(json.dumps(curve_examples, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    example_id = str(curve_examples[1 if len(curve_examples) > 1 else 0]["Sequence_ID"])
    example_rows = ordered_test[ordered_test["Sequence_ID"].astype(str) == example_id].sort_values("Hour")
    example_inputs = _json_case_inputs(example_rows.iloc[0])
    example_climate = climate_profile_from_rows(example_rows)
    example_prediction = predict_hourly(example_inputs, example_climate, model_path)
    if example_prediction["hours"] != list(range(24)) or len(example_prediction["predicted_indoor_temperature_C"]) != 24:
        raise AssertionError("The inference helper did not return exactly hours 0 through 23.")
    example_result = {
        "verification_case_id": str(example_rows.iloc[0]["Case_ID"]),
        "dataset_source": str(example_rows.iloc[0]["Dataset_Source"]),
        "case_inputs": example_inputs,
        "hourly_climate": example_climate,
        "prediction": example_prediction,
    }
    example_path.write_text(json.dumps(example_result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    train_report = _render_report(inspection, metrics, model_path, example_path, combined_path)
    report_path.write_text(train_report, encoding="utf-8")

    v3_hash_after = hashlib.sha256(v3_path.read_bytes()).hexdigest() if v3_path.is_file() else None
    if v3_hash_before != v3_hash_after:
        raise AssertionError("Existing V3 artifact hash changed during hourly model training.")
    metrics["v3_artifact_sha256_after_training"] = v3_hash_after
    metrics_path.write_text(json.dumps(metrics, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {
        "model_path": str(model_path.resolve()),
        "helper_path": str((PROJECT_ROOT / "ml" / "predict_hourly.py").resolve()),
        "combined_data_path": str(combined_path.resolve()),
        "inspection_path": str(inspection_path.resolve()),
        "metrics_path": str(metrics_path.resolve()),
        "report_path": str(report_path.resolve()),
        "example_prediction_path": str(example_path.resolve()),
        "heldout_curve_examples_path": str(curves_path.resolve()),
        "v3_artifact_sha256": v3_hash_after,
        "metrics": metrics,
    }


def _render_report(
    inspection: dict[str, Any],
    metrics: dict[str, Any],
    model_path: Path,
    example_path: Path,
    combined_path: Path,
) -> str:
    selected = metrics["selected_model"]
    test = metrics["heldout_test"]
    split_cases = metrics["split_cases"]
    split_rows = metrics["split_rows"]
    lines = [
        "# THERMOSHELTER V3 Hourly Surrogate v1 training report",
        "",
        "## Scope and data source",
        "",
        "The model predicts `Indoor_Temperature_C` for each supplied hour from 0 through 23. It is a separate artifact and does not change the six-output V3 summary model.",
        "",
        "The combined hourly table contains 6,240 stored workbook rows across 260 complete case sequences. Each sequence has one record for each hour 0–23. The four source workbooks label all 6,500 parent design cases as `PHYSICS_INFORMED_ESTIMATE`; the 260 hourly sequences are actual records present in those sheets, not 260 independently verified ANSYS runs or field measurements.",
        "",
        f"Combined dataset: `{combined_path}`.",
        "",
        "### Source sheets",
        "",
        "| Workbook | Hourly sheet | Rows | Sequences | Design input sheet | Split sheet |",
        "|---|---|---:|---:|---|---|",
    ]
    for source in inspection["workbooks"]:
        lines.append(
            f"| `{source['filename']}` | `{source['detected_hourly_sheet']}` | {source['hourly_row_count']} | {source['hourly_case_count']} | `{source['detected_design_input_sheet']}` | `{source['detected_split_sheet']}` |"
        )
    lines += [
        "",
        "Hourly columns in the source sheets: " + ", ".join(f"`{name}`" for name in inspection["hourly_columns"]) + ".",
        "",
        "The stored `Case_ID` maps each hourly sequence to exactly one design-case row. The split sheet assignments match the design-case assignments. No rows were removed. The audit found no duplicate hours, incomplete sequences, missing target or input values, non-finite fields, broken case mappings, duplicate hourly sequence signatures, or rounded input signatures crossing splits.",
        "",
        "## Target, inputs, and leakage controls",
        "",
        f"Target: `{TARGET_COLUMN}` (°C).",
        "",
        f"Prediction uses {len(BASE_FEATURES)} static case inputs, the three hourly climate columns, and cyclical hour features (`Hour_sin`, `Hour_cos`). The hourly climate profile must be supplied by the caller for all 24 hours: `Outdoor_Temperature_C`, `Solar_Radiation_W_m2`, and `Wind_Speed_m_s`.",
        "",
        "The model excludes `Case_ID`, `Sequence_ID`, `Dataset_Source`, split labels, all case-level summary outputs, and the non-target hourly `Wall_Temperature_C`, `Heat_Transfer_Rate_W`, and `Solar_Heat_Input_W`. It does not use later indoor temperatures or any target-derived summary as an input. The fixed workbook split keeps all 24 rows from a sequence together.",
        "",
        f"Case split: {split_cases['train']} train / {split_cases['validation']} validation / {split_cases['test']} held-out test sequences ({split_rows['train']:,} / {split_rows['validation']:,} / {split_rows['test']:,} hourly rows). The selected estimator was refit on the train and validation cases, then evaluated once on the held-out test cases.",
        "",
        "## Model selection",
        "",
        f"Selected using validation MAE only: `{selected['family']}` with `{selected['name']}` configuration `{json.dumps(selected['params'], sort_keys=True)}`.",
        "",
        "| Candidate | Validation MAE (°C) | Validation RMSE (°C) | Validation R² |",
        "|---|---:|---:|---:|",
    ]
    for item in metrics["validation_model_comparison"]:
        lines.append(f"| `{item['name']}` | {item['mae_C']:.4f} | {item['rmse_C']:.4f} | {item['r2']:.4f} |")
    lines += [
        "",
        "## Held-out case-level test",
        "",
        f"- MAE: {test['mae_C']:.4f} °C",
        f"- RMSE: {test['rmse_C']:.4f} °C",
        f"- R²: {test['r2']:.4f} (describes variance explained; it is not accuracy)",
        f"- Worst absolute error: {metrics['worst_heldout_absolute_error']['absolute_error_C']:.4f} °C at Case_ID `{metrics['worst_heldout_absolute_error']['Case_ID']}`, hour {metrics['worst_heldout_absolute_error']['Hour']}.",
        "",
        "### Error by hour",
        "",
        "| Hour | Cases | MAE (°C) | RMSE (°C) | R² |",
        "|---:|---:|---:|---:|---:|",
    ]
    for item in metrics["per_hour_heldout_test"]:
        lines.append(f"| {item['hour']} | {item['cases']} | {item['mae_C']:.4f} | {item['rmse_C']:.4f} | {item['r2']:.4f} |")
    quality = metrics["curve_quality"]
    lines += [
        "",
        "## Curve quality",
        "",
        f"Across held-out sequences, the maximum observed absolute adjacent-hour change was {quality['per_case_maximum_adjacent_change_C']['actual']['maximum']:.4f} °C in the source labels and {quality['per_case_maximum_adjacent_change_C']['predicted']['maximum']:.4f} °C in model predictions. The predicted curve is returned as produced by the selected tree model; there is no smoothing or endpoint adjustment.",
        "",
        f"Held-out actual and predicted 24-point examples are in `{(model_path.parent / 'hourly_heldout_curve_examples.json')}`.",
        "",
        "## Material-held-out diagnostic",
        "",
        f"Materials withheld from all fitting and validation rows: {', '.join(metrics['material_heldout_diagnostic']['heldout_materials'])}. Diagnostic test used {metrics['material_heldout_diagnostic']['heldout_cases']} cases and {metrics['material_heldout_diagnostic']['heldout_hourly_rows']} rows. MAE {metrics['material_heldout_diagnostic']['heldout_metrics']['mae_C']:.4f} °C; RMSE {metrics['material_heldout_diagnostic']['heldout_metrics']['rmse_C']:.4f} °C; R² {metrics['material_heldout_diagnostic']['heldout_metrics']['r2']:.4f}. This is a separate material generalization diagnostic, not the primary held-out case test.",
        "",
        "## Observed data limitations",
        "",
        "The hourly `Indoor_Temperature_C` sequences do not exactly reconcile to the separate case-sheet average/minimum/maximum outputs. Across 260 cases, mean absolute differences were {:.3f} °C for hourly mean versus summary average, {:.3f} °C for hourly minimum versus summary minimum, and {:.3f} °C for hourly maximum versus summary maximum. Hour 0 also does not consistently equal the static `Initial_Air_Temperature_C`; median difference (hour 0 minus initial) was {:.3f} °C. These mismatches are preserved and reported; the hourly target alone is used for training. The inference helper does not force the first predicted value to equal the input initial temperature.".format(
            inspection["hourly_curve_average_minus_case_summary_average_C"]["mean_absolute"],
            inspection["hourly_curve_minimum_minus_case_summary_minimum_C"]["mean_absolute"],
            inspection["hourly_curve_maximum_minus_case_summary_maximum_C"]["mean_absolute"],
            inspection["hour0_minus_initial_air_temperature_C"]["p50"],
        ),
        "",
        "The current website supplies summary climate values. A physically meaningful 24-hour request additionally needs a caller-supplied 24-point outdoor temperature, solar radiation, and wind profile. This model does not synthesize those weather inputs. Use measured or forecast hourly data from a defined source before connecting it to the website. Predictions outside the fit-row numeric ranges are returned with diagnostics and are extrapolations; the model does not guarantee reliable extrapolation.",
        "",
        "These metrics compare predictions with the workbook’s physics-informed hourly estimates. They are not ANSYS accuracy, field validation, or proof of site-specific thermal performance.",
        "",
        "## Saved files",
        "",
        f"- Hourly model: `{model_path}`",
        f"- Inference example: `{example_path}`",
        f"- Evaluation metrics: `{model_path.parent / 'hourly_evaluation_metrics.json'}`",
        f"- Inference helper: `ml/predict_hourly.py`",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=PROJECT_ROOT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    args = parser.parse_args()
    result = train_hourly_surrogate(args.data_dir, args.out_dir)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
