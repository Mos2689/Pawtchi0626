export interface Nudge {
  priority: 'info' | 'action';
  title: string;
  message: string;
  actionType?: 'suggest_walk' | 'remind_log' | 'remind_water' | 'remind_weight' | 'remind_activity' | 'treat_ok' | 'reduce_dinner' | 'start_trial';
}

export interface NudgeInput {
  todayCalories: number;
  calPercent: number;
  caloriesRemaining: number;
  waterPercent: number;
  todayWalks: number;
  treatsConsumed: number;
  treatCaloriesConsumed: number;
  treatBudget: number;
  todayActivityMinutes: number;
  activityCompletionRate: number;
  weightTrend: { latest: number; previous: number; direction: string } | null;
  clinical: { activityRestrictions: string[]; medicalConditions: string[] };
  // Trend-level fields (from refreshTrends)
  avgTreatsPerDay: number | null;
  weeklyTreatCalPercent: number | null;
  // Weight management fields
  daysSinceLastWeighIn?: number | null;
  hasWeightGoal?: boolean;
  // Rolling balance + chronic-under-eating signals
  weeklyDelta?: number | null;
  daysUnderTarget?: number | null;
  // Today's biggest single contributor — used to make nudges name the offender
  topContributorScan?: { food_name: string; calories: number } | null;
  // Subscription fields
  isFreemiumActive?: boolean;
  daysSinceCreation?: number;
  // Blind spot detection fields
  consecutiveHighIntensityDays?: number;
  daysSinceLastFoodLog?: number | null;
  exerciseCalorieRatio?: number | null;
}

/**
 * Computes a contextual nudge based on the pet's current day data and trends.
 * Rules are evaluated in priority order — first match wins.
 *
 * Priority chain:
 *  1. Over-calorie (>=90%) — critical, portion control or walk
 *  2. Treat over-budget — action: reduce dinner
 *  3. High-cal + no walks (70-89%) — proactive walk suggestion
 *  4. Under-eating after 2PM — remind to log
 *  5. Weight trending up + high cal — stricter messaging
 *  6. Weight trending up (any cal) — gentle info
 *  7. Low hydration — water reminder
 *  8. Clinical + high cal — condition-aware portion control
 *  9. Activity earned a treat — positive reinforcement
 * 10. High treat pattern — weekly insight
 * 11. Celebrate good day — positive closing nudge
 */
export function computeNudge(input: NudgeInput): Nudge | null {
  const hour = new Date().getHours();
  const hasRestrictions = input.clinical.activityRestrictions.length > 0;

  // ── P0: Freemium Trial Nudge ──
  // Show it on odd days to prevent spam.
  if (input.isFreemiumActive && input.daysSinceCreation !== undefined) {
    if (input.daysSinceCreation % 2 !== 0 && input.daysSinceCreation < 30) {
      const daysLeft = 30 - input.daysSinceCreation;
      return {
        priority: 'action',
        title: 'Unlock Pawtchi Premium',
        message: `You have ${daysLeft} days of free access remaining! Start your 30-Day Native Trial now to lock in your progress and keep access to AI features.`,
        actionType: 'start_trial',
      };
    }
  }

  // ── P1: Over-calorie — suggest activity or portion control ──
  // Before 6pm: fires at 90%+. After 6pm: only fires when actually over limit (100%+)
  if (input.calPercent >= 90 && (hour < 18 || input.calPercent >= 100)) {
    const overBy = input.calPercent >= 100
      ? Math.round((input.calPercent - 100) * input.todayCalories / input.calPercent)
      : 0;
    const isOver = input.calPercent >= 100;

    return {
      priority: 'action',
      title: isOver ? 'Over Calorie Limit' : (hasRestrictions ? 'Calorie Limit Reached' : 'Time for a Walk'),
      message: isOver
        ? `${overBy} kcal over today's limit. No more food or treats — tomorrow is a fresh start.`
        : hasRestrictions
          ? 'Almost at calorie limit. Keep portions small for the rest of today.'
          : 'A 15-min walk would help balance today\'s calories.',
      actionType: isOver ? undefined : (hasRestrictions ? undefined : 'suggest_walk'),
    };
  }

  // ── P2: Treat over-budget — dinner reduction suggestion ──
  if (input.treatsConsumed > 0 && input.treatCaloriesConsumed > 0) {
    if (input.treatCaloriesConsumed > input.treatBudget) {
      const reduceBy = input.treatCaloriesConsumed;
      const tbsp = Math.max(1, Math.round(reduceBy / 30));
      const top = input.topContributorScan;
      const offender = top && top.calories >= 50
        ? ` Biggest hit: ${top.food_name} (${top.calories} kcal).`
        : '';
      return {
        priority: 'action',
        title: 'Reduce Dinner Tonight',
        message: `${input.treatsConsumed} treat${input.treatsConsumed !== 1 ? 's' : ''} today = ${input.treatCaloriesConsumed} kcal (exceeds ${input.treatBudget} kcal treat intake).${offender} Reduce dinner by ~${reduceBy} kcal (${tbsp} tbsp less kibble).`,
        actionType: 'reduce_dinner',
      };
    }
  }

  // ── P3: High-cal + no walks — proactive walk suggestion ──
  if (input.calPercent >= 70 && input.calPercent < 90 && input.todayWalks === 0 && hour < 17 && !hasRestrictions) {
    return {
      priority: 'action',
      title: 'Walk Before Dinner',
      message: 'Calories are building up. A walk before dinner would help balance today\'s intake.',
      actionType: 'suggest_walk',
    };
  }

  // ── P4: Under-eating after 2PM — remind to log ──
  if (input.calPercent < 50 && hour >= 14) {
    return {
      priority: 'action',
      title: 'Meals Missing',
      message: `Only ${input.calPercent}% of daily goal logged. Log meals to keep the record current.`,
      actionType: 'remind_log',
    };
  }

  // ── P4.5: Chronic under-eating — 2+ of last 3 days below 70% of target ──
  // Cats are at risk of hepatic lipidosis after even brief under-eating; this
  // covers dogs on overly aggressive weight-loss plans too. Skip if today is
  // already on track to fix it (calPercent ≥ 60).
  if (
    input.daysUnderTarget != null &&
    input.daysUnderTarget >= 2 &&
    input.calPercent < 60
  ) {
    return {
      priority: 'action',
      title: 'Eating Less Than Plan',
      message: `${input.daysUnderTarget} of the last 3 days under 70% of target. If this isn't intentional, consider revisiting the plan with your vet — chronic under-eating can mask illness.`,
      actionType: 'remind_log',
    };
  }

  // ── P5: Weight trending up + high calories — stricter composite warning ──
  if (input.weightTrend?.direction === 'up' && input.calPercent >= 75) {
    const diff = (input.weightTrend.latest - input.weightTrend.previous).toFixed(1);
    const top = input.topContributorScan;
    const offender = top && top.calories >= 100
      ? ` Today's biggest hit: ${top.food_name} (${top.calories} kcal).`
      : '';
    return {
      priority: 'action',
      title: 'Watch Portions Today',
      message: `Weight is up ${diff}kg and calories are at ${input.calPercent}%.${offender} Smaller portions will help get back on track.`,
      actionType: hasRestrictions ? undefined : 'suggest_walk',
    };
  }

  // ── P6: Weight trending up (any cal level) — gentle info ──
  if (input.weightTrend?.direction === 'up') {
    const diff = (input.weightTrend.latest - input.weightTrend.previous).toFixed(1);
    return {
      priority: 'info',
      title: 'Weight Trending Up',
      message: `Weight has increased ${diff}kg recently. Monitor portions closely.`,
    };
  }

  // ── P7: Low hydration after midday ──
  if (input.waterPercent < 0.3 && hour >= 12) {
    return {
      priority: 'action',
      title: 'Water Break Time',
      message: 'Water intake is low today. Time for a water break!',
      actionType: 'remind_water',
    };
  }

  // ── P8: Clinical condition + high cal — condition-aware portion advice ──
  if (hasRestrictions && input.calPercent >= 85) {
    const condition = input.clinical.medicalConditions[0] || 'their condition';
    return {
      priority: 'info',
      title: 'Portion Reminder',
      message: `Due to ${condition}, extra activity isn't recommended. Keep portions small for the rest of today.`,
    };
  }

  // ── P9: Activity earned a treat — positive reinforcement ──
  if (input.todayActivityMinutes >= 20 && input.treatsConsumed === 0 && input.calPercent < 80 && hour >= 10) {
    return {
      priority: 'info',
      title: 'Treat Earned!',
      message: 'Burned good energy on today\'s activity — a small treat is totally fine!',
      actionType: 'treat_ok',
    };
  }

  // ── P10: High treat pattern over the week ──
  if (input.avgTreatsPerDay !== null && input.avgTreatsPerDay >= 2) {
    const calPct = input.weeklyTreatCalPercent;
    const pctMsg = calPct !== null ? ` (${calPct}% of weekly calories)` : '';
    // Vets recommend treats stay under 10% of total calories
    const severity = calPct !== null && calPct > 10;
    return {
      priority: severity ? 'action' : 'info',
      title: severity ? 'Treats Exceeding 10% Rule' : 'Treat Pattern',
      message: severity
        ? `Averaging ${input.avgTreatsPerDay.toFixed(0)} treats/day${pctMsg}. Vets recommend treats stay under 10% of daily calories. Try swapping a treat for a play session.`
        : `Averaging ${input.avgTreatsPerDay.toFixed(0)} treats/day this week${pctMsg}. Keep monitoring.`,
      actionType: severity ? 'reduce_dinner' : undefined,
    };
  }

  // ── P11: Activity fatigue — low completion over the week ──
  if (input.activityCompletionRate < 0.3 && input.activityCompletionRate > 0) {
    return {
      priority: 'info',
      title: 'Light Week — That\'s OK',
      message: 'It\'s been a quiet week for activities. Even a 5-minute play session or short sniff walk counts and keeps your pet stimulated!',
      actionType: 'suggest_walk',
    };
  }


  // ── P11.5: Weight log reminder — proactive weigh-in prompt ──
  if (
    input.hasWeightGoal &&
    input.daysSinceLastWeighIn != null &&
    input.daysSinceLastWeighIn >= 7
  ) {
    return {
      priority: 'action',
      title: 'Time for a Weigh-In',
      message: `It's been ${input.daysSinceLastWeighIn} days since the last weigh-in. Log weight to keep the plan on track.`,
      actionType: 'remind_weight',
    };
  }

  // ── P12: Celebrate a good balanced day (evening only) ──
  if (
    hour >= 18 &&
    input.calPercent >= 40 && input.calPercent <= 90 &&
    input.waterPercent > 0.5 &&
    input.todayWalks >= 1
  ) {
    return {
      priority: 'info',
      title: 'Great Day!',
      message: 'Balanced calories, good hydration, and exercise — keep it up!',
    };
  }

  // ── P12.5: Activity completed after high-calorie meal — encouraging walk confirmation ──
  // Fires when: a walk has been logged today AND calories are elevated (≥80%)
  // This nudge celebrates the walk and contextualizes it against the calorie intake
  if (
    input.todayWalks >= 1 &&
    input.calPercent >= 80 &&
    input.calPercent < 100
  ) {
    return {
      priority: 'info',
      title: 'Walk Complete!',
      message: 'Great timing — that walk helps balance the calories logged today. Keep it up!',
      actionType: 'remind_activity',
    };
  }

  // ── P12.6: Active day with treat offset — positive reinforcement ──
  // Fires when: ≥20 min activity, treats were consumed, calories are reasonable
  if (
    input.todayActivityMinutes >= 20 &&
    input.treatsConsumed >= 1 &&
    input.calPercent <= 90
  ) {
    return {
      priority: 'info',
      title: 'Active & Treat-Earned!',
      message: `${input.todayActivityMinutes} minutes of activity today — treats are balanced out!`,
      actionType: 'remind_activity',
    };
  }

  // ── P12.7: Weight trending up + activity completed — encouraging message ──
  // Fires when: weight is up AND user just completed a walk
  if (
    input.weightTrend?.direction === 'up' &&
    input.todayWalks >= 1
  ) {
    const diff = (input.weightTrend.latest - input.weightTrend.previous).toFixed(1);
    return {
      priority: 'info',
      title: 'Great Walk!',
      message: `That walk helps counter the recent ${diff}kg upward trend. Consistent activity makes a difference!`,
      actionType: 'remind_activity',
    };
  }

  // ── P13: Recovery warning — consecutive high-intensity days ──
  // Dogs: >3 days high-intensity without a rest day risks joint strain and burnout.
  // Cats: same concern for sustained play. Fires from day 3 onward.
  if (
    input.consecutiveHighIntensityDays != null &&
    input.consecutiveHighIntensityDays >= 3
  ) {
    return {
      priority: 'action',
      title: 'Rest Day Needed',
      message: `${input.consecutiveHighIntensityDays} consecutive days of high-intensity activity. Consider a rest day or light walk — recovery matters for joints and muscles.`,
      actionType: 'remind_activity',
    };
  }

  // ── P14: Stale weight — no weigh-in in 14+ days ──
  // Weight goals require regular check-ins to stay on track.
  if (
    input.hasWeightGoal &&
    input.daysSinceLastWeighIn != null &&
    input.daysSinceLastWeighIn >= 14
  ) {
    return {
      priority: 'action',
      title: 'Weigh-In Overdue',
      message: `It's been ${input.daysSinceLastWeighIn} days since the last weigh-in. Log weight to check progress toward the goal.`,
      actionType: 'remind_weight',
    };
  }

  // ── P15: Engagement churn — 3+ days since last food log ──
  // User may have dropped off. Gentle re-engagement nudge.
  if (
    input.daysSinceLastFoodLog != null &&
    input.daysSinceLastFoodLog >= 3 &&
    input.calPercent < 30
  ) {
    return {
      priority: 'action',
      title: 'We Miss You!',
      message: `No food logged in ${input.daysSinceLastFoodLog} days. A quick scan or manual log keeps your pet's record current.`,
      actionType: 'remind_log',
    };
  }

  // ── P16: Exercise-calorie balance — high burn, low intake ──
  // ratio > 0.5: burning more than half of consumed calories through exercise alone.
  // Could indicate under-eating relative to activity level.
  if (
    input.exerciseCalorieRatio != null &&
    input.exerciseCalorieRatio > 0.5 &&
    input.calPercent < 70
  ) {
    return {
      priority: 'info',
      title: 'High Burn Day',
      message: `Activity is burning ~${Math.round(input.exerciseCalorieRatio * 100)}% of today's calories. Make sure there's enough fuel to sustain energy levels.`,
      actionType: 'remind_log',
    };
  }

  // ── P16.5: Inverse — low burn, high intake ──
  // ratio < 0.2: exercising little but eating a lot. Weight management concern.
  if (
    input.exerciseCalorieRatio != null &&
    input.exerciseCalorieRatio < 0.2 &&
    input.calPercent >= 85
  ) {
    return {
      priority: 'action',
      title: 'Move More Today',
      message: `Low activity burn but calories are at ${input.calPercent}%. A short walk or play session would help balance the intake.`,
      actionType: 'suggest_walk',
    };
  }

  return null;
}
