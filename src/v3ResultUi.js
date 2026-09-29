import { createElement } from 'react';

export function OperationProgress({ progress }) {
  if (!progress) return null;
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const label = (progress.label || 'Working…').replace(/—\s*\d+%$/, `— ${percent}%`);
  return createElement('div', {
    className: 'operation-progress',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  },
  createElement('div', { className: 'operation-progress-label' },
    createElement('span', null, label),
    createElement('span', null, `${percent}%`)),
  createElement('progress', {
    max: 100,
    value: percent,
    'aria-label': label,
  }));
}

export function v3OutputRows(prediction) {
  const duration = prediction?.input_summary?.Simulation_Duration_h;
  const period = typeof duration === 'number' && Number.isFinite(duration) && duration > 0
    ? `${duration} h case`
    : 'modeled case';
  return [
    ['Average Indoor Temperature', 'Average_Air_Temperature_C', '°C'],
    ['Minimum Indoor Temperature', 'Minimum_Air_Temperature_C', '°C'],
    ['Maximum Indoor Temperature', 'Maximum_Air_Temperature_C', '°C'],
    ['Solar Heat Input Rate', 'Solar_Heat_Input_W', 'W'],
    ['Case Heat Transfer Rate', 'Heat_Transfer_Rate_W', 'W'],
    [`Thermal Energy Loss · ${period}`, 'Thermal_Energy_Loss_Wh', 'Wh'],
  ];
}

export function V3PredictionGrid({ prediction }) {
  if (!prediction?.predictions) return null;
  return createElement('div', { className: 'v3-prediction-grid' },
    ...v3OutputRows(prediction).map(([label, key, unit]) => {
      const value = prediction.predictions[key];
      return createElement('div', { className: 'v3-prediction-value', key },
        createElement('small', null, label),
        createElement('strong', null, typeof value === 'number' && Number.isFinite(value)
          ? `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`
          : '—'));
    }));
}
