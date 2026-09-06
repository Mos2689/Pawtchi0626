import {
  CREATOR_CODE_MAX_LENGTH,
  isPlausibleCreatorCode,
  normalizeCreatorCode,
} from './normalize';

describe('normalizeCreatorCode', () => {
  test('upper-cases', () => {
    expect(normalizeCreatorCode('sarahk')).toBe('SARAHK');
  });

  test('the ways a heard code gets typed all collapse to one code', () => {
    // The failure this prevents: a creator says their code out loud, and four
    // viewers type four different strings that are all obviously the same code.
    for (const typed of ['sarahk', 'SARAH K', 'sarah-k', 'Sarah_K', ' sarahk. ']) {
      expect(normalizeCreatorCode(typed)).toBe('SARAHK');
    }
  });

  test('keeps digits', () => {
    expect(normalizeCreatorCode('walk2earn')).toBe('WALK2EARN');
  });

  test('null, undefined and blank are the empty string, not a throw', () => {
    expect(normalizeCreatorCode(null)).toBe('');
    expect(normalizeCreatorCode(undefined)).toBe('');
    expect(normalizeCreatorCode('   ')).toBe('');
  });

  test('drops emoji and accented characters rather than mangling them', () => {
    expect(normalizeCreatorCode('sar🐾ah')).toBe('SARAH');
    expect(normalizeCreatorCode('sarahé')).toBe('SARAH');
  });
});

describe('isPlausibleCreatorCode', () => {
  test('accepts codes inside the database CHECK bounds', () => {
    expect(isPlausibleCreatorCode('abc')).toBe(true);
    expect(isPlausibleCreatorCode('SARAHK')).toBe(true);
    expect(isPlausibleCreatorCode('a'.repeat(CREATOR_CODE_MAX_LENGTH))).toBe(true);
  });

  test('rejects what the CHECK would reject anyway', () => {
    expect(isPlausibleCreatorCode('')).toBe(false);
    expect(isPlausibleCreatorCode('ab')).toBe(false);
    expect(isPlausibleCreatorCode('a'.repeat(CREATOR_CODE_MAX_LENGTH + 1))).toBe(false);
  });

  test('judges the normalised form, not the raw input', () => {
    // "s-k" is three characters typed and two characters of code.
    expect(isPlausibleCreatorCode('s-k')).toBe(false);
    // Punctuation should not push a valid code over the limit.
    expect(isPlausibleCreatorCode('sarah-k')).toBe(true);
  });
});
