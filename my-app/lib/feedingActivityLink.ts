/**
 * feedingActivityLink — auto-completes the matching feeding activity when a
 * meal is logged from the meal tab.
 *
 * The match is by scheduled day + meal slot, not by clock proximity. A
 * breakfast logged at noon should still close the morning feeding card so the
 * timeline doesn't carry a stale "pending" row through the rest of the day.
 *
 * Snacks (slot === 'late') don't close any feeding — they were never on the
 * schedule. Returns the closed activity's id, or null if no match.
 */

import { supabase } from './supabase';
import type { MealSlot } from './mealPrediction';

export interface FeedingLinkInput {
  petId: string;
  loggedAt: Date;
  slot: MealSlot;
}

const SLOT_TO_TITLE_PREFIX: Record<MealSlot, string | null> = {
  breakfast: 'Breakfast',
  lunch:     'Lunch',
  dinner:    'Dinner',
  late:      null, // snacks/treats don't close a feeding card
};

function localYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function markNearestFeedingActivityComplete(
  input: FeedingLinkInput,
): Promise<string | null> {
  const titlePrefix = SLOT_TO_TITLE_PREFIX[input.slot];
  if (!titlePrefix) return null;

  const dateStr = localYMD(input.loggedAt);

  // Find the pending feeding activity for this day + slot. Single() with
  // maybeSingle so the absence of a match is a no-op rather than an error.
  const { data, error } = await supabase
    .from('activities')
    .select('id')
    .eq('pet_id', input.petId)
    .eq('activity_type', 'feeding')
    .eq('status', 'pending')
    .eq('scheduled_date', dateStr)
    .ilike('title', titlePrefix)
    .order('scheduled_time', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[feedingActivityLink] lookup error:', error);
    return null;
  }
  if (!data) return null;

  const { error: updateError } = await supabase
    .from('activities')
    .update({ status: 'completed', completed_at: input.loggedAt.toISOString() })
    .eq('id', data.id);

  if (updateError) {
    console.error('[feedingActivityLink] update error:', updateError);
    return null;
  }
  return data.id as string;
}
