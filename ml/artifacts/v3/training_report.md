# THERMOSHELTER thermal surrogate training report

## What the surrogate does

This pipeline fits one regression model per target. It learns a mapping from the listed material, geometry, and climate inputs to the supplied simulation summary outputs. It is a fast approximation of its training labels; it does not replace ANSYS. Predictions for solar heat input and thermal energy loss are bounded below by zero, consistent with the supplied data's physical range checks.

## Data inspected and used

- Raw rows passed to the training pipeline: 6,500
- Exact duplicate cases removed: 0
- Unique rows used by the six-target model: 6,500
- Model input columns: 21; predicted outputs: 6.
- Original workbooks were read only. No outlier rows were removed.

### Files inspected

| File | Exact path | Rows | Columns | Duplicate rows | Duplicate Case_ID | V2 used? | Data_Type |
|---|---|---:|---:|---:|---:|---|---|
| `ladakh_shelter_1500_physics_informed_dataset.xlsx` | `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ladakh_shelter_1500_physics_informed_dataset.xlsx` | 1500 | 41 | 0 | 0 | NO | `['PHYSICS_INFORMED_ESTIMATE']` |
| `ladakh_shelter_1500_batch2_physics_informed_dataset.xlsx` | `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ladakh_shelter_1500_batch2_physics_informed_dataset.xlsx` | 1500 | 42 | 0 | 0 | NO | `['PHYSICS_INFORMED_ESTIMATE']` |
| `ladakh_shelter_1500_batch3_physics_informed_dataset.xlsx` | `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ladakh_shelter_1500_batch3_physics_informed_dataset.xlsx` | 1500 | 42 | 0 | 0 | YES | `['PHYSICS_INFORMED_ESTIMATE']` |
| `ladakh_shelter_2000_batch4_physics_informed_dataset.xlsx` | `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ladakh_shelter_2000_batch4_physics_informed_dataset.xlsx` | 2000 | 42 | 0 | 0 | YES | `['PHYSICS_INFORMED_ESTIMATE']` |

Combined training dataset: `D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v3/combined_training_data.csv` (includes `Dataset_Source` for audit; source is excluded from features).


### Source disposition

- `ladakh_shelter_1500_physics_informed_dataset.xlsx` was included in V3; previously used by V2: NO.
- `ladakh_shelter_1500_batch2_physics_informed_dataset.xlsx` was included in V3; previously used by V2: NO.
- `ladakh_shelter_1500_batch3_physics_informed_dataset.xlsx` was included in V3; previously used by V2: YES.
- `ladakh_shelter_2000_batch4_physics_informed_dataset.xlsx` was included in V3; previously used by V2: YES.

### Combination decision

All 4 workbooks passed the required input/target schema checks. The only source schema difference was optional Batch metadata; they were combined with Dataset_Source provenance. 0 exact duplicate input/target cases were removed.


## Features and targets

**Inputs** (only these columns enter the model): `Material`, `Material_Category`, `Thermal_Conductivity_W_mK`, `Density_kg_m3`, `Specific_Heat_J_kgK`, `Wall_Thickness_m`, `Shelter_Length_m`, `Shelter_Width_m`, `Shelter_Height_m`, `Opening_Area_m2`, `Window_Area_m2`, `Door_Area_m2`, `Orientation_deg`, `External_Temperature_C`, `Initial_Air_Temperature_C`, `Solar_Radiation_W_m2`, `Daily_Solar_Energy_kWh_m2`, `Wind_Speed_m_s`, `Relative_Humidity_percent`, `Simulation_Duration_h`, `Time_Step_min`.

**Targets** (trained separately): `Average_Air_Temperature_C`, `Minimum_Air_Temperature_C`, `Maximum_Air_Temperature_C`, `Solar_Heat_Input_W`, `Heat_Transfer_Rate_W`, `Thermal_Energy_Loss_Wh`.

Case IDs, Dataset_Source, batch/source metadata, and all output columns are excluded from model features. Any additional supplied outputs remain excluded from inputs. Opening area may be defined from window and door areas, and daily solar energy may be strongly related to radiation; correlated known inputs can share or mask permutation importance, so interpret their ranking with that in mind.

## Data quality

- Training rows: 6,500; missing feature cells: 0; missing target cells: 0; non-finite numeric cells: 0.
- Missing nonmodel metadata cells: {'Batch': 1500}.
- Duplicate full rows in source sheets: 0; duplicate Case_IDs: 0; duplicate input/target cases removed: 0.
- Inputs identical after rounding numeric features to 0.01: 0; any near-input groups crossing train/validation/test: 0.
- Physical range checks with violations: 0.
- Constant columns in training input: ['Data_Type', 'CFD_Reference', 'Climate_Data_Source', 'Material_Data_Source', 'Surrogate_Method'].
- Highly correlated numeric input pairs (|Pearson r| ≥ 0.98): [{'left': 'Opening_Area_m2', 'right': 'Window_Area_m2', 'abs_pearson_r': 0.9891827152727921}, {'left': 'Solar_Radiation_W_m2', 'right': 'Daily_Solar_Energy_kWh_m2', 'abs_pearson_r': 0.9999999819302587}].
- IQR flags are recorded in the inspection artifact; they were not treated as errors and no outliers were deleted.

## Models and split

Candidates were ExtraTreesRegressor, RandomForestRegressor, and HistGradientBoostingRegressor. Two practical hyperparameter configurations per family were compared on validation MAE only. The final model for each target was refit on training + validation data; the held-out test data were not used to select model family or parameters.
- Split: 4,550 train / 975 validation / 975 test (Dataset_Source × Material).
- Random seed: 42. Case rows are one summary per Case_ID; all Case_IDs are unique. Near-input signatures rounded to 0.01 do not overlap across splits.

| Target | Selected family | Configuration | Hyperparameters |
|---|---|---|---|
| `Average_Air_Temperature_C` | ExtraTreesRegressor | `extra_trees_leaf2_80pct` | `{'n_estimators': 400, 'min_samples_leaf': 2, 'max_features': 0.8}` |
| `Minimum_Air_Temperature_C` | HistGradientBoostingRegressor | `hist_gradient_250_leaf15` | `{'max_iter': 250, 'max_leaf_nodes': 15, 'learning_rate': 0.08, 'l2_regularization': 1.0}` |
| `Maximum_Air_Temperature_C` | HistGradientBoostingRegressor | `hist_gradient_250_leaf15` | `{'max_iter': 250, 'max_leaf_nodes': 15, 'learning_rate': 0.08, 'l2_regularization': 1.0}` |
| `Solar_Heat_Input_W` | HistGradientBoostingRegressor | `hist_gradient_250_leaf15` | `{'max_iter': 250, 'max_leaf_nodes': 15, 'learning_rate': 0.08, 'l2_regularization': 1.0}` |
| `Heat_Transfer_Rate_W` | HistGradientBoostingRegressor | `hist_gradient_250_leaf15` | `{'max_iter': 250, 'max_leaf_nodes': 15, 'learning_rate': 0.08, 'l2_regularization': 1.0}` |
| `Thermal_Energy_Loss_Wh` | HistGradientBoostingRegressor | `hist_gradient_250_leaf15` | `{'max_iter': 250, 'max_leaf_nodes': 15, 'learning_rate': 0.08, 'l2_regularization': 1.0}` |

### Validation and training metrics

| Target | Selected model | Train MAE | Validation MAE | Validation RMSE | Validation R² | Validation baseline MAE | Improvement vs baseline | Val − train MAE |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | extra_trees_leaf2_80pct | 0.03431 | 0.1467 | 0.2049 | 0.9995 | 7.296 | 98.0% | 0.1124 |
| `Minimum_Air_Temperature_C` | hist_gradient_250_leaf15 | 0.1425 | 0.1962 | 0.2455 | 0.9992 | 7.311 | 97.3% | 0.05365 |
| `Maximum_Air_Temperature_C` | hist_gradient_250_leaf15 | 0.1285 | 0.1937 | 0.2504 | 0.9992 | 7.31 | 97.4% | 0.06516 |
| `Solar_Heat_Input_W` | hist_gradient_250_leaf15 | 397.4 | 615.9 | 879 | 0.9926 | 7990 | 92.3% | 218.5 |
| `Heat_Transfer_Rate_W` | hist_gradient_250_leaf15 | 11.8 | 19.39 | 27.35 | 0.9852 | 161.7 | 88.0% | 7.585 |
| `Thermal_Energy_Loss_Wh` | hist_gradient_250_leaf15 | 247.9 | 499.8 | 876.2 | 0.9718 | 3285 | 84.8% | 251.9 |

### Untouched held-out test metrics

| Target | Selected model | MAE | RMSE | R² | Baseline MAE | Improvement vs baseline |
|---|---|---:|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | extra_trees_leaf2_80pct | 0.1294 | 0.1872 | 0.9996 | 7.366 | 98.2% |
| `Minimum_Air_Temperature_C` | hist_gradient_250_leaf15 | 0.1716 | 0.2202 | 0.9994 | 7.392 | 97.7% |
| `Maximum_Air_Temperature_C` | hist_gradient_250_leaf15 | 0.1799 | 0.2302 | 0.9993 | 7.364 | 97.6% |
| `Solar_Heat_Input_W` | hist_gradient_250_leaf15 | 598.1 | 854.3 | 0.9936 | 8478 | 92.9% |
| `Heat_Transfer_Rate_W` | hist_gradient_250_leaf15 | 18.51 | 25.98 | 0.9866 | 164.6 | 88.8% |
| `Thermal_Energy_Loss_Wh` | hist_gradient_250_leaf15 | 522.4 | 956.7 | 0.9734 | 3694 | 85.9% |

MAE is mean absolute error in the target's units. RMSE is root mean squared error and penalizes large misses more. R² describes variation explained relative to a constant-mean baseline; it is not accuracy.

## Overfitting assessment

The table compares fit error with validation and final test error. A much lower training MAE is a warning for memorization; similar validation and test values are a useful stability check, but do not prove that overfitting is absent.

| Target | Train MAE | Validation MAE | Test MAE | Validation − train |
|---|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | 0.03431 | 0.1467 | 0.1294 | 0.1124 |
| `Minimum_Air_Temperature_C` | 0.1425 | 0.1962 | 0.1716 | 0.05365 |
| `Maximum_Air_Temperature_C` | 0.1285 | 0.1937 | 0.1799 | 0.06516 |
| `Solar_Heat_Input_W` | 397.4 | 615.9 | 598.1 | 218.5 |
| `Heat_Transfer_Rate_W` | 11.8 | 19.39 | 18.51 | 7.585 |
| `Thermal_Energy_Loss_Wh` | 247.9 | 499.8 | 522.4 | 251.9 |
The validation and test errors are close for these fixed splits, while training error is lower, so there is a train-to-held-out gap consistent with some overfitting. Use new simulation cases to confirm these estimates before deployment.

## Generalization diagnostics

### Material-held-out stress test

Grouped diagnostics held out complete Material names (9 names) in 3 folds. This is a stress test, not proof of universal material generalization.

| Target | MAE | RMSE | R² | Baseline MAE | Improvement vs baseline |
|---|---:|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | 0.4104 | 0.5652 | 0.9959 | 7.428 | 94.5% |
| `Minimum_Air_Temperature_C` | 0.3101 | 0.4072 | 0.9979 | 7.452 | 95.8% |
| `Maximum_Air_Temperature_C` | 0.2991 | 0.3981 | 0.9980 | 7.433 | 96.0% |
| `Solar_Heat_Input_W` | 2255 | 3966 | 0.8653 | 8452 | 73.3% |
| `Heat_Transfer_Rate_W` | 35.38 | 48.6 | 0.9564 | 179.4 | 80.3% |
| `Thermal_Energy_Loss_Wh` | 793.2 | 1437 | 0.9299 | 3584 | 77.9% |

### Source-held-out diagnostic

Computed leave-one-source-out GroupKFold across 4 Dataset_Source files. This is a limited transfer diagnostic across the supplied compatible sources; it does not validate a new generation method, independent CFD runs, or field measurements.

| Target | Status / MAE | RMSE | R² | Baseline MAE | Improvement vs baseline |
|---|---:|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | 0.1545 | 0.2172 | 0.9994 | 7.426 | 97.9% |
| `Minimum_Air_Temperature_C` | 0.2063 | 0.261 | 0.9991 | 7.439 | 97.2% |
| `Maximum_Air_Temperature_C` | 0.1952 | 0.2492 | 0.9992 | 7.432 | 97.4% |
| `Solar_Heat_Input_W` | 665.9 | 1001 | 0.9914 | 8444 | 92.1% |
| `Heat_Transfer_Rate_W` | 21.31 | 30.43 | 0.9829 | 169.5 | 87.4% |
| `Thermal_Energy_Loss_Wh` | 519.3 | 966.2 | 0.9683 | 3421 | 84.8% |
The source folds cover one base workbook without Batch metadata and named batches Batch_2, Batch_3, Batch_4. The sources share the listed physics-informed method/provenance. Interpret this as a source-transfer stress test, not independent CFD or field validation.

## Feature importance

Permutation importance was measured on validation rows using change in MAE, so values are in each target's units. Correlated features can split or mask one another's importance.

- `Average_Air_Temperature_C` top features: `External_Temperature_C` (9.275), `Initial_Air_Temperature_C` (3.092), `Density_kg_m3` (0.1737), `Material_Category` (0.1093), `Thermal_Conductivity_W_mK` (0.03471).
- `Minimum_Air_Temperature_C` top features: `External_Temperature_C` (9.243), `Initial_Air_Temperature_C` (3.062), `Thermal_Conductivity_W_mK` (0.5745), `Density_kg_m3` (0.05002), `Wall_Thickness_m` (0.04544).
- `Maximum_Air_Temperature_C` top features: `External_Temperature_C` (9.246), `Initial_Air_Temperature_C` (3.063), `Thermal_Conductivity_W_mK` (0.3224), `Wall_Thickness_m` (0.0946), `Density_kg_m3` (0.03037).
- `Solar_Heat_Input_W` top features: `Orientation_deg` (8587), `Solar_Radiation_W_m2` (3713), `Shelter_Length_m` (1151), `Shelter_Height_m` (1067), `Shelter_Width_m` (870.4).
- `Heat_Transfer_Rate_W` top features: `External_Temperature_C` (186.5), `Thermal_Conductivity_W_mK` (76.88), `Initial_Air_Temperature_C` (53.47), `Wall_Thickness_m` (20.97), `Shelter_Length_m` (13.16).
- `Thermal_Energy_Loss_Wh` top features: `External_Temperature_C` (3159), `Thermal_Conductivity_W_mK` (1471), `Simulation_Duration_h` (1425), `Initial_Air_Temperature_C` (876), `Wall_Thickness_m` (422).

Plots: `D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v3/feature_importance_<target>.svg` and `D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v3/diagnostic_<target>.svg`.

## Error analysis

- Highest held-out R²: `Average_Air_Temperature_C` (R² 0.9996); lowest: `Thermal_Energy_Loss_Wh` (R² 0.9734). This ranks fit on this split, not physical validity.
- Largest per-material test MAE for `Average_Air_Temperature_C`: `Aluminum` (0.2191, n=95).
- Largest individual test error for `Average_Air_Temperature_C`: Case `CASE_02934`, material `Aluminum`, absolute error 1.219.
- Largest per-material test MAE for `Minimum_Air_Temperature_C`: `Concrete` (0.2064, n=95).
- Largest individual test error for `Minimum_Air_Temperature_C`: Case `CASE_02934`, material `Aluminum`, absolute error 0.8707.
- Largest per-material test MAE for `Maximum_Air_Temperature_C`: `Aluminum` (0.1969, n=95).
- Largest individual test error for `Maximum_Air_Temperature_C`: Case `CASE_00878`, material `Aluminum`, absolute error 0.8184.
- Largest per-material test MAE for `Solar_Heat_Input_W`: `Concrete` (722.1, n=95).
- Largest individual test error for `Solar_Heat_Input_W`: Case `CASE_01102`, material `Brick`, absolute error 6184.
- Largest per-material test MAE for `Heat_Transfer_Rate_W`: `Concrete` (23.54, n=95).
- Largest individual test error for `Heat_Transfer_Rate_W`: Case `CASE_05855`, material `Composite insulated wall`, absolute error 153.2.
- Largest per-material test MAE for `Thermal_Energy_Loss_Wh`: `Aluminum` (893.9, n=95).
- Largest individual test error for `Thermal_Energy_Loss_Wh`: Case `CASE_04486`, material `Aluminum`, absolute error 7350.
- Training, validation, and final test MAE are shown together above. The train/validation gap is descriptive; candidate selection used validation only. The final test set was evaluated after model selection.
- Input-range error bins are saved in `D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v3/error_by_input_ranges.csv`; inspect them before making claims about cold extremes or wall-thickness boundaries.

## Data provenance and limitations

The training source provenance is recorded in model metadata and below:
- `ladakh_shelter_1500_physics_informed_dataset.xlsx` — Data_Type: `['PHYSICS_INFORMED_ESTIMATE']`; CFD_Reference: `['Calibrated against 3 ANSYS Fluent validation cases (Aluminum/Concrete/EPS, 0.20 m, Text=35C, Tinit=20C)']`; Climate_Data_Source: `['Representative high-altitude cold-desert climate ranges for Ladakh (not a direct NASA POWER data pull)']`; Material_Data_Source: `['Standard engineering material-property handbook ranges']`; Surrogate_Method: `['Physics-informed R=L/k+R_film network, log(k)-interpolated correction anchored to 3 Fluent points']`.
- `ladakh_shelter_1500_batch2_physics_informed_dataset.xlsx` — Data_Type: `['PHYSICS_INFORMED_ESTIMATE']`; CFD_Reference: `['Calibrated against 3 ANSYS Fluent validation cases (Aluminum/Concrete/EPS, 0.20 m, Text=35C, Tinit=20C)']`; Climate_Data_Source: `['Representative high-altitude cold-desert climate ranges for Ladakh (not a direct NASA POWER data pull)']`; Material_Data_Source: `['Standard engineering material-property handbook ranges']`; Surrogate_Method: `['Physics-informed R=L/k+R_film network, log(k)-interpolated correction anchored to 3 Fluent points']`; Batch: `['Batch_2']`.
- `ladakh_shelter_1500_batch3_physics_informed_dataset.xlsx` — Data_Type: `['PHYSICS_INFORMED_ESTIMATE']`; CFD_Reference: `['Calibrated against 3 ANSYS Fluent validation cases (Aluminum/Concrete/EPS, 0.20 m, Text=35C, Tinit=20C)']`; Climate_Data_Source: `['Representative high-altitude cold-desert climate ranges for Ladakh (not a direct NASA POWER data pull)']`; Material_Data_Source: `['Standard engineering material-property handbook ranges']`; Surrogate_Method: `['Physics-informed R=L/k+R_film network, log(k)-interpolated correction anchored to 3 Fluent points']`; Batch: `['Batch_3']`.
- `ladakh_shelter_2000_batch4_physics_informed_dataset.xlsx` — Data_Type: `['PHYSICS_INFORMED_ESTIMATE']`; CFD_Reference: `['Calibrated against 3 ANSYS Fluent validation cases (Aluminum/Concrete/EPS, 0.20 m, Text=35C, Tinit=20C)']`; Climate_Data_Source: `['Representative high-altitude cold-desert climate ranges for Ladakh (not a direct NASA POWER data pull)']`; Material_Data_Source: `['Standard engineering material-property handbook ranges']`; Surrogate_Method: `['Physics-informed R=L/k+R_film network, log(k)-interpolated correction anchored to 3 Fluent points']`; Batch: `['Batch_4']`.

All 4 workbooks passed the required input/target schema checks. The only source schema difference was optional Batch metadata; they were combined with Dataset_Source provenance. 0 exact duplicate input/target cases were removed.
The inspected files contain 6,500 raw rows in total. The largest confirmed exact pairwise row overlap is 0; these counts are inventory totals, not a claim that incompatible files form one training set.
No field measurements were supplied. Missing provenance fields mean unknown provenance, not proof that a file came directly from ANSYS.
The workbooks contain 6,240 separate hourly records across 260 sampled case sequences. The six model targets are per-case average/minimum/maximum temperatures and aggregate heat quantities. V3 trains only on the case-summary sheets and does not output a 24-hour curve. Predictions are supported only within the supplied feature ranges; a held-out score against physics-informed estimates is not ANSYS accuracy or field validation.
V2 used only the Batch 3 and Batch 4 CSV sources, totaling 3,500 rows. V3 uses the four current project workbooks. The older 63-row and 36-row files were not included.
The case-level holdout tests interpolation for represented material names. The material-held-out score is a limited stress test. Source-held-out results are only appropriate when multiple compatible sources are combined; otherwise the report marks them not applicable.

## Reproduce training and inference

From the project root, install `ml/requirements.txt`, inspect all files, and train only compatible sources:
```powershell
python -m pip install -r ml/requirements.txt
python ml/audit_thermal_surrogate_v3.py --project-dir . --out-dir "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v3"
python ml/train_thermal_surrogate_v3.py --data "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ladakh_shelter_1500_physics_informed_dataset.xlsx" --data "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ladakh_shelter_1500_batch2_physics_informed_dataset.xlsx" --data "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ladakh_shelter_1500_batch3_physics_informed_dataset.xlsx" --data "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ladakh_shelter_2000_batch4_physics_informed_dataset.xlsx" --inspection "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v3/dataset_inspection.json" --out-dir "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v3" --model-filename thermal_surrogate_v3.joblib
python ml/predict_v3.py --model "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v3/thermal_surrogate_v3.joblib" --input "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v3/example_input.json" --output "D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v3/example_prediction.json"
```
The model is saved as `D:/THERMOSHELTER-final(2)/THERMOSHELTER/ml/artifacts/v3/thermal_surrogate_v3.joblib` with its preprocessing pipelines and metadata. A future FastAPI endpoint can import `predict_shelter()` from `ml/predict_v3.py`.
