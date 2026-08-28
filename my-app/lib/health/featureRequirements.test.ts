import {
  checkFeature,
  isLightweightProfile,
  requirementsFor,
  type HealthFeature,
  type HealthProfilePet,
} from './featureRequirements';

const ALL_FEATURES: HealthFeature[] = [
  'meal_logging',
  'calorie_target',
  'weight_plan',
  'health_insights',
  'activity_plan',
];

/** What a dog looks like after the two-step walk-first onboarding. */
const lightweight: HealthProfilePet = {
  current_weight_kg: 0,
  age_years: 3,
  body_condition_score: null,
  is_neutered: null,
  activity_level: null,
  bowl_size: null,
};

/** What every pre-existing pet looks like — the full onboarding wrote all of it. */
const complete: HealthProfilePet = {
  current_weight_kg: 12.4,
  age_years: 3,
  body_condition_score: 5,
  is_neutered: true,
  activity_level: 'normal',
  bowl_size: 'medium',
};

describe('requirementsFor', () => {
  test('every feature declares at least one field', () => {
    for (const f of ALL_FEATURES) {
      expect(requirementsFor(f).length).toBeGreaterThan(0);
    }
  });

  test('never gates on anything the completion flow cannot collect', () => {
    // The loop guard. `pantry` is filled from inside the Meal tab and
    // `bowl_size` from the profile — gating on either means the owner can
    // never satisfy it, because the gate stands in front of the only place
    // that could. Regression test for exactly that deadlock.
    const collectable: string[] = ['age', 'bcs'];
    for (const f of ALL_FEATURES) {
      for (const key of requirementsFor(f)) {
        expect(collectable).toContain(key);
      }
    }
  });

  test('never gates on cosmetic fields', () => {
    for (const f of ALL_FEATURES) {
      expect(requirementsFor(f)).not.toContain('photo');
      expect(requirementsFor(f)).not.toContain('breed');
      expect(requirementsFor(f)).not.toContain('gender');
    }
  });
});

describe('checkFeature — existing users', () => {
  test('a complete profile is ready for everything, with nothing missing', () => {
    for (const f of ALL_FEATURES) {
      const result = checkFeature(f, complete, { pantryCount: 2 });
      expect(result.ready).toBe(true);
      expect(result.missing).toEqual([]);
    }
  });

  test('this is what guarantees no existing pet sees a gate', () => {
    // The migration safety property, asserted directly: every field the gate
    // reads was written by the old onboarding, so ready must be true with no
    // backfill of any kind.
    expect(checkFeature('meal_logging', complete, { pantryCount: 1 }).ready).toBe(true);
  });
});

describe('checkFeature — lightweight walk-first profile', () => {
  test('is not ready for any health feature', () => {
    for (const f of ALL_FEATURES) {
      expect(checkFeature(f, lightweight).ready).toBe(false);
    }
  });

  test('reports the missing weight first, because it is the most damaging gap', () => {
    const { missing } = checkFeature('calorie_target', lightweight);
    expect(missing[0].label).toBe('Add a current weight');
  });

  test('a zero weight counts as absent, not as a real measurement', () => {
    // createLightweightPet writes 0 as a sentinel; treating it as a value would
    // let calculateRER return a confident 0 kcal.
    const { ready } = checkFeature('calorie_target', { ...complete, current_weight_kg: 0 });
    expect(ready).toBe(false);
  });

  test('a negative or missing weight is equally absent', () => {
    expect(checkFeature('calorie_target', { ...complete, current_weight_kg: -1 }).ready).toBe(false);
    expect(checkFeature('calorie_target', { ...complete, current_weight_kg: null }).ready).toBe(false);
  });
});

describe('checkFeature — partial profiles', () => {
  test('an empty pantry and no bowl do not block the meal tab', () => {
    // The tab has to open so the owner can scan their first food into it.
    const pet = { ...complete, bowl_size: null };
    expect(checkFeature('meal_logging', pet, { pantryCount: 0 }).ready).toBe(true);
  });

  test('completing the health chain clears every gate', () => {
    // body-basics → energy → allergies → body-check → goal writes weight, age
    // and bcs. If a gate needed anything outside that set, the owner would
    // finish the flow and land back on the same card.
    const afterCompletion: HealthProfilePet = {
      current_weight_kg: 12.4,
      age_years: 3,
      body_condition_score: 5,
      is_neutered: true,
      activity_level: 'normal',
      bowl_size: null,
    };
    for (const f of ALL_FEATURES) {
      expect(checkFeature(f, afterCompletion, { pantryCount: 0 }).ready).toBe(true);
    }
  });

  test('activity planning survives a missing body score', () => {
    const pet = { ...complete, body_condition_score: null };
    expect(checkFeature('activity_plan', pet).ready).toBe(true);
    expect(checkFeature('weight_plan', pet).ready).toBe(false);
  });

  test('a missing age blocks everything that reasons about life stage', () => {
    const pet = { ...complete, age_years: null };
    for (const f of ALL_FEATURES) {
      expect(checkFeature(f, pet, { pantryCount: 2 }).ready).toBe(false);
    }
  });

  test('every missing item carries a deep-link target the profile screen knows', () => {
    const { missing } = checkFeature('meal_logging', lightweight, { pantryCount: 0 });
    for (const item of missing) {
      expect(item.focus).toBeTruthy();
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  test('does not report the same gap twice', () => {
    const { missing } = checkFeature('meal_logging', lightweight, { pantryCount: 0 });
    const labels = missing.map(m => m.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('checkFeature — no pet', () => {
  test('gates rather than flashing a zeroed health screen', () => {
    const result = checkFeature('meal_logging', null);
    expect(result.ready).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });
});

describe('isLightweightProfile', () => {
  test('separates never-started from part-way-through', () => {
    expect(isLightweightProfile(lightweight)).toBe(true);
    expect(isLightweightProfile(complete)).toBe(false);
    // Part-way: a weight has been given but the body check hasn't run.
    expect(isLightweightProfile({ ...lightweight, current_weight_kg: 12 })).toBe(false);
  });

  test('a missing pet reads as lightweight', () => {
    expect(isLightweightProfile(null)).toBe(true);
  });
});
