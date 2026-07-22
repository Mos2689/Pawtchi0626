/**
 * walkSync — persists a finished walk and lets it complete the plan.
 *
 * Pipeline per walk (each step idempotent, so the whole thing is retryable):
 *
 *   1. upsert walk_sessions        — client-generated UUID is the PK; a retry
 *                                    can never create a second row.
 *   2. resolve the plan            — valid walks either claim the nearest
 *                                    pending scheduled walk (activityMatcher →
 *                                    persistActivityCompletion, the same code
 *                                    manual taps run) or are logged as their
 *                                    own completed row so effort is never lost.
 *                                    The partial unique index on
 *                                    activities.walk_session_id backs both up.
 *   3. side effects                — coins (server-idempotent via the walk
 *                                    session id as reference), Home-ring
 *                                    invalidation, reminder cancel.
 *
 * Offline: walks queue in AsyncStorage with per-step flags and are re-flushed
 * on demand (app launch, next walk). Verdicts other than 'valid' stop after
 * step 1 — a car ride must never close a walk ring.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { track } from '../analytics';
import { getLocalYMD } from '../dateUtils';
import {
  fireCompletionSideEffects,
  persistActivityCompletion,
} from '../completeActivity';
import {
  buildUnmatchedWalkPayload,
  matchWalkToActivity,
  MatchableActivity,
} from './activityMatcher';
import { DogWalkProfile } from './dogCalibration';
import { GeoPoint } from './geo';
import { WalkSummary } from './walkSession';
import { ValidationResult } from './walkValidator';
import type { WalkLabels } from './geoLabels';
import { maybeEvaluateWalksign } from '../walksign/walksignSync';
import { evaluatePawPrints } from '../pawPrintsSync';

const QUEUE_KEY = 'walk:sync_queue';
const MAX_ATTEMPTS = 50;

/** RFC-4122-shaped v4 id. Client-side PK for retry-safe inserts — collision
 *  resistance matters here, cryptographic strength does not. */
export function generateWalkSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type WalkSyncOutcome =
  | 'matched'          // claimed a scheduled walk
  | 'logged_new'       // no slot in range — saved as its own completed row
  | 'skipped_duplicate'// someone/something else completed the slot first
  | 'not_valid'        // verdict gate said no auto-completion
  | 'queued';          // offline — will retry

export interface WalkSyncResult {
  outcome: WalkSyncOutcome;
  matchedActivityId: string | null;
}

interface QueuedWalk {
  walkSessionId: string;
  petId: string;
  ownerId: string;
  /** summary.path is stripped before queueing — `route` carries the trace. */
  summary: WalkSummary;
  route: GeoPoint[];
  verdict: ValidationResult;
  profile: DogWalkProfile;
  labels: WalkLabels;
  steps: {
    sessionSaved: boolean;
    planResolved: boolean;
    sideEffectsFired: boolean;
  };
  outcome: WalkSyncOutcome | null;
  matchedActivityId: string | null;
  /** Activity row the side effects should reference (matched or new). */
  effectActivityId: string | null;
  attempts: number;
  createdAt: number;
}

async function readQueue(): Promise<QueuedWalk[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueuedWalk[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Storage failure just means the retry safety net is gone for this walk;
    // the in-flight attempt still runs.
  }
}

export interface FinalizeWalkArgs {
  walkSessionId: string;
  summary: WalkSummary;
  route: GeoPoint[];
  verdict: ValidationResult;
  profile: DogWalkProfile;
  petId: string;
  ownerId: string;
  labels: WalkLabels;
}

/**
 * Queue the finished walk and attempt an immediate flush. Returns this walk's
 * result — 'queued' when the network wasn't there for it.
 */
export async function finalizeAndSyncWalk(args: FinalizeWalkArgs): Promise<WalkSyncResult> {
  const item: QueuedWalk = {
    walkSessionId: args.walkSessionId,
    petId: args.petId,
    ownerId: args.ownerId,
    summary: { ...args.summary, path: [] },
    route: args.route,
    verdict: args.verdict,
    profile: args.profile,
    labels: args.labels,
    steps: { sessionSaved: false, planResolved: false, sideEffectsFired: false },
    outcome: null,
    matchedActivityId: null,
    effectActivityId: null,
    attempts: 0,
    createdAt: Date.now(),
  };

  const queue = await readQueue();
  queue.push(item);
  await writeQueue(queue);

  await flushWalkQueue();

  const after = await readQueue();
  const mine = after.find(q => q.walkSessionId === args.walkSessionId);
  if (!mine) {
    // Fully processed and removed — recover the outcome from the DB-free
    // path: flush stores outcomes on the item before removal, so re-read via
    // the completed map.
    const done = completedOutcomes.get(args.walkSessionId);
    return done ?? { outcome: 'queued', matchedActivityId: null };
  }
  return { outcome: 'queued', matchedActivityId: null };
}

// Outcomes of items completed during this JS session, so finalizeAndSyncWalk
// can report what happened after the queue entry is gone.
const completedOutcomes = new Map<string, WalkSyncResult>();

let flushing = false;

/** Process every queued walk. Safe to call often; concurrent calls coalesce. */
export async function flushWalkQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let queue = await readQueue();
    if (queue.length === 0) return;

    const remaining: QueuedWalk[] = [];
    for (const item of queue) {
      try {
        const result = await processQueuedWalk(item);
        completedOutcomes.set(item.walkSessionId, result);
      } catch (e) {
        item.attempts += 1;
        if (item.attempts >= MAX_ATTEMPTS) {
          track('walk_sync_dropped', {
            walk_session_id: item.walkSessionId,
            attempts: item.attempts,
          });
        } else {
          remaining.push(item);
        }
      }
    }
    await writeQueue(remaining);
  } finally {
    flushing = false;
  }
}

/** Runs the three-step pipeline, mutating the item's step flags as it goes. */
async function processQueuedWalk(item: QueuedWalk): Promise<WalkSyncResult> {
  const s = item.summary;
  const walkDate = getLocalYMD(new Date(s.startedAt));

  // ── Step 1: the session row (idempotent via client PK) ──
  if (!item.steps.sessionSaved) {
    const { error } = await supabase.from('walk_sessions').upsert(
      {
        id: item.walkSessionId,
        owner_id: item.ownerId,
        pet_id: item.petId,
        started_at: new Date(s.startedAt).toISOString(),
        ended_at: new Date(s.endedAt).toISOString(),
        duration_s: s.durationS,
        moving_time_s: s.movingTimeS,
        distance_m: s.distanceM,
        avg_speed_kmh: s.avgMovingSpeedKmh,
        point_count: s.acceptedCount,
        route: item.route,
        validation_verdict: item.verdict.verdict,
        end_reason: s.endReason,
        start_label: item.labels.startLabel,
        end_label: item.labels.endLabel,
        farthest_label: item.labels.farthestLabel,
        pause_points: s.pausePoints ?? [],
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (error) throw error;
    item.steps.sessionSaved = true;
  }

  // ── Verdict gate: a drive must never count as a walk. Everything else is
  // real effort — a 3-minute doorstep loop or a patchy-GPS amble still gets
  // logged (as its own row), it just can't CLAIM a scheduled walk slot; that
  // privilege stays reserved for clean 'valid' sessions. ──
  if (item.verdict.verdict === 'likely_vehicle') {
    item.steps.planResolved = true;
    item.steps.sideEffectsFired = true;
    item.outcome = 'not_valid';
    track('walk_discarded', {
      verdict: item.verdict.verdict,
      duration_s: s.durationS,
      distance_m: s.distanceM,
    });
    return { outcome: 'not_valid', matchedActivityId: null };
  }

  // Elapsed for display, moving for kcal — burn math prefers active_minutes,
  // so stillness elapses time without burning anything.
  const durationMinutes = Math.max(1, Math.round(s.durationS / 60));
  const activeMinutes = Math.round(s.movingTimeS / 60);
  const distanceKm = Math.round((s.distanceM / 1000) * 100) / 100;

  // ── Step 2: claim a scheduled walk (valid only), or become one ──
  if (!item.steps.planResolved) {
    let match: MatchableActivity | null = null;
    if (item.verdict.verdict === 'valid') {
      const { data: candidates, error: candErr } = await supabase
        .from('activities')
        .select('id, activity_type, status, scheduled_date, scheduled_time')
        .eq('pet_id', item.petId)
        .eq('scheduled_date', walkDate)
        .eq('activity_type', 'walk')
        .eq('status', 'pending');
      if (candErr) throw candErr;
      match = matchWalkToActivity((candidates ?? []) as MatchableActivity[], s);
    }

    if (match) {
      const result = await persistActivityCompletion({
        activity: { id: match.id, activity_type: 'walk' },
        petId: item.petId,
        dateStr: walkDate,
        durationMinutes,
        activeMinutes,
        distanceKm,
        walkSessionId: item.walkSessionId,
        completedAt: new Date(s.endedAt),
        requirePending: true,
      });
      if (result === 'completed') {
        item.outcome = 'matched';
        item.matchedActivityId = match.id;
        item.effectActivityId = match.id;
        // Back-link on the session row — display convenience, non-fatal.
        await supabase
          .from('walk_sessions')
          .update({ matched_activity_id: match.id })
          .eq('id', item.walkSessionId);
        track('walk_matched_activity', {
          activity_id: match.id,
          duration_minutes: durationMinutes,
          distance_km: distanceKm,
        });
      } else {
        item.outcome = 'skipped_duplicate';
      }
    } else {
      // No slot in range → the walk becomes its own completed row.
      const payload = buildUnmatchedWalkPayload(
        item.petId,
        s,
        item.walkSessionId,
        item.profile,
      );
      const { data: inserted, error: insErr } = await supabase
        .from('activities')
        .insert(payload)
        .select('id')
        .single();
      if (insErr) {
        // 23505 = the partial unique index on walk_session_id — an earlier
        // attempt already inserted this row. Recover its id and move on.
        if (insErr.code === '23505') {
          const { data: existing } = await supabase
            .from('activities')
            .select('id')
            .eq('walk_session_id', item.walkSessionId)
            .maybeSingle();
          item.effectActivityId = existing?.id ?? null;
        } else {
          throw insErr;
        }
      } else {
        item.effectActivityId = inserted?.id ?? null;
        // The unmatched insert bypasses persistActivityCompletion, so the
        // daily_logs walk counter needs its own atomic bump.
        await supabase.rpc('log_intake', {
          p_pet_id: item.petId,
          p_log_date: walkDate,
          p_kcal_delta: 0,
          p_treat_delta: 0,
          p_water_delta: 0,
          p_walk_delta: 1,
        });
      }
      item.outcome = 'logged_new';
      track('walk_logged_unmatched', {
        duration_minutes: durationMinutes,
        distance_km: distanceKm,
        verdict: item.verdict.verdict,
      });
    }
    item.steps.planResolved = true;
  }

  // ── Step 3: coins + ring refresh + reminder cancel ──
  if (!item.steps.sideEffectsFired) {
    if (item.outcome === 'matched' || item.outcome === 'logged_new') {
      fireCompletionSideEffects({
        userId: item.ownerId,
        activityId: item.effectActivityId ?? item.walkSessionId,
        // The session id is the idempotency key — a re-fired retry can never
        // double-award (update-streak dedupes on it).
        coinReferenceId: item.walkSessionId,
      });
      // Every finished valid walk is a chance for the Walksign to confirm or
      // transition. Fire-and-forget: the state machine is idempotent and a
      // failure just means the next walk tries again.
      if (item.verdict.verdict === 'valid') {
        maybeEvaluateWalksign(item.petId, { force: true }).catch(() => {});
        // Paw Prints: did this walk cross a milestone rung? Same contract —
        // idempotent, fire-and-forget, celebration queued via the store.
        evaluatePawPrints(item.petId, item.ownerId, item.walkSessionId).catch(() => {});
      }
    }
    item.steps.sideEffectsFired = true;
  }

  return {
    outcome: item.outcome ?? 'queued',
    matchedActivityId: item.matchedActivityId,
  };
}
