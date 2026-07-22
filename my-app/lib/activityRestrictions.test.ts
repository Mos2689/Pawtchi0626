import {
  deriveActivityRestrictions,
  deriveActivityRestrictionLabels,
  maxAllowedIntensity,
} from './activityRestrictions';

describe('deriveActivityRestrictions', () => {
  test('no conditions → no restrictions', () => {
    expect(deriveActivityRestrictions([])).toEqual([]);
    expect(deriveActivityRestrictions(null)).toEqual([]);
    expect(deriveActivityRestrictions(undefined)).toEqual([]);
  });

  test('unmapped condition → no restrictions', () => {
    expect(deriveActivityRestrictions(['seasonal allergies'])).toEqual([]);
  });

  test('arthritis → moderate ceiling with legacy label', () => {
    const out = deriveActivityRestrictions(['Arthritis (mild)']);
    expect(out).toEqual([
      { label: 'no high-impact activities', maxIntensity: 'moderate' },
    ]);
  });

  test('matching is case-insensitive substring, like the legacy store map', () => {
    const out = deriveActivityRestrictions(['Diagnosed with IVDD in 2024']);
    expect(out).toHaveLength(1);
    expect(out[0].maxIntensity).toBe('low');
  });

  test('same condition listed twice → single restriction', () => {
    const out = deriveActivityRestrictions(['arthritis', 'early arthritis']);
    expect(out).toHaveLength(1);
  });

  test('labels helper matches the legacy usePetContextStore output shape', () => {
    expect(deriveActivityRestrictionLabels(['hip dysplasia', 'heart disease'])).toEqual([
      'no jumping or stairs',
      'limit vigorous exercise',
    ]);
  });
});

describe('maxAllowedIntensity', () => {
  test('empty → null (unrestricted)', () => {
    expect(maxAllowedIntensity([])).toBeNull();
  });

  test('single moderate restriction → moderate', () => {
    expect(maxAllowedIntensity(deriveActivityRestrictions(['arthritis']))).toBe('moderate');
  });

  test('tightest restriction wins', () => {
    const out = deriveActivityRestrictions(['arthritis', 'heart disease']);
    expect(maxAllowedIntensity(out)).toBe('low');
  });
});
