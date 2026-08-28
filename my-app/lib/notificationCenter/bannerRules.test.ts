/**
 * The banner predicates, at their boundaries.
 *
 * These conditions used to live inside six components and were only ever
 * exercised by mounting them. They now decide what the notification center
 * shows, including three items that ask an owner to involve a vet — so the
 * thresholds are worth pinning precisely.
 */

import { buildBannerItems, matchedDeferredConditions, type BannerInput } from './bannerRules';

function baseInput(overrides: Partial<BannerInput> = {}): BannerInput {
  return {
    petId: 'pet-1',
    petName: 'Bunny',
    species: 'dog',
    goal: 'maintain',
    bcs: 5,
    severeObesityVetConfirmedAt: null,
    medicalConditions: [],
    ageMonths: 36,
    currentWeightKg: 20,
    targetWeightKg: 20,
    todayCalories: 800,
    observedMer: null,
    subscriptionStatus: 'active',
    trialDaysLeft: null,
    completeness: null,
    pendingCheckin: null,
    nextActivity: null,
    walkEnabled: true,
    activityPlanReady: true,
    currentStreak: 3,
    longestStreak: 5,
    dismissed: {
      vetTuned: false,
      growthPhase: false,
      merRecalibration: false,
      profileCompletion: false,
    },
    hour: 12,
    now: new Date(2026, 7, 18, 12, 0, 0),
    ...overrides,
  };
}

const titles = (input: BannerInput) => buildBannerItems(input).map(i => i.title);
const find = (input: BannerInput, fragment: string) =>
  buildBannerItems(input).find(i => i.id.includes(fragment));

describe('quiet baseline', () => {
  it('produces nothing for a healthy, complete, subscribed profile', () => {
    expect(buildBannerItems(baseInput())).toEqual([]);
  });
});

describe('severe obesity vet gate', () => {
  it('opens at a body condition of 8, not 7', () => {
    expect(find(baseInput({ bcs: 7 }), 'severe_obesity')).toBeUndefined();
    expect(find(baseInput({ bcs: 8 }), 'severe_obesity')).toBeDefined();
    expect(find(baseInput({ bcs: 9 }), 'severe_obesity')).toBeDefined();
  });

  it('closes once the owner records a vet consultation', () => {
    const input = baseInput({ bcs: 9, severeObesityVetConfirmedAt: '2026-08-01T00:00:00Z' });
    expect(find(input, 'severe_obesity')).toBeUndefined();
  });

  it('is clinical, sticky and resolved in place rather than by a link', () => {
    const item = find(baseInput({ bcs: 9 }), 'severe_obesity');
    expect(item?.tone).toBe('clinical');
    expect(item?.sticky).toBe(true);
    expect(item?.action).toBe('confirm_vet_consult');
    expect(item?.route).toBeUndefined();
  });
});

describe('cat refusing food', () => {
  const catInput = (o: Partial<BannerInput> = {}) =>
    baseInput({ species: 'cat', goal: 'lose', todayCalories: 0, hour: 14, ...o });

  it('waits until 2pm, because zero calories at breakfast is not a signal', () => {
    expect(find(catInput({ hour: 13 }), 'cat_refusing_food')).toBeUndefined();
    expect(find(catInput({ hour: 14 }), 'cat_refusing_food')).toBeDefined();
  });

  it('only applies to cats on a weight-loss plan who have eaten nothing', () => {
    expect(find(catInput({ species: 'dog' }), 'cat_refusing_food')).toBeUndefined();
    expect(find(catInput({ goal: 'maintain' }), 'cat_refusing_food')).toBeUndefined();
    expect(find(catInput({ todayCalories: 50 }), 'cat_refusing_food')).toBeUndefined();
  });

  it('names hepatic lipidosis and stays sticky', () => {
    const item = find(catInput(), 'cat_refusing_food');
    expect(item?.tone).toBe('clinical');
    expect(item?.sticky).toBe(true);
    expect(item?.body).toContain('hepatic lipidosis');
  });

  it('is day-scoped, so it returns tomorrow if the cat still has not eaten', () => {
    expect(find(catInput(), 'cat_refusing_food')?.id).toContain('2026-08-18');
  });
});

describe('vet-tuned nutrition', () => {
  it('matches only the deferred conditions', () => {
    expect(matchedDeferredConditions(['diabetes'])).toContain('diabetes');
    expect(matchedDeferredConditions(['arthritis'])).toHaveLength(0);
    expect(matchedDeferredConditions(null)).toHaveLength(0);
  });

  it('fires for a deferred condition and honours the existing dismiss key', () => {
    const on = baseInput({ medicalConditions: ['diabetes'] });
    const off = baseInput({
      medicalConditions: ['diabetes'],
      dismissed: { ...baseInput().dismissed, vetTuned: true },
    });
    expect(find(on, 'vet_tuned_nutrition')).toBeDefined();
    expect(find(off, 'vet_tuned_nutrition')).toBeUndefined();
  });
});

describe('growth phase', () => {
  it('opens under 12 months when the goal wants restriction', () => {
    const restricting = { currentWeightKg: 20, targetWeightKg: 18 };
    expect(find(baseInput({ ageMonths: 11, ...restricting }), 'growth_phase')).toBeDefined();
    expect(find(baseInput({ ageMonths: 12, ...restricting }), 'growth_phase')).toBeUndefined();
  });

  it('stays quiet for a growing animal with no restriction goal', () => {
    const input = baseInput({ ageMonths: 6, currentWeightKg: 10, targetWeightKg: 15 });
    expect(find(input, 'growth_phase')).toBeUndefined();
  });
});

describe('MER recalibration', () => {
  const mer = (status: string) => ({
    status,
    predictedDailyKcal: 900,
    suggestedDailyKcal: 1100,
    daysObserved: 20,
    kcalLogCount: 40,
    weightLogCount: 4,
  }) as never;

  it('fires only on a suggested recalibration', () => {
    expect(find(baseInput({ observedMer: mer('recalibration_suggested') }), 'mer_recalibration')).toBeDefined();
    expect(find(baseInput({ observedMer: mer('on_track') }), 'mer_recalibration')).toBeUndefined();
  });

  it('carries both numbers so the confirmation can show old versus new', () => {
    const item = find(baseInput({ observedMer: mer('recalibration_suggested') }), 'mer_recalibration');
    expect(item?.meta?.old_kcal).toBe(900);
    expect(item?.meta?.new_kcal).toBe(1100);
    expect(item?.action).toBe('review_mer_recalibration');
  });

  it('respects the 14-day rejection window', () => {
    const input = baseInput({
      observedMer: mer('recalibration_suggested'),
      dismissed: { ...baseInput().dismissed, merRecalibration: true },
    });
    expect(find(input, 'mer_recalibration')).toBeUndefined();
  });
});

describe('trial', () => {
  it('opens at 5 days left, not 6', () => {
    const trial = (daysLeft: number) => baseInput({ subscriptionStatus: 'trial', trialDaysLeft: daysLeft });
    expect(find(trial(6), 'trial_ending')).toBeUndefined();
    expect(find(trial(5), 'trial_ending')).toBeDefined();
  });

  it('says "today" rather than "0 days"', () => {
    const item = find(baseInput({ subscriptionStatus: 'trial', trialDaysLeft: 0 }), 'trial_ending');
    expect(item?.title).toBe('The trial ends today');
  });

  it('ignores an active subscription', () => {
    expect(find(baseInput({ subscriptionStatus: 'active', trialDaysLeft: 2 }), 'trial_ending')).toBeUndefined();
  });
});

describe('profile completion', () => {
  const completeness = (missingCount: number) => ({
    score: 56,
    isAccurateEnough: false,
    missing: Array.from({ length: missingCount }, (_, i) => ({
      key: 'pantry' as const,
      label: 'Add a food to the pantry',
      impact: 'high' as const,
      weight: 10 - i,
      focus: 'pantry' as const,
    })),
  });

  it('stays quiet once the high-impact fields are all present', () => {
    const input = baseInput({ completeness: { score: 100, missing: [], isAccurateEnough: true } });
    expect(find(input, 'profile_completion')).toBeUndefined();
  });

  it('deep-links at the single highest-impact gap', () => {
    const item = find(baseInput({ completeness: completeness(3) }), 'profile_completion');
    expect(item?.route).toBe('/(tabs)/profile?focus=pantry');
    expect(item?.body).toContain('3 details left');
  });

  it('uses the singular for one remaining detail', () => {
    const item = find(baseInput({ completeness: completeness(1) }), 'profile_completion');
    expect(item?.body).toContain('1 detail left');
  });

  it('honours the 3-day resurface window', () => {
    const input = baseInput({
      completeness: completeness(2),
      dismissed: { ...baseInput().dismissed, profileCompletion: true },
    });
    expect(find(input, 'profile_completion')).toBeUndefined();
  });

  /**
   * `computeCompleteness` has no weight field at all — a gap from when
   * onboarding could not finish without one. Left alone it told an owner to
   * "add a food to the pantry" while the health gate one tab away said the
   * blocker was the weight, and it could call a weightless pet accurate enough
   * to retire this prompt entirely.
   */
  describe('weight leads when it is missing', () => {
    it('asks for the weight rather than the pantry', () => {
      const item = find(
        baseInput({ currentWeightKg: 0, completeness: completeness(6) }),
        'profile_completion',
      );
      expect(item?.body).toContain('add a current weight');
      expect(item?.body).not.toContain('add a food to the pantry');
    });

    it('counts the weight among the details left', () => {
      const withWeight = find(
        baseInput({ currentWeightKg: 20, completeness: completeness(6) }),
        'profile_completion',
      );
      const without = find(
        baseInput({ currentWeightKg: 0, completeness: completeness(6) }),
        'profile_completion',
      );
      expect(withWeight?.body).toContain('6 details left');
      expect(without?.body).toContain('7 details left');
    });

    it('still shows the prompt when everything else is complete but weight is not', () => {
      const input = baseInput({
        currentWeightKg: 0,
        completeness: { score: 100, missing: [], isAccurateEnough: true },
      });
      const item = find(input, 'profile_completion');
      expect(item).toBeDefined();
      expect(item?.body).toContain('1 detail left');
      expect(item?.body).toContain('add a current weight');
    });

    it('retires the prompt once weight and everything else are present', () => {
      const input = baseInput({
        currentWeightKg: 20,
        completeness: { score: 100, missing: [], isAccurateEnough: true },
      });
      expect(find(input, 'profile_completion')).toBeUndefined();
    });

    it('deep-links to the body-check editor, the closest target weight has', () => {
      const item = find(
        baseInput({ currentWeightKg: 0, completeness: completeness(2) }),
        'profile_completion',
      );
      expect(item?.route).toBe('/(tabs)/profile?focus=bcs');
    });
  });
});

describe('up next', () => {
  const activity = (o: Partial<NonNullable<BannerInput['nextActivity']>> = {}) => ({
    id: 'act-1',
    activity_type: 'grooming',
    title: 'Relaxing Grooming Session',
    scheduled_time: '19:45:00',
    duration_minutes: 10,
    intensity: 'low',
    notes: null,
    ...o,
  });

  it('shows the scheduled time in the title and the shape below it', () => {
    const item = find(baseInput({ nextActivity: activity() }), 'up_next_act-1');
    expect(item?.title).toBe('Relaxing Grooming Session at 19:45');
    expect(item?.body).toBe('10 min · low');
  });

  it('drops the time cleanly when the activity has none', () => {
    const item = find(baseInput({ nextActivity: activity({ scheduled_time: null }) }), 'up_next_act-1');
    expect(item?.title).toBe('Relaxing Grooming Session');
  });

  it('falls back to notes, then to a type-specific line', () => {
    const withNotes = activity({ duration_minutes: null, intensity: null, notes: 'Brush the undercoat' });
    expect(find(baseInput({ nextActivity: withNotes }), 'up_next')?.body).toBe('Brush the undercoat');

    const bare = activity({ activity_type: 'water', duration_minutes: null, intensity: null, notes: null });
    expect(find(baseInput({ nextActivity: bare }), 'up_next')?.body).toBe('Hydration break');
  });

  it('sends a dog straight to tracking, and everything else to the plan', () => {
    const walk = activity({ activity_type: 'walk' });
    expect(find(baseInput({ nextActivity: walk, walkEnabled: true }), 'up_next')?.route).toBe('/walk');
    // A cat, or the flag off: the same walk row opens the plan instead.
    expect(find(baseInput({ nextActivity: walk, walkEnabled: false }), 'up_next')?.route).toBe('/(tabs)/activity');
    expect(find(baseInput({ nextActivity: activity() }), 'up_next')?.route).toBe('/(tabs)/activity');
  });

  it('carries the activity glyph the retired row used', () => {
    expect(find(baseInput({ nextActivity: activity({ activity_type: 'walk' }) }), 'up_next')?.icon)
      .toBe('directions-walk');
    expect(find(baseInput({ nextActivity: activity({ activity_type: 'reading' }) }), 'up_next')?.icon)
      .toBe('star');
  });

  it('is day-scoped and keyed on the activity, so a replanned day is a new item', () => {
    const id = find(baseInput({ nextActivity: activity() }), 'up_next')?.id;
    expect(id).toContain('act-1');
    expect(id).toContain('2026-08-18');
  });

  it('says nothing when the plan has nothing left today', () => {
    expect(find(baseInput({ nextActivity: null }), 'up_next')).toBeUndefined();
  });

  /**
   * The reported bug: a brand-new account was told about a "Relaxing Grooming
   * Session at 19:45" while the Activity tab it pointed at was gated shut behind
   * "Add a current weight".
   *
   * Plan rows outlive the profile that justified them — a schedule generated
   * before a weight was cleared, or on another device, leaves activities behind
   * a gate the owner still has to pass. So "a nextActivity exists" is not the
   * same question as "this owner has an activity plan".
   */
  it('stays silent when the Activity tab itself is gated', () => {
    const gated = baseInput({ nextActivity: activity(), activityPlanReady: false });
    expect(find(gated, 'up_next')).toBeUndefined();

    const open = baseInput({ nextActivity: activity(), activityPlanReady: true });
    expect(find(open, 'up_next')).toBeDefined();
  });
});

describe('pending check-in', () => {
  it('is keyed on the case so two open cases are two items', () => {
    const item = find(
      baseInput({ pendingCheckin: { questionId: 'q-7', reason: 'with the limping' } }),
      'vet_checkin_q-7',
    );
    expect(item?.route).toBe('/ask?case=q-7&mode=checkin');
    expect(item?.body).toContain('with the limping');
  });

  it('falls back to a plain question with no reason', () => {
    const item = find(baseInput({ pendingCheckin: { questionId: 'q-8', reason: null } }), 'vet_checkin_q-8');
    expect(item?.body).toBe('How is Bunny doing now?');
  });
});

describe('broken streak', () => {
  it('fires only when a streak existed and has lapsed', () => {
    expect(find(baseInput({ currentStreak: 0, longestStreak: 9 }), 'streak_broken')).toBeDefined();
    expect(find(baseInput({ currentStreak: 2, longestStreak: 9 }), 'streak_broken')).toBeUndefined();
    expect(find(baseInput({ currentStreak: 0, longestStreak: 0 }), 'streak_broken')).toBeUndefined();
  });
});

describe('pet scoping', () => {
  /**
   * Read and dismiss state is keyed on these ids. When they were pet-agnostic,
   * `banner:profile_completion:persistent` was the identical string for every
   * animal — so a card dismissed for one pet arrived pre-dismissed for the next,
   * whether that was a second pet in the household or a different account
   * entirely on the same device.
   */
  const withPet = (petId: string) =>
    buildBannerItems(baseInput({
      petId,
      bcs: 9,
      medicalConditions: ['diabetes'],
      species: 'cat',
      goal: 'lose',
      todayCalories: 0,
      hour: 15,
      ageMonths: 6,
      currentWeightKg: 20,
      targetWeightKg: 18,
      completeness: {
        score: 40,
        isAccurateEnough: false,
        missing: [{ key: 'breed', label: 'Add a breed', impact: 'high', weight: 9, focus: 'breed' }],
      },
    })).map(i => i.id);

  it('gives two different pets different ids for the same condition', () => {
    const a = withPet('pet-a');
    const b = withPet('pet-b');
    expect(a.length).toBeGreaterThan(0);
    expect(a).toHaveLength(b.length);
    // Not one id may be shared between two animals.
    expect(a.filter(id => b.includes(id))).toEqual([]);
  });

  it('carries the pet id on every pet-specific banner', () => {
    for (const id of withPet('pet-a')) {
      expect(id).toContain('pet-a');
    }
  });

  it('leaves account-level items unscoped', () => {
    // The trial and the streak belong to the owner, not the animal.
    const items = buildBannerItems(baseInput({
      petId: 'pet-a',
      subscriptionStatus: 'trial',
      trialDaysLeft: 2,
      currentStreak: 0,
      longestStreak: 9,
    }));
    const trial = items.find(i => i.id.includes('trial_ending'));
    const streak = items.find(i => i.id.includes('streak_broken'));
    expect(trial?.id).not.toContain('pet-a');
    expect(streak?.id).not.toContain('pet-a');
  });
});

describe('naming', () => {
  it('addresses the animal by name rather than "your pet"', () => {
    const input = baseInput({ bcs: 9, medicalConditions: ['diabetes'], completeness: {
      score: 50,
      isAccurateEnough: false,
      missing: [{ key: 'breed', label: 'Add a breed', impact: 'high', weight: 9, focus: 'breed' }],
    } });
    for (const item of buildBannerItems(input)) {
      expect(`${item.title} ${item.body}`.toLowerCase()).not.toContain('your pet');
    }
    expect(titles(input).some(t => t.includes('Bunny'))).toBe(true);
  });

  it('degrades to a neutral phrase when no name is set', () => {
    const items = buildBannerItems(baseInput({ petName: '', bcs: 9 }));
    expect(items[0].title).toContain('your companion');
  });
});
