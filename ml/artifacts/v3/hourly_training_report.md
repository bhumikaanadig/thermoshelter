# THERMOSHELTER V3 Hourly Surrogate v1 training report

## Scope and data source

The model predicts `Indoor_Temperature_C` for each supplied hour from 0 through 23. It is a separate artifact and does not change the six-output V3 summary model.

The combined hourly table contains 6,240 stored workbook rows across 260 complete case sequences. Each sequence has one record for each hour 0–23. The four source workbooks label all 6,500 parent design cases as `PHYSICS_INFORMED_ESTIMATE`; the 260 hourly sequences are actual records present in those sheets, not 260 independently verified ANSYS runs or field measurements.

Combined dataset: `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ml\artifacts\v3\hourly_combined_training_data.csv`.

### Source sheets

| Workbook | Hourly sheet | Rows | Sequences | Design input sheet | Split sheet |
|---|---|---:|---:|---|---|
| `ladakh_shelter_1500_batch2_physics_informed_dataset.xlsx` | `Transient_24h_Subset` | 1440 | 60 | `Design_Cases_Batch2_1500` | `Train_Val_Test_Split` |
| `ladakh_shelter_1500_batch3_physics_informed_dataset.xlsx` | `Transient_24h_Subset` | 1440 | 60 | `Design_Cases_Batch3_1500` | `Train_Val_Test_Split` |
| `ladakh_shelter_1500_physics_informed_dataset.xlsx` | `Transient_24h_Subset` | 1440 | 60 | `Design_Cases_1500` | `Train_Val_Test_Split` |
| `ladakh_shelter_2000_batch4_physics_informed_dataset.xlsx` | `Transient_24h_Subset` | 1920 | 80 | `Design_Cases_Batch4_2000` | `Train_Val_Test_Split` |

Hourly columns in the source sheets: `Case_ID`, `Hour`, `Outdoor_Temperature_C`, `Solar_Radiation_W_m2`, `Wind_Speed_m_s`, `Indoor_Temperature_C`, `Wall_Temperature_C`, `Heat_Transfer_Rate_W`, `Solar_Heat_Input_W`.

The stored `Case_ID` maps each hourly sequence to exactly one design-case row. The split sheet assignments match the design-case assignments. No rows were removed. The audit found no duplicate hours, incomplete sequences, missing target or input values, non-finite fields, broken case mappings, duplicate hourly sequence signatures, or rounded input signatures crossing splits.

## Target, inputs, and leakage controls

Target: `Indoor_Temperature_C` (°C).

Prediction uses 21 static case inputs, the three hourly climate columns, and cyclical hour features (`Hour_sin`, `Hour_cos`). The hourly climate profile must be supplied by the caller for all 24 hours: `Outdoor_Temperature_C`, `Solar_Radiation_W_m2`, and `Wind_Speed_m_s`.

The model excludes `Case_ID`, `Sequence_ID`, `Dataset_Source`, split labels, all case-level summary outputs, and the non-target hourly `Wall_Temperature_C`, `Heat_Transfer_Rate_W`, and `Solar_Heat_Input_W`. It does not use later indoor temperatures or any target-derived summary as an input. The fixed workbook split keeps all 24 rows from a sequence together.

Case split: 169 train / 46 validation / 45 held-out test sequences (4,056 / 1,104 / 1,080 hourly rows). The selected estimator was refit on the train and validation cases, then evaluated once on the held-out test cases.

## Model selection

Selected using validation MAE only: `HistGradientBoostingRegressor` with `hist_gradient_250_leaf15` configuration `{"l2_regularization": 1.0, "learning_rate": 0.08, "max_iter": 250, "max_leaf_nodes": 15, "min_samples_leaf": 15}`.

| Candidate | Validation MAE (°C) | Validation RMSE (°C) | Validation R² |
|---|---:|---:|---:|
| `extra_trees_leaf1_all` | 0.8385 | 1.3201 | 0.9793 |
| `extra_trees_leaf2_80pct` | 0.9433 | 1.4204 | 0.9761 |
| `random_forest_leaf1_all` | 0.9959 | 1.3969 | 0.9769 |
| `random_forest_leaf2_80pct` | 0.9646 | 1.3682 | 0.9778 |
| `hist_gradient_150_leaf15` | 0.6835 | 0.9956 | 0.9883 |
| `hist_gradient_250_leaf15` | 0.6463 | 0.9303 | 0.9897 |

## Held-out case-level test

- MAE: 0.4779 °C
- RMSE: 0.6477 °C
- R²: 0.9904 (describes variance explained; it is not accuracy)
- Worst absolute error: 2.5412 °C at Case_ID `CASE_05608`, hour 13.

### Error by hour

| Hour | Cases | MAE (°C) | RMSE (°C) | R² |
|---:|---:|---:|---:|---:|
| 0 | 45 | 0.4598 | 0.6183 | 0.9906 |
| 1 | 45 | 0.4630 | 0.6204 | 0.9905 |
| 2 | 45 | 0.4637 | 0.6175 | 0.9906 |
| 3 | 45 | 0.4740 | 0.6079 | 0.9912 |
| 4 | 45 | 0.4607 | 0.5998 | 0.9914 |
| 5 | 45 | 0.4769 | 0.6141 | 0.9909 |
| 6 | 45 | 0.4288 | 0.6010 | 0.9912 |
| 7 | 45 | 0.4815 | 0.6369 | 0.9899 |
| 8 | 45 | 0.4741 | 0.6670 | 0.9888 |
| 9 | 45 | 0.4556 | 0.6145 | 0.9903 |
| 10 | 45 | 0.4824 | 0.6369 | 0.9894 |
| 11 | 45 | 0.5297 | 0.7070 | 0.9868 |
| 12 | 45 | 0.5060 | 0.7119 | 0.9865 |
| 13 | 45 | 0.4617 | 0.6591 | 0.9884 |
| 14 | 45 | 0.5063 | 0.6936 | 0.9871 |
| 15 | 45 | 0.4892 | 0.6644 | 0.9881 |
| 16 | 45 | 0.5067 | 0.6913 | 0.9872 |
| 17 | 45 | 0.4626 | 0.6550 | 0.9885 |
| 18 | 45 | 0.5030 | 0.7060 | 0.9867 |
| 19 | 45 | 0.5235 | 0.7023 | 0.9870 |
| 20 | 45 | 0.4906 | 0.6377 | 0.9894 |
| 21 | 45 | 0.4639 | 0.6217 | 0.9901 |
| 22 | 45 | 0.4524 | 0.6183 | 0.9906 |
| 23 | 45 | 0.4545 | 0.6185 | 0.9906 |

## Curve quality

Across held-out sequences, the maximum observed absolute adjacent-hour change was 3.0500 °C in the source labels and 3.4770 °C in model predictions. The predicted curve is returned as produced by the selected tree model; there is no smoothing or endpoint adjustment.

Held-out actual and predicted 24-point examples are in `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ml\artifacts\v3\hourly_heldout_curve_examples.json`.

## Material-held-out diagnostic

Materials withheld from all fitting and validation rows: Aluminum, Polyurethane foam (PU). Diagnostic test used 33 cases and 792 rows. MAE 1.0499 °C; RMSE 1.3878 °C; R² 0.9789. This is a separate material generalization diagnostic, not the primary held-out case test.

## Observed data limitations

The hourly `Indoor_Temperature_C` sequences do not exactly reconcile to the separate case-sheet average/minimum/maximum outputs. Across 260 cases, mean absolute differences were 1.735 °C for hourly mean versus summary average, 2.262 °C for hourly minimum versus summary minimum, and 2.982 °C for hourly maximum versus summary maximum. Hour 0 also does not consistently equal the static `Initial_Air_Temperature_C`; median difference (hour 0 minus initial) was -5.670 °C. These mismatches are preserved and reported; the hourly target alone is used for training. The inference helper does not force the first predicted value to equal the input initial temperature.

The current website supplies summary climate values. A physically meaningful 24-hour request additionally needs a caller-supplied 24-point outdoor temperature, solar radiation, and wind profile. This model does not synthesize those weather inputs. Use measured or forecast hourly data from a defined source before connecting it to the website. Predictions outside the fit-row numeric ranges are returned with diagnostics and are extrapolations; the model does not guarantee reliable extrapolation.

These metrics compare predictions with the workbook’s physics-informed hourly estimates. They are not ANSYS accuracy, field validation, or proof of site-specific thermal performance.

## Saved files

- Hourly model: `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ml\artifacts\v3\thermal_hourly_surrogate_v1.joblib`
- Inference example: `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ml\artifacts\v3\hourly_example_prediction.json`
- Evaluation metrics: `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ml\artifacts\v3\hourly_evaluation_metrics.json`
- Inference helper: `ml/predict_hourly.py`
