import { useEffect, useRef, useState } from 'react';

import type { WalkWeather } from '../lib/walkStory';
import type { GeoPoint } from '../lib/walk/geo';
import { fetchWalkWeather, weatherCellKey } from '../lib/walk/weather';
import { homeMark } from '../lib/perf/homeTrace';

const REFRESH_MS = 15 * 60 * 1000;

/**
 * Current conditions for Home's already-resolved map centre.
 *
 * Keyed on the ~1 km cell the request is actually made against
 * (`weatherCellKey`) rather than on the raw coordinate. Home resolves its centre
 * in two steps — a cached coordinate painted immediately, then the revalidated
 * one — and those are nearly always the same cell, so watching the raw pair
 * meant every launch fetched the same forecast twice and blanked the badge in
 * between.
 */
export function useCurrentWalkWeather(
  center: GeoPoint | null,
  enabled: boolean,
): WalkWeather | null {
  const [weather, setWeather] = useState<WalkWeather | null>(null);
  const cell = weatherCellKey(center?.lat, center?.lng);

  // Read inside the effect but deliberately NOT a dependency: a coordinate that
  // refines within the same cell must not restart the interval.
  const latest = useRef(center);
  latest.current = center;

  useEffect(() => {
    if (!enabled || !cell) {
      setWeather(null);
      return;
    }

    let cancelled = false;
    setWeather(null);

    const refresh = async () => {
      const at = latest.current;
      if (!at) return;
      const next = await fetchWalkWeather(at.lat, at.lng);
      // Keep the last successful reading through a transient refresh failure;
      // a missing badge is better than presenting failed data as a condition.
      if (!cancelled && next) {
        setWeather(next);
        homeMark('weather_resolved');
      }
    };

    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, cell]);

  return weather;
}
