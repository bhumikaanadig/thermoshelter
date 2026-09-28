import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHourlyPredictionRequest, selectHourlyIndoorTemperature } from './api.js';
import { fetchHourlyWeatherProfile } from './weather.js';

const materials = {
  stone: { name: 'Stone', k: 1.7, rho: 2200, cp: 840, t: 0.3 },
  insulation: { name: 'Insulation', k: 0.035, rho: 40, cp: 1400, t: 0.05 },
  concrete: { name: 'Concrete', k: 1.4, rho: 2300, cp: 880, t: 0.1 },
};

const climates = {
  leh: { name: 'Leh, Ladakh', mean: -5, amp: 9, solar: 850, wind: 12, humidity: 32 },
};

function fakeForecastBody() {
  const times = [];
  const temperature = [];
  const solar = [];
  const wind = [];
  const humidity = [];
  for (const date of ['2026-01-10', '2026-01-11', '2026-01-12']) {
    for (let hour = 0; hour < 24; hour += 1) {
      times.push(`${date}T${String(hour).padStart(2, '0')}:00`);
      temperature.push(-18 + hour * 0.4);
      solar.push(hour >= 7 && hour <= 17 ? 420 + hour : 0);
      wind.push(1.2 + hour / 20);
      humidity.push(35 + hour / 4);
    }
  }
  return {
    timezone: 'Asia/Kolkata',
    hourly: {
      time: times,
      temperature_2m: temperature,
      shortwave_radiation: solar,
      wind_speed_10m: wind,
      relative_humidity_2m: humidity,
    },
  };
}

test('fetches a complete real-source-shaped local-day profile without filling values', async () => {
  let requestedUrl;
  const body = fakeForecastBody();
  const profile = await fetchHourlyWeatherProfile('leh', {
    now: new Date('2026-01-10T02:00:00.000Z'),
    fetcher: async (url) => {
      requestedUrl = new URL(url);
      return { ok: true, json: async () => body };
    },
  });

  assert.equal(requestedUrl.origin, 'https://api.open-meteo.com');
  assert.equal(requestedUrl.searchParams.get('wind_speed_unit'), 'ms');
  assert.equal(profile.source, 'Open-Meteo Forecast API');
  assert.equal(profile.localDate, '2026-01-11');
  assert.equal(profile.hourlyClimate.length, 24);
  assert.deepEqual(profile.hourlyClimate.map(({ Hour }) => Hour), Array.from({ length: 24 }, (_, i) => i));
  assert.equal(profile.hourlyClimate[8].Outdoor_Temperature_C, body.hourly.temperature_2m[32]);
  assert.equal(profile.hourlyClimate[8].Solar_Radiation_W_m2, body.hourly.shortwave_radiation[32]);
  assert.equal(profile.hourlyClimate[8].Wind_Speed_m_s, body.hourly.wind_speed_10m[32]);
  assert.ok(Number.isFinite(profile.caseClimateSummary.Relative_Humidity_percent));

  const incomplete = fakeForecastBody();
  incomplete.hourly.shortwave_radiation[32 + 4] = null;
  await assert.rejects(
    fetchHourlyWeatherProfile('leh', {
      now: new Date('2026-01-10T02:00:00.000Z'),
      fetcher: async () => ({ ok: true, json: async () => incomplete }),
    }),
    /missing or non-finite/,
  );
});

test('maps 21 model inputs plus design context and 24 hourly weather rows; geometry changes the request', () => {
  const hourlyClimate = Array.from({ length: 24 }, (_, Hour) => ({
    Hour,
    Outdoor_Temperature_C: -15 + Hour / 4,
    Solar_Radiation_W_m2: Hour >= 7 && Hour <= 17 ? 450 : 0,
    Wind_Speed_m_s: 2 + Hour / 30,
  }));
  const weatherProfile = {
    hourlyClimate,
    caseClimateSummary: {
      External_Temperature_C: -12.125,
      Solar_Radiation_W_m2: 467,
      Daily_Solar_Energy_kWh_m2: 4.31,
      Wind_Speed_m_s: 2.38,
      Relative_Humidity_percent: 42.5,
    },
  };
  const design = {
    location: 'leh',
    occupants: 4,
    target: 18,
    geometry: { length: 5, width: 4.8, height: 2.8, orientation: 'S', windowArea: 2.4, doorArea: 1.8 },
    layers: ['stone', 'insulation', 'concrete'],
  };
  const request = buildHourlyPredictionRequest(design, materials, climates, weatherProfile);
  const changedRequest = buildHourlyPredictionRequest({
    ...design,
    geometry: { ...design.geometry, length: 5.5 },
  }, materials, climates, weatherProfile);

  assert.equal(Object.keys(request.case_inputs).length, 22);
  assert.deepEqual(request.case_inputs.Design_Context, {
    location: 'Leh, Ladakh',
    occupants: 4,
    primary_material: 'Stone',
  });
  assert.equal(request.case_inputs.Simulation_Duration_h, 24);
  assert.equal(request.case_inputs.Time_Step_min, 30);
  assert.equal(request.case_inputs.External_Temperature_C, -12.125);
  const wallThickness = materials.stone.t + materials.insulation.t + materials.concrete.t;
  const resistance = materials.stone.t / materials.stone.k
    + materials.insulation.t / materials.insulation.k
    + materials.concrete.t / materials.concrete.k;
  const massPerArea = materials.stone.t * materials.stone.rho
    + materials.insulation.t * materials.insulation.rho
    + materials.concrete.t * materials.concrete.rho;
  const heatCapacityPerArea = materials.stone.t * materials.stone.rho * materials.stone.cp
    + materials.insulation.t * materials.insulation.rho * materials.insulation.cp
    + materials.concrete.t * materials.concrete.rho * materials.concrete.cp;
  const expectedDirectCaseInputs = {
    Material: 'Composite insulated wall',
    Material_Category: 'Composite',
    Wall_Thickness_m: 0.45,
    Shelter_Length_m: 5,
    Shelter_Width_m: 4.8,
    Shelter_Height_m: 2.8,
    Opening_Area_m2: 4.2,
    Window_Area_m2: 2.4,
    Door_Area_m2: 1.8,
    Orientation_deg: 180,
    External_Temperature_C: -12.125,
    Initial_Air_Temperature_C: 18,
    Solar_Radiation_W_m2: 467,
    Daily_Solar_Energy_kWh_m2: 4.31,
    Wind_Speed_m_s: 2.38,
    Relative_Humidity_percent: 42.5,
    Simulation_Duration_h: 24,
    Time_Step_min: 30,
  };
  for (const [field, expected] of Object.entries(expectedDirectCaseInputs)) {
    assert.equal(request.case_inputs[field], expected, `${field} mapping`);
  }
  assert.ok(Math.abs(request.case_inputs.Thermal_Conductivity_W_mK - wallThickness / resistance) < 1e-12);
  assert.ok(Math.abs(request.case_inputs.Density_kg_m3 - massPerArea / wallThickness) < 1e-12);
  assert.ok(Math.abs(request.case_inputs.Specific_Heat_J_kgK - heatCapacityPerArea / massPerArea) < 1e-12);
  assert.equal(request.hourly_climate.length, 24);
  assert.deepEqual(request.hourly_climate.map(({ Hour }) => Hour), Array.from({ length: 24 }, (_, i) => i));
  assert.deepEqual(Object.keys(request.hourly_climate[0]).sort(), [
    'Hour', 'Outdoor_Temperature_C', 'Solar_Radiation_W_m2', 'Wind_Speed_m_s',
  ]);
  assert.notEqual(
    request.case_inputs.Shelter_Length_m,
    changedRequest.case_inputs.Shelter_Length_m,
  );
  assert.notDeepEqual(request.case_inputs, changedRequest.case_inputs);
  assert.deepEqual(request.hourly_climate, changedRequest.hourly_climate);
});

test('Simulation hour selection reads the matching API temperature and rejects invalid hours', () => {
  const response = {
    hours: Array.from({ length: 24 }, (_, hour) => hour),
    predicted_indoor_temperature_C: Array.from({ length: 24 }, (_, hour) => -12 + hour * 0.75),
  };
  assert.equal(selectHourlyIndoorTemperature(response, 0), -12);
  assert.equal(selectHourlyIndoorTemperature(response, 12), -3);
  assert.equal(selectHourlyIndoorTemperature(response, 23), 5.25);
  assert.equal(selectHourlyIndoorTemperature(response, 24), null);
  assert.equal(selectHourlyIndoorTemperature({ ...response, hours: [1, ...response.hours.slice(1)] }, 0), null);
});
