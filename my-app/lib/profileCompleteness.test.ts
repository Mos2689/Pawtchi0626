import { computeCompleteness, hasRealPhoto, CompletenessPet } from './profileCompleteness';

const fullPet: CompletenessPet = {
  image_url: 'https://cdn.pawtchi.com/avatars/bruno.jpg',
  breed: 'Staffordshire Bull Terrier',
  age_years: 3,
  body_condition_score: 5,
  gender: 'male',
  allergies: ['Chicken'],
  bowl_size: 'medium',
};

describe('hasRealPhoto', () => {
  test('rejects empty and stock unsplash URLs, accepts a real one', () => {
    expect(hasRealPhoto(null)).toBe(false);
    expect(hasRealPhoto('')).toBe(false);
    expect(hasRealPhoto('https://images.unsplash.com/photo-1583337130417-3346a1be7dee')).toBe(false);
    expect(hasRealPhoto('https://cdn.pawtchi.com/avatars/bruno.jpg')).toBe(true);
  });
});

describe('computeCompleteness', () => {
  test('null pet → 0%, everything missing, not accurate enough', () => {
    const r = computeCompleteness(null);
    expect(r.score).toBe(0);
    expect(r.isAccurateEnough).toBe(false);
    expect(r.missing.length).toBe(8);
  });

  test('fully filled pet (with pantry) → 100% and accurate enough', () => {
    const r = computeCompleteness(fullPet, { pantryCount: 2 });
    expect(r.score).toBe(100);
    expect(r.missing).toHaveLength(0);
    expect(r.isAccurateEnough).toBe(true);
  });

  test('all high-impact present but a med gap → accurate enough, score < 100', () => {
    const r = computeCompleteness(fullPet, { pantryCount: 0 }); // pantry (med) missing
    expect(r.isAccurateEnough).toBe(true);
    expect(r.score).toBeLessThan(100);
    expect(r.missing.map((m) => m.key)).toEqual(['pantry']);
  });

  test('missing high-impact fields → not accurate enough, high items listed first', () => {
    const pet: CompletenessPet = { ...fullPet, breed: null, body_condition_score: null, gender: null };
    const r = computeCompleteness(pet, { pantryCount: 1 });
    expect(r.isAccurateEnough).toBe(false);
    // high-impact (breed, bcs) must come before med (gender)
    const highKeys = r.missing.filter((m) => m.impact === 'high').map((m) => m.key);
    const firstMed = r.missing.findIndex((m) => m.impact === 'med');
    const lastHigh = r.missing.map((m) => m.impact).lastIndexOf('high');
    expect(highKeys.sort()).toEqual(['bcs', 'breed']);
    expect(lastHigh).toBeLessThan(firstMed);
  });

  test('stock photo counts as missing photo (high impact)', () => {
    const pet: CompletenessPet = { ...fullPet, image_url: 'https://images.unsplash.com/photo-x' };
    const r = computeCompleteness(pet, { pantryCount: 1 });
    expect(r.missing.some((m) => m.key === 'photo')).toBe(true);
    expect(r.isAccurateEnough).toBe(false);
  });

  test('empty allergies array counts as confirmed (present)', () => {
    const r = computeCompleteness({ ...fullPet, allergies: [] }, { pantryCount: 1 });
    expect(r.missing.some((m) => m.key === 'allergies')).toBe(false);
  });

  test('every missing item carries a focus key equal to its key', () => {
    const r = computeCompleteness({}, { pantryCount: 0 });
    for (const m of r.missing) expect(m.focus).toBe(m.key);
  });
});
