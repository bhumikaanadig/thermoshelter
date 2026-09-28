import { V3_CATEGORICAL_VALUES, V3_NUMERIC_RANGES } from './v3TrainingRanges.js';
import { getAnonymousFirebaseIdToken } from './firebaseAuth.js';

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

const ORIENTATION_DEGREES = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

// Q1, median, and Q3 values read from the 6,500-row
// ml/artifacts/v3/combined_training_data.csv input distribution.
const V3_EMPIRICAL_SEARCH_LEVELS = {
  Wall_Thickness_m: [0.138, 0.225, 0.312],
  Shelter_Length_m: [3.75, 4.5, 5.25],
  Shelter_Width_m: [3.12, 3.75, 4.37],
  Shelter_Height_m: [2.52, 2.85, 3.17],
  Window_Area_m2: [2.28, 4.52, 6.88],
  Door_Area_m2: [1.87, 2.25, 2.62],
};
const ORIENTATION_OPTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function getApiErrorMessage(status, body) {
  const validationDetails = Array.isArray(body?.detail)
    ? body.detail.map((issue) => {
      const field = Array.isArray(issue?.loc)
        ? issue.loc.filter((part) => part !== 'body').join('.')
        : '';
      const message = typeof issue?.msg === 'string' ? issue.msg : '';
      return [field, message].filter(Boolean).join(': ');
    }).filter(Boolean).join('; ')
    : '';
  const detail = typeof body?.detail === 'string' ? body.detail : validationDetails;
  return detail || `THERMOSHELTER API request failed (${status}).`;
}

async function requestJson(path, options = {}) {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_BASE_URL is not configured.');
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Unable to connect to THERMOSHELTER API.');
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('THERMOSHELTER API returned an unreadable response.');
  }

  if (!response.ok) {
    const error = new Error(getApiErrorMessage(response.status, body));
    error.status = response.status;
    throw error;
  }

  return body;
}

async function requestPrivateJson(path, options = {}) {
  let token;
  try {
    token = await getAnonymousFirebaseIdToken();
  } catch (error) {
    throw new Error(error?.message || 'Cloud sign-in is currently unavailable.');
  }
  const send = (idToken) => requestJson(path, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${idToken}` },
  });
  try {
    return await send(token);
  } catch (error) {
    if (error?.status !== 401) throw error;
    const refreshedToken = await getAnonymousFirebaseIdToken({ forceRefresh: true });
    return send(refreshedToken);
  }
}

export function checkApiHealth() {
  return requestJson('/health');
}

export function requestV3Prediction(payload) {
  return requestJson('/predict', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function requestHourlyPrediction(payload) {
  return requestJson('/predict-hourly', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function requestMaterials() {
  return requestJson('/materials');
}

export function requestSavedDesigns() {
  return requestPrivateJson('/designs');
}

export function requestSaveDesign(payload) {
  return requestPrivateJson('/designs', { method: 'POST', body: JSON.stringify(payload) });
}

export function requestLoadDesign(designId) {
  return requestPrivateJson(`/designs/${encodeURIComponent(designId)}`);
}

export function requestDesignHistory(designId) {
  return requestPrivateJson(`/designs/${encodeURIComponent(designId)}/history`);
}

export function requestSavePrediction(payload) {
  return requestPrivateJson('/records/predictions', { method: 'POST', body: JSON.stringify(payload) });
}

export function requestSaveOptimizationRun(payload) {
  return requestPrivateJson('/records/optimization-runs', { method: 'POST', body: JSON.stringify(payload) });
}

/** Select one hourly temperature from the validated API response for the Simulation slider. */
export function selectHourlyIndoorTemperature(prediction, hour) {
  const values = prediction?.predicted_indoor_temperature_C;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23
    || !Array.isArray(prediction?.hours) || prediction.hours[hour] !== hour
    || !Array.isArray(values) || values.length !== 24
    || typeof values[hour] !== 'number' || !Number.isFinite(values[hour])) {
    return null;
  }
  return values[hour];
}

/** Map the current shelter design and a fetched weather profile to the hourly model contract. */
export function buildHourlyPredictionRequest(design, materialLibrary, climateProfiles, weatherProfile) {
  const hourlyClimate = weatherProfile?.hourlyClimate;
  const weatherSummary = weatherProfile?.caseClimateSummary;
  if (!Array.isArray(hourlyClimate) || hourlyClimate.length !== 24
    || hourlyClimate.some((point, index) => point?.Hour !== index)) {
    throw new Error('A complete weather profile for hours 0 through 23 is required.');
  }
  if (!weatherSummary) throw new Error('The selected hourly weather profile is incomplete.');

  const summaryFields = [
    'External_Temperature_C',
    'Solar_Radiation_W_m2',
    'Daily_Solar_Energy_kWh_m2',
    'Wind_Speed_m_s',
    'Relative_Humidity_percent',
  ];
  for (const field of summaryFields) {
    if (typeof weatherSummary[field] !== 'number' || !Number.isFinite(weatherSummary[field])) {
      throw new Error(`Hourly weather profile summary is missing a finite ${field} value.`);
    }
  }

  const caseInputs = buildV3Payload(
    design,
    materialLibrary,
    climateProfiles,
    weatherSummary.External_Temperature_C,
  );
  Object.assign(caseInputs, weatherSummary);

  return {
    case_inputs: caseInputs,
    hourly_climate: hourlyClimate.map(({ Hour, Outdoor_Temperature_C, Solar_Radiation_W_m2, Wind_Speed_m_s }) => ({
      Hour,
      Outdoor_Temperature_C,
      Solar_Radiation_W_m2,
      Wind_Speed_m_s,
    })),
  };
}

/** Derive the summary model's hour-zero outdoor input from the selected reference profile. */
export function getDisplayedOutdoorTemperatureForClimate(climate) {
  const hourZeroOutdoor = climate.mean + climate.amp * Math.sin(((0 - 8) / 24) * Math.PI * 2);
  return Number(hourZeroOutdoor.toFixed(1));
}

/** Report numeric extrapolation and unsupported categories without changing inputs. */
export function diagnoseV3Payload(payload) {
  const numericOutOfRange = [];
  const invalidNumericInputs = [];
  const unsupportedCategories = [];

  for (const [field, { min, max }] of Object.entries(V3_NUMERIC_RANGES)) {
    const value = payload[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      invalidNumericInputs.push({
        field,
        value: value === undefined ? 'Missing' : value,
      });
    } else if (value < min || value > max) {
      numericOutOfRange.push({
        field,
        value,
        supportedRange: `[${min}, ${max}]`,
      });
    }
  }

  for (const [field, supportedValues] of Object.entries(V3_CATEGORICAL_VALUES)) {
    const value = payload[field];
    if (!supportedValues.includes(value)) {
      unsupportedCategories.push({
        field,
        value: value === undefined ? 'Missing' : value,
        supportedRange: supportedValues.join(', '),
      });
    }
  }

  return { numericOutOfRange, invalidNumericInputs, unsupportedCategories };
}

/** Convert current Design values to 21 V3 features plus raw context for traceability. */
export function buildV3Payload(design, materialLibrary, climateProfiles, displayedOutdoorTemperature) {
  const climate = climateProfiles[design.location];
  const geometry = design.geometry;
  const selectedLayers = design.layers.map((id, index) => {
    const layer = materialLibrary[id];
    const thickness = design.layerThicknesses?.[index];
    return thickness === undefined || thickness === null
      ? layer
      : { ...layer, t: Number(thickness) };
  });

  if (!climate || selectedLayers.some((layer) => !layer)) {
    throw new Error('The selected design material or climate profile is unavailable.');
  }
  if (typeof displayedOutdoorTemperature !== 'number' || !Number.isFinite(displayedOutdoorTemperature)) {
    throw new Error('The Design page outdoor temperature is unavailable.');
  }

  // Remove binary floating-point noise from decimal layer values (e.g. 0.30 + 0.05 + 0.10).
  const wallThickness = Number(selectedLayers.reduce((sum, layer) => sum + layer.t, 0).toFixed(6));
  const totalThermalResistance = selectedLayers.reduce(
    (sum, layer) => sum + layer.t / layer.k,
    0,
  );
  const massPerArea = selectedLayers.reduce(
    (sum, layer) => sum + layer.t * layer.rho,
    0,
  );

  if (wallThickness <= 0 || totalThermalResistance <= 0 || massPerArea <= 0) {
    throw new Error('The selected wall assembly has invalid material properties.');
  }

  const primaryLayer = materialLibrary[design.layers[0]];
  const openingArea = geometry.windowArea + geometry.doorArea;
  const dailySolarEnergy = climate.solar * 0.006; // 6 equivalent full-sun hours, kWh/m²/day.
  const designContext = Number.isFinite(design.occupants)
    ? {
      location: climate.name,
      occupants: design.occupants,
      primary_material: primaryLayer.name,
    }
    : null;

  return {
    Material: selectedLayers.length > 1 ? 'Composite insulated wall' : primaryLayer.name,
    Material_Category: selectedLayers.length > 1 ? 'Composite' : 'Masonry',
    Thermal_Conductivity_W_mK: wallThickness / totalThermalResistance,
    Density_kg_m3: massPerArea / wallThickness,
    Specific_Heat_J_kgK:
      selectedLayers.reduce((sum, layer) => sum + layer.t * layer.rho * layer.cp, 0) / massPerArea,
    Wall_Thickness_m: wallThickness,
    Shelter_Length_m: geometry.length,
    Shelter_Width_m: geometry.width,
    Shelter_Height_m: geometry.height,
    Opening_Area_m2: openingArea,
    Window_Area_m2: geometry.windowArea,
    Door_Area_m2: geometry.doorArea,
    Orientation_deg: ORIENTATION_DEGREES[geometry.orientation],
    External_Temperature_C: displayedOutdoorTemperature,
    // TODO: make initial air temperature a separate user-configurable input; the current Design model has only its target control.
    Initial_Air_Temperature_C: design.target,
    Solar_Radiation_W_m2: climate.solar,
    Daily_Solar_Energy_kWh_m2: dailySolarEnergy,
    Wind_Speed_m_s: climate.wind,
    Relative_Humidity_percent: climate.humidity,
    Simulation_Duration_h: 24,
    Time_Step_min: 30,
    ...(designContext ? { Design_Context: designContext } : {}),
  };
}

function empiricalLevelsNearRange(field) {
  const { min, max } = V3_NUMERIC_RANGES[field];
  return V3_EMPIRICAL_SEARCH_LEVELS[field].filter((value) => value >= min && value <= max);
}

function roundTo(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function buildOptimizationGeometryProfiles(design) {
  const current = design.geometry;
  const currentValues = [
    ['Shelter_Length_m', current.length],
    ['Shelter_Width_m', current.width],
    ['Shelter_Height_m', current.height],
    ['Window_Area_m2', current.windowArea],
    ['Door_Area_m2', current.doorArea],
  ];
  let currentGeometrySupported = true;
  for (const [field, value] of currentValues) {
    const { min, max } = V3_NUMERIC_RANGES[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`The current ${field} value must be a finite number before searching.`);
    }
    if (value < min || value > max) currentGeometrySupported = false;
  }

  const orientations = [current.orientation, ...ORIENTATION_OPTIONS.filter((value) => value !== current.orientation)];
  if (orientations.length !== ORIENTATION_OPTIONS.length) {
    throw new Error('The current orientation is not supported by the V3 design search.');
  }

  const [lengths, widths, heights, windows, doors] = [
    'Shelter_Length_m', 'Shelter_Width_m', 'Shelter_Height_m', 'Window_Area_m2', 'Door_Area_m2',
  ].map(empiricalLevelsNearRange);
  const currentOpeningArea = current.windowArea + current.doorArea;
  const currentWallFaceArea = current.length * current.height;
  currentGeometrySupported = currentGeometrySupported
    && currentOpeningArea <= currentWallFaceArea
    && current.doorArea < currentWallFaceArea;
  const profiles = currentGeometrySupported
    ? [{ ...current, label: 'Current geometry' }]
    : [];

  // Add balanced combinations of empirical quartile levels so every
  // orientation is screened while the primary geometry factors vary together.
  // If the current geometry is outside the supported range, quartile profiles
  // cover all eight orientations and the out-of-range values are not clamped.
  for (let orientationIndex = 0; orientationIndex < orientations.length; orientationIndex += 1) {
    if (currentGeometrySupported && orientationIndex === 0) continue;
    const index = currentGeometrySupported ? orientationIndex - 1 : orientationIndex;
    const level = index % 3;
    profiles.push({
      length: lengths[level],
      width: widths[Math.floor(index / 2) % 3],
      height: heights[((index + 1) * 2) % 3],
      orientation: orientations[orientationIndex],
      windowArea: windows[(index + 1) % 3],
      doorArea: doors[(index + 2) % 3],
      label: `Training-data quartile profile ${index + 1}`,
    });
  }

  return profiles.filter((geometry) => {
    const wallFaceArea = geometry.length * geometry.height;
    const openingArea = geometry.windowArea + geometry.doorArea;
    return openingArea <= wallFaceArea && geometry.doorArea < wallFaceArea;
  });
}

function scaledLayerThicknesses(design, materialLibrary, targetThickness) {
  const layers = design.layers.map((id, index) => {
    const material = materialLibrary[id];
    const thickness = design.layerThicknesses?.[index] ?? material?.t;
    if (!material || typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness <= 0) {
      throw new Error('The current wall assembly has invalid material thicknesses.');
    }
    return { id, thickness };
  });
  const totalThickness = layers.reduce((sum, layer) => sum + layer.thickness, 0);
  if (!(totalThickness > 0)) throw new Error('The current wall assembly has no measurable thickness.');

  let assigned = 0;
  return layers.map((layer, index) => {
    const thickness = index === layers.length - 1
      ? roundTo(targetThickness - assigned, 6)
      : roundTo((layer.thickness / totalThickness) * targetThickness, 6);
    assigned += thickness;
    return thickness;
  });
}

/** Build a bounded, V3-range-checked design screen using empirical input quartiles. */
export function buildV3OptimizationPayloads(design, materialLibrary, climateProfiles) {
  const climate = climateProfiles[design.location];
  if (!climate) throw new Error('The selected climate profile is unavailable.');
  const profiles = buildOptimizationGeometryProfiles(design);
  if (!profiles.length) throw new Error('No physically usable geometry profiles were found for the V3 search.');

  const materialIds = Object.keys(materialLibrary).filter((materialId) => materialId !== 'insulation');
  const wallThicknesses = empiricalLevelsNearRange('Wall_Thickness_m');
  if (!materialIds.length || !wallThicknesses.length) {
    throw new Error('The V3 optimization search has no supported material or wall-thickness candidates.');
  }
  const displayedOutdoorTemperature = getDisplayedOutdoorTemperatureForClimate(climate);
  const candidates = [];

  for (let materialIndex = 0; materialIndex < materialIds.length; materialIndex += 1) {
    const materialId = materialIds[materialIndex];
    const layers = [materialId, 'insulation', 'concrete'];
    for (let thicknessIndex = 0; thicknessIndex < wallThicknesses.length; thicknessIndex += 1) {
      const wallThickness = wallThicknesses[thicknessIndex];
      const layerThicknesses = scaledLayerThicknesses(
        { ...design, layers },
        materialLibrary,
        wallThickness,
      );
      const pairIndex = materialIndex * wallThicknesses.length + thicknessIndex;
      const profilesPerPair = Math.min(2, profiles.length);
      for (let replicate = 0; replicate < profilesPerPair; replicate += 1) {
        const profileIndex = (pairIndex * profilesPerPair + replicate) % profiles.length;
        const geometry = profiles[profileIndex];
        const candidateDesign = { ...design, layers, layerThicknesses, geometry };
        const payload = buildV3Payload(
          candidateDesign,
          materialLibrary,
          climateProfiles,
          displayedOutdoorTemperature,
        );
        const diagnostics = diagnoseV3Payload(payload);
        if (diagnostics.invalidNumericInputs.length || diagnostics.numericOutOfRange.length
          || diagnostics.unsupportedCategories.length) continue;

        const materialName = materialLibrary[materialId].name;
        const label = `${materialName} + Insulation + Concrete · ${wallThickness.toFixed(3)} m wall · `
          + `${geometry.length} × ${geometry.width} × ${geometry.height} m · ${geometry.orientation} · `
          + `window ${geometry.windowArea} m² / door ${geometry.doorArea} m²`;
        candidates.push({
          id: `${materialId}-${wallThickness.toFixed(3)}-${profileIndex}`,
          label,
          payload,
          configuration: {
            layers: [...layers],
            layerThicknesses: [...layerThicknesses],
            geometry: {
              length: geometry.length,
              width: geometry.width,
              height: geometry.height,
              orientation: geometry.orientation,
              windowArea: geometry.windowArea,
              doorArea: geometry.doorArea,
            },
          },
          searchFactors: {
            material: materialName,
            wallThicknessM: wallThickness,
            geometryProfile: geometry.label,
          },
        });
      }
    }
  }

  if (!candidates.length) {
    throw new Error('No candidates fall within the V3 training ranges for the current design and climate.');
  }
  return candidates;
}

/** Generate the application's existing material assemblies under identical current design inputs. */
export function buildV3CandidatePayloads(design, materialLibrary, climateProfiles) {
  const climate = climateProfiles[design.location];
  if (!climate) throw new Error('The selected climate profile is unavailable.');
  const displayedOutdoorTemperature = getDisplayedOutdoorTemperatureForClimate(climate);

  return Object.keys(materialLibrary)
    .filter((materialId) => materialId !== 'insulation')
    .map((materialId) => ({
      id: materialId,
      label: `${materialLibrary[materialId].name} + Insulation + Concrete`,
      payload: buildV3Payload(
        { ...design, layers: [materialId, 'insulation', 'concrete'] },
        materialLibrary,
        climateProfiles,
        displayedOutdoorTemperature,
      ),
    }));
}

/** Evaluate candidate payloads through V3, sharing in-flight/completed requests by payload. */
export async function evaluateV3CandidatePayloads(
  candidates,
  requestCache = new Map(),
  requestPrediction = requestV3Prediction,
) {
  const results = new Array(candidates.length);
  let nextIndex = 0;
  const workerCount = Math.min(8, candidates.length);

  const evaluateCandidate = async (candidate) => {
    const diagnostics = diagnoseV3Payload(candidate.payload);
    if (diagnostics.invalidNumericInputs.length || diagnostics.unsupportedCategories.length) {
      return {
        ...candidate,
        diagnostics,
        prediction: null,
        error: diagnostics.unsupportedCategories.length
          ? 'Unsupported material/category value.'
          : 'A numeric input is missing or non-finite.',
      };
    }

    const cacheKey = JSON.stringify(candidate.payload);
    let pendingRequest = requestCache.get(cacheKey);
    if (!pendingRequest) {
      pendingRequest = requestPrediction(candidate.payload);
      requestCache.set(cacheKey, pendingRequest);
      pendingRequest.catch(() => {
        if (requestCache.get(cacheKey) === pendingRequest) requestCache.delete(cacheKey);
      });
    }

    try {
      const prediction = await pendingRequest;
      return { ...candidate, diagnostics, prediction, error: null };
    } catch (error) {
      return {
        ...candidate,
        diagnostics,
        prediction: null,
        error: error?.message || 'Unable to connect to THERMOSHELTER API.',
      };
    }
  };

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < candidates.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await evaluateCandidate(candidates[index]);
    }
  }));
  return results;
}

/** Lower means the V3 predicted average is closer to the user's target temperature. */
export function rankV3CandidatesByTarget(candidates, targetTemperatureC) {
  return candidates
    .filter((candidate) => candidate.prediction)
    .map((candidate) => ({
      ...candidate,
      targetDeviationC: Math.abs(
        candidate.prediction.predictions.Average_Air_Temperature_C - targetTemperatureC,
      ),
    }))
    .sort((left, right) => left.targetDeviationC - right.targetDeviationC);
}
