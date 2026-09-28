"""Audit THERMOSHELTER source workbooks before V3 training."""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd

FEATURES = [
    "Material", "Material_Category", "Thermal_Conductivity_W_mK", "Density_kg_m3", "Specific_Heat_J_kgK",
    "Wall_Thickness_m", "Shelter_Length_m", "Shelter_Width_m", "Shelter_Height_m", "Opening_Area_m2",
    "Window_Area_m2", "Door_Area_m2", "Orientation_deg", "External_Temperature_C",
    "Initial_Air_Temperature_C", "Solar_Radiation_W_m2", "Daily_Solar_Energy_kWh_m2", "Wind_Speed_m_s",
    "Relative_Humidity_percent", "Simulation_Duration_h", "Time_Step_min",
]
TARGETS = [
    "Average_Air_Temperature_C", "Minimum_Air_Temperature_C", "Maximum_Air_Temperature_C",
    "Solar_Heat_Input_W", "Heat_Transfer_Rate_W", "Thermal_Energy_Loss_Wh",
]
NUMERIC_FEATURES = [column for column in FEATURES if column not in {"Material", "Material_Category"}]


OPTIONAL_SOURCE_COLUMNS = {"Batch"}
PROVENANCE_COLUMNS = [
    "Data_Type", "CFD_Reference", "Climate_Data_Source", "Material_Data_Source", "Surrogate_Method"
]


def values(series: pd.Series) -> list[str]:
    return sorted(series.dropna().astype(str).unique().tolist())


def read_case_sheet(path: Path) -> tuple[pd.DataFrame, str, list[dict]]:
    workbook = pd.ExcelFile(path)
    required = set(FEATURES + TARGETS)
    sheets = []
    matching = []
    for sheet_name in workbook.sheet_names:
        header = pd.read_excel(workbook, sheet_name=sheet_name, nrows=0)
        sheet_info = {"name": sheet_name, "columns": list(header.columns)}
        sheets.append(sheet_info)
        if required.issubset(header.columns):
            matching.append(sheet_name)
    if len(matching) != 1:
        raise ValueError(f"{path}: expected one sheet with all required inputs/targets; found {matching}.")
    sheet_name = matching[0]
    return pd.read_excel(workbook, sheet_name=sheet_name), sheet_name, sheets


def row_hashes(frame: pd.DataFrame, columns: list[str], rounded: bool = False) -> set[int]:
    signature = frame[columns].copy()
    if rounded:
        for column in NUMERIC_FEATURES:
            if column in signature:
                signature[column] = pd.to_numeric(signature[column], errors="coerce").round(2)
        for column in ("Material", "Material_Category"):
            if column in signature:
                signature[column] = signature[column].astype("string").str.strip()
    return set(pd.util.hash_pandas_object(signature, index=False).astype("uint64").tolist())


def physical_checks(frame: pd.DataFrame) -> list[dict]:
    checks = {
        "positive material properties, dimensions, duration, and time step": (
            frame[["Thermal_Conductivity_W_mK", "Density_kg_m3", "Specific_Heat_J_kgK", "Wall_Thickness_m", "Shelter_Length_m", "Shelter_Width_m", "Shelter_Height_m", "Simulation_Duration_h", "Time_Step_min"]] <= 0
        ).any(axis=1),
        "nonnegative areas, solar inputs, and wind speed": (
            frame[["Opening_Area_m2", "Window_Area_m2", "Door_Area_m2", "Solar_Radiation_W_m2", "Daily_Solar_Energy_kWh_m2", "Wind_Speed_m_s"]] < 0
        ).any(axis=1),
        "relative humidity in 0–100 percent": ~frame["Relative_Humidity_percent"].between(0, 100),
        "orientation in 0–360 degrees": ~frame["Orientation_deg"].between(0, 360),
        "opening area equals window plus door area": ~np.isclose(frame["Opening_Area_m2"], frame["Window_Area_m2"] + frame["Door_Area_m2"], atol=1e-6),
        "minimum <= average <= maximum air temperature": ~(
            (frame["Minimum_Air_Temperature_C"] <= frame["Average_Air_Temperature_C"])
            & (frame["Average_Air_Temperature_C"] <= frame["Maximum_Air_Temperature_C"])
        ),
        "minimum <= average <= maximum wall temperature": ~(
            (frame["Minimum_Wall_Temperature_C"] <= frame["Average_Wall_Temperature_C"])
            & (frame["Average_Wall_Temperature_C"] <= frame["Maximum_Wall_Temperature_C"])
        ),
        "nonnegative solar heat input and thermal energy loss": (
            (frame["Solar_Heat_Input_W"] < 0) | (frame["Thermal_Energy_Loss_Wh"] < 0)
        ),
    }
    return [{"check": label, "violations": int(mask.sum())} for label, mask in checks.items()]


def numeric_summary(frame: pd.DataFrame) -> dict:
    result = {}
    for column in frame.select_dtypes(include="number").columns:
        values = pd.to_numeric(frame[column], errors="coerce")
        finite = values[np.isfinite(values)]
        if finite.empty:
            continue
        q1, q3 = finite.quantile([0.25, 0.75])
        iqr = q3 - q1
        lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        result[column] = {
            "min": float(finite.min()), "max": float(finite.max()), "mean": float(finite.mean()),
            "nonfinite": int((~np.isfinite(values.to_numpy(dtype=float))).sum()),
            "iqr_flag_count": int(((finite < lower) | (finite > upper)).sum()),
            "iqr_lower_fence": float(lower), "iqr_upper_fence": float(upper),
        }
    return result


def inspect_time_series(path: Path, main_frame: pd.DataFrame, sheet_infos: list[dict]) -> list[dict]:
    workbook = pd.ExcelFile(path)
    found = []
    for sheet_info in sheet_infos:
        if "Transient" not in sheet_info["name"]:
            continue
        df = pd.read_excel(workbook, sheet_name=sheet_info["name"])
        has_hour = "Hour" in df
        per_case = df.groupby("Case_ID")["Hour"].agg(["count", "nunique"]) if has_hour and "Case_ID" in df else None
        found.append({
            "sheet_name": sheet_info["name"], "rows": int(len(df)), "columns": int(len(df.columns)),
            "column_names": list(df.columns), "missing_cells": int(df.isna().sum().sum()),
            "case_count": int(df["Case_ID"].nunique()) if "Case_ID" in df else None,
            "cases_present_in_summary_sheet": int(df["Case_ID"].astype(str).isin(main_frame["Case_ID"].astype(str)).groupby(df["Case_ID"]).any().sum()) if "Case_ID" in df else None,
            "hour_min": int(df["Hour"].min()) if has_hour and len(df) else None,
            "hour_max": int(df["Hour"].max()) if has_hour and len(df) else None,
            "rows_per_case_counts": {str(k): int(v) for k, v in df.groupby("Case_ID").size().value_counts().sort_index().items()} if "Case_ID" in df else {},
            "unique_hours_per_case_range": [int(per_case["nunique"].min()), int(per_case["nunique"].max())] if per_case is not None and len(per_case) else None,
            "time_varying_output_columns": [c for c in ["Indoor_Temperature_C", "Wall_Temperature_C", "Heat_Transfer_Rate_W", "Solar_Heat_Input_W"] if c in df],
        })
    return found


def inspect_source(path: Path) -> dict:
    frame, sheet_name, sheet_infos = read_case_sheet(path)
    missing_features = [c for c in FEATURES if c not in frame]
    missing_targets = [c for c in TARGETS if c not in frame]
    case_ids = frame["Case_ID"].astype(str) if "Case_ID" in frame else pd.Series(dtype=str)
    id_number = pd.to_numeric(case_ids.str.extract(r"CASE_(\d+)", expand=False), errors="coerce")
    numeric = frame.select_dtypes(include="number")
    provenance = {c: values(frame[c]) for c in PROVENANCE_COLUMNS + ["Batch"] if c in frame}
    main_columns = list(frame.columns)
    transient = inspect_time_series(path, frame, sheet_infos)
    ref_sheets = []
    workbook = pd.ExcelFile(path)
    for sheet_info in sheet_infos:
        if "CFD_Reference" in sheet_info["name"] or "Calibration" in sheet_info["name"]:
            ref = pd.read_excel(workbook, sheet_name=sheet_info["name"])
            ref_sheets.append({
                "sheet_name": sheet_info["name"], "rows": int(len(ref)), "columns": int(len(ref.columns)),
                "column_names": list(ref.columns),
            })
    categories_by_material = frame.groupby("Material")["Material_Category"].nunique()
    signature = row_hashes(frame, FEATURES)
    rounded_signature = row_hashes(frame, FEATURES, rounded=True)
    return {
        "filename": path.name, "path": str(path.resolve()), "file_type": path.suffix.lower().lstrip("."),
        "file_size_bytes": int(path.stat().st_size), "sheet_name": sheet_name,
        "rows": int(len(frame)), "columns": int(len(frame.columns)), "column_names": main_columns,
        "dtypes": {c: str(frame[c].dtype) for c in main_columns},
        "dtype_counts": {str(k): int(v) for k, v in frame.dtypes.astype(str).value_counts().items()},
        "sheets": [
            {
                "name": s["name"],
                "rows": int(len(pd.read_excel(workbook, sheet_name=s["name"]))),
                "columns": len(s["columns"]),
                "column_names": s["columns"],
            }
            for s in sheet_infos
        ],
        "reference_and_calibration_sheets": ref_sheets, "time_series_sheets": transient,
        "missing_by_column": {c: int(n) for c, n in frame.isna().sum().items() if n},
        "missing_feature_cells": int(frame[FEATURES].isna().sum().sum()),
        "missing_target_cells": int(frame[TARGETS].isna().sum().sum()),
        "nonfinite_numeric_cells": int((~np.isfinite(numeric.to_numpy(dtype=float))).sum()),
        "duplicate_rows": int(frame.duplicated().sum()),
        "duplicate_case_ids": int(case_ids.duplicated().sum()) if len(case_ids) else None,
        "case_id_unique_count": int(case_ids.nunique()) if len(case_ids) else 0,
        "case_id_range": [str(case_ids.min()), str(case_ids.max())] if len(case_ids) else None,
        "case_id_numeric_range": [int(id_number.min()), int(id_number.max())] if len(id_number) and id_number.notna().all() else None,
        "materials": {str(k): int(v) for k, v in frame["Material"].value_counts().sort_index().items()},
        "material_categories": {str(k): int(v) for k, v in frame["Material_Category"].value_counts().sort_index().items()},
        "material_category_mapping_consistent": bool((categories_by_material <= 1).all()),
        "data_type_values": values(frame["Data_Type"]) if "Data_Type" in frame else [],
        "provenance": provenance,
        "missing_expected_features": missing_features,
        "missing_expected_targets": missing_targets,
        "input_signature_unique_count": len(signature),
        "exact_duplicate_input_signatures": int(len(frame) - len(signature)),
        "rounded_0_01_input_signature_unique_count": len(rounded_signature),
        "rounded_0_01_duplicate_input_signatures": int(len(frame) - len(rounded_signature)),
        "numeric_ranges": numeric_summary(frame),
        "physical_checks": physical_checks(frame),
        "iqr_outliers_retained": True,
    }


def is_inside_artifacts(path: Path, project_dir: Path) -> bool:
    try:
        relative = path.relative_to(project_dir)
    except ValueError:
        return False
    return "artifacts" in relative.parts


def discover(project_dir: Path) -> tuple[list[dict], list[tuple[Path, pd.DataFrame, str]], list[dict]]:
    inventories = []
    sources = []
    derived = []
    supported = {".csv", ".xlsx", ".xlsm", ".xls"}
    for path in sorted(project_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in supported or "node_modules" in path.parts:
            continue
        try:
            if path.suffix.lower() == ".csv":
                header = pd.read_csv(path, nrows=0)
                if not set(FEATURES + TARGETS).issubset(header.columns):
                    continue
                frame = pd.read_csv(path)
                sheet_name = "CSV table"
            else:
                frame, sheet_name, _ = read_case_sheet(path)
        except (ValueError, OSError, ImportError, pd.errors.ParserError):
            continue
        item = {
            "filename": path.name, "path": str(path.resolve()), "file_type": path.suffix.lower().lstrip("."),
            "rows": int(len(frame)), "columns": int(len(frame.columns)), "sheet_name": sheet_name,
            "classification": "derived_full_feature_artifact" if is_inside_artifacts(path, project_dir) else "candidate_source",
        }
        inventories.append(item)
        if is_inside_artifacts(path, project_dir):
            derived.append(item)
        else:
            sources.append((path, frame, sheet_name))
    return inventories, sources, derived


def previous_v2(project_dir: Path, sources: list[tuple[Path, pd.DataFrame, str]]) -> dict:
    artifact_dir = project_dir / "ml" / "artifacts" / "v2"
    metadata_path = artifact_dir / "model_metadata.json"
    report_path = artifact_dir / "training_report.md"
    if not metadata_path.is_file():
        return {"available": False}
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    prior_sources = metadata.get("data", {}).get("sources", [])
    old_combined = artifact_dir / "combined_training_data.csv"
    prior_frame = pd.read_csv(old_combined) if old_combined.is_file() else pd.DataFrame()
    results = []
    for path, frame, _ in sources:
        stem = path.stem
        match = next((s for s in prior_sources if Path(s.get("filename", "")).stem == stem), None)
        content = {"comparable": False}
        if match is not None and not prior_frame.empty and "Dataset_Source" in prior_frame:
            old_rows = prior_frame[prior_frame["Dataset_Source"].astype(str) == match["filename"]].copy()
            if "Case_ID" in frame and "Case_ID" in old_rows:
                current = frame.set_index("Case_ID")
                previous = old_rows.set_index("Case_ID")
                ids = current.index.intersection(previous.index)
                columns = [c for c in FEATURES + TARGETS if c in current and c in previous]
                current, previous = current.loc[ids, columns], previous.loc[ids, columns]
                equal_cells = 0
                comparable_cells = 0
                for column in columns:
                    if column in NUMERIC_FEATURES or column in TARGETS:
                        a = pd.to_numeric(current[column], errors="coerce").to_numpy(dtype=float)
                        b = pd.to_numeric(previous[column], errors="coerce").to_numpy(dtype=float)
                        equal_cells += int(np.isclose(a, b, rtol=0, atol=0, equal_nan=True).sum())
                    else:
                        equal_cells += int((current[column].astype(str).to_numpy() == previous[column].astype(str).to_numpy()).sum())
                    comparable_cells += len(ids)
                content = {
                    "comparable": True, "matched_case_ids": int(len(ids)),
                    "v2_rows": int(len(old_rows)), "current_rows": int(len(frame)),
                    "model_input_target_cells_equal": int(equal_cells), "model_input_target_cells_compared": int(comparable_cells),
                    "content_equivalent": bool(len(ids) == len(frame) == len(old_rows) and equal_cells == comparable_cells),
                }
        results.append({
            "current_filename": path.name, "current_path": str(path.resolve()),
            "previously_used": match is not None,
            "previous_source_filename": match.get("filename") if match else None,
            "previous_source_path": match.get("path") if match else None,
            "previous_rows": match.get("rows_in") if match else None,
            "current_matches_previous_content": content,
        })
    commands = []
    if report_path.is_file():
        for line in report_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("python ml/train_thermal_surrogate.py"):
                commands.append(line)
    return {
        "available": True, "metadata_path": str(metadata_path.resolve()), "report_path": str(report_path.resolve()),
        "previous_raw_rows": metadata.get("data", {}).get("input_row_total_before_deduplication"),
        "previous_unique_rows": metadata.get("data", {}).get("final_unique_rows"),
        "previous_source_count": metadata.get("data", {}).get("combined_source_count"),
        "previous_sources": prior_sources, "training_command": commands, "current_file_disposition": results,
    }


def cross_compare(entries: list[dict], frames: list[pd.DataFrame]) -> list[dict]:
    comparisons = []
    exact_cols = FEATURES + TARGETS
    for i in range(len(frames)):
        for j in range(i + 1, len(frames)):
            left, right = frames[i], frames[j]
            ids_left = set(left["Case_ID"].astype(str))
            ids_right = set(right["Case_ID"].astype(str))
            exact_left, exact_right = row_hashes(left, exact_cols), row_hashes(right, exact_cols)
            input_left, input_right = row_hashes(left, FEATURES), row_hashes(right, FEATURES)
            near_left, near_right = row_hashes(left, FEATURES, rounded=True), row_hashes(right, FEATURES, rounded=True)
            left_cols, right_cols = set(left.columns), set(right.columns)
            left_core = left_cols - OPTIONAL_SOURCE_COLUMNS
            right_core = right_cols - OPTIONAL_SOURCE_COLUMNS
            comparisons.append({
                "left": entries[i]["filename"], "right": entries[j]["filename"],
                "identical_schema": left_core == right_core,
                "left_columns": len(left_cols), "right_columns": len(right_cols),
                "optional_schema_differences": {"left_missing": sorted(right_cols - left_cols), "right_missing": sorted(left_cols - right_cols)},
                "required_inputs_and_targets_compatible": set(FEATURES + TARGETS).issubset(left_cols & right_cols),
                "case_id_overlap": len(ids_left & ids_right),
                "exact_row_overlap": len(exact_left & exact_right),
                "exact_input_signature_overlap": len(input_left & input_right),
                "rounded_0_01_input_signature_overlap": len(near_left & near_right),
            })
    return comparisons


def combined_quality(frames: list[pd.DataFrame], filenames: list[str]) -> dict:
    combined = pd.concat(frames, ignore_index=True, sort=False)
    combined["Dataset_Source"] = np.repeat(filenames, [len(frame) for frame in frames])
    numeric = combined.select_dtypes(include="number")
    corr = combined[NUMERIC_FEATURES].corr().abs()
    high_corr = []
    for i, left in enumerate(NUMERIC_FEATURES):
        for right in NUMERIC_FEATURES[i + 1:]:
            value = float(corr.loc[left, right])
            if value >= 0.98:
                high_corr.append({"left": left, "right": right, "abs_pearson_r": value})
    exact_keys = pd.util.hash_pandas_object(combined[FEATURES], index=False)
    rounded = combined[FEATURES].copy()
    for column in NUMERIC_FEATURES:
        rounded[column] = pd.to_numeric(rounded[column], errors="coerce").round(2)
    rounded_keys = pd.util.hash_pandas_object(rounded, index=False)
    material_map = combined.groupby("Material")["Material_Category"].nunique()
    source_split = combined.groupby("Dataset_Source").size().to_dict()
    return {
        "raw_rows": int(len(combined)), "unique_case_ids": int(combined["Case_ID"].nunique()),
        "duplicate_case_ids": int(combined["Case_ID"].duplicated().sum()),
        "duplicate_full_rows": int(combined.drop(columns=["Dataset_Source"]).duplicated().sum()),
        "required_feature_missing_cells": int(combined[FEATURES].isna().sum().sum()),
        "required_target_missing_cells": int(combined[TARGETS].isna().sum().sum()),
        "nonmodel_metadata_missing_cells": {c: int(n) for c, n in combined.isna().sum().items() if n and c not in FEATURES + TARGETS},
        "nonfinite_numeric_cells": int((~np.isfinite(numeric.to_numpy(dtype=float))).sum()),
        "exact_duplicate_input_signatures": int(exact_keys.duplicated().sum()),
        "exact_duplicate_input_target_cases": int(combined.duplicated(subset=FEATURES + TARGETS).sum()),
        "rounded_0_01_duplicate_input_signatures": int(rounded_keys.duplicated().sum()),
        "source_row_counts": {str(k): int(v) for k, v in source_split.items()},
        "recommended_split_counts": {str(k): int(v) for k, v in combined["Recommended_Split"].value_counts().items()} if "Recommended_Split" in combined else {},
        "physical_checks": physical_checks(combined),
        "highly_correlated_numeric_feature_pairs_abs_r_ge_0_98": high_corr,
        "material_category_mapping_consistent": bool((material_map <= 1).all()),
        "opening_area_equals_window_plus_door": bool(np.isclose(combined["Opening_Area_m2"], combined["Window_Area_m2"] + combined["Door_Area_m2"], atol=1e-6).all()),
        "feature_ranges": {k: {"min": v["min"], "max": v["max"]} for k, v in numeric_summary(combined[FEATURES + TARGETS]).items()},
        "iqr_outlier_counts_retained": {k: v["iqr_flag_count"] for k, v in numeric_summary(combined[FEATURES + TARGETS]).items()},
    }


def make_markdown(report: dict) -> str:
    lines = [
        "# THERMOSHELTER V3 dataset audit", "",
        "## Current source workbooks", "",
        "The audit searched the project recursively for CSV and Excel tables containing all 21 model inputs and six targets. It selected a workbook only when exactly one sheet contained that full case-level schema.", "",
        "| Filename | Full path | Type | Design rows | Columns | Prior V2 use |", "|---|---|---:|---:|---:|---|",
    ]
    previous = {item["current_filename"]: item for item in report["previous_v2"].get("current_file_disposition", [])}
    for item in report["files"]:
        prev = previous.get(item["filename"], {})
        prior = "YES" if prev.get("previously_used") else "NO"
        lines.append(f"| `{item['filename']}` | `{item['path']}` | {item['file_type']} | {item['rows']:,} | {item['columns']} | {prior} |")
    lines.extend(["", "### V2 history", ""])
    v2 = report["previous_v2"]
    lines.append(f"V2 used {v2.get('previous_raw_rows', 0):,} raw rows and {v2.get('previous_unique_rows', 0):,} unique rows from {v2.get('previous_source_count', 0)} sources.")
    for source in v2.get("previous_sources", []):
        lines.append(f"- `{source['filename']}`: `{source['path']}`, {source['rows_in']:,} rows.")
    for item in v2.get("current_file_disposition", []):
        if item.get("previously_used"):
            match = item.get("current_matches_previous_content", {})
            lines.append(f"- Current `{item['current_filename']}` matches the prior modeled records: {match.get('matched_case_ids', 0):,}/{match.get('current_rows', 0):,} case IDs; modeled input/target cells equal: {match.get('model_input_target_cells_equal', 0):,}/{match.get('model_input_target_cells_compared', 0):,}.")
    lines.extend(["", "## Per-workbook data audit", ""])
    for item in report["files"]:
        lines.extend([
            f"### `{item['filename']}`", "",
            f"Path: `{item['path']}`  ",
            f"Design sheet: `{item['sheet_name']}`; {item['rows']:,} rows × {item['columns']} columns; {item['file_size_bytes']:,} bytes.",
            f"Case_ID range: `{item['case_id_range'][0]}`–`{item['case_id_range'][1]}`; unique {item['case_id_unique_count']:,}; duplicate IDs {item['duplicate_case_ids']}; duplicate full rows {item['duplicate_rows']}.",
            f"Dtypes: `{item['dtype_counts']}`. Missing feature cells {item['missing_feature_cells']}; missing target cells {item['missing_target_cells']}; nonfinite numeric cells {item['nonfinite_numeric_cells']}.",
            f"Data_Type: `{item['data_type_values']}`. Provenance: `{item['provenance']}`.",
            f"Materials: `{list(item['materials'].keys())}`. Categories: `{list(item['material_categories'].keys())}`.",
            "Main-sheet columns:", "", "```text", ", ".join(item["column_names"]), "```", "",
            "Numeric ranges:", "", "| Column | Minimum | Maximum | IQR flags retained |", "|---|---:|---:|---:|",
        ])
        for column, stats in item["numeric_ranges"].items():
            lines.append(f"| `{column}` | {stats['min']:.6g} | {stats['max']:.6g} | {stats['iqr_flag_count']} |")
        lines.extend(["", "Physical checks:", ""])
        for check in item["physical_checks"]:
            lines.append(f"- {check['check']}: {check['violations']} violations.")
        for series in item["time_series_sheets"]:
            lines.append(f"- `{series['sheet_name']}`: {series['rows']:,} hourly records for {series['case_count']} cases, hours {series['hour_min']}–{series['hour_max']}, {series['rows_per_case_counts']} rows per case; used for V3 case-summary training: NO.")
        lines.append("")
    q = report["combined_quality"]
    lines.extend([
        "## Compatibility and combined checks", "",
        f"Compatibility decision: **{report['compatibility']['compatible']}**. Required inputs and targets are present in all four sources. The only main-sheet column difference is optional `Batch` metadata, absent from the first 1,500-row workbook. All required feature and target dtypes match.",
        f"Raw total {q['raw_rows']:,}; unique Case_IDs {q['unique_case_ids']:,}; duplicate IDs {q['duplicate_case_ids']}; duplicate full rows {q['duplicate_full_rows']}; exact duplicate modeled cases {q['exact_duplicate_input_target_cases']}; input signatures duplicated after 0.01 rounding {q['rounded_0_01_duplicate_input_signatures']}.",
        f"Missing required feature cells {q['required_feature_missing_cells']}; missing required target cells {q['required_target_missing_cells']}; nonfinite numeric cells {q['nonfinite_numeric_cells']}. Missing nonmodel metadata cells: `{q['nonmodel_metadata_missing_cells']}`.",
        f"High input correlations at |r| ≥ 0.98: `{q['highly_correlated_numeric_feature_pairs_abs_r_ge_0_98']}`. IQR flags are retained, not automatically discarded.",
        "", "## Important provenance and scope", "",
        "All four design sheets label their rows `PHYSICS_INFORMED_ESTIMATE`. Their stated climate source is representative Ladakh ranges, not a direct NASA POWER pull; material inputs use handbook ranges; the stated CFD reference is calibration against three ANSYS Fluent cases. These are not 6,500 independent ANSYS simulations or field validations.",
        "The workbooks contain 24-hour records for sampled configurations. V3 uses only the case-level design sheets for its six summary targets; its inference helper will not return hourly temperatures.",
        "The old 63-row and 36-row files were not present as full-feature project sources and are not included in the V3 source list.",
    ])
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-dir", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parent / "artifacts" / "v3")
    args = parser.parse_args()
    project_dir = args.project_dir.resolve()
    inventories, discovered, derived = discover(project_dir)
    sources = [(path, frame, sheet) for path, frame, sheet in discovered if not is_inside_artifacts(path, project_dir)]
    sources.sort(key=lambda source: int(re.search(r"CASE_(\d+)", str(source[1]["Case_ID"].min())).group(1)))
    if len(sources) != 4 or sorted(len(frame) for _, frame, _ in sources) != [1500, 1500, 1500, 2000]:
        raise ValueError(
            "Expected exactly four non-artifact full-feature source tables with 1,500/1,500/1,500/2,000 rows; "
            f"found {[(p.name, len(df)) for p, df, _ in sources]}. Review the project inventory before training."
        )
    files = [inspect_source(path) for path, _, _ in sources]
    comparisons = cross_compare(files, [frame for _, frame, _ in sources])
    all_required = all(not item["missing_expected_features"] and not item["missing_expected_targets"] for item in files)
    first_frame = sources[0][1]
    same_required_dtypes = all(
        str(frame[column].dtype) == str(first_frame[column].dtype)
        for _, frame, _ in sources[1:] for column in FEATURES + TARGETS
    )
    same_materials = all(set(item["materials"]) == set(files[0]["materials"]) for item in files)
    same_categories = all(set(item["material_categories"]) == set(files[0]["material_categories"]) for item in files)
    same_provenance = all(
        item["provenance"].get(column) == files[0]["provenance"].get(column)
        for item in files[1:] for column in PROVENANCE_COLUMNS
    )
    compatible = bool(all_required and same_required_dtypes and same_materials and same_categories and same_provenance and all(c["identical_schema"] for c in comparisons))
    frames = [frame for _, frame, _ in sources]
    quality = combined_quality(frames, [path.name for path, _, _ in sources])
    v2 = previous_v2(project_dir, sources)
    previous_by_name = {item["current_filename"]: item for item in v2.get("current_file_disposition", [])}
    for item in files:
        prior = previous_by_name.get(item["filename"], {})
        item["previously_used_in_v2"] = bool(prior.get("previously_used"))
        item["previous_v2_content_comparison"] = prior.get("current_matches_previous_content", {})
    report = {
        "project_dir": str(project_dir), "files": files,
        "full_feature_inventory": inventories, "derived_full_feature_artifacts": derived,
        "pairwise_comparisons": comparisons, "combined_quality": quality,
        "compatibility": {
            "compatible": compatible, "all_required_inputs_targets_present": all_required,
            "same_required_feature_target_dtypes": same_required_dtypes,
            "same_materials": same_materials, "same_material_categories": same_categories,
            "same_provenance": same_provenance,
            "units_and_meanings": "Required columns and their unit-bearing names match in all source sheets; the workbooks do not provide a separate independently verified unit catalog.",
            "optional_source_metadata_difference": "Batch is absent from ladakh_shelter_1500_physics_informed_dataset.xlsx and present in the other three workbooks; Dataset_Source will retain file provenance.",
            "model_input_columns": FEATURES, "target_columns": TARGETS,
            "training_sheet_policy": "Use only the unique case-level sheet with all 21 inputs and six targets; do not include transient, calibration, or split-reference sheets in six-target training.",
        },
        "previous_v2": v2,
    }
    if not compatible:
        raise ValueError("The four current source workbooks failed the compatibility audit. No training should run.")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "dataset_inspection.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    (args.out_dir / "dataset_inspection.md").write_text(make_markdown(report), encoding="utf-8")
    print("Current full-feature sources:")
    for item in files:
        previous = next((x for x in v2.get("current_file_disposition", []) if x["current_filename"] == item["filename"]), {})
        print(f"{item['filename']}: {item['rows']} rows, {item['columns']} columns, V2 used={previous.get('previously_used', False)}")
    print(f"Audit compatibility: {compatible}; raw rows={quality['raw_rows']}; unique Case_IDs={quality['unique_case_ids']}; exact duplicate cases={quality['exact_duplicate_input_target_cases']}; 0.01 near-input duplicates={quality['rounded_0_01_duplicate_input_signatures']}")
    print(f"Wrote {args.out_dir / 'dataset_inspection.json'}")
    print(f"Wrote {args.out_dir / 'dataset_inspection.md'}")


if __name__ == "__main__":
    main()
