import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildV3Payload,
  buildV3CandidatePayloads,
  buildV3OptimizationPayloads,
  diagnoseV3Payload,
  evaluateV3CandidatePayloads,
  getApiErrorMessage,
  getDisplayedOutdoorTemperatureForClimate,
  scaleV3WallThickness,
} from './api.js';
import { CLIMATE_PROFILES, usesForecastBackedClimate } from './climateProfiles.js';

const materials = {
  stone: { name: 'Stone', k: 1.7, rho: 2200, cp: 840, t: 0.3 },
  brick: { name: 'Brick', k: 0.72, rho: 1800, cp: 840, t: 0.2 },
  concrete: { name: 'Concrete', k: 1.4, rho: 2300, cp: 880, t: 0.1 },
  adobe: { name: 'Adobe', k: 0.43, rho: 1600, cp: 900, t: 0.3 },
  rammed: { name: 'Rammed Earth', k: 0.8, rho: 2000, cp: 900, t: 0.3 },
  timber: { name: 'Timber', k: 0.13, rho: 550, cp: 1600, t: 0.1 },
  insulation: { name: 'Insulation', k: 0.035, rho: 40, cp: 1400, t: 0.05 },
};

const climates = {
  leh: { name: 'Leh, Ladakh', mean: -5, amp: 9, solar: 850, wind: 12, humidity: 32 },
  manali: { name: 'Manali, Himachal Pradesh', mean: 5, amp: 8, solar: 720, wind: 8, humidity: 55 },
  srinagar: { name: 'Srinagar, Jammu & Kashmir', mean: 3, amp: 8, solar: 680, wind: 10, humidity: 65 },
  delhi: { name: 'Delhi, NCR', mean: 24, amp: 10, solar: 850, wind: 8, humidity: 55 },
};

const baseDesign = {
  location: 'leh',
  occupants: 4,
  target: 18,
  geometry: { length: 5, width: 4.8, height: 2.8, orientation: 'S', windowArea: 2.4, doorArea: 1.8 },
  layers: ['stone', 'insulation', 'concrete'],
};

test('builds V3 requests from varied current inputs without clamping observed-range extrapolation', () => {
  const scenarios = [
    {
      location: 'leh', target: 18, material: 'stone',
      geometry: { length: 6, width: 5, height: 4, orientation: 'E', windowArea: 2.5, doorArea: 2 },
    },
    {
      location: 'manali', target: 20, material: 'brick',
      geometry: { length: 4, width: 3, height: 2.5, orientation: 'N', windowArea: 1.6, doorArea: 1.8 },
    },
    {
      location: 'delhi', target: 22, material: 'concrete',
      geometry: { length: 8, width: 6, height: 3, orientation: 'W', windowArea: 3.3, doorArea: 2 },
    },
    {
      location: 'srinagar', target: 16.5, material: 'timber',
      geometry: { length: 5.5, width: 4.2, height: 3.2, orientation: 'NW', windowArea: 2.8, doorArea: 2.2 },
    },
  ];

  const payloads = scenarios.map((scenario) => {
    const climate = climates[scenario.location];
    const design = {
      ...baseDesign,
      location: scenario.location,
      target: scenario.target,
      geometry: scenario.geometry,
      layers: [scenario.material, 'insulation', 'concrete'],
    };
    const payload = buildV3Payload(
      design,
      materials,
      climates,
      getDisplayedOutdoorTemperatureForClimate(climate),
    );

    assert.equal(payload.Shelter_Length_m, scenario.geometry.length);
    assert.equal(payload.Shelter_Width_m, scenario.geometry.width);
    assert.equal(payload.Shelter_Height_m, scenario.geometry.height);
    assert.equal(payload.Window_Area_m2, scenario.geometry.windowArea);
    assert.equal(payload.Door_Area_m2, scenario.geometry.doorArea);
    assert.equal(payload.Opening_Area_m2, scenario.geometry.windowArea + scenario.geometry.doorArea);
    assert.equal(payload.Orientation_deg, { N: 0, E: 90, W: 270, NW: 315 }[scenario.geometry.orientation]);
    assert.equal(payload.Initial_Air_Temperature_C, scenario.target);
    assert.equal(payload.External_Temperature_C, getDisplayedOutdoorTemperatureForClimate(climate));
    assert.equal(payload.Solar_Radiation_W_m2, climate.solar);
    assert.deepEqual(diagnoseV3Payload(payload).invalidNumericInputs, []);
    assert.deepEqual(diagnoseV3Payload(payload).unsupportedCategories, []);
    assert.equal(Object.keys(payload).length, 22);
    assert.deepEqual(payload.Design_Context, {
      location: climate.name,
      occupants: 4,
      primary_material: materials[scenario.material].name,
    });
    return payload;
  });

  assert.notEqual(payloads[0].Thermal_Conductivity_W_mK, payloads[1].Thermal_Conductivity_W_mK);
  assert.notEqual(payloads[0].Initial_Air_Temperature_C, payloads[2].Initial_Air_Temperature_C);
  assert.notEqual(payloads[0].External_Temperature_C, payloads[1].External_Temperature_C);
  assert.ok(diagnoseV3Payload(payloads[0]).numericOutOfRange.some(({ field }) => field === 'Wall_Thickness_m'));
  assert.ok(diagnoseV3Payload(payloads[0]).numericOutOfRange.some(({ field }) => field === 'Shelter_Height_m'));
  assert.ok(diagnoseV3Payload(payloads[2]).numericOutOfRange.some(({ field }) => field === 'Shelter_Length_m'));
  assert.ok(diagnoseV3Payload(payloads[2]).numericOutOfRange.some(({ field }) => field === 'Shelter_Width_m'));

  const changedLength = buildV3Payload(
    { ...baseDesign, geometry: { ...baseDesign.geometry, length: 7 } },
    materials,
    climates,
    getDisplayedOutdoorTemperatureForClimate(climates.leh),
  );
  assert.equal(changedLength.Shelter_Length_m, 7);
  assert.equal(changedLength.Design_Context.occupants, 4);
  assert.ok(diagnoseV3Payload(changedLength).numericOutOfRange.some(({ field }) => field === 'Shelter_Length_m'));
  assert.deepEqual(diagnoseV3Payload(changedLength).invalidNumericInputs, []);
});

test('turns FastAPI validation errors into useful field-specific UI messages', () => {
  assert.equal(
    getApiErrorMessage(422, {
      detail: [{ loc: ['body', 'Shelter_Height_m'], msg: 'Input should be greater than 0' }],
    }),
    'Shelter_Height_m: Input should be greater than 0',
  );
  assert.equal(getApiErrorMessage(503, { detail: 'V3 inference is temporarily unavailable.' }),
    'V3 inference is temporarily unavailable.');
  assert.equal(getApiErrorMessage(502, {}), 'THERMOSHELTER API request failed (502).');
});

test('scales the full existing layer assembly to a requested total wall thickness', () => {
  for (const [material, requested] of [['stone', 0.3], ['brick', 0.23]]) {
    const layers = [material, 'insulation', 'concrete'];
    const scaled = scaleV3WallThickness({ ...baseDesign, layers }, materials, requested);
    assert.equal(scaled.length, 3);
    assert.ok(Math.abs(scaled.reduce((sum, value) => sum + value, 0) - requested) < 1e-6);
    assert.ok(scaled.every((value) => value > 0));
  }
  assert.throws(() => scaleV3WallThickness(baseDesign, materials, 0), /greater than zero/);
});

test('Bengaluru uses complete forecast inputs and preserves Case B context and extrapolation', () => {
  const climateOverride = {
    External_Temperature_C: 24.2,
    Solar_Radiation_W_m2: 910,
    Daily_Solar_Energy_kWh_m2: 5.6,
    Wind_Speed_m_s: 2.7,
    Relative_Humidity_percent: 61.5,
  };
  const design = {
    location: 'bengaluru',
    occupants: 6,
    target: 22,
    geometry: { length: 8, width: 6, height: 3.2, orientation: 'S', windowArea: 4.5, doorArea: 2.4 },
    layers: ['brick', 'insulation', 'concrete'],
    layerThicknesses: scaleV3WallThickness(
      { ...baseDesign, layers: ['brick', 'insulation', 'concrete'] },
      materials,
      0.23,
    ),
  };
  assert.equal(CLIMATE_PROFILES.bengaluru.name, 'Bengaluru, Karnataka');
  assert.equal(usesForecastBackedClimate('bengaluru'), true);
  const payload = buildV3Payload(design, materials, CLIMATE_PROFILES, climateOverride.External_Temperature_C, climateOverride);
  assert.deepEqual(payload.Design_Context, {
    location: 'Bengaluru, Karnataka',
    occupants: 6,
    primary_material: 'Brick',
  });
  assert.equal(payload.Wall_Thickness_m, 0.23);
  assert.equal(payload.Shelter_Length_m, 8);
  assert.equal(payload.Shelter_Width_m, 6);
  assert.equal(payload.Shelter_Height_m, 3.2);
  assert.equal(payload.Window_Area_m2, 4.5);
  assert.equal(payload.Door_Area_m2, 2.4);
  assert.equal(payload.Orientation_deg, 180);
  assert.equal(payload.Initial_Air_Temperature_C, 22);
  for (const [field, expected] of Object.entries(climateOverride)) assert.equal(payload[field], expected);
  assert.ok(diagnoseV3Payload(payload).numericOutOfRange.some(({ field }) => field === 'Shelter_Length_m'));
  assert.ok(diagnoseV3Payload(payload).numericOutOfRange.some(({ field }) => field === 'Shelter_Width_m'));

  const candidates = buildV3CandidatePayloads(design, materials, CLIMATE_PROFILES, climateOverride);
  assert.equal(candidates.length, 6);
  assert.ok(candidates.every(({ payload: candidate }) => candidate.External_Temperature_C === 24.2
    && candidate.Solar_Radiation_W_m2 === 910
    && candidate.Wind_Speed_m_s === 2.7
    && candidate.Relative_Humidity_percent === 61.5));
  const optimization = buildV3OptimizationPayloads(design, materials, CLIMATE_PROFILES, climateOverride);
  assert.equal(optimization.length, 36);
  assert.ok(optimization.every(({ payload: candidate }) => candidate.External_Temperature_C === 24.2
    && candidate.Daily_Solar_Energy_kWh_m2 === 5.6));
});

test('builds a transparent V3 search across materials, empirical thickness levels, and orientations', () => {
  const candidates = buildV3OptimizationPayloads(baseDesign, materials, climates);

  assert.equal(candidates.length, 6 * 3 * 2);
  assert.equal(new Set(candidates.map(({ id }) => id)).size, candidates.length);
  const materialThicknessPairs = new Map();
  for (const candidate of candidates) {
    const pairKey = candidate.id.replace(/-\d+$/, '');
    const orientations = materialThicknessPairs.get(pairKey) || new Set();
    orientations.add(candidate.payload.Orientation_deg);
    materialThicknessPairs.set(pairKey, orientations);
  }
  assert.equal(materialThicknessPairs.size, 6 * 3);
  for (const orientations of materialThicknessPairs.values()) assert.equal(orientations.size, 2);
  assert.deepEqual(
    [...new Set(candidates.map(({ payload }) => payload.Orientation_deg))].sort((a, b) => a - b),
    [0, 45, 90, 135, 180, 225, 270, 315],
  );
  assert.deepEqual(
    [...new Set(candidates.map(({ payload }) => payload.Wall_Thickness_m))].sort((a, b) => a - b),
    [0.138, 0.225, 0.312],
  );

  for (const candidate of candidates) {
    assert.equal(Object.keys(candidate.payload).filter((field) => field !== 'Design_Context').length, 21);
    assert.deepEqual(candidate.payload.Design_Context, {
      location: climates.leh.name,
      occupants: 4,
      primary_material: materials[candidate.configuration.layers[0]].name,
    });
    assert.deepEqual(diagnoseV3Payload(candidate.payload), {
      numericOutOfRange: [],
      invalidNumericInputs: [],
      unsupportedCategories: [],
    });
    assert.ok(Math.abs(
      candidate.configuration.layerThicknesses.reduce((sum, value) => sum + value, 0)
      - candidate.payload.Wall_Thickness_m,
    ) < 1e-6);
    assert.match(candidate.label, /m wall · .*window .* m² \/ door .* m²/);
  }
});

test('limits parallel candidate requests to eight', async () => {
  const candidates = buildV3OptimizationPayloads(baseDesign, materials, climates);
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  let requestCount = 0;
  const requestPrediction = async (payload) => {
    activeRequests += 1;
    requestCount += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeRequests -= 1;
    return { predictions: { Average_Air_Temperature_C: payload.Shelter_Length_m } };
  };

  const results = await evaluateV3CandidatePayloads(candidates, new Map(), requestPrediction);
  assert.equal(results.length, 36);
  assert.equal(requestCount, 36);
  assert.equal(maximumActiveRequests, 8);
});

test('candidate evaluation reports settled candidate counts and forwards API readiness stages', async () => {
  const candidates = buildV3CandidatePayloads(baseDesign, materials, climates).slice(0, 2);
  const completed = [];
  const apiStages = [];
  const rows = await evaluateV3CandidatePayloads(candidates, new Map(), async (_payload, { onProgress }) => {
    onProgress?.({ phase: 'recovering', percent: 35, label: 'Waiting for the thermal API — 35%' });
    return { predictions: { Average_Air_Temperature_C: 18 } };
  }, {
    onCandidateComplete: (progress) => completed.push(progress),
    onApiProgress: (progress) => apiStages.push(progress.phase),
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(completed.map(({ completed: count, total }) => [count, total]), [[1, 2], [2, 2]]);
  assert.equal(apiStages.length, 2);
  assert.ok(apiStages.every((phase) => phase === 'recovering'));
});

test('changing user geometry, target, or climate changes the generated V3 candidate inputs', () => {
  const baseline = buildV3OptimizationPayloads(baseDesign, materials, climates);
  const changedDesign = buildV3OptimizationPayloads({
    ...baseDesign,
    target: 20,
    location: 'delhi',
    geometry: { ...baseDesign.geometry, length: 5.5 },
  }, materials, climates);
  const baselineById = new Map(baseline.map((candidate) => [candidate.id, candidate]));
  const changedById = new Map(changedDesign.map((candidate) => [candidate.id, candidate]));
  const id = 'stone-0.138-0';

  assert.equal(changedById.size, baselineById.size);
  assert.notEqual(
    baselineById.get(id).payload.Shelter_Length_m,
    changedById.get(id).payload.Shelter_Length_m,
  );
  assert.notEqual(
    baselineById.get(id).payload.Initial_Air_Temperature_C,
    changedById.get(id).payload.Initial_Air_Temperature_C,
  );
  assert.notEqual(
    baselineById.get(id).payload.External_Temperature_C,
    changedById.get(id).payload.External_Temperature_C,
  );
});

test('an out-of-range current geometry is omitted without clamping quartile candidates', () => {
  const candidates = buildV3OptimizationPayloads({
    ...baseDesign,
    geometry: { ...baseDesign.geometry, length: 7.25 },
  }, materials, climates);

  assert.equal(candidates.length, 36);
  assert.ok(candidates.every(({ payload }) => payload.Shelter_Length_m <= 6));
  assert.ok(candidates.every(({ configuration }) => configuration.geometry.length !== 7.25));
  assert.deepEqual(
    [...new Set(candidates.map(({ payload }) => payload.Orientation_deg))].sort((a, b) => a - b),
    [0, 45, 90, 135, 180, 225, 270, 315],
  );
});

test('passes changed candidate inputs through the shared V3 evaluator', async () => {
  const candidate = buildV3OptimizationPayloads(baseDesign, materials, climates)[0];
  const changedCandidate = buildV3OptimizationPayloads({
    ...baseDesign,
    geometry: { ...baseDesign.geometry, length: 5.5 },
  }, materials, climates)[0];
  const requestedLengths = [];
  const requestPrediction = async (payload) => {
    requestedLengths.push(payload.Shelter_Length_m);
    return {
      model_version: 'V3',
      input_summary: payload,
      predictions: {
        Average_Air_Temperature_C: payload.Shelter_Length_m,
        Minimum_Air_Temperature_C: payload.Shelter_Length_m - 1,
        Maximum_Air_Temperature_C: payload.Shelter_Length_m + 1,
        Solar_Heat_Input_W: 100,
        Heat_Transfer_Rate_W: 25,
        Thermal_Energy_Loss_Wh: 500,
      },
      warnings: [],
    };
  };

  const [baselineResult, changedResult] = await Promise.all([
    evaluateV3CandidatePayloads([candidate], new Map(), requestPrediction),
    evaluateV3CandidatePayloads([changedCandidate], new Map(), requestPrediction),
  ]);
  assert.ok(baselineResult[0].prediction);
  assert.ok(changedResult[0].prediction);
  assert.deepEqual(requestedLengths, [5, 5.5]);
  assert.notEqual(
    baselineResult[0].prediction.predictions.Average_Air_Temperature_C,
    changedResult[0].prediction.predictions.Average_Air_Temperature_C,
  );
});
