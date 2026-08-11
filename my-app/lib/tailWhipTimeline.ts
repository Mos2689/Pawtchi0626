// ─────────────────────────────────────────────────────────────────────────────
// The Success Ribbon — geometry + timeline math for Pawtchi's signature
// walk-finish transition. A flowing brand ribbon is painted across the screen
// in a left→right→left wag (an animated SVG stroke, drawn via strokeDashoffset
// — the same primitive as PulseMark / HealthRings), the walk screen crossfades
// to the success screen underneath it, and the ribbon flows off.
//
// The path lives in a fixed viewBox and is stretched to the screen, so the
// stroke length is constant regardless of device. Pure data + math only (no
// reanimated import) so ts-jest can run it.
// ─────────────────────────────────────────────────────────────────────────────

// ── The ribbon path ──────────────────────────────────────────────────────────
// Cubic-bezier segments in viewBox units. The wag: paints in from off the
// bottom-left, sweeps right, flows back left, then off the top-right.
export const RIBBON_VIEWBOX = { w: 274, h: 590 } as const;
/** Stroke thickness in viewBox units (scales with the screen). */
export const RIBBON_STROKE = 50;
/** The soft halo behind the ribbon is this much wider. */
export const RIBBON_HALO = 30;

type Pt = readonly [number, number];
type Seg = readonly [Pt, Pt, Pt]; // c1, c2, end

const RIBBON_START: Pt = [-60, 470];
const RIBBON_SEGS: readonly Seg[] = [
  [[100, 545], [215, 505], [292, 402]],
  [[205, 300], [25, 335], [70, 222]],
  [[105, 118], [255, 150], [344, 44]],
];

/** The SVG path `d` string for the ribbon. */
export function ribbonPathD(): string {
  let d = `M ${RIBBON_START[0]} ${RIBBON_START[1]}`;
  for (const [c1, c2, e] of RIBBON_SEGS) {
    d += ` C ${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${e[0]} ${e[1]}`;
  }
  return d;
}

function cubicPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

/** Arc length of the ribbon path in viewBox units (sampled). Deterministic. */
export function ribbonLength(samples = 60): number {
  let total = 0;
  let from: Pt = RIBBON_START;
  for (const [c1, c2, end] of RIBBON_SEGS) {
    let prev = from;
    for (let i = 1; i <= samples; i++) {
      const p = cubicPoint(from, c1, c2, end, i / samples);
      total += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
    }
    from = end;
  }
  return total;
}

// ── Easings (used by the summary reveal in walk.tsx) ──────────────────────────

function clamp01(v: number): number {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function easeOutQuart(p: number): number {
  'worklet';
  const q = 1 - clamp01(p);
  return 1 - q * q * q * q;
}

export function easeInOutCubic(p: number): number {
  'worklet';
  const t = clamp01(p);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutBack(p: number): number {
  'worklet';
  const t = clamp01(p);
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

/** Smoothstep — the flow shape for the ribbon draw and the crossfade. */
export function smoothstep(p: number): number {
  'worklet';
  const t = clamp01(p);
  return t * t * (3 - 2 * t);
}

// ── Fur dust ─────────────────────────────────────────────────────────────────
// Tiny glowing fur dust the ribbon sheds as it flows off. Deterministic per
// seed so specs are unit-testable.

export function seededRandom(seed: number): number {
  'worklet';
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function rand(seed: number, salt: number): number {
  'worklet';
  return seededRandom(Math.imul(seed | 0, 8191) + salt * 131 + 17);
}

export interface FurDustSpec {
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
  opacity: number;
  delay: number;
}

export const PARTICLE_COUNT = 14;

/** Particles scatter across the screen and drift up-right as the ribbon flows off. */
export function makeFurDust(seed: number, w: number, h: number): FurDustSpec[] {
  const specs: FurDustSpec[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    specs.push({
      x: w * (0.35 + rand(seed, i * 7 + 1) * 0.6),
      y: h * (0.05 + rand(seed, i * 7 + 2) * 0.65),
      dx: 5 + rand(seed, i * 7 + 3) * 15,
      dy: -(4 + rand(seed, i * 7 + 4) * 13),
      size: 1 + rand(seed, i * 7 + 5) * 2,
      opacity: 0.2 + rand(seed, i * 7 + 6) * 0.3,
      delay: rand(seed, i * 7 + 7) * 90,
    });
  }
  return specs;
}
