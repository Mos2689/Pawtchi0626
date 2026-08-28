/**
 * routeSvg — reusable projection helpers for rendering a walk_sessions.route
 * polyline as an SVG string.
 *
 * The projection is equirectangular scaled to a bounding box with padding —
 * accurate enough at walk scale (the whole trace fits inside a card). Used by
 * both the post-walk summary and the Home tracked-walk cards, so a single
 * source of truth avoids "the same walk looking different in two places."
 */

import { GeoPoint } from './geo';

export interface RouteProjection {
  /** SVG "x,y x,y ..." points string for <Polyline>. */
  points: string;
  /** Endpoints as {x, y} tuples for start/finish dots on the trace. */
  start: { x: number; y: number } | null;
  end: { x: number; y: number } | null;
}

/**
 * The route's fitted transform, as a reusable function.
 *
 * Extracted so anything drawn ALONGSIDE the route — a photo taken partway
 * round, a sniff stop — goes through the exact same projection. Recomputing a
 * similar-looking transform at the call site is how a pin ends up floating
 * beside the line instead of on it, and the error is invisible until someone
 * looks closely at their own walk.
 */
export function routeTransform(
  route: GeoPoint[],
  width: number,
  height: number,
  pad = 14,
): ((point: GeoPoint) => { x: number; y: number }) | null {
  if (!route || route.length < 2) return null;

  const midLat = route.reduce((s, p) => s + p.lat, 0) / route.length;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const xs = route.map(p => p.lng * cosLat);
  const ys = route.map(p => p.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;

  return (point: GeoPoint) => {
    const x = offX + (point.lng * cosLat - minX) * scale;
    const y = height - (offY + (point.lat - minY) * scale);
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  };
}

export function projectRouteToSvg(
  route: GeoPoint[],
  width: number,
  height: number,
  pad = 14,
): RouteProjection {
  const project = routeTransform(route, width, height, pad);
  if (!project) {
    return { points: '', start: null, end: null };
  }

  const projected = route.map(project);
  const points = projected.map(p => `${p.x},${p.y}`).join(' ');
  return {
    points,
    start: projected[0],
    end: projected[projected.length - 1],
  };
}

/**
 * Place arbitrary coordinates into the route's drawing space.
 *
 * The reason the story can show a walk as a line with the moments ON it: each
 * photo lands where it was actually taken, under the same fit as the trace.
 * Coordinates outside the route's bounds still project (they simply fall
 * outside the padding) — the caller decides whether to clamp or drop them.
 */
export function projectOntoRoute(
  route: GeoPoint[],
  targets: readonly GeoPoint[],
  width: number,
  height: number,
  pad = 14,
): { x: number; y: number }[] {
  const project = routeTransform(route, width, height, pad);
  if (!project) return [];
  return targets.map(project);
}
