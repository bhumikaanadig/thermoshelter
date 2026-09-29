/** Location profiles used by the current V3 workflows. */
export const CLIMATE_PROFILES = Object.freeze({
  leh: { name: 'Leh, Ladakh', mean: -5, amp: 9, solar: 850, wind: 12, humidity: 32, elevation: '3,500 m', season: 'Winter reference' },
  manali: { name: 'Manali, Himachal Pradesh', mean: 5, amp: 8, solar: 720, wind: 8, humidity: 55, elevation: '2,050 m', season: 'Winter reference' },
  srinagar: { name: 'Srinagar, Jammu & Kashmir', mean: 3, amp: 8, solar: 680, wind: 10, humidity: 65, elevation: '1,585 m', season: 'Winter reference' },
  shimla: { name: 'Shimla, Himachal Pradesh', mean: 4, amp: 7, solar: 650, wind: 9, humidity: 50, elevation: '2,205 m', season: 'Winter reference' },
  jaisalmer: { name: 'Jaisalmer, Rajasthan', mean: 21, amp: 11, solar: 920, wind: 14, humidity: 20, elevation: '225 m', season: 'Summer reference' },
  delhi: { name: 'Delhi, NCR', mean: 24, amp: 10, solar: 850, wind: 8, humidity: 55, elevation: '216 m', season: 'Reference' },
  bengaluru: {
    name: 'Bengaluru, Karnataka',
    elevation: '920 m',
    season: 'Next-day forecast',
    forecastBacked: true,
  },
});

export function usesForecastBackedClimate(locationId, profiles = CLIMATE_PROFILES) {
  return profiles[locationId]?.forecastBacked === true;
}
