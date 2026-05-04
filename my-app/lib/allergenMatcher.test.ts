import { detectAllergens } from './allergenMatcher';

describe('detectAllergens', () => {
  it('flags chicken in food name (BlackHawk Adult Chicken & Vegetables)', () => {
    const result = detectAllergens(
      ['BlackHawk Adult Chicken & Vegetables in Broth'],
      ['Chicken'],
      'Bruno',
    );
    expect(result.isMatch).toBe(true);
    expect(result.matchedAllergens).toEqual(['chicken']);
    expect(result.warnings[0]).toBe("Contains Chicken, which is on Bruno's allergen list");
  });

  it('flags chicken in ingredients ("chicken meal", "chicken broth")', () => {
    const result = detectAllergens(
      ['Generic Wet Food', 'chicken meal', 'chicken broth', 'rice'],
      ['Chicken'],
    );
    expect(result.isMatch).toBe(true);
    expect(result.matchedAllergens).toEqual(['chicken']);
  });

  it('does NOT match "veggie" against "egg" (word-boundary check)', () => {
    const result = detectAllergens(
      ['Veggie Bowl', 'sweet potato'],
      ['egg'],
    );
    expect(result.isMatch).toBe(false);
  });

  it('matches multiple allergens in one food', () => {
    const result = detectAllergens(
      ['Beef and Chicken Stew', 'beef chunks', 'chicken liver'],
      ['Beef', 'Chicken'],
    );
    expect(result.isMatch).toBe(true);
    expect(result.matchedAllergens.sort()).toEqual(['beef', 'chicken']);
    expect(result.warnings).toHaveLength(2);
  });

  it('returns no match when allergy list is empty', () => {
    const result = detectAllergens(
      ['BlackHawk Chicken'],
      [],
    );
    expect(result.isMatch).toBe(false);
  });

  it('returns no match when allergy list is null', () => {
    const result = detectAllergens(
      ['BlackHawk Chicken'],
      null,
    );
    expect(result.isMatch).toBe(false);
  });

  it('handles null/undefined entries in sources gracefully', () => {
    const result = detectAllergens(
      [null, undefined, 'chicken broth', ''],
      ['Chicken'],
    );
    expect(result.isMatch).toBe(true);
  });

  it('is case-insensitive (CHICKEN vs chicken vs Chicken)', () => {
    const r1 = detectAllergens(['CHICKEN BROTH'], ['chicken']);
    const r2 = detectAllergens(['chicken broth'], ['CHICKEN']);
    const r3 = detectAllergens(['Chicken Broth'], ['Chicken']);
    expect(r1.isMatch).toBe(true);
    expect(r2.isMatch).toBe(true);
    expect(r3.isMatch).toBe(true);
  });

  it('warning omits pet name when not provided', () => {
    const result = detectAllergens(['chicken'], ['chicken']);
    expect(result.warnings[0]).toBe('Contains Chicken');
  });
});
