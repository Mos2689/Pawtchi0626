/**
 * completeActivity — the shared network half of marking an activity done.
 *
 * Extracted from the Activity tab's confirmCompletion so manual taps and
 * tracked-walk auto-completion (walkSync) run the exact same pipeline:
 *
 *   activities.status = 'completed' (+ measured duration/distance, walk link)
 *     → log_intake RPC (atomic daily_logs increment, read-modify-write
 *       fallback until the RPC is deployed)
 *     → authoritative context-store updates (Home rings).
 *
 * Optimistic UI, haptics, and rollback stay with the callers — this module is
 * the persistence layer only. Coin award / context invalidation / reminder
 * cancel live in fireCompletionSideEffects so both paths celebrate the same
 * way through the globally-mounted CoinToast.
 */

import { supabase } from './supabase';
import { usePetContextStore } from '../store/usePetContextStore';
import { useStreakStore } from '../store/useStreakStore';
import { cancelActivityReminder } from './notificationScheduler';

export interface ActivityCompletionRecord {
  id: string;
  activity_type: string;
  duration_minutes?: number | null;
  water_ml?: number | null;
}

export interface PersistCompletionArgs {
  activity: ActivityCompletionRecord;
  petId: string;
  /** Local YYYY-MM-DD the completion applies to (viewed date / walk-start date). */
  dateStr: string;
  /** Override (manual duration picker) or measured minutes (tracked walk). */
  durationMinutes?: number | null;
  /** GPS moving time — tracked walks only. Burn math prefers this over
   *  duration_minutes so stationary time never burns calories. */
  activeMinutes?: number | null;
  /** Measured distance — tracked walks only. */
  distanceKm?: number | null;
  /** Links the activity row back to the walk_sessions row that completed it. */
  walkSessionId?: string | null;
  completedAt?: Date;
  /**
   * Auto-completion must never flip a row a human (or another device) already
   * resolved. With this set, the update is scoped to status='pending'; a row
   * already completed by OUR OWN session id is treated as a sync retry and the
   * intake step still runs, anything else returns 'already_completed' and the
   * daily_logs increment is skipped (whoever completed it already logged it).
   */
  requirePending?: boolean;
}

export type PersistCompletionResult = 'completed' | 'already_completed';

export async function persistActivityCompletion(
  args: PersistCompletionArgs,
): Promise<PersistCompletionResult> {
  const { activity, petId, dateStr } = args;
  const completedAtIso = (args.completedAt ?? new Date()).toISOString();

  const updatePayload: Record<string, unknown> = {
    status: 'completed',
    completed_at: completedAtIso,
  };
  if (args.durationMinutes !== null && args.durationMinutes !== undefined) {
    updatePayload.duration_minutes = args.durationMinutes;
  }
  if (args.activeMinutes !== null && args.activeMinutes !== undefined) {
    updatePayload.active_minutes = args.activeMinutes;
  }
  if (args.distanceKm !== null && args.distanceKm !== undefined) {
    updatePayload.distance_km = args.distanceKm;
  }
  if (args.walkSessionId) {
    updatePayload.walk_session_id = args.walkSessionId;
  }

  if (args.requirePending) {
    const { data: updated, error } = await supabase
      .from('activities')
      .update(updatePayload)
      .eq('id', activity.id)
      .eq('status', 'pending')
      .select('id');
    if (error) throw error;

    if (!updated || updated.length === 0) {
      // Row is no longer pending. Ours (earlier retry got the update through
      // but died before intake) → carry on. Someone else's → stop here.
      const { data: row } = await supabase
        .from('activities')
        .select('walk_session_id')
        .eq('id', activity.id)
        .maybeSingle();
      const isOurRetry =
        !!args.walkSessionId && row?.walk_session_id === args.walkSessionId;
      if (!isOurRetry) return 'already_completed';
    }
  } else {
    const { error } = await supabase
      .from('activities')
      .update(updatePayload)
      .eq('id', activity.id);
    if (error) throw error;
  }

  await applyIntakeDeltas(activity, petId, dateStr);
  return 'completed';
}

/**
 * daily_logs update for water and walk completions — atomic increment via the
 * log_intake RPC (two devices / quick taps can't lose an update), with the
 * original read-modify-write kept as fallback until it's deployed. Updates the
 * context store from the authoritative post-increment totals.
 *
 * Lifted verbatim from the Activity tab's confirmCompletion.
 */
async function applyIntakeDeltas(
  activity: ActivityCompletionRecord,
  petId: string,
  dateStr: string,
): Promise<void> {
  if (activity.activity_type !== 'water' && activity.activity_type !== 'walk') return;

  const waterDelta = activity.activity_type === 'water' ? (activity.water_ml || 0) : 0;
  const walkDelta = activity.activity_type === 'walk' ? 1 : 0;

  const { data: intakeRows, error: intakeErr } = await supabase.rpc('log_intake', {
    p_pet_id: petId,
    p_log_date: dateStr,
    p_kcal_delta: 0,
    p_treat_delta: 0,
    p_water_delta: waterDelta,
    p_walk_delta: walkDelta,
  });

  if (!intakeErr) {
    const row: any = Array.isArray(intakeRows) ? intakeRows[0] : intakeRows;
    if (activity.activity_type === 'water' && activity.water_ml) {
      usePetContextStore.getState().updateWater(row?.water_ml ?? activity.water_ml);
    }
    if (activity.activity_type === 'walk') {
      usePetContextStore.getState().updateWalks(row?.walks_count ?? 1);
    }
    return;
  }

  const { data: existingLog } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('pet_id', petId)
    .eq('log_date', dateStr)
    .single();

  if (existingLog) {
    const updates: any = { updated_at: new Date().toISOString() };
    if (activity.activity_type === 'water' && activity.water_ml) {
      updates.water_ml = (existingLog.water_ml || 0) + activity.water_ml;
    }
    if (activity.activity_type === 'walk') {
      updates.walks_count = (existingLog.walks_count || 0) + 1;
    }
    await supabase.from('daily_logs').update(updates).eq('id', existingLog.id);

    if (activity.activity_type === 'water' && activity.water_ml) {
      usePetContextStore.getState().updateWater((existingLog.water_ml || 0) + activity.water_ml);
    }
    if (activity.activity_type === 'walk') {
      usePetContextStore.getState().updateWalks((existingLog.walks_count || 0) + 1);
    }
  } else {
    const inserts: any = { pet_id: petId, log_date: dateStr };
    if (activity.activity_type === 'water') inserts.water_ml = activity.water_ml || 0;
    if (activity.activity_type === 'walk') inserts.walks_count = 1;
    await supabase.from('daily_logs').insert(inserts);

    if (activity.activity_type === 'water' && activity.water_ml) {
      usePetContextStore.getState().updateWater(activity.water_ml);
    }
    if (activity.activity_type === 'walk') {
      usePetContextStore.getState().updateWalks(1);
    }
  }
}

export interface CompletionSideEffectArgs {
  userId: string | null | undefined;
  activityId: string;
  /**
   * Coin idempotency key sent to update-streak. Manual taps use the activity
   * id (as before); tracked walks pass the walk session id so an offline-sync
   * retry can never double-award.
   */
  coinReferenceId?: string;
}

/**
 * The fire-and-forget completion trio: coins (→ CoinToast via the streak
 * store), Home-ring context invalidation, and cancelling the activity's
 * anticipatory reminder — completing a walk shouldn't fire a "walk in 10
 * minutes" ping.
 */
export function fireCompletionSideEffects(args: CompletionSideEffectArgs): void {
  if (args.userId) {
    useStreakStore
      .getState()
      .awardCoins(args.userId, 'activity_complete', args.coinReferenceId ?? args.activityId);
  }
  usePetContextStore.getState().invalidateContext();
  cancelActivityReminder(args.activityId).catch(() => {});
}
