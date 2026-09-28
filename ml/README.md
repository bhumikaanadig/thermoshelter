# THERMOSHELTER thermal surrogate

This folder contains a repeatable inspect/train/infer workflow. It trains one
regression pipeline per target and saves preprocessing, models, provenance, and
metrics together. The approved model families are ExtraTreesRegressor,
RandomForestRegressor, and HistGradientBoostingRegressor.

## Inspect the four supplied CSVs

From the project folder, install dependencies and run the audit:

```powershell
python -m pip install -r ml/requirements.txt
python ml/inspect_datasets.py --data "D:/ANSYS/ladakh_shelter_1500_batch3_physics_informed_dataset.csv" --data "D:/ANSYS/ladakh_shelter_ml_dataset_63_cases.csv" --data "D:/ladakh_shelter_ml_dataset_updated (1).csv" --data "C:/Users/bhumi/AppData/Local/Packages/5319275A.WhatsAppDesktop_cv1g1gvanyjgm/LocalState/sessions/8886714C6C449E311A8F343EEDD0B4D96C1CACE0/transfers/2026-39/ladakh_shelter_2000_batch4_physics_informed_dataset.csv" --out-dir ml/artifacts/v2
```

The audit records each schema, dtype, missing value, duplicate, range,
provenance, and pairwise overlap. It writes into `ml/artifacts/v2/` and leaves
the original CSVs and prior model artifacts unchanged.

## Train the v2 model

Batch 3 and Batch 4 have compatible schemas and matching physics-informed
generation metadata. The earlier 63-row and 36-row files lack required model
columns; the 36-row file is a subset of the 63-row file. The verified training
command uses only the two compatible batches:

```powershell
python ml/train_thermal_surrogate.py --data "D:/ANSYS/ladakh_shelter_1500_batch3_physics_informed_dataset.csv" --data "C:/Users/bhumi/AppData/Local/Packages/5319275A.WhatsAppDesktop_cv1g1gvanyjgm/LocalState/sessions/8886714C6C449E311A8F343EEDD0B4D96C1CACE0/transfers/2026-39/ladakh_shelter_2000_batch4_physics_informed_dataset.csv" --inspection ml/artifacts/v2/dataset_inspection.json --out-dir ml/artifacts/v2 --model-filename thermal_surrogate_v2.joblib
```

Compatible input rows are saved separately as
`ml/artifacts/v2/combined_training_data.csv`, with `Dataset_Source` retained
for audit and held-out-batch diagnostics. It is never a predictive feature.
The original CSVs are never edited. The former model at
`ml/artifacts/thermal_surrogate.joblib` remains intact.

## Predict one configuration

The JSON input must provide all 21 features. The example is sampled from a
case held out of model fitting:

```powershell
python ml/predict.py --input ml/artifacts/v2/example_input.json --output ml/artifacts/v2/example_prediction.json
```

`ml.predict.predict_shelter(input_data)` loads the v2 artifact by default,
validates values, warns about inputs outside the training range, and returns
six predictions. Solar heat input and thermal energy loss predictions have a
zero lower bound, consistent with the supplied data checks. A future FastAPI
service can call this helper; React should call the API rather than load the
Python `.joblib` file in the browser.

## Provenance and limitations

Both compatible batches mark their rows `PHYSICS_INFORMED_ESTIMATE` and state
that the method was calibrated against three ANSYS Fluent validation cases.
Treat reported scores as agreement with these supplied estimates, not as
accuracy against 3,500 independent ANSYS cases or shelter measurements. The
63-row and 36-row files have no provenance fields and are kept out of this
fit.

The targets are per-case temperature summaries and aggregate heat quantities,
not hourly sequences. This surrogate does not generate a true 24-hour
temperature curve.
