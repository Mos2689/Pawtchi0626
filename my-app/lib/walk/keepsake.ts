/**
 * Keepsakes — a moment captured during a walk, anchored to where on the route
 * it happened.
 *
 * "Keepsake" is the internal name only. `moment`, `spot`, `sniff spot`,
 * `pawprint`, `story` and `walksign` are all already taken in this codebase —
 * most relevantly `momentCard.ts`, which is the SHARE CARD, not this. The
 * user-facing word pends the usual trademark/copy screen, so it lives in copy,
 * never in a type name (same discipline as lib/walksign/copy.ts).
 *
 * ── What this module is ──
 * Pure. Types, normalization, and the geometry that answers "where on the walk
 * was this taken". No Supabase, no filesystem, no photo library — those live in
 * keepsakeSync.ts, keepsakeResolve.ts and keepsakeImport.ts respectively, so
 * this file stays testable under ts-jest with no mocks.
 *
 * ── The privacy stance, restated because it constrains the types ──
 * The original photo NEVER leaves the device. What travels is this metadata
 * plus a ~20 KB thumbnail. `localAssetId` is therefore a CACHE HINT and nothing
 * more: iOS `ph://` ids survive reinstall but not device migration, and Android
 * MediaStore ids survive neither reliably. Anything that treats it as the
 * source of truth will work perfectly on the developer's phone and lose users'
 * memories on their next one. The durable locator is capturedAt + coordinate +
 * dimensions — see keepsakeResolve.ts.
 */

import { haversineMeters, type GeoPoint } from './geo';

export type KeepsakeMediaType = 'photo' | 'video';
export type KeepsakeSource = 'camera' | 'import';

export interface Keepsake {
  id: string;
  walkSessionId: string;
  petId: string;

  /** Capture time, ms since epoch. Half of the durable locator. */
  capturedAt: number;

  lat: number | null;
  lng: number | null;
  /** Nearest vertex on the walk's simplified polyline. Null when unplaceable. */
  routeIndex: number | null;
  /** Seconds into the walk. Null when the walk start is unknown. */
  elapsedS: number | null;

  mediaType: KeepsakeMediaType;
  source: KeepsakeSource;

  /** Cache hint ONLY — never the source of truth. See the module header. */
  localAssetId: string | null;
  width: number | null;
  height: number | null;

  /** Storage path for the durable thumbnail — the memory that outlives the file. */
  thumbPath: string | null;
  thumbBlurhash: string | null;

  /** Coarse index for place memory. See placeKey.ts. */
  placeKey: string | null;
  caption: string | null;
}

/**
 * How far a photo may sit from the recorded route and still be pinned to it.
 *
 * Generous on purpose: the stored route is a Douglas–Peucker simplification, so
 * a corner can legitimately be tens of metres from where someone stood, and
 * that is before consumer GPS scatter. A keepsake that is genuinely elsewhere
 * (imported from a different outing that overlapped the window) gets a null
 * routeIndex rather than a confidently wrong pin.
 */
export const ROUTE_SNAP_MAX_M = 150;

/**
 * Grace window either side of a walk for timestamp import.
 *
 * The photo taken while unclipping the lead in the driveway, thirty seconds
 * before the tap on Start, belongs to the walk in every sense a human cares
 * about. Two minutes is long enough to catch that and short enough not to
 * hoover up the kitchen.
 */
export const IMPORT_GRACE_MS = 2 * 60 * 1000;

// ── Geometry ─────────────────────────────────────────────────────────────────

export interface RouteProjection {
  /** Index of the nearest vertex on the simplified route. */
  index: number;
  /** Distance from the point to that vertex, in metres. */
  distanceM: number;
}

/**
 * Nearest vertex on the route to a coordinate.
 *
 * Vertex-nearest rather than segment-nearest deliberately: the consumer is a
 * map pin and a story beat, both of which want "which part of the walk was
 * this", not sub-metre precision on a line that was itself simplified.
 * Returns null for an empty route.
 */
export function projectToRoute(
  route: readonly GeoPoint[],
  point: GeoPoint,
): RouteProjection | null {
  if (route.length === 0) return null;

  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < route.length; i++) {
    const d = haversineMeters(route[i], point);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  return { index: bestIndex, distanceM: bestDist };
}

/**
 * Snap a coordinate to the route, or refuse.
 *
 * Refusing (null) is a feature: a wrong pin on the map is worse than no pin,
 * because the map is the thing the user is being asked to trust.
 */
export function snapToRoute(
  route: readonly GeoPoint[],
  point: GeoPoint,
  maxDistanceM: number = ROUTE_SNAP_MAX_M,
): number | null {
  const projection = projectToRoute(route, point);
  if (!projection) return null;
  return projection.distanceM <= maxDistanceM ? projection.index : null;
}

/**
 * Cumulative distance along a route, one entry per vertex (first is 0).
 * Exported because both the time-interpolation below and the story beats want
 * the same numbers.
 */
export function cumulativeDistances(route: readonly GeoPoint[]): number[] {
  const out: number[] = new Array(route.length);
  let total = 0;
  for (let i = 0; i < route.length; i++) {
    if (i > 0) total += haversineMeters(route[i - 1], route[i]);
    out[i] = total;
  }
  return out;
}

/**
 * Best-effort route position for a photo that has a timestamp but no GPS.
 *
 * This is the import fallback: many photos carry EXIF time but no location
 * (location services off for the camera, or stripped on transfer). We assume a
 * constant pace and walk the cumulative-distance curve to the elapsed fraction.
 *
 * That assumption is wrong in detail — nobody walks a dog at constant pace, and
 * sniff stops make it wronger. It is used only to place a pin approximately,
 * never to claim a coordinate: callers must leave lat/lng null for these, so
 * the keepsake never contributes a fictitious point to place memory. A pin
 * that is roughly right in the middle of the walk reads as honest; a fabricated
 * coordinate at a tree the dog never visited does not.
 */
export function estimateRouteIndexByTime(
  route: readonly GeoPoint[],
  startedAt: number,
  endedAt: number,
  capturedAt: number,
): number | null {
  if (route.length === 0) return null;
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;
  if (endedAt <= startedAt) return null;

  const fraction = Math.max(0, Math.min(1, (capturedAt - startedAt) / (endedAt - startedAt)));

  const cumulative = cumulativeDistances(route);
  const total = cumulative[cumulative.length - 1];
  // A stationary trace has no distance to interpolate along; the midpoint is
  // the only defensible answer.
  if (total <= 0) return Math.floor((route.length - 1) * fraction);

  const target = total * fraction;
  for (let i = 0; i < cumulative.length; i++) {
    if (cumulative[i] >= target) return i;
  }
  return route.length - 1;
}

// ── Time ─────────────────────────────────────────────────────────────────────

/** Whole seconds into the walk. Null when the walk start is unusable. */
export function elapsedSecondsInto(startedAt: number, capturedAt: number): number | null {
  if (!Number.isFinite(startedAt) || !Number.isFinite(capturedAt)) return null;
  return Math.max(0, Math.round((capturedAt - startedAt) / 1000));
}

/** Does this capture time belong to this walk, allowing for the lead-clipping grace? */
export function isWithinWalkWindow(
  startedAt: number,
  endedAt: number,
  capturedAt: number,
  graceMs: number = IMPORT_GRACE_MS,
): boolean {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return false;
  if (!Number.isFinite(capturedAt)) return false;
  return capturedAt >= startedAt - graceMs && capturedAt <= endedAt + graceMs;
}

// ── Normalization ────────────────────────────────────────────────────────────

const MEDIA_TYPES: readonly string[] = ['photo', 'video'];
const SOURCES: readonly string[] = ['camera', 'import'];

/**
 * The null guard is load-bearing, not defensive noise: `Number(null)` and
 * `Number('')` are both 0, so without it a row with no coordinate normalizes to
 * lat 0 / lng 0 — a real point in the Gulf of Guinea, which would then be
 * snapped to a route, given a place key, and drawn on a map as somewhere the
 * dog stood.
 */
function finiteOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Parse one `walk_media` row defensively.
 *
 * Follows resolveSniffStops' posture in momentCard.ts: a malformed row is
 * dropped, never rendered wrong. Returns null rather than throwing, because the
 * caller is a gallery that must still paint the other nine keepsakes.
 */
export function normalizeKeepsake(row: unknown): Keepsake | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;

  const id = stringOrNull(r.id);
  const walkSessionId = stringOrNull(r.walk_session_id ?? r.walkSessionId);
  const petId = stringOrNull(r.pet_id ?? r.petId);
  if (!id || !walkSessionId || !petId) return null;

  const rawCapturedAt = r.captured_at ?? r.capturedAt;
  const capturedAt =
    typeof rawCapturedAt === 'number' ? rawCapturedAt : Date.parse(String(rawCapturedAt ?? ''));
  if (!Number.isFinite(capturedAt)) return null;

  const mediaType = String(r.media_type ?? r.mediaType ?? 'photo');
  const source = String(r.source ?? 'camera');

  return {
    id,
    walkSessionId,
    petId,
    capturedAt,
    lat: finiteOrNull(r.lat),
    lng: finiteOrNull(r.lng),
    routeIndex: finiteOrNull(r.route_index ?? r.routeIndex),
    elapsedS: finiteOrNull(r.elapsed_s ?? r.elapsedS),
    mediaType: (MEDIA_TYPES.includes(mediaType) ? mediaType : 'photo') as KeepsakeMediaType,
    source: (SOURCES.includes(source) ? source : 'camera') as KeepsakeSource,
    localAssetId: stringOrNull(r.local_asset_id ?? r.localAssetId),
    width: finiteOrNull(r.width),
    height: finiteOrNull(r.height),
    thumbPath: stringOrNull(r.thumb_path ?? r.thumbPath),
    thumbBlurhash: stringOrNull(r.thumb_blurhash ?? r.thumbBlurhash),
    placeKey: stringOrNull(r.place_key ?? r.placeKey),
    caption: stringOrNull(r.caption),
  };
}

/** Chronological, oldest first — the order a walk is relived in. */
export function sortKeepsakes(keepsakes: readonly Keepsake[]): Keepsake[] {
  return [...keepsakes].sort((a, b) => a.capturedAt - b.capturedAt);
}

/** The `walk_media` row shape, as written. */
export interface KeepsakeInsert {
  owner_id: string;
  pet_id: string;
  walk_session_id: string;
  captured_at: string;
  lat: number | null;
  lng: number | null;
  route_index: number | null;
  elapsed_s: number | null;
  media_type: KeepsakeMediaType;
  source: KeepsakeSource;
  local_asset_id: string | null;
  width: number | null;
  height: number | null;
  place_key: string | null;
}

export interface KeepsakeInsertInput {
  ownerId: string;
  petId: string;
  walkSessionId: string;
  capturedAt: number;
  lat?: number | null;
  lng?: number | null;
  routeIndex?: number | null;
  elapsedS?: number | null;
  mediaType?: KeepsakeMediaType;
  source: KeepsakeSource;
  localAssetId?: string | null;
  width?: number | null;
  height?: number | null;
  placeKey?: string | null;
}

/**
 * Build the row to insert.
 *
 * Pure and exported so the one rule that must never slip is testable: a
 * keepsake gets a `place_key` only when it also gets a real coordinate. The
 * place index is what lets a location recognise you months later, and a key
 * derived from an estimated position would make it recognise you somewhere you
 * have never stood.
 */
export function buildKeepsakeInsert(input: KeepsakeInsertInput): KeepsakeInsert {
  const lat = input.lat ?? null;
  const lng = input.lng ?? null;
  const hasCoordinate =
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);

  return {
    owner_id: input.ownerId,
    pet_id: input.petId,
    walk_session_id: input.walkSessionId,
    captured_at: new Date(input.capturedAt).toISOString(),
    lat: hasCoordinate ? lat : null,
    lng: hasCoordinate ? lng : null,
    route_index: input.routeIndex ?? null,
    elapsed_s: input.elapsedS ?? null,
    media_type: input.mediaType ?? 'photo',
    source: input.source,
    local_asset_id: input.localAssetId ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    place_key: hasCoordinate ? input.placeKey ?? null : null,
  };
}

/**
 * Is there an image to show — either rung of the ladder that has one?
 *
 * The single definition of "showable", shared by the story beat and place
 * memory so they can never disagree about which moments count. A keepsake that
 * fails this still describes a real moment (rung 3), but it cannot carry a
 * surface whose entire job is displaying a picture.
 */
export function hasImage(keepsake: Keepsake): boolean {
  return Boolean(keepsake.thumbPath || keepsake.localAssetId);
}
