/**
 * Paw Prints — pure aggregation, milestone ladder, and monthly-recap engine.
 *
 * The motivational ladder over the walk archive:
 *   gallery  — every walk mints a unique drawing (collection / endowment)
 *   recap    — one card per month (fresh-start ritual)
 *   milestone— cumulative thresholds crossed mid-walk (variable reward)
 *
 * Milestones come in FAMILIES on purpose: distance alone favors big dogs, so
 * walk-count, places-explored, and sniff ladders let every dog climb at its
 * own gait. No leaderboards anywhere — comparison on metrics is vet-misaligned
 * across breeds; the social layer is the share cards, nothing else.
 *
 * Pure — the supabase reads/writes live in pawPrintsSync.ts. All user-facing
 * copy complies with the Pawtchi Copy Spec v1 (no exclamation marks, never
 * "your pet", calm sentence case) and is enforced by pawPrints.test.ts.
 */

import { hashSeed, mulberry32, smoothPath } from './momentCard';

/** One valid walk, as the engine sees it (mapped from a walk_sessions row). */
export interface PawPrintWalk {
  id: string;
  /** ISO timestamp of walk start. */
  startedAt: string;
  distanceM: number;
  durationS: number;
  /** Real sniff-stop count (pause_points length). */
  sniffCount: number;
  startLabel: string | null;
  endLabel: string | null;
  farthestLabel: string | null;
}

export interface WalkTotals {
  totalKm: number;
  walkCount: number;
  totalSniffs: number;
  /** Distinct place labels seen across start/end/farthest. */
  distinctPlaces: number;
  /** Modal place label; ties broken by most recent appearance. */
  favouritePlace: string | null;
  longestWalk: { sessionId: string; km: number; label: string | null } | null;
  /** "May" — month name of the earliest walk; null with no walks. */
  firstWalkMonth: string | null;
}

function cleanLabel(label: string | null | undefined): string | null {
  const t = (label ?? '').trim();
  return t.length > 0 ? t : null;
}

/** "2.4", "0.8", "12" — same editorial rounding the Paw Moment card uses. */
export function formatKm(km: number): string {
  const s = km >= 10 ? km.toFixed(0) : km.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** Possessive pronoun for the milestone sub-line: his / her / their. */
export function possessivePronoun(gender?: string | null): string {
  if (gender === 'male') return 'his';
  if (gender === 'female') return 'her';
  return 'their';
}

/** Aggregate a pet's valid walks into the totals every surface reads. */
export function aggregateWalks(walks: PawPrintWalk[]): WalkTotals {
  let distanceM = 0;
  let sniffs = 0;
  let earliest: number | null = null;
  let longest: WalkTotals['longestWalk'] = null;
  // label → { count, lastSeen } for the favourite-place mode.
  const places = new Map<string, { count: number; lastSeen: number }>();

  for (const w of walks) {
    distanceM += w.distanceM;
    sniffs += w.sniffCount;
    const t = Date.parse(w.startedAt);
    if (Number.isFinite(t) && (earliest === null || t < earliest)) earliest = t;

    const km = w.distanceM / 1000;
    if (!longest || km > longest.km) {
      longest = {
        sessionId: w.id,
        km,
        label: cleanLabel(w.farthestLabel) ?? cleanLabel(w.endLabel) ?? cleanLabel(w.startLabel),
      };
    }

    for (const label of [w.startLabel, w.endLabel, w.farthestLabel]) {
      const clean = cleanLabel(label);
      if (!clean) continue;
      const entry = places.get(clean) ?? { count: 0, lastSeen: 0 };
      entry.count += 1;
      if (Number.isFinite(t)) entry.lastSeen = Math.max(entry.lastSeen, t);
      places.set(clean, entry);
    }
  }

  let favourite: string | null = null;
  let best = { count: 0, lastSeen: 0 };
  for (const [label, entry] of places) {
    if (entry.count > best.count || (entry.count === best.count && entry.lastSeen > best.lastSeen)) {
      favourite = label;
      best = entry;
    }
  }

  return {
    totalKm: distanceM / 1000,
    walkCount: walks.length,
    totalSniffs: sniffs,
    distinctPlaces: places.size,
    favouritePlace: favourite,
    longestWalk: longest,
    firstWalkMonth:
      earliest !== null
        ? new Date(earliest).toLocaleDateString('en-GB', { month: 'long' })
        : null,
  };
}

// ── Milestone ladder ────────────────────────────────────────────────────────

export type MilestoneFamily = 'distance' | 'walks' | 'places' | 'sniffs';

export interface MilestoneDef {
  /** Stable id persisted to pet_milestones — never rename. */
  id: string;
  family: MilestoneFamily;
  threshold: number;
  /** The big display value on the card ("50"). */
  value: string;
  /** The display unit line ("KILOMETRES"). */
  unit: string;
}

function ladder(family: MilestoneFamily, unit: string, thresholds: number[]): MilestoneDef[] {
  return thresholds.map(t => ({
    id: `${family}_${t}`,
    family,
    threshold: t,
    value: String(t),
    unit,
  }));
}

/** The full ladder, ordered within each family. Ids are persisted — append
 *  new rungs freely, never rename or remove existing ones. */
export const MILESTONES: MilestoneDef[] = [
  ...ladder('distance', 'kilometres', [10, 25, 50, 100, 250, 500]),
  ...ladder('walks', 'walks', [10, 25, 50, 100, 250]),
  ...ladder('places', 'places', [5, 15, 30]),
  ...ladder('sniffs', 'good smells', [100, 500, 1000]),
];

function familyMetric(totals: WalkTotals, family: MilestoneFamily): number {
  switch (family) {
    case 'distance': return totals.totalKm;
    case 'walks': return totals.walkCount;
    case 'places': return totals.distinctPlaces;
    case 'sniffs': return totals.totalSniffs;
  }
}

/**
 * Milestones the totals have crossed that aren't yet awarded. Ordered by
 * family then threshold; a single long walk may cross several at once.
 */
export function detectCrossedMilestones(
  totals: WalkTotals,
  awardedIds: Iterable<string>,
): MilestoneDef[] {
  const awarded = new Set(awardedIds);
  return MILESTONES.filter(
    m => !awarded.has(m.id) && familyMetric(totals, m.family) >= m.threshold,
  );
}

/** The next un-reached distance rung — powers the gallery's goal-gradient
 *  line ("12 km to 50"). Null once the ladder is fully climbed. */
export function nextDistanceMilestone(
  totals: WalkTotals,
): { threshold: number; remainingKm: number } | null {
  for (const m of MILESTONES) {
    if (m.family !== 'distance') continue;
    if (totals.totalKm < m.threshold) {
      return { threshold: m.threshold, remainingKm: m.threshold - totals.totalKm };
    }
  }
  return null;
}

/**
 * The sub-line under the big number — data-true, one calm sentence, the
 * dog as protagonist. `firstWalkMonth` grounds the distance line in time.
 */
export function milestoneSubline(
  def: MilestoneDef,
  petName: string,
  gender: string | null | undefined,
  firstWalkMonth: string | null,
): string {
  const name = petName.trim() || 'One dog';
  const poss = possessivePronoun(gender);
  switch (def.family) {
    case 'distance':
      return firstWalkMonth
        ? `${name} and ${poss} human, every step since ${firstWalkMonth}.`
        : `${name} and ${poss} human, every step together.`;
    case 'walks':
      return `${def.threshold} walks with ${name}, and counting.`;
    case 'places':
      return `${name} knows ${def.threshold} places by nose now.`;
    case 'sniffs':
      return `${def.threshold} good smells, each one thoroughly checked.`;
  }
}

/**
 * The small hand-drawn squiggle under the milestone sub-line — seeded by the
 * milestone id so every card renders identically forever, same rule as the
 * Paw Moment weave.
 */
export function milestoneSquigglePath(seedId: string, w: number, h: number): string | null {
  const rand = mulberry32(hashSeed(seedId));
  const n = 6;
  const midY = h / 2;
  const points = Array.from({ length: n }, (_, i) => ({
    x: (w / (n - 1)) * i,
    y: midY + (rand() - 0.5) * h * 0.8,
  }));
  return smoothPath(points);
}

// ── Monthly recap ───────────────────────────────────────────────────────────

/** "2026-07" for any date — the recap bucketing key (local time). */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The month before the given date's month. */
export function previousMonthKey(now: Date): string {
  return monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
}

/** Recap won't build below this — a two-walk month reads as an accusation. */
export const RECAP_MIN_WALKS = 3;

/** How many route tiles the recap card draws. */
export const RECAP_TILE_COUNT = 6;

export interface MonthlyRecap {
  monthKey: string;
  /** "JULY" — the card eyebrow. */
  monthLabel: string;
  /** "A month of walks with Bruno" */
  title: string;
  /** Session ids for the tile grid — longest walks first. */
  tileSessionIds: string[];
  totalKm: string;
  walkCount: number;
  favouritePlace: string | null;
  /** "Longest walk: 5.1 km, out to Riverside Park." */
  longestLine: string | null;
}

/**
 * Build the month's Paw Print from that month's valid walks. Null when the
 * month is too thin to celebrate (< RECAP_MIN_WALKS).
 */
export function buildMonthlyRecap(
  walks: PawPrintWalk[],
  key: string,
  petName: string,
): MonthlyRecap | null {
  const inMonth = walks.filter(w => {
    const d = new Date(w.startedAt);
    return Number.isFinite(d.getTime()) && monthKey(d) === key;
  });
  if (inMonth.length < RECAP_MIN_WALKS) return null;

  const totals = aggregateWalks(inMonth);
  const [year, month] = key.split('-').map(Number);
  const monthLabel = new Date(year, month - 1, 1)
    .toLocaleDateString('en-GB', { month: 'long' })
    .toUpperCase();

  const tiles = [...inMonth]
    .sort((a, b) => b.distanceM - a.distanceM)
    .slice(0, RECAP_TILE_COUNT)
    .map(w => w.id);

  const longest = totals.longestWalk;
  const longestLine = longest
    ? longest.label
      ? `Longest walk: ${formatKm(longest.km)} km, out to ${longest.label}.`
      : `Longest walk: ${formatKm(longest.km)} km.`
    : null;

  const name = petName.trim() || 'one good dog';
  return {
    monthKey: key,
    monthLabel,
    title: `A month of walks with ${name}`,
    tileSessionIds: tiles,
    totalKm: formatKm(totals.totalKm),
    walkCount: totals.walkCount,
    favouritePlace: totals.favouritePlace,
    longestLine,
  };
}
