/**
 * Pure Walksign classifier and sticky identity state machine.
 *
 * Onboarding supplies an honest provisional reading. Valid tracked walks then
 * supply real sniff, route, pace, distance and routine evidence. Confirmation
 * waits for enough walks and a decisive score; confirmed identities only
 * evolve on strong sustained evidence or an explicit life-stage transition.
 */

import type { LifeStage } from '../lifeStage';
import { haversineMeters, type GeoPoint } from '../walk/geo';
import type {
  WalkAggregates,
  WalksignAssignment,
  WalksignEvaluation,
  WalksignId,
  WalksignPetFacts,
  WalksignStatus,
  WalksignWalkRow,
} from './types';

export const CONFIRM_WALK_COUNT = 5;
export const CONFIRM_MIN_SCORE = 0.4;
export const CONFIRM_MIN_MARGIN = 0.1;
export const EVOLUTION_WALK_COUNT = 12;
export const BROAD_EVIDENCE_WALK_COUNT = 30;
export const EVOLUTION_MIN_DAYS = 30;
export const EVOLUTION_MIN_SCORE = 0.6;
export const EVOLUTION_MIN_MARGIN = 0.15;

const PUPPY_STAGES: readonly LifeStage[] = ['puppy', 'junior'];
const SENIOR_STAGES: readonly LifeStage[] = ['senior', 'geriatric'];
const ROUTE_SAMPLE_POINTS = 16;
const SAME_ROUTE_THRESHOLD_M = 75;

const isPuppy = (stage: LifeStage) => PUPPY_STAGES.includes(stage);
const isSenior = (stage: LifeStage) => SENIOR_STAGES.includes(stage);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Provisional onboarding reading. Explicit life and relationship facts outrank
 * the broad energy fallback. Cats never receive a Walksign.
 */
export function deriveProvisionalWalksign(
  facts: WalksignPetFacts,
): WalksignAssignment | null {
  if (facts.species !== 'dog') return null;
  if (isPuppy(facts.lifeStage)) {
    return {
      sign: 'wonderbound',
      status: 'provisional',
      reason: 'life_stage_puppy',
    };
  }
  if (isSenior(facts.lifeStage)) {
    return {
      sign: 'storywalker',
      status: 'provisional',
      reason: 'life_stage_senior',
    };
  }
  if (facts.firstDog === true) {
    return { sign: 'newbond', status: 'provisional', reason: 'first_dog' };
  }
  if ((facts.householdWalkers ?? 0) >= 3) {
    return {
      sign: 'packheart',
      status: 'provisional',
      reason: 'household_walkers',
    };
  }
  if (facts.activityLevel === 'sedentary') {
    return {
      sign: 'softstep',
      status: 'provisional',
      reason: 'energy_gentle',
    };
  }
  if (
    facts.activityLevel === 'active' ||
    facts.activityLevel === 'highly_active'
  ) {
    return {
      sign: 'blockscout',
      status: 'provisional',
      reason: 'energy_curious',
    };
  }
  return {
    sign: 'loopkeeper',
    status: 'provisional',
    reason: 'energy_steady',
  };
}

function validRoute(route: GeoPoint[]): GeoPoint[] {
  return route.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
  );
}

/** Distance-spaced samples make comparison independent of GPS sample rate. */
function sampleRoute(
  route: GeoPoint[],
  count = ROUTE_SAMPLE_POINTS,
): GeoPoint[] {
  const points = validRoute(route);
  if (points.length < 2) return [];

  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(
      cumulative[index - 1] +
        haversineMeters(points[index - 1], points[index]),
    );
  }
  const total = cumulative[cumulative.length - 1];
  if (!Number.isFinite(total) || total < 1) return [];

  return Array.from({ length: count }, (_, sampleIndex) => {
    const target = (sampleIndex / (count - 1)) * total;
    let segment = 1;
    while (
      segment < cumulative.length - 1 &&
      cumulative[segment] < target
    ) {
      segment += 1;
    }
    const fromDistance = cumulative[segment - 1];
    const toDistance = cumulative[segment];
    const span = Math.max(1e-9, toDistance - fromDistance);
    const t = Math.max(
      0,
      Math.min(1, (target - fromDistance) / span),
    );
    const from = points[segment - 1];
    const to = points[segment];
    return {
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
    };
  });
}

/** Mean sampled separation, direction-agnostic for reverse-travelled routes. */
export function routeSimilarityMeters(
  a: GeoPoint[],
  b: GeoPoint[],
): number {
  const sampledA = sampleRoute(a);
  const sampledB = sampleRoute(b);
  if (sampledA.length === 0 || sampledB.length === 0) return Infinity;

  const mean = (right: GeoPoint[]) =>
    sampledA.reduce(
      (sum, point, index) =>
        sum + haversineMeters(point, right[index]),
      0,
    ) / sampledA.length;
  return Math.min(mean(sampledB), mean([...sampledB].reverse()));
}

/**
 * Largest geographic route cluster divided by all drawable routes. Label
 * pairs are retained only as a legacy fallback when no route coordinates exist.
 */
export function geographicRouteRepetitionRatio(
  routes: GeoPoint[][],
): number {
  const usable = routes
    .map(validRoute)
    .filter((route) => sampleRoute(route).length > 0);
  if (usable.length === 0) return 0;

  const clusters: { representative: GeoPoint[]; count: number }[] = [];
  for (const route of usable) {
    const match = clusters.find(
      (cluster) =>
        routeSimilarityMeters(cluster.representative, route) <=
        SAME_ROUTE_THRESHOLD_M,
    );
    if (match) match.count += 1;
    else clusters.push({ representative: route, count: 1 });
  }
  return (
    Math.max(...clusters.map((cluster) => cluster.count)) / usable.length
  );
}

/** Fold valid tracked walks into the behavioral fingerprint. */
export function aggregateWalks(rows: WalksignWalkRow[]): WalkAggregates {
  const walkCount = rows.length;
  if (walkCount === 0) {
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
  const labelledRouteCounts = new Map<string, number>();
  const hourBuckets = new Map<number, number>();
  const routes: GeoPoint[][] = [];
  let labelledWalks = 0;

  for (const row of rows) {
    totalKm += row.distanceM / 1000;
    totalSniffs += row.sniffCount;
    totalDuration += row.durationS;
    totalMoving += Math.min(row.movingTimeS, row.durationS);
    speedSum += row.avgSpeedKmh;
    if (row.endReason === 'auto_home') loops += 1;

    for (const label of [
      row.startLabel,
      row.endLabel,
      row.farthestLabel,
    ]) {
      if (label) places.add(label);
    }

    const trailing = row.farthestLabel ?? row.endLabel;
    if (row.startLabel && trailing) {
      labelledWalks += 1;
      const key = `${row.startLabel}→${trailing}`;
      labelledRouteCounts.set(
        key,
        (labelledRouteCounts.get(key) ?? 0) + 1,
      );
    }
    if (validRoute(row.route).length >= 2) routes.push(row.route);

    const startedAt = new Date(row.startedAt);
    if (!Number.isNaN(startedAt.getTime())) {
      const bucket = Math.floor(startedAt.getHours() / 3);
      hourBuckets.set(bucket, (hourBuckets.get(bucket) ?? 0) + 1);
    }
  }

  const geographicRepetition = geographicRouteRepetitionRatio(routes);
  const modalLabelRoute = Math.max(0, ...labelledRouteCounts.values());
  const routeRepetitionRatio =
    routes.length > 0
      ? geographicRepetition
      : labelledWalks > 0
        ? modalLabelRoute / labelledWalks
        : 0;
  const modalTimeBucket = Math.max(0, ...hourBuckets.values());

  return {
    walkCount,
    sniffPerKm: totalKm > 0 ? totalSniffs / totalKm : 0,
    loopRatio: loops / walkCount,
    routeRepetitionRatio,
    distinctPlaceCount: places.size,
    avgMovingSpeedKmh: speedSum / walkCount,
    pauseTimeRatio:
      totalDuration > 0
        ? Math.max(0, totalDuration - totalMoving) / totalDuration
        : 0,
    avgDistanceM: (totalKm * 1000) / walkCount,
    timeOfDayConsistency: modalTimeBucket / walkCount,
  };
}

export interface WalksignScores {
  softstep: number;
  loopkeeper: number;
  blockscout: number;
  newbond: number;
  packheart: number;
}

export function scoreWalksigns(
  aggregates: WalkAggregates,
  facts: WalksignPetFacts,
): WalksignScores {
  const softstep =
    0.5 * clamp01(aggregates.pauseTimeRatio / 0.5) +
    0.25 * clamp01((4 - aggregates.avgMovingSpeedKmh) / 4) +
    0.25 * clamp01((1500 - aggregates.avgDistanceM) / 1500);

  const loopkeeper =
    0.45 * clamp01(aggregates.routeRepetitionRatio / 0.6) +
    0.3 * clamp01(aggregates.loopRatio / 0.6) +
    0.25 * clamp01(aggregates.timeOfDayConsistency / 0.7);

  const blockscout =
    0.55 *
      clamp01(
        aggregates.distinctPlaceCount /
          Math.max(1, aggregates.walkCount * 1.5),
      ) +
    0.45 * clamp01(aggregates.sniffPerKm / 4);

  const newbond =
    facts.firstDog === true &&
    facts.ownershipMonths != null &&
    facts.ownershipMonths < 12
      ? 1
      : 0;
  const packheart = (facts.householdWalkers ?? 0) >= 3 ? 1 : 0;

  return { softstep, loopkeeper, blockscout, newbond, packheart };
}

export interface WalksignReading {
  sign: WalksignId;
  score: number;
  margin: number;
  confident: boolean;
  basis: 'life_stage' | 'relationship' | 'behavior';
}

export function deriveWalksignReading(
  aggregates: WalkAggregates,
  facts: WalksignPetFacts,
): WalksignReading | null {
  if (facts.species !== 'dog') return null;
  if (isPuppy(facts.lifeStage)) {
    return {
      sign: 'wonderbound',
      score: 1,
      margin: 1,
      confident: true,
      basis: 'life_stage',
    };
  }
  if (isSenior(facts.lifeStage)) {
    return {
      sign: 'storywalker',
      score: 1,
      margin: 1,
      confident: true,
      basis: 'life_stage',
    };
  }
  if (
    facts.firstDog === true &&
    facts.ownershipMonths != null &&
    facts.ownershipMonths < 12
  ) {
    return {
      sign: 'newbond',
      score: 1,
      margin: 1,
      confident: true,
      basis: 'relationship',
    };
  }
  if ((facts.householdWalkers ?? 0) >= 3) {
    return {
      sign: 'packheart',
      score: 1,
      margin: 1,
      confident: true,
      basis: 'relationship',
    };
  }

  const scores = scoreWalksigns(aggregates, facts);
  const order = ['softstep', 'loopkeeper', 'blockscout'] as const;
  const ranked = order
    .map((sign) => ({ sign, score: scores[sign] }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        order.indexOf(a.sign) - order.indexOf(b.sign),
    );
  const winner = ranked[0];
  const margin = winner.score - ranked[1].score;
  return {
    sign: winner.sign,
    score: winner.score,
    margin,
    confident:
      winner.score >= CONFIRM_MIN_SCORE &&
      margin >= CONFIRM_MIN_MARGIN,
    basis: 'behavior',
  };
}

/** Backward-compatible sign-only API for renderers and existing tests. */
export function deriveWalksignFromWalks(
  aggregates: WalkAggregates,
  facts: WalksignPetFacts,
): WalksignId | null {
  return deriveWalksignReading(aggregates, facts)?.sign ?? null;
}

export interface EvaluateWalksignArgs {
  current: { sign: WalksignId; status: WalksignStatus } | null;
  facts: WalksignPetFacts;
  aggregates: WalkAggregates | null;
  validWalkCount: number;
  /** Recent evidence window, normally the 12 newest valid walks. */
  recentAggregates?: WalkAggregates | null;
  validWalksSinceAssignment?: number;
  daysSinceAssignment?: number;
}

function bestAvailableSign(
  facts: WalksignPetFacts,
  aggregates: WalkAggregates | null,
): WalksignId | null {
  if (aggregates && aggregates.walkCount > 0) {
    return deriveWalksignFromWalks(aggregates, facts);
  }
  return deriveProvisionalWalksign(facts)?.sign ?? null;
}

function evidence(
  reading: WalksignReading,
  walkCount: number,
): NonNullable<WalksignEvaluation['change']>['evidence'] {
  return {
    score: Math.round(reading.score * 1000) / 1000,
    margin: Math.round(reading.margin * 1000) / 1000,
    walkCount,
  };
}

export function evaluateWalksign(
  args: EvaluateWalksignArgs,
): WalksignEvaluation {
  const {
    current,
    facts,
    aggregates,
    validWalkCount,
    recentAggregates,
    validWalksSinceAssignment = 0,
    daysSinceAssignment = 0,
  } = args;
  if (facts.species !== 'dog') return { change: null };

  if (!current) {
    const assignment = deriveProvisionalWalksign(facts);
    return assignment
      ? { change: { assignment, event: 'assigned' } }
      : { change: null };
  }

  if (current.status === 'provisional') {
    if (validWalkCount >= CONFIRM_WALK_COUNT && aggregates) {
      const reading = deriveWalksignReading(aggregates, facts);
      if (reading?.confident) {
        return {
          change: {
            assignment: {
              sign: reading.sign,
              status: 'confirmed',
              reason: 'confirmed_by_walks',
            },
            event: 'confirmed',
            evidence: evidence(reading, validWalkCount),
          },
        };
      }
    }

    if (isSenior(facts.lifeStage) && current.sign !== 'storywalker') {
      return {
        change: {
          assignment: {
            sign: 'storywalker',
            status: 'provisional',
            reason: 'life_stage_senior',
          },
          event: 'assigned',
        },
      };
    }
    if (!isPuppy(facts.lifeStage) && current.sign === 'wonderbound') {
      const sign = bestAvailableSign(facts, aggregates);
      if (sign && sign !== 'wonderbound') {
        return {
          change: {
            assignment: {
              sign,
              status: 'provisional',
              reason: 'life_stage_adult',
            },
            event: 'assigned',
          },
        };
      }
    }
    return { change: null };
  }

  // Explicit life-stage transitions always outrank behavioral evolution.
  if (current.sign === 'wonderbound' && !isPuppy(facts.lifeStage)) {
    const sign = bestAvailableSign(facts, aggregates);
    if (sign && sign !== 'wonderbound') {
      return {
        change: {
          assignment: {
            sign,
            status: 'confirmed',
            reason: 'wonderbound_graduation',
          },
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
        assignment: {
          sign: 'storywalker',
          status: 'confirmed',
          reason: 'storywalker_arrival',
        },
        event: 'transition',
        transitionKind: 'storywalker_arrival',
      },
    };
  }

  const evolutionEligible =
    validWalksSinceAssignment >= EVOLUTION_WALK_COUNT &&
    daysSinceAssignment >= EVOLUTION_MIN_DAYS &&
    aggregates &&
    recentAggregates;
  if (evolutionEligible) {
    const broad = deriveWalksignReading(aggregates, facts);
    const recent = deriveWalksignReading(recentAggregates, facts);
    const sustained =
      broad &&
      recent &&
      broad.sign === recent.sign &&
      broad.sign !== current.sign &&
      broad.confident &&
      recent.score >= EVOLUTION_MIN_SCORE &&
      recent.margin >= EVOLUTION_MIN_MARGIN;
    if (sustained && recent) {
      return {
        change: {
          assignment: {
            sign: recent.sign,
            status: 'confirmed',
            reason: 'behavioral_evolution',
          },
          event: 'transition',
          transitionKind: 'behavioral_evolution',
          evidence: evidence(recent, recentAggregates.walkCount),
        },
      };
    }
  }

  return { change: null };
}
