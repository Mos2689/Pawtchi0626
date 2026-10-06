/**
 * "Our walks" as cards — the meetup screen's archive (Oct 2026).
 *
 * `community_pack_walk_cards` returns, per completed walk, what its card draws.
 * This parses that answer defensively (a bad row is dropped, never thrown) and
 * says the card's one line of numbers. Pure, so both are pinned by tests.
 */

import type { GeoPoint } from '../walk/geo';

export interface WalkCard {
  walkId: string;
  /** Storage path of the cover photo (private bucket — sign before showing). */
  coverPath: string | null;
  photoCount: number;
  walkerCount: number;
  distanceM: number | null;
  durationS: number | null;
  /** One thinned route per walker, in the order they set off. */
  routes: GeoPoint[][];
}

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const toNum = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value;
  return isNum(n) ? n : null;
};

function toRoute(value: unknown): GeoPoint[] | null {
  if (!Array.isArray(value)) return null;
  const points: GeoPoint[] = [];
  for (const item of value) {
    const lat = toNum((item as { lat?: unknown } | null)?.lat);
    const lng = toNum((item as { lng?: unknown } | null)?.lng);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    points.push({ lat, lng });
  }
  return points.length > 1 ? points : null;
}

export function parseWalkCards(data: unknown): WalkCard[] {
  if (!Array.isArray(data)) return [];
  const out: WalkCard[] = [];
  for (const row of data) {
    const r = row as Record<string, unknown> | null;
    if (!r || typeof r.walk_id !== 'string') continue;
    const routes = (Array.isArray(r.routes) ? r.routes : [])
      .map(toRoute)
      .filter((route): route is GeoPoint[] => route !== null);
    out.push({
      walkId: r.walk_id,
      coverPath: typeof r.cover_path === 'string' && r.cover_path ? r.cover_path : null,
      photoCount: Math.max(0, toNum(r.photo_count) ?? 0),
      walkerCount: Math.max(0, toNum(r.walker_count) ?? 0),
      distanceM: toNum(r.distance_m),
      durationS: toNum(r.duration_s),
      routes,
    });
  }
  return out;
}

/** "2.4 km · 45 min · 3 walkers" — only the parts that are known. */
export function walkCardStats(card: WalkCard | null | undefined): string {
  if (!card) return '';
  const parts: string[] = [];
  if (card.distanceM !== null && card.distanceM > 0) {
    parts.push(card.distanceM < 1000 ? `${Math.round(card.distanceM / 10) * 10} m` : `${(card.distanceM / 1000).toFixed(1)} km`);
  }
  if (card.durationS !== null && card.durationS >= 60) {
    const minutes = Math.round(card.durationS / 60);
    parts.push(minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim());
  }
  if (card.walkerCount > 0) parts.push(`${card.walkerCount} ${card.walkerCount === 1 ? 'walker' : 'walkers'}`);
  return parts.join(' · ');
}
