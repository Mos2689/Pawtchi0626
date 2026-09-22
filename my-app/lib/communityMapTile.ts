/**
 * OpenStreetMap raster tiles, used as a still photograph of a place.
 *
 * ── Why tiles and not a map ────────────────────────────────────────────────
 *
 * A Trail card wants to show where the pack meets. The obvious way is a map
 * view, and it is the wrong way here: a scrolling list of live MapLibre or
 * expo-maps instances is the single most expensive thing that can go in a list,
 * and none of them would ever be panned. What the card needs is a picture of a
 * place, and a raster tile already is one.
 *
 * ── Why a grid and not one tile ────────────────────────────────────────────
 *
 * The first version placed a single tile and slid it so the meeting point
 * landed in the middle. That cannot work, and the arithmetic says so: to cover
 * a window of width W with one tile centred on a point sitting at fraction f
 * across it, you need `size >= W / (2f)` AND `size >= W / (2(1-f))`. As f
 * approaches either edge of its tile, the required size runs to infinity — so
 * a meeting point near a tile boundary always left a blank band down one side
 * of the card, which is exactly what it looked like.
 *
 * A grid has no such failure mode. Compute the window in world pixels, then lay
 * down every tile that intersects it. Two or three tiles wide, one or two tall,
 * and the hero is covered for any point on earth.
 *
 * ── Caching is not optional ────────────────────────────────────────────────
 *
 * OSM's tile policy discourages heavy automated use. Tiles are immutable for a
 * given z/x/y, so the URL is a perfect cache key and React Native's image cache
 * does the work for free — provided the zoom stays fixed and nothing
 * cache-busts. Never append a changing query parameter to these URLs.
 */

/** OSM serves 256px tiles. */
export const TILE_SIZE = 256;

/**
 * Close enough to read the street you are meeting on, wide enough that two
 * trails at the same park share tiles and therefore cache hits. Fixed rather
 * than per-card: a variable zoom would multiply the number of distinct tiles
 * fetched for a difference nobody can see at 132px tall.
 */
export const TRAIL_TILE_ZOOM = 16;

/** Web Mercator cannot represent the poles; this is the usual cutoff. */
const MAX_LAT = 85.05112878;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface WorldPoint {
  /** Pixel position across the whole world at this zoom. */
  x: number;
  y: number;
  z: number;
}

/**
 * Where a coordinate falls in world pixel space.
 *
 * Standard slippy-map arithmetic. Longitude wraps and latitude clamps, so a bad
 * coordinate yields an edge of the map rather than NaN — a card showing the
 * wrong ocean is recoverable, a card that crashes the list is not.
 */
export function worldPixel(
  lat: number,
  lng: number,
  zoom: number = TRAIL_TILE_ZOOM,
): WorldPoint | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const span = TILE_SIZE * 2 ** zoom;
  const safeLat = clamp(lat, -MAX_LAT, MAX_LAT);
  // Wrap rather than clamp: longitude is cyclic, and 181° is a real place.
  const safeLng = ((((lng + 180) % 360) + 360) % 360) - 180;
  const rad = (safeLat * Math.PI) / 180;

  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * span;

  return {
    x: ((safeLng + 180) / 360) * span,
    // Clamped, not just derived: MAX_LAT is the latitude where y should land
    // exactly on 0, and floating point puts it a ten-thousandth of a pixel the
    // wrong side. That is enough for the row arithmetic below to ask for tile
    // -1 and drop the top of the hero.
    y: clamp(y, 0, span),
    z: zoom,
  };
}

/**
 * The tile image itself.
 *
 * `tile.openstreetmap.org` rather than a numbered subdomain: the subdomains are
 * deprecated, and HTTP/2 makes them pointless anyway.
 */
export function osmTileUrl(z: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

export interface HeroTile {
  key: string;
  url: string;
  left: number;
  top: number;
  size: number;
}

/**
 * Every tile needed to fill a card hero, positioned relative to its top-left.
 *
 * The meeting point ends up dead centre of the window, and the window is fully
 * covered — corner to corner — for any input. Tiles that would fall off the top
 * or bottom of the world are dropped rather than clamped, because a repeated
 * polar tile is a picture of somewhere the trail is not; that only happens
 * within a few hundred metres of a pole.
 */
export function heroTiles(
  lat: number,
  lng: number,
  width: number,
  height: number,
  zoom: number = TRAIL_TILE_ZOOM,
): HeroTile[] | null {
  const point = worldPixel(lat, lng, zoom);
  if (!point || width <= 0 || height <= 0) return null;

  const across = 2 ** zoom;
  // Top-left of the visible window, in world pixels.
  const originX = point.x - width / 2;
  const originY = point.y - height / 2;

  const firstX = Math.floor(originX / TILE_SIZE);
  const lastX = Math.floor((originX + width - 1) / TILE_SIZE);
  const firstY = Math.floor(originY / TILE_SIZE);
  const lastY = Math.floor((originY + height - 1) / TILE_SIZE);

  const tiles: HeroTile[] = [];
  for (let ty = firstY; ty <= lastY; ty += 1) {
    if (ty < 0 || ty >= across) continue;
    for (let tx = firstX; tx <= lastX; tx += 1) {
      // The world wraps east-west, so a window straddling the antimeridian
      // picks up tiles from the other side rather than a gap.
      const wrappedX = ((tx % across) + across) % across;
      tiles.push({
        key: `${zoom}/${wrappedX}/${ty}`,
        url: osmTileUrl(zoom, wrappedX, ty),
        left: tx * TILE_SIZE - originX,
        top: ty * TILE_SIZE - originY,
        size: TILE_SIZE,
      });
    }
  }
  return tiles.length > 0 ? tiles : null;
}
