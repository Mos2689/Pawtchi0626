/**
 * Finding a meeting point by name — as you type, and near you.
 *
 * ── Why not the phone's geocoder ────────────────────────────────────────────
 *
 * The picker used Location.geocodeAsync: one answer, anywhere on Earth, only
 * after pressing search. "MG Road" from Bengaluru could land in another city,
 * and nothing suggested "129 Tallawong Road" while you were still typing "129".
 * The OS geocoder takes no "near here" hint through expo-location, and
 * autocomplete is not what it is for.
 *
 * ── Photon ──────────────────────────────────────────────────────────────────
 *
 * Photon (photon.komoot.io) is an OpenStreetMap search built for
 * search-as-you-type, with a location bias and a bounding box, and it needs no
 * key. Pawtchi already draws OSM-derived data (spots, the Android basemap), so
 * this adds a service, not a new kind of data.
 *
 * What it is sent: the typed text, and the search area rounded to about a
 * kilometre — never the device's own position at full precision.
 *
 * ── "Near here" is a box, not a preference ──────────────────────────────────
 *
 * A bias alone still returns the famous MG Road in another city when the local
 * one ranks lower. So when the area is known, the search is CONFINED to a box
 * around it (NEARBY_RADIUS_KM), and widening it is an explicit "search
 * everywhere". Without a known area, results are kept to the device's region
 * (country) when that is known.
 *
 * Pure: URL building and parsing only. The network call is in
 * placeSearchClient.ts.
 */

import type { GeoPoint } from '../walk/geo';

export const PHOTON_URL = 'https://photon.komoot.io/api/';
export const NEARBY_RADIUS_KM = 40;
export const MAX_SUGGESTIONS = 6;
export const MIN_QUERY_LENGTH = 2;

export interface SearchArea {
  /** Where "near here" is: the map's real centre, or null when unknown. */
  center: GeoPoint | null;
  /** ISO 3166-1 alpha-2 region of the device, e.g. "IN", "AU"; null if unknown. */
  countryCode: string | null;
}

export interface PlaceSuggestion {
  id: string;
  /** "129 Tallawong Road", "MG Road", "Centennial Park". */
  title: string;
  /** "Rouse Hill, Sydney, New South Wales" — enough to tell two apart. */
  subtitle: string;
  lat: number;
  lng: number;
}

/** About a kilometre: enough to rank by, not enough to find a house. */
const round2 = (value: number) => Math.round(value * 100) / 100;

export function boxAround(center: GeoPoint, radiusKm: number): { minLng: number; minLat: number; maxLng: number; maxLat: number } {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  return {
    minLng: Math.max(-180, center.lng - dLng),
    minLat: Math.max(-90, center.lat - dLat),
    maxLng: Math.min(180, center.lng + dLng),
    maxLat: Math.min(90, center.lat + dLat),
  };
}

export function photonSearchUrl(query: string, area: SearchArea, nearbyOnly: boolean): string {
  const params: string[] = [
    `q=${encodeURIComponent(query.trim())}`,
    `limit=${MAX_SUGGESTIONS * 2}`,
    'lang=en',
  ];
  if (area.center) {
    const center = { lat: round2(area.center.lat), lng: round2(area.center.lng) };
    params.push(`lat=${center.lat}`, `lon=${center.lng}`);
    if (nearbyOnly) {
      const box = boxAround(center, NEARBY_RADIUS_KM);
      params.push(`bbox=${[box.minLng, box.minLat, box.maxLng, box.maxLat].map(n => n.toFixed(3)).join(',')}`);
    }
  }
  return `${PHOTON_URL}?${params.join('&')}`;
}

/**
 * True when someone typed a street address ("129 Tallawong Road") that none of
 * the suggestions carries the number of.
 *
 * OpenStreetMap often knows a street but not each house on it — it suggests
 * "Tallawong Road" for "129 Tallawong Road". The phone's own geocoder (Apple or
 * Google) usually does know the house, so this is when the picker offers to
 * look the exact address up there instead.
 */
export function wantsExactAddress(query: string, suggestions: readonly PlaceSuggestion[]): boolean {
  const match = /^\s*(\d+[a-z]?)(?:[/-]\d+)?\s+\S/i.exec(query);
  if (!match) return false;
  const number = match[1].toLowerCase();
  return !suggestions.some(suggestion => suggestion.title.toLowerCase().startsWith(`${number} `));
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Suggestions from a Photon answer. Malformed features are skipped; anything
 * outside the device's country is dropped when the search was not anchored to
 * a place (`area.center` null) and the country is known.
 */
export function parsePhoton(json: unknown, area: SearchArea): PlaceSuggestion[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: PlaceSuggestion[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const coords = (feature as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates;
    const props = ((feature as { properties?: unknown })?.properties ?? {}) as Record<string, unknown>;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lng, lat] = coords as [unknown, unknown];
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;

    const country = text(props.countrycode)?.toUpperCase() ?? null;
    if (!area.center && area.countryCode && country && country !== area.countryCode.toUpperCase()) continue;

    const street = text(props.street);
    const number = text(props.housenumber);
    const name = text(props.name);
    const title = number && street ? `${number} ${street}` : name ?? street ?? text(props.city);
    if (!title) continue;

    const parts: string[] = [];
    for (const part of [
      number && street ? null : street !== title ? street : null,
      text(props.district) ?? text(props.locality),
      text(props.city),
      text(props.state),
    ]) {
      if (part && part !== title && !parts.includes(part)) parts.push(part);
    }
    if (!area.center && !area.countryCode) {
      const countryName = text(props.country);
      if (countryName && !parts.includes(countryName)) parts.push(countryName);
    }
    const subtitle = parts.join(', ');

    const key = `${title}|${subtitle}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const osmType = text(props.osm_type) ?? 'x';
    const osmId = typeof props.osm_id === 'number' || typeof props.osm_id === 'string' ? String(props.osm_id) : `${lat},${lng}`;
    out.push({ id: `${osmType}${osmId}`, title, subtitle, lat, lng });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}
