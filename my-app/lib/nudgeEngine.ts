export interface Nudge {
  priority: 'info' | 'action';
  message: string;
  actionType?: 'suggest_walk' | 'remind_log' | 'remind_water';
}

export interface NudgeInput {
  todayCalories: number;
  calPercent: number;
  caloriesRemaining: number;
  waterPercent: number;
  weightTrend: { latest: number; previous: number; direction: string } | null;
  clinical: { activityRestrictions: string[] };
}

/**
 * Computes a contextual nudge based on the pet's current day data and trends.
 * Rules are evaluated in priority order — first match wins.
 */
export function computeNudge(input: NudgeInput): Nudge | null {
  const hour = new Date().getHours();

  // Priority 1: Over-calorie before evening — suggest activity or portion control
  if (input.calPercent >= 90 && hour < 18) {
    const hasRestrictions = input.clinical.activityRestrictions.length > 0;
    return {
      priority: 'action',
      message: hasRestrictions
        ? 'Almost at calorie limit. Keep portions small for the rest of today.'
        : 'A 15-min walk would help balance today\'s calories.',
      actionType: hasRestrictions ? undefined : 'suggest_walk',
    };
  }

  // Priority 2: Under-eating after 2PM — remind to log
  if (input.calPercent < 50 && hour >= 14) {
    return {
      priority: 'action',
      message: `Only ${input.calPercent}% of daily goal logged. Don't forget to log meals!`,
      actionType: 'remind_log',
    };
  }

  // Priority 3: Weight trending up — gentle info nudge
  if (input.weightTrend?.direction === 'up') {
    const diff = (input.weightTrend.latest - input.weightTrend.previous).toFixed(1);
    return {
      priority: 'info',
      message: `Weight has increased ${diff}kg recently. Monitor portions closely.`,
    };
  }

  // Priority 4: Low hydration after midday
  if (input.waterPercent < 0.3 && hour >= 12) {
    return {
      priority: 'action',
      message: 'Water intake is low today. Time for a water break!',
      actionType: 'remind_water',
    };
  }

  return null;
}
