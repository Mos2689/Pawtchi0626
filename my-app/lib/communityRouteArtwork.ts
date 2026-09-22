/** How long one party's path takes to draw itself on, and the gap between them. */
export const REPLAY_DRAW_MS = 900;
export const REPLAY_STAGGER_MS = 260;

/**
 * The whole replay, end to end. The artwork animates it and the memory screen
 * decides when to hand back to the settled, patterned lines, so the two agree
 * on the length here instead of guessing it in two places.
 */
export function packReplayDurationMs(routeCount: number): number {
  if (routeCount <= 0) return 0;
  return REPLAY_DRAW_MS + (routeCount - 1) * REPLAY_STAGGER_MS;
}

export interface ArtworkPoint { lat: number; lng: number }
export interface ArtworkRoute {
  points: string;
  start: { x: number; y: number } | null;
  /**
   * Drawn length in canvas units, so a replay can dash a line on at its own
   * pace. It is a property of the artwork, not of the walk: a long route drawn
   * small is short here, which is exactly what the stroke has to travel.
   */
  length: number;
}

/**
 * Convert private GPS coordinates into map-free local artwork coordinates.
 * Translation and scale are discarded; the exported shape contains no street,
 * coordinate, or precise endpoint metadata.
 */
export function projectCommunityRoutes(
  routes: readonly (readonly ArtworkPoint[])[],
  width = 360,
  height = 220,
  padding = 24,
): ArtworkRoute[] {
  const valid = routes.map(route => route.filter(point =>
    Number.isFinite(point.lat) && Number.isFinite(point.lng),
  )).filter(route => route.length > 0);
  const all = valid.flat();
  if (!all.length) return [];
  const minLat = Math.min(...all.map(point => point.lat));
  const maxLat = Math.max(...all.map(point => point.lat));
  const minLng = Math.min(...all.map(point => point.lng));
  const maxLng = Math.max(...all.map(point => point.lng));
  const latSpan = Math.max(maxLat - minLat, 0.00001);
  const lngSpan = Math.max(maxLng - minLng, 0.00001);
  const usableW = Math.max(1, width - padding * 2);
  const usableH = Math.max(1, height - padding * 2);
  const scale = Math.min(usableW / lngSpan, usableH / latSpan);
  const drawnW = lngSpan * scale;
  const drawnH = latSpan * scale;
  const offsetX = (width - drawnW) / 2;
  const offsetY = (height - drawnH) / 2;
  return valid.map(route => {
    const projected = route.map(point => ({
      x: offsetX + (point.lng - minLng) * scale,
      y: offsetY + (maxLat - point.lat) * scale,
    }));
    let length = 0;
    for (let i = 1; i < projected.length; i += 1) {
      length += Math.hypot(projected[i].x - projected[i - 1].x, projected[i].y - projected[i - 1].y);
    }
    return {
      points: projected.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '),
      start: projected[0] ?? null,
      // A single recorded point has no length. Rounding up to 1 keeps the dash
      // arithmetic finite so a one-fix route still appears rather than dividing
      // by zero and vanishing.
      length: Math.max(1, length),
    };
  });
}
