import {
  fallsInQuietWindow,
  INTENSITY_CAPS,
  isAllowedForIntensity,
  isoWeek,
  parseMinutes,
  selectCampaign,
  type RuleInput,
} from './rules';

const TODAY = '2026-08-05'; // a Wednesday

function input(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    localHour: 12,
    localWeekday: 3,
    hasPet: true,
    daysSinceSignup: 30,
    totalLogs: 40,
    daysSinceLastLog: 0,
    daysSinceLastSession: 0,
    calPercent: 80,
    daysUnderTarget: 0,
    hasWeightGoal: false,
    goalDirection: null,
    daysSinceLastWeighIn: null,
    minutesToNextMeal: null,
    nextMealLabel: null,
    leadMinutes: 10,
    currentStreakDays: 0,
    loggedToday: true,
    pendingMilestone: false,
    pendingWalksign: false,
    pendingVetCheckin: false,
    weekMealsLogged: 0,
    weekWalksLogged: 0,
    ...overrides,
  };
}

describe('selectCampaign', () => {
  test('a settled, on-track owner is left alone', () => {
    expect(selectCampaign(input(), TODAY)).toBeNull();
  });

  test('at most one campaign is ever returned per run', () => {
    // Every trigger at once. The dispatcher must still pick exactly one.
    const match = selectCampaign(
      input({
        pendingMilestone: true,
        pendingVetCheckin: true,
        minutesToNextMeal: 5,
        currentStreakDays: 9,
        loggedToday: false,
        localHour: 20,
      }),
      TODAY,
    );
    expect(match?.campaign).toBe('milestone');
  });

  test('earned moments outrank reminders', () => {
    expect(
      selectCampaign(input({ pendingWalksign: true, minutesToNextMeal: 5 }), TODAY)?.campaign,
    ).toBe('walksign_confirmed');
  });

  test('meal window fires inside the owner-configured lead time', () => {
    const match = selectCampaign(
      input({ minutesToNextMeal: 8, leadMinutes: 10, nextMealLabel: 'Dinner' }),
      TODAY,
    );
    expect(match).toEqual({ campaign: 'meal_window', window: '2026-08-05:Dinner' });
  });

  test('meal window does not fire outside the lead time', () => {
    expect(selectCampaign(input({ minutesToNextMeal: 45, leadMinutes: 10 }), TODAY)).toBeNull();
  });

  test('a meal already passed does not fire', () => {
    expect(selectCampaign(input({ minutesToNextMeal: -5, leadMinutes: 10 }), TODAY)).toBeNull();
  });

  describe('the water firehose cannot come back', () => {
    // The retired pet-reminders function sent nudge_water to anyone under 30%
    // of a target it computed inline as weight*50. That was true for nearly
    // everyone nearly every day: 1,014 of 1,353 lifetime notifications (75%)
    // were this one rule. Hydration is now in-app only.
    test('no campaign exists for hydration', () => {
      const everyHour = Array.from({ length: 24 }, (_, h) => h);
      for (const localHour of everyHour) {
        const match = selectCampaign(input({ localHour, loggedToday: false }), TODAY);
        expect(match?.campaign).not.toBe('nudge_water');
        expect(match?.campaign).not.toBe('hydration');
      }
    });

    test('an owner who has logged nothing today still gets at most one push', () => {
      const matches = Array.from({ length: 24 }, (_, localHour) =>
        selectCampaign(input({ localHour, loggedToday: false, currentStreakDays: 5 }), TODAY),
      ).filter(Boolean);
      // Exactly one hour of the day qualifies (20:00 streak risk), not all of them.
      expect(matches).toHaveLength(1);
      expect(matches[0]?.campaign).toBe('streak_risk');
    });
  });

  describe('activation', () => {
    test('no pet after a day prompts onboarding at 10:00 local', () => {
      expect(
        selectCampaign(input({ hasPet: false, daysSinceSignup: 1, localHour: 10 }), TODAY)?.campaign,
      ).toBe('onboarding_incomplete');
    });

    test('no pet at any other hour stays silent', () => {
      expect(
        selectCampaign(input({ hasPet: false, daysSinceSignup: 1, localHour: 11 }), TODAY),
      ).toBeNull();
    });

    test('onboarding prompts stop after four days', () => {
      expect(
        selectCampaign(input({ hasPet: false, daysSinceSignup: 9, localHour: 10 }), TODAY),
      ).toBeNull();
    });

    test('a pet with no logs is nudged at the meal window', () => {
      expect(
        selectCampaign(
          input({ totalLogs: 0, daysSinceSignup: 1, minutesToNextMeal: 40 }),
          TODAY,
        )?.campaign,
      ).toBe('first_log_prompt');
    });
  });

  describe('health signals', () => {
    test('chronic under-eating fires once a week at 18:00', () => {
      const match = selectCampaign(
        input({ daysUnderTarget: 2, calPercent: 40, localHour: 18 }),
        TODAY,
      );
      expect(match).toEqual({ campaign: 'plan_drift', window: '2026-W32' });
    });

    test('under-eating that today already corrected does not fire', () => {
      expect(
        selectCampaign(input({ daysUnderTarget: 2, calPercent: 85, localHour: 18 }), TODAY),
      ).toBeNull();
    });

    test('a weight-loss plan overdue a weigh-in fires Saturday morning', () => {
      expect(
        selectCampaign(
          input({
            hasWeightGoal: true,
            goalDirection: 'lose',
            daysSinceLastWeighIn: 16,
            localWeekday: 6,
            localHour: 9,
          }),
          TODAY,
        )?.campaign,
      ).toBe('weigh_in_due');
    });

    test('a maintenance plan waits 28 days, not 14', () => {
      const base = {
        hasWeightGoal: true,
        goalDirection: 'maintain' as const,
        localWeekday: 6,
        localHour: 9,
      };
      expect(selectCampaign(input({ ...base, daysSinceLastWeighIn: 16 }), TODAY)).toBeNull();
      expect(
        selectCampaign(input({ ...base, daysSinceLastWeighIn: 30 }), TODAY)?.campaign,
      ).toBe('weigh_in_due');
    });
  });

  describe('streaks and recaps', () => {
    test('streak risk needs an actual streak', () => {
      expect(
        selectCampaign(input({ currentStreakDays: 1, loggedToday: false, localHour: 20 }), TODAY),
      ).toBeNull();
      expect(
        selectCampaign(input({ currentStreakDays: 3, loggedToday: false, localHour: 20 }), TODAY)
          ?.campaign,
      ).toBe('streak_risk');
    });

    test('a recap with nothing to report is suppressed', () => {
      const sunday = { localWeekday: 7, localHour: 18 };
      expect(selectCampaign(input({ ...sunday, weekMealsLogged: 1 }), TODAY)).toBeNull();
      expect(
        selectCampaign(input({ ...sunday, weekMealsLogged: 7 }), TODAY)?.campaign,
      ).toBe('weekly_recap');
    });
  });

  describe('win-back', () => {
    test('fires at seven days, once', () => {
      const match = selectCampaign(
        input({ daysSinceLastSession: 8, localHour: 10 }),
        TODAY,
      );
      expect(match).toEqual({ campaign: 'winback_7d', window: 'winback_7d' });
    });

    test('a dormant owner past 45 days is left alone for good', () => {
      expect(selectCampaign(input({ daysSinceLastSession: 90, localHour: 10 }), TODAY)).toBeNull();
    });

    test('an owner who never logged anything is not won back', () => {
      expect(
        selectCampaign(input({ daysSinceLastSession: 8, totalLogs: 0, localHour: 10 }), TODAY),
      ).toBeNull();
    });
  });
});

describe('quiet hours', () => {
  test('a window wrapping midnight covers both sides', () => {
    expect(fallsInQuietWindow(parseMinutes('23:30'), '22:00', '07:00')).toBe(true);
    expect(fallsInQuietWindow(parseMinutes('03:00'), '22:00', '07:00')).toBe(true);
    expect(fallsInQuietWindow(parseMinutes('12:00'), '22:00', '07:00')).toBe(false);
    expect(fallsInQuietWindow(parseMinutes('07:00'), '22:00', '07:00')).toBe(false);
  });

  test('a same-day window behaves', () => {
    expect(fallsInQuietWindow(parseMinutes('22:30'), '22:00', '23:30')).toBe(true);
    expect(fallsInQuietWindow(parseMinutes('21:00'), '22:00', '23:30')).toBe(false);
  });

  test('unset quiet hours never suppress', () => {
    expect(fallsInQuietWindow(600, null, null)).toBe(false);
    expect(fallsInQuietWindow(600, '22:00', null)).toBe(false);
  });

  test('a zero-width window never suppresses', () => {
    expect(fallsInQuietWindow(600, '22:00', '22:00')).toBe(false);
  });
});

describe('intensity', () => {
  test('minimal receives only care-critical campaigns', () => {
    expect(isAllowedForIntensity('meal_window', 'minimal')).toBe(true);
    expect(isAllowedForIntensity('vet_checkin', 'minimal')).toBe(true);
    expect(isAllowedForIntensity('weekly_recap', 'minimal')).toBe(false);
    expect(isAllowedForIntensity('winback_7d', 'minimal')).toBe(false);
  });

  test('standard and chatty receive everything the rules select', () => {
    expect(isAllowedForIntensity('weekly_recap', 'standard')).toBe(true);
    expect(isAllowedForIntensity('winback_7d', 'chatty')).toBe(true);
  });

  test('caps are ordered minimal < standard < chatty', () => {
    expect(INTENSITY_CAPS.minimal.perWeek).toBeLessThan(INTENSITY_CAPS.standard.perWeek);
    expect(INTENSITY_CAPS.standard.perWeek).toBeLessThan(INTENSITY_CAPS.chatty.perWeek);
    expect(INTENSITY_CAPS.standard.perDay).toBe(1);
  });
});

describe('isoWeek', () => {
  test('groups a week onto one key', () => {
    expect(isoWeek('2026-08-03')).toBe(isoWeek('2026-08-05'));
    expect(isoWeek('2026-08-03')).not.toBe(isoWeek('2026-08-11'));
  });
});
