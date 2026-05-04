import { computeHealthScore, HEALTH_SCORE_VERSION } from './healthScore';

const baseDog = {
  species: 'dog' as const,
  daily_kcal_target: 1000,
  allergies: [],
  medical_conditions: [],
  weight_kg: 25,
  target_weight_kg: 25,
};

const baseFood = {
  is_treat: false,
  is_allergy_trigger: false,
  allergy_warnings: [],
  ingredients_of_concern: [],
  calories_per_serving: 200,
  protein_pct: 26,
  fat_pct: 14,
  fibre_pct: 3,
  confidence: 0.9,
};

describe('computeHealthScore — happy path', () => {
  test('clean kibble for a healthy dog scores high', () => {
    const result = computeHealthScore({ food: baseFood, pet: baseDog });
    expect(result.score).toBeGreaterThanOrEqual(8);
    expect(result.version).toBe(HEALTH_SCORE_VERSION);
    expect(result.reasons.length).toBe(0);
  });

  test('result is always a 1–10 integer', () => {
    const result = computeHealthScore({ food: baseFood, pet: baseDog });
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
  });
});

describe('computeHealthScore — safety deductions', () => {
  test('allergy trigger drops score by 6', () => {
    const result = computeHealthScore({
      food: { ...baseFood, is_allergy_trigger: true },
      pet: baseDog,
    });
    expect(result.score).toBeLessThanOrEqual(4);
    expect(result.reasons.some(r => r.toLowerCase().includes('allerg'))).toBe(true);
  });

  test('ingredients of concern stack up to a -3 cap', () => {
    const result = computeHealthScore({
      food: { ...baseFood, ingredients_of_concern: ['xylitol', 'onion', 'garlic', 'chocolate'] },
      pet: baseDog,
    });
    expect(result.score).toBe(7); // 10 - 3
  });
});

describe('computeHealthScore — weight-loss context', () => {
  test('treats during weight loss take a small extra ding', () => {
    const losingDog = {
      ...baseDog,
      weight_kg: 30,
      target_weight_kg: 25,
    };
    const treat = { ...baseFood, is_treat: true, calories_per_serving: 50 };
    const stableResult = computeHealthScore({ food: treat, pet: baseDog });
    const losingResult = computeHealthScore({ food: treat, pet: losingDog });
    expect(losingResult.score).toBeLessThan(stableResult.score);
  });

  test('oversize meal (>25% of daily target) gets a -2', () => {
    const huge = { ...baseFood, calories_per_serving: 400 }; // 40% of 1000
    const result = computeHealthScore({ food: huge, pet: baseDog });
    expect(result.reasons.some(r => r.includes('daily kcal target'))).toBe(true);
  });
});

describe('computeHealthScore — pancreatitis fat cap', () => {
  test('high-fat food on pancreatitis pet drops score', () => {
    const pancreasDog = { ...baseDog, medical_conditions: ['Pancreatitis history'] };
    const fatty = { ...baseFood, fat_pct: 22 };
    const result = computeHealthScore({ food: fatty, pet: pancreasDog });
    expect(result.score).toBeLessThan(8);
    expect(result.reasons.some(r => r.toLowerCase().includes('pancreatitis'))).toBe(true);
  });

  test('same fat level on healthy pet does NOT trigger pancreatitis ding', () => {
    const fatty = { ...baseFood, fat_pct: 22 };
    const result = computeHealthScore({ food: fatty, pet: baseDog });
    expect(result.reasons.some(r => r.toLowerCase().includes('pancreatitis'))).toBe(false);
  });
});

describe('computeHealthScore — protein floor', () => {
  test('cat food with low protein dings score', () => {
    const baseCat = { ...baseDog, species: 'cat' as const };
    const lowProtein = { ...baseFood, protein_pct: 18 };
    const result = computeHealthScore({ food: lowProtein, pet: baseCat });
    expect(result.score).toBeLessThan(10);
  });

  test('treats are not held to AAFCO protein floor', () => {
    const treat = { ...baseFood, is_treat: true, protein_pct: 5 };
    const result = computeHealthScore({ food: treat, pet: baseDog });
    expect(result.reasons.some(r => r.toLowerCase().includes('protein'))).toBe(false);
  });
});

describe('computeHealthScore — confidence cap', () => {
  test('low-confidence extraction caps high scores at 6', () => {
    const result = computeHealthScore({
      food: { ...baseFood, confidence: 0.3 },
      pet: baseDog,
    });
    expect(result.score).toBeLessThanOrEqual(6);
    expect(result.reasons.some(r => r.toLowerCase().includes('label'))).toBe(true);
  });

  test('low confidence does not lift an already-low score', () => {
    const result = computeHealthScore({
      food: { ...baseFood, is_allergy_trigger: true, confidence: 0.2 },
      pet: baseDog,
    });
    expect(result.score).toBeLessThan(6);
  });
});

describe('computeHealthScore — determinism', () => {
  test('same inputs produce identical outputs across many calls', () => {
    const inputs = { food: baseFood, pet: baseDog };
    const a = computeHealthScore(inputs);
    const b = computeHealthScore(inputs);
    const c = computeHealthScore(inputs);
    expect(a.score).toBe(b.score);
    expect(b.score).toBe(c.score);
    expect(a.reasons).toEqual(b.reasons);
  });
});
