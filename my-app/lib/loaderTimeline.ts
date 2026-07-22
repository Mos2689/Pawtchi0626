// ─────────────────────────────────────────────────────────────────────────────
// The Living Paw — pure timeline math for Pawtchi's global loader.
//
// Five "Moments" (a walk, a meal, sleep, affection… conceptual, never drawn as
// icons) drift, discover each other, and briefly organise into a paw:
// Observe → Connect → Understand → Care. The paw is a passing moment of
// clarity, not a logo reveal — it emerges from the motion.
//
// Everything here is deterministic: pose = f(elapsedMs, index, seed, flavor).
// A per-cycle seed varies scatter directions, arrival order, drift and halo
// within tight bounds so no two cycles are identical, while adjacent phases
// stay mathematically continuous (no visible seam, ever).
//
// NOTE: pure data + math only (no reanimated import) so ts-jest can run it.
// Functions carry the 'worklet' directive so PawLoader can evaluate them on
// the UI thread at 60fps.
// ─────────────────────────────────────────────────────────────────────────────

export type LoaderFlavor = 'generic' | 'meal' | 'sync' | 'weight' | 'reasoning' | 'photo';

export interface MomentPose {
  /** Unit-space centre (100×100 viewBox, paw centred on 50,50). */
  x: number;
  y: number;
  /** Scale relative to the moment's rest pad size (particle ≪ 1, pad = 1). */
  scaleX: number;
  scaleY: number;
  opacity: number;
  /** Halo strength 0–1 (multiplied by the surface halo colour's opacity). */
  halo: number;
}

// Rest pose — index 0 is the metacarpal pad (the first moment, the heart of
// the paw, born at centre); 1–4 are the toe pads, left → right.
export const PAW_REST = [
  { x: 50, y: 62.5, r: 14.5, sx: 1.16, sy: 1 },
  { x: 27.5, y: 40.5, r: 7.4, sx: 1, sy: 1.14 },
  { x: 41.5, y: 31.5, r: 8.0, sx: 1, sy: 1.1 },
  { x: 58.5, y: 31.5, r: 8.0, sx: 1, sy: 1.1 },
  { x: 72.5, y: 40.5, r: 7.4, sx: 1, sy: 1.14 },
] as const;

export const MOMENT_COUNT = PAW_REST.length;

/** Unit radius of a moment while still a free particle. */
export const PARTICLE_R = 3.4;

// Personality — near-subliminal per-moment differences (mass reads as lag,
// lighter moments wander more) so the system never moves in lockstep.
export const PERSONALITY = [
  { lag: 0.22, driftAmp: 1.5, driftFreq: 0.72, glow: 1.0 }, // heavy, calm centre
  { lag: 0.0, driftAmp: 2.3, driftFreq: 1.08, glow: 0.85 },
  { lag: 0.12, driftAmp: 2.0, driftFreq: 0.9, glow: 1.1 },
  { lag: 0.05, driftAmp: 2.5, driftFreq: 1.18, glow: 0.9 },
  { lag: 0.17, driftAmp: 1.8, driftFreq: 0.8, glow: 1.05 },
] as const;

// Context flavors — small parameter deltas so different kinds of thinking
// *feel* different without the user consciously noticing why.
export const FLAVOR_PARAMS: Record<
  LoaderFlavor,
  { driftMul: number; releaseMul: number; biasAmp: number; regroup: number; sweep: number }
> = {
  generic: { driftMul: 1, releaseMul: 1, biasAmp: 0, regroup: 0, sweep: 0 },
  meal: { driftMul: 1.05, releaseMul: 1.35, biasAmp: 0, regroup: 0, sweep: 0 },
  sync: { driftMul: 1, releaseMul: 1, biasAmp: 3, regroup: 0, sweep: 0 },
  weight: { driftMul: 0.6, releaseMul: 0.8, biasAmp: 0, regroup: 0, sweep: 0 },
  reasoning: { driftMul: 1.1, releaseMul: 1, biasAmp: 0, regroup: 2.6, sweep: 0 },
  photo: { driftMul: 1, releaseMul: 1, biasAmp: 0, regroup: 0, sweep: 1 },
};

// Time-aware escalation (ms from first visible frame) and cycle shape.
export const T_DISCOVERY = 500;
export const T_ASSEMBLY = 3000;
export const CYCLE_MS = 5200;
const SETTLE_END = 0.28; // cycle fraction: gather → paw
const HOLD_END = 0.72; //  cycle fraction: paw holds, breathing

const DRIFT_PERIOD = 4700;

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

function clamp01(v: number): number {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, p: number): number {
  'worklet';
  return a + (b - a) * p;
}

function easeOutCubic(p: number): number {
  'worklet';
  const q = 1 - clamp01(p);
  return 1 - q * q * q;
}

function easeInOutCubic(p: number): number {
  'worklet';
  const t = clamp01(p);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Organic wander — two detuned sines per axis, phases from the seed, amplitude
// and frequency from personality. Continuous in t across all phases.
function driftX(t: number, i: number, seed: number, mul: number): number {
  'worklet';
  const w = ((2 * Math.PI) / DRIFT_PERIOD) * PERSONALITY[i].driftFreq;
  const p1 = rand(seed, i * 2 + 1) * Math.PI * 2;
  const p2 = rand(seed, i * 2 + 2) * Math.PI * 2;
  return PERSONALITY[i].driftAmp * mul * (Math.sin(t * w + p1) * 0.62 + Math.sin(t * w * 1.73 + p2) * 0.38);
}

function driftY(t: number, i: number, seed: number, mul: number): number {
  'worklet';
  const w = ((2 * Math.PI) / DRIFT_PERIOD) * PERSONALITY[i].driftFreq * 0.87;
  const p1 = rand(seed, i * 2 + 61) * Math.PI * 2;
  const p2 = rand(seed, i * 2 + 62) * Math.PI * 2;
  return PERSONALITY[i].driftAmp * mul * (Math.sin(t * w + p1) * 0.58 + Math.sin(t * w * 1.61 + p2) * 0.42);
}

// Where a moment rests between assemblies — the "loose cluster" a cycle
// gathers from and the previous cycle released toward. Keyed by cycle seed so
// consecutive phases agree by construction (this is what makes seams
// impossible: release of cycle k targets releaseVec(seed k+1), settle of
// cycle k+1 starts from releaseVec(seed k+1)).
function releaseVec(cycleSeed: number, i: number, releaseMul: number): { x: number; y: number } {
  'worklet';
  const ang = rand(cycleSeed, 40 + i) * Math.PI * 2;
  const rad = (10 + rand(cycleSeed, 50 + i) * 8) * releaseMul * (1 + PERSONALITY[i].lag * 0.5);
  return { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad };
}

// Discovery entry point for moments 1–4. `sweep` (photo flavor) flattens the
// entry angles toward an invisible horizontal plane.
function scatterPos(seed: number, i: number, sweep: number): { x: number; y: number } {
  'worklet';
  let ang = rand(seed, 10 + i) * Math.PI * 2;
  if (sweep > 0) {
    const horiz = rand(seed, 60 + i) > 0.5 ? 0 : Math.PI;
    ang = ang * (1 - 0.7 * sweep) + horiz * 0.7 * sweep;
  }
  const rad = 34 + rand(seed, 20 + i) * 10;
  return { x: 50 + Math.cos(ang) * rad, y: 50 + Math.sin(ang) * rad * 0.9 };
}

// Reasoning flavor: during the hold, toe pairs lean subtly toward each other —
// temporary relationships forming before they resolve.
function regroupOffset(i: number, holdP: number, amount: number, cycleSeed: number): { x: number; y: number } {
  'worklet';
  if (amount === 0 || i === 0) return { x: 0, y: 0 };
  const partner = i % 2 === 1 ? i + 1 : i - 1; // (1,2) and (3,4)
  const dx = PAW_REST[partner].x - PAW_REST[i].x;
  const dy = PAW_REST[partner].y - PAW_REST[i].y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const pull = amount * Math.sin(Math.PI * clamp01(holdP)) * (0.6 + rand(cycleSeed, 80 + i) * 0.4);
  return { x: (dx / len) * pull, y: (dy / len) * pull };
}

/**
 * The system. Evaluates one Moment's pose at `tMs` (ms since the loader became
 * visible). Deterministic; continuous across every phase boundary.
 */
export function evalMoment(tMs: number, i: number, seedBase: number, flavor: LoaderFlavor): MomentPose {
  'worklet';
  const F = FLAVOR_PARAMS[flavor];
  const R = PAW_REST[i];
  const P = PERSONALITY[i];
  const pScale = PARTICLE_R / R.r;

  // Weight flavor: wander settles toward stillness over time.
  const driftMul = F.driftMul * (flavor === 'weight' ? 1 / (1 + tMs / 12000) : 1);
  const dx = driftX(tMs, i, seedBase, driftMul);
  const dy = driftY(tMs, i, seedBase, driftMul);
  // Sync flavor: a slow shared directional sway.
  const biasX = F.biasAmp * Math.sin(tMs * ((2 * Math.PI) / 6200));

  // Loose-cluster target that discovery glides toward = cycle 0's gather start.
  const loose0x = R.x + releaseVec(seedBase, i, F.releaseMul).x;
  const loose0y = R.y + releaseVec(seedBase, i, F.releaseMul).y;

  let x: number;
  let y: number;
  let form = 0; // 0 = free particle, 1 = settled pad
  let scale = pScale;
  let opacity = 0.9;
  let driftFactor: number;

  if (tMs < T_DISCOVERY) {
    // ── Birth: one moment breathes at centre; the rest are not yet here.
    driftFactor = 0.8;
    if (i === 0) {
      x = 50;
      y = 50;
      opacity = 0.9 * clamp01(tMs / 260);
    } else {
      const s = scatterPos(seedBase, i, F.sweep);
      x = s.x;
      y = s.y;
      opacity = 0;
    }
  } else if (tMs < T_ASSEMBLY) {
    // ── Discovery: moments appear from seeded directions and find each other.
    const span = T_ASSEMBLY - T_DISCOVERY;
    const appearAt = i === 0 ? T_DISCOVERY : T_DISCOVERY + (rand(seedBase, 30 + i) * 0.55 + P.lag) * span * 0.5;
    const raw = clamp01((tMs - appearAt) / (T_ASSEMBLY - appearAt));
    const p = easeOutCubic(raw);
    const start = i === 0 ? { x: 50, y: 50 } : scatterPos(seedBase, i, F.sweep);
    x = lerp(start.x, loose0x, p);
    y = lerp(start.y, loose0y, p);
    driftFactor = lerp(0.8, 0.6, p);
    opacity = i === 0 ? 0.9 : 0.9 * clamp01((tMs - appearAt) / 400);
  } else {
    // ── Living cycles: gather → paw → breathe → release, reseeded each cycle.
    const cycleIdx = Math.floor((tMs - T_ASSEMBLY) / CYCLE_MS);
    const ct = ((tMs - T_ASSEMBLY) % CYCLE_MS) / CYCLE_MS;
    const cSeed = seedBase + cycleIdx;
    const fromV = releaseVec(cSeed, i, F.releaseMul);
    const toV = releaseVec(cSeed + 1, i, F.releaseMul);

    if (ct < SETTLE_END) {
      // Gather: glide from the loose cluster into pad position, swelling.
      const lagged = clamp01((ct / SETTLE_END - P.lag * 0.3) / (1 - P.lag * 0.3));
      const p = easeOutCubic(lagged);
      x = lerp(R.x + fromV.x, R.x, p);
      y = lerp(R.y + fromV.y, R.y, p);
      form = p;
      scale = lerp(pScale, 1, p);
      driftFactor = lerp(0.6, 0.25, p);
      opacity = lerp(0.9, 1, p);
    } else if (ct < HOLD_END) {
      // The paw — brief clarity. Container-level breathing happens above us.
      const holdP = (ct - SETTLE_END) / (HOLD_END - SETTLE_END);
      const rg = regroupOffset(i, holdP, F.regroup, cSeed);
      x = R.x + rg.x;
      y = R.y + rg.y;
      form = 1;
      scale = 1;
      driftFactor = 0.25;
      opacity = 1;
    } else {
      // Release: dissolve back into moments, already en route to the next
      // cycle's gather start.
      const rp = easeInOutCubic((ct - HOLD_END) / (1 - HOLD_END));
      x = lerp(R.x, R.x + toV.x, rp);
      y = lerp(R.y, R.y + toV.y, rp);
      form = 1 - rp;
      scale = lerp(1, pScale, rp);
      driftFactor = lerp(0.25, 0.6, rp);
      opacity = lerp(1, 0.9, rp);
    }
  }

  const haloSeed = tMs < T_ASSEMBLY ? seedBase : seedBase + Math.floor((tMs - T_ASSEMBLY) / CYCLE_MS);
  const halo = P.glow * (0.5 + 0.5 * form) * (0.85 + rand(haloSeed, 70 + i) * 0.3);

  return {
    x: x + dx * driftFactor + biasX,
    y: y + dy * driftFactor,
    scaleX: scale * lerp(1, R.sx, form),
    scaleY: scale * lerp(1, R.sy, form),
    opacity,
    halo,
  };
}
