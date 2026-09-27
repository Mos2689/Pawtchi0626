/**
 * How far into the walk each moment was, and the line that shows it.
 *
 * ── What the reel is actually claiming ─────────────────────────────────────
 *
 * Under every photo sits a small trace of the walk with part of it lit. The
 * lit part is not "where this photo was taken" — it is HOW FAR INTO THE WALK
 * it was taken. Those are different facts and only one of them is knowable
 * here: a photo carries a coordinate and a time, but the route is a list of
 * points with no timestamps on them, so there is no honest way to say which
 * point of the line the shutter fired at.
 *
 * Elapsed time is measured, so elapsed time is what it draws. "Twelve minutes
 * into a forty-minute walk" is true whether the dog was circling one field or
 * marching in a straight line, and the reader reads it as progress, which is
 * exactly what it is.
 *
 * ── Why the whole route is drawn under every page ──────────────────────────
 *
 * So that swiping feels like moving THROUGH the walk rather than through a
 * folder. The shape stays put and the lit section grows; that continuity is
 * the entire point of putting a route under a photograph.
 */

import { routeTransform } from '../walk/routeSvg';

export interface GeoPoint { lat: number; lng: number }

export interface ReelTrace {
  /** An SVG polyline `points` string for the whole walk, or '' when unknown. */
  points: string;
  /** 0…1. How far into the walk this moment happened. */
  progress: number;
}

/**
 * The longest single recording, as the reel's backdrop.
 *
 * One line, not everyone's: the trace is a progress indicator, and three
 * overlapping squiggles behind a photograph is texture rather than
 * information. The longest is used because it is the one most likely to
 * describe the whole walk — a walker who joined late has a line that starts
 * in the middle of it.
 */
export function longestRoute(routes: readonly GeoPoint[][]): GeoPoint[] {
  let best: GeoPoint[] = [];
  for (const route of routes) if (route.length > best.length) best = route;
  return best;
}

/**
 * How far through the walk a moment landed.
 *
 * Returns 0 when the walk's own clock cannot answer — no start, no end, or an
 * end that is not after its start. Zero reads as "at the beginning", which is
 * the least wrong thing an unknown can look like, and the caller can hide the
 * trace entirely if it would rather say nothing.
 *
 * Clamped, because a photo imported from the camera roll can carry a time from
 * outside the walk. A trace filled to 340% would render as a drawing bug.
 */
export function momentProgress(
  capturedAt: string,
  startedAt: string | null,
  endedAt: string | null,
): number {
  const from = startedAt ? Date.parse(startedAt) : NaN;
  const to = endedAt ? Date.parse(endedAt) : NaN;
  const at = Date.parse(capturedAt);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(at)) return 0;
  const span = to - from;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (at - from) / span));
}

/**
 * The backdrop line, projected into a flat strip.
 *
 * Wide and short on purpose — this sits above a row of buttons, not in the
 * middle of the screen. `routeTransform` is the SAME projection the Lock
 * Screen card, the share artwork and the walk summary use, so a walk is the
 * same shape everywhere it is drawn rather than four things that resemble each
 * other.
 */
export function reelTracePoints(
  route: readonly GeoPoint[],
  width: number,
  height: number,
  pad = 4,
): string {
  if (route.length < 2) return '';
  const project = routeTransform(route as GeoPoint[], width, height, pad);
  if (!project) return '';
  return (route as GeoPoint[]).map(point => {
    const { x, y } = project(point);
    return `${x},${y}`;
  }).join(' ');
}
