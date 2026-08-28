import type { WalkWeather } from '../walkStory';

export type WalkWeatherLevel = 'good' | 'caution' | 'avoid';

export interface WalkWeatherOutlook {
  level: WalkWeatherLevel;
  label: 'Good to go' | 'Take care' | 'Stay in';
}

const SEVERE_CODES = new Set([56, 57, 65, 66, 67, 75, 82, 86]);
const CAUTION_CODES = new Set([
  45, 48, // fog
  51, 53, 55, // drizzle
  61, 63, 71, 73, 77, 80, 81, 85, // rain / snow showers
]);

/**
 * A conservative walk outlook from current air temperature and WMO weather.
 *
 * It is intentionally guidance, not a claim that a walk is safe: pavement,
 * humidity, direct sun, fitness, age and breed can all make the real risk
 * higher. The UI therefore says "Take care" rather than "Safe".
 */
export function assessWalkWeather(weather: WalkWeather): WalkWeatherOutlook {
  const { tempC, code } = weather;

  if (tempC >= 30 || tempC <= 0 || code >= 95 || SEVERE_CODES.has(code)) {
    return { level: 'avoid', label: 'Stay in' };
  }

  if (tempC > 20 || tempC < 5 || CAUTION_CODES.has(code)) {
    return { level: 'caution', label: 'Take care' };
  }

  return { level: 'good', label: 'Good to go' };
}
