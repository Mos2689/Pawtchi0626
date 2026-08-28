/**
 * normalize — Overpass element → PawtchiSpot.
 *
 * This is the only file in the app that knows what an Overpass response looks
 * like. Everything downstream sees `PawtchiSpot` and nothing else, which is
 * what makes a second provider an additive change.
 *
 * The hard part is coordinates. Overpass returns three element types and they
 * carry position in three different ways:
 *
 *   node      → `lat`/`lon` directly
 *   way       → `center` (because we ask for `out center`), else `bounds`
 *   relation  → same as way, and a multipolygon park may have neither if the
 *               query hit a limit mid-response
 *
 * A place we cannot locate is dropped rather than guessed at. A park pinned to
 * the wrong street is worse than a park that is missing: the first sends
 * someone somewhere, the second just isn't there.
 */

import {
  categoryOf,
  dogAccessOf,
  fencedOf,
  isDogWater,
  isEmergencyVet,
  isExcluded,
  litOf,
  type OsmTags,
} from './classify';
import type { PawtchiSpot } from './types';

/** The subset of the Overpass JSON shape we rely on. */
export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: OsmTags;
  timestamp?: string;
}

export interface OverpassResponse {
  elements?: OverpassElement[];
}

function isFiniteCoord(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

/**
 * Best available position, most trustworthy source first.
 *
 * `bounds` midpoint is a genuine approximation — the centre of a crescent-shaped
 * nature reserve can land outside it — but it is the centre of the right place,
 * which is all a map pin at neighbourhood zoom needs to be.
 */
export function coordinateOf(el: OverpassElement): { lat: number; lng: number } | null {
  if (isFiniteCoord(el.lat, el.lon)) {
    return { lat: el.lat as number, lng: el.lon as number };
  }
  if (el.center && isFiniteCoord(el.center.lat, el.center.lon)) {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  if (el.bounds) {
    const { minlat, minlon, maxlat, maxlon } = el.bounds;
    if (isFiniteCoord(minlat, minlon) && isFiniteCoord(maxlat, maxlon)) {
      return { lat: (minlat + maxlat) / 2, lng: (minlon + maxlon) / 2 };
    }
  }
  // Last resort: the first vertex. Not the centre of anything, but it IS a
  // point on the feature, so a pin lands somewhere genuinely part of the place.
  const first = el.geometry?.find(g => isFiniteCoord(g.lat, g.lon));
  if (first) return { lat: first.lat, lng: first.lon };
  return null;
}

/** `addr:*` assembled into one line, or null when there isn't enough to bother. */
function addressOf(tags: OsmTags): string | null {
  const street = [tags['addr:housenumber'], tags['addr:street']]
    .filter(Boolean)
    .join(' ')
    .trim();
  const parts = [street, tags['addr:city'], tags['addr:postcode']].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(', ') : null;
}

function firstOf(tags: OsmTags, keys: string[]): string | null {
  for (const k of keys) {
    const v = tags[k]?.trim();
    if (v) return v;
  }
  return null;
}

/**
 * A short human sentence about access, passed through from the source when it
 * exists. Only ever supplements the machine-read `dogAccess`, never replaces
 * it — free text cannot be verified, so it must not drive a badge.
 */
function accessDescriptionOf(tags: OsmTags): string | null {
  const raw = tags['dog:conditional'] ?? tags.description ?? null;
  if (!raw) return null;
  const t = raw.trim();
  // A wall of text is somebody's essay about the park's history. Cap it.
  return t.length > 0 && t.length <= 160 ? t : null;
}

/**
 * One element → one spot, or null when it should not be shown.
 *
 * `fetchedAt` is injected rather than read from the clock so the whole batch
 * carries one timestamp and the function stays pure/testable.
 */
export function normalizeElement(
  el: OverpassElement,
  fetchedAt: string,
): PawtchiSpot | null {
  const tags = el.tags ?? {};
  if (isExcluded(tags)) return null;

  const category = categoryOf(tags);
  if (!category) return null;

  const point = coordinateOf(el);
  if (!point) return null;

  const dogAccess = dogAccessOf(tags, category);
  // Defensive: `isExcluded` already dropped `dog=no`, but the classifier is
  // the authority on this and a future rule change must not leak a prohibited
  // place into a list because two files disagreed.
  if (dogAccess === 'prohibited') return null;

  const providerPlaceId = `${el.type}/${el.id}`;

  return {
    id: `osm:${providerPlaceId}`,
    provider: 'osm',
    providerPlaceId,
    category,
    // Null, not a fallback string — see the note on PawtchiSpot.name.
    name: tags.name?.trim() || null,
    latitude: point.lat,
    longitude: point.lng,
    dogAccess,
    accessDescription: accessDescriptionOf(tags),
    address: addressOf(tags),
    openingHours: tags.opening_hours?.trim() || null,
    website: firstOf(tags, ['website', 'contact:website']),
    phone: firstOf(tags, ['phone', 'contact:phone']),
    surface: tags.surface?.trim() || null,
    fenced: fencedOf(tags),
    lit: litOf(tags),
    // Scoped to the category they belong to, so a park tagged `bowl=yes` does
    // not acquire a "Dog bowl" badge meant for water points.
    dogWaterConfirmed: category === 'drinking_water' && isDogWater(tags),
    emergencyCareConfirmed: category === 'veterinary' && isEmergencyVet(tags),
    sourceUpdatedAt: el.timestamp ?? null,
    fetchedAt,
  };
}

/**
 * A whole response → spots. Malformed elements are skipped individually rather
 * than failing the batch: one bad element out of eighty should cost one park,
 * not the entire screen.
 */
export function normalizeResponse(
  body: OverpassResponse | null | undefined,
  fetchedAt: string,
): PawtchiSpot[] {
  const elements = body?.elements;
  if (!Array.isArray(elements)) return [];

  const out: PawtchiSpot[] = [];
  for (const el of elements) {
    try {
      const spot = normalizeElement(el, fetchedAt);
      if (spot) out.push(spot);
    } catch {
      // A single unparseable element must never take the response down.
    }
  }
  return out;
}
