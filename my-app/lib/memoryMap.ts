/**
 * memoryMap — the walk archive, arranged for a map instead of a grid.
 *
 * The gallery's other view groups walks by place and draws each as a tile
 * (walkGallery.ts). This one answers a different question: not "which walks
 * happened where" but "what does everywhere we have been actually look like".
 *
 * ── The three layers, and why each exists ──
 *
 *   TRAILS. Every recorded route, drawn faintly, all at once. This is the layer
 *   that justifies the whole screen: a photo map is something several apps
 *   already do, but only Pawtchi holds the line the dog actually walked, so only
 *   Pawtchi can show a neighbourhood slowly filling in. A route walked once is a
 *   whisper; a favourite route walked fifty times accumulates into something
 *   solid, and the map draws that frequency for free with no heatmap and no
 *   second data structure.
 *
 *   PHOTO PINS. The moments, pinned where they happened. Placed moments only —
 *   see below.
 *
 *   TILE PINS. One per walk that has a route but no photograph on it, drawn as
 *   the same navy-and-yellow tile the grid uses. Without these the map would be
 *   emptier than the grid for anyone who has not taken photos yet, which is most
 *   people most of the time, and a map that shows less than the list it replaced
 *   is not a better view of the same archive — it is a worse one.
 *
 * ── Placed moments only ──
 * A keepsake with no coordinate has an estimated route position, which is fine
 * on a bare route drawing and dishonest on a real map with streets underneath:
 * there it becomes a claim about a specific doorway. Same rule useKeepsakePins
 * already applies, restated here because this module is where it gets enforced
 * for the whole archive rather than one walk.
 *
 * Pure: no React, no queries, no platform. The screen supplies rows and renders
 * the result — same posture as walkGallery.ts and homeRail.ts.
 */

import { simplifyRoute, type GeoPoint } from './walk/geo';
import type { Keepsake } from './walk/keepsake';

/**
 * How many walks contribute a trail, newest first.
 *
 * A cap on the DRAWING, not on the archive. It exists because of one platform:
 * expo-maps takes an array of polylines, so on iOS every trail is a separate
 * native overlay and the cost is linear in walks. Android draws the whole set as
 * a single MultiLineString and would not care.
 *
 * Sixty is where the web stops getting denser to the eye. Past that, new routes
 * land on top of ones already drawn — which is exactly what happens to anyone
 * with sixty walks, because people walk the same few ways.
 */
export const TRAIL_MAX_WALKS = 60;

/**
 * Points kept per trail.
 *
 * Routes are already simplified to ≤200 points before storage (geo.ts). At the
 * zoom that fits a whole archive, a 40-point line and a 200-point line are the
 * same handful of pixels, so this is a fifth of the geometry for none of the
 * shape. Douglas–Peucker keeps the corners, which is the part that reads as a
 * street rather than a smudge.
 */
export const TRAIL_MAX_POINTS = 40;

/** The walk columns this module needs. Compatible with the gallery's row type. */
export interface MemoryMapWalk {
  id: string;
  started_at: string;
  route: GeoPoint[] | null;
}

/** A photograph, pinned where it was taken. */
export interface MemoryPhotoPin {
  id: string;
  lat: number;
  lng: number;
  /** Which walk it belongs to — the viewer pages that walk's moments. */
  walkSessionId: string;
  keepsake: Keepsake;
}

/** A walk with no photograph on it, pinned at where it set off. */
export interface MemoryTilePin {
  id: string;
  lat: number;
  lng: number;
  route: GeoPoint[];
}

export interface MemoryMap {
  photoPins: MemoryPhotoPin[];
  tilePins: MemoryTilePin[];
  /** Newest first, simplified and capped. */
  trails: GeoPoint[][];
  /**
   * Every coordinate the map will draw, for the camera to fit.
   *
   * Built here rather than by the screen so nothing can be drawn outside the
   * opening frame — a pin the owner has to hunt for by panning is a pin that,
   * as far as they are concerned, is not there.
   */
  framing: GeoPoint[];
}

function isPoint(p: unknown): p is GeoPoint {
  if (!p || typeof p !== 'object') return false;
  const { lat, lng } = p as GeoPoint;
  return Number.isFinite(lat) && Number.isFinite(lng);
}

/** Newest first, matching every other walk list in the app. */
function byNewest(a: MemoryMapWalk, b: MemoryMapWalk): number {
  return a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0;
}

export interface BuildMemoryMapInput {
  walks: readonly MemoryMapWalk[];
  /** Every moment on those walks. Unplaced ones are dropped here. */
  keepsakes: readonly Keepsake[];
}

export function buildMemoryMap({ walks, keepsakes }: BuildMemoryMapInput): MemoryMap {
  const photoPins: MemoryPhotoPin[] = [];
  /** Which walks already speak for themselves through a photograph. */
  const photographed = new Set<string>();

  for (const keepsake of keepsakes) {
    const { lat, lng } = keepsake;
    // Both, not either: `finiteOrNull` in keepsake.ts can leave one side null on
    // a partially-written row, and half a coordinate is not a place.
    if (lat == null || lng == null) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    photoPins.push({
      id: keepsake.id,
      lat,
      lng,
      walkSessionId: keepsake.walkSessionId,
      keepsake,
    });
    photographed.add(keepsake.walkSessionId);
  }

  const ordered = [...walks].sort(byNewest);

  const tilePins: MemoryTilePin[] = [];
  const trails: GeoPoint[][] = [];

  for (const walk of ordered) {
    const route = (walk.route ?? []).filter(isPoint);
    // A walk whose GPS never produced a usable point has nothing to contribute
    // to a map. It is still in the grid, where a tile can fall back to a paw
    // mark; here there is no honest place to put it.
    if (route.length === 0) continue;

    if (trails.length < TRAIL_MAX_WALKS) {
      trails.push(simplifyRoute(route, TRAIL_MAX_POINTS));
    }

    // A photographed walk is already represented, and by something better than a
    // drawing of itself. Two pins for one walk would read as two walks.
    if (photographed.has(walk.id)) continue;

    tilePins.push({
      id: walk.id,
      lat: route[0].lat,
      lng: route[0].lng,
      route,
    });
  }

  const framing: GeoPoint[] = [];
  for (const trail of trails) framing.push(...trail);
  for (const pin of photoPins) framing.push({ lat: pin.lat, lng: pin.lng });
  for (const pin of tilePins) framing.push({ lat: pin.lat, lng: pin.lng });

  return { photoPins, tilePins, trails, framing };
}

/**
 * The moments on one walk, oldest first.
 *
 * What a tapped photo pin pages through. Scoped to the walk rather than to the
 * whole archive on purpose: the neighbours either side of a photograph should be
 * the rest of that outing, not whatever happened to be pinned nearby six months
 * later. Home's map behaves the same way.
 */
export function photoPinsForWalk(
  pins: readonly MemoryPhotoPin[],
  walkSessionId: string,
): MemoryPhotoPin[] {
  return pins
    .filter((pin) => pin.walkSessionId === walkSessionId)
    .sort((a, b) => a.keepsake.capturedAt - b.keepsake.capturedAt);
}

/**
 * "128 km across 14 places" — the one line the map states outright.
 *
 * Distance and places rather than a walk count, because the map's subject is
 * ground covered. The place count comes from the caller (groupWalksByPlace), so
 * the two views of the same archive can never disagree about how many places
 * there are.
 */
export function memoryMapHeadline(totalKm: number, placeCount: number): string | null {
  if (!(totalKm > 0) || placeCount < 1) return null;
  const km = totalKm >= 100 ? Math.round(totalKm) : Number(totalKm.toFixed(1));
  const places = placeCount === 1 ? 'place' : 'places';
  return `${km} km across ${placeCount} ${places}`;
}
