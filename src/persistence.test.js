import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDesignSnapshot,
  latestHistoricalHourly,
  latestHistoricalSummary,
  normalizeMaterialLibrary,
  restoreSavedDesign,
} from './persistence.js';
import { FALLBACK_MATERIALS } from './materials.js';
import { getAnonymousFirebaseIdToken } from './firebaseAuth.js';
import { isFirebaseAnonymousAuthConfigured } from './firebaseConfig.js';

const design = {
  location: 'leh',
  occupants: 4,
  target: 18,
  priority: 'comfort',
  geometry: { length: 5, width: 4.8, height: 2.8, orientation: 'S', windowArea: 2.4, doorArea: 1.8 },
  layers: ['stone', 'insulation', 'concrete'],
  layerThicknesses: null,
};

test('material response normalization preserves the original catalog properties', () => {
  const normalized = normalizeMaterialLibrary({ materials: FALLBACK_MATERIALS, source: 'local_fallback' });
  assert.deepEqual(Object.keys(normalized).sort(), Object.keys(FALLBACK_MATERIALS).sort());
  assert.equal(normalized.stone.k, 1.70);
  assert.equal(normalized.insulation.t, 0.05);
});

test('design snapshot and restore preserve every model input and material layer', () => {
  const climate = { name: 'Leh, Ladakh', mean: -5 };
  const snapshot = buildDesignSnapshot(design, climate, FALLBACK_MATERIALS);
  const restored = restoreSavedDesign({ id: 'saved-1', design: { inputs: snapshot.design } }, FALLBACK_MATERIALS);
  assert.deepEqual(restored.design, design);
  assert.equal(restored.designId, 'saved-1');
  assert.deepEqual(snapshot.materials, {
    stone: FALLBACK_MATERIALS.stone,
    insulation: FALLBACK_MATERIALS.insulation,
    concrete: FALLBACK_MATERIALS.concrete,
  });
});

test('invalid persisted material references fail instead of restoring a partial design', () => {
  const bad = { ...design, layers: ['missing-material'] };
  assert.throws(() => restoreSavedDesign({ id: 'bad', design: { inputs: bad } }, FALLBACK_MATERIALS), /unavailable materials/);
  assert.throws(() => restoreSavedDesign(
    { id: 'bad-location', design: { inputs: design } },
    FALLBACK_MATERIALS,
    ['manali'],
  ), /incomplete|unavailable materials/);
});

test('historical summary selection remains separate from the current result', () => {
  const history = {
    predictions: [
      { id: 'hourly', prediction_kind: 'hourly', model_version: 'V3-Hourly-v1', result: {} },
      { id: 'summary', prediction_kind: 'summary', model_version: 'V3', result: { predictions: { Average_Air_Temperature_C: 17.2 } } },
    ],
  };
  const historical = latestHistoricalSummary(history);
  const current = { predictions: { Average_Air_Temperature_C: 18.4 } };
  assert.equal(historical.id, 'summary');
  assert.equal(historical.prediction.predictions.Average_Air_Temperature_C, 17.2);
  assert.equal(current.predictions.Average_Air_Temperature_C, 18.4);
});

test('hourly history selects a complete saved V3 curve and ignores malformed records', () => {
  const record = {
    id: 'hourly-1',
    model_version: 'V3-Hourly-v1',
    result: { hours: Array.from({ length: 24 }, (_, hour) => hour), predicted_indoor_temperature_C: Array(24).fill(18.5) },
  };
  const history = {
    hourly_predictions: [
      { id: 'broken', model_version: 'V3-Hourly-v1', result: { predicted_indoor_temperature_C: [18] } },
      record,
    ],
  };
  const historical = latestHistoricalHourly(history);
  assert.equal(historical.id, 'hourly-1');
  assert.equal(historical.prediction.predicted_indoor_temperature_C.length, 24);
});

test('missing public Firebase config fails closed without crashing the application', async () => {
  assert.equal(isFirebaseAnonymousAuthConfigured(), false);
  await assert.rejects(getAnonymousFirebaseIdToken(), /Cloud saving is not set up/);
});
