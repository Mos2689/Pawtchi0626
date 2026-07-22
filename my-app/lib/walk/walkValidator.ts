/**
 * walkValidator — the false-positive gate.
 *
 * Only a `valid` verdict may auto-complete a SCHEDULED activity slot. The
 * softer verdicts still log the walk as its own completed row (effort is
 * never discarded — walkSync handles that); only a vehicle ride is dropped:
 *
 *   too_short      — doorstep loop, quick pee break: logged, can't claim a slot
 *   gps_junk       — patchy signal: logged with what was measured
 *   likely_vehicle — the "drove to the vet with tracking on" case: discarded
 */

import { DogWalkProfile } from './dogCalibration';
import { WalkSummary } from './walkSession';

export type WalkVerdict = 'valid' | 'too_short' | 'likely_vehicle' | 'gps_junk';

export interface ValidationResult {
  verdict: WalkVerdict;
  /** 0..1 — how confidently the verdict holds. */
  confidence: number;
  reasons: string[];
}

/** Sustained average above this is not a dog walk, whatever the breed. */
const VEHICLE_AVG_SPEED_KMH = 10;
/** Share of speed-gated samples that flags a drive. */
const VEHICLE_REJECT_RATIO = 0.2;
/** Share of accuracy-gated samples that flags an untrustworthy trace. */
const JUNK_REJECT_RATIO = 0.6;
/** Fewer accepted fixes than this and nothing can be concluded. */
const MIN_ACCEPTED_POINTS = 10;

export function validateWalk(
  summary: WalkSummary,
  profile: DogWalkProfile,
): ValidationResult {
  const reasons: string[] = [];
  const totalFixes =
    summary.acceptedCount +
    summary.rejectedForAccuracy +
    summary.rejectedForSpeed;

  // 1. Can the trace be trusted at all?
  if (summary.acceptedCount < MIN_ACCEPTED_POINTS) {
    return {
      verdict: 'gps_junk',
      confidence: 0.9,
      reasons: [`only ${summary.acceptedCount} usable GPS fixes`],
    };
  }
  const accuracyRejectRatio =
    totalFixes > 0 ? summary.rejectedForAccuracy / totalFixes : 0;
  if (accuracyRejectRatio > JUNK_REJECT_RATIO) {
    return {
      verdict: 'gps_junk',
      confidence: 0.8,
      reasons: [
        `${Math.round(accuracyRejectRatio * 100)}% of fixes failed the accuracy gate`,
      ],
    };
  }

  // 2. Was this movement a walk or a ride?
  const speedRejectRatio =
    totalFixes > 0 ? summary.rejectedForSpeed / totalFixes : 0;
  if (speedRejectRatio > VEHICLE_REJECT_RATIO) {
    reasons.push(
      `${Math.round(speedRejectRatio * 100)}% of segments exceeded walking speed`,
    );
  }
  if (summary.avgMovingSpeedKmh > VEHICLE_AVG_SPEED_KMH) {
    reasons.push(
      `average moving speed ${summary.avgMovingSpeedKmh} km/h is beyond a walk`,
    );
  }
  if (reasons.length > 0) {
    return { verdict: 'likely_vehicle', confidence: 0.85, reasons };
  }

  // 3. Was it enough of a walk for THIS dog?
  if (summary.durationS < profile.minValidDurationS) {
    return {
      verdict: 'too_short',
      confidence: 0.9,
      reasons: [
        `${Math.round(summary.durationS / 60)} min is under the ${Math.round(
          profile.minValidDurationS / 60,
        )} min floor`,
      ],
    };
  }
  if (summary.distanceM < profile.minValidDistanceM) {
    return {
      verdict: 'too_short',
      confidence: 0.85,
      reasons: [
        `${Math.round(summary.distanceM)}m is under the ${profile.minValidDistanceM}m floor`,
      ],
    };
  }

  // 4. Valid. Confidence eases toward 1 as the pace sits inside the dog's
  // plausible band and the trace stays clean.
  const { min, max } = profile.paceBandKmh;
  const paceInBand =
    summary.avgMovingSpeedKmh >= min && summary.avgMovingSpeedKmh <= max;
  const confidence = Math.max(
    0.6,
    Math.min(1, (paceInBand ? 0.9 : 0.7) - accuracyRejectRatio * 0.3),
  );
  return { verdict: 'valid', confidence, reasons: [] };
}
