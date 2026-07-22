/**
 * Walksign engine — pure classification and the sticky state machine.
 *
 * Three layers, no I/O:
 *   1. deriveProvisionalWalksign — a first reading from onboarding facts,
 *      so the identity exists before the first tracked walk.
 *   2. aggregateWalks + deriveWalksignFromWalks — the earned reading, folded
 *      from real walk_sessions behaviour (sniff stops, loops, repeated
 *      routes, place variety, pace).
 *   3. evaluateWalksign — the state machine. Provisional → confirmed after
 *      CONFIRM_WALK_COUNT valid walks; once confirmed, the sign changes ONLY
 *      at celebrated life transitions (puppy graduation, seniority arrival).
 *      Identity needs permanence — a rainy week must never change a dog's
 *      sign, so there is no rolling reclassification.
 *
 * Dogs only: every entry point returns null/no-change for cats.
 */

import type { LifeStage } from '../lifeStage';
import {
  WalkAggregates,
  WalksignAssignment,
  WalksignEvaluation,
  WalksignId,
  WalksignPetFacts,
  WalksignStatus,
  WalksignWalkRow,
} from './types';

/** Valid tracked walks needed before the provisional sign is confirmed. */
export const CONFIRM_WALK_COUNT = 5;

const PUPPY_STAGES: readonly LifeStage[] = ['puppy', 'junior'];
const SENIOR_STAGES: readonly LifeStage[] = ['senior', 'geriatric'];

const isPuppy = (s: LifeStage) => PUPPY_STAGES.includes(s);
const isSenior = (s: LifeStage) => SENIOR_STAGES.includes(s);

// ── Layer 1: the first reading ──────────────────────────────────────────────

/**
 * Provisional sign from onboarding facts alone. Priority order mirrors how
 * strongly each fact predicts the walking identity: life stage is destiny
 * (for now), first-dog defines the relationship, energy fills in the rest.
 */
export function deriveProvisionalWalksign(
  facts: WalksignPetFacts,
): WalksignAssignment | null {
  if (facts.species !== 'dog') return null;

  if (isPuppy(facts.lifeStage)) {
    return { sign: 'wonderbound', status: 'provisional', reason: 'life_stage_puppy' };
  }
  if (isSenior(facts.lifeStage)) {
    return { sign: 'storywalker', status: 'provisional', reason: 'life_stage_senior' };
  }
  if (facts.firstDog === true) {
    return { sign: 'newbond', status: 'provisional', reason: 'first_dog' };
  }
  if ((facts.householdWalkers ?? 0) >= 3) {
    return { sign: 'packheart', status: 'provisional', reason: 'household_walkers' };
  }
  if (facts.activityLevel === 'sedentary') {
    return { sign: 'softstep', status: 'provisional', reason: 'energy_gentle' };
  }
  if (facts.activityLevel === 'active' || facts.activityLevel === 'highly_active') {
    return { sign: 'blockscout', status: 'provisional', reason: 'energy_curious' };
  }
  return { sign: 'loopkeeper', status: 'provisional', reason: 'energy_steady' };
}

// ── Layer 2: the earned reading ─────────────────────────────────────────────

/** Fold valid walk_sessions rows into the behavioural fingerprint. */
export function aggregateWalks(rows: WalksignWalkRow[]): WalkAggregates {
  const n = rows.length;
  if (n === 0) {
    return {
      walkCount: 0,
      sniffPerKm: 0,
      loopRatio: 0,
      routeRepetitionRatio: 0,
      distinctPlaceCount: 0,
      avgMovingSpeedKmh: 0,
      pauseTimeRatio: 0,
      avgDistanceM: 0,
      timeOfDayConsistency: 0,
    };
  }

  let totalKm = 0;
  let totalSniffs = 0;
  let loops = 0;
  let totalDuration = 0;
  let totalMoving = 0;
  let speedSum = 0;

  const places = new Set<string>();
  const routeCounts = new Map<string, number>();
  let labelledWalks = 0;
  const hourBuckets = new Map<number, number>();

  for (const r of rows) {
    totalKm += r.distanceM / 1000;
    totalSniffs += r.pauseCount;
    totalDuration += r.durationS;
    totalMoving += Math.min(r.movingTimeS, r.durationS);
    speedSum += r.avgSpeedKmh;
    if (r.endReason === 'auto_home') loops += 1;

    for (const label of [r.startLabel, r.endLabel, r.farthestLabel]) {
      if (label) places.add(label);
    }
    // A route is a (start → turnaround-or-end) pair; only labelled walks vote.
    const trailing = r.farthestLabel ?? r.endLabel;
    if (r.startLabel && trailing) {
      labelledWalks += 1;
      const key = `${r.startLabel}→${trailing}`;
      routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);
    }

    const started = new Date(r.startedAt);
    if (!Number.isNaN(started.getTime())) {
      const bucket = Math.floor(started.getHours() / 3);
      hourBuckets.set(bucket, (hourBuckets.get(bucket) ?? 0) + 1);
    }
  }

  const modalRoute = Math.max(0, ...routeCounts.values());
  const modalBucket = Math.max(0, ...hourBuckets.values());

  return {
    walkCount: n,
    sniffPerKm: totalKm > 0 ? totalSniffs / totalKm : 0,
    loopRatio: loops / n,
    routeRepetitionRatio: labelledWalks > 0 ? modalRoute / labelledWalks : 0,
    distinctPlaceCount: places.size,
    avgMovingSpeedKmh: speedSum / n,
    pauseTimeRatio:
      totalDuration > 0 ? Math.max(0, totalDuration - totalMoving) / totalDuration : 0,
    avgDistanceM: (totalKm * 1000) / n,
    timeOfDayConsistency: modalBucket / n,
  };
}

/** Per-sign behavioural scores, exported for tests and future tuning. */
export interface WalksignScores {
  softstep: number;
  loopkeeper: number;
  blockscout: number;
  newbond: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Score the behavioural signs against the fingerprint. Each component is a
 * 0–1 normalisation of one honest signal; weights keep any single noisy
 * signal from deciding a dog's identity alone.
 */
export function scoreWalksigns(
  agg: WalkAggregates,
  facts: WalksignPetFacts,
): WalksignScores {
  // Softstep: the walk moves at the dog's pace — long pauses, gentle speed,
  // short range. Space is part of the walk.
  const softstep =
    0.5 * clamp01(agg.pauseTimeRatio / 0.5) +
    0.25 * clamp01((4 - agg.avgMovingSpeedKmh) / 4) +
    0.25 * clamp01((1500 - agg.avgDistanceM) / 1500);

  // Loopkeeper: the same route, kept — repetition, real loops, a fixed hour.
  const loopkeeper =
    0.45 * clamp01(agg.routeRepetitionRatio / 0.6) +
    0.3 * clamp01(agg.loopRatio / 0.6) +
    0.25 * clamp01(agg.timeOfDayConsistency / 0.7);

  // Blockscout: many places, nose down at every one of them.
  const blockscout =
    0.55 * clamp01(agg.distinctPlaceCount / (agg.walkCount * 1.5)) +
    0.45 * clamp01(agg.sniffPerKm / 4);

  // Newbond: the first-year chapter of a first dog — the relationship IS the
  // identity while it is being built, whatever the route looks like.
  const newbond =
    facts.firstDog === true &&
    facts.ownershipMonths != null &&
    facts.ownershipMonths < 12
      ? 0.9
      : 0;

  return { softstep, loopkeeper, blockscout, newbond };
}

/**
 * The earned sign. Life-stage signs always win (a puppy is Wonderbound no
 * matter how it walks); otherwise the strongest behavioural score takes it,
 * with a stable tie-break so classification is deterministic.
 */
export function deriveWalksignFromWalks(
  agg: WalkAggregates,
  facts: WalksignPetFacts,
): WalksignId | null {
  if (facts.species !== 'dog') return null;
  if (isPuppy(facts.lifeStage)) return 'wonderbound';
  if (isSenior(facts.lifeStage)) return 'storywalker';

  const scores = scoreWalksigns(agg, facts);
  const order: (keyof WalksignScores)[] = [
    'newbond',
    'softstep',
    'loopkeeper',
    'blockscout',
  ];
  let best: keyof WalksignScores = 'loopkeeper';
  let bestScore = -1;
  for (const sign of order) {
    if (scores[sign] > bestScore) {
      best = sign;
      bestScore = scores[sign];
    }
  }
  return best;
}

// ── Layer 3: the sticky state machine ───────────────────────────────────────

export interface EvaluateWalksignArgs {
  current: { sign: WalksignId; status: WalksignStatus } | null;
  facts: WalksignPetFacts;
  /** Aggregates over valid walks; null when walk tracking has produced none. */
  aggregates: WalkAggregates | null;
  validWalkCount: number;
}

/** The behavioural reading, falling back to a fresh provisional when no
 *  walks exist (walk tracking off, or a transition before the fifth walk). */
function bestAvailableSign(
  facts: WalksignPetFacts,
  aggregates: WalkAggregates | null,
): WalksignId | null {
  if (aggregates && aggregates.walkCount > 0) {
    return deriveWalksignFromWalks(aggregates, facts);
  }
  return deriveProvisionalWalksign(facts)?.sign ?? null;
}

export function evaluateWalksign(args: EvaluateWalksignArgs): WalksignEvaluation {
  const { current, facts, aggregates, validWalkCount } = args;
  if (facts.species !== 'dog') return { change: null };

  // No sign yet → the first reading.
  if (!current) {
    const assignment = deriveProvisionalWalksign(facts);
    return assignment ? { change: { assignment, event: 'assigned' } } : { change: null };
  }

  if (current.status === 'provisional') {
    // Enough real walks → confirm. The confirmed sign is the EARNED one,
    // which may differ from the first reading — that correction is the
    // moment's whole story ("their walks said otherwise").
    if (validWalkCount >= CONFIRM_WALK_COUNT && aggregates) {
      const sign = deriveWalksignFromWalks(aggregates, facts) ?? current.sign;
      return {
        change: {
          assignment: { sign, status: 'confirmed', reason: 'confirmed_by_walks' },
          event: 'confirmed',
        },
      };
    }
    // A provisional sign tracks life-stage crossings quietly (no ceremony —
    // nothing was confirmed yet). Other provisional facts never reshuffle it.
    if (isSenior(facts.lifeStage) && current.sign !== 'storywalker') {
      return {
        change: {
          assignment: { sign: 'storywalker', status: 'provisional', reason: 'life_stage_senior' },
          event: 'assigned',
        },
      };
    }
    if (!isPuppy(facts.lifeStage) && current.sign === 'wonderbound') {
      const sign = bestAvailableSign(
        facts,
        aggregates,
      );
      if (sign && sign !== 'wonderbound') {
        return {
          change: {
            assignment: { sign, status: 'provisional', reason: 'life_stage_adult' },
            event: 'assigned',
          },
        };
      }
    }
    return { change: null };
  }

  // Confirmed: sticky. Only life transitions move it, and each fires once.
  if (current.sign === 'wonderbound' && !isPuppy(facts.lifeStage)) {
    const sign = bestAvailableSign(facts, aggregates);
    if (sign && sign !== 'wonderbound') {
      return {
        change: {
          assignment: { sign, status: 'confirmed', reason: 'wonderbound_graduation' },
          event: 'transition',
          transitionKind: 'wonderbound_graduation',
        },
      };
    }
    return { change: null };
  }

  if (current.sign !== 'storywalker' && isSenior(facts.lifeStage)) {
    return {
      change: {
        assignment: { sign: 'storywalker', status: 'confirmed', reason: 'storywalker_arrival' },
        event: 'transition',
        transitionKind: 'storywalker_arrival',
      },
    };
  }

  return { change: null };
}
