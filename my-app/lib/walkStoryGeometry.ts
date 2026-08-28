import type { MomentRoutePoint, SniffStop } from './momentCard';
import { hashSeed, mulberry32, smoothPath } from './momentCard';

export interface StoryPoint {
  x: number;
  y: number;
}

export interface StoryStopPoint extends StoryPoint {
  dwellS: number;
  sourceIndex: number;
}

export interface StoryRouteGeometry {
  path: string;
  points: StoryPoint[];
  start: StoryPoint;
  end: StoryPoint;
  stops: StoryStopPoint[];
}

export const MAX_STORY_ROUTE_POINTS = 240;
export const MAX_STORY_SPOTS = 10;

function isFinitePoint(point: MomentRoutePoint | null | undefined): point is MomentRoutePoint {
  return Boolean(point && Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

/** Keeps the route's ends and overall shape while bounding SVG work. */
export function resampleStoryRoute(
  route: MomentRoutePoint[],
  maxPoints = MAX_STORY_ROUTE_POINTS,
): MomentRoutePoint[] {
  const valid = route.filter(isFinitePoint);
  if (valid.length <= maxPoints) return valid;
  const count = Math.max(2, Math.floor(maxPoints));
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round((index * (valid.length - 1)) / (count - 1));
    return valid[sourceIndex];
  });
}

/**
 * Dense walks keep the longest dwells, restored to recorded order so the
 * visible markers still read chronologically. The metric always reports the
 * full stop count; this selection is visual decluttering only.
 */
export function selectStoryStops(
  stops: SniffStop[],
  limit = MAX_STORY_SPOTS,
): { stop: SniffStop; sourceIndex: number }[] {
  return stops
    .map((stop, sourceIndex) => ({ stop, sourceIndex }))
    .filter(({ stop }) => isFinitePoint(stop) && Number.isFinite(stop.dwellS))
    .sort((a, b) => b.stop.dwellS - a.stop.dwellS || a.sourceIndex - b.sourceIndex)
    .slice(0, Math.max(0, limit))
    .sort((a, b) => a.sourceIndex - b.sourceIndex);
}

function projectPoint(
  point: MomentRoutePoint,
  minLat: number,
  maxLat: number,
  minLng: number,
  cosMid: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): StoryPoint {
  return {
    x: Number((offsetX + (point.lng - minLng) * cosMid * scale).toFixed(1)),
    y: Number((offsetY + (maxLat - point.lat) * scale).toFixed(1)),
  };
}

export function projectStoryRoute(
  route: MomentRoutePoint[],
  sniffStops: SniffStop[],
  width: number,
  height: number,
  pad: number,
): StoryRouteGeometry | null {
  if (![width, height, pad].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const sampled = resampleStoryRoute(route);
  if (sampled.length < 2) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const point of sampled) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  }

  const cosMid = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const spanX = (maxLng - minLng) * cosMid;
  const spanY = maxLat - minLat;
  if (spanX < 1e-5 && spanY < 1e-5) return null;

  const safePad = Math.max(0, Math.min(pad, Math.min(width, height) / 3));
  const innerWidth = Math.max(1, width - safePad * 2);
  const innerHeight = Math.max(1, height - safePad * 2);
  const scale = Math.min(
    spanX > 0 ? innerWidth / spanX : Infinity,
    spanY > 0 ? innerHeight / spanY : Infinity,
  );
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const offsetX = safePad + (innerWidth - spanX * scale) / 2;
  const offsetY = safePad + (innerHeight - spanY * scale) / 2;
  const points = sampled.map((point) =>
    projectPoint(point, minLat, maxLat, minLng, cosMid, scale, offsetX, offsetY),
  );
  const path = smoothPath(points);
  if (!path) return null;

  const stops = selectStoryStops(sniffStops).map(({ stop, sourceIndex }) => ({
    ...projectPoint(stop, minLat, maxLat, minLng, cosMid, scale, offsetX, offsetY),
    dwellS: stop.dwellS,
    sourceIndex,
  }));

  return {
    path,
    points,
    start: points[0],
    end: points[points.length - 1],
    stops,
  };
}

export function longestStoryStop(stops: SniffStop[]): SniffStop | null {
  return (
    stops
      .filter(({ lat, lng, dwellS }) =>
        [lat, lng, dwellS].every(Number.isFinite),
      )
      .sort((a, b) => b.dwellS - a.dwellS)[0] ?? null
  );
}

export function contourRingCount(dwellS: number): number {
  if (!Number.isFinite(dwellS) || dwellS <= 0) return 5;
  return Math.max(5, Math.min(12, 5 + Math.floor(dwellS / 30)));
}

function closedSmoothPath(points: StoryPoint[]): string {
  if (points.length < 3) return '';
  const count = points.length;
  let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let index = 0; index < count; index += 1) {
    const p0 = points[(index - 1 + count) % count];
    const p1 = points[index];
    const p2 = points[(index + 1) % count];
    const p3 = points[(index + 2) % count];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    path += ` C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return `${path} Z`;
}

/**
 * A stable scent topography. Ring count carries dwell; the session seed only
 * supplies small hand-drawn variations and never changes the recorded facts.
 */
export function buildScentContours(
  center: StoryPoint,
  maxRadius: number,
  dwellS: number,
  seed: string,
): string[] {
  const count = contourRingCount(dwellS);
  const rand = mulberry32(hashSeed(seed));
  const phaseA = rand() * Math.PI * 2;
  const phaseB = rand() * Math.PI * 2;
  return Array.from({ length: count }, (_, ringIndex) => {
    const radius = Math.max(10, (maxRadius * (ringIndex + 1)) / count);
    const points = Array.from({ length: 28 }, (__, pointIndex) => {
      const angle = (pointIndex / 28) * Math.PI * 2;
      const wobble =
        1 +
        0.055 * Math.sin(angle * 3 + phaseA + ringIndex * 0.15) +
        0.035 * Math.sin(angle * 5 + phaseB - ringIndex * 0.11);
      return {
        x: center.x + Math.cos(angle) * radius * wobble,
        y: center.y + Math.sin(angle) * radius * 1.08 * wobble,
      };
    });
    return closedSmoothPath(points);
  });
}

export function buildCadencePath(
  width: number,
  baseline: number,
  amplitude: number,
  cycles: number,
): string {
  const segments = 96;
  const points = Array.from({ length: segments + 1 }, (_, index) => {
    const t = index / segments;
    return {
      x: width * t,
      y: baseline - Math.sin(t * Math.PI * 2 * cycles) * amplitude,
    };
  });
  return smoothPath(points) ?? '';
}

export function buildWeatherFlowPaths(
  width: number,
  height: number,
  seed: string,
  count = 6,
): string[] {
  const rand = mulberry32(hashSeed(seed));
  return Array.from({ length: count }, (_, row) => {
    const baseline = ((row + 1) / (count + 1)) * height;
    const amplitude = height * (0.025 + rand() * 0.025);
    const phase = rand() * Math.PI * 2;
    const points = Array.from({ length: 36 }, (__, index) => {
      const t = index / 35;
      return {
        x: width * t,
        y: baseline + Math.sin(t * Math.PI * 2.2 + phase) * amplitude,
      };
    });
    return smoothPath(points) ?? '';
  });
}

export function formatStoryCoordinate(value: number, axis: 'lat' | 'lng'): string {
  if (!Number.isFinite(value)) return '—';
  const direction = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${Math.abs(value).toFixed(4)}° ${direction}`;
}

