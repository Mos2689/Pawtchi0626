/**
 * The sign-up progress bar is a little walk: a winding route that fills in
 * yellow as each question is answered, with a paw marker walking toward home.
 *
 * react-native-svg cannot measure a path, so the curve is sampled here into
 * points with cumulative lengths. The screen animates one number (0–1) and
 * both the yellow fill and the marker position are read from these arrays on
 * the UI thread. Pure and tested (routeGeometry.test.ts).
 */

export interface SampledRoute {
  /** SVG `d` for the whole route. */
  d: string;
  xs: number[];
  ys: number[];
  /** Cumulative length at each sample; the last entry is the total. */
  lengths: number[];
  total: number;
}

type P = { x: number; y: number };

function cubic(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/**
 * A gentle two-bend route across `width` × `height`, inset by `pad` so the
 * marker never clips at either end.
 */
export function sampleRoute(width: number, height: number, pad = 10, samples = 48): SampledRoute {
  const mid = height / 2;
  const amp = Math.max(2, height / 2 - pad / 2);
  const left = pad;
  const right = width - pad;
  const span = right - left;
  const a: [P, P, P, P] = [
    { x: left, y: mid },
    { x: left + span * 0.17, y: mid - amp },
    { x: left + span * 0.26, y: mid + amp },
    { x: left + span * 0.5, y: mid },
  ];
  const b: [P, P, P, P] = [
    { x: left + span * 0.5, y: mid },
    { x: left + span * 0.74, y: mid - amp },
    { x: left + span * 0.83, y: mid + amp * 0.6 },
    { x: right, y: mid },
  ];
  const xs: number[] = [];
  const ys: number[] = [];
  const half = Math.max(2, Math.floor(samples / 2));
  for (const seg of [a, b]) {
    for (let i = 0; i <= half; i++) {
      if (seg === b && i === 0) continue;
      const p = cubic(seg[0], seg[1], seg[2], seg[3], i / half);
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  const lengths = [0];
  for (let i = 1; i < xs.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  }
  const f = (n: number) => Math.round(n * 10) / 10;
  const d =
    `M ${f(a[0].x)} ${f(a[0].y)} ` +
    `C ${f(a[1].x)} ${f(a[1].y)}, ${f(a[2].x)} ${f(a[2].y)}, ${f(a[3].x)} ${f(a[3].y)} ` +
    `C ${f(b[1].x)} ${f(b[1].y)}, ${f(b[2].x)} ${f(b[2].y)}, ${f(b[3].x)} ${f(b[3].y)}`;
  return { d, xs, ys, lengths, total: lengths[lengths.length - 1] };
}

/**
 * The point `fraction` (0–1) of the way along. A worklet so the marker can be
 * placed on the UI thread every frame of the progress animation.
 */
export function pointAlong(
  xs: readonly number[],
  ys: readonly number[],
  lengths: readonly number[],
  fraction: number,
): { x: number; y: number } {
  'worklet';
  const n = lengths.length;
  if (n === 0) return { x: 0, y: 0 };
  const total = lengths[n - 1];
  const target = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 1; i < n; i++) {
    if (lengths[i] >= target) {
      const seg = lengths[i] - lengths[i - 1] || 1;
      const t = (target - lengths[i - 1]) / seg;
      return { x: xs[i - 1] + (xs[i] - xs[i - 1]) * t, y: ys[i - 1] + (ys[i] - ys[i - 1]) * t };
    }
  }
  return { x: xs[n - 1], y: ys[n - 1] };
}
