/**
 * Place cells — the index that lets a location remember what happened there.
 *
 * Place memory is the answer to the repetitive-route problem: the same corner,
 * photographed across months, is only possible if we can cheaply ask "what else
 * happened within a few steps of here". That question needs an index, because
 * scanning every keepsake a pet has ever produced on every GPS fix is not a
 * thing a phone can do while the screen is on.
 *
 * ── The two-stage design ──
 * The cell is a COARSE index, never the answer. A floor-quantized grid has the
 * boundary problem every grid has: two photos two metres apart can straddle an
 * edge and land in different cells forever. So:
 *
 *   1. `neighbourPlaceKeys` returns the block of cells that provably covers
 *      everything within PLACE_MATCH_RADIUS_M — that is the DB query.
 *   2. The caller then filters candidates by real haversine distance.
 *
 * Stage 1 is allowed to over-return. It is never allowed to under-return, which
 * is what the coverage test in placeKey.test.ts pins down — the failure mode is
 * silent (the oak tree simply never remembers you) and would be near-impossible
 * to notice in the wild.
 *
 * Unrelated to lib/spots/cellKey.ts despite the shape: that grid is ~2.2 km and
 * exists to share a cache across strangers. This one is ~55 m and exists to
 * recognise a single tree. Same idea, three orders of magnitude apart, so they
 * deliberately do not share code.
 */

import { haversineMeters, type GeoPoint } from './geo';

/**
 * Cell size in degrees. 0.0005° of latitude is ~55 m everywhere.
 *
 * Sized comfortably above PLACE_MATCH_RADIUS_M so the common case needs only
 * one ring of neighbours (9 cells). Smaller cells would mean more keys per
 * query for no added precision — precision comes from the distance filter in
 * stage 2, not from the grid.
 */
export const PLACE_CELL_DEG = 0.0005;

/**
 * How close two moments must be to count as "the same place", in metres.
 *
 * 25 m is about the width of a road plus its verges: close enough that a human
 * would say "the same tree", loose enough to survive ordinary consumer GPS
 * scatter, which is routinely 10–20 m under tree cover — exactly where dogs
 * stop to sniff, and therefore exactly where this has to work.
 */
export const PLACE_MATCH_RADIUS_M = 25;

/** Metres per degree of latitude — near enough constant. */
const M_PER_DEG_LAT = 110540;
/** Metres per degree of longitude at the equator; narrows by cos(latitude). */
const M_PER_DEG_LNG_EQUATOR = 111320;

/**
 * Ring cap. Longitude cells narrow toward the poles, so the ring count needed
 * to cover a fixed radius grows without bound as cos(latitude) → 0. Rather than
 * emit thousands of keys at 89°, we stop at 5 rings (11 cells across) and
 * accept that place memory degrades to a smaller catchment in the high Arctic.
 * Returning fewer matches there is a far better failure than a query that never
 * comes back.
 */
const MAX_RINGS = 5;

export interface PlaceCell {
  latIndex: number;
  lngIndex: number;
}

/**
 * `floor`, not `round` — floor partitions the plane into disjoint cells with no
 * overlap and no gap, and behaves predictably either side of the equator and
 * the prime meridian.
 */
export function placeCellOf(lat: number, lng: number): PlaceCell {
  return {
    latIndex: Math.floor(lat / PLACE_CELL_DEG),
    lngIndex: Math.floor(lng / PLACE_CELL_DEG),
  };
}

/** Stable string form — this is what goes in `walk_media.place_key`. */
export function placeKey(lat: number, lng: number): string {
  const { latIndex, lngIndex } = placeCellOf(lat, lng);
  return `${latIndex}_${lngIndex}`;
}

/** Null-safe form for rows whose coordinate never resolved. */
export function placeKeyOrNull(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string | null {
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return placeKey(lat, lng);
}

/**
 * How many cells out we must look on each axis to be sure of covering
 * `radiusM` from anywhere inside the origin cell.
 *
 * A point can sit flush against a cell edge, so a neighbour of distance k
 * guarantees k whole cells of margin — hence `ceil(radius / cellSize)` rather
 * than anything cleverer.
 */
function ringsFor(radiusM: number, cellSizeM: number): number {
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) return MAX_RINGS;
  return Math.min(MAX_RINGS, Math.max(1, Math.ceil(radiusM / cellSizeM)));
}

/**
 * Every cell key that could hold a moment within `radiusM` of this coordinate.
 *
 * Computed per axis: latitude cells are ~55 m everywhere so the latitude ring
 * is almost always 1, while the longitude ring grows with latitude. Feed the
 * result to a `place_key IN (...)` query, then filter what comes back by
 * `haversineMeters` — see `withinPlaceRadius`.
 */
export function neighbourPlaceKeys(
  lat: number,
  lng: number,
  radiusM: number = PLACE_MATCH_RADIUS_M,
): string[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const { latIndex, lngIndex } = placeCellOf(lat, lng);

  const cellLatM = PLACE_CELL_DEG * M_PER_DEG_LAT;
  // cos() is taken at the queried latitude; over one cell it changes by far too
  // little to matter, and taking the larger (equatorward) value would risk
  // under-covering, which is the one thing this must never do.
  const cellLngM = PLACE_CELL_DEG * M_PER_DEG_LNG_EQUATOR * Math.cos((lat * Math.PI) / 180);

  const latRings = ringsFor(radiusM, cellLatM);
  const lngRings = ringsFor(radiusM, Math.abs(cellLngM));

  const keys: string[] = [];
  for (let dLat = -latRings; dLat <= latRings; dLat++) {
    for (let dLng = -lngRings; dLng <= lngRings; dLng++) {
      keys.push(`${latIndex + dLat}_${lngIndex + dLng}`);
    }
  }
  return keys;
}

/** Stage 2 — the precise test the grid only approximates. */
export function withinPlaceRadius(
  a: GeoPoint,
  b: GeoPoint,
  radiusM: number = PLACE_MATCH_RADIUS_M,
): boolean {
  return haversineMeters(a, b) <= radiusM;
}
