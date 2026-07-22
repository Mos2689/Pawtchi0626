import { getAgeMonths, deriveLifeStage, getLifeStageCalorieMultiplier } from './lifeStage';

describe('getAgeMonths — canonical age extractor', () => {
  test('returns age_months when present and valid', () => {
    expect(getAgeMonths({ age_months: 3 })).toBe(3);
    expect(getAgeMonths({ age_months: 0 })).toBe(0);
  });

  test('falls back to age_years × 12 when age_months is missing', () => {
    expect(getAgeMonths({ age_years: 0.25 })).toBe(3);
    expect(getAgeMonths({ age_years: 5 })).toBe(60);
  });

  test('returns 0 (not undefined) for newborn age_years=0', () => {
    // The bug we are protecting against: ad-hoc `age_years ? x : undefined`
    // treated a 0-year-old (newborn) as unknown and dropped through to the
    // adult MER multiplier. The canonical helper must return 0 here.
    expect(getAgeMonths({ age_years: 0 })).toBe(0);
  });

  test('age_months takes precedence over age_years', () => {
    expect(getAgeMonths({ age_months: 6, age_years: 2 })).toBe(6);
  });

  test('returns undefined when both inputs missing', () => {
    expect(getAgeMonths({})).toBeUndefined();
    expect(getAgeMonths({ age_months: null, age_years: null })).toBeUndefined();
  });

  test('returns undefined for invalid inputs', () => {
    expect(getAgeMonths({ age_months: NaN })).toBeUndefined();
    expect(getAgeMonths({ age_years: -1 })).toBeUndefined();
    expect(getAgeMonths({ age_months: Infinity })).toBeUndefined();
  });

  test('rounds decimal age_years cleanly', () => {
    // 0.333 years = ~4 months; should round, not truncate.
    expect(getAgeMonths({ age_years: 0.333 })).toBe(4);
  });
});

describe('deriveLifeStage smoke check', () => {
  test('3-month puppy across sizes is "puppy"', () => {
    expect(deriveLifeStage('dog', 0, 3, 'small')).toBe('puppy');
    expect(deriveLifeStage('dog', 0, 3, 'large')).toBe('puppy');
  });
});

describe('getLifeStageCalorieMultiplier — species split', () => {
  test('dog geriatric drops to 0.80', () => {
    expect(getLifeStageCalorieMultiplier('geriatric', 'dog')).toBe(0.80);
  });

  test('cat geriatric is ABOVE adult baseline (reduced digestibility, lean loss)', () => {
    // Geriatric cats need MORE calories per kg, not fewer. A blanket 0.80×
    // multiplier for cats would push them into unintended weight loss.
    expect(getLifeStageCalorieMultiplier('geriatric', 'cat')).toBeGreaterThanOrEqual(1.0);
  });

  test('cat mature/senior stay at 1.0', () => {
    expect(getLifeStageCalorieMultiplier('mature', 'cat')).toBe(1.0);
    expect(getLifeStageCalorieMultiplier('senior', 'cat')).toBe(1.0);
  });

  test('default species is dog for backward compatibility', () => {
    expect(getLifeStageCalorieMultiplier('geriatric')).toBe(0.80);
  });
});
