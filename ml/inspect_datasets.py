"""Inspect, compare, and quality-check THERMOSHELTER CSV sources without editing them."""

from __future__ import annotations

import argparse
import json
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd


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
ALL_OUTPUTS = TARGETS + [
    "Average_Wall_Temperature_C", "Average_Heat_Flux_W_m2", "Maximum_Heat_Flux_W_m2",
    "Total_Heat_Transferred_Wh", "Indoor_Temperature_Rise_C",
]
CONDITION_KEYS = [
    "Material", "Wall_Thickness_m", "External_Temperature_C", "Initial_Air_Temperature_C"
]


def json_safe(value):
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value) if np.isfinite(value) else None
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if pd.isna(value):
        return None
    return value


def physical_checks(df: pd.DataFrame) -> list[dict]:
    checks: list[dict] = []

    def add(name: str, mask: pd.Series, interpretation: str) -> None:
        count = int(mask.fillna(False).sum())
        checks.append({"check": name, "violations": count, "interpretation": interpretation})

    positive = [
        "Thermal_Conductivity_W_mK", "Density_kg_m3", "Specific_Heat_J_kgK",
        "Wall_Thickness_m", "Shelter_Length_m", "Shelter_Width_m", "Shelter_Height_m",
        "Simulation_Duration_h", "Time_Step_min",
    ]
    for column in positive:
        if column in df:
            add(f"{column} > 0", pd.to_numeric(df[column], errors="coerce") <= 0,
                "Flag only; review against the source model and units.")
    nonnegative = [
        "Opening_Area_m2", "Window_Area_m2", "Door_Area_m2", "Solar_Radiation_W_m2",
        "Daily_Solar_Energy_kWh_m2", "Solar_Radiation_kWh_m2_year", "Wind_Speed_m_s",
        "Solar_Heat_Input_W", "Thermal_Energy_Loss_Wh",
    ]
    for column in nonnegative:
        if column in df:
            add(f"{column} >= 0", pd.to_numeric(df[column], errors="coerce") < 0,
                "Flag only; signed heat-flow rate is allowed and is not checked here.")
    if "Relative_Humidity_percent" in df:
        humidity = pd.to_numeric(df["Relative_Humidity_percent"], errors="coerce")
        add("Relative_Humidity_percent in [0, 100]", (humidity < 0) | (humidity > 100),
            "Outside conventional percentage bounds.")
    if "Orientation_deg" in df:
        orientation = pd.to_numeric(df["Orientation_deg"], errors="coerce")
        add("Orientation_deg in [0, 360]", (orientation < 0) | (orientation > 360),
            "Outside the stated compass-angle range.")
    air = ["Minimum_Air_Temperature_C", "Average_Air_Temperature_C", "Maximum_Air_Temperature_C"]
    if all(column in df for column in air):
        low, mean, high = (pd.to_numeric(df[column], errors="coerce") for column in air)
        add("minimum <= average <= maximum air temperature", (low > mean) | (mean > high),
            "Checks internal consistency of temperature summaries.")
    if {"Opening_Area_m2", "Window_Area_m2", "Door_Area_m2"}.issubset(df.columns):
        delta = (df["Opening_Area_m2"] - df["Window_Area_m2"] - df["Door_Area_m2"]).abs()
        checks.append({
            "check": "opening area equals window area + door area",
            "violations": int((delta > 1e-6).sum()),
            "interpretation": "Potential deterministic relationship/redundant inputs; values retained.",
        })
    return checks


def highly_correlated_features(df: pd.DataFrame) -> list[dict]:
    numeric_features = [
        column for column in FEATURES
        if column in df and pd.api.types.is_numeric_dtype(df[column])
    ]
    if len(numeric_features) < 2:
        return []
    corr = df[numeric_features].corr(numeric_only=True)
    pairs = []
    for i, left in enumerate(numeric_features):
        for right in numeric_features[i + 1:]:
            value = corr.loc[left, right]
            if pd.notna(value) and abs(float(value)) >= 0.98:
                pairs.append({"left": left, "right": right, "pearson_r": float(value)})
    return sorted(pairs, key=lambda item: abs(item["pearson_r"]), reverse=True)


def summarize(path: Path) -> tuple[pd.DataFrame, dict, list[dict]]:
    df = pd.read_csv(path)
    numeric = df.select_dtypes(include="number").columns.tolist()
    ranges: list[dict] = []
    for column in df.columns:
        series = df[column]
        row = {
            "column": column,
            "dtype": str(series.dtype),
            "missing": int(series.isna().sum()),
            "unique": int(series.nunique(dropna=True)),
        }
        if column in numeric:
            values = pd.to_numeric(series, errors="coerce").to_numpy(dtype=float)
            finite = values[np.isfinite(values)]
            row.update({
                "nonfinite": int((~np.isfinite(values)).sum()),
                "min": float(finite.min()) if finite.size else None,
                "q1": float(np.quantile(finite, 0.25)) if finite.size else None,
                "median": float(np.quantile(finite, 0.50)) if finite.size else None,
                "q3": float(np.quantile(finite, 0.75)) if finite.size else None,
                "max": float(finite.max()) if finite.size else None,
                "iqr_outliers": int(((finite < np.quantile(finite, 0.25) - 1.5 * (np.quantile(finite, 0.75) - np.quantile(finite, 0.25))) | (finite > np.quantile(finite, 0.75) + 1.5 * (np.quantile(finite, 0.75) - np.quantile(finite, 0.25)))).sum()) if finite.size else 0,
            })
        else:
            counts = series.astype("string").value_counts(dropna=False)
            if series.nunique(dropna=False) <= 30:
                row["value_counts"] = {str(k): int(v) for k, v in counts.items()}
            else:
                row["value_counts"] = f"omitted for high-cardinality column ({series.nunique(dropna=False)} unique values)"
        ranges.append(row)

    input_cols = [c for c in FEATURES if c in df.columns]
    target_cols = [c for c in ALL_OUTPUTS if c in df.columns]
    provenance_cols = [c for c in ["Data_Type", "CFD_Reference", "Climate_Data_Source", "Material_Data_Source", "Surrogate_Method", "Batch"] if c in df.columns]
    metadata = {
        "filename": path.name,
        "path": str(path),
        "rows": int(len(df)),
        "columns": int(len(df.columns)),
        "column_names": df.columns.tolist(),
        "dtypes": {column: str(dtype) for column, dtype in df.dtypes.items()},
        "missing_values": {column: int(count) for column, count in df.isna().sum().items()},
        "duplicate_rows": int(df.duplicated().sum()),
        "duplicate_case_ids": int(df["Case_ID"].duplicated().sum()) if "Case_ID" in df else None,
        "unique_case_ids": int(df["Case_ID"].nunique()) if "Case_ID" in df else None,
        "unique_materials": sorted(df["Material"].dropna().astype(str).unique().tolist()) if "Material" in df else [],
        "inputs_present": input_cols,
        "targets_present": target_cols,
        "other_columns": [c for c in df.columns if c not in FEATURES and c not in ALL_OUTPUTS],
        "missing_expected_features": [c for c in FEATURES if c not in df],
        "missing_expected_targets": [c for c in TARGETS if c not in df],
        "provenance": {column: sorted(df[column].dropna().astype(str).unique().tolist()) for column in provenance_cols},
        "constant_columns": [column for column in df if df[column].nunique(dropna=False) <= 1],
        "highly_correlated_numeric_feature_pairs_abs_r_ge_0_98": highly_correlated_features(df),
        "physical_checks": physical_checks(df),
        "columns_detail": ranges,
    }
    return df, metadata, ranges


def compare_pair(left: pd.DataFrame, left_meta: dict, right: pd.DataFrame, right_meta: dict) -> dict:
    left_cols, right_cols = set(left.columns), set(right.columns)
    common = [column for column in left.columns if column in right_cols]
    identical_schema = left_cols == right_cols
    if identical_schema:
        left_aligned = left.copy()
        right_aligned = right[left.columns].copy()
        for column in left_aligned.columns:
            if pd.api.types.is_numeric_dtype(left_aligned[column]) or pd.api.types.is_numeric_dtype(right_aligned[column]):
                left_aligned[column] = pd.to_numeric(left_aligned[column], errors="coerce").astype("float64")
                right_aligned[column] = pd.to_numeric(right_aligned[column], errors="coerce").astype("float64")
            else:
                left_aligned[column] = left_aligned[column].astype("string")
                right_aligned[column] = right_aligned[column].astype("string")
        exact_overlap = int(len(left_aligned.merge(right_aligned.drop_duplicates(), how="inner")))
    else:
        exact_overlap = None
    keys = [column for column in CONDITION_KEYS if column in left and column in right]
    condition_overlap = None
    if keys:
        left_keys = left[keys].copy()
        right_keys = right[keys].copy()
        for column in keys:
            if column == "Material":
                left_keys[column] = left_keys[column].astype("string")
                right_keys[column] = right_keys[column].astype("string")
            else:
                left_keys[column] = pd.to_numeric(left_keys[column], errors="coerce").astype("float64")
                right_keys[column] = pd.to_numeric(right_keys[column], errors="coerce").astype("float64")
        condition_overlap = int(len(left_keys.drop_duplicates().merge(right_keys.drop_duplicates(), on=keys, how="inner")))
    case_id_overlap = None
    if "Case_ID" in left and "Case_ID" in right:
        case_id_overlap = len(set(left["Case_ID"].dropna()) & set(right["Case_ID"].dropna()))
    shared_targets = [column for column in ALL_OUTPUTS if column in left and column in right]
    return {
        "left": left_meta["filename"],
        "right": right_meta["filename"],
        "identical_schema": identical_schema,
        "left_only_columns": [column for column in left.columns if column not in right_cols],
        "right_only_columns": [column for column in right.columns if column not in left_cols],
        "common_columns": common,
        "shared_targets": shared_targets,
        "shared_expected_features": [column for column in FEATURES if column in left and column in right],
        "exact_row_overlap": exact_overlap,
        "shared_condition_key_columns": keys,
        "shared_condition_tuple_overlap": condition_overlap,
        "case_id_overlap": case_id_overlap,
        "material_name_intersection": sorted(set(left_meta["unique_materials"]) & set(right_meta["unique_materials"])),
    }


def md_table(rows: list[dict], columns: list[str]) -> str:
    out = ["| " + " | ".join(columns) + " |", "|" + "|".join(["---"] * len(columns)) + "|"]
    for row in rows:
        out.append("| " + " | ".join(str(row.get(column, "")) for column in columns) + " |")
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", action="append", required=True, help="CSV path; repeat once per source")
    parser.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parent / "artifacts")
    args = parser.parse_args()
    paths = [Path(value) for value in args.data]
    if len(paths) != len(set(path.resolve() for path in paths)):
        raise ValueError("The same CSV path was passed more than once.")

    frames: list[pd.DataFrame] = []
    summaries: list[dict] = []
    range_rows: list[dict] = []
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(path)
        frame, summary, ranges = summarize(path)
        frames.append(frame)
        summaries.append(summary)
        for row in ranges:
            range_rows.append({"filename": path.name, **row})

    comparisons = [
        compare_pair(frames[i], summaries[i], frames[j], summaries[j])
        for i, j in combinations(range(len(paths)), 2)
    ]
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    audit = {"files": summaries, "pairwise_comparisons": comparisons}
    (out_dir / "dataset_inspection.json").write_text(json.dumps(json_safe(audit), indent=2), encoding="utf-8")
    pd.DataFrame(range_rows).to_csv(out_dir / "dataset_column_ranges.csv", index=False)

    lines = ["# THERMOSHELTER dataset inspection", "", "Original files were read only.", ""]
    for summary in summaries:
        lines.extend([
            f"## {summary['filename']}",
            "",
            f"- Rows / columns: {summary['rows']:,} / {summary['columns']}",
            f"- Exact duplicate rows: {summary['duplicate_rows']}",
            f"- Duplicate Case_ID values: {summary['duplicate_case_ids']}",
            f"- Unique Case_ID count: {summary['unique_case_ids']}",
            f"- Unique materials: {summary['unique_materials']}",
            f"- Inputs present: {summary['inputs_present']}",
            f"- Outputs present: {summary['targets_present']}",
            f"- Other columns (including provenance and extra inputs/outputs): {summary['other_columns']}",
            f"- Missing values by column: {summary['missing_values']}",
            f"- Constant columns: {summary['constant_columns']}",
            f"- Highly correlated numeric feature pairs (|r| >= 0.98): {summary['highly_correlated_numeric_feature_pairs_abs_r_ge_0_98']}",
            f"- Provenance values: {summary['provenance']}",
            "",
            "### Columns and ranges",
            "",
            md_table(summary["columns_detail"], ["column", "dtype", "missing", "unique", "min", "median", "max", "iqr_outliers", "value_counts"]),
            "",
            "### Physical consistency checks",
            "",
            md_table(summary["physical_checks"], ["check", "violations", "interpretation"]),
            "",
        ])
    lines.extend(["## Pairwise comparisons", ""])
    for comparison in comparisons:
        lines.extend([
            f"### {comparison['left']} vs {comparison['right']}",
            "",
            f"- Identical schemas: {comparison['identical_schema']}",
            f"- Shared output columns: {comparison['shared_targets']}",
            f"- Shared required input columns: {comparison['shared_expected_features']}",
            f"- Left-only columns: {comparison['left_only_columns']}",
            f"- Right-only columns: {comparison['right_only_columns']}",
            f"- Exact row overlap: {comparison['exact_row_overlap']}",
            f"- Shared condition keys: {comparison['shared_condition_key_columns']}",
            f"- Shared condition tuple overlap: {comparison['shared_condition_tuple_overlap']}",
            f"- Case_ID overlap: {comparison['case_id_overlap']}",
            f"- Material-name intersection: {comparison['material_name_intersection']}",
            "",
        ])
    (out_dir / "dataset_inspection.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"Inspected {len(paths)} files; wrote audit to {out_dir.resolve()}")
    for summary in summaries:
        print(f"{summary['filename']}: {summary['rows']} rows, {summary['columns']} columns, {summary['duplicate_rows']} exact duplicate rows")
    for comparison in comparisons:
        print(f"{comparison['left']} <> {comparison['right']}: identical_schema={comparison['identical_schema']}; exact_row_overlap={comparison['exact_row_overlap']}; condition_overlap={comparison['shared_condition_tuple_overlap']}")


if __name__ == "__main__":
    main()
