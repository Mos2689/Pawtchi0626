import { useEffect, useState } from 'react';

import type { WalkWeather } from '../lib/walkStory';
import type { GeoPoint } from '../lib/walk/geo';
import { fetchWalkWeather } from '../lib/walk/weather';

const REFRESH_MS = 15 * 60 * 1000;

/**
 * Current conditions for Home's already-resolved map centre.
 * fetchWalkWeather rounds the coordinate to ~1 km before making the request.
 */
export function useCurrentWalkWeather(
  center: GeoPoint | null,
  enabled: boolean,
): WalkWeather | null {
  const [weather, setWeather] = useState<WalkWeather | null>(null);
  const lat = center?.lat;
  const lng = center?.lng;

  useEffect(() => {
    if (!enabled || lat === undefined || lng === undefined) {
      setWeather(null);
      return;
    }

    let cancelled = false;
    setWeather(null);

    const refresh = async () => {
      const next = await fetchWalkWeather(lat, lng);
      // Keep the last successful reading through a transient refresh failure;
      // a missing badge is better than presenting failed data as a condition.
      if (!cancelled && next) setWeather(next);
    };

    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, lat, lng]);

  return weather;
}
