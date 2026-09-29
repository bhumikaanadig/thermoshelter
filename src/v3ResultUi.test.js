import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperationProgress, V3PredictionGrid } from './v3ResultUi.js';

const prediction = {
  input_summary: { Simulation_Duration_h: 24 },
  predictions: {
    Average_Air_Temperature_C: 18.125,
    Minimum_Air_Temperature_C: 16.5,
    Maximum_Air_Temperature_C: 20.75,
    Solar_Heat_Input_W: 430,
    Heat_Transfer_Rate_W: 125,
    Thermal_Energy_Loss_Wh: 3000,
  },
};

test('case summary renders all six actual V3 values with their labels and units', () => {
  const markup = renderToStaticMarkup(createElement(V3PredictionGrid, { prediction }));
  assert.equal((markup.match(/class="v3-prediction-value"/g) || []).length, 6);
  for (const label of [
    'Average Indoor Temperature',
    'Minimum Indoor Temperature',
    'Maximum Indoor Temperature',
    'Solar Heat Input Rate',
    'Case Heat Transfer Rate',
    'Thermal Energy Loss · 24 h case',
  ]) assert.ok(markup.includes(label), `${label} is rendered`);
  const text = markup.replace(/<[^>]*>/g, '').replace(/[\u00a0\u202f]/g, ' ');
  assert.match(text, /18[.,]13 °C/);
  assert.match(text.replaceAll(',', ''), /3000 Wh/);
});

test('operation progress renders an accessible determinate percentage and clamps its value', () => {
  const markup = renderToStaticMarkup(createElement(OperationProgress, {
    progress: { percent: 135, label: 'Connecting to thermal model — 35%' },
  }));
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /Connecting to thermal model — 100%/);
  assert.match(markup, />100%<\/span>/);
  assert.match(markup, /<progress max="100" value="100"/);
  assert.equal(renderToStaticMarkup(createElement(OperationProgress, { progress: null })), '');
});
