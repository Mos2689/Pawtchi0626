/**
 * discardWalk — undo a walk the owner never meant to record.
 *
 * Pocket dials, a tap while showing someone the app, a session started and
 * abandoned. Until now the only exit from the summary screen was "Done", which
 * kept the walk — so a phantom walk permanently inflated the day's count, the
 * streak and the archive, and the owner had no way to say "that wasn't real".
 *
 * ── What a finished walk creates, and therefore what this reverses ──
 *   1. a `walk_sessions` row                            → deleted
 *   2. EITHER a claimed scheduled `activities` row      → returned to pending
 *      OR a new `activities` row it inserted for itself → deleted
 *   3. the daily walk counter (`log_intake` walk_delta) → decremented
 *   4. a pending Walk Story marker                      → cleared
 *
 * ── What it deliberately does NOT reverse, and why ──
 * Coins. They are awarded server-side through update-streak, keyed on the
 * session id, and a clawback would need its own idempotent server path — a
 * bigger and riskier change than this is worth. PawCoins are not spendable yet,
 * so the cost of leaving them is close to zero; the cost of a half-built
 * clawback that double-subtracts is not.
 *
 * Milestones and Walksign readings are likewise left alone: both are derived
 * and self-correcting on the next evaluation, and a celebration already shown
 * cannot be un-shown honestly.
 *
 * The plan is computed separately from its execution so the decisions — which
 * of the two activity shapes to undo, whether the counter moved at all — are
 * testable without a database.
 */

import { supabase } from '../supabase';
import { track } from '../analytics';
import { clearPendingWalkStory } from '../walkStorySync';
import { usePetContextStore } from '../../store/usePetContextStore';
import {
  readWalkSyncQueueState,
  removeWalkFromSyncQueue,
  type WalkSyncOutcome,
} from './walkSync';

/** The subset of a finished walk this needs in order to undo it. */
export interface DiscardWalkInput {
  walkSessionId: string;
  petId: string;
  /** Owner the walk was recorded under — scopes the pending-story marker. */
  ownerId: string | null;
  /** Local YMD the walk was filed under — the counter is per calendar day. */
  walkDate: string;
  outcome: WalkSyncOutcome;
  matchedActivityId: string | null;
}

export interface DiscardPlan {
  /** Delete the row this walk inserted for itself. */
  deleteOwnActivity: boolean;
  /** Hand a claimed scheduled slot back, still undone. */
  revertActivityId: string | null;
  /** Whether the walk ever incremented the day's counter. */
  decrementWalkCount: boolean;
}

/**
 * What undoing this particular walk requires.
 *
 * The three outcomes differ in what they touched:
 *   matched          — claimed someone's scheduled walk; give it back as
 *                      pending rather than deleting a slot the plan still owns.
 *   logged_new       — invented its own activity row; that row is pure
 *                      consequence of this walk, so it goes.
 *   anything else    — `skipped_duplicate` and `not_valid` never completed an
 *                      activity or moved the counter, so only the session row
 *                      needs removing.
 */
export function planDiscard(input: DiscardWalkInput): DiscardPlan {
  if (input.outcome === 'matched') {
    return {
      deleteOwnActivity: false,
      revertActivityId: input.matchedActivityId,
      decrementWalkCount: true,
    };
  }
  if (input.outcome === 'logged_new') {
    return {
      deleteOwnActivity: true,
      revertActivityId: null,
      decrementWalkCount: true,
    };
  }
  return {
    deleteOwnActivity: false,
    revertActivityId: null,
    decrementWalkCount: false,
  };
}

/**
 * Run the plan.
 *
 * Ordered so the visible consequences go first and the session row last: if
 * this is interrupted half way, the walk still exists and can be discarded
 * again, which is far better than a deleted session leaving an orphan activity
 * nobody can reach.
 */
export async function discardWalk(input: DiscardWalkInput): Promise<void> {
  // A partially processed queue entry can carry a
  // more precise outcome than the summary's generic `queued` result.
  const queued = await readWalkSyncQueueState(input.walkSessionId);
  const effectiveInput: DiscardWalkInput = {
    ...input,
    outcome: queued?.outcome ?? input.outcome,
    matchedActivityId: queued?.matchedActivityId ?? input.matchedActivityId,
  };

  // One database transaction. Retrying can never decrement the daily count
  // twice or leave a scheduled activity half-restored.
  const { error } = await supabase.rpc('discard_walk_session', {
    p_walk_session_id: input.walkSessionId,
    p_matched_activity_id: effectiveInput.matchedActivityId,
    p_walk_date: input.walkDate,
  });
  if (error) throw error;

  // Remove only after the transaction commits. If the RPC fails, retaining the
  // queue preserves both retry safety and its precise partial-sync outcome.
  await removeWalkFromSyncQueue(input.walkSessionId);
  await clearPendingWalkStory(input.walkSessionId, input.ownerId);
  usePetContextStore.getState().invalidateContext();

  track('walk_discarded', {
    verdict: 'user_discarded',
    outcome: effectiveInput.outcome,
  });
}
