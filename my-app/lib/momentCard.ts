// Paw Moment card — pure content + geometry for the shareable walk card.
//
// Everything here is renderer-agnostic: copy strings for the card and the
// share sheet, and the polyline→SVG projection the card draws. The visual
// component (components/MomentCard.tsx) and the capture/share flow
// (lib/shareMoment.ts) both consume this module; keeping it pure lets
// momentCard.test.ts enforce the brand voice and the geometry under ts-jest.
//
// All strings must comply with the Pawtchi Copy Spec v1 (same rules as
// lib/referral.ts): no exclamation marks, never "your pet", calm sentence
// case, three sentences max, none of the banned words.

import type { WalkLabels } from './walk/geoLabels';
import { PAWTCHI_INVITE_URL } from './referral';

export interface MomentRoutePoint {
  lat: number;
  lng: number;
}

export interface MomentStats {
  durationS: number;
  movingTimeS: number;
  distanceM: number;
}

export interface MomentStat {
  value: string;
  label: string;
}

function cleanName(name?: string | null): string | null {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** "Thursday 9 July" — the card's date line. */
export function momentDateLine(startedAt: number | Date): string {
  const d = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = d.toLocaleDateString('en-GB', { month: 'long' });
  return `${weekday} ${d.getDate()} ${month}`;
}

/**
 * The journey line under the pet's name: "Riverside Park to Elm Street" for
 * an A→B walk, "Home out to Riverside Park, and back" for a loop. Null when
 * no label survived reverse-geocoding — the card simply omits the line.
 */
export function buildMomentJourneyLine(labels: WalkLabels): string | null {
  const start = cleanName(labels.startLabel);
  const trailing = cleanName(labels.isLoop ? labels.farthestLabel : labels.endLabel);
  if (labels.isLoop) {
    if (start && trailing) return `${start} out to ${trailing}, and back`;
    if (start) return `From ${start}, and back`;
    return trailing ? `Out to ${trailing}, and back` : null;
  }
  if (start && trailing) return `${start} to ${trailing}`;
  if (start) return `From ${start}`;
  return trailing ? `To ${trailing}` : null;
}

/** "2.4", "0.8", "12" — editorial distance, no trailing noise. */
function formatKm(km: number): string {
  const s = km >= 10 ? km.toFixed(0) : km.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** Subject pronoun for a known animal: he / she. "They" only when unknown. */
export function subjectPronoun(gender?: string | null): string {
  if (gender === 'male') return 'he';
  if (gender === 'female') return 'she';
  return 'they';
}

// A zero-sniff walk shorter than this can't honestly claim "didn't stop
// once" — on a five-minute loop the line reads as the card not paying
// attention. Below the threshold the headline owns the brevity instead.
export const QUICK_WALK_MAX_S = 600;

/**
 * The card's headline — deterministic from the walk's own character, never
 * random, and the loops on the drawing corroborate whatever it claims. The
 * ladder puts the most characterful copy where the volume is (1–7 sniffs is
 * the modal walk), keeps the signature line for genuinely sniffy walks, and
 * refuses to over-claim on a short zero-stop loop.
 */
export function buildMomentHeadline(
  petName: string | null | undefined,
  gender: string | null | undefined,
  sniffCount: number,
  durationS: number,
): string {
  const name = (petName ?? '').trim();
  if (!name) return 'A good walk';
  if (sniffCount >= 8) {
    return `You walked straight. ${capitalize(subjectPronoun(gender))} didn't.`;
  }
  if (sniffCount >= 4) {
    return `${name} caught up on the news`;
  }
  if (sniffCount >= 1) {
    return `${name} stopped for the good ones`;
  }
  return durationS < QUICK_WALK_MAX_S ? `A quick one with ${name}` : `${name} didn't stop once`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The stat columns on the card: label + already-united value, so the layout
 * stays a dumb renderer. Distance and time always. Sniffs prefer the real
 * pause COUNT (v3 cards, loops on the line); rows recorded before pause
 * points existed fall back to stopped minutes — and a walk with no pauses
 * claims none.
 */
export function buildMomentStats(
  stats: MomentStats,
  sniffCount?: number | null,
): MomentStat[] {
  const km = stats.distanceM / 1000;
  const minutes = Math.max(1, Math.round(stats.durationS / 60));
  const out: MomentStat[] = [
    { label: 'Distance', value: `${formatKm(km)} km` },
    { label: 'Time', value: `${minutes} min` },
  ];
  if (sniffCount != null) {
    if (sniffCount > 0) out.push({ label: 'Sniffs', value: String(sniffCount) });
    return out;
  }
  const sniffMin = Math.round(Math.max(0, stats.durationS - stats.movingTimeS) / 60);
  if (sniffMin >= 1) {
    out.push({ label: 'Sniffs', value: `${sniffMin} min` });
  }
  return out;
}

/** Text that rides alongside the card image in the share sheet, without the link. */
export function buildMomentShareBody(petName?: string | null): string {
  const name = cleanName(petName);
  return name
    ? `A walk with ${name}, drawn as it happened.`
    : 'A walk, drawn as it happened.';
}

/** Full share-sheet text — body plus the link (Android keeps the URL inline). */
export function buildMomentShareMessage(petName?: string | null): string {
  return `${buildMomentShareBody(petName)} ${PAWTCHI_INVITE_URL}`;
}

// ── Geometry ────────────────────────────────────────────────────────────────

/** Metres per degree of latitude — good enough at walk scale everywhere. */
const M_PER_DEG_LAT = 111_320;

interface RouteProjection {
  points: { x: number; y: number }[];
  /** Pixels per degree of latitude — the projection's single scale factor. */
  pxPerDegLat: number;
}

/**
 * Project the walk polyline into a w×h box with `pad` breathing room on
 * every side, aspect-preserving and centered. Longitude is scaled by
 * cos(midLat) so a route drawn away from the equator keeps its real-world
 * shape. Null when the trace can't draw a line (fewer than 2 points, or all
 * points effectively identical).
 */
function projectRoute(
  route: MomentRoutePoint[],
  w: number,
  h: number,
  pad: number,
): RouteProjection | null {
  if (route.length < 2) return null;

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of route) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const cosMid = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const spanX = (maxLng - minLng) * cosMid;
  const spanY = maxLat - minLat;

  // ~1e-5 degrees ≈ a metre — below that there is no shape to draw.
  const EPS = 1e-5;
  if (spanX < EPS && spanY < EPS) return null;

  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const scale = Math.min(
    spanX > 0 ? innerW / spanX : Infinity,
    spanY > 0 ? innerH / spanY : Infinity,
  );

  const offsetX = pad + (innerW - spanX * scale) / 2;
  const offsetY = pad + (innerH - spanY * scale) / 2;

  const points = route.map(p => ({
    x: Number((offsetX + (p.lng - minLng) * cosMid * scale).toFixed(1)),
    y: Number((offsetY + (maxLat - p.lat) * scale).toFixed(1)),
  }));
  return { points, pxPerDegLat: scale };
}

/** SVG path string for the projected route, or null for degenerate traces. */
export function routeToSvgPath(
  route: MomentRoutePoint[],
  w: number,
  h: number,
  pad: number,
): string | null {
  const proj = projectRoute(route, w, h, pad);
  if (!proj) return null;
  return proj.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
    .join(' ');
}

/** First and last projected points — the card's start ring and end mark. */
export function routeEndpoints(
  route: MomentRoutePoint[],
  w: number,
  h: number,
  pad: number,
): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  const proj = projectRoute(route, w, h, pad);
  if (!proj) return null;
  return { start: proj.points[0], end: proj.points[proj.points.length - 1] };
}

// ── Two lines, one walk ─────────────────────────────────────────────────────
// The owner walks the route; the dog walks AROUND the route. The companion
// line is a deterministic weave (seeded by the walk session id, so a shared
// card renders identically forever) with a loop at every real sniff stop and
// a paw print where it ends. Nothing here is random decoration: loop count
// and positions come straight from the session's pause events.

interface XY {
  x: number;
  y: number;
}

/** FNV-1a — stable 32-bit hash of the session id. Shared with pawPrints. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny deterministic PRNG. Shared with pawPrints. */
export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Evenly respace a polyline (~`spacing` px between points, ends kept). */
function resample(points: XY[], spacing: number): XY[] {
  if (points.length < 2) return points;
  const out: XY[] = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    let prev = points[i - 1];
    const next = points[i];
    let segLen = Math.hypot(next.x - prev.x, next.y - prev.y);
    while (carry + segLen >= spacing) {
      const need = spacing - carry;
      const t = need / segLen;
      const p = { x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t };
      out.push(p);
      prev = p;
      segLen -= need;
      carry = 0;
    }
    carry += segLen;
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > 1) out.push(last);
  return out;
}

/** Catmull-Rom through the points, emitted as cubic beziers — the smoothing
 *  both lines share so they read as drawn, not plotted. Shared with pawPrints. */
export function smoothPath(points: XY[]): string | null {
  if (points.length < 2) return null;
  if (points.length === 2) {
    return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;
  }
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

/** The owner's line: the projected route, smoothed. */
export function buildOwnerPath(
  route: MomentRoutePoint[],
  w: number,
  h: number,
  pad: number,
): string | null {
  const proj = projectRoute(route, w, h, pad);
  if (!proj) return null;
  return smoothPath(proj.points);
}

export interface CompanionLine {
  /** The dog's weaving line. */
  path: string;
  /** One ring per sniff stop, at its true projected location. */
  loops: { x: number; y: number; r: number }[];
  /** Where the owner's line begins (ink dot). */
  start: XY;
  /** Where the paw print sits — just past the companion line's end. */
  paw: XY;
}

/**
 * The dog's line: a seeded perpendicular weave around the owner's path.
 * Amplitude tapers in at the start (they leave the door together) and the
 * end extends a few px past the route so the paw print reads as the final
 * step. Loops are placed at the companion point nearest each pause.
 */
export function buildCompanionPath(
  route: MomentRoutePoint[],
  pausePoints: MomentRoutePoint[],
  w: number,
  h: number,
  pad: number,
  seed: string,
): CompanionLine | null {
  const proj = projectRoute(route, w, h, pad);
  if (!proj) return null;

  const base = resample(proj.points, 12);
  if (base.length < 2) return null;

  const rand = mulberry32(hashSeed(seed));
  const f1 = 2.5 + rand();          // slow weave, 2.5–3.5 crossings
  const f2 = 5 + rand() * 2;        // quick flutter on top
  const ph1 = rand();
  const ph2 = rand();
  const AMP = 5;

  const n = base.length;
  const woven: XY[] = base.map((p, i) => {
    const prev = base[Math.max(0, i - 1)];
    const next = base[Math.min(n - 1, i + 1)];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const t = i / (n - 1);
    const taper = Math.min(1, t / 0.08);
    const off =
      AMP * taper * (0.55 * Math.sin(2 * Math.PI * (f1 * t + ph1)) + 0.45 * Math.sin(2 * Math.PI * (f2 * t + ph2)));
    return { x: p.x + nx * off, y: p.y + ny * off };
  });

  // The last step continues a touch past the route's end — the paw print.
  const a = woven[n - 2];
  const b = woven[n - 1];
  const tailLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const paw = {
    x: Number((b.x + ((b.x - a.x) / tailLen) * 9).toFixed(1)),
    y: Number((b.y + ((b.y - a.y) / tailLen) * 9).toFixed(1)),
  };

  // Loops at the companion point nearest each true pause location. Pause
  // points sit on the route by construction, so anchor each to its nearest
  // route vertex (already projected), then to the woven point nearest that.
  const loops = pausePoints.map(pp => {
    let nearestRoute = 0;
    let bestD = Infinity;
    route.forEach((rp, i) => {
      const d = (rp.lat - pp.lat) ** 2 + (rp.lng - pp.lng) ** 2;
      if (d < bestD) {
        bestD = d;
        nearestRoute = i;
      }
    });
    const anchor = proj.points[nearestRoute];
    let nearestWoven = woven[0];
    let bestW = Infinity;
    for (const wp of woven) {
      const d = (wp.x - anchor.x) ** 2 + (wp.y - anchor.y) ** 2;
      if (d < bestW) {
        bestW = d;
        nearestWoven = wp;
      }
    }
    return {
      x: Number(nearestWoven.x.toFixed(1)),
      y: Number(nearestWoven.y.toFixed(1)),
      r: Number((5 + rand() * 2).toFixed(1)),
    };
  });

  const path = smoothPath(woven);
  if (!path) return null;

  return { path, loops, start: proj.points[0], paw };
}

/** Round distances a scale bar is allowed to claim. */
const SCALE_BAR_STEPS_M = [25, 50, 100, 250, 500, 1000, 2000, 5000] as const;

export interface RouteScaleBar {
  /** Bar length in the same pixel space as routeToSvgPath. */
  px: number;
  /** "250 m" / "1 km" */
  label: string;
}

/**
 * A map-true scale bar for the drawn route: the longest round distance
 * (25 m … 5 km) that fits within `maxPx` at the projection's actual scale.
 * Null when the route is degenerate or no step renders at a legible length —
 * a wrong or unreadable scale bar is worse than none.
 */
export function routeScaleBar(
  route: MomentRoutePoint[],
  w: number,
  h: number,
  pad: number,
  maxPx: number = Math.round(w * 0.35),
): RouteScaleBar | null {
  const proj = projectRoute(route, w, h, pad);
  if (!proj) return null;

  const pxPerMeter = proj.pxPerDegLat / M_PER_DEG_LAT;
  const MIN_LEGIBLE_PX = 24;

  let best: RouteScaleBar | null = null;
  for (const m of SCALE_BAR_STEPS_M) {
    const px = m * pxPerMeter;
    if (px > maxPx) break;
    if (px >= MIN_LEGIBLE_PX) {
      best = {
        px: Number(px.toFixed(1)),
        label: m >= 1000 ? `${m / 1000} km` : `${m} m`,
      };
    }
  }
  return best;
}
