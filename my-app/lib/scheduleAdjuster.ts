import { supabase } from './supabase';
import { getLocalYMD } from './dateUtils';
import { deriveActivityRestrictions } from './activityRestrictions';
import { computeDailyDeficitKcal } from './activityBurn';
import { withTimeout } from './withTimeout';
import {
  scheduleActivityReminder,
  cancelAllRemindersForActivities,
  type NotificationIntensity,
} from './notificationScheduler';

interface WeeklyStats {
  total: number;
  completed: number;
  skipped: number;
}

export interface ScheduleAdjustResult {
  success: boolean;
  days_generated: number;
  fatigueDetected: boolean;
  error?: string;
}

interface RegenerateInput {
  pet: any;
  weeklyStats?: WeeklyStats | null;
  todayCalPercent: number;
  weightTrendDirection: 'up' | 'down' | 'stable' | null;
}

/**
 * After regenerateSchedule wipes pending activities and the edge function
 * inserts fresh ones, pull the pending future rows back out and schedule one
 * local notification per row at (scheduled_time − leadMinutes), honouring the
 * owner's quiet hours + intensity prefs.
 *
 * Failure here never blocks the schedule — the user still sees activities even
 * if notifications can't be scheduled (e.g. permission denied).
 */
async function wireRemindersForFreshActivities(petId: string, todayStr: string): Promise<void> {
  const { data: pet } = await supabase
    .from('pets')
    .select('name')
    .eq('id', petId)
    .single();
  const petName = (pet as any)?.name?.trim() || 'Buddy';

  const { data: { session } } = await supabase.auth.getSession();
  const ownerId = session?.user?.id;
  if (!ownerId) return;

  const { data: prefs } = await supabase
    .from('owner_preferences')
    .select('nudge_lead_minutes, quiet_hours_start, quiet_hours_end, notification_intensity')
    .eq('owner_id', ownerId)
    .maybeSingle();

  const leadMinutes = (prefs as any)?.nudge_lead_minutes ?? 10;
  const intensity: NotificationIntensity = ((prefs as any)?.notification_intensity ?? 'standard') as NotificationIntensity;
  const quiet = (prefs as any)?.quiet_hours_start && (prefs as any)?.quiet_hours_end
    ? { start: (prefs as any).quiet_hours_start as string, end: (prefs as any).quiet_hours_end as string }
    : null;

  const { data: activities } = await supabase
    .from('activities')
    .select('id, pet_id, activity_type, title, scheduled_date, scheduled_time')
    .eq('pet_id', petId)
    .eq('is_ai_generated', true)
    .eq('status', 'pending')
    .gte('scheduled_date', todayStr);

  const rows = (activities as any[] | null) ?? [];
  // Cancel any stale per-id reminders from a previous schedule that the
  // delete() may have already removed from the DB.
  await cancelAllRemindersForActivities(rows.map((r) => r.id));

  for (const row of rows) {
    try {
      await scheduleActivityReminder(
        {
          id: row.id,
          pet_id: row.pet_id,
          pet_name: petName,
          activity_type: row.activity_type,
          title: row.title,
          scheduled_date: row.scheduled_date,
          scheduled_time: row.scheduled_time,
        },
        leadMinutes,
        quiet,
        intensity,
      );
    } catch (e) {
      console.warn('[scheduleAdjuster] could not schedule reminder for', row.id, e);
    }
  }
}


/**
 * Wipes future pending AI-generated activities and regenerates a 7-day schedule
 * via the `/generate-schedule` edge function, factoring in last-week performance,
 * today's calorie state, and weight trend.
 *
 * Used by:
 *  - activity.tsx auto-adjust button (manual trigger)
 *  - health.tsx saveWeightLog (auto-trigger when weight changes meaningfully)
 */
export async function regenerateSchedule({
  pet,
  weeklyStats,
  todayCalPercent,
  weightTrendDirection,
}: RegenerateInput): Promise<ScheduleAdjustResult> {
  if (!pet?.id) {
    return { success: false, days_generated: 0, fatigueDetected: false, error: 'No pet' };
  }

  try {
    const todayStr = getLocalYMD(new Date());

    // Wipe ALL pending AI-generated activities (today + future) so regeneration
    // produces one clean set without duplicating today's schedule.
    // Completed activities are preserved (excluded by status: 'pending').
    await supabase
      .from('activities')
      .delete()
      .eq('pet_id', pet.id)
      .eq('is_ai_generated', true)
      .eq('status', 'pending')
      .gte('scheduled_date', todayStr);

    const completionRate = weeklyStats && weeklyStats.total > 0
      ? weeklyStats.completed / weeklyStats.total
      : 1;
    const skippedCount = weeklyStats?.skipped ?? 0;

    // Average completed duration (last 7 days) — informs realistic targets.
    const sevenAgo = new Date();
    sevenAgo.setDate(sevenAgo.getDate() - 7);
    const { data: completedActs } = await supabase
      .from('activities')
      .select('duration_minutes')
      .eq('pet_id', pet.id)
      .eq('status', 'completed')
      .in('activity_type', ['walk', 'play', 'training'])
      .gte('scheduled_date', getLocalYMD(sevenAgo))
      .lte('scheduled_date', todayStr);

    const durations = (completedActs || [])
      .map((a: any) => a.duration_minutes)
      .filter((d: number | null) => d !== null && d > 0);
    const avgCompletedDurationMins = durations.length > 0
      ? Math.round(durations.reduce((s: number, d: number) => s + d, 0) / durations.length)
      : null;

    // Fatigue: more skipped than completed AND meaningful sample size.
    const fatigueDetected = weeklyStats
      ? weeklyStats.skipped > weeklyStats.completed && weeklyStats.total >= 5
      : false;

    const performanceContext = {
      lastWeekCompletionRate: completionRate,
      lastWeekSkippedCount: skippedCount,
      avgCompletedDurationMins,
      todayCalPercent,
      weightTrendDirection,
      fatigueDetected,
    };

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const res = await withTimeout(
      fetch(`${supabaseUrl}/functions/v1/generate-schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          petProfile: pet,
          daysToGenerate: 7,
          performanceContext,
          // Anchor the plan to the CLIENT's calendar date — the edge function's
          // UTC "today" is a day off for most timezones. localTime prevents a
          // mid-day regeneration from inserting duplicate pending rows for
          // slots already completed this morning.
          localDate: todayStr,
          localTime: new Date().toTimeString().slice(0, 8),
          // Structured clinical exercise restrictions, enforced server-side.
          activityRestrictions: deriveActivityRestrictions(pet.medical_conditions),
          // Real planned daily deficit so the burn summary reports an honest
          // "% of deficit" (0 for maintain/gain plans → framing suppressed).
          dailyDeficitKcal: computeDailyDeficitKcal(pet),
        }),
      }),
      45_000,
      'generate-schedule'
    );

    // Handle Supabase platform-level errors before parsing JSON
    if (!res.ok) {
      const errorText = await res.text();
      console.error('[scheduleAdjuster] HTTP error:', res.status, errorText);

      if (res.status === 403 || errorText.includes('denied access') || errorText.includes('paused')) {
        return {
          success: false, days_generated: 0, fatigueDetected,
          error: 'Your Supabase project may be paused or restricted. Please restore it from the Supabase dashboard.',
        };
      }

      return {
        success: false, days_generated: 0, fatigueDetected,
        error: errorText || `Server error (${res.status})`,
      };
    }

    const data = await res.json();
    if (!data.success) {
      return { success: false, days_generated: 0, fatigueDetected, error: data.error || 'Adjustment failed.' };
    }

    // Schedule anticipatory reminders for the freshly-inserted activities.
    // Failures here are non-fatal — the schedule itself is in place either way.
    try {
      await wireRemindersForFreshActivities(pet.id, todayStr);
    } catch (notifErr) {
      console.warn('[scheduleAdjuster] reminder wiring failed (non-fatal):', notifErr);
    }

    return { success: true, days_generated: data.days_generated || 7, fatigueDetected };
  } catch (e: any) {
    return { success: false, days_generated: 0, fatigueDetected: false, error: e?.message || 'Unknown error' };
  }
}
