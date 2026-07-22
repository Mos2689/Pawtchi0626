/**
 * Walksign types — the identity Pawtchi discovers from how a dog moves
 * through the world.
 *
 * Seven signs, one dog each. Ids are internal and stable; every user-facing
 * string lives in lib/walksign/copy.ts so a post-trademark-screen rename
 * never touches logic or storage.
 */

import type { LifeStage } from '../lifeStage';

export type WalksignId =
  | 'newbond'      // the dog who made you a dog person
  | 'loopkeeper'   // same route, never the same walk
  | 'blockscout'   // every corner is worth knowing
  | 'packheart'    // many hands, one best friend
  | 'softstep'     // space is part of the walk
  | 'storywalker'  // some paths become part of us
  | 'wonderbound'; // the whole world is new

export const ALL_WALKSIGNS: readonly WalksignId[] = [
  'newbond',
  'loopkeeper',
  'blockscout',
  'packheart',
  'softstep',
  'storywalker',
  'wonderbound',
] as const;

export type WalksignStatus = 'provisional' | 'confirmed';

export interface WalksignAssignment {
  sign: WalksignId;
  status: WalksignStatus;
  /** Machine-readable provenance, stored in walksign_history. */
  reason: string;
}

/** One entry in pets.walksign_history (append-only). */
export interface WalksignHistoryEntry {
  sign: WalksignId;
  status: WalksignStatus;
  reason: string;
  at: string;
}

/** The pet facts the engine reads — all available at onboarding. */
export interface WalksignPetFacts {
  species: 'dog' | 'cat';
  lifeStage: LifeStage;
  firstDog?: boolean | null;
  /** Months since the pet row was created — the Newbond first-year window. */
  ownershipMonths?: number | null;
  /** Future household feature; ≥3 regular walkers reads as Packheart. */
  householdWalkers?: number | null;
  activityLevel?: 'sedentary' | 'normal' | 'active' | 'highly_active' | null;
}

/** The subset of a walk_sessions row the aggregator consumes. */
export interface WalksignWalkRow {
  startedAt: string | number;
  durationS: number;
  movingTimeS: number;
  distanceM: number;
  avgSpeedKmh: number;
  endReason: string;
  startLabel: string | null;
  endLabel: string | null;
  farthestLabel: string | null;
  /** Sniff stops — length of the session's pause_points. */
  pauseCount: number;
}

/** Behavioural fingerprint folded from a dog's valid walks. */
export interface WalkAggregates {
  walkCount: number;
  /** Sniff stops per km — nose-led curiosity. */
  sniffPerKm: number;
  /** Share of walks that ended by returning home (a real loop). */
  loopRatio: number;
  /** Share of labelled walks on the single most-walked route. */
  routeRepetitionRatio: number;
  /** Distinct place labels seen across starts, ends, and turnarounds. */
  distinctPlaceCount: number;
  avgMovingSpeedKmh: number;
  /** Share of walk time spent not moving — pace chosen by the dog. */
  pauseTimeRatio: number;
  avgDistanceM: number;
  /** Share of walks inside the modal 3-hour slot — the routine signal. */
  timeOfDayConsistency: number;
}

export type WalksignTransitionKind =
  | 'wonderbound_graduation'
  | 'storywalker_arrival';

export type WalksignEventKind = 'assigned' | 'confirmed' | 'transition';

/** What evaluateWalksign decided. Null change = nothing to persist. */
export interface WalksignEvaluation {
  change: {
    assignment: WalksignAssignment;
    event: WalksignEventKind;
    transitionKind?: WalksignTransitionKind;
  } | null;
}
