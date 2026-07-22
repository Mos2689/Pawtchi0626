/**
 * activityMatcher — pairs a finished, validated walk with the scheduled
 * activity it should complete.
 *
 * Same philosophy as feedingActivityLink (meal log → feeding card): the user
 * did the thing, the plan should notice on its own. Matching is deliberately
 * conservative — pending walk rows only, on the walk's own local date, within
 * a ±3h window of the schedule — so a tracked walk can never steal a row a
 * human (or another walk) already resolved. No match is not a failure: the
 * walk is preserved as a manually-logged completed row instead.
 */

import { getLocalYMD } from '../dateUtils';
import { DogWalkProfile, intensityForPace } from './dogCalibration';
import { WalkSummary } from './walkSession';

export interface MatchableActivity {
  id: string;
  activity_type: string;
  status: string;
  scheduled_date: string; // YYYY-MM-DD
  scheduled_time: string | null; // HH:MM:SS
}

/** How far a walk may sit from its scheduled slot and still claim it. */
export const MATCH_WINDOW_MS = 3 * 60 * 60_000;

function slotTimestamp(activity: MatchableActivity): number | null {
  if (!activity.scheduled_time) return null;
  const dt = new Date(`${activity.scheduled_date}T${activity.scheduled_time}`);
  const t = dt.getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Pick the pending walk activity nearest (by scheduled time) to the walk's
 * midpoint, within the match window. Candidates are expected to be today's
 * rows for the walked pet; the filters here re-assert the invariants anyway.
 */
export function matchWalkToActivity(
  candidates: MatchableActivity[],
  summary: WalkSummary,
): MatchableActivity | null {
  const walkDate = getLocalYMD(new Date(summary.startedAt));
  const midpoint = (summary.startedAt + summary.endedAt) / 2;

  let best: MatchableActivity | null = null;
  let bestGap = Infinity;

  for (const activity of candidates) {
    if (activity.activity_type !== 'walk') continue;
    if (activity.status !== 'pending') continue;
    if (activity.scheduled_date !== walkDate) continue;

    const slot = slotTimestamp(activity);
    // A pending walk with no scheduled time is still claimable — treat it as
    // matching at maximum in-window distance so timed slots win over it.
    const gap = slot === null ? MATCH_WINDOW_MS - 1 : Math.abs(slot - midpoint);
    if (gap < MATCH_WINDOW_MS && gap < bestGap) {
      best = activity;
      bestGap = gap;
    }
  }

  return best;
}

export interface UnmatchedWalkPayload {
  pet_id: string;
  activity_type: 'walk';
  title: string;
  notes: null;
  status: 'completed';
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number;
  active_minutes: number;
  distance_km: number;
  intensity: 'low' | 'moderate' | 'high';
  is_ai_generated: false;
  walk_session_id: string;
  completed_at: string;
  created_at: string;
}

/**
 * When no scheduled slot matches, the walk becomes its own completed row —
 * mirroring the Activity tab's manual-log payload so timelines, burn cards,
 * and weekly stats treat it identically.
 *
 * Two duration fields, two jobs: duration_minutes is ELAPSED time (what
 * timelines and weekly minute totals display — "the walk took 40 minutes"),
 * active_minutes is MOVING time (what kcal derives from — standing still or
 * GPS-drifting on a shelf burns nothing).
 */
export function buildUnmatchedWalkPayload(
  petId: string,
  summary: WalkSummary,
  walkSessionId: string,
  profile: DogWalkProfile,
): UnmatchedWalkPayload {
  const start = new Date(summary.startedAt);
  return {
    pet_id: petId,
    activity_type: 'walk',
    title: 'Walk',
    notes: null,
    status: 'completed',
    scheduled_date: getLocalYMD(start),
    scheduled_time: start.toTimeString().slice(0, 8),
    duration_minutes: Math.max(1, Math.round(summary.durationS / 60)),
    active_minutes: Math.round(summary.movingTimeS / 60),
    distance_km: Math.round((summary.distanceM / 1000) * 100) / 100,
    intensity: intensityForPace(summary.avgMovingSpeedKmh, profile),
    is_ai_generated: false,
    walk_session_id: walkSessionId,
    completed_at: new Date(summary.endedAt).toISOString(),
    created_at: new Date(summary.endedAt).toISOString(),
  };
}
