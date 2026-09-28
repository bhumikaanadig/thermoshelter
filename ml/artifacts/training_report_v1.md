# THERMOSHELTER thermal surrogate training report

## What the surrogate does

This pipeline fits one regression model per target. It learns a mapping from the listed material, geometry, and climate inputs to the supplied simulation summary outputs. It is a fast approximation of its training labels; it does not replace ANSYS. Predictions for solar heat input and thermal energy loss are bounded below by zero, consistent with the supplied data's physical range checks.

## Data inspected and used

- Raw rows passed to the training pipeline: 1,500
- Exact duplicate full rows removed: 0
- Unique rows used by the six-target model: 1,500
- Model input columns: 21; predicted outputs: 6.
- Original CSVs were read only. No outlier rows were removed.

### Files inspected

| File | Rows | Columns | Duplicate rows | Duplicate Case_ID | Data_Type |
|---|---:|---:|---:|---:|---|
| `ladakh_shelter_1500_batch3_physics_informed_dataset.csv` | 1500 | 41 | 0 | 0 | `['PHYSICS_INFORMED_ESTIMATE']` |
| `ladakh_shelter_ml_dataset_63_cases.csv` | 63 | 11 | 0 | None | `[]` |
| `ladakh_shelter_ml_dataset_updated (1).csv` | 36 | 11 | 0 | None | `[]` |

### Source disposition

- `ladakh_shelter_1500_batch3_physics_informed_dataset.csv` was used for the six-target fit.
- `ladakh_shelter_ml_dataset_63_cases.csv` was inspected and kept separate: missing 16 required input columns; missing 2 required target columns; schema differs from the full-feature dataset; contains 36 rows exactly duplicated in another supplied file; its annual solar-energy column is not the same quantity/unit as instantaneous W/m² or daily kWh/m² inputs.
- `ladakh_shelter_ml_dataset_updated (1).csv` was inspected and kept separate: missing 16 required input columns; missing 2 required target columns; schema differs from the full-feature dataset; contains 36 rows exactly duplicated in another supplied file; its annual solar-energy column is not the same quantity/unit as instantaneous W/m² or daily kWh/m² inputs.

### Combination decision

Only the selected full-feature source was used for the six-target fit. Other inspected CSVs were kept separate because their schemas/inputs/targets differ; see Source disposition above.


## Features and targets

**Inputs** (only these columns enter the model): `Material`, `Material_Category`, `Thermal_Conductivity_W_mK`, `Density_kg_m3`, `Specific_Heat_J_kgK`, `Wall_Thickness_m`, `Shelter_Length_m`, `Shelter_Width_m`, `Shelter_Height_m`, `Opening_Area_m2`, `Window_Area_m2`, `Door_Area_m2`, `Orientation_deg`, `External_Temperature_C`, `Initial_Air_Temperature_C`, `Solar_Radiation_W_m2`, `Daily_Solar_Energy_kWh_m2`, `Wind_Speed_m_s`, `Relative_Humidity_percent`, `Simulation_Duration_h`, `Time_Step_min`.

**Targets** (trained separately): `Average_Air_Temperature_C`, `Minimum_Air_Temperature_C`, `Maximum_Air_Temperature_C`, `Solar_Heat_Input_W`, `Heat_Transfer_Rate_W`, `Thermal_Energy_Loss_Wh`.

Case IDs, Dataset_Source, batch/source metadata, and all output columns are excluded from model features. Any additional supplied outputs remain excluded from inputs. Opening area may be defined from window and door areas, and daily solar energy may be strongly related to radiation; correlated known inputs can share or mask permutation importance, so interpret their ranking with that in mind.

## Data quality

- Training rows: 1,500; missing feature cells: 0; missing target cells: 0; non-finite numeric cells: 0.
- Exact duplicate full rows in the training input: 0; duplicate case IDs: 0.
- Physical range checks with violations: 0.
- Constant columns in training input: ['Data_Type', 'CFD_Reference', 'Climate_Data_Source', 'Material_Data_Source', 'Surrogate_Method', 'Batch', 'Dataset_Source'].
- Highly correlated numeric input pairs (|Pearson r| ≥ 0.98): [{'left': 'Solar_Radiation_W_m2', 'right': 'Daily_Solar_Energy_kWh_m2', 'pearson_r': 0.9999999818674329}, {'left': 'Opening_Area_m2', 'right': 'Window_Area_m2', 'pearson_r': 0.9889316597938163}].
- IQR flags are recorded in the inspection artifact; they were not treated as errors and no outliers were deleted.

## Models and split

Candidates were ExtraTreesRegressor, RandomForestRegressor, and HistGradientBoostingRegressor. Two practical hyperparameter configurations per family were compared on validation MAE only. The final model for each target was refit on training + validation data; the held-out test data were not used to select model family or parameters.
- Split: 1,050 train / 225 validation / 225 test (Material).
- Random seed: 42. Case rows are one summary per Case_ID in the training source; all Case_IDs are unique there.

| Target | Selected family | Configuration | Hyperparameters |
|---|---|---|---|
| `Average_Air_Temperature_C` | HistGradientBoostingRegressor | `hist_gradient_150_leaf15` | `{'max_iter': 150, 'max_leaf_nodes': 15, 'learning_rate': 0.05, 'l2_regularization': 1.0}` |
| `Minimum_Air_Temperature_C` | HistGradientBoostingRegressor | `hist_gradient_150_leaf15` | `{'max_iter': 150, 'max_leaf_nodes': 15, 'learning_rate': 0.05, 'l2_regularization': 1.0}` |
| `Maximum_Air_Temperature_C` | ExtraTreesRegressor | `extra_trees_leaf1_all` | `{'n_estimators': 300, 'min_samples_leaf': 1, 'max_features': 1.0}` |
| `Solar_Heat_Input_W` | HistGradientBoostingRegressor | `hist_gradient_250_leaf15` | `{'max_iter': 250, 'max_leaf_nodes': 15, 'learning_rate': 0.08, 'l2_regularization': 1.0}` |
| `Heat_Transfer_Rate_W` | HistGradientBoostingRegressor | `hist_gradient_250_leaf15` | `{'max_iter': 250, 'max_leaf_nodes': 15, 'learning_rate': 0.08, 'l2_regularization': 1.0}` |
| `Thermal_Energy_Loss_Wh` | HistGradientBoostingRegressor | `hist_gradient_250_leaf15` | `{'max_iter': 250, 'max_leaf_nodes': 15, 'learning_rate': 0.08, 'l2_regularization': 1.0}` |

### Validation and training metrics

| Target | Selected model | Train MAE | Validation MAE | Validation RMSE | Validation R² | Validation baseline MAE | Improvement vs baseline | Val − train MAE |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | hist_gradient_150_leaf15 | 0.1767 | 0.302 | 0.4007 | 0.9983 | 8.087 | 96.3% | 0.1253 |
| `Minimum_Air_Temperature_C` | hist_gradient_150_leaf15 | 0.1939 | 0.3477 | 0.4562 | 0.9978 | 8.092 | 95.7% | 0.1538 |
| `Maximum_Air_Temperature_C` | extra_trees_leaf1_all | 4.656e-14 | 0.3296 | 0.4495 | 0.9979 | 8.112 | 95.9% | 0.3296 |
| `Solar_Heat_Input_W` | hist_gradient_250_leaf15 | 392.2 | 1046 | 1646 | 0.9755 | 8192 | 87.2% | 653.8 |
| `Heat_Transfer_Rate_W` | hist_gradient_250_leaf15 | 10.17 | 28.37 | 39.44 | 0.9639 | 157.6 | 82.0% | 18.2 |
| `Thermal_Energy_Loss_Wh` | hist_gradient_250_leaf15 | 331.9 | 828.1 | 1416 | 0.9334 | 3619 | 77.1% | 496.1 |

### Untouched held-out test metrics

| Target | Selected model | MAE | RMSE | R² | Baseline MAE | Improvement vs baseline |
|---|---|---:|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | hist_gradient_150_leaf15 | 0.2984 | 0.3818 | 0.9981 | 7.372 | 96.0% |
| `Minimum_Air_Temperature_C` | hist_gradient_150_leaf15 | 0.3293 | 0.4185 | 0.9977 | 7.36 | 95.5% |
| `Maximum_Air_Temperature_C` | extra_trees_leaf1_all | 0.336 | 0.4404 | 0.9975 | 7.42 | 95.5% |
| `Solar_Heat_Input_W` | hist_gradient_250_leaf15 | 934.3 | 1345 | 0.9816 | 8180 | 88.6% |
| `Heat_Transfer_Rate_W` | hist_gradient_250_leaf15 | 28.74 | 40.24 | 0.9665 | 167.2 | 82.8% |
| `Thermal_Energy_Loss_Wh` | hist_gradient_250_leaf15 | 827.7 | 1541 | 0.9139 | 3373 | 75.5% |

MAE is mean absolute error in the target's units. RMSE is root mean squared error and penalizes large misses more. R² describes variation explained relative to a constant-mean baseline; it is not accuracy.

## Overfitting assessment

The table compares fit error with validation and final test error. A much lower training MAE is a warning for memorization; similar validation and test values are a useful stability check, but do not prove that overfitting is absent.

| Target | Train MAE | Validation MAE | Test MAE | Validation − train |
|---|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | 0.1767 | 0.302 | 0.2984 | 0.1253 |
| `Minimum_Air_Temperature_C` | 0.1939 | 0.3477 | 0.3293 | 0.1538 |
| `Maximum_Air_Temperature_C` | 4.656e-14 | 0.3296 | 0.336 | 0.3296 |
| `Solar_Heat_Input_W` | 392.2 | 1046 | 934.3 | 653.8 |
| `Heat_Transfer_Rate_W` | 10.17 | 28.37 | 28.74 | 18.2 |
| `Thermal_Energy_Loss_Wh` | 331.9 | 828.1 | 827.7 | 496.1 |
Training MAE is effectively zero for `Maximum_Air_Temperature_C`; treat this as a memorization warning even though the held-out errors are reported separately.
The validation and test errors are close for these fixed splits, while training error is lower, so there is a train-to-held-out gap consistent with some overfitting. Use new simulation cases to confirm these estimates before deployment.

## Generalization diagnostics

### Material-held-out stress test

Grouped diagnostics held out complete Material names (9 names) in 3 folds. This is a stress test, not proof of universal material generalization.

| Target | MAE | RMSE | R² | Baseline MAE | Improvement vs baseline |
|---|---:|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | 0.3911 | 0.5249 | 0.9966 | 7.501 | 94.8% |
| `Minimum_Air_Temperature_C` | 0.4496 | 0.5967 | 0.9956 | 7.519 | 94.0% |
| `Maximum_Air_Temperature_C` | 0.4809 | 0.667 | 0.9945 | 7.506 | 93.6% |
| `Solar_Heat_Input_W` | 2638 | 4563 | 0.8141 | 8466 | 68.8% |
| `Heat_Transfer_Rate_W` | 38.4 | 56.58 | 0.9360 | 166.2 | 76.9% |
| `Thermal_Energy_Loss_Wh` | 1030 | 1865 | 0.8839 | 3460 | 70.2% |

### Source-held-out diagnostic

Not applicable: only one compatible Dataset_Source was used. Other inspected files were kept separate because their schemas/required inputs/targets or solar units differ.

| Target | Status / MAE | RMSE | R² | Baseline MAE | Improvement vs baseline |
|---|---:|---:|---:|---:|---:|
| `Average_Air_Temperature_C` | N/A | N/A | N/A | N/A | N/A |
| `Minimum_Air_Temperature_C` | N/A | N/A | N/A | N/A | N/A |
| `Maximum_Air_Temperature_C` | N/A | N/A | N/A | N/A | N/A |
| `Solar_Heat_Input_W` | N/A | N/A | N/A | N/A | N/A |
| `Heat_Transfer_Rate_W` | N/A | N/A | N/A | N/A | N/A |
| `Thermal_Energy_Loss_Wh` | N/A | N/A | N/A | N/A | N/A |

## Feature importance

Permutation importance was measured on validation rows using change in MAE, so values are in each target's units. Correlated features can split or mask one another's importance.

- `Average_Air_Temperature_C` top features: `External_Temperature_C` (9.723), `Initial_Air_Temperature_C` (3.083), `Thermal_Conductivity_W_mK` (0.1822), `Density_kg_m3` (0.08003), `Wind_Speed_m_s` (0.0008693).
- `Minimum_Air_Temperature_C` top features: `External_Temperature_C` (9.667), `Initial_Air_Temperature_C` (3.041), `Thermal_Conductivity_W_mK` (0.3693), `Density_kg_m3` (0.09484), `Wall_Thickness_m` (0.01326).
- `Maximum_Air_Temperature_C` top features: `External_Temperature_C` (9.659), `Initial_Air_Temperature_C` (3.043), `Density_kg_m3` (0.09888), `Material_Category` (0.05276), `Material` (0.0208).
- `Solar_Heat_Input_W` top features: `Orientation_deg` (8505), `Solar_Radiation_W_m2` (3494), `Shelter_Length_m` (831.3), `Shelter_Height_m` (828.8), `Thermal_Conductivity_W_mK` (584.8).
- `Heat_Transfer_Rate_W` top features: `External_Temperature_C` (176.6), `Thermal_Conductivity_W_mK` (55.52), `Initial_Air_Temperature_C` (45.96), `Wall_Thickness_m` (13.74), `Density_kg_m3` (9.256).
- `Thermal_Energy_Loss_Wh` top features: `External_Temperature_C` (3243), `Thermal_Conductivity_W_mK` (1225), `Simulation_Duration_h` (1055), `Initial_Air_Temperature_C` (779.2), `Wall_Thickness_m` (290.6).

Plots: `feature_importance_<target>.svg` and `diagnostic_<target>.svg` in the artifacts folder.

## Error analysis

- Highest held-out R²: `Average_Air_Temperature_C` (R² 0.9981); lowest: `Thermal_Energy_Loss_Wh` (R² 0.9139). This ranks fit on this split, not physical validity.
- Largest per-material test MAE for `Average_Air_Temperature_C`: `Aerated concrete / AAC` (0.3885, n=27).
- Largest individual test error for `Average_Air_Temperature_C`: Case `CASE_03031`, material `Aluminum`, absolute error 1.194.
- Largest per-material test MAE for `Minimum_Air_Temperature_C`: `Aluminum` (0.5018, n=21).
- Largest individual test error for `Minimum_Air_Temperature_C`: Case `CASE_03031`, material `Aluminum`, absolute error 1.338.
- Largest per-material test MAE for `Maximum_Air_Temperature_C`: `Aluminum` (0.5847, n=21).
- Largest individual test error for `Maximum_Air_Temperature_C`: Case `CASE_03165`, material `Aerated concrete / AAC`, absolute error 1.591.
- Largest per-material test MAE for `Solar_Heat_Input_W`: `Concrete` (1300, n=21).
- Largest individual test error for `Solar_Heat_Input_W`: Case `CASE_03141`, material `Brick`, absolute error 6012.
- Largest per-material test MAE for `Heat_Transfer_Rate_W`: `Brick` (45.97, n=27).
- Largest individual test error for `Heat_Transfer_Rate_W`: Case `CASE_03796`, material `Brick`, absolute error 172.3.
- Largest per-material test MAE for `Thermal_Energy_Loss_Wh`: `Brick` (1473, n=27).
- Largest individual test error for `Thermal_Energy_Loss_Wh`: Case `CASE_04486`, material `Aluminum`, absolute error 7934.
- Training, validation, and final test MAE are shown together above. The train/validation gap is descriptive; candidate selection used validation only. The final test set was evaluated after model selection.
- Input-range error bins are saved in `error_by_input_ranges.csv`; inspect them before making claims about cold extremes or wall-thickness boundaries.

## Data provenance and limitations

The training source provenance is recorded in model metadata and below:
- `ladakh_shelter_1500_batch3_physics_informed_dataset.csv` — Data_Type: `['PHYSICS_INFORMED_ESTIMATE']`; CFD_Reference: `['Calibrated against 3 ANSYS Fluent validation cases (Aluminum/Concrete/EPS, 0.20 m, Text=35C, Tinit=20C)']`.

Only the selected full-feature source was used for the six-target fit. Other inspected CSVs were kept separate because their schemas/inputs/targets differ; see Source disposition above.
The inspected files contain 1,599 raw rows in total. The largest confirmed exact pairwise row overlap is 36; these counts are inventory totals, not a claim that incompatible files form one training set.
No field measurements were supplied. Missing provenance fields mean unknown provenance, not proof that a file came directly from ANSYS.
The current labels are per-case averages/minima/maxima and aggregate heat quantities, not hourly transient sequences. This model does not output a 24-hour curve. Predictions are supported only within the supplied feature ranges; a held-out score against supplied estimates is not ANSYS accuracy or field validation.
The case-level holdout tests interpolation for represented material names. The material-held-out score is a limited stress test. Source-held-out results are only appropriate when multiple compatible sources are combined; otherwise the report marks them not applicable.

## Reproduce training and inference

From the project root, install `ml/requirements.txt`, inspect all files, and train only compatible sources:
```powershell
python -m pip install -r ml/requirements.txt
python ml/inspect_datasets.py --data "D:/ANSYS/ladakh_shelter_1500_batch3_physics_informed_dataset.csv" --data "D:/ANSYS/ladakh_shelter_ml_dataset_63_cases.csv" --data "D:/ladakh_shelter_ml_dataset_updated (1).csv"
python ml/train_thermal_surrogate.py --data "D:/ANSYS/ladakh_shelter_1500_batch3_physics_informed_dataset.csv" --inspection ml/artifacts/dataset_inspection.json
python ml/predict.py --input ml/artifacts/example_input.json --output ml/artifacts/example_prediction.json
```
The model is saved as `thermal_surrogate.joblib` with its preprocessing pipelines and metadata. A future FastAPI endpoint can import `predict_shelter()` from `ml/predict.py`; React will call that endpoint over HTTP.
