/**
 * Post-walk insight selection — the reinforcer at the centre of the walk habit
 * loop.
 *
 * Byte-mirrored to `supabase/functions/_shared/notifications/walkInsights.ts`;
 * the mirror check lives in `copy.test.ts`.
 *
 * Why this exists at all: a dog owner already walks their dog. The walk is not
 * the behaviour we are trying to create — bringing Pawtchi along is. So the
 * push that matters is not the one before the walk (that moment is a few
 * seconds of leash-and-door chaos and cannot be won), it is the one *after*,
 * when the phone is already in hand and the dog is asleep on the floor.
 *
 * The reward has to be variable to sustain attention, and the honest way to get
 * variability is to report what actually happened rather than to ration a fixed
 * message. Some walks are genuinely interesting; some are a lap of the block.
 * This module's most important behaviour is therefore **returning null** — a
 * walk with nothing to say about it earns no notification. That is what stops
 * this becoming `nudge_water`, which fired on a condition true for nearly
 * everyone nearly every day and grew into 75% of all traffic.
 *
 * Keep this file free of runtime imports so both the Expo bundler and the Deno
 * edge runtime compile it and the mirror check can compare raw bytes.
 */

import type { WalkInsightKind } from './copy';

export interface WalkInsightInput {
  /** Distinct sniff episodes resolved for this walk. */
  sniffCount: number;
  /** Longest single stop, in seconds. */
  longestPauseSeconds: number;
  /** Stretches of this route the dog has not walked before. */
  newStreetCount: number;
  /**
   * How long since a walk this long or longer. Null when there is not enough
   * history to make the claim — which is not the same as zero.
   */
  daysSinceLongerWalk: number | null;
  /** Consecutive weeks of rising average duration. */
  risingWeeks: number;
  /** Times this route has been repeated in the last 7 days, including today. */
  routeRepeatsThisWeek: number;
  /**
   * Kinds already sent to this owner recently, most recent first. The novelty
   * guard reads this so the same *shape* of observation never lands twice in a
   * row — predictability is what turns a good notification into wallpaper.
   */
  recentKinds: readonly WalkInsightKind[];
}

export interface WalkInsightMatch {
  kind: WalkInsightKind;
  sniffCount?: number;
  pauseMinutes?: number;
  days?: number;
  trendWeeks?: number;
  repeatCount?: number;
}

/**
 * How far back the novelty guard looks. Three is deliberate: with six kinds it
 * leaves enough room that a varied walker always has something eligible, while
 * still guaranteeing an owner never sees the same shape twice running.
 */
export const NOVELTY_WINDOW = 3;

/**
 * Thresholds are set where the observation stops being ordinary. A dog that
 * sniffs three times has not done anything; a dog that stopped dead for two
 * minutes has. Set these too low and every walk qualifies, which is the failure
 * mode this whole module exists to avoid.
 */
export const INSIGHT_THRESHOLDS = {
  /** Two minutes at one spot is a decision, not a pause. */
  longPauseSeconds: 120,
  newStreets: 1,
  sniffCount: 4,
  /** "Longest in a fortnight" is a claim worth making; "longest in 2 days" is not. */
  longerWalkDays: 14,
  risingWeeks: 3,
  routeRepeats: 3,
} as const;

/**
 * First eligible kind wins, in the priority order of ALL_WALK_INSIGHT_KINDS.
 * Returns null when the walk supports no observation worth interrupting for, or
 * when everything it does support was sent too recently.
 */
export function selectWalkInsight(input: WalkInsightInput): WalkInsightMatch | null {
  const recent = input.recentKinds.slice(0, NOVELTY_WINDOW);
  const fresh = (kind: WalkInsightKind) => !recent.includes(kind);

  if (fresh('long_pause') && input.longestPauseSeconds >= INSIGHT_THRESHOLDS.longPauseSeconds) {
    return {
      kind: 'long_pause',
      // Floor, not round: claiming three minutes for a 2m31s stop is a small
      // lie, and the whole feature rests on the owner trusting these numbers.
      pauseMinutes: Math.floor(input.longestPauseSeconds / 60),
    };
  }

  if (fresh('new_ground') && input.newStreetCount >= INSIGHT_THRESHOLDS.newStreets) {
    return { kind: 'new_ground' };
  }

  if (fresh('sniff_count') && input.sniffCount >= INSIGHT_THRESHOLDS.sniffCount) {
    return { kind: 'sniff_count', sniffCount: input.sniffCount };
  }

  if (
    fresh('longest_recent') &&
    input.daysSinceLongerWalk !== null &&
    input.daysSinceLongerWalk >= INSIGHT_THRESHOLDS.longerWalkDays
  ) {
    return { kind: 'longest_recent', days: input.daysSinceLongerWalk };
  }

  if (fresh('duration_trend') && input.risingWeeks >= INSIGHT_THRESHOLDS.risingWeeks) {
    return { kind: 'duration_trend', trendWeeks: input.risingWeeks };
  }

  if (fresh('familiar_route') && input.routeRepeatsThisWeek >= INSIGHT_THRESHOLDS.routeRepeats) {
    return { kind: 'familiar_route', repeatCount: input.routeRepeatsThisWeek };
  }

  return null;
}

/**
 * Stable one-line description for dry-run output and dispatcher logs. The
 * dry-run is meant to be read by a human deciding whether a week of these would
 * be annoying, so this stays terse and factual.
 */
export function describeWalkInsight(match: WalkInsightMatch | null): string {
  if (!match) return 'no insight (silent)';
  const detail =
    match.pauseMinutes ??
    match.sniffCount ??
    match.days ??
    match.trendWeeks ??
    match.repeatCount;
  return detail === undefined ? match.kind : `${match.kind}:${detail}`;
}
