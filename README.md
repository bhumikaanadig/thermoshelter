# THERMOSHELTER 

SMART INDIA HACKATHON - 2026
PS : Software Based Model Development for Design of Area Specific Shelter for Thermal Comfort Maintenance.

LIVE LINK 
https://thermoshelter.netlify.app

## Run in VS Code

1. Extract this ZIP.
2. Open the extracted `THERMOSHELTER` folder in VS Code.
3. Open Terminal in that folder.
4. Run:

```bash
npm install
npm run dev
```

5. Open the localhost URL shown by Vite.

## Included

- React + Vite single web application
- Interactive 3D shelter model with Three.js / React Three Fiber
- Shelter configuration workflow
- Reference climate profiles for the six-output summary workflow
- Material library
- Separate V3 summary and hourly surrogate workflows
- Forecast-driven 24-hour indoor-temperature visualization
- Design comparison
- Parametric optimization and recommendation
- ANSYS evidence / validation workflow page
- Engineering report / print view

## ANSYS status

The V3 web predictions use the existing surrogate artifacts and physics-informed training estimates; they do not launch ANSYS. The Design page's 3D view is a geometry preview only and does not display a calculated temperature or heat-flow field. Saved ANSYS result images are reference evidence, not results recalculated for the current inputs. The V3 dataset report documents three ANSYS Fluent calibration cases; the 6,500 training rows are not 6,500 ANSYS runs or field measurements.

## V3 FastAPI surrogate backend

The local FastAPI service loads `ml/artifacts/v3/thermal_surrogate_v3.joblib` through `ml/predict_v3.py` for six case-level summary outputs. `Solar_Heat_Input_W` is a predicted rate in W, `Heat_Transfer_Rate_W` is a single case-level rate in W, and `Thermal_Energy_Loss_Wh` is an aggregate for `Simulation_Duration_h` (the Design workflow currently sends 24 h). The 6,500 V3 source rows span 6–48 h; their `Thermal_Energy_Loss_Wh` values reconcile with `max(0, -Heat_Transfer_Rate_W × Simulation_Duration_h)` to within 0.052 Wh, consistent with rounding. The source data does not define `Solar_Heat_Input_W` as an average over that duration, and its case-level values do not reconcile with the hourly solar-input rows in the transient subset. Multiplying that rate by the duration would therefore assume unsupported constant input, so no solar-energy Wh output is produced.

The source workbooks contain 6,240 hourly records (260 complete 24-hour case sequences) with wall temperature, hourly heat-transfer rate, and hourly solar-input fields. These are physics-informed estimates, not independently verified ANSYS runs or field measurements. The hourly surrogate's only target is `Indoor_Temperature_C`; it explicitly excludes those three fields, and its API returns 24 indoor-temperature predictions only. The available hourly heat and wall values are not predictions for arbitrary current designs or supplied forecast weather, so no hourly heat-flow series is presented. Neither surrogate executes ANSYS.

The case summary uses the selected static reference climate profile. Its external temperature is derived from the profile's mean and daily swing at hour 0; daily solar energy is derived from peak profile radiation using the existing six-equivalent-full-sun-hours assumption. The hourly workflow instead requests actual next-day forecast values from Open-Meteo. The Design target currently also supplies `Initial_Air_Temperature_C`; occupant count is stored as design context but is not a V3/hourly model feature. The current V3 input builder represents the selected primary material plus the fixed insulation and concrete layers as effective composite wall properties.

From the `THERMOSHELTER` project root, install the backend dependencies and start the API:

```powershell
python -m pip install -r api/requirements.txt
python -m uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
```

The API provides `GET /health`, `POST /predict`, and `POST /predict-hourly`. CORS allows local Vite development origins on ports 5173 and 4173. Start the frontend with `npm run dev`; `.env.local` points it at `http://127.0.0.1:8000`. To run the API checks in another terminal:

```powershell
python api/test_api.py --base-url http://127.0.0.1:8000
python api/test_hourly_api.py --base-url http://127.0.0.1:8000
python api/test_persistence.py
```

## V3 optimization screen

The Optimize page evaluates a balanced screen through the existing `POST /predict` endpoint. The default screen targets 36 candidates: six primary material choices, three wall thickness levels (Q1, median, and Q3 from the V3 training inputs), and two geometry/orientation profiles per material and thickness pair. The profile set uses the current geometry when it is in range, plus training-data quartile profiles for dimensions and openings; it covers the existing orientations across the set where the opening and wall-face checks permit. Each total wall thickness scales the current layer proportions. An out-of-range current geometry is left out rather than clamped. Climate and target inputs stay fixed. Candidates outside recorded V3 input ranges or with openings larger than a wall face are omitted. Results are ranked by `|V3 Average_Air_Temperature_C − target|`; the search is a transparent surrogate screen, not a global or engineering optimum. The labels are physics-informed estimates calibrated against three ANSYS Fluent cases, and the browser search does not run ANSYS.

The Simulation page obtains the next complete local calendar day's hourly weather forecast for the selected city from the Open-Meteo Forecast API. It sends all 24 hourly outdoor-temperature, shortwave-radiation, and 10 m wind-speed values with the 21 shelter case inputs to `/predict-hourly`. If the forecast is unavailable or incomplete, the page shows an error and does not synthesize a replacement curve. The hourly model predicts indoor temperature only; the page does not derive hourly heat-flow outputs from that curve.

The page labels the source and forecast date and provides Open-Meteo attribution. Open-Meteo weather data is under CC BY 4.0; its free API is for non-commercial use. Confirm the provider's current [terms](https://open-meteo.com/en/terms) before using the hosted service in a commercial deployment.

Run the frontend payload and weather-profile checks with:

```powershell
npm test
npm run build
```

## Firebase / Firestore persistence

Persistence follows **React → Firebase Authentication → FastAPI → Firebase Admin SDK → Cloud Firestore**. The browser signs in anonymously without a login form and sends a Firebase ID token only to private persistence endpoints. FastAPI verifies the token with Firebase Admin, derives the UID from verified claims, and applies that UID to every private read/write. Client-supplied owner IDs are rejected by request validation and are never trusted. The browser never accesses Firestore directly.

The small browser auth module uses Firebase Authentication's supported anonymous sign-up and token-refresh endpoints. It keeps the anonymous refresh token in browser local storage so saved designs remain associated with the same anonymous UID after a reload; ID tokens are held in memory and sent over HTTPS to the API. No Firebase Admin key, service-account JSON, or server credential is included in the bundle.

### Firestore collections

- `materials/{materialId}`: the existing seven catalog items (`stone`, `brick`, `concrete`, `adobe`, `rammed`, `timber`, `insulation`), with `name`, `category`, `k`, `rho`, `cp`, default thickness `t`, `alpha`, source/reference notes, and timestamps. Existing project values are preserved; no new values or citations are invented. Re-running the seed creates only missing IDs and does not overwrite existing records.
- `designs/{designId}`: `owner_uid`, display name, `saved`, full input snapshot (location, geometry, openings/orientation, occupants, target, layer IDs and thicknesses), climate context, material property snapshot, optional weather metadata, and `created_at`/`updated_at`. Prediction-only scenarios use `saved: false` and remain private to their owner.
- `predictions/{predictionId}`: `owner_uid`, saved design/scenario reference, `model_version: V3`, model label, input snapshot, six actual V3 outputs, diagnostics, and creation time.
- `hourlyPredictions/{predictionId}`: `owner_uid`, design/scenario reference, `model_version: V3-Hourly-v1`, model label `V3 Hourly Surrogate`, input snapshot, the actual 24 indoor-temperature values, forecast/profile metadata, diagnostics, and creation time.
- `optimizationRuns/{runId}`: `owner_uid`, design/scenario reference, search scope, candidate count, candidate configurations and returned V3 results, metric, selected candidate, and creation time. It is a surrogate design-space search record, not an engineering optimum.

`firestore.indexes.json` defines the compound indexes used for UID-scoped listing/history. `firestore.rules` denies all browser-side Firestore access; Admin SDK requests bypass those rules and are protected by backend ID-token verification and owner filtering.

### Firebase project setup

1. In Firebase Console, select the existing THERMOSHELTER project (`thermoshelter-df048`) and its default Cloud Firestore database. Use that project ID for browser and API configuration; do not create a duplicate project.
2. In **Authentication → Sign-in method**, enable **Anonymous**.
3. In **Project settings → General**, register a Web app and copy its public Web App configuration values. Put them in the repository root `.env.local` (start from `.env.example`). These values are public client configuration, not Admin credentials. Restrict the API key to the required Firebase APIs and the deployed website referrers where supported.
4. Configure the API host's Google Application Default Credentials. On Google Cloud, prefer a dedicated runtime service account attached to the service. Grant only the Firestore data role needed by this API (normally `roles/datastore.user`). For local development, use your approved ADC login or a dedicated service-account key stored outside the repository and set `GOOGLE_APPLICATION_CREDENTIALS` to its path. Never place it under `src/`, `public/`, or any Vite-exposed directory.
5. Configure the **backend process only** from `api/.env.example` or its process environment. Required values are `FIREBASE_PROJECT_ID` and `THERMOSHELTER_FIRESTORE_ENABLED=true`; credentials come from ADC or `GOOGLE_APPLICATION_CREDENTIALS`. `THERMOSHELTER_CORS_ORIGINS` is optional and should contain the exact frontend origins. There is no unauthenticated persistence switch.
6. Apply the deny-by-default Firestore rules and indexes to the project using the Firebase CLI or Firebase Console. This only configures Firestore rules/indexes; it does not deploy the website:

   ```powershell
   firebase deploy --only firestore:rules,firestore:indexes
   ```

7. With the backend environment loaded, seed the original catalog. This operation is repeatable and leaves already-present material documents untouched:

   ```powershell
   python -m api.seed_materials
   ```

The API returns the local catalog if Firestore materials are empty, unavailable, or malformed. The app keeps working and shows a material fallback notice; private persistence fails closed with a simple unavailable message.

### Environment variables

**Frontend** (`.env.local`, public Web App settings only):

- `VITE_API_BASE_URL`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

**Backend** (API process only):

- `FIREBASE_PROJECT_ID`
- `THERMOSHELTER_FIRESTORE_ENABLED=true`
- `GOOGLE_APPLICATION_CREDENTIALS` (optional when managed identity/ADC is available)
- `THERMOSHELTER_CORS_ORIGINS` (optional)

For the live acceptance script only, pass the public Web API key as `THERMOSHELTER_FIREBASE_TEST_API_KEY` (or reuse `VITE_FIREBASE_API_KEY`) and set `THERMOSHELTER_FIREBASE_TEST_ORIGIN` to an origin allowed by the Web API key. Do not set any server credential in a `VITE_` variable. `.env.local`, `.env`, and credential files are ignored by Git.

### Start and test

Start the API and frontend from the repository root using the existing instructions above. For local regression checks:

```powershell
python api/test_persistence.py
python api/test_api.py --base-url http://127.0.0.1:8000
python api/test_hourly_api.py --base-url http://127.0.0.1:8000
npm test
npm run build
```

For a **real cloud acceptance test**, configure Anonymous sign-in, Firestore, the public test API key, and Admin ADC first, then run:

```powershell
python api/test_firebase_cloud.py
```

The script verifies Admin initialization, anonymous sign-in and token refresh, seeds and checks the existing material IDs, and writes and reads a disposable design. It uses the application's V3 and hourly payload builders, fetches a real 24-hour Open-Meteo forecast, runs the existing 36-candidate V3 search, and compares stored records with their source responses. It also checks two-user isolation and history retrieval. It deletes only temporary records and anonymous accounts created by the run; seeded materials remain. The test runner identity needs permission to delete those temporary Firebase Auth users. The script stops before remote writes when project configuration or credentials are unavailable.

The private FastAPI routes are `GET/POST /designs`, `GET /designs/{design_id}`, `GET /designs/{design_id}/history`, `POST /records/predictions`, and `POST /records/optimization-runs`; they require `Authorization: Bearer <Firebase ID token>`. `GET /materials`, `/health`, `/predict`, and `/predict-hourly` remain public and unchanged. CORS allows `Authorization` for configured frontend origins; CORS is not an authorization mechanism.

### Failure behavior and production notes

Invalid or expired ID tokens return 401; the browser refreshes once and retries. Missing Firebase setup, Admin credentials, network access, or Firestore access returns a generic 503 for private persistence, without exposing stack traces. A failed save does not discard a successful current prediction or optimization result. Materials continue from the existing local catalog if the cloud catalog is unavailable. Missing or cross-owner saved IDs return the same not-found result so one UID cannot discover another UID's documents. Summary, hourly, and optimization history remain labeled saved/historical and are displayed separately from current results. Editing a design clears the current prediction.

The repository intentionally contains only example configuration, not real Web App keys or Admin credentials. Keep public Web App settings in the ignored `.env.local` file and keep server credentials outside the repository. Run `api/test_firebase_cloud.py` from a process that has the intended project's backend configuration before treating cloud persistence as verified. The script checks that the project ID is `thermoshelter-df048` and that the live operations succeed; a local or in-memory test alone is not cloud verification.
