/**
 * The nudge engine.
 *
 * Every rule that has an opinion about today lives here, as data. The rules and
 * their thresholds are unchanged from the original priority chain — what
 * changed is the shape of the answer.
 *
 * ── Why this stopped returning one nudge ────────────────────────────────────
 *
 * The original `computeNudge` walked an if-chain and returned the first match.
 * That was right when a single card floated over Home: one slot, one nudge. It
 * is wrong for a notification center, which is a *list* — an inbox that shows
 * one item no matter how much is true is just the old card with extra steps.
 *
 * So `computeNudges` evaluates every rule and returns all of them.
 *
 * ── Why groups exist ────────────────────────────────────────────────────────
 *
 * Evaluating everything exposed something first-match-wins had been quietly
 * covering up: several rules are different phrasings of the same concern. Three
 * separate weigh-in rules can be true at once (cadence at 14 days, "time for a
 * weigh-in" at 7, "overdue" at 14), and a naive all-matches pass would post
 * three nearly identical items about the same missing measurement. Same for
 * calories, treats and the weight trend.
 *
 * Each rule therefore declares a `group`, and a group contributes at most one
 * item — the first one in priority order, which is exactly what the old chain
 * would have picked. Across groups, everything true is reported.
 *
 * ── Copy ────────────────────────────────────────────────────────────────────
 *
 * Titles and messages follow Copy Spec v1 (Brand Book §6.04) as far as the
 * available data allows: sentence case, no exclamation marks, no emoji, calm
 * over urgent. Where `petName` is supplied the animal is named rather than
 * called "your pet".
 */

import type { InboxTone } from './notificationCenter/types';

export interface Nudge {
  /**
   * Stable rule identifier. This is what item ids, read state and analytics are
   * keyed on, so a value here is permanent once shipped — rename the copy
   * freely, never the id.
   */
  id: NudgeRuleId;
  /** Retained from the original interface; `tone` is the richer signal. */
  priority: 'info' | 'action';
  tone: InboxTone;
  title: string;
  message: string;
  actionType?: NudgeActionType;
}

export type NudgeActionType =
  | 'suggest_walk'
  | 'remind_log'
  | 'remind_water'
  | 'remind_weight'
  | 'remind_activity'
  | 'treat_ok'
  | 'reduce_dinner'
  | 'start_trial';

export type NudgeRuleId =
  | 'freemium_trial'
  | 'calorie_over'
  | 'weigh_in_cadence'
  | 'treat_over_budget'
  | 'walk_before_dinner'
  | 'meals_missing'
  | 'chronic_under_eating'
  | 'weight_up_high_cal'
  | 'weight_up'
  | 'hydration_low'
  | 'clinical_portion'
  | 'treat_earned'
  | 'treat_pattern'
  | 'activity_light_week'
  | 'weigh_in_due'
  | 'balanced_day'
  | 'walk_complete'
  | 'active_treat_offset'
  | 'weight_up_walk_done'
  | 'recovery_rest_day'
  | 'weigh_in_overdue'
  | 'engagement_churn'
  | 'high_burn'
  | 'low_burn_high_intake';

/**
 * Concerns. One item per group per rebuild.
 *
 * Read this as "how many different things is the app allowed to say at once",
 * because that is what it controls. Adding a group is adding a voice.
 */
export type NudgeGroup =
  | 'trial'
  | 'calories'
  | 'weigh_in'
  | 'treats'
  | 'weight_trend'
  | 'hydration'
  | 'clinical'
  | 'activity'
  | 'engagement'
  | 'celebration';

/**
 * The three things a rule can depend on the owner having actually set up.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Every percentage this engine reads is computed as `progress / target`, and
 * `computeDerived` in usePetContextStore returns a flat `0` when the target is
 * missing rather than signalling its absence. So "this pet has no calorie plan"
 * and "this pet has eaten nothing today" arrive here as the identical number,
 * and the rules — reasonably — read the second meaning.
 *
 * For a walk-first pet that is guaranteed on day one: `buildLightweightPetRow`
 * writes `current_weight_kg: 0` and leaves `target_daily_calories` null, so a
 * brand-new account was reliably told its water was low and its meals were
 * missing before it had a plan for either.
 *
 * There is history here worth remembering. The retired `pet-reminders` function
 * sent a hydration nudge against a `weight * 50` target that was true for
 * nearly every user every day, and it became 1,014 of the 1,353 notifications
 * this product had ever sent. The fix was to make hydration in-app only — which
 * moved the rule here rather than fixing its premise.
 */
export type NudgeDomain = 'meal' | 'hydration' | 'activity';

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
  /** Derived goal direction, drives the reweigh-cadence nudge. */
  goalDirection?: 'lose' | 'maintain' | 'gain' | null;
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
  /**
   * The animal's name, so copy can address them directly. Optional because the
   * engine is pure and testable without a pet loaded; every message degrades to
   * a name-free phrasing when it is absent.
   */
  petName?: string | null;
  /** Injectable for tests. Defaults to the local hour. */
  hour?: number;

  // ── Domain readiness ──────────────────────────────────────────────────────
  // A domain speaks only when it is both PLANNED and ENGAGED. Planned alone
  // would mean the very first afternoon after setting a calorie target you are
  // told your meals are missing; engaged alone cannot be true without a plan.
  //
  // All six default to `false`, which is the safe direction: a caller that
  // forgets to set them gets silence rather than a wrong accusation.

  /** A real calorie target exists — weight, age and BCS are set AND the target is non-zero. */
  mealPlanned?: boolean;
  /** A hydration target exists. Derives purely from a non-sentinel weight. */
  hydrationPlanned?: boolean;
  /** An activity plan can be generated — weight and age are set. */
  activityPlanned?: boolean;

  /**
   * At least one food scan has EVER been recorded for this pet.
   *
   * Exact, not a heuristic: `food_last` in get_pet_dashboard is an unwindowed
   * `order by created_at desc limit 1`, so a null `daysSinceLastFoodLog` really
   * does mean "never logged a meal".
   */
  hasEverLoggedMeal?: boolean;
  /** Water logged today or in the trailing week. A 7-day proxy — see the note in buildNudgeInput. */
  hasEverLoggedWater?: boolean;
  /** A scheduled activity completed this week or last. Same 7-day caveat. */
  hasEverCompletedActivity?: boolean;
}

/** Whether a domain may speak: planned, and actually used. */
function domainReady(domain: NudgeDomain, input: NudgeInput): boolean {
  switch (domain) {
    case 'meal':
      return Boolean(input.mealPlanned && input.hasEverLoggedMeal);
    case 'hydration':
      return Boolean(input.hydrationPlanned && input.hasEverLoggedWater);
    case 'activity':
      return Boolean(input.activityPlanned && input.hasEverCompletedActivity);
  }
}

interface Rule {
  id: NudgeRuleId;
  group: NudgeGroup;
  /**
   * Domains that must be planned AND engaged before this rule may speak.
   *
   * Omitted means the rule stands on its own guards — either it reads no
   * target-derived percentage at all, or its own condition already implies the
   * owner is set up.
   */
  requires?: NudgeDomain[];
  evaluate: (input: NudgeInput, ctx: RuleContext) => Omit<Nudge, 'id'> | null;
}

interface RuleContext {
  hour: number;
  hasRestrictions: boolean;
  /** The animal's name, or a neutral stand-in when no pet is loaded. */
  name: string;
  /** True when a real name was supplied — copy that would read oddly can branch. */
  named: boolean;
}

/**
 * Rules in priority order.
 *
 * The order within a group decides which of its rules wins; the order across
 * groups decides how the center sorts items of equal tone. It is the original
 * P0→P16.5 chain, unchanged.
 */
const RULES: Rule[] = [
  // ── P0: Freemium trial ────────────────────────────────────────────────────
  // Odd days only, so it cannot become a daily drumbeat.
  {
    id: 'freemium_trial',
    group: 'trial',
    evaluate: (input) => {
      if (!input.isFreemiumActive || input.daysSinceCreation === undefined) return null;
      if (input.daysSinceCreation % 2 === 0 || input.daysSinceCreation >= 30) return null;
      const daysLeft = 30 - input.daysSinceCreation;
      return {
        priority: 'action',
        tone: 'info',
        title: 'Free access is running out',
        message: `${daysLeft} days of free access left. Starting the 30-day trial keeps the AI features and the history already recorded.`,
        actionType: 'start_trial',
      };
    },
  },

  // ── P1: Over calorie limit ────────────────────────────────────────────────
  // Before 6pm this fires at 90%; after 6pm only once actually over, because
  // late in the day 90% is a day going well rather than a day going wrong.
  {
    id: 'calorie_over',
    group: 'calories',
    requires: ['meal'],
    evaluate: (input, ctx) => {
      if (input.calPercent < 90) return null;
      if (ctx.hour >= 18 && input.calPercent < 100) return null;

      const isOver = input.calPercent >= 100;
      const overBy = isOver
        ? Math.round(((input.calPercent - 100) * input.todayCalories) / input.calPercent)
        : 0;

      return {
        priority: 'action',
        tone: 'action',
        title: isOver
          ? 'Over the calorie limit'
          : ctx.hasRestrictions
            ? 'Calorie limit reached'
            : 'Time for a walk',
        message: isOver
          ? `${overBy} kcal over today's limit. No more food or treats — tomorrow starts fresh.`
          : ctx.hasRestrictions
            ? `Almost at the calorie limit. Keep ${ctx.name}'s portions small for the rest of today.`
            : `A 15-minute walk would help balance today's calories.`,
        actionType: isOver ? undefined : ctx.hasRestrictions ? undefined : 'suggest_walk',
      };
    },
  },

  // ── P1.5: Reweigh cadence ─────────────────────────────────────────────────
  // A stale weigh-in makes every downstream calculation drift. Vets rely on
  // rate-of-loss as the primary safety signal during weight management, and a
  // plan running on a three-week-old weight is not catching problems.
  {
    id: 'weigh_in_cadence',
    group: 'weigh_in',
    evaluate: (input, ctx) => {
      if (!input.hasWeightGoal) return null;
      if (typeof input.daysSinceLastWeighIn !== 'number') return null;
      const due =
        (input.goalDirection === 'lose' && input.daysSinceLastWeighIn >= 14) ||
        (input.goalDirection === 'maintain' && input.daysSinceLastWeighIn >= 28) ||
        (input.goalDirection === 'gain' && input.daysSinceLastWeighIn >= 14);
      if (!due) return null;
      return {
        priority: 'action',
        tone: 'action',
        title: 'Time for a weigh-in',
        message: `It has been ${input.daysSinceLastWeighIn} days since ${ctx.name} was last weighed. A quick check keeps the plan accurate.`,
        actionType: 'remind_weight',
      };
    },
  },

  // ── P2: Treats over budget ────────────────────────────────────────────────
  {
    id: 'treat_over_budget',
    group: 'treats',
    requires: ['meal'],
    evaluate: (input) => {
      if (input.treatsConsumed <= 0 || input.treatCaloriesConsumed <= 0) return null;
      if (input.treatCaloriesConsumed <= input.treatBudget) return null;

      const reduceBy = input.treatCaloriesConsumed;
      const tbsp = Math.max(1, Math.round(reduceBy / 30));
      const top = input.topContributorScan;
      const offender = top && top.calories >= 50
        ? ` Biggest hit: ${top.food_name} at ${top.calories} kcal.`
        : '';

      return {
        priority: 'action',
        tone: 'action',
        title: 'Reduce dinner tonight',
        message: `${input.treatsConsumed} treat${input.treatsConsumed !== 1 ? 's' : ''} today came to ${input.treatCaloriesConsumed} kcal, over the ${input.treatBudget} kcal treat allowance.${offender} Reduce dinner by about ${reduceBy} kcal, roughly ${tbsp} tbsp less kibble.`,
        actionType: 'reduce_dinner',
      };
    },
  },

  // ── P3: Calories building, no walk yet ────────────────────────────────────
  {
    id: 'walk_before_dinner',
    group: 'calories',
    requires: ['meal'],
    evaluate: (input, ctx) => {
      if (input.calPercent < 70 || input.calPercent >= 90) return null;
      if (input.todayWalks !== 0 || ctx.hour >= 17 || ctx.hasRestrictions) return null;
      return {
        priority: 'action',
        tone: 'action',
        title: 'Walk before dinner',
        message: 'Calories are building up. A walk before dinner would help balance today’s intake.',
        actionType: 'suggest_walk',
      };
    },
  },

  // ── P4: Under-eating after 2pm ────────────────────────────────────────────
  {
    id: 'meals_missing',
    group: 'calories',
    requires: ['meal'],
    evaluate: (input, ctx) => {
      if (input.calPercent >= 50 || ctx.hour < 14) return null;
      return {
        priority: 'action',
        tone: 'action',
        title: 'Meals missing',
        message: `Only ${input.calPercent}% of today's goal is logged. Logging meals keeps the record current.`,
        actionType: 'remind_log',
      };
    },
  },

  // ── P4.5: Chronic under-eating ────────────────────────────────────────────
  // Cats are at risk of hepatic lipidosis after even brief under-eating; this
  // also covers dogs on overly aggressive weight-loss plans. Skipped when today
  // is already on track to fix it.
  {
    id: 'chronic_under_eating',
    group: 'calories',
    requires: ['meal'],
    evaluate: (input, ctx) => {
      if (input.daysUnderTarget == null || input.daysUnderTarget < 2) return null;
      if (input.calPercent >= 60) return null;
      return {
        priority: 'action',
        // Named as clinical: sustained under-eating is a vet conversation, not
        // a logging reminder, and it is the one calorie rule that can be the
        // first sign of illness.
        tone: 'clinical',
        title: 'Eating less than the plan',
        message: `${input.daysUnderTarget} of the last 3 days were under 70% of target. If that is not intentional, it is worth revisiting the plan with your vet — a drop in appetite can be the first sign of illness in ${ctx.name}.`,
        actionType: 'remind_log',
      };
    },
  },

  // ── P5: Weight up and calories high ───────────────────────────────────────
  {
    id: 'weight_up_high_cal',
    group: 'weight_trend',
    evaluate: (input, ctx) => {
      if (input.weightTrend?.direction !== 'up' || input.calPercent < 75) return null;
      const diff = (input.weightTrend.latest - input.weightTrend.previous).toFixed(1);
      const top = input.topContributorScan;
      const offender = top && top.calories >= 100
        ? ` Today's biggest hit: ${top.food_name} at ${top.calories} kcal.`
        : '';
      return {
        priority: 'action',
        tone: 'action',
        title: 'Watch portions today',
        message: `Weight is up ${diff} kg and calories are at ${input.calPercent}%.${offender} Smaller portions will help get back on track.`,
        actionType: ctx.hasRestrictions ? undefined : 'suggest_walk',
      };
    },
  },

  // ── P6: Weight up, any calorie level ──────────────────────────────────────
  {
    id: 'weight_up',
    group: 'weight_trend',
    evaluate: (input, ctx) => {
      if (input.weightTrend?.direction !== 'up') return null;
      const diff = (input.weightTrend.latest - input.weightTrend.previous).toFixed(1);
      return {
        priority: 'info',
        tone: 'info',
        title: 'Weight trending up',
        message: `${ctx.name} has gained ${diff} kg recently. Worth watching portions closely.`,
      };
    },
  },

  // ── P7: Low hydration after midday ────────────────────────────────────────
  {
    id: 'hydration_low',
    group: 'hydration',
    requires: ['hydration'],
    evaluate: (input, ctx) => {
      if (input.waterPercent >= 0.3 || ctx.hour < 12) return null;
      return {
        priority: 'action',
        tone: 'action',
        title: 'Water break',
        message: `Water intake is low today. A refill for ${ctx.name} would help.`,
        actionType: 'remind_water',
      };
    },
  },

  // ── P8: Clinical condition with high calories ─────────────────────────────
  {
    id: 'clinical_portion',
    group: 'clinical',
    requires: ['meal'],
    evaluate: (input, ctx) => {
      if (!ctx.hasRestrictions || input.calPercent < 85) return null;
      const condition = input.clinical.medicalConditions[0] || 'the current condition';
      return {
        priority: 'info',
        tone: 'clinical',
        title: 'Portion reminder',
        message: `Because of ${condition}, extra activity is not recommended. Keep ${ctx.name}'s portions small for the rest of today.`,
      };
    },
  },

  // ── P9: Activity earned a treat ───────────────────────────────────────────
  {
    id: 'treat_earned',
    group: 'treats',
    requires: ['meal'],
    evaluate: (input, ctx) => {
      if (input.todayActivityMinutes < 20) return null;
      if (input.treatsConsumed !== 0 || input.calPercent >= 80 || ctx.hour < 10) return null;
      return {
        priority: 'info',
        tone: 'celebration',
        title: 'A treat is fine today',
        message: `${ctx.name} burned good energy on today's activity. A small treat fits well within the day.`,
        actionType: 'treat_ok',
      };
    },
  },

  // ── P10: Treat pattern across the week ────────────────────────────────────
  // Vets recommend treats stay under 10% of total calories.
  {
    id: 'treat_pattern',
    group: 'treats',
    requires: ['meal'],
    evaluate: (input) => {
      if (input.avgTreatsPerDay === null || input.avgTreatsPerDay < 2) return null;
      const calPct = input.weeklyTreatCalPercent;
      const pctMsg = calPct !== null ? ` and ${calPct}% of weekly calories` : '';
      const severe = calPct !== null && calPct > 10;
      return {
        priority: severe ? 'action' : 'info',
        tone: severe ? 'action' : 'info',
        title: severe ? 'Treats above the 10% guide' : 'Treat pattern',
        message: severe
          ? `Averaging ${input.avgTreatsPerDay.toFixed(0)} treats a day${pctMsg}. Vets recommend treats stay under 10% of daily calories — swapping one treat for a play session is an easy start.`
          : `Averaging ${input.avgTreatsPerDay.toFixed(0)} treats a day this week${pctMsg}. Worth keeping an eye on.`,
        actionType: severe ? 'reduce_dinner' : undefined,
      };
    },
  },

  // ── P11: Quiet week ───────────────────────────────────────────────────────
  {
    id: 'activity_light_week',
    group: 'activity',
    requires: ['activity'],
    evaluate: (input, ctx) => {
      if (input.activityCompletionRate >= 0.3 || input.activityCompletionRate <= 0) return null;
      return {
        priority: 'info',
        tone: 'info',
        title: 'A light week, and that is fine',
        message: `It has been a quiet week for activities. Even a 5-minute play session or a short sniff walk counts and keeps ${ctx.name} stimulated.`,
        actionType: 'suggest_walk',
      };
    },
  },

  // ── P11.5: Weigh-in prompt ────────────────────────────────────────────────
  {
    id: 'weigh_in_due',
    group: 'weigh_in',
    evaluate: (input, ctx) => {
      if (!input.hasWeightGoal || input.daysSinceLastWeighIn == null) return null;
      if (input.daysSinceLastWeighIn < 7) return null;
      return {
        priority: 'action',
        tone: 'action',
        title: 'Time for a weigh-in',
        message: `It has been ${input.daysSinceLastWeighIn} days since ${ctx.name} was last weighed. Logging a weight keeps the plan on track.`,
        actionType: 'remind_weight',
      };
    },
  },

  // ── P12: A balanced day, in the evening ───────────────────────────────────
  {
    id: 'balanced_day',
    group: 'celebration',
    requires: ['meal', 'hydration', 'activity'],
    evaluate: (input, ctx) => {
      if (ctx.hour < 18) return null;
      if (input.calPercent < 40 || input.calPercent > 90) return null;
      if (input.waterPercent <= 0.5 || input.todayWalks < 1) return null;
      return {
        priority: 'info',
        tone: 'celebration',
        title: 'A good day',
        message: `Balanced calories, good hydration and exercise for ${ctx.name}. Worth repeating.`,
      };
    },
  },

  // ── P12.5: Walk done on a high-calorie day ────────────────────────────────
  {
    id: 'walk_complete',
    group: 'activity',
    requires: ['meal'],
    evaluate: (input) => {
      if (input.todayWalks < 1) return null;
      if (input.calPercent < 80 || input.calPercent >= 100) return null;
      return {
        priority: 'info',
        tone: 'celebration',
        title: 'Walk complete',
        message: 'Good timing — that walk helps balance the calories logged today.',
        actionType: 'remind_activity',
      };
    },
  },

  // ── P12.6: Active day with treats already offset ──────────────────────────
  {
    id: 'active_treat_offset',
    group: 'treats',
    requires: ['meal'],
    evaluate: (input, ctx) => {
      if (input.todayActivityMinutes < 20 || input.treatsConsumed < 1) return null;
      if (input.calPercent > 90) return null;
      return {
        priority: 'info',
        tone: 'celebration',
        title: 'Active day, treats balanced',
        message: `${input.todayActivityMinutes} minutes of activity today means ${ctx.name}'s treats are covered.`,
        actionType: 'remind_activity',
      };
    },
  },

  // ── P12.7: Weight up but a walk was done ──────────────────────────────────
  {
    id: 'weight_up_walk_done',
    group: 'weight_trend',
    evaluate: (input) => {
      if (input.weightTrend?.direction !== 'up' || input.todayWalks < 1) return null;
      const diff = (input.weightTrend.latest - input.weightTrend.previous).toFixed(1);
      return {
        priority: 'info',
        tone: 'celebration',
        title: 'Good walk',
        message: `That walk helps counter the recent ${diff} kg upward trend. Consistent activity makes the difference.`,
        actionType: 'remind_activity',
      };
    },
  },

  // ── P13: Recovery ─────────────────────────────────────────────────────────
  // More than three high-intensity days without a rest day risks joint strain
  // and burnout in dogs, and the same holds for sustained play in cats.
  {
    id: 'recovery_rest_day',
    group: 'activity',
    requires: ['activity'],
    evaluate: (input) => {
      if (input.consecutiveHighIntensityDays == null) return null;
      if (input.consecutiveHighIntensityDays < 3) return null;
      return {
        priority: 'action',
        tone: 'action',
        title: 'A rest day would help',
        message: `${input.consecutiveHighIntensityDays} days in a row of high-intensity activity. A rest day or a light walk gives joints and muscles time to recover.`,
        actionType: 'remind_activity',
      };
    },
  },

  // ── P14: Weigh-in overdue ─────────────────────────────────────────────────
  {
    id: 'weigh_in_overdue',
    group: 'weigh_in',
    evaluate: (input, ctx) => {
      if (!input.hasWeightGoal || input.daysSinceLastWeighIn == null) return null;
      if (input.daysSinceLastWeighIn < 14) return null;
      return {
        priority: 'action',
        tone: 'action',
        title: 'Weigh-in overdue',
        message: `It has been ${input.daysSinceLastWeighIn} days since ${ctx.name} was last weighed. Logging a weight shows progress toward the goal.`,
        actionType: 'remind_weight',
      };
    },
  },

  // ── P15: Drop-off ─────────────────────────────────────────────────────────
  {
    id: 'engagement_churn',
    group: 'engagement',
    evaluate: (input, ctx) => {
      if (input.daysSinceLastFoodLog == null || input.daysSinceLastFoodLog < 3) return null;
      if (input.calPercent >= 30) return null;
      return {
        priority: 'action',
        tone: 'info',
        title: 'Nothing logged lately',
        message: `No food logged for ${input.daysSinceLastFoodLog} days. A quick scan or a manual entry keeps ${ctx.name}'s record current.`,
        actionType: 'remind_log',
      };
    },
  },

  // ── P16: High burn, low intake ────────────────────────────────────────────
  {
    id: 'high_burn',
    group: 'calories',
    requires: ['meal'],
    evaluate: (input, ctx) => {
      if (input.exerciseCalorieRatio == null || input.exerciseCalorieRatio <= 0.5) return null;
      if (input.calPercent >= 70) return null;
      return {
        priority: 'info',
        tone: 'info',
        title: 'High burn day',
        message: `Activity is burning about ${Math.round(input.exerciseCalorieRatio * 100)}% of today's calories. ${ctx.name} needs enough fuel to sustain that.`,
        actionType: 'remind_log',
      };
    },
  },

  // ── P16.5: Low burn, high intake ──────────────────────────────────────────
  {
    id: 'low_burn_high_intake',
    group: 'calories',
    requires: ['meal'],
    evaluate: (input) => {
      if (input.exerciseCalorieRatio == null || input.exerciseCalorieRatio >= 0.2) return null;
      if (input.calPercent < 85) return null;
      return {
        priority: 'action',
        tone: 'action',
        title: 'Move more today',
        message: `Activity is low but calories are at ${input.calPercent}%. A short walk or play session would help balance the intake.`,
        actionType: 'suggest_walk',
      };
    },
  },
];

function buildContext(input: NudgeInput): RuleContext {
  const name = input.petName?.trim();
  return {
    hour: typeof input.hour === 'number' ? input.hour : new Date().getHours(),
    hasRestrictions: input.clinical.activityRestrictions.length > 0,
    // "your pet" is banned by the copy spec, but the engine has to say
    // *something* when no pet is loaded (tests, cold start). "they" is the
    // neutral fallback and reads correctly in every message that uses it.
    name: name || 'they',
    named: Boolean(name),
  };
}

/**
 * Every rule that currently applies, at most one per group, in priority order.
 *
 * This is what the notification center consumes.
 */
export function computeNudges(input: NudgeInput): Nudge[] {
  const ctx = buildContext(input);
  const claimed = new Set<NudgeGroup>();
  const out: Nudge[] = [];

  for (const rule of RULES) {
    if (claimed.has(rule.group)) continue;
    // Readiness is checked BEFORE evaluate, not inside it. One choke point is
    // auditable; sixteen scattered guards inside rule bodies would be sixteen
    // chances to forget one — which is how a brand-new account came to be told
    // its water was low against a target that did not exist.
    if (rule.requires?.some(domain => !domainReady(domain, input))) continue;
    const result = rule.evaluate(input, ctx);
    if (!result) continue;
    claimed.add(rule.group);
    out.push({ id: rule.id, ...result });
  }

  return out;
}

/**
 * The single highest-priority nudge, or null.
 *
 * Byte-for-byte the old contract: the first rule in the chain that matches. Kept
 * so anything still expecting one nudge keeps working, and so the test suite can
 * assert the refactor did not reorder the chain.
 */
export function computeNudge(input: NudgeInput): Nudge | null {
  return computeNudges(input)[0] ?? null;
}

/** Rule ids in priority order. Exported for tests and for catalogue coverage checks. */
export const NUDGE_RULE_IDS: readonly NudgeRuleId[] = RULES.map(r => r.id);

/** The domains each rule depends on. Exported so tests can assert the map directly. */
export const NUDGE_RULE_REQUIREMENTS: Readonly<Record<NudgeRuleId, readonly NudgeDomain[]>> =
  Object.fromEntries(RULES.map(r => [r.id, r.requires ?? []])) as unknown as Record<
    NudgeRuleId,
    readonly NudgeDomain[]
  >;

/** The group a rule belongs to. Exported for tests. */
export const NUDGE_RULE_GROUPS: Readonly<Record<NudgeRuleId, NudgeGroup>> = Object.fromEntries(
  RULES.map(r => [r.id, r.group]),
) as Record<NudgeRuleId, NudgeGroup>;
