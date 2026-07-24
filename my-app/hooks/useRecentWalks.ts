/**
 * useTodayWalks — fetches today's tracked walks for the active pet.
 *
 * "Today" is the calendar day in the phone's local timezone (matches every
 * other daily read in the app via lib/dateUtils.getLocalYMD). Every real walk
 * is a post — short outings and patchy-GPS ambles included; only a discarded
 * car ride (validation_verdict='likely_vehicle') stays out of the feed.
 *
 * Refetches on focus and after a walk finishes (the Home screen already calls
 * invalidateContext on completion; this hook piggybacks on a matching version
 * bump so no extra plumbing is needed).
 */

import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { getLocalYMD } from '../lib/dateUtils';
import type { GeoPoint } from '../lib/walk/geo';
import { WALK_TRACKING_ENABLED } from '../constants/features';

export interface TodayWalk {
  id: string;
  started_at: string;
  duration_s: number;
  /** GPS moving time — the kcal basis; duration_s is elapsed, for display. */
  moving_time_s: number;
  distance_m: number;
  route: GeoPoint[] | null;
  /** Sniff-stop coordinates — the loops on the shareable Paw Moment card. */
  pause_points: GeoPoint[];
  avg_speed_kmh: number | null;
  start_label: string | null;
  end_label: string | null;
  farthest_label: string | null;
}

/** route/pause_points JSONB may be [[lat,lng], ...] or [{lat, lng}, ...]. */
function parseGeoPoints(raw: unknown): GeoPoint[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0])) {
    return (raw as [number, number][]).map(([lat, lng]) => ({ lat, lng }));
  }
  if (raw[0] && typeof raw[0] === 'object' && 'lat' in (raw[0] as object)) {
    return raw as GeoPoint[];
  }
  return null;
}

function toStartOfDay(iso: string): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function useTodayWalks(petId: string | null | undefined) {
  const [walks, setWalks] = useState<TodayWalk[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchWalks = useCallback(async () => {
    if (!WALK_TRACKING_ENABLED || !petId) {
      setWalks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const todayYmd = getLocalYMD(new Date());
      const startIso = new Date(toStartOfDay(new Date().toISOString())).toISOString();
      // Every real walk is a post — short outings and patchy-GPS ambles
      // included. Only vehicle rides stay out of the feed.
      const { data, error } = await supabase
        .from('walk_sessions')
        .select('id, started_at, duration_s, moving_time_s, distance_m, route, pause_points, avg_speed_kmh, validation_verdict, start_label, end_label, farthest_label')
        .eq('pet_id', petId)
        .neq('validation_verdict', 'likely_vehicle')
        .gte('started_at', startIso)
        .order('started_at', { ascending: false });

      if (error) {
        console.error('[useTodayWalks] fetch error', error);
        setWalks([]);
        return;
      }

      // Server-side range filter is timestamp-based; belt-and-braces trim to
      // the phone's local calendar day so a walk that started at 23:59 UTC
      // yesterday doesn't surface as "today's."
      const filtered = (data ?? []).filter(w => getLocalYMD(new Date(w.started_at)) === todayYmd);

      const parsed: TodayWalk[] = filtered.map(row => {
        // route/pause_points are JSONB — normalize both to GeoPoint[]. Missing
        // pause_points (older rows, NULL column) degrades to a loop-less card.
        const route = parseGeoPoints(row.route as unknown);
        return {
          id: row.id as string,
          started_at: row.started_at as string,
          duration_s: row.duration_s as number,
          moving_time_s: (row.moving_time_s as number) ?? 0,
          distance_m: Number(row.distance_m),
          avg_speed_kmh: row.avg_speed_kmh != null ? Number(row.avg_speed_kmh) : null,
          route,
          pause_points: parseGeoPoints(row.pause_points as unknown) ?? [],
          start_label: (row.start_label as string | null) ?? null,
          end_label: (row.end_label as string | null) ?? null,
          farthest_label: (row.farthest_label as string | null) ?? null,
        };
      });

      setWalks(parsed);
    } catch (e) {
      console.error('[useTodayWalks] unexpected', e);
    } finally {
      setLoading(false);
    }
  }, [petId]);

  useFocusEffect(
    useCallback(() => {
      fetchWalks();
    }, [fetchWalks]),
  );

  useEffect(() => {
    fetchWalks();
  }, [fetchWalks]);

  return { walks, loading, refetch: fetchWalks };
}
