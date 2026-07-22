import { getBreedWatchOuts } from './breedWatchOuts';

// Banned words from the locked Pawtchi Copy Spec v1 (brand book §6.04).
const BANNED_WORDS = [
  'immediately', 'urgent', 'ensure', 'incredible', 'amazing',
  'superstar', 'alert', "don't forget", 'ai-powered',
];

function sentenceCount(text: string): number {
  const matches = text.match(/[.?]+/g);
  return matches ? matches.length : 0;
}

function assertBrandVoice(text: string) {
  expect(text).not.toContain('!');
  expect(text.toLowerCase()).not.toContain('your pet');
  expect(text.toLowerCase()).not.toContain('your dog');
  expect(text.toLowerCase()).not.toContain('your cat');
  for (const word of BANNED_WORDS) {
    expect(text.toLowerCase()).not.toContain(word);
  }
  // ≤ 3 sentences.
  expect(sentenceCount(text)).toBeLessThanOrEqual(3);
}

describe('getBreedWatchOuts', () => {
  test('returns 2–3 brand-voice-compliant lines for a typical adult dog', () => {
    const out = getBreedWatchOuts({
      species: 'dog',
      breed: 'Labrador Retriever',
      sizeCategory: 'large',
      lifeStage: 'adult',
      bcs: 6,
      weightVsTargetKg: 0,
    });
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.length).toBeLessThanOrEqual(3);
    for (const w of out) {
      assertBrandVoice(w.text);
      expect(w.icon).toBeTruthy();
    }
  });

  test('adult Labrador advice mentions portioning / measuring', () => {
    const out = getBreedWatchOuts({
      species: 'dog',
      breed: 'Labrador Retriever',
      sizeCategory: 'large',
      lifeStage: 'adult',
      bcs: 5,
      weightVsTargetKg: 0,
    });
    const joined = out.map((w) => w.text).join(' ').toLowerCase();
    expect(joined).toMatch(/measure|plate|meal/);
  });

  test('cats always get a hydration or dental cue', () => {
    const out = getBreedWatchOuts({
      species: 'cat',
      breed: null,
      sizeCategory: null,
      lifeStage: 'adult',
      bcs: 5,
      weightVsTargetKg: 0,
    });
    expect(out.length).toBeGreaterThanOrEqual(2);
    const joined = out.map((w) => w.text).join(' ').toLowerCase();
    expect(joined).toMatch(/water|drink|tartar|dental|toothbrush/);
    for (const w of out) assertBrandVoice(w.text);
  });

  test('senior small dog includes a joint-aware line', () => {
    const out = getBreedWatchOuts({
      species: 'dog',
      breed: 'Yorkshire Terrier',
      sizeCategory: 'small',
      lifeStage: 'senior',
      bcs: 5,
      weightVsTargetKg: 0,
    });
    const joined = out.map((w) => w.text).join(' ').toLowerCase();
    expect(joined).toMatch(/joint|gentle|shorter/);
    for (const w of out) assertBrandVoice(w.text);
  });

  test('high BCS triggers portion guidance ahead of breed traits', () => {
    const out = getBreedWatchOuts({
      species: 'dog',
      breed: 'Labrador Retriever',
      sizeCategory: 'large',
      lifeStage: 'adult',
      bcs: 8,
      weightVsTargetKg: 2.5,
    });
    expect(out[0].icon).toMatch(/restaurant|directions-walk/);
    const joined = out.map((w) => w.text).join(' ').toLowerCase();
    expect(joined).toMatch(/ideal range|daily plate|steady/);
  });

  test('missing breed still returns useful size + life-stage lines', () => {
    const out = getBreedWatchOuts({
      species: 'dog',
      breed: null,
      sizeCategory: 'large',
      lifeStage: 'puppy',
      bcs: null,
      weightVsTargetKg: null,
    });
    expect(out.length).toBeGreaterThanOrEqual(1);
    for (const w of out) assertBrandVoice(w.text);
  });

  test('deduplicates and never returns more than 3', () => {
    const out = getBreedWatchOuts({
      species: 'dog',
      breed: 'Labrador Retriever',
      sizeCategory: 'large',
      lifeStage: 'senior',
      bcs: 8,
      weightVsTargetKg: 3,
    });
    expect(out.length).toBeLessThanOrEqual(3);
    const texts = out.map((w) => w.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  describe('Brachycephalic + overweight nudge', () => {
    test('Frenchie at 15 kg (~115% of upper breed reference 13) with BCS 5 → flat-faced nudge fires', () => {
      const out = getBreedWatchOuts({
        species: 'dog',
        breed: 'French Bulldog',
        sizeCategory: 'small',
        lifeStage: 'adult',
        bcs: 5,
        weightVsTargetKg: 0,
        currentWeightKg: 15,
      });
      const joined = out.map((w) => w.text).join(' ').toLowerCase();
      expect(joined).toContain('flat-faced');
    });

    test('Frenchie at 12 kg (within breed range) → no flat-faced nudge', () => {
      const out = getBreedWatchOuts({
        species: 'dog',
        breed: 'French Bulldog',
        sizeCategory: 'small',
        lifeStage: 'adult',
        bcs: 5,
        weightVsTargetKg: 0,
        currentWeightKg: 12,
      });
      const joined = out.map((w) => w.text).join(' ').toLowerCase();
      expect(joined).not.toContain('flat-faced');
    });

    test('Labrador at 40 kg → no flat-faced nudge (not brachycephalic)', () => {
      const out = getBreedWatchOuts({
        species: 'dog',
        breed: 'Labrador Retriever',
        sizeCategory: 'large',
        lifeStage: 'adult',
        bcs: 5,
        weightVsTargetKg: 0,
        currentWeightKg: 40,
      });
      const joined = out.map((w) => w.text).join(' ').toLowerCase();
      expect(joined).not.toContain('flat-faced');
    });
  });
});
