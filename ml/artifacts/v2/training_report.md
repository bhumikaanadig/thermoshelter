# THERMOSHELTER thermal surrogate training report

## What the surrogate does

This pipeline fits one regression model per target. It learns a mapping from the listed material, geometry, and climate inputs to the supplied simulation summary outputs. It is a fast approximation of its training labels; it does not replace ANSYS. Predictions for solar heat input and thermal energy loss are bounded below by zero, consistent with the supplied data's physical range checks.

## Data inspected and used

- Raw rows passed to the training pipeline: 3,500
- Exact duplicate full rows removed: 0
- Unique rows used by the six-target model: 3,500
- Model input columns: 21; predicted outputs: 6.
- Original CSVs were read only. No outlier rows were removed.

### Files inspected

| File | Exact path | Rows | Columns | Duplicate rows | Duplicate Case_ID | Data_Type |
|---|---|---:|---:|---:|---:|---|
| `ladakh_shelter_1500_batch3_physics_informed_dataset.csv` | `D:\ANSYS\ladakh_shelter_1500_batch3_physics_informed_dataset.csv` | 1500 | 41 | 0 | 0 | `['PHYSICS_INFORMED_ESTIMATE']` |
| `ladakh_shelter_ml_dataset_63_cases.csv` | `D:\ANSYS\ladakh_shelter_ml_dataset_63_cases.csv` | 63 | 11 | 0 | None | `[]` |
| `ladakh_shelter_ml_dataset_updated (1).csv` | `D:\ladakh_shelter_ml_dataset_updated (1).csv` | 36 | 11 | 0 | None | `[]` |
| `ladakh_shelter_2000_batch4_physics_informed_dataset.csv` | `C:\Users\bhumi\AppData\Local\Packages\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\LocalState\sessions\8886714C6C449E311A8F343EEDD0B4D96C1CACE0\transfers\2026-39\ladakh_shelter_2000_batch4_physics_informed_dataset.csv` | 2000 | 41 | 0 | 0 | `['PHYSICS_INFORMED_ESTIMATE']` |

Combined training dataset: `D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v2/combined_training_data.csv` (includes `Dataset_Source` for audit; source is excluded from features).


### Source disposition

- `ladakh_shelter_1500_batch3_physics_informed_dataset.csv` was used for the six-target fit.
- `ladakh_shelter_ml_dataset_63_cases.csv` was inspected and kept separate: missing 16 required input columns; missing 2 required target columns; schema differs from the full-feature dataset; contains 36 rows exactly duplicated in another supplied file; its annual solar-energy column is not the same quantity/unit as instantaneous W/m² or daily kWh/m² inputs.
- `ladakh_shelter_ml_dataset_updated (1).csv` was inspected and kept separate: missing 16 required input columns; missing 2 required target columns; schema differs from the full-feature dataset; contains 36 rows exactly duplicated in another supplied file; its annual solar-energy column is not the same quantity/unit as instantaneous W/m² or daily kWh/m² inputs.
- `ladakh_shelter_2000_batch4_physics_informed_dataset.csv` was used for the six-target fit.

### Combination decision

All 2 files passed the strict column-schema and required-feature/target checks. They were combined with Dataset_Source metadata; 0 exact duplicate full rows were removed.


## Features and targets

**Inputs** (only these columns enter the model): `Material`, `Material_Category`, `Thermal_Conductivity_W_mK`, `Density_kg_m3`, `Specific_Heat_J_kgK`, `Wall_Thickness_m`, `Shelter_Length_m`, `Shelter_Width_m`, `Shelter_Height_m`, `Opening_Area_m2`, `Window_Area_m2`, `Door_Area_m2`, `Orientation_deg`, `External_Temperature_C`, `Initial_Air_Temperature_C`, `Solar_Radiation_W_m2`, `Daily_Solar_Energy_kWh_m2`, `Wind_Speed_m_s`, `Relative_Humidity_percent`, `Simulation_Duration_h`, `Time_Step_min`.

**Targets** (trained separately): `Average_Air_Temperature_C`, `Minimum_Air_Temperature_C`, `Maximum_Air_Temperature_C`, `Solar_Heat_Input_W`, `Heat_Transfer_Rate_W`, `Thermal_Energy_Loss_Wh`.

Case IDs, Dataset_Source, batch/source metadata, and all output columns are excluded from model features. Any additional supplied outputs remain excluded from inputs. Opening area may be defined from window and door areas, and daily solar energy may be strongly related to radiation; correlated known inputs can share or mask permutation importance, so interpret their ranking with that in mind.

## Data quality

- Training rows: 3,500; missing feature cells: 0; missing target cells: 0; non-finite numeric cells: 0.
- Exact duplicate full rows in the training input: 0; duplicate case IDs: 0.
- Physical range checks with violations: 0.
- Constant columns in training input: ['Data_Type', 'CFD_Reference', 'Climate_Data_Source', 'Material_Data_Source', 'Surrogate_Method'].
- Highly correlated numeric input pairs (|Pearson r| ≥ 0.98): [{'left': 'Solar_Radiation_W_m2', 'right': 'Daily_Solar_Energy_kWh_m2', 'pearson_r': 0.9999999818674329}, {'left': 'Opening_Area_m2', 'right': 'Window_Area_m2', 'pearson_r': 0.9889316597938163}].
- IQR flags are recorded in the inspection artifact; they were not treated as errors and no outliers were deleted.

## Models and split

Candidates were ExtraTreesRegressor, RandomForestRegressor, and HistGradientBoostingRegressor. Two practical hyperparameter configurations per family were compared on validation MAE only. The final model for each target was refit on training + validation data; the held-out test data were not used to select model family or parameters.
- Split: 2,450 train / 525 validation / 525 test (Dataset_Source × Material).
- Random seed: 42. Case rows are one summary per Case_ID in the training source; all Case_IDs are unique there.

| Target | Selected family | Configuration | Hyperparameters |
|---|---|---|---|
| `Average_Air_Temperature_C` | ExtraTreesRegressor | `extra_trees_leaf2_80pct` | `{'n_estimators': 400, 'min_samples_leaf': 2, 'max_features': 0.8}` |
| `Minimum_Air_Temperature_C` | ExtraTreesRegressor | `extra_trees_leaf1_all` | `{'n_estimators': 300, 'min_samples_leaf': 1, 'max_features': 1.0}` |
| `Maximum_Air_Temperature_C` | HistGradientBoostingRegressor | `hist_gradient_250_leaf15` | `{'max_iter': 250, 'max_leaf_nodes': 15, 'learning_rate': 0.08, 'l2_regularization': 1.0}` |
| `Solar_Heat_Input_W` | HistGradientBoostingRegressor | `hist_gradient_250_leaf15` | `{'max_iter': 250, 'max_leaf_nodes': 15, 'learning_rate': 0.08, 'l2_regularization': 1.0}` |
| `Heat_Transfer_Rate_W` | HistGradientBoostingRegressor | `hist_gradient_250_leaf15` | `{'max_iter': 250, 'max_leaf_nodes': 15, 'learning_rate': 0.08, 'l2_regularization': 1.0}` |
| `Thermal_Energy_Loss_Wh` | HistGradientBoostingRegressor | `hist_gradient_250_leaf15` | `{'max_iter': 250, 'max_leaf_nodes': 15, 'learning_rate': 0.08, 'l2_regularization': 1.0}` |

### Validation and training metrics

| Target | Selected model | Train MAE | Validation MAE | Validation RMSE | Validation R² | Validation baseline MAE | Improvement vs baseline | Val − train MAE |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | extra_trees_leaf2_80pct | 0.04555 | 0.1885 | 0.2631 | 0.9991 | 7.582 | 97.5% | 0.143 |
| `Minimum_Air_Temperature_C` | extra_trees_leaf1_all | 3.969e-14 | 0.229 | 0.3037 | 0.9989 | 7.583 | 97.0% | 0.229 |
| `Maximum_Air_Temperature_C` | hist_gradient_250_leaf15 | 0.1556 | 0.2576 | 0.3236 | 0.9987 | 7.61 | 96.6% | 0.102 |
| `Solar_Heat_Input_W` | hist_gradient_250_leaf15 | 426.1 | 848.9 | 1358 | 0.9843 | 8114 | 89.5% | 422.8 |
| `Heat_Transfer_Rate_W` | hist_gradient_250_leaf15 | 10.26 | 22.53 | 31.85 | 0.9807 | 166 | 86.4% | 12.27 |
| `Thermal_Energy_Loss_Wh` | hist_gradient_250_leaf15 | 200.1 | 603.7 | 1130 | 0.9608 | 3450 | 82.5% | 403.7 |

### Untouched held-out test metrics

| Target | Selected model | MAE | RMSE | R² | Baseline MAE | Improvement vs baseline |
|---|---|---:|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | extra_trees_leaf2_80pct | 0.1884 | 0.2606 | 0.9992 | 7.503 | 97.5% |
| `Minimum_Air_Temperature_C` | extra_trees_leaf1_all | 0.2421 | 0.3163 | 0.9988 | 7.49 | 96.8% |
| `Maximum_Air_Temperature_C` | hist_gradient_250_leaf15 | 0.2429 | 0.311 | 0.9988 | 7.555 | 96.8% |
| `Solar_Heat_Input_W` | hist_gradient_250_leaf15 | 742.6 | 1103 | 0.9897 | 8756 | 91.5% |
| `Heat_Transfer_Rate_W` | hist_gradient_250_leaf15 | 21.24 | 29.89 | 0.9826 | 163.2 | 87.0% |
| `Thermal_Energy_Loss_Wh` | hist_gradient_250_leaf15 | 545.4 | 994.7 | 0.9666 | 3412 | 84.0% |

MAE is mean absolute error in the target's units. RMSE is root mean squared error and penalizes large misses more. R² describes variation explained relative to a constant-mean baseline; it is not accuracy.

## Overfitting assessment

The table compares fit error with validation and final test error. A much lower training MAE is a warning for memorization; similar validation and test values are a useful stability check, but do not prove that overfitting is absent.

| Target | Train MAE | Validation MAE | Test MAE | Validation − train |
|---|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | 0.04555 | 0.1885 | 0.1884 | 0.143 |
| `Minimum_Air_Temperature_C` | 3.969e-14 | 0.229 | 0.2421 | 0.229 |
| `Maximum_Air_Temperature_C` | 0.1556 | 0.2576 | 0.2429 | 0.102 |
| `Solar_Heat_Input_W` | 426.1 | 848.9 | 742.6 | 422.8 |
| `Heat_Transfer_Rate_W` | 10.26 | 22.53 | 21.24 | 12.27 |
| `Thermal_Energy_Loss_Wh` | 200.1 | 603.7 | 545.4 | 403.7 |
Training MAE is effectively zero for `Minimum_Air_Temperature_C`; treat this as a memorization warning even though the held-out errors are reported separately.
The validation and test errors are close for these fixed splits, while training error is lower, so there is a train-to-held-out gap consistent with some overfitting. Use new simulation cases to confirm these estimates before deployment.

## Generalization diagnostics

### Material-held-out stress test

Grouped diagnostics held out complete Material names (9 names) in 3 folds. This is a stress test, not proof of universal material generalization.

| Target | MAE | RMSE | R² | Baseline MAE | Improvement vs baseline |
|---|---:|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | 0.3438 | 0.5034 | 0.9968 | 7.437 | 95.4% |
| `Minimum_Air_Temperature_C` | 0.4612 | 0.6556 | 0.9946 | 7.46 | 93.8% |
| `Maximum_Air_Temperature_C` | 0.3072 | 0.402 | 0.9980 | 7.428 | 95.9% |
| `Solar_Heat_Input_W` | 2225 | 3868 | 0.8677 | 8396 | 73.5% |
| `Heat_Transfer_Rate_W` | 29.87 | 43.52 | 0.9634 | 166.6 | 82.1% |
| `Thermal_Energy_Loss_Wh` | 703.2 | 1308 | 0.9430 | 3424 | 79.5% |

### Source-held-out diagnostic

Computed 2-fold GroupKFold by Dataset_Source; this tests transfer between compatible files, not between unlike schemas.

| Target | Status / MAE | RMSE | R² | Baseline MAE | Improvement vs baseline |
|---|---:|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | 0.2567 | 0.3685 | 0.9983 | 7.429 | 96.5% |
| `Minimum_Air_Temperature_C` | 0.2984 | 0.399 | 0.9980 | 7.451 | 96.0% |
| `Maximum_Air_Temperature_C` | 0.2977 | 0.3851 | 0.9981 | 7.424 | 96.0% |
| `Solar_Heat_Input_W` | 961.2 | 1484 | 0.9805 | 8386 | 88.5% |
| `Heat_Transfer_Rate_W` | 27.95 | 41.25 | 0.9671 | 166.2 | 83.2% |
| `Thermal_Energy_Loss_Wh` | 734.8 | 1438 | 0.9311 | 3415 | 78.5% |
The source folds correspond to batches Batch_3, Batch_4 and share the listed physics-informed method/provenance. Interpret this as a batch-transfer stress test, not independent CFD or field validation.

## Feature importance

Permutation importance was measured on validation rows using change in MAE, so values are in each target's units. Correlated features can split or mask one another's importance.

- `Average_Air_Temperature_C` top features: `External_Temperature_C` (9.492), `Initial_Air_Temperature_C` (3.122), `Density_kg_m3` (0.1431), `Material_Category` (0.09251), `Thermal_Conductivity_W_mK` (0.03021).
- `Minimum_Air_Temperature_C` top features: `External_Temperature_C` (9.456), `Initial_Air_Temperature_C` (3.094), `Density_kg_m3` (0.3101), `Material_Category` (0.1105), `Thermal_Conductivity_W_mK` (0.0349).
- `Maximum_Air_Temperature_C` top features: `External_Temperature_C` (9.438), `Initial_Air_Temperature_C` (3.108), `Thermal_Conductivity_W_mK` (0.2753), `Wall_Thickness_m` (0.06391), `Density_kg_m3` (0.0497).
- `Solar_Heat_Input_W` top features: `Orientation_deg` (8229), `Solar_Radiation_W_m2` (3717), `Shelter_Length_m` (1015), `Shelter_Height_m` (909.7), `Thermal_Conductivity_W_mK` (766.2).
- `Heat_Transfer_Rate_W` top features: `External_Temperature_C` (182.2), `Thermal_Conductivity_W_mK` (72.42), `Initial_Air_Temperature_C` (52.78), `Wall_Thickness_m` (18.16), `Shelter_Length_m` (12.1).
- `Thermal_Energy_Loss_Wh` top features: `External_Temperature_C` (3165), `Thermal_Conductivity_W_mK` (1476), `Simulation_Duration_h` (1216), `Initial_Air_Temperature_C` (813.7), `Wall_Thickness_m` (362).

Plots: `D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v2/feature_importance_<target>.svg` and `D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v2/diagnostic_<target>.svg`.

## Error analysis

- Highest held-out R²: `Average_Air_Temperature_C` (R² 0.9992); lowest: `Thermal_Energy_Loss_Wh` (R² 0.9666). This ranks fit on this split, not physical validity.
- Largest per-material test MAE for `Average_Air_Temperature_C`: `Aluminum` (0.2863, n=49).
- Largest individual test error for `Average_Air_Temperature_C`: Case `CASE_05951`, material `Rock wool / mineral wool`, absolute error 0.9476.
- Largest per-material test MAE for `Minimum_Air_Temperature_C`: `Aluminum` (0.28, n=49).
- Largest individual test error for `Minimum_Air_Temperature_C`: Case `CASE_04409`, material `Composite insulated wall`, absolute error 1.239.
- Largest per-material test MAE for `Maximum_Air_Temperature_C`: `Aluminum` (0.3105, n=49).
- Largest individual test error for `Maximum_Air_Temperature_C`: Case `CASE_03555`, material `Aluminum`, absolute error 1.176.
- Largest per-material test MAE for `Solar_Heat_Input_W`: `Brick` (1017, n=63).
- Largest individual test error for `Solar_Heat_Input_W`: Case `CASE_04581`, material `Brick`, absolute error 8707.
- Largest per-material test MAE for `Heat_Transfer_Rate_W`: `Concrete` (33.71, n=49).
- Largest individual test error for `Heat_Transfer_Rate_W`: Case `CASE_06335`, material `Concrete`, absolute error 166.2.
- Largest per-material test MAE for `Thermal_Energy_Loss_Wh`: `Brick` (948.5, n=63).
- Largest individual test error for `Thermal_Energy_Loss_Wh`: Case `CASE_05305`, material `Composite insulated wall`, absolute error 5584.
- Training, validation, and final test MAE are shown together above. The train/validation gap is descriptive; candidate selection used validation only. The final test set was evaluated after model selection.
- Input-range error bins are saved in `D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v2/error_by_input_ranges.csv`; inspect them before making claims about cold extremes or wall-thickness boundaries.

## Data provenance and limitations

The training source provenance is recorded in model metadata and below:
- `ladakh_shelter_1500_batch3_physics_informed_dataset.csv` — Data_Type: `['PHYSICS_INFORMED_ESTIMATE']`; CFD_Reference: `['Calibrated against 3 ANSYS Fluent validation cases (Aluminum/Concrete/EPS, 0.20 m, Text=35C, Tinit=20C)']`; Climate_Data_Source: `['Representative high-altitude cold-desert climate ranges for Ladakh (not a direct NASA POWER data pull)']`; Material_Data_Source: `['Standard engineering material-property handbook ranges']`; Surrogate_Method: `['Physics-informed R=L/k+R_film network, log(k)-interpolated correction anchored to 3 Fluent points']`; Batch: `['Batch_3']`.
- `ladakh_shelter_2000_batch4_physics_informed_dataset.csv` — Data_Type: `['PHYSICS_INFORMED_ESTIMATE']`; CFD_Reference: `['Calibrated against 3 ANSYS Fluent validation cases (Aluminum/Concrete/EPS, 0.20 m, Text=35C, Tinit=20C)']`; Climate_Data_Source: `['Representative high-altitude cold-desert climate ranges for Ladakh (not a direct NASA POWER data pull)']`; Material_Data_Source: `['Standard engineering material-property handbook ranges']`; Surrogate_Method: `['Physics-informed R=L/k+R_film network, log(k)-interpolated correction anchored to 3 Fluent points']`; Batch: `['Batch_4']`.

All 2 files passed the strict column-schema and required-feature/target checks. They were combined with Dataset_Source metadata; 0 exact duplicate full rows were removed.
The inspected files contain 3,599 raw rows in total. The largest confirmed exact pairwise row overlap is 36; these counts are inventory totals, not a claim that incompatible files form one training set.
No field measurements were supplied. Missing provenance fields mean unknown provenance, not proof that a file came directly from ANSYS.
The current labels are per-case averages/minima/maxima and aggregate heat quantities, not hourly transient sequences. This model does not output a 24-hour curve. Predictions are supported only within the supplied feature ranges; a held-out score against supplied estimates is not ANSYS accuracy or field validation.
The case-level holdout tests interpolation for represented material names. The material-held-out score is a limited stress test. Source-held-out results are only appropriate when multiple compatible sources are combined; otherwise the report marks them not applicable.

## Reproduce training and inference

From the project root, install `ml/requirements.txt`, inspect all files, and train only compatible sources:
```powershell
python -m pip install -r ml/requirements.txt
python ml/inspect_datasets.py --data "D:/ANSYS/ladakh_shelter_1500_batch3_physics_informed_dataset.csv" --data "D:/ANSYS/ladakh_shelter_ml_dataset_63_cases.csv" --data "D:/ladakh_shelter_ml_dataset_updated (1).csv" --data "C:/Users/bhumi/AppData/Local/Packages/5319275A.WhatsAppDesktop_cv1g1gvanyjgm/LocalState/sessions/8886714C6C449E311A8F343EEDD0B4D96C1CACE0/transfers/2026-39/ladakh_shelter_2000_batch4_physics_informed_dataset.csv" --out-dir "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v2"
python ml/train_thermal_surrogate.py --data "D:/ANSYS/ladakh_shelter_1500_batch3_physics_informed_dataset.csv" --data "C:/Users/bhumi/AppData/Local/Packages/5319275A.WhatsAppDesktop_cv1g1gvanyjgm/LocalState/sessions/8886714C6C449E311A8F343EEDD0B4D96C1CACE0/transfers/2026-39/ladakh_shelter_2000_batch4_physics_informed_dataset.csv" --inspection "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v2/dataset_inspection.json" --out-dir "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v2" --model-filename thermal_surrogate_v2.joblib
python ml/predict.py --model "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v2/thermal_surrogate_v2.joblib" --input "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v2/example_input.json" --output "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v2/example_prediction.json"
```
The model is saved as `D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v2/thermal_surrogate_v2.joblib` with its preprocessing pipelines and metadata. A future FastAPI endpoint can import `predict_shelter()` from `ml/predict.py`; React will call that endpoint over HTTP.
