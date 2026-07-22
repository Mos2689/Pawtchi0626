import {
  estimateActivityBurn,
  computeWeeklyBurn,
  estimateMaintenanceKcal,
  computeDailyDeficitKcal,
} from './activityBurn';
import { calculateRER } from './healthMath';

describe('estimateActivityBurn', () => {
  test('30min moderate walk, 20kg dog → 3.0 kcal/kg/hr × 20 × 0.5h = 30 kcal', () => {
    expect(estimateActivityBurn('walk', 'moderate', 30, 20)).toBe(30);
  });

  test('high-intensity play burns more than low', () => {
    const high = estimateActivityBurn('play', 'high', 20, 10);
    const low = estimateActivityBurn('play', 'low', 20, 10);
    expect(high).toBeGreaterThan(low);
  });

  test('non-exercise types burn nothing', () => {
    expect(estimateActivityBurn('water', 'moderate', 30, 20)).toBe(0);
    expect(estimateActivityBurn('medicine', 'moderate', 30, 20)).toBe(0);
    expect(estimateActivityBurn('feeding', 'moderate', 30, 20)).toBe(0);
  });

  test('missing intensity defaults to moderate', () => {
    expect(estimateActivityBurn('walk', null, 30, 20)).toBe(
      estimateActivityBurn('walk', 'moderate', 30, 20),
    );
  });

  test('zero/absent duration or weight → 0', () => {
    expect(estimateActivityBurn('walk', 'moderate', 0, 20)).toBe(0);
    expect(estimateActivityBurn('walk', 'moderate', null, 20)).toBe(0);
    expect(estimateActivityBurn('walk', 'moderate', 30, 0)).toBe(0);
  });
});

describe('computeWeeklyBurn', () => {
  const rows = [
    { activity_type: 'walk', intensity: 'moderate', duration_minutes: 30, status: 'completed' }, // 30 kcal
    { activity_type: 'play', intensity: 'high', duration_minutes: 30, status: 'pending' },       // 60 kcal
    { activity_type: 'walk', intensity: 'moderate', duration_minutes: 30, status: 'skipped' },   // excluded
    { activity_type: 'water', intensity: null, duration_minutes: null, status: 'completed' },    // 0 kcal
  ];

  test('completed vs planned split, skipped excluded from planned', () => {
    const out = computeWeeklyBurn(rows, 20);
    expect(out.completedKcal).toBe(30);
    expect(out.plannedKcal).toBe(90); // completed + pending, no skipped
    expect(out.completedMinutes).toBe(30);
    expect(out.plannedMinutes).toBe(60);
  });

  test('empty rows → zeros', () => {
    expect(computeWeeklyBurn([], 20)).toEqual({
      completedKcal: 0, plannedKcal: 0, completedMinutes: 0, plannedMinutes: 0,
    });
  });

  test('kcal derives from active_minutes when present; minutes stay elapsed', () => {
    // The "131 stationary minutes" walk: 131 elapsed, 4 moving. The minute
    // tally reports the walk's length; the burn reports the movement.
    const rows = [
      {
        activity_type: 'walk',
        intensity: 'low',
        duration_minutes: 131,
        active_minutes: 4,
        status: 'completed',
      },
    ];
    const out = computeWeeklyBurn(rows, 20);
    // 1.5 kcal/kg/hr × 20kg × (4/60)h = 2 kcal — not 65.5.
    expect(out.completedKcal).toBe(2);
    expect(out.completedMinutes).toBe(131);
  });
});

describe('estimateMaintenanceKcal / computeDailyDeficitKcal', () => {
  const adultDog = {
    species: 'dog',
    current_weight_kg: 25,
    is_neutered: true,
    activity_level: 'normal',
    breed: null,
    age_years: 4,
  };

  test('adult neutered dog maintenance ≈ RER × 1.6', () => {
    // 4yr medium-sized (25kg mixed) dog is 'adult' → life-stage multiplier 1.0.
    expect(estimateMaintenanceKcal(adultDog)).toBe(Math.round(calculateRER(25) * 1.6));
  });

  test('deficit = maintenance − target when target is hypocaloric', () => {
    const maintenance = estimateMaintenanceKcal(adultDog);
    const pet = { ...adultDog, target_daily_calories: maintenance - 200 };
    expect(computeDailyDeficitKcal(pet)).toBe(200);
  });

  test('deficit is 0 for maintenance/gain targets (never negative)', () => {
    const maintenance = estimateMaintenanceKcal(adultDog);
    expect(computeDailyDeficitKcal({ ...adultDog, target_daily_calories: maintenance })).toBe(0);
    expect(computeDailyDeficitKcal({ ...adultDog, target_daily_calories: maintenance + 300 })).toBe(0);
  });

  test('deficit is 0 when no target is set', () => {
    expect(computeDailyDeficitKcal({ ...adultDog, target_daily_calories: null })).toBe(0);
    expect(computeDailyDeficitKcal({ ...adultDog, target_daily_calories: 0 })).toBe(0);
  });

  test('missing weight → 0 maintenance and 0 deficit', () => {
    expect(estimateMaintenanceKcal({ species: 'dog', current_weight_kg: null })).toBe(0);
  });
});
