/** Location-based hourly forecast input for the V3 hourly surrogate. */

export const OPEN_METEO_ATTRIBUTION = {
  label: 'Weather forecast by Open-Meteo',
  url: 'https://open-meteo.com/en/docs',
  license: 'CC BY 4.0',
};

// Coordinates identify the six city presets already offered by the Design page.
const WEATHER_LOCATIONS = {
  leh: { name: 'Leh, Ladakh', latitude: 34.1526, longitude: 77.5771 },
  manali: { name: 'Manali, Himachal Pradesh', latitude: 32.2432, longitude: 77.1892 },
  srinagar: { name: 'Srinagar, Jammu & Kashmir', latitude: 34.0837, longitude: 74.7973 },
  shimla: { name: 'Shimla, Himachal Pradesh', latitude: 31.1048, longitude: 77.1734 },
  jaisalmer: { name: 'Jaisalmer, Rajasthan', latitude: 26.9157, longitude: 70.9083 },
  delhi: { name: 'Delhi, NCR', latitude: 28.6139, longitude: 77.2090 },
};

const HOURLY_FIELDS = [
  'temperature_2m',
  'shortwave_radiation',
  'wind_speed_10m',
  'relative_humidity_2m',
];

function formatLocalDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function finiteNumber(value, field, index) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Forecast ${field} is missing or non-finite at profile row ${index}.`);
  }
  return value;
}

/**
 * Fetch a complete next-local-day forecast for one selected city.
 * No values are interpolated, extrapolated, or filled when the source is incomplete.
 */
export async function fetchHourlyWeatherProfile(locationId, {
  fetcher = globalThis.fetch,
  now = new Date(),
  signal,
} = {}) {
  const location = WEATHER_LOCATIONS[locationId];
  if (!location) throw new Error(`No hourly forecast location is configured for ${locationId}.`);
  if (typeof fetcher !== 'function') throw new Error('Hourly forecast fetching is unavailable in this browser.');

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set('hourly', HOURLY_FIELDS.join(','));
  url.searchParams.set('temperature_unit', 'celsius');
  url.searchParams.set('wind_speed_unit', 'ms');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '3');

  let response;
  try {
    response = await fetcher(url.toString(), {
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    throw new Error(`Open-Meteo forecast request failed: ${error?.message || 'network error'}`);
  }
  if (!response.ok) throw new Error(`Open-Meteo forecast returned HTTP ${response.status}.`);

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('Open-Meteo returned an unreadable forecast response.');
  }

  const hourly = body?.hourly;
  const timeZone = body?.timezone;
  if (!timeZone || !Array.isArray(hourly?.time)) {
    throw new Error('Open-Meteo response is missing its hourly timestamps or timezone.');
  }
  for (const field of HOURLY_FIELDS) {
    if (!Array.isArray(hourly[field]) || hourly[field].length !== hourly.time.length) {
      throw new Error(`Open-Meteo response is missing a complete ${field} series.`);
    }
  }

  const localToday = formatLocalDate(now, timeZone);
  const targetDate = [...new Set(hourly.time.map((timestamp) => String(timestamp).slice(0, 10)))]
    .find((date) => date > localToday);
  if (!targetDate) throw new Error('Open-Meteo did not return a complete future local day.');

  const indices = hourly.time
    .map((timestamp, index) => String(timestamp).startsWith(`${targetDate}T`) ? index : -1)
    .filter((index) => index >= 0);
  if (indices.length !== 24) {
    throw new Error(`Open-Meteo returned ${indices.length} hours for ${targetDate}; exactly 24 are required.`);
  }

  const displayPoints = indices.map((index, hour) => {
    const timestamp = String(hourly.time[index]);
    const clockHour = Number(timestamp.slice(11, 13));
    if (clockHour !== hour || timestamp.slice(14, 16) !== '00') {
      throw new Error(`Open-Meteo profile for ${targetDate} is not a complete midnight-to-midnight hourly day.`);
    }
    const point = {
      Hour: hour,
      localTime: timestamp,
      Outdoor_Temperature_C: finiteNumber(hourly.temperature_2m[index], 'temperature_2m', index),
      Solar_Radiation_W_m2: finiteNumber(hourly.shortwave_radiation[index], 'shortwave_radiation', index),
      Wind_Speed_m_s: finiteNumber(hourly.wind_speed_10m[index], 'wind_speed_10m', index),
      relativeHumidityPercent: finiteNumber(hourly.relative_humidity_2m[index], 'relative_humidity_2m', index),
    };
    if (point.Solar_Radiation_W_m2 < 0 || point.Wind_Speed_m_s < 0
      || point.relativeHumidityPercent < 0 || point.relativeHumidityPercent > 100) {
      throw new Error(`Open-Meteo returned an invalid climate value at ${timestamp}.`);
    }
    return point;
  });

  const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const peakSolar = Math.max(...displayPoints.map((point) => point.Solar_Radiation_W_m2));
  const hourlyClimate = displayPoints.map((point) => ({
    Hour: point.Hour,
    Outdoor_Temperature_C: point.Outdoor_Temperature_C,
    Solar_Radiation_W_m2: point.Solar_Radiation_W_m2,
    Wind_Speed_m_s: point.Wind_Speed_m_s,
  }));

  return {
    source: 'Open-Meteo Forecast API',
    sourceUrl: OPEN_METEO_ATTRIBUTION.url,
    license: OPEN_METEO_ATTRIBUTION.license,
    location: location.name,
    latitude: location.latitude,
    longitude: location.longitude,
    timezone: timeZone,
    localDate: targetDate,
    fetchedAt: new Date().toISOString(),
    hourlyClimate,
    displayPoints,
    caseClimateSummary: {
      External_Temperature_C: average(displayPoints.map((point) => point.Outdoor_Temperature_C)),
      Solar_Radiation_W_m2: peakSolar,
      // Integrate the API's preceding-hour-mean irradiance values over 24 one-hour intervals.
      Daily_Solar_Energy_kWh_m2: displayPoints.reduce((sum, point) => sum + point.Solar_Radiation_W_m2, 0) / 1000,
      Wind_Speed_m_s: average(displayPoints.map((point) => point.Wind_Speed_m_s)),
      Relative_Humidity_percent: average(displayPoints.map((point) => point.relativeHumidityPercent)),
    },
  };
}
