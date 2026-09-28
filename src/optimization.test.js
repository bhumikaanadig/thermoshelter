import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildV3OptimizationPayloads,
  diagnoseV3Payload,
  evaluateV3CandidatePayloads,
} from './api.js';

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
  delhi: { name: 'Delhi, NCR', mean: 24, amp: 10, solar: 850, wind: 8, humidity: 55 },
};

const baseDesign = {
  location: 'leh',
  target: 18,
  geometry: { length: 5, width: 4.8, height: 2.8, orientation: 'S', windowArea: 2.4, doorArea: 1.8 },
  layers: ['stone', 'insulation', 'concrete'],
};

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
    assert.equal(Object.keys(candidate.payload).length, 21);
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
