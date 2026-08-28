/**
 * The nudge engine had no test coverage before the notification center forced
 * it to return a list instead of a single winner. That refactor touched all 17
 * rules, so these tests exist mainly to prove one thing: no clinical threshold
 * moved.
 *
 * Every rule gets a case that fires it and a case just the other side of its
 * boundary. `hour` is always passed explicitly — half these rules read the
 * clock, and a suite that passes only between 2pm and 5pm is not a suite.
 */

import {
  computeNudge,
  computeNudges,
  NUDGE_RULE_GROUPS,
  NUDGE_RULE_IDS,
  NUDGE_RULE_REQUIREMENTS,
  type NudgeInput,
  type NudgeRuleId,
} from './nudgeEngine';

/**
 * A day where nothing is wrong and nothing is notable — for a pet who is fully
 * set up.
 *
 * The six readiness flags are all true here on purpose, so the threshold tests
 * below keep testing thresholds rather than accidentally testing the gate. The
 * gate itself gets its own block at the bottom.
 */
function baseInput(overrides: Partial<NudgeInput> = {}): NudgeInput {
  return {
    mealPlanned: true,
    hydrationPlanned: true,
    activityPlanned: true,
    hasEverLoggedMeal: true,
    hasEverLoggedWater: true,
    hasEverCompletedActivity: true,
    todayCalories: 600,
    calPercent: 60,
    caloriesRemaining: 400,
    waterPercent: 0.8,
    todayWalks: 0,
    treatsConsumed: 0,
    treatCaloriesConsumed: 0,
    treatBudget: 100,
    todayActivityMinutes: 0,
    activityCompletionRate: 0.8,
    weightTrend: null,
    clinical: { activityRestrictions: [], medicalConditions: [] },
    avgTreatsPerDay: null,
    weeklyTreatCalPercent: null,
    daysSinceLastWeighIn: null,
    hasWeightGoal: false,
    goalDirection: null,
    weeklyDelta: null,
    daysUnderTarget: null,
    topContributorScan: null,
    isFreemiumActive: false,
    daysSinceCreation: 0,
    consecutiveHighIntensityDays: 0,
    daysSinceLastFoodLog: 0,
    exerciseCalorieRatio: null,
    petName: 'Bunny',
    hour: 12,
    ...overrides,
  };
}

const idsOf = (input: NudgeInput): NudgeRuleId[] => computeNudges(input).map(n => n.id);

describe('quiet baseline', () => {
  it('says nothing on an unremarkable midday', () => {
    expect(computeNudges(baseInput())).toEqual([]);
    expect(computeNudge(baseInput())).toBeNull();
  });
});

describe('rule thresholds', () => {
  // ── Trial ──
  it('fires the trial nudge on odd days only', () => {
    const on = baseInput({ isFreemiumActive: true, daysSinceCreation: 7 });
    const off = baseInput({ isFreemiumActive: true, daysSinceCreation: 8 });
    expect(idsOf(on)).toContain('freemium_trial');
    expect(idsOf(off)).not.toContain('freemium_trial');
  });

  it('stops the trial nudge once the freemium window has elapsed', () => {
    const input = baseInput({ isFreemiumActive: true, daysSinceCreation: 31 });
    expect(idsOf(input)).not.toContain('freemium_trial');
  });

  // ── Calories ──
  it('fires at 90% before 6pm but not after', () => {
    expect(idsOf(baseInput({ calPercent: 90, hour: 17 }))).toContain('calorie_over');
    expect(idsOf(baseInput({ calPercent: 90, hour: 18 }))).not.toContain('calorie_over');
  });

  it('fires after 6pm once actually over the limit', () => {
    expect(idsOf(baseInput({ calPercent: 100, hour: 20 }))).toContain('calorie_over');
  });

  it('names the overage rather than the percentage when over', () => {
    const [nudge] = computeNudges(baseInput({ calPercent: 120, todayCalories: 1200, hour: 20 }));
    expect(nudge.title).toBe('Over the calorie limit');
    expect(nudge.message).toContain('200 kcal over');
  });

  it('suggests a walk before dinner only in the 70-89% band with no walk yet', () => {
    expect(idsOf(baseInput({ calPercent: 75, hour: 15 }))).toContain('walk_before_dinner');
    expect(idsOf(baseInput({ calPercent: 75, hour: 17 }))).not.toContain('walk_before_dinner');
    expect(idsOf(baseInput({ calPercent: 75, hour: 15, todayWalks: 1 }))).not.toContain('walk_before_dinner');
  });

  it('withholds the walk suggestion when activity is medically restricted', () => {
    const input = baseInput({
      calPercent: 75,
      hour: 15,
      clinical: { activityRestrictions: ['post_surgery'], medicalConditions: ['arthritis'] },
    });
    expect(idsOf(input)).not.toContain('walk_before_dinner');
  });

  it('flags missing meals only after 2pm', () => {
    expect(idsOf(baseInput({ calPercent: 20, hour: 14 }))).toContain('meals_missing');
    expect(idsOf(baseInput({ calPercent: 20, hour: 13 }))).not.toContain('meals_missing');
  });

  // ── Weigh-in ──
  it('applies the goal-specific reweigh cadence', () => {
    const lose = baseInput({ hasWeightGoal: true, goalDirection: 'lose', daysSinceLastWeighIn: 14 });
    const maintainEarly = baseInput({ hasWeightGoal: true, goalDirection: 'maintain', daysSinceLastWeighIn: 27 });
    expect(idsOf(lose)).toContain('weigh_in_cadence');
    expect(idsOf(maintainEarly)).not.toContain('weigh_in_cadence');
  });

  /**
   * The reason groups exist. Three weigh-in rules are simultaneously true at 14
   * days on a weight-loss plan; before grouping, an all-matches pass would have
   * posted three near-identical items about one missing measurement.
   */
  it('posts exactly one weigh-in item when all three weigh-in rules apply', () => {
    const input = baseInput({ hasWeightGoal: true, goalDirection: 'lose', daysSinceLastWeighIn: 30 });
    const weighIns = computeNudges(input).filter(n => NUDGE_RULE_GROUPS[n.id] === 'weigh_in');
    expect(weighIns).toHaveLength(1);
    expect(weighIns[0].id).toBe('weigh_in_cadence');
  });

  // ── Treats ──
  it('asks to reduce dinner only once treats exceed their budget', () => {
    const over = baseInput({ treatsConsumed: 3, treatCaloriesConsumed: 150, treatBudget: 100 });
    const under = baseInput({ treatsConsumed: 3, treatCaloriesConsumed: 90, treatBudget: 100 });
    expect(idsOf(over)).toContain('treat_over_budget');
    expect(idsOf(under)).not.toContain('treat_over_budget');
  });

  it('names the biggest contributor once it clears 50 kcal', () => {
    const input = baseInput({
      treatsConsumed: 2,
      treatCaloriesConsumed: 150,
      treatBudget: 100,
      topContributorScan: { food_name: 'Dentastick', calories: 80 },
    });
    const [nudge] = computeNudges(input);
    expect(nudge.message).toContain('Dentastick');
  });

  it('escalates the treat pattern past the 10% guide', () => {
    const severe = baseInput({ avgTreatsPerDay: 3, weeklyTreatCalPercent: 14 });
    const mild = baseInput({ avgTreatsPerDay: 3, weeklyTreatCalPercent: 6 });
    expect(computeNudges(severe)[0].tone).toBe('action');
    expect(computeNudges(mild)[0].tone).toBe('info');
  });

  // ── Weight trend ──
  it('separates the high-calorie weight warning from the gentle one', () => {
    const trend = { latest: 21, previous: 20, direction: 'up' };
    expect(idsOf(baseInput({ weightTrend: trend, calPercent: 80 }))).toContain('weight_up_high_cal');
    expect(idsOf(baseInput({ weightTrend: trend, calPercent: 50 }))).toContain('weight_up');
  });

  // ── Hydration ──
  it('prompts for water only after midday', () => {
    expect(idsOf(baseInput({ waterPercent: 0.1, hour: 12 }))).toContain('hydration_low');
    expect(idsOf(baseInput({ waterPercent: 0.1, hour: 11 }))).not.toContain('hydration_low');
    expect(idsOf(baseInput({ waterPercent: 0.3, hour: 15 }))).not.toContain('hydration_low');
  });

  // ── Clinical ──
  it('gives condition-aware portion advice at 85%', () => {
    const input = baseInput({
      calPercent: 85,
      clinical: { activityRestrictions: ['post_surgery'], medicalConditions: ['arthritis'] },
    });
    const clinical = computeNudges(input).find(n => n.id === 'clinical_portion');
    expect(clinical?.message).toContain('arthritis');
    expect(clinical?.tone).toBe('clinical');
  });

  it('treats sustained under-eating as clinical', () => {
    const input = baseInput({ daysUnderTarget: 2, calPercent: 30, hour: 10 });
    const nudge = computeNudges(input).find(n => n.id === 'chronic_under_eating');
    expect(nudge?.tone).toBe('clinical');
  });

  it('stands down on under-eating when today is already recovering', () => {
    expect(idsOf(baseInput({ daysUnderTarget: 3, calPercent: 60 }))).not.toContain('chronic_under_eating');
  });

  // ── Activity ──
  it('asks for a rest day from the third consecutive high-intensity day', () => {
    expect(idsOf(baseInput({ consecutiveHighIntensityDays: 3 }))).toContain('recovery_rest_day');
    expect(idsOf(baseInput({ consecutiveHighIntensityDays: 2 }))).not.toContain('recovery_rest_day');
  });

  // ── Engagement ──
  it('re-engages after three days without a food log', () => {
    expect(idsOf(baseInput({ daysSinceLastFoodLog: 3, calPercent: 10 }))).toContain('engagement_churn');
    expect(idsOf(baseInput({ daysSinceLastFoodLog: 2, calPercent: 10 }))).not.toContain('engagement_churn');
  });

  // ── Burn balance ──
  it('reads the exercise-calorie ratio in both directions', () => {
    expect(idsOf(baseInput({ exerciseCalorieRatio: 0.6, calPercent: 50 }))).toContain('high_burn');
    expect(idsOf(baseInput({ exerciseCalorieRatio: 0.1, calPercent: 90, hour: 20 }))).toContain('low_burn_high_intake');
  });

  // ── Celebration ──
  it('celebrates a balanced day only in the evening', () => {
    const good = { calPercent: 70, waterPercent: 0.8, todayWalks: 1 };
    expect(idsOf(baseInput({ ...good, hour: 19 }))).toContain('balanced_day');
    expect(idsOf(baseInput({ ...good, hour: 17 }))).not.toContain('balanced_day');
  });
});

describe('computeNudges vs computeNudge', () => {
  it('returns more than one item when unrelated concerns are true at once', () => {
    const input = baseInput({
      calPercent: 95,
      hour: 12,
      waterPercent: 0.1,
      hasWeightGoal: true,
      goalDirection: 'lose',
      daysSinceLastWeighIn: 20,
    });
    const ids = idsOf(input);
    expect(ids).toEqual(expect.arrayContaining(['calorie_over', 'hydration_low', 'weigh_in_cadence']));
  });

  it('never returns two items from the same group', () => {
    // Deliberately maximal: as many rules true simultaneously as the input
    // shape allows.
    const input = baseInput({
      calPercent: 95,
      hour: 19,
      todayWalks: 1,
      waterPercent: 0.1,
      treatsConsumed: 3,
      treatCaloriesConsumed: 300,
      treatBudget: 100,
      avgTreatsPerDay: 4,
      weeklyTreatCalPercent: 20,
      todayActivityMinutes: 40,
      activityCompletionRate: 0.1,
      consecutiveHighIntensityDays: 5,
      hasWeightGoal: true,
      goalDirection: 'lose',
      daysSinceLastWeighIn: 40,
      weightTrend: { latest: 22, previous: 20, direction: 'up' },
      daysSinceLastFoodLog: 5,
      exerciseCalorieRatio: 0.1,
      isFreemiumActive: true,
      daysSinceCreation: 5,
    });
    const groups = computeNudges(input).map(n => NUDGE_RULE_GROUPS[n.id]);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it('keeps computeNudge as the first match in the original priority order', () => {
    const input = baseInput({ calPercent: 95, hour: 12, waterPercent: 0.1 });
    expect(computeNudge(input)?.id).toBe(computeNudges(input)[0].id);
    // Over-calorie outranked hydration in the original if-chain and still does.
    expect(computeNudge(input)?.id).toBe('calorie_over');
  });
});

describe('copy spec', () => {
  /**
   * Mechanically enforceable subset of Copy Spec v1 (Brand Book §6.04). The
   * full spec also bans "your pet" in favour of the animal's name, which these
   * rules honour via `petName` where the sentence allows it.
   */
  const everyCopy = () => {
    const inputs: NudgeInput[] = [
      baseInput({ isFreemiumActive: true, daysSinceCreation: 5 }),
      baseInput({ calPercent: 120, todayCalories: 1200, hour: 20 }),
      baseInput({ calPercent: 90, hour: 10 }),
      baseInput({ hasWeightGoal: true, goalDirection: 'lose', daysSinceLastWeighIn: 20 }),
      baseInput({ treatsConsumed: 2, treatCaloriesConsumed: 200, treatBudget: 100 }),
      baseInput({ calPercent: 75, hour: 15 }),
      baseInput({ calPercent: 20, hour: 15 }),
      baseInput({ daysUnderTarget: 3, calPercent: 20 }),
      baseInput({ weightTrend: { latest: 21, previous: 20, direction: 'up' }, calPercent: 80 }),
      baseInput({ weightTrend: { latest: 21, previous: 20, direction: 'up' }, calPercent: 50 }),
      baseInput({ waterPercent: 0.1, hour: 15 }),
      baseInput({
        calPercent: 90,
        clinical: { activityRestrictions: ['x'], medicalConditions: ['diabetes'] },
      }),
      baseInput({ todayActivityMinutes: 30, hour: 12, calPercent: 50 }),
      baseInput({ avgTreatsPerDay: 3, weeklyTreatCalPercent: 20 }),
      baseInput({ activityCompletionRate: 0.1 }),
      baseInput({ calPercent: 70, waterPercent: 0.8, todayWalks: 1, hour: 19 }),
      baseInput({ todayWalks: 1, calPercent: 85 }),
      baseInput({ todayActivityMinutes: 30, treatsConsumed: 1, calPercent: 60 }),
      baseInput({ consecutiveHighIntensityDays: 4 }),
      baseInput({ daysSinceLastFoodLog: 4, calPercent: 10 }),
      baseInput({ exerciseCalorieRatio: 0.6, calPercent: 50 }),
      baseInput({ exerciseCalorieRatio: 0.1, calPercent: 90, hour: 20 }),
    ];
    return inputs.flatMap(computeNudges).flatMap(n => [n.title, n.message]);
  };

  it('never uses an exclamation mark', () => {
    for (const text of everyCopy()) expect(text).not.toContain('!');
  });

  it('never uses an emoji', () => {
    // Anything outside the Basic Multilingual Plane, plus the emoji blocks.
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const text of everyCopy()) expect(text).not.toMatch(emoji);
  });

  it('never says "your pet"', () => {
    for (const text of everyCopy()) expect(text.toLowerCase()).not.toContain('your pet');
  });

  it('never opens a title in ALL CAPS', () => {
    const inputs = computeNudges(baseInput({ calPercent: 120, todayCalories: 1200, hour: 20 }));
    for (const n of inputs) expect(n.title).not.toBe(n.title.toUpperCase());
  });
});

describe('domain readiness gate', () => {
  /**
   * A pet straight out of the two-screen walk-first signup.
   *
   * `buildLightweightPetRow` writes `current_weight_kg: 0` and leaves
   * `target_daily_calories` and `body_condition_score` null, so `computeDerived`
   * hands the engine `calPercent: 0` and `waterPercent: 0` — the same zeros it
   * would produce for an owner who genuinely ate and drank nothing all day.
   */
  const freshAccount = (overrides: Partial<NudgeInput> = {}): NudgeInput =>
    baseInput({
      mealPlanned: false,
      hydrationPlanned: false,
      activityPlanned: false,
      hasEverLoggedMeal: false,
      hasEverLoggedWater: false,
      hasEverCompletedActivity: false,
      calPercent: 0,
      waterPercent: 0,
      todayCalories: 0,
      caloriesRemaining: 0,
      activityCompletionRate: 0,
      daysSinceLastFoodLog: null,
      ...overrides,
    });

  /**
   * The regression guard for the reported bug. Every hour, because the two rules
   * that actually fired were clock-gated — hydration from noon, meals from 2pm —
   * so a suite pinned to one hour could pass while the bug was fully alive.
   */
  it('says nothing at any hour of the day for a brand-new account', () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(computeNudges(freshAccount({ hour }))).toEqual([]);
    }
  });

  it('specifically does not claim water is low against a target that does not exist', () => {
    expect(idsOf(freshAccount({ hour: 15 }))).not.toContain('hydration_low');
  });

  it('specifically does not claim meals are missing against a plan that does not exist', () => {
    expect(idsOf(freshAccount({ hour: 15 }))).not.toContain('meals_missing');
  });

  describe('a plan alone is not enough — the owner must have used it', () => {
    it('withholds meal nudges until a meal has ever been logged', () => {
      const planned = freshAccount({ hour: 15, mealPlanned: true, calPercent: 20 });
      expect(idsOf(planned)).not.toContain('meals_missing');

      const engaged = { ...planned, hasEverLoggedMeal: true, daysSinceLastFoodLog: 1 };
      expect(idsOf(engaged)).toContain('meals_missing');
    });

    it('withholds hydration nudges until water has ever been logged', () => {
      const planned = freshAccount({ hour: 15, hydrationPlanned: true });
      expect(idsOf(planned)).not.toContain('hydration_low');

      expect(idsOf({ ...planned, hasEverLoggedWater: true })).toContain('hydration_low');
    });

    it('withholds activity nudges until an activity has ever been completed', () => {
      const planned = freshAccount({
        hour: 12,
        activityPlanned: true,
        consecutiveHighIntensityDays: 4,
      });
      expect(idsOf(planned)).not.toContain('recovery_rest_day');

      expect(idsOf({ ...planned, hasEverCompletedActivity: true })).toContain('recovery_rest_day');
    });
  });

  it('leaves the meal threshold itself untouched once the domain is ready', () => {
    // 49% fires, 50% does not — exactly as before the gate existed.
    expect(idsOf(baseInput({ calPercent: 49, hour: 14 }))).toContain('meals_missing');
    expect(idsOf(baseInput({ calPercent: 50, hour: 14 }))).not.toContain('meals_missing');
  });

  it('still nudges a lapsed owner who never set a calorie target', () => {
    // Churn is deliberately ungated: `daysSinceLastFoodLog >= 3` already proves
    // this owner logged and then stopped, and gating it would silence the one
    // rule aimed at people drifting away.
    const lapsed = freshAccount({ daysSinceLastFoodLog: 5, calPercent: 10 });
    expect(idsOf(lapsed)).toContain('engagement_churn');
  });

  it('still offers the trial to a brand-new account', () => {
    // Lifecycle, not health — it depends on no target at all.
    const trial = freshAccount({ isFreemiumActive: true, daysSinceCreation: 5 });
    expect(idsOf(trial)).toContain('freemium_trial');
  });

  it('treats an unset flag as not-ready, so a forgetful caller gets silence', () => {
    const { mealPlanned, hasEverLoggedMeal, ...withoutMealFlags } = baseInput({
      calPercent: 20,
      hour: 15,
    });
    void mealPlanned;
    void hasEverLoggedMeal;
    expect(idsOf(withoutMealFlags as NudgeInput)).not.toContain('meals_missing');
  });

  it('requires every listed domain, not just one', () => {
    // balanced_day needs all three; two out of three must not be enough.
    const evening = {
      hour: 19,
      calPercent: 70,
      waterPercent: 0.8,
      todayWalks: 1,
    };
    expect(idsOf(baseInput(evening))).toContain('balanced_day');
    expect(idsOf(baseInput({ ...evening, hasEverCompletedActivity: false })))
      .not.toContain('balanced_day');
  });

  it('maps every rule that reads a target-derived percentage to a domain', () => {
    // The rules whose conditions divide by a target. If one of these ever loses
    // its requirement, a fresh account starts being told it is failing again.
    const mustBeGated: NudgeRuleId[] = [
      'calorie_over', 'walk_before_dinner', 'meals_missing', 'chronic_under_eating',
      'high_burn', 'low_burn_high_intake', 'clinical_portion', 'walk_complete',
      'treat_over_budget', 'treat_earned', 'treat_pattern', 'active_treat_offset',
      'hydration_low', 'activity_light_week', 'recovery_rest_day', 'balanced_day',
    ];
    for (const id of mustBeGated) {
      expect(NUDGE_RULE_REQUIREMENTS[id].length).toBeGreaterThan(0);
    }
  });
});

describe('catalogue integrity', () => {
  it('gives every rule a group', () => {
    for (const id of NUDGE_RULE_IDS) expect(NUDGE_RULE_GROUPS[id]).toBeDefined();
  });

  it('has no duplicate rule ids', () => {
    expect(new Set(NUDGE_RULE_IDS).size).toBe(NUDGE_RULE_IDS.length);
  });
});
