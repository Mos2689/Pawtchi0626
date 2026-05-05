import { supabase } from './supabase';

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

function getLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

    // Wipe future pending AI-generated activities — keep user-created ones.
    await supabase
      .from('activities')
      .delete()
      .eq('pet_id', pet.id)
      .eq('is_ai_generated', true)
      .eq('status', 'pending')
      .gt('scheduled_date', todayStr);

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

    const res = await fetch(`${supabaseUrl}/functions/v1/generate-schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        petProfile: pet,
        daysToGenerate: 7,
        performanceContext,
      }),
    });

    const data = await res.json();
    if (!data.success) {
      return { success: false, days_generated: 0, fatigueDetected, error: data.error || 'Adjustment failed.' };
    }

    return { success: true, days_generated: data.days_generated || 7, fatigueDetected };
  } catch (e: any) {
    return { success: false, days_generated: 0, fatigueDetected: false, error: e?.message || 'Unknown error' };
  }
}
