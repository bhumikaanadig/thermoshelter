"""Inspect and combine the workbook hourly records without dropping source rows."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACT_DIR = PROJECT_ROOT / "ml" / "artifacts" / "v3"
WORKBOOK_PATTERN = "ladakh_shelter_*_physics_informed_dataset.xlsx"

BASE_FEATURES = [
    "Material", "Material_Category", "Thermal_Conductivity_W_mK", "Density_kg_m3",
    "Specific_Heat_J_kgK", "Wall_Thickness_m", "Shelter_Length_m", "Shelter_Width_m",
    "Shelter_Height_m", "Opening_Area_m2", "Window_Area_m2", "Door_Area_m2",
    "Orientation_deg", "External_Temperature_C", "Initial_Air_Temperature_C",
    "Solar_Radiation_W_m2", "Daily_Solar_Energy_kWh_m2", "Wind_Speed_m_s",
    "Relative_Humidity_percent", "Simulation_Duration_h", "Time_Step_min",
]
HOURLY_REQUIRED_COLUMNS = [
    "Case_ID", "Hour", "Outdoor_Temperature_C", "Solar_Radiation_W_m2",
    "Wind_Speed_m_s", "Indoor_Temperature_C", "Wall_Temperature_C",
    "Heat_Transfer_Rate_W", "Solar_Heat_Input_W",
]
HOURLY_CLIMATE_COLUMNS = [
    "Outdoor_Temperature_C", "Solar_Radiation_W_m2", "Wind_Speed_m_s",
]
TARGET_COLUMN = "Indoor_Temperature_C"
SPLITS = {"train", "validation", "test"}

CASE_COLUMN_RENAMES = {
    "Solar_Radiation_W_m2": "Case_Solar_Radiation_W_m2",
    "Wind_Speed_m_s": "Case_Wind_Speed_m_s",
    # The design sheets also contain summary outputs with these names. Keep
    # them separate from the matching per-hour values in the transient sheet.
    "Heat_Transfer_Rate_W": "Case_Heat_Transfer_Rate_W",
    "Solar_Heat_Input_W": "Case_Solar_Heat_Input_W",
}
HOURLY_COLUMN_RENAMES = {
    "Solar_Radiation_W_m2": "Hourly_Solar_Radiation_W_m2",
    "Wind_Speed_m_s": "Hourly_Wind_Speed_m_s",
    "Heat_Transfer_Rate_W": "Hourly_Heat_Transfer_Rate_W",
    "Solar_Heat_Input_W": "Hourly_Solar_Heat_Input_W",
}
MODEL_FEATURES = [
    *(CASE_COLUMN_RENAMES.get(name, name) for name in BASE_FEATURES),
    "Hour_sin", "Hour_cos", "Outdoor_Temperature_C",
    "Hourly_Solar_Radiation_W_m2", "Hourly_Wind_Speed_m_s",
]
CATEGORICAL_FEATURES = ["Material", "Material_Category"]
NUMERIC_FEATURES = [name for name in MODEL_FEATURES if name not in CATEGORICAL_FEATURES]


class HourlyDatasetError(ValueError):
    """Raised when source rows cannot be safely mapped into hourly sequences."""


def _records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    return frame.where(pd.notna(frame), None).to_dict(orient="records")


def _json_scalar(value: Any) -> Any:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, np.generic):
        return value.item()
    return value


def _stats(values: list[float]) -> dict[str, float]:
    array = np.asarray(values, dtype=float)
    return {
        "min": float(array.min()),
        "p50": float(np.median(array)),
        "p95": float(np.quantile(array, 0.95)),
        "max": float(array.max()),
        "mean_absolute": float(np.mean(np.abs(array))),
    }


def load_hourly_dataset(
    data_dir: str | Path = PROJECT_ROOT,
    workbook_paths: list[str | Path] | None = None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Find hourly sheets by schema, validate every row, and join case inputs.

    No hourly records are filtered. Structural issues raise an error before a
    training dataset can be returned.
    """
    root = Path(data_dir).resolve()
    paths = [Path(path).resolve() for path in workbook_paths] if workbook_paths else sorted(root.glob(WORKBOOK_PATTERN))
    if len(paths) != 4:
        raise HourlyDatasetError(
            f"Expected the four current V3 workbooks matching {WORKBOOK_PATTERN!r}; found {len(paths)}: "
            + ", ".join(path.name for path in paths)
        )

    frames: list[pd.DataFrame] = []
    source_reports: list[dict[str, Any]] = []
    global_design_ids: dict[str, str] = {}
    global_sequence_signatures: dict[tuple[Any, ...], list[str]] = {}
    global_rounded_inputs: dict[tuple[Any, ...], list[tuple[str, str]]] = {}
    missing_or_nonfinite: list[dict[str, Any]] = []
    mapping_issues: list[dict[str, Any]] = []
    duplicate_hours: list[dict[str, Any]] = []
    incomplete_sequences: list[dict[str, Any]] = []
    missing_targets: list[dict[str, Any]] = []
    duplicate_sequences: list[list[str]] = []
    split_mismatches: list[dict[str, Any]] = []
    summary_curve_differences = {"average": [], "minimum": [], "maximum": []}
    hour0_initial_differences: list[float] = []

    for path in paths:
        if not path.is_file():
            raise HourlyDatasetError(f"Workbook does not exist: {path}")
        workbook = pd.ExcelFile(path, engine="openpyxl")
        sheet_reports: list[dict[str, Any]] = []
        detected: dict[str, str] = {}
        for sheet_name in workbook.sheet_names:
            header_frame = pd.read_excel(path, sheet_name=sheet_name, nrows=0, engine="openpyxl")
            columns = list(header_frame.columns)
            column_set = set(columns)
            full = pd.read_excel(path, sheet_name=sheet_name, engine="openpyxl")
            sheet_reports.append({
                "sheet_name": sheet_name,
                "data_rows": int(len(full)),
                "column_count": int(len(columns)),
                "columns": [str(column) for column in columns],
            })
            if {"Case_ID", "Hour", TARGET_COLUMN}.issubset(column_set):
                detected["hourly"] = sheet_name
            if {"Case_ID", *BASE_FEATURES}.issubset(column_set):
                detected["design"] = sheet_name
            if {"Case_ID", "Recommended_Split"}.issubset(column_set) and "Material" not in column_set:
                detected["split"] = sheet_name

        if set(detected) != {"hourly", "design", "split"}:
            raise HourlyDatasetError(
                f"Could not identify hourly, design-input, and split sheets in {path.name}; detected {detected}."
            )

        hourly = pd.read_excel(path, sheet_name=detected["hourly"], engine="openpyxl")
        design = pd.read_excel(path, sheet_name=detected["design"], engine="openpyxl")
        split_frame = pd.read_excel(path, sheet_name=detected["split"], engine="openpyxl")
        absent_hourly_columns = [name for name in HOURLY_REQUIRED_COLUMNS if name not in hourly.columns]
        if absent_hourly_columns:
            raise HourlyDatasetError(f"{path.name}/{detected['hourly']} lacks required columns: {absent_hourly_columns}")

        design_id_counts = design["Case_ID"].value_counts(dropna=False)
        if design_id_counts.gt(1).any() or design["Case_ID"].isna().any():
            raise HourlyDatasetError(f"Duplicate or blank Case_ID in design sheet {path.name}/{detected['design']}.")
        split_id_counts = split_frame["Case_ID"].value_counts(dropna=False)
        if split_id_counts.gt(1).any() or split_frame["Case_ID"].isna().any():
            raise HourlyDatasetError(f"Duplicate or blank Case_ID in split sheet {path.name}/{detected['split']}.")

        design_by_id = design.set_index("Case_ID", drop=False)
        split_by_id = split_frame.set_index("Case_ID")["Recommended_Split"]
        for case_id in design["Case_ID"].astype(str):
            if case_id in global_design_ids:
                mapping_issues.append({"type": "duplicate_design_case_id_across_sources", "Case_ID": case_id,
                                       "sources": [global_design_ids[case_id], path.name]})
            global_design_ids[case_id] = path.name

        groups = {case_id: group.sort_values("Hour", kind="stable")
                  for case_id, group in hourly.groupby("Case_ID", sort=False, dropna=False)}
        sequence_split_counts: dict[str, int] = {}
        sequence_material_counts: dict[str, int] = {}
        for case_id, sequence in groups.items():
            case_label = str(case_id)
            if case_id not in design_by_id.index:
                mapping_issues.append({"type": "hourly_case_missing_design_mapping", "Case_ID": case_label, "source": path.name})
                continue
            if case_id not in split_by_id.index:
                mapping_issues.append({"type": "hourly_case_missing_split_mapping", "Case_ID": case_label, "source": path.name})
                continue

            hours = sequence["Hour"].tolist()
            if sequence["Hour"].duplicated().any():
                duplicate_hours.append({"Case_ID": case_label, "source": path.name,
                                        "hours": sorted(sequence.loc[sequence["Hour"].duplicated(keep=False), "Hour"].unique().tolist())})
            if len(sequence) != 24 or set(hours) != set(range(24)):
                incomplete_sequences.append({"Case_ID": case_label, "source": path.name,
                                             "row_count": len(sequence), "hours": sorted(set(hours), key=str)})

            design_row = design_by_id.loc[case_id]
            split_value = split_by_id.loc[case_id]
            if split_value not in SPLITS:
                mapping_issues.append({"type": "unsupported_split_label", "Case_ID": case_label,
                                       "source": path.name, "split": _json_scalar(split_value)})
            design_split = design_row.get("Recommended_Split")
            if design_split != split_value:
                split_mismatches.append({"Case_ID": case_label, "source": path.name,
                                         "design_split": _json_scalar(design_split),
                                         "split_sheet": _json_scalar(split_value)})
            for feature in BASE_FEATURES:
                value = design_row.get(feature)
                if value is None or pd.isna(value):
                    missing_or_nonfinite.append({"Case_ID": case_label, "source": path.name,
                                                 "field": feature, "problem": "missing_case_input"})
                elif feature not in CATEGORICAL_FEATURES and (
                    isinstance(value, (bool, np.bool_)) or not isinstance(value, (int, float, np.number))
                    or not math.isfinite(float(value))
                ):
                    missing_or_nonfinite.append({"Case_ID": case_label, "source": path.name,
                                                 "field": feature, "problem": "non_numeric_or_nonfinite_case_input"})

            for field in [*HOURLY_REQUIRED_COLUMNS[1:]]:
                values = sequence[field]
                if values.isna().any():
                    missing_or_nonfinite.append({"Case_ID": case_label, "source": path.name,
                                                 "field": field, "problem": "missing_hourly_value",
                                                 "count": int(values.isna().sum())})
                if field != TARGET_COLUMN and field != "Wall_Temperature_C" and not pd.api.types.is_numeric_dtype(values):
                    missing_or_nonfinite.append({"Case_ID": case_label, "source": path.name,
                                                 "field": field, "problem": "non_numeric_hourly_value"})
                numeric_values = pd.to_numeric(values, errors="coerce").to_numpy(dtype=float)
                if not np.isfinite(numeric_values).all():
                    missing_or_nonfinite.append({"Case_ID": case_label, "source": path.name,
                                                 "field": field, "problem": "nonfinite_hourly_value"})

            signature_columns = [column for column in HOURLY_REQUIRED_COLUMNS if column != "Case_ID"]
            signature = tuple(tuple(_json_scalar(value) for value in row)
                              for row in sequence[signature_columns].itertuples(index=False, name=None))
            global_sequence_signatures.setdefault(signature, []).append(f"{path.name}:{case_label}")

            design_input_signature = tuple(
                round(float(design_row[field]), 2) if field not in CATEGORICAL_FEATURES else str(design_row[field])
                for field in BASE_FEATURES
            )
            global_rounded_inputs.setdefault(design_input_signature, []).append((case_label, str(split_value)))

            target = pd.to_numeric(sequence[TARGET_COLUMN], errors="coerce").to_numpy(dtype=float)
            if np.isnan(target).any():
                missing_targets.append({"Case_ID": case_label, "source": path.name,
                                        "count": int(np.isnan(target).sum())})
            else:
                if "Initial_Air_Temperature_C" in design_row and math.isfinite(float(design_row["Initial_Air_Temperature_C"])):
                    hour0_initial_differences.append(float(target[0] - design_row["Initial_Air_Temperature_C"]))
                summary_fields = [
                    ("average", "Average_Air_Temperature_C", float(np.mean(target))),
                    ("minimum", "Minimum_Air_Temperature_C", float(np.min(target))),
                    ("maximum", "Maximum_Air_Temperature_C", float(np.max(target))),
                ]
                for label, source_field, derived in summary_fields:
                    if source_field in design_row and pd.notna(design_row[source_field]):
                        summary_curve_differences[label].append(float(derived - design_row[source_field]))

            split_name = str(split_value)
            sequence_split_counts[split_name] = sequence_split_counts.get(split_name, 0) + 1
            material = str(design_row["Material"])
            sequence_material_counts[material] = sequence_material_counts.get(material, 0) + 1

            mapped_design = design_row.drop(labels=["Case_ID"], errors="ignore").to_dict()
            mapped_design["Dataset_Source"] = path.name
            mapped_design["Design_Recommended_Split"] = design_split
            mapped_design["Recommended_Split"] = split_value
            mapped_design = {CASE_COLUMN_RENAMES.get(name, name): value for name, value in mapped_design.items()}
            hourly_renamed = sequence.rename(columns=HOURLY_COLUMN_RENAMES).copy()
            for name, value in mapped_design.items():
                hourly_renamed[name] = value
            hourly_renamed["Dataset_Source"] = path.name
            hourly_renamed["Sequence_ID"] = path.stem + "::" + case_label
            hour_values = pd.to_numeric(hourly_renamed["Hour"], errors="coerce").to_numpy(dtype=float)
            hourly_renamed["Hour_sin"] = np.sin(2 * np.pi * hour_values / 24.0)
            hourly_renamed["Hour_cos"] = np.cos(2 * np.pi * hour_values / 24.0)
            frames.append(hourly_renamed)

        sheet_row_counts = {report["sheet_name"]: report["data_rows"] for report in sheet_reports}
        source_reports.append({
            "filename": path.name,
            "full_path": str(path),
            "sheets": sheet_reports,
            "detected_hourly_sheet": detected["hourly"],
            "detected_design_input_sheet": detected["design"],
            "detected_split_sheet": detected["split"],
            "hourly_row_count": int(len(hourly)),
            "hourly_case_count": int(len(groups)),
            "hourly_Case_ID_range": [str(min(groups)), str(max(groups))] if groups else [],
            "hourly_rows_by_split": {name: int(count * 24) for name, count in sequence_split_counts.items()},
            "hourly_cases_by_split": sequence_split_counts,
            "material_case_counts": sequence_material_counts,
            "design_sheet_row_count": int(len(design)),
            "split_sheet_row_count": int(len(split_frame)),
        })
        workbook.close()

    if not frames:
        raise HourlyDatasetError("No hourly records were found after workbook inspection.")

    exact_duplicate_sequences = [values for values in global_sequence_signatures.values() if len(values) > 1]
    input_duplicates_across_splits = [
        {"case_ids_and_splits": entries}
        for entries in global_rounded_inputs.values()
        if len(entries) > 1 and len({entry[1] for entry in entries}) > 1
    ]
    if duplicate_hours or incomplete_sequences or missing_targets or missing_or_nonfinite or mapping_issues or split_mismatches:
        raise HourlyDatasetError(json.dumps({
            "duplicate_hours": duplicate_hours,
            "incomplete_sequences": incomplete_sequences,
            "missing_targets": missing_targets,
            "missing_or_nonfinite": missing_or_nonfinite,
            "mapping_issues": mapping_issues,
            "split_mismatches": split_mismatches,
        }, indent=2))
    if exact_duplicate_sequences:
        raise HourlyDatasetError(f"Exact duplicate hourly sequences found; no rows were dropped: {exact_duplicate_sequences[:10]}")

    combined = pd.concat(frames, ignore_index=True, sort=False)
    split_case_ids: dict[str, set[str]] = {}
    for split_name, group in combined.groupby("Recommended_Split"):
        split_case_ids[str(split_name)] = set(group["Sequence_ID"].astype(str))
    overlap: list[str] = []
    split_names = sorted(split_case_ids)
    for left_index, left in enumerate(split_names):
        for right in split_names[left_index + 1:]:
            overlap.extend(sorted(split_case_ids[left] & split_case_ids[right]))
    if overlap:
        raise HourlyDatasetError(f"Sequence leakage across splits: {overlap[:20]}")
    if input_duplicates_across_splits:
        raise HourlyDatasetError(
            "Case inputs rounded to 0.01 overlap across splits; no sequences were removed: "
            + json.dumps(input_duplicates_across_splits[:10])
        )

    split_cases = combined.groupby("Recommended_Split")["Sequence_ID"].nunique().to_dict()
    split_rows = combined.groupby("Recommended_Split").size().to_dict()
    target_values = combined[TARGET_COLUMN].astype(float).to_numpy()
    if not np.isfinite(target_values).all():
        raise HourlyDatasetError("Non-finite hourly target values found after joining.")

    hourly_ranges: dict[str, dict[str, float]] = {}
    combined_hourly_fields = {
        **{field: HOURLY_COLUMN_RENAMES.get(field, field) for field in HOURLY_REQUIRED_COLUMNS[1:]},
    }
    for source_field, combined_field in combined_hourly_fields.items():
        values = combined[combined_field].astype(float).to_numpy()
        hourly_ranges[source_field] = {"min": float(values.min()), "max": float(values.max())}

    def group_stats(values: list[float]) -> dict[str, float] | None:
        return _stats(values) if values else None

    report: dict[str, Any] = {
        "workbooks": source_reports,
        "hourly_sheets": sorted({item["detected_hourly_sheet"] for item in source_reports}),
        "hourly_columns": HOURLY_REQUIRED_COLUMNS,
        "combined_hourly_column_names": {
            source: HOURLY_COLUMN_RENAMES.get(source, source) for source in HOURLY_REQUIRED_COLUMNS[1:]
        },
        "case_input_features": BASE_FEATURES,
        "hourly_climate_columns": HOURLY_CLIMATE_COLUMNS,
        "hourly_target": TARGET_COLUMN,
        "hourly_outputs_excluded_from_model_inputs": ["Wall_Temperature_C", "Heat_Transfer_Rate_W", "Solar_Heat_Input_W"],
        "case_summary_outputs_excluded_from_model_inputs": [
            "Average_Air_Temperature_C", "Minimum_Air_Temperature_C", "Maximum_Air_Temperature_C",
            "Average_Wall_Temperature_C", "Minimum_Wall_Temperature_C", "Maximum_Wall_Temperature_C",
            "Heat_Transfer_Rate_W", "Average_Heat_Flux_W_m2", "Maximum_Heat_Flux_W_m2",
            "Solar_Heat_Input_W", "Total_Heat_Transferred_Wh", "Indoor_Temperature_Rise_C",
            "Thermal_Energy_Loss_Wh",
        ],
        "combined_hourly_rows": int(len(combined)),
        "unique_sequences": int(combined["Sequence_ID"].nunique()),
        "rows_per_sequence": {"min": int(combined.groupby("Sequence_ID").size().min()),
                              "max": int(combined.groupby("Sequence_ID").size().max())},
        "split_case_counts": {str(key): int(value) for key, value in split_cases.items()},
        "split_hourly_row_counts": {str(key): int(value) for key, value in split_rows.items()},
        "rounded_input_duplicate_groups_across_splits": input_duplicates_across_splits,
        "duplicate_hourly_sequences": exact_duplicate_sequences,
        "split_assignments_match_design_sheet": True,
        "case_id_is_model_feature": False,
        "dataset_type_counts_in_hourly_parent_cases": combined.groupby("Data_Type")["Sequence_ID"].nunique().to_dict(),
        "hourly_variable_ranges": hourly_ranges,
        "hour0_minus_initial_air_temperature_C": group_stats(hour0_initial_differences),
        "hourly_curve_average_minus_case_summary_average_C": group_stats(summary_curve_differences["average"]),
        "hourly_curve_minimum_minus_case_summary_minimum_C": group_stats(summary_curve_differences["minimum"]),
        "hourly_curve_maximum_minus_case_summary_maximum_C": group_stats(summary_curve_differences["maximum"]),
        "rows_removed": 0,
        "model_feature_columns": MODEL_FEATURES,
        "model_feature_count": len(MODEL_FEATURES),
        "categorical_features": CATEGORICAL_FEATURES,
        "numeric_features": NUMERIC_FEATURES,
    }
    return combined, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=PROJECT_ROOT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    args = parser.parse_args()
    combined, report = load_hourly_dataset(args.data_dir)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    combined_path = args.out_dir / "hourly_combined_training_data.csv"
    inspection_path = args.out_dir / "hourly_dataset_inspection.json"
    combined.to_csv(combined_path, index=False)
    inspection_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "combined_dataset": str(combined_path.resolve()),
        "inspection_report": str(inspection_path.resolve()),
        "summary": {key: report[key] for key in (
            "combined_hourly_rows", "unique_sequences", "split_case_counts", "split_hourly_row_counts",
            "hourly_target", "model_feature_count", "hourly_sheets", "rows_removed",
        )},
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
