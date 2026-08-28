/**
 * mapCamera — Web Mercator framing and projection.
 *
 * Home draws its own markers as views floating over the basemap (pastel dots
 * with label pills), which only works if we know exactly where a coordinate
 * lands on screen. The map SDKs won't tell us, so instead of guessing we take
 * control of the camera: Home computes the centre and zoom, hands the same
 * numbers to both the map and this projector, and the two are consistent by
 * construction rather than by luck.
 *
 * Standard Web Mercator, the projection every slippy map uses: the world is a
 * square of `TILE * 2^zoom` pixels, longitude is linear across it and latitude
 * is the usual log-tangent stretch.
 */

import type { GeoPoint } from './geo';

/** Tile size the zoom scale is defined against — 256 is the web standard. */
const TILE = 256;

/** Beyond ~85° Mercator runs to infinity; clamp so a bad fix can't blow up. */
const MAX_LAT = 85.05112878;

export interface MapCamera {
  center: GeoPoint;
  zoom: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

function clampLat(lat: number): number {
  return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
}

/** Longitude → [0,1] across the world square. */
function normX(lng: number): number {
  return (lng + 180) / 360;
}

/** Latitude → [0,1] down the world square. */
function normY(lat: number): number {
  const rad = (clampLat(lat) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

function normXToLng(x: number): number {
  return x * 360 - 180;
}

function normYToLat(y: number): number {
  const n = Math.PI * (1 - 2 * y);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/**
 * Inset kept clear of the framed content, in px.
 *
 * Per-edge rather than only uniform, because markers are not points: a photo
 * card hangs ~60px ABOVE the coordinate it marks and nothing below it, so a
 * single number either clips the card at the top or wastes the same amount at
 * the bottom. Uniform padding cannot express "reserve room on one side".
 */
export type FitPadding =
  | number
  | { top?: number; right?: number; bottom?: number; left?: number };

export interface FitOptions {
  width: number;
  height: number;
  padding?: FitPadding;
  minZoom?: number;
  maxZoom?: number;
  /** Used when the points collapse to a single place with no span to fit. */
  pointZoom?: number;
}

function resolvePadding(padding: FitPadding): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return {
    top: padding.top ?? 0,
    right: padding.right ?? 0,
    bottom: padding.bottom ?? 0,
    left: padding.left ?? 0,
  };
}

/**
 * Frame a set of points, or centre on the single one they collapse to.
 *
 * Returns null only when there is nothing to frame — callers decide what an
 * empty map should do rather than being handed an arbitrary place.
 */
export function fitCamera(
  points: readonly GeoPoint[],
  opts: FitOptions,
): MapCamera | null {
  const usable = points.filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
  if (usable.length === 0) return null;

  const {
    width,
    height,
    padding = 0,
    minZoom = 3,
    maxZoom = 17,
    pointZoom = 14,
  } = opts;

  const xs = usable.map(p => normX(p.lng));
  const ys = usable.map(p => normY(p.lat));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const pad = resolvePadding(padding);

  // Where the content should end up: the middle of the padded box, which is
  // only the middle of the VIEW when the padding is symmetric.
  const boxCx = pad.left + Math.max(1, width - pad.left - pad.right) / 2;
  const boxCy = pad.top + Math.max(1, height - pad.top - pad.bottom) / 2;

  const contentX = (minX + maxX) / 2;
  const contentY = (minY + maxY) / 2;

  /**
   * Shift the camera so the content lands at the padded box's centre.
   *
   * `projectPoint` puts the camera centre at the middle of the view, so to draw
   * the content centre at (boxCx, boxCy) instead, the camera centre has to move
   * the opposite way by the same pixel offset — converted to world units, which
   * needs the zoom, hence doing this after the zoom is known.
   */
  const recentre = (zoom: number): GeoPoint => {
    const worldSize = TILE * Math.pow(2, zoom);
    return {
      lat: normYToLat(contentY + (height / 2 - boxCy) / worldSize),
      lng: normXToLng(contentX + (width / 2 - boxCx) / worldSize),
    };
  };

  const spanX = maxX - minX;
  const spanY = maxY - minY;

  // No span to fit — one point, or several on top of each other.
  if (spanX <= 0 && spanY <= 0) {
    const zoom = clamp(pointZoom, minZoom, maxZoom);
    return { center: recentre(zoom), zoom };
  }

  const usableW = Math.max(1, width - pad.left - pad.right);
  const usableH = Math.max(1, height - pad.top - pad.bottom);

  // How far we can zoom before the span stops fitting, on each axis.
  const zoomX = spanX > 0 ? Math.log2(usableW / (spanX * TILE)) : Infinity;
  const zoomY = spanY > 0 ? Math.log2(usableH / (spanY * TILE)) : Infinity;

  const zoom = clamp(Math.min(zoomX, zoomY), minZoom, maxZoom);
  return { center: recentre(zoom), zoom };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Where a coordinate lands, in px from the top-left of a `width × height` view
 * showing `camera`. Points outside the view return coordinates outside it —
 * clamping is the caller's decision, since a marker may want to hug an edge.
 */
export function projectPoint(
  point: GeoPoint,
  camera: MapCamera,
  width: number,
  height: number,
): ScreenPoint {
  const worldSize = TILE * Math.pow(2, camera.zoom);
  const dx = (normX(point.lng) - normX(camera.center.lng)) * worldSize;
  const dy = (normY(point.lat) - normY(camera.center.lat)) * worldSize;
  return { x: width / 2 + dx, y: height / 2 + dy };
}

/**
 * The lat/lng rectangle a camera actually shows in a `width × height` view.
 *
 * The inverse of `projectPoint` at the two screen corners. Used to hand a
 * camera to an SDK that frames by BOUNDS rather than by a zoom number — which
 * is the only way to talk to MapLibre without betting on whose zoom convention
 * it uses (see `toRegionZoom` for what that bet costs).
 */
export function cameraBounds(
  camera: MapCamera,
  width: number,
  height: number,
): { ne: GeoPoint; sw: GeoPoint } {
  const worldSize = TILE * Math.pow(2, camera.zoom);
  const cx = normX(camera.center.lng);
  const cy = normY(camera.center.lat);
  const halfX = width / 2 / worldSize;
  const halfY = height / 2 / worldSize;
  return {
    // y grows downward in Mercator, so the NORTH edge is the smaller y.
    ne: { lat: normYToLat(cy - halfY), lng: normXToLng(cx + halfX) },
    sw: { lat: normYToLat(cy + halfY), lng: normXToLng(cx - halfX) },
  };
}

/**
 * Recover a camera from the rectangle a map says it is showing.
 *
 * Only the longitude span is used for the zoom: longitude is linear in
 * Mercator, so `width px ↔ lngSpan degrees` fixes the scale exactly, with no
 * latitude term and no assumption about the map's aspect ratio. Latitude is
 * used only to find the centre.
 */
export function cameraFromBounds(
  ne: GeoPoint,
  sw: GeoPoint,
  width: number,
): MapCamera | null {
  let lngSpan = ne.lng - sw.lng;
  // A viewport straddling the antimeridian comes back as a negative span.
  if (lngSpan < 0) lngSpan += 360;
  if (!(lngSpan > 0) || !(width > 0)) return null;

  const worldSize = (360 * width) / lngSpan;

  // Wrapped back into [-180, 180] so a viewport crossing the antimeridian
  // reports a real longitude rather than 190°.
  let centerLng = sw.lng + lngSpan / 2;
  if (centerLng > 180) centerLng -= 360;
  if (centerLng < -180) centerLng += 360;

  return {
    center: {
      // Mercator midpoint, not the arithmetic mean of the latitudes — the
      // screen centre is halfway down the projection, not halfway up the globe.
      lat: normYToLat((normY(ne.lat) + normY(sw.lat)) / 2),
      lng: centerLng,
    },
    zoom: Math.log2(worldSize / TILE),
  };
}

/**
 * ── The other zoom convention, and why this exists ──
 *
 * `projectPoint` above uses the Web Mercator standard every slippy map is
 * defined against: the world is `256 · 2^zoom` px across, so a view `width` px
 * wide shows `360 · width / (256 · 2^zoom)` degrees of longitude.
 *
 * MapKit, as expo-maps drives it, means something different by the same word.
 * `MapUtils.swift` builds its region as `longitudeDelta = 360 / 2^zoom` — the
 * WHOLE VIEW spans that many degrees, whatever the view's width happens to be.
 * The two agree only on a view exactly 256 px wide. On a 390 pt phone the map
 * was rendering about one and a half times closer than the projector believed,
 * so every pin was pulled toward the centre of the screen, further the further
 * out it sat. That is a silent, systematic misplacement — a coastal park could
 * land in the sea — and nothing in the type system could catch it, because
 * `AppleMaps` is required lazily and typed `any`.
 *
 * MapKit expands a region to fit the view, taking whichever axis binds first,
 * so the displayed world size is `min(width, height · cos φ) · 2^regionZoom`
 * (a degree of latitude occupies `1/cos φ` as many pixels as a degree of
 * longitude). Solving that against `256 · 2^zoom` gives the conversion below.
 *
 * `fromViewportZoom` is deliberately NOT its inverse: a map REPORTS the true
 * longitude span it ended up showing, which is a horizontal measurement with no
 * fitting and no latitude in it.
 */
function fitExtentPx(width: number, height: number, lat: number): number {
  const cos = Math.cos((clampLat(lat) * Math.PI) / 180);
  return Math.max(1, Math.min(width, height * cos));
}

/** Web Mercator zoom → the zoom a region-framing SDK (MapKit) wants. */
export function toRegionZoom(
  camera: MapCamera,
  width: number,
  height: number,
): number {
  return camera.zoom + Math.log2(TILE / fitExtentPx(width, height, camera.center.lat));
}

/** A reported `log2(360 / visible longitude span)` → Web Mercator zoom. */
export function fromViewportZoom(reportedZoom: number, width: number): number {
  return reportedZoom + Math.log2(Math.max(1, width) / TILE);
}

/** True when a projected point sits inside the view, with an optional margin. */
export function isOnScreen(
  p: ScreenPoint,
  width: number,
  height: number,
  margin = 0,
): boolean {
  return (
    p.x >= -margin && p.x <= width + margin && p.y >= -margin && p.y <= height + margin
  );
}
