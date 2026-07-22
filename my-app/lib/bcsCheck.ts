/**
 * Hands-On Check — guided BCS questionnaire scoring + signal fusion.
 *
 * Owners systematically under-score their pets on a gestalt silhouette pick
 * ("chunky is their normal"), but they answer concrete factual questions
 * honestly. This module turns the WSAVA palpation protocol into 3–4 such
 * questions and scores them deterministically to a full 1–9 BCS:
 *
 *   Q1 rib palpation  — the gold signal; works through any coat, which is
 *                       exactly where the photo AI fails. Highest weight.
 *   Q2 waist from above, Q3 belly tuck from the side — the two visual checks.
 *   Q4 fat-pad palpation — conditional tiebreaker: asked on conflict, at the
 *                       heavy end (sharpens the 7/8/9 severe-gate boundary),
 *                       and at the thin end (splits lean-fit 4 from thin ≤3).
 *
 * Each answer maps to a BCS interval; the band is the intersection, the point
 * a weighted mean clamped into it. An empty intersection is a CONFLICT —
 * widen, lean on the rib read, and flag it rather than faking precision.
 *
 * `fuseBcsSignals` then reconciles the questionnaire band with the gated
 * photo-AI band (lib/bcsPhotoEstimate.ts). Palpation beats pixels: a photo
 * band that overlaps narrows the answer; one that contradicts is discarded.
 * Scale-vs-breed-band contradictions stay handled downstream by
 * estimateIdealWeight()'s clamp/reconcile — not duplicated here.
 *
 * Kept free of React Native / Expo imports so it runs under jest.
 */

import {
  BcsPhotoEstimateRaw,
  BcsSuggestionContext,
  deriveBcsSuggestion,
} from './bcsPhotoEstimate';

export type RibAnswer = 'very_easy' | 'light_pressure' | 'must_press' | 'cannot_feel';
export type WaistAnswer = 'clear' | 'slight' | 'round';
export type TuckAnswer = 'clear' | 'slight' | 'none';
export type PadAnswer = 'prominent' | 'bony' | 'soft' | 'obvious';

export interface BcsCheckAnswers {
  rib: RibAnswer;
  waist: WaistAnswer;
  tuck: TuckAnswer;
  /** Tiebreaker — only present when the flow asked Q4. */
  pad?: PadAnswer | null;
}

export interface BcsCheckScore {
  /** Final band, integers 1–9, low ≤ high. */
  bcsLow: number;
  bcsHigh: number;
  /** Single 1–9 score the plan math consumes. */
  bcsPoint: number;
  /** True when the answers never reconciled, even after the tiebreaker. */
  conflict: boolean;
  /** The three core answers disagreed (even if the tiebreaker later settled it). */
  coreConflict: boolean;
  /** The flow should ask Q4 before treating the score as final. */
  needsTiebreaker: boolean;
  /** Q4 was answered and participated in this score. */
  tiebreakerUsed: boolean;
}

export type BcsConfidenceTier = 'vet_grade' | 'solid' | 'rough';
export type BcsPhotoAgreement = 'agree' | 'disagree' | 'none';

export interface BcsFusionResult {
  bcs: number;
  bcsLow: number;
  bcsHigh: number;
  tier: BcsConfidenceTier;
  photoAgreement: BcsPhotoAgreement;
}

interface Interval {
  lo: number;
  hi: number;
  /** Representative value for the weighted mean. */
  rep: number;
}

// Answer → BCS interval mapping (WSAVA/Purina 9-point).
const RIB: Record<RibAnswer, Interval> = {
  very_easy: { lo: 1, hi: 4, rep: 3 },
  light_pressure: { lo: 4, hi: 5, rep: 4.5 },
  must_press: { lo: 6, hi: 7, rep: 6.5 },
  cannot_feel: { lo: 8, hi: 9, rep: 8.5 },
};
const WAIST: Record<WaistAnswer, Interval> = {
  clear: { lo: 1, hi: 5, rep: 4 },
  slight: { lo: 5, hi: 6, rep: 5.5 },
  round: { lo: 7, hi: 9, rep: 8 },
};
const TUCK: Record<TuckAnswer, Interval> = {
  clear: { lo: 1, hi: 5, rep: 4 },
  slight: { lo: 5, hi: 6, rep: 5.5 },
  none: { lo: 7, hi: 9, rep: 8 },
};
const PAD: Record<PadAnswer, Interval> = {
  prominent: { lo: 1, hi: 3, rep: 2 },
  bony: { lo: 3, hi: 5, rep: 4 },
  soft: { lo: 6, hi: 7, rep: 6.5 },
  obvious: { lo: 8, hi: 9, rep: 9 },
};

// Rib palpation carries the score; when the tiebreaker joins, the two touch
// signals together (0.7) still outweigh the two visual ones.
const CORE_WEIGHTS = { rib: 0.5, waist: 0.25, tuck: 0.25 };
const PAD_WEIGHTS = { rib: 0.4, pad: 0.3, waist: 0.15, tuck: 0.15 };

/** Representative-value spread at which we stop trusting a clean average. */
const CONFLICT_SPREAD = 3;

function clampBcs(n: number): number {
  return Math.max(1, Math.min(9, n));
}

function intersect(intervals: Interval[]): { lo: number; hi: number } | null {
  const lo = Math.max(...intervals.map((i) => i.lo));
  const hi = Math.min(...intervals.map((i) => i.hi));
  return lo <= hi ? { lo, hi } : null;
}

/**
 * Whether Q4 must be asked before the score is final. Pure so the flow can
 * call it right after Q3: on conflict, at the heavy end (the 7/8/9 boundary
 * drives the severe vet gate), and on a "very easy" rib read (splits a
 * lean-fit 4 from a genuinely thin ≤3).
 */
export function needsTiebreaker(answers: Pick<BcsCheckAnswers, 'rib' | 'waist' | 'tuck'>): boolean {
  const intervals = [RIB[answers.rib], WAIST[answers.waist], TUCK[answers.tuck]];
  const reps = intervals.map((i) => i.rep);
  const spread = Math.max(...reps) - Math.min(...reps);
  if (!intersect(intervals) || spread >= CONFLICT_SPREAD) return true;
  const prelim =
    RIB[answers.rib].rep * CORE_WEIGHTS.rib +
    WAIST[answers.waist].rep * CORE_WEIGHTS.waist +
    TUCK[answers.tuck].rep * CORE_WEIGHTS.tuck;
  return prelim >= 7 || answers.rib === 'very_easy';
}

/**
 * Live band for the refining spectrum indicator: the intersection of whatever
 * has been answered so far. On a mid-flow contradiction it falls back to a
 * rib-anchored envelope — the bar wobbles wider instead of lying narrower.
 */
export function bcsPartialBand(partial: Partial<BcsCheckAnswers>): { lo: number; hi: number } {
  const intervals: Interval[] = [];
  if (partial.rib) intervals.push(RIB[partial.rib]);
  if (partial.waist) intervals.push(WAIST[partial.waist]);
  if (partial.tuck) intervals.push(TUCK[partial.tuck]);
  if (partial.pad) intervals.push(PAD[partial.pad]);
  if (intervals.length === 0) return { lo: 1, hi: 9 };
  const inter = intersect(intervals);
  if (inter) return inter;
  if (partial.rib) {
    const rib = RIB[partial.rib];
    return { lo: clampBcs(rib.lo - 1), hi: clampBcs(rib.hi + 1) };
  }
  return { lo: 1, hi: 9 };
}

/** Deterministic score from the answered questions. */
export function scoreBcsCheck(answers: BcsCheckAnswers): BcsCheckScore {
  const rib = RIB[answers.rib];
  const waist = WAIST[answers.waist];
  const tuck = TUCK[answers.tuck];
  const pad = answers.pad ? PAD[answers.pad] : null;

  const intervals = pad ? [rib, waist, tuck, pad] : [rib, waist, tuck];
  const raw = pad
    ? rib.rep * PAD_WEIGHTS.rib + pad.rep * PAD_WEIGHTS.pad + waist.rep * PAD_WEIGHTS.waist + tuck.rep * PAD_WEIGHTS.tuck
    : rib.rep * CORE_WEIGHTS.rib + waist.rep * CORE_WEIGHTS.waist + tuck.rep * CORE_WEIGHTS.tuck;
  const rounded = clampBcs(Math.round(raw));
  const coreConflict = intersect([rib, waist, tuck]) == null;

  const inter = intersect(intervals);
  if (inter) {
    return {
      bcsLow: inter.lo,
      bcsHigh: inter.hi,
      bcsPoint: Math.max(inter.lo, Math.min(inter.hi, rounded)),
      conflict: false,
      coreConflict,
      needsTiebreaker: !pad && needsTiebreaker(answers),
      tiebreakerUsed: pad != null,
    };
  }

  // The full set disagrees. Touch beats sight: if the two palpation reads
  // (rib + pad) agree with each other, their intersection resolves the
  // conflict — a heavy coat fools the eyes, not the hands.
  if (pad) {
    const touch = intersect([rib, pad]);
    if (touch) {
      return {
        bcsLow: touch.lo,
        bcsHigh: touch.hi,
        bcsPoint: Math.max(touch.lo, Math.min(touch.hi, rounded)),
        conflict: false,
        coreConflict,
        needsTiebreaker: false,
        tiebreakerUsed: true,
      };
    }
  }

  // Conflict: the answers describe different animals. Anchor near the rib
  // read (the least-fooled signal), widen the band, and say so honestly.
  const point = clampBcs(Math.max(rib.lo - 1, Math.min(rib.hi + 1, rounded)));
  return {
    bcsLow: clampBcs(point - 1),
    bcsHigh: clampBcs(point + 1),
    bcsPoint: point,
    conflict: true,
    coreConflict,
    needsTiebreaker: !pad,
    tiebreakerUsed: pad != null,
  };
}

/**
 * Reconcile the questionnaire score with the photo-AI band. The photo can
 * NARROW the hands-on band when the two agree; it never overrules it.
 */
export function fuseBcsSignals(
  check: BcsCheckScore,
  photoRaw: BcsPhotoEstimateRaw | null | undefined,
  ctx: BcsSuggestionContext,
): BcsFusionResult {
  const photo = photoRaw ? deriveBcsSuggestion(photoRaw, ctx).suggestion : null;

  let lo = check.bcsLow;
  let hi = check.bcsHigh;
  let photoAgreement: BcsPhotoAgreement = 'none';
  if (photo) {
    const overlapLo = Math.max(lo, photo.bandLow);
    const overlapHi = Math.min(hi, photo.bandHigh);
    if (overlapLo <= overlapHi) {
      lo = overlapLo;
      hi = overlapHi;
      photoAgreement = 'agree';
    } else {
      photoAgreement = 'disagree';
    }
  }

  // vet_grade: the signals told one story (photo agreeing or absent);
  // solid: a disagreement existed but was settled (tiebreaker resolved the
  // core conflict, or the photo saw it differently); rough: never reconciled.
  const tier: BcsConfidenceTier = check.conflict
    ? 'rough'
    : check.coreConflict || photoAgreement === 'disagree'
      ? 'solid'
      : 'vet_grade';

  return {
    bcs: Math.max(lo, Math.min(hi, check.bcsPoint)),
    bcsLow: lo,
    bcsHigh: hi,
    tier,
    photoAgreement,
  };
}

/**
 * The persisted shape for `pets.bcs_check_answers` (jsonb) — the calibration
 * dataset that will tell us how the hands-on check performs against vet
 * reports and the photo AI. Snake-case keys to match the column convention.
 */
export interface BcsCheckRecord {
  rib: RibAnswer;
  waist: WaistAnswer;
  tuck: TuckAnswer;
  pad?: PadAnswer | null;
  band: [number, number];
  conflict: boolean;
  tier: BcsConfidenceTier;
  photo_agreement: BcsPhotoAgreement;
  photo_band?: [number, number] | null;
}

export function buildBcsCheckRecord(
  answers: BcsCheckAnswers,
  check: BcsCheckScore,
  fused: BcsFusionResult,
  photoRaw: BcsPhotoEstimateRaw | null | undefined,
): BcsCheckRecord {
  return {
    rib: answers.rib,
    waist: answers.waist,
    tuck: answers.tuck,
    pad: answers.pad ?? null,
    band: [fused.bcsLow, fused.bcsHigh],
    conflict: check.conflict,
    tier: fused.tier,
    photo_agreement: fused.photoAgreement,
    photo_band:
      photoRaw?.bcs_low != null && photoRaw?.bcs_high != null
        ? [photoRaw.bcs_low, photoRaw.bcs_high]
        : null,
  };
}

// ── Question copy ─────────────────────────────────────────────────────────
// Species-aware, warm, factual. Cats: the primordial pouch (the soft low
// belly flap) is NORMAL anatomy and must never be read as "no tuck".

export type BcsCheckQuestionId = 'rib' | 'waist' | 'tuck' | 'pad';

export interface BcsCheckOption {
  value: RibAnswer | WaistAnswer | TuckAnswer | PadAnswer;
  label: string;
}

export interface BcsCheckQuestionDef {
  id: BcsCheckQuestionId;
  title: string;
  hint: string;
  options: BcsCheckOption[];
}

export function bcsCheckQuestions(species: 'dog' | 'cat', petName: string): BcsCheckQuestionDef[] {
  const name = petName || (species === 'cat' ? 'your cat' : 'your dog');
  return [
    {
      id: 'rib',
      title: `Can you feel ${name}'s ribs easily?`,
      hint: 'Run your hands gently along the sides of the chest, like a slow pet.',
      options: [
        { value: 'very_easy', label: 'Yes — I can see or feel them right away' },
        { value: 'light_pressure', label: 'Yes, with a light touch' },
        { value: 'must_press', label: 'Only if I press in' },
        { value: 'cannot_feel', label: 'I can’t find them at all' },
      ],
    },
    {
      id: 'waist',
      title: `From above, does ${name} have a waist?`,
      hint: 'Stand over them and look down at the shape just behind the ribs.',
      options: [
        { value: 'clear', label: 'Yes, a clear tuck-in' },
        { value: 'slight', label: 'A gentle curve' },
        { value: 'round', label: 'Not really — the sides look straight or rounded' },
      ],
    },
    {
      id: 'tuck',
      title: `From the side, does the belly rise behind the ribs?`,
      hint:
        species === 'cat'
          ? 'Ignore the soft pouch low on the belly — that’s normal cat anatomy. Look at the line just behind the ribs.'
          : 'Crouch down and follow the line of the belly from chest to hips.',
      options: [
        { value: 'clear', label: 'Yes, it tucks up clearly' },
        { value: 'slight', label: 'A slight rise' },
        { value: 'none', label: 'It’s level — or hangs down' },
      ],
    },
    {
      id: 'pad',
      title: `One more: feel around the base of the tail.`,
      hint: 'Also run a hand along the spine — what do the bones feel like?',
      options: [
        { value: 'prominent', label: 'They stick out sharply — hardly any cover' },
        { value: 'bony', label: 'Easy to find under a thin layer' },
        { value: 'soft', label: 'There’s a soft layer over them' },
        { value: 'obvious', label: 'There are noticeable pads or rolls' },
      ],
    },
  ];
}
