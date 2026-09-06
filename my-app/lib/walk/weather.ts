/**
 * Walk weather — a best-effort reading of the sky at walk time, for the Walk
 * Story weather card.
 *
 * Uses Open-Meteo (free, no API key). Two hard rules:
 *   • Privacy — coordinates are rounded to ~1 km (2 decimals) before they
 *     leave the device. A weather card never needs the exact spot, and the
 *     precise route already lives only in the user's own row.
 *   • Best-effort — this must NEVER block or fail walk sync. A timeout or a
 *     bad response resolves to null and the story simply skips the card.
 */

import type { WalkWeather } from '../walkStory';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 4000;

/** ~1 km grid — enough for local conditions, coarse enough to protect the spot. */
function coarsen(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The identity of a weather request: the coordinate as it will actually be sent.
 *
 * Callers that re-request when their coordinate changes should watch this rather
 * than the raw latitude and longitude, because everything finer than this grid
 * produces a byte-identical request. Home's centre in particular is resolved in
 * two steps — a cached coordinate painted immediately, then the revalidated one
 * a round trip later — and those two are almost always the same cell, so keying
 * on the raw pair spent a second request to receive the first answer again.
 *
 * Null for a coordinate that could never be asked about, so a caller can use it
 * as the whole "is there anything to fetch?" test.
 */
export function weatherCellKey(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${coarsen(lat)},${coarsen(lng)}`;
}

/** WMO weather-code → a calm, lowercase label (Copy Spec v1: no urgency). */
export function labelForWeatherCode(code: number): string {
  if (code === 0) return 'clear';
  if (code === 1) return 'mostly clear';
  if (code === 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 61 || code === 80) return 'light rain';
  if (code === 63 || code === 81) return 'rain';
  if (code === 65 || code === 82) return 'heavy rain';
  if (code === 66 || code === 67) return 'freezing rain';
  if (code === 71 || code === 85) return 'light snow';
  if (code === 73) return 'snow';
  if (code === 75 || code === 86) return 'heavy snow';
  if (code === 77) return 'snow grains';
  if (code >= 95) return 'a thunderstorm';
  return 'clouds';
}

/**
 * Fetch the current conditions near a coordinate. Returns null on any failure
 * (offline, timeout, malformed body) — the caller treats weather as optional.
 */
export async function fetchWalkWeather(
  lat: number,
  lng: number,
): Promise<WalkWeather | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url =
      `${ENDPOINT}?latitude=${coarsen(lat)}&longitude=${coarsen(lng)}` +
      `&current=temperature_2m,weather_code`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const body = await res.json();
    const tempC = Number(body?.current?.temperature_2m);
    const code = Number(body?.current?.weather_code);
    if (!Number.isFinite(tempC) || !Number.isFinite(code)) return null;
    return { tempC, code, label: labelForWeatherCode(code) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
