"""Train and evaluate the THERMOSHELTER tabular thermal surrogate."""

from __future__ import annotations

import argparse
import html
import json
import platform
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold, train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder


SEED = 42
FEATURES = [
    "Material", "Material_Category", "Thermal_Conductivity_W_mK", "Density_kg_m3",
    "Specific_Heat_J_kgK", "Wall_Thickness_m", "Shelter_Length_m", "Shelter_Width_m",
    "Shelter_Height_m", "Opening_Area_m2", "Window_Area_m2", "Door_Area_m2",
    "Orientation_deg", "External_Temperature_C", "Initial_Air_Temperature_C",
    "Solar_Radiation_W_m2", "Daily_Solar_Energy_kWh_m2", "Wind_Speed_m_s",
    "Relative_Humidity_percent", "Simulation_Duration_h", "Time_Step_min",
]
TARGETS = [
    "Average_Air_Temperature_C", "Minimum_Air_Temperature_C", "Maximum_Air_Temperature_C",
    "Solar_Heat_Input_W", "Heat_Transfer_Rate_W", "Thermal_Energy_Loss_Wh",
]
NUMERIC_FEATURES = [column for column in FEATURES if column not in {"Material", "Material_Category"}]
NONNEGATIVE_TARGETS = {"Solar_Heat_Input_W", "Thermal_Energy_Loss_Wh"}


def model_specs() -> list[dict]:
    """Small validation-only search across the three requested model families."""
    return [
        {"name": "extra_trees_leaf1_all", "family": "ExtraTreesRegressor", "params": {"n_estimators": 300, "min_samples_leaf": 1, "max_features": 1.0}},
        {"name": "extra_trees_leaf2_80pct", "family": "ExtraTreesRegressor", "params": {"n_estimators": 400, "min_samples_leaf": 2, "max_features": 0.8}},
        {"name": "random_forest_leaf1_all", "family": "RandomForestRegressor", "params": {"n_estimators": 300, "min_samples_leaf": 1, "max_features": 1.0}},
        {"name": "random_forest_leaf2_80pct", "family": "RandomForestRegressor", "params": {"n_estimators": 400, "min_samples_leaf": 2, "max_features": 0.8}},
        {"name": "hist_gradient_150_leaf15", "family": "HistGradientBoostingRegressor", "params": {"max_iter": 150, "max_leaf_nodes": 15, "learning_rate": 0.05, "l2_regularization": 1.0}},
        {"name": "hist_gradient_250_leaf15", "family": "HistGradientBoostingRegressor", "params": {"max_iter": 250, "max_leaf_nodes": 15, "learning_rate": 0.08, "l2_regularization": 1.0}},
    ]


def make_estimator(spec: dict):
    params = dict(spec["params"])
    params["random_state"] = SEED
    if spec["family"] == "ExtraTreesRegressor":
        return ExtraTreesRegressor(n_jobs=-1, **params)
    if spec["family"] == "RandomForestRegressor":
        return RandomForestRegressor(n_jobs=-1, **params)
    return HistGradientBoostingRegressor(early_stopping=True, **params)


def make_preprocessor(x: pd.DataFrame) -> ColumnTransformer:
    numeric = list(x.select_dtypes(include=np.number).columns)
    categorical = [column for column in x.columns if column not in numeric]
    return ColumnTransformer(
        transformers=[
            ("numeric", SimpleImputer(strategy="median"), numeric),
            ("categorical", make_pipeline(
                SimpleImputer(strategy="most_frequent"),
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
            ), categorical),
        ],
        sparse_threshold=0,
    )


def score(actual, predicted) -> dict:
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(mean_squared_error(actual, predicted) ** 0.5),
        "r2": float(r2_score(actual, predicted)),
    }


def constrain_predictions(target: str, predicted) -> np.ndarray:
    """Apply the supplied data's nonnegative physical bound at the output."""
    values = np.asarray(predicted, dtype=float)
    if target in NONNEGATIVE_TARGETS:
        values = np.maximum(values, 0.0)
    return values


def improvement(baseline_mae: float, model_mae: float) -> float | None:
    if baseline_mae == 0:
        return None
    return float(100 * (baseline_mae - model_mae) / baseline_mae)


def fit_pipe(x: pd.DataFrame, spec: dict):
    return make_pipeline(make_preprocessor(x), make_estimator(spec))


def split_rows(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray, str]:
    n = len(frame)
    n_test = max(1, round(n * 0.15))
    n_val = max(1, round(n * 0.15))
    indices = np.arange(n)
    material = frame["Material"].astype(str)
    stratify = material if material.value_counts().min() >= 3 else None
    strategy = "Material" if stratify is not None else "Unstratified (material counts too small)"
    if "Dataset_Source" in frame and frame["Dataset_Source"].nunique() > 1:
        source_material = frame["Dataset_Source"].astype(str) + " | " + material
        if source_material.value_counts().min() >= 3:
            stratify = source_material
            strategy = "Dataset_Source × Material"
    fit_val, test = train_test_split(
        indices, test_size=n_test, random_state=SEED, stratify=stratify
    )
    if "Dataset_Source" in frame and frame["Dataset_Source"].nunique() > 1:
        val_labels = frame.iloc[fit_val]["Dataset_Source"].astype(str) + " | " + material.iloc[fit_val]
    else:
        val_labels = material.iloc[fit_val]
    val_stratify = val_labels if stratify is not None and val_labels.value_counts().min() >= 2 else None
    train, validation = train_test_split(
        fit_val,
        test_size=n_val,
        random_state=SEED + 1,
        stratify=val_stratify,
    )
    return train, validation, test, strategy


def read_data_source(path: Path) -> tuple[pd.DataFrame, str | None]:
    """Read a CSV or the unique Excel sheet containing the complete case-level schema."""
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path), None
    if suffix not in {".xlsx", ".xlsm", ".xls"}:
        raise ValueError(f"Unsupported training source type: {path.suffix or '(no extension)'}")

    workbook = pd.ExcelFile(path)
    required = set(FEATURES + TARGETS)
    candidates = []
    for sheet_name in workbook.sheet_names:
        preview = pd.read_excel(workbook, sheet_name=sheet_name, nrows=0)
        if required.issubset(preview.columns):
            candidates.append(sheet_name)
    if len(candidates) != 1:
        raise ValueError(
            f"{path.name} must have exactly one worksheet with all model inputs and targets; "
            f"found {candidates}. No rows were combined."
        )
    sheet_name = candidates[0]
    return pd.read_excel(workbook, sheet_name=sheet_name), sheet_name


def require_compatible_sources(paths: list[Path]) -> tuple[pd.DataFrame, dict]:
    frames: list[pd.DataFrame] = []
    reference_columns: list[str] | None = None
    union_columns: list[str] = []
    source_manifest: list[dict] = []
    optional_source_metadata = {"Batch"}
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(path)
        frame, sheet_name = read_data_source(path)
        missing_required = [column for column in FEATURES + TARGETS if column not in frame]
        if missing_required:
            raise ValueError(
                f"{path.name} cannot train the six-target model; missing required columns: "
                f"{missing_required}. No rows have been combined or discarded."
            )
        if reference_columns is None:
            reference_columns = frame.columns.tolist()
        elif (set(frame.columns) - optional_source_metadata) != (set(reference_columns) - optional_source_metadata):
            missing = [column for column in reference_columns if column not in frame and column not in optional_source_metadata]
            extra = [column for column in frame.columns if column not in reference_columns and column not in optional_source_metadata]
            raise ValueError(
                f"Incompatible model or provenance schemas; no combination was made. {path.name} "
                f"is missing {missing} and adds {extra}. Only the optional Batch metadata field "
                "may differ between sources."
            )
        for column in frame.columns:
            if column not in union_columns:
                union_columns.append(column)
        if "Case_ID" in frame and frame["Case_ID"].duplicated().any():
            raise ValueError(
                f"{path.name} has duplicate Case_ID values. Resolve whether these are repeated "
                "time steps or duplicate cases before using a case-level split."
            )
        for column in NUMERIC_FEATURES + [target for target in TARGETS]:
            original = frame[column]
            parsed = pd.to_numeric(original, errors="coerce")
            invalid = original.notna() & parsed.isna()
            if invalid.any():
                raise ValueError(f"{path.name}: nonnumeric values found in {column}.")
            frame[column] = parsed
        target_missing = frame[TARGETS].isna().sum()
        bad_targets = target_missing[target_missing > 0].to_dict()
        if bad_targets:
            raise ValueError(f"{path.name}: missing target labels must be resolved: {bad_targets}")
        numeric_values = frame[NUMERIC_FEATURES + TARGETS].to_numpy(dtype=float)
        if not np.isfinite(numeric_values).all():
            raise ValueError(f"{path.name}: infinite input or target values found; review before training.")
        manifest = {
            "filename": path.name,
            "path": str(path),
            "file_type": path.suffix.lower().lstrip("."),
            "sheet_name": sheet_name,
            "file_size_bytes": int(path.stat().st_size),
            "rows_in": int(len(frame)),
            "columns": int(len(frame.columns)),
            "duplicate_rows_in_file": int(frame.duplicated().sum()),
            "duplicate_case_ids_in_file": int(frame["Case_ID"].duplicated().sum()) if "Case_ID" in frame else None,
            "materials": sorted(frame["Material"].dropna().astype(str).unique().tolist()),
            "data_type_values": sorted(frame["Data_Type"].dropna().astype(str).unique().tolist()) if "Data_Type" in frame else [],
            "cfd_reference_values": sorted(frame["CFD_Reference"].dropna().astype(str).unique().tolist()) if "CFD_Reference" in frame else [],
            "provenance": {
                column: sorted(frame[column].dropna().astype(str).unique().tolist())
                for column in ["Data_Type", "CFD_Reference", "Climate_Data_Source", "Material_Data_Source", "Surrogate_Method", "Batch"]
                if column in frame
            },
        }
        if "Dataset_Source" in frame:
            frame = frame.rename(columns={"Dataset_Source": "Original_Dataset_Source"})
        frame["Dataset_Source"] = path.name
        frames.append(frame)
        source_manifest.append(manifest)

    assert reference_columns is not None
    for index, frame in enumerate(frames):
        for column in union_columns:
            if column not in frame:
                frame[column] = pd.NA
        frames[index] = frame.reindex(columns=union_columns + ["Dataset_Source"])
    combined = pd.concat(frames, ignore_index=True, sort=False)
    if "Case_ID" in combined and combined["Case_ID"].duplicated().any():
        repeated_ids = combined.loc[combined["Case_ID"].duplicated(keep=False), "Case_ID"].astype(str).unique().tolist()
        raise ValueError(
            "Case_ID values overlap across the selected sources. Resolve whether these identify "
            f"the same cases before training; examples: {repeated_ids[:10]}"
        )
    # A duplicate case must match every model input and all six target values.
    # Case_ID and source metadata are excluded so copied cases with new IDs are caught.
    case_signature_columns = FEATURES + TARGETS
    duplicated = combined.duplicated(subset=case_signature_columns, keep="first")
    removed = int(duplicated.sum())
    combined = combined.loc[~duplicated].reset_index(drop=True)
    after_counts = combined["Dataset_Source"].value_counts().to_dict()
    for item in source_manifest:
        item["rows_after_exact_deduplication"] = int(after_counts.get(item["filename"], 0))

    metadata = {
        "input_row_total_before_deduplication": int(sum(item["rows_in"] for item in source_manifest)),
        "exact_duplicate_rows_removed": removed,
        "final_unique_rows": int(len(combined)),
        "sources": source_manifest,
        "combined_source_count": len(source_manifest),
        "schema_columns": union_columns,
        "optional_schema_columns": sorted(optional_source_metadata),
        "duplicate_policy": "Drop only cases with exactly identical values for all 21 model inputs and all six target values; retain repeated inputs when target values differ.",
        "exact_duplicate_case_signatures_removed": removed,
    }
    metadata["exact_duplicate_rows_removed"] = removed
    return combined, metadata


def near_duplicate_input_keys(frame: pd.DataFrame) -> pd.Series:
    """Fingerprint inputs at 0.01 resolution to keep near-identical rows together."""
    signature = frame[FEATURES].copy()
    for column in NUMERIC_FEATURES:
        signature[column] = pd.to_numeric(signature[column], errors="coerce").round(2)
    for column in ("Material", "Material_Category"):
        signature[column] = signature[column].astype("string").str.strip()
    return pd.util.hash_pandas_object(signature, index=False).astype("uint64")


def svg_diagnostic(target: str, actual: np.ndarray, predicted: np.ndarray, path: Path) -> None:
    width, height = 1100, 390
    panels = [(45, 65, 310, 260), (400, 65, 310, 260), (755, 65, 300, 260)]
    color = "#3279a8"
    escaped_target = html.escape(target)
    fragments = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="white"/>',
        f'<text x="45" y="30" font-size="18" font-family="Arial" font-weight="bold">Held-out diagnostics: {escaped_target}</text>',
    ]
    residual = predicted - actual

    def axes(x, y, w, h, title, xlabel, ylabel):
        fragments.append(f'<text x="{x + w/2}" y="{y - 12}" text-anchor="middle" font-size="13" font-family="Arial">{html.escape(title)}</text>')
        fragments.append(f'<path d="M{x},{y} V{y+h} H{x+w}" fill="none" stroke="#444" stroke-width="1"/>')
        fragments.append(f'<text x="{x+w/2}" y="{y+h+35}" text-anchor="middle" font-size="11" font-family="Arial">{html.escape(xlabel)}</text>')
        fragments.append(f'<text transform="translate({x-32},{y+h/2}) rotate(-90)" text-anchor="middle" font-size="11" font-family="Arial">{html.escape(ylabel)}</text>')

    x, y, w, h = panels[0]
    axes(x, y, w, h, "Actual vs predicted", "Actual", "Predicted")
    low = float(min(actual.min(), predicted.min()))
    high = float(max(actual.max(), predicted.max()))
    span = max(high - low, 1e-9)
    margin = span * 0.04
    low -= margin
    high += margin
    for i in range(5):
        value = low + (high - low) * i / 4
        sx = x + (value - low) / (high - low) * w
        sy = y + h - (value - low) / (high - low) * h
        fragments.append(f'<path d="M{sx:.1f},{y+h} V{y+h+4} M{x-4},{sy:.1f} H{x}" stroke="#777"/>')
    fragments.append(f'<path d="M{x},{y+h} L{x+w},{y}" stroke="#888" stroke-dasharray="5 4"/>')
    for a, p in zip(actual, predicted):
        cx = x + (a - low) / (high - low) * w
        cy = y + h - (p - low) / (high - low) * h
        fragments.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="2.5" fill="{color}" fill-opacity="0.55"/>')

    x, y, w, h = panels[1]
    axes(x, y, w, h, "Residual vs predicted", "Predicted", "Predicted − actual")
    px0, px1 = float(predicted.min()), float(predicted.max())
    py0, py1 = float(residual.min()), float(residual.max())
    pxspan, pyspan = max(px1 - px0, 1e-9), max(py1 - py0, 1e-9)
    pad = pyspan * 0.08
    py0, py1 = py0 - pad, py1 + pad
    zero_y = y + h - (0 - py0) / max(py1 - py0, 1e-9) * h
    fragments.append(f'<path d="M{x},{zero_y:.1f} H{x+w}" stroke="#a44" stroke-dasharray="5 4"/>')
    for p, r in zip(predicted, residual):
        cx = x + (p - px0) / pxspan * w
        cy = y + h - (r - py0) / (py1 - py0) * h
        fragments.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="2.5" fill="{color}" fill-opacity="0.55"/>')

    x, y, w, h = panels[2]
    axes(x, y, w, h, "Error distribution", "Residual", "Count")
    hist, edges = np.histogram(residual, bins=18)
    max_count = max(int(hist.max()), 1)
    for i, count in enumerate(hist):
        bw = w / len(hist) * 0.82
        bx = x + i * (w / len(hist)) + (w / len(hist) - bw) / 2
        bh = count / max_count * h
        by = y + h - bh
        fragments.append(f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bw:.1f}" height="{bh:.1f}" fill="{color}" fill-opacity="0.78"/>')
    fragments.append('<text x="45" y="375" font-size="10" font-family="Arial" fill="#555">Residual = prediction − actual. Diagonal/zero lines indicate perfect agreement.</text>')
    fragments.append('</svg>')
    path.write_text("\n".join(fragments), encoding="utf-8")


def svg_importance(target: str, rows: pd.DataFrame, path: Path) -> None:
    rows = rows.sort_values("mae_increase", ascending=True).tail(12)
    width, height = 780, max(300, 100 + len(rows) * 26)
    left, right, top, bar_h, gap = 260, 755, 75, 15, 10
    maximum = max(float(rows["mae_increase"].max()), 1e-9)
    pieces = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="white"/>',
        f'<text x="22" y="32" font-size="17" font-family="Arial" font-weight="bold">Validation permutation importance: {html.escape(target)}</text>',
        f'<text x="{left}" y="{height-14}" font-size="11" font-family="Arial">Increase in validation MAE when feature is shuffled (target units)</text>',
    ]
    for i, (_, row) in enumerate(rows.iterrows()):
        y = top + i * (bar_h + gap)
        label = html.escape(str(row["feature"]))
        amount = float(row["mae_increase"])
        bar_width = max(0.0, amount) / maximum * (right - left)
        pieces.append(f'<text x="{left-10}" y="{y+bar_h-2}" text-anchor="end" font-size="11" font-family="Arial">{label}</text>')
        pieces.append(f'<rect x="{left}" y="{y}" width="{bar_width:.1f}" height="{bar_h}" fill="#3279a8"/>')
        pieces.append(f'<text x="{left+bar_width+5:.1f}" y="{y+bar_h-2}" font-size="10" font-family="Arial">{amount:.4g}</text>')
    pieces.append('</svg>')
    path.write_text("\n".join(pieces), encoding="utf-8")


def write_error_outputs(test_table: pd.DataFrame, out_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    summaries = []
    largest = []
    binned = []
    bin_features = [column for column in ["External_Temperature_C", "Wall_Thickness_m", "Solar_Radiation_W_m2"] if column in test_table]
    for target, group in test_table.groupby("target", sort=False):
        for material, rows in group.groupby("Material", dropna=False):
            scores = score(rows["actual"], rows["predicted"])
            summaries.append({"target": target, "Material": material, "n": len(rows), **scores, "mean_error": float(rows["error"].mean())})
        largest.extend(group.nlargest(10, "absolute_error").to_dict("records"))
        for feature in bin_features:
            try:
                labels = pd.qcut(group[feature], q=4, duplicates="drop")
            except ValueError:
                continue
            temp = group.assign(input_bin=labels.astype(str))
            for bin_label, rows in temp.groupby("input_bin", observed=True):
                summaries_for_bin = score(rows["actual"], rows["predicted"])
                binned.append({"target": target, "feature": feature, "input_bin": bin_label, "n": len(rows), **summaries_for_bin})
    per_material = pd.DataFrame(summaries)
    largest_frame = pd.DataFrame(largest).sort_values(["target", "absolute_error"], ascending=[True, False])
    bin_frame = pd.DataFrame(binned)
    per_material.to_csv(out_dir / "per_material_error_summary.csv", index=False)
    largest_frame.to_csv(out_dir / "largest_error_cases.csv", index=False)
    bin_frame.to_csv(out_dir / "error_by_input_ranges.csv", index=False)
    return per_material, largest_frame, bin_frame


def report_text(metadata: dict, validation: pd.DataFrame, test: pd.DataFrame,
                material: pd.DataFrame, source: pd.DataFrame, importance: pd.DataFrame,
                per_material: pd.DataFrame, largest: pd.DataFrame, inspection: dict | None) -> str:
    artifact_dir_label = str(metadata.get("artifact_dir", "ml/artifacts")).replace("\\", "/")
    time_series_sheets = [series for item in (inspection or {}).get("files", []) for series in item.get("time_series_sheets", [])]
    transient_rows = sum(int(series.get("rows", 0)) for series in time_series_sheets)
    transient_cases = sum(int(series.get("case_count", 0) or 0) for series in time_series_sheets)
    lines = [
        "# THERMOSHELTER thermal surrogate training report", "",
        "## What the surrogate does", "",
        "This pipeline fits one regression model per target. It learns a mapping from the listed material, geometry, and climate inputs to the supplied simulation summary outputs. It is a fast approximation of its training labels; it does not replace ANSYS. Predictions for solar heat input and thermal energy loss are bounded below by zero, consistent with the supplied data's physical range checks.", "",
        "## Data inspected and used", "",
        f"- Raw rows passed to the training pipeline: {metadata['data']['input_row_total_before_deduplication']:,}",
        f"- Exact duplicate cases removed: {metadata['data']['exact_duplicate_case_signatures_removed']:,}",
        f"- Unique rows used by the six-target model: {metadata['data']['final_unique_rows']:,}",
        f"- Model input columns: {len(FEATURES)}; predicted outputs: {len(TARGETS)}.",
        "- Original workbooks were read only. No outlier rows were removed.",
        "",
        "### Files inspected", "",
        "| File | Exact path | Rows | Columns | Duplicate rows | Duplicate Case_ID | V2 used? | Data_Type |", "|---|---|---:|---:|---:|---:|---|---|",
    ]
    inspected_files = inspection.get("files", []) if inspection else metadata["data"]["sources"]
    for item in inspected_files:
        if "filename" in item and "rows" in item:
            count, columns = item["rows"], item["columns"]
            dups, case_dups = item.get("duplicate_rows"), item.get("duplicate_case_ids")
            dtype = item.get("provenance", {}).get("Data_Type", item.get("data_type_values", []))
            previous = "YES" if item.get("previously_used_in_v2") else "NO"
        else:
            count, columns = item["rows_in"], item["columns"]
            dups, case_dups, dtype = item["duplicate_rows_in_file"], item["duplicate_case_ids_in_file"], item["data_type_values"]
            previous = "NO"
        source_path = item.get("path", "path not recorded")
        lines.append(f"| `{item['filename']}` | `{source_path}` | {count} | {columns} | {dups} | {case_dups} | {previous} | `{dtype}` |")
    if len(metadata["data"]["sources"]) > 1:
        lines.extend(["", f"Combined training dataset: `{artifact_dir_label}/combined_training_data.csv` (includes `Dataset_Source` for audit; source is excluded from features).", ""])
    lines.extend(["", "### Source disposition", ""])
    used_names = {item["filename"] for item in metadata["data"]["sources"]}
    if inspection:
        comparison = inspection.get("pairwise_comparisons", [])
        for item in inspection.get("files", []):
            name = item["filename"]
            if name in used_names:
                previous = "YES" if item.get("previously_used_in_v2") else "NO"
                lines.append(f"- `{name}` was included in V3; previously used by V2: {previous}.")
                continue
            similar = [entry for entry in comparison if name in (entry["left"], entry["right"])]
            reasons = []
            if item.get("missing_expected_features"):
                reasons.append(f"missing {len(item['missing_expected_features'])} required input columns")
            if item.get("missing_expected_targets"):
                reasons.append(f"missing {len(item['missing_expected_targets'])} required target columns")
            if any(not entry.get("identical_schema", False) for entry in similar):
                reasons.append("schema differs from the full-feature dataset")
            overlaps = [entry["exact_row_overlap"] for entry in similar if entry.get("exact_row_overlap")]
            if overlaps:
                reasons.append(f"contains {max(overlaps)} rows exactly duplicated in another supplied file")
            annual_solar = any("Solar_Radiation_kWh_m2_year" in c for c in item.get("column_names", []))
            if annual_solar:
                reasons.append("its annual solar-energy column is not the same quantity/unit as instantaneous W/m² or daily kWh/m² inputs")
            reason = "; ".join(reasons) if reasons else "not selected for the full-feature six-target fit"
            lines.append(f"- `{name}` was inspected and kept separate: {reason}.")
    lines.extend([
        "", "### Combination decision", "",
        metadata["combination_decision"],
        "",
        "",
        "## Features and targets", "",
        "**Inputs** (only these columns enter the model): " + ", ".join(f"`{x}`" for x in FEATURES) + ".",
        "",
        "**Targets** (trained separately): " + ", ".join(f"`{x}`" for x in TARGETS) + ".",
        "",
        "Case IDs, Dataset_Source, batch/source metadata, and all output columns are excluded from model features. Any additional supplied outputs remain excluded from inputs. Opening area may be defined from window and door areas, and daily solar energy may be strongly related to radiation; correlated known inputs can share or mask permutation importance, so interpret their ranking with that in mind.",
        "",
        "## Data quality", "",
        f"- Training rows: {metadata['data_quality']['rows']:,}; missing feature cells: {metadata['data_quality']['missing_feature_cells']}; missing target cells: {metadata['data_quality']['missing_target_cells']}; non-finite numeric cells: {metadata['data_quality']['nonfinite_numeric_cells']}.",
        f"- Missing nonmodel metadata cells: {metadata['data_quality']['missing_nonmodel_metadata_cells']}.",
        f"- Duplicate full rows in source sheets: {metadata['data_quality']['duplicate_rows_in_training_source']}; duplicate Case_IDs: {metadata['data_quality']['duplicate_case_ids_in_training_source']}; duplicate input/target cases removed: {metadata['data']['exact_duplicate_case_signatures_removed']}.",
        f"- Inputs identical after rounding numeric features to 0.01: {metadata['data_quality']['near_duplicate_input_signatures_round_0_01']}; any near-input groups crossing train/validation/test: {metadata['data_quality']['near_duplicate_groups_crossing_splits']}.",
        f"- Physical range checks with violations: {metadata['data_quality']['physical_violations']}.",
        f"- Constant columns in training input: {metadata['data_quality']['constant_columns']}.",
        f"- Highly correlated numeric input pairs (|Pearson r| ≥ 0.98): {metadata['data_quality']['highly_correlated_features']}.",
        "- IQR flags are recorded in the inspection artifact; they were not treated as errors and no outliers were deleted.",
        "",
        "## Models and split", "",
        "Candidates were ExtraTreesRegressor, RandomForestRegressor, and HistGradientBoostingRegressor. Two practical hyperparameter configurations per family were compared on validation MAE only. The final model for each target was refit on training + validation data; the held-out test data were not used to select model family or parameters.",
        f"- Split: {metadata['split']['train']:,} train / {metadata['split']['validation']:,} validation / {metadata['split']['test']:,} test ({metadata['split']['stratification']}).",
        f"- Random seed: {metadata['split']['random_seed']}. Case rows are one summary per Case_ID; all Case_IDs are unique. Near-input signatures rounded to 0.01 do not overlap across splits.",
        "",
        "| Target | Selected family | Configuration | Hyperparameters |",
        "|---|---|---|---|",
    ])
    for target, selected in metadata["selected_models"].items():
        lines.append(f"| `{target}` | {selected['family']} | `{selected['name']}` | `{selected['hyperparameters']}` |")
    lines.extend([
        "",
        "### Validation and training metrics", "",
        "| Target | Selected model | Train MAE | Validation MAE | Validation RMSE | Validation R² | Validation baseline MAE | Improvement vs baseline | Val − train MAE |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ])
    for _, row in validation.iterrows():
        lines.append(f"| `{row['target']}` | {row['model_name']} | {row['train_mae']:.4g} | {row['mae']:.4g} | {row['rmse']:.4g} | {row['r2']:.4f} | {row['baseline_mae']:.4g} | {row['relative_improvement_pct']:.1f}% | {row['val_minus_train_mae']:.4g} |")
    lines.extend([
        "", "### Untouched held-out test metrics", "",
        "| Target | Selected model | MAE | RMSE | R² | Baseline MAE | Improvement vs baseline |",
        "|---|---|---:|---:|---:|---:|---:|",
    ])
    for _, row in test.iterrows():
        lines.append(f"| `{row['target']}` | {row['model_name']} | {row['mae']:.4g} | {row['rmse']:.4g} | {row['r2']:.4f} | {row['baseline_mae']:.4g} | {row['relative_improvement_pct']:.1f}% |")
    lines.extend([
        "", "MAE is mean absolute error in the target's units. RMSE is root mean squared error and penalizes large misses more. R² describes variation explained relative to a constant-mean baseline; it is not accuracy.",
        "", "## Overfitting assessment", "",
        "The table compares fit error with validation and final test error. A much lower training MAE is a warning for memorization; similar validation and test values are a useful stability check, but do not prove that overfitting is absent.",
        "", "| Target | Train MAE | Validation MAE | Test MAE | Validation − train |", "|---|---:|---:|---:|---:|",
    ])
    test_by_target = test.set_index("target")
    for _, row in validation.iterrows():
        final_row = test_by_target.loc[row["target"]]
        lines.append(f"| `{row['target']}` | {row['train_mae']:.4g} | {row['mae']:.4g} | {final_row['mae']:.4g} | {row['val_minus_train_mae']:.4g} |")
    near_zero_train = validation[validation["train_mae"] <= 1e-8]
    if not near_zero_train.empty:
        names = ", ".join(f"`{name}`" for name in near_zero_train["target"].tolist())
        lines.append(f"Training MAE is effectively zero for {names}; treat this as a memorization warning even though the held-out errors are reported separately.")
    lines.extend([
        "The validation and test errors are close for these fixed splits, while training error is lower, so there is a train-to-held-out gap consistent with some overfitting. Use new simulation cases to confirm these estimates before deployment.",
        "", "## Generalization diagnostics", "",
        "### Material-held-out stress test", "",
        f"Grouped diagnostics held out complete Material names ({metadata['material_group_count']} names) in {metadata['material_holdout_folds']} folds. This is a stress test, not proof of universal material generalization.",
        "", "| Target | MAE | RMSE | R² | Baseline MAE | Improvement vs baseline |", "|---|---:|---:|---:|---:|---:|",
    ])
    for _, row in material.iterrows():
        if row.get("status") == "not_applicable":
            lines.append(f"| `{row['target']}` | N/A | N/A | N/A | N/A | N/A |")
        else:
            lines.append(f"| `{row['target']}` | {row['mae']:.4g} | {row['rmse']:.4g} | {row['r2']:.4f} | {row['baseline_mae']:.4g} | {row['relative_improvement_pct']:.1f}% |")
    lines.extend([
        "", "### Source-held-out diagnostic", "",
        metadata["source_holdout_note"],
        "", "| Target | Status / MAE | RMSE | R² | Baseline MAE | Improvement vs baseline |", "|---|---:|---:|---:|---:|---:|",
    ])
    for _, row in source.iterrows():
        if row.get("status") == "not_applicable":
            lines.append(f"| `{row['target']}` | N/A | N/A | N/A | N/A | N/A |")
        else:
            lines.append(f"| `{row['target']}` | {row['mae']:.4g} | {row['rmse']:.4g} | {row['r2']:.4f} | {row['baseline_mae']:.4g} | {row['relative_improvement_pct']:.1f}% |")
    source_provenance = list(metadata["provenance"].values())
    source_batches = sorted({value for provenance in source_provenance for value in provenance.get("Batch", [])})
    unbatched_sources = [
        filename for filename, provenance in metadata["provenance"].items()
        if not provenance.get("Batch")
    ]
    same_generation = (
        len(source_provenance) > 1
        and len({tuple(provenance.get("Data_Type", [])) for provenance in source_provenance}) == 1
        and len({tuple(provenance.get("Surrogate_Method", [])) for provenance in source_provenance}) == 1
        and len({tuple(provenance.get("CFD_Reference", [])) for provenance in source_provenance}) == 1
    )
    source_coverage = []
    if unbatched_sources:
        base_label = "base workbook without Batch metadata" if len(unbatched_sources) == 1 else f"{len(unbatched_sources)} base workbooks without Batch metadata"
        source_coverage.append(base_label)
    if source_batches:
        source_coverage.append(f"named batches {', '.join(source_batches)}")
    if same_generation and source_coverage:
        lines.append(f"The source folds cover {' and '.join(source_coverage)}. The sources share the listed physics-informed method/provenance. Interpret this as a source-transfer stress test, not independent CFD or field validation.")
    lines.extend(["", "## Feature importance", "", "Permutation importance was measured on validation rows using change in MAE, so values are in each target's units. Correlated features can split or mask one another's importance.", ""])
    for target in TARGETS:
        rows = importance[importance["target"] == target].sort_values("mae_increase", ascending=False).head(5)
        names = ", ".join(f"`{row.feature}` ({row.mae_increase:.4g})" for row in rows.itertuples())
        lines.append(f"- `{target}` top features: {names}.")
    lines.extend(["", f"Plots: `{artifact_dir_label}/feature_importance_<target>.svg` and `{artifact_dir_label}/diagnostic_<target>.svg`.", "", "## Error analysis", ""])
    weakest = test.sort_values("r2").iloc[0]
    strongest = test.sort_values("r2", ascending=False).iloc[0]
    lines.append(f"- Highest held-out R²: `{strongest['target']}` (R² {strongest['r2']:.4f}); lowest: `{weakest['target']}` (R² {weakest['r2']:.4f}). This ranks fit on this split, not physical validity.")
    for target in TARGETS:
        subset = per_material[per_material["target"] == target]
        if not subset.empty:
            worst = subset.sort_values("mae", ascending=False).iloc[0]
            lines.append(f"- Largest per-material test MAE for `{target}`: `{worst['Material']}` ({worst['mae']:.4g}, n={int(worst['n'])}).")
        error_row = largest[largest["target"] == target].head(1)
        if not error_row.empty:
            row = error_row.iloc[0]
            lines.append(f"- Largest individual test error for `{target}`: Case `{row['Case_ID']}`, material `{row['Material']}`, absolute error {row['absolute_error']:.4g}.")
    lines.extend([
        "- Training, validation, and final test MAE are shown together above. The train/validation gap is descriptive; candidate selection used validation only. The final test set was evaluated after model selection.",
        f"- Input-range error bins are saved in `{artifact_dir_label}/error_by_input_ranges.csv`; inspect them before making claims about cold extremes or wall-thickness boundaries.",
        "",
        "## Data provenance and limitations", "",
        "The training source provenance is recorded in model metadata and below:",
    ])
    for source_name, provenance in metadata["provenance"].items():
        detail = "; ".join(f"{key}: `{values}`" for key, values in provenance.items())
        lines.append(f"- `{source_name}` — {detail}.")
    raw_inspected = sum(int(item.get("rows", 0)) for item in inspected_files)
    exact_pair_overlaps = [int(item["exact_row_overlap"]) for item in (inspection or {}).get("pairwise_comparisons", []) if item.get("exact_row_overlap")]
    recognized_duplicate_overlap = max(exact_pair_overlaps, default=0)
    lines.extend([
        "",
        metadata["combination_decision"],
    ])
    if inspected_files:
        lines.append(f"The inspected files contain {raw_inspected:,} raw rows in total. The largest confirmed exact pairwise row overlap is {recognized_duplicate_overlap:,}; these counts are inventory totals, not a claim that incompatible files form one training set.")
    def path_text(value) -> str:
        return str(value).replace("\\", "/")

    artifact_dir = artifact_dir_label
    model_filename = metadata.get("model_filename", "thermal_surrogate.joblib")
    audit_sources = inspected_files or metadata["data"]["sources"]
    inspect_args = " ".join(
        '--data "{}"'.format(path_text(item.get("path", item["filename"])))
        for item in audit_sources
    )
    train_args = " ".join(
        '--data "{}"'.format(path_text(item["path"]))
        for item in metadata["data"]["sources"]
    )
    lines.extend([
        "No field measurements were supplied. Missing provenance fields mean unknown provenance, not proof that a file came directly from ANSYS.",
        f"The workbooks contain {transient_rows:,} separate hourly records across {transient_cases:,} sampled case sequences. The six model targets are per-case average/minimum/maximum temperatures and aggregate heat quantities. V3 trains only on the case-summary sheets and does not output a 24-hour curve. Predictions are supported only within the supplied feature ranges; a held-out score against physics-informed estimates is not ANSYS accuracy or field validation.",
        "V2 used only the Batch 3 and Batch 4 CSV sources, totaling 3,500 rows. V3 uses the four current project workbooks. The older 63-row and 36-row files were not included.",
        "The case-level holdout tests interpolation for represented material names. The material-held-out score is a limited stress test. Source-held-out results are only appropriate when multiple compatible sources are combined; otherwise the report marks them not applicable.",
        "",
        "## Reproduce training and inference", "",
        "From the project root, install `ml/requirements.txt`, inspect all files, and train only compatible sources:",
        "```powershell",
        "python -m pip install -r ml/requirements.txt",
        f'python ml/audit_thermal_surrogate_v3.py --project-dir . --out-dir "{artifact_dir}"',
        f'python ml/train_thermal_surrogate_v3.py {train_args} --inspection "{artifact_dir}/dataset_inspection.json" --out-dir "{artifact_dir}" --model-filename {model_filename}',
        f'python ml/predict_v3.py --model "{artifact_dir}/{model_filename}" --input "{artifact_dir}/example_input.json" --output "{artifact_dir}/example_prediction.json"',
        "```",
        f"The model is saved as `{artifact_dir}/{model_filename}` with its preprocessing pipelines and metadata. A future FastAPI endpoint can import `predict_shelter()` from `ml/predict_v3.py`.",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", action="append", required=True, help="CSV or Excel workbook path; repeat for each compatible source")
    parser.add_argument("--inspection", type=Path, help="Optional dataset_inspection.json covering all examined files")
    parser.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parent / "artifacts")
    parser.add_argument("--model-filename", default="thermal_surrogate.joblib", help="Model bundle filename within --out-dir")
    args = parser.parse_args()
    if Path(args.model_filename).name != args.model_filename or not args.model_filename.endswith(".joblib"):
        parser.error("--model-filename must be a .joblib filename without directory components")

    frame, data_meta = require_compatible_sources([Path(value) for value in args.data])
    args.out_dir.mkdir(parents=True, exist_ok=True)
    if len(data_meta["sources"]) > 1:
        frame.to_csv(args.out_dir / "combined_training_data.csv", index=False)
    missing_targets = frame[TARGETS].isna().sum()
    if missing_targets.any():
        raise ValueError(f"Missing target labels found after source combination: {missing_targets[missing_targets > 0].to_dict()}")

    x = frame[FEATURES].copy()
    if x.isna().all().any():
        raise ValueError(f"Entirely missing feature columns cannot be imputed: {x.columns[x.isna().all()].tolist()}")
    train_idx, val_idx, test_idx, stratification = split_rows(frame)
    near_keys = near_duplicate_input_keys(frame)
    split_for_row = np.empty(len(frame), dtype=object)
    split_for_row[train_idx] = "train"
    split_for_row[val_idx] = "validation"
    split_for_row[test_idx] = "test"
    near_split_counts = pd.DataFrame({"key": near_keys.to_numpy(), "split": split_for_row}).groupby("key")["split"].nunique()
    near_cross_split_groups = int((near_split_counts > 1).sum())
    if near_cross_split_groups:
        raise ValueError(
            f"{near_cross_split_groups} near-identical input groups (numeric features rounded to 0.01) "
            "cross train/validation/test. Regroup these cases before training to prevent leakage."
        )
    fit_val_idx = np.concatenate([train_idx, val_idx])
    args.out_dir.mkdir(parents=True, exist_ok=True)

    comparison_rows: list[dict] = []
    validation_rows: list[dict] = []
    test_rows: list[dict] = []
    importance_rows: list[dict] = []
    predictions: list[pd.DataFrame] = []
    final_models: dict[str, object] = {}
    selected_models: dict[str, dict] = {}
    selected_fit_pipelines: dict[str, object] = {}
    cached_test_by_target: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    for target in TARGETS:
        y = frame[target].astype(float)
        best = None
        best_pipeline = None
        best_train_metrics = None
        best_val_metrics = None
        best_val_pred = None
        for spec in model_specs():
            pipeline = fit_pipe(x.iloc[train_idx], spec)
            pipeline.fit(x.iloc[train_idx], y.iloc[train_idx])
            train_pred = constrain_predictions(target, pipeline.predict(x.iloc[train_idx]))
            val_pred = constrain_predictions(target, pipeline.predict(x.iloc[val_idx]))
            train_score = score(y.iloc[train_idx], train_pred)
            val_score = score(y.iloc[val_idx], val_pred)
            comparison_rows.append({
                "target": target, "model_name": spec["name"], "model_family": spec["family"],
                "hyperparameters": json.dumps(spec["params"], sort_keys=True),
                "train_mae": train_score["mae"], "train_rmse": train_score["rmse"], "train_r2": train_score["r2"],
                "validation_mae": val_score["mae"], "validation_rmse": val_score["rmse"], "validation_r2": val_score["r2"],
            })
            if best is None or val_score["mae"] < best_val_metrics["mae"]:
                best = spec
                best_pipeline = pipeline
                best_train_metrics = train_score
                best_val_metrics = val_score
                best_val_pred = val_pred

        assert best is not None and best_pipeline is not None
        train_baseline = float(y.iloc[train_idx].median())
        validation_baseline = float(mean_absolute_error(y.iloc[val_idx], np.full(len(val_idx), train_baseline)))
        validation_rows.append({
            "target": target, "model_name": best["name"], "model_family": best["family"],
            "hyperparameters": json.dumps(best["params"], sort_keys=True),
            "train_mae": best_train_metrics["mae"], "train_rmse": best_train_metrics["rmse"], "train_r2": best_train_metrics["r2"],
            "mae": best_val_metrics["mae"], "rmse": best_val_metrics["rmse"], "r2": best_val_metrics["r2"],
            "baseline_mae": validation_baseline,
            "relative_improvement_pct": improvement(validation_baseline, best_val_metrics["mae"]),
            "val_minus_train_mae": best_val_metrics["mae"] - best_train_metrics["mae"],
        })
        selected_models[target] = {"name": best["name"], "family": best["family"], "hyperparameters": best["params"]}
        selected_fit_pipelines[target] = best_pipeline

        constrained_mae_scorer = lambda estimator, rows, labels: -mean_absolute_error(
            labels, constrain_predictions(target, estimator.predict(rows))
        )
        permutation = permutation_importance(
            best_pipeline, x.iloc[val_idx], y.iloc[val_idx],
            scoring=constrained_mae_scorer, n_repeats=5, random_state=SEED, n_jobs=1,
        )
        for feature, mean_imp, std_imp in zip(FEATURES, permutation.importances_mean, permutation.importances_std):
            importance_rows.append({
                "target": target, "feature": feature,
                "mae_increase": float(mean_imp), "mae_increase_std": float(std_imp),
            })

        final_pipeline = fit_pipe(x.iloc[fit_val_idx], best)
        final_pipeline.fit(x.iloc[fit_val_idx], y.iloc[fit_val_idx])
        test_pred = constrain_predictions(target, final_pipeline.predict(x.iloc[test_idx]))
        test_score = score(y.iloc[test_idx], test_pred)
        test_baseline = float(y.iloc[fit_val_idx].median())
        test_baseline_mae = float(mean_absolute_error(y.iloc[test_idx], np.full(len(test_idx), test_baseline)))
        test_rows.append({
            "target": target, "model_name": best["name"], "model_family": best["family"],
            "hyperparameters": json.dumps(best["params"], sort_keys=True),
            **test_score, "baseline_mae": test_baseline_mae,
            "relative_improvement_pct": improvement(test_baseline_mae, test_score["mae"]),
        })
        final_models[target] = final_pipeline
        cached_test_by_target[target] = (y.iloc[test_idx].to_numpy(dtype=float), np.asarray(test_pred, dtype=float))

        table = frame.iloc[test_idx][[column for column in ["Case_ID", "Material", "External_Temperature_C", "Wall_Thickness_m", "Solar_Radiation_W_m2"] if column in frame]].copy()
        table["target"] = target
        table["actual"] = y.iloc[test_idx].to_numpy(dtype=float)
        table["predicted"] = test_pred
        table["error"] = test_pred - y.iloc[test_idx].to_numpy(dtype=float)
        table["absolute_error"] = np.abs(table["error"])
        predictions.append(table)

    validation_comparison = pd.DataFrame(comparison_rows)
    validation_metrics = pd.DataFrame(validation_rows)
    test_metrics = pd.DataFrame(test_rows)
    importance = pd.DataFrame(importance_rows)
    test_predictions = pd.concat(predictions, ignore_index=True)
    validation_comparison.to_csv(args.out_dir / "validation_model_comparison.csv", index=False)
    validation_metrics.to_csv(args.out_dir / "validation_metrics.csv", index=False)
    test_metrics.to_csv(args.out_dir / "heldout_test_metrics.csv", index=False)
    importance.sort_values(["target", "mae_increase"], ascending=[True, False]).to_csv(args.out_dir / "feature_importance.csv", index=False)
    test_predictions.to_csv(args.out_dir / "heldout_test_predictions.csv", index=False)

    per_material, largest, binned = write_error_outputs(test_predictions, args.out_dir)
    for target, (actual, predicted) in cached_test_by_target.items():
        svg_diagnostic(target, actual, predicted, args.out_dir / f"diagnostic_{target}.svg")
        svg_importance(target, importance[importance["target"] == target], args.out_dir / f"feature_importance_{target}.svg")

    group_frame = frame.iloc[fit_val_idx].reset_index(drop=True)
    group_x = x.iloc[fit_val_idx].reset_index(drop=True)
    material_count = group_frame["Material"].nunique()
    material_folds = 0
    material_metrics = []
    if material_count >= 2:
        n_splits = min(3, group_frame["Material"].nunique())
        material_folds = n_splits
        material_cv = GroupKFold(n_splits=n_splits)
        groups = group_frame["Material"].astype(str)
        for target in TARGETS:
            y = group_frame[target].astype(float)
            spec = next(spec for spec in model_specs() if spec["name"] == selected_models[target]["name"])
            actual_all, predicted_all, baseline_all = [], [], []
            for fit_rows, held_rows in material_cv.split(group_x, y, groups=groups):
                pipe = fit_pipe(group_x.iloc[fit_rows], spec)
                pipe.fit(group_x.iloc[fit_rows], y.iloc[fit_rows])
                actual_all.extend(y.iloc[held_rows].tolist())
                predicted_all.extend(constrain_predictions(target, pipe.predict(group_x.iloc[held_rows])).tolist())
                baseline_all.extend([float(y.iloc[fit_rows].median())] * len(held_rows))
            group_score = score(actual_all, predicted_all)
            base_mae = float(mean_absolute_error(actual_all, baseline_all))
            material_metrics.append({
                "target": target, "status": "computed", "folds": n_splits,
                **group_score, "baseline_mae": base_mae,
                "relative_improvement_pct": improvement(base_mae, group_score["mae"]),
            })
    else:
        material_metrics = [{"target": target, "status": "not_applicable", "reason": "Fewer than two unique material names."} for target in TARGETS]
    material_metrics_frame = pd.DataFrame(material_metrics)
    material_metrics_frame.to_csv(args.out_dir / "material_holdout_metrics.csv", index=False)

    source_names = frame["Dataset_Source"].astype(str)
    inspection = json.loads(args.inspection.read_text(encoding="utf-8")) if args.inspection else None
    inspected_files = inspection.get("files", []) if inspection else []
    source_metrics = []
    if source_names.nunique() >= 2:
        group_frame = frame.iloc[fit_val_idx].reset_index(drop=True)
        group_x = x.iloc[fit_val_idx].reset_index(drop=True)
        group_sources = group_frame["Dataset_Source"].astype(str)
        n_splits = int(group_sources.nunique())
        source_cv = GroupKFold(n_splits=n_splits)
        for target in TARGETS:
            y = group_frame[target].astype(float)
            spec = next(spec for spec in model_specs() if spec["name"] == selected_models[target]["name"])
            actual_all, predicted_all, baseline_all = [], [], []
            for fit_rows, held_rows in source_cv.split(group_x, y, groups=group_sources):
                pipe = fit_pipe(group_x.iloc[fit_rows], spec)
                pipe.fit(group_x.iloc[fit_rows], y.iloc[fit_rows])
                actual_all.extend(y.iloc[held_rows].tolist())
                predicted_all.extend(constrain_predictions(target, pipe.predict(group_x.iloc[held_rows])).tolist())
                baseline_all.extend([float(y.iloc[fit_rows].median())] * len(held_rows))
            group_score = score(actual_all, predicted_all)
            base_mae = float(mean_absolute_error(actual_all, baseline_all))
            source_metrics.append({
                "target": target, "status": "computed", "folds": n_splits,
                **group_score, "baseline_mae": base_mae,
                "relative_improvement_pct": improvement(base_mae, group_score["mae"]),
            })
        source_note = f"Computed leave-one-source-out GroupKFold across {n_splits} Dataset_Source files. This is a limited transfer diagnostic across the supplied compatible sources; it does not validate a new generation method, independent CFD runs, or field measurements."
    else:
        source_metrics = [{"target": target, "status": "not_applicable", "reason": "Only one compatible Dataset_Source was used for this fit."} for target in TARGETS]
        if len(inspected_files) > len(data_meta["sources"]):
            source_note = "Not applicable: only one compatible Dataset_Source was used. Other inspected files were kept separate because their schemas/required inputs/targets or solar units differ."
        else:
            source_note = "Not applicable: only one compatible Dataset_Source was supplied."
    source_metrics_frame = pd.DataFrame(source_metrics)
    source_metrics_frame.to_csv(args.out_dir / "source_holdout_metrics.csv", index=False)

    selected_names = {item["filename"] for item in data_meta["sources"]}
    training_audits = [item for item in inspected_files if item.get("filename") in selected_names]
    physical_violations = (
        sum(int(check.get("violations", 0)) for item in training_audits for check in item.get("physical_checks", []))
        if training_audits else "See dataset_inspection.md/json"
    )
    combined_audit = inspection.get("combined_quality", {}) if inspection else {}
    high_corr_pairs = combined_audit.get("highly_correlated_numeric_feature_pairs_abs_r_ge_0_98", [])
    missing_nonmodel_metadata = {
        column: int(frame[column].isna().sum())
        for column in frame.columns
        if column not in FEATURES + TARGETS and frame[column].isna().any()
    }
    data_quality = {
        "rows": int(len(frame)),
        "missing_feature_cells": int(x.isna().sum().sum()),
        "missing_target_cells": int(frame[TARGETS].isna().sum().sum()),
        "missing_nonmodel_metadata_cells": missing_nonmodel_metadata,
        "nonfinite_numeric_cells": int(np.isinf(frame[NUMERIC_FEATURES + TARGETS].to_numpy(dtype=float)).sum()),
        "duplicate_rows_in_training_source": int(sum(item["duplicate_rows_in_file"] for item in data_meta["sources"])),
        "duplicate_case_ids_in_training_source": int(sum(item["duplicate_case_ids_in_file"] or 0 for item in data_meta["sources"])),
        "duplicate_model_input_target_cases_removed": int(data_meta["exact_duplicate_case_signatures_removed"]),
        "near_duplicate_input_signatures_round_0_01": int(near_keys.duplicated().sum()),
        "near_duplicate_groups_crossing_splits": near_cross_split_groups,
        "constant_columns": [column for column in frame.columns if frame[column].nunique(dropna=False) <= 1],
        "physical_violations": physical_violations,
        "highly_correlated_features": high_corr_pairs,
    }
    selected_manifest = data_meta["sources"]
    if len(selected_manifest) > 1:
        combination_decision = (
            f"All {len(selected_manifest)} workbooks passed the required input/target schema checks. "
            f"The only source schema difference was optional Batch metadata; they were combined with Dataset_Source provenance. "
            f"{data_meta['exact_duplicate_case_signatures_removed']} exact duplicate input/target cases were removed."
        )
    else:
        excluded = [item["filename"] for item in inspected_files if item["filename"] not in {s["filename"] for s in selected_manifest}]
        if excluded:
            combination_decision = (
                "Only the selected full-feature source was used for the six-target fit. Other inspected CSVs were kept separate because their schemas/inputs/targets differ; see Source disposition above."
            )
        else:
            combination_decision = "One compatible source was supplied; no cross-file combination was required."
    metadata = {
        "dataset_name": [item["filename"] for item in selected_manifest],
        "data": data_meta,
        "artifact_dir": str(args.out_dir),
        "model_filename": args.model_filename,
        "inspection_path": str(args.inspection) if args.inspection else None,
        "inspected_files": inspected_files,
        "previous_v2": inspection.get("previous_v2", {}) if inspection else {},
        "combination_decision": combination_decision,
        "features": FEATURES,
        "targets": TARGETS,
        "output_constraints": {target: {"minimum": 0.0} for target in sorted(NONNEGATIVE_TARGETS)},
        "selected_models": selected_models,
        "split": {"train": int(len(train_idx)), "validation": int(len(val_idx)), "test": int(len(test_idx)), "stratification": stratification, "random_seed": SEED},
        "material_group_count": int(material_count),
        "material_holdout_folds": int(material_folds),
        "source_holdout_note": source_note,
        "data_quality": data_quality,
        "feature_ranges": {
            column: {"min": float(pd.to_numeric(x.iloc[fit_val_idx][column], errors="coerce").min()),
                    "max": float(pd.to_numeric(x.iloc[fit_val_idx][column], errors="coerce").max())}
            for column in NUMERIC_FEATURES
        },
        "categorical_values": {column: sorted(frame[column].dropna().astype(str).unique().tolist()) for column in ["Material", "Material_Category"]},
        "provenance": {item["filename"]: item["provenance"] for item in data_meta["sources"]},
        "library_versions": {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__, "scikit_learn": sklearn.__version__, "joblib": joblib.__version__},
        "metrics": {"validation": validation_metrics.to_dict(orient="records"), "heldout_test": test_metrics.to_dict(orient="records"), "material_holdout": material_metrics, "source_holdout": source_metrics},
        "notes": [
            "Input features exclude Case_ID, Dataset_Source, provenance IDs, and all output columns.",
            "Recommended_Split is retained as source metadata but not used as a model feature; the V3 split is regenerated with seed 42 and stratified by source and material.",
            "Model scores compare predictions with the supplied labels. Interpret provenance only from the actual metadata recorded for each source.",
            "Current data are run-level summaries, not hourly time series.",
        ],
    }
    model_path = args.out_dir / args.model_filename
    metadata["model_artifact"] = str(model_path)
    joblib.dump({"models": final_models, "features": FEATURES, "targets": TARGETS, "metadata": metadata}, model_path, compress=3)
    (args.out_dir / "model_metadata.json").write_text(json.dumps(metadata, indent=2, default=str), encoding="utf-8")

    example_input = {key: (value.item() if isinstance(value, np.generic) else value) for key, value in x.iloc[int(test_idx[0])].to_dict().items()}
    (args.out_dir / "example_input.json").write_text(json.dumps(example_input, indent=2), encoding="utf-8")
    (args.out_dir / "training_report.md").write_text(
        report_text(metadata, validation_metrics, test_metrics, material_metrics_frame, source_metrics_frame, importance, per_material, largest, inspection),
        encoding="utf-8",
    )

    print(f"Data sources used: {len(data_meta['sources'])}; rows: {data_meta['final_unique_rows']}; exact duplicates removed: {data_meta['exact_duplicate_rows_removed']}")
    print(f"Split: {len(train_idx)} train / {len(val_idx)} validation / {len(test_idx)} test")
    print("Validation-selected models and final held-out metrics:")
    print(test_metrics[["target", "model_name", "mae", "rmse", "r2", "baseline_mae", "relative_improvement_pct"]].to_string(index=False, float_format=lambda v: f"{v:.4f}"))
    print("Material-held-out metrics:")
    print(material_metrics_frame.to_string(index=False, float_format=lambda v: f"{v:.4f}"))
    print(source_note)
    print(f"Saved model: {model_path.resolve()}")
    print(f"Artifacts written to: {args.out_dir.resolve()}")


if __name__ == "__main__":
    main()
