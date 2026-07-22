import {
  BcsCheckAnswers,
  bcsCheckQuestions,
  bcsPartialBand,
  fuseBcsSignals,
  needsTiebreaker,
  scoreBcsCheck,
} from './bcsCheck';
import type { BcsPhotoEstimateRaw, BcsSuggestionContext } from './bcsPhotoEstimate';

const ctx: BcsSuggestionContext = {
  species: 'dog',
  breed: null,
  sex: null,
  currentWeightKg: 20,
};

function photoRaw(low: number, high: number, confidence = 0.85): BcsPhotoEstimateRaw {
  return {
    pet_visible: true,
    full_body_visible: true,
    is_side_profile: true,
    is_standing: true,
    coat_length: 'short',
    photo_quality_issues: [],
    bcs_low: low,
    bcs_high: high,
    confidence,
    visual_indicators: ['visible waist tuck from above'],
    reasoning_short: 'test',
  };
}

describe('scoreBcsCheck — agreeing answers land in the right bucket', () => {
  const cases: { name: string; answers: BcsCheckAnswers; point: number; band: [number, number] }[] = [
    {
      name: 'lean-fit: visible ribs, clear waist/tuck, thin-but-covered bones → 4',
      answers: { rib: 'very_easy', waist: 'clear', tuck: 'clear', pad: 'bony' },
      point: 4,
      band: [3, 4],
    },
    {
      name: 'thin: visible ribs + sharply prominent bones → 3',
      answers: { rib: 'very_easy', waist: 'clear', tuck: 'clear', pad: 'prominent' },
      point: 3,
      band: [1, 3],
    },
    {
      name: 'ideal: light-pressure ribs, clear waist and tuck → 4',
      answers: { rib: 'light_pressure', waist: 'clear', tuck: 'clear' },
      point: 4,
      band: [4, 5],
    },
    {
      name: 'ideal-upper: light-pressure ribs, gentle curves → 5',
      answers: { rib: 'light_pressure', waist: 'slight', tuck: 'slight' },
      point: 5,
      band: [5, 5],
    },
    {
      name: 'slightly over: must press, gentle curves → 6',
      answers: { rib: 'must_press', waist: 'slight', tuck: 'slight' },
      point: 6,
      band: [6, 6],
    },
    {
      name: 'overweight: must press, no waist or tuck, soft pads → 7',
      answers: { rib: 'must_press', waist: 'round', tuck: 'none', pad: 'soft' },
      point: 7,
      band: [7, 7],
    },
    {
      name: 'severely obese: cannot feel ribs, round, obvious pads → 9',
      answers: { rib: 'cannot_feel', waist: 'round', tuck: 'none', pad: 'obvious' },
      point: 9,
      band: [8, 9],
    },
  ];

  it.each(cases)('$name', ({ answers, point, band }) => {
    const score = scoreBcsCheck(answers);
    expect(score.bcsPoint).toBe(point);
    expect([score.bcsLow, score.bcsHigh]).toEqual(band);
    expect(score.conflict).toBe(false);
    expect(Number.isInteger(score.bcsPoint)).toBe(true);
  });

  it('always returns an integer point inside 1–9 and inside the band', () => {
    const ribs: BcsCheckAnswers['rib'][] = ['very_easy', 'light_pressure', 'must_press', 'cannot_feel'];
    const waists: BcsCheckAnswers['waist'][] = ['clear', 'slight', 'round'];
    const tucks: BcsCheckAnswers['tuck'][] = ['clear', 'slight', 'none'];
    const pads: (BcsCheckAnswers['pad'] | undefined)[] = [undefined, 'prominent', 'bony', 'soft', 'obvious'];
    for (const rib of ribs) for (const waist of waists) for (const tuck of tucks) for (const pad of pads) {
      const s = scoreBcsCheck({ rib, waist, tuck, pad });
      expect(Number.isInteger(s.bcsPoint)).toBe(true);
      expect(s.bcsPoint).toBeGreaterThanOrEqual(1);
      expect(s.bcsPoint).toBeLessThanOrEqual(9);
      expect(s.bcsLow).toBeLessThanOrEqual(s.bcsHigh);
      expect(s.bcsPoint).toBeGreaterThanOrEqual(s.bcsLow - 1);
      expect(s.bcsPoint).toBeLessThanOrEqual(s.bcsHigh + 1);
    }
  });
});

describe('severe boundary (drives the vet gate at BCS ≥ 8)', () => {
  it('must-press ribs with obvious pads stays out of 9 but reaches 8', () => {
    const s = scoreBcsCheck({ rib: 'must_press', waist: 'round', tuck: 'none', pad: 'obvious' });
    expect(s.bcsPoint).toBe(8);
  });

  it('overweight-but-not-obese resolves to 7, below the gate', () => {
    const s = scoreBcsCheck({ rib: 'must_press', waist: 'round', tuck: 'none', pad: 'soft' });
    expect(s.bcsPoint).toBe(7);
    expect(s.conflict).toBe(false);
  });
});

describe('tiebreaker triggering', () => {
  it('asks Q4 at the heavy end even without conflict', () => {
    expect(needsTiebreaker({ rib: 'must_press', waist: 'round', tuck: 'none' })).toBe(true);
    expect(needsTiebreaker({ rib: 'cannot_feel', waist: 'round', tuck: 'none' })).toBe(true);
  });

  it('asks Q4 on a very-easy rib read (thin vs lean-fit)', () => {
    expect(needsTiebreaker({ rib: 'very_easy', waist: 'clear', tuck: 'clear' })).toBe(true);
  });

  it('asks Q4 on conflicting answers', () => {
    expect(needsTiebreaker({ rib: 'cannot_feel', waist: 'clear', tuck: 'clear' })).toBe(true);
  });

  it('does not ask Q4 for a clean mid-range read', () => {
    expect(needsTiebreaker({ rib: 'light_pressure', waist: 'slight', tuck: 'slight' })).toBe(false);
    expect(needsTiebreaker({ rib: 'must_press', waist: 'slight', tuck: 'slight' })).toBe(false);
  });

  it('score mirrors the trigger via needsTiebreaker until Q4 is answered', () => {
    const before = scoreBcsCheck({ rib: 'cannot_feel', waist: 'round', tuck: 'none' });
    expect(before.needsTiebreaker).toBe(true);
    const after = scoreBcsCheck({ rib: 'cannot_feel', waist: 'round', tuck: 'none', pad: 'obvious' });
    expect(after.needsTiebreaker).toBe(false);
    expect(after.tiebreakerUsed).toBe(true);
  });
});

describe('conflict handling', () => {
  it('unresolvable answers stay flagged, anchored near the rib read, with a widened band', () => {
    // "Can't feel ribs" but clear waist and tuck — classic long-coat confusion.
    const s = scoreBcsCheck({ rib: 'cannot_feel', waist: 'clear', tuck: 'clear', pad: 'soft' });
    expect(s.conflict).toBe(true);
    expect(s.coreConflict).toBe(true);
    expect(s.bcsHigh - s.bcsLow).toBeGreaterThanOrEqual(2);
    expect(s.bcsPoint).toBeGreaterThanOrEqual(6);
  });

  it('agreeing touch signals resolve a visual conflict (coat fools eyes, not hands)', () => {
    // Waist and tuck contradict each other; rib + pad agree on over-conditioned.
    const s = scoreBcsCheck({ rib: 'must_press', waist: 'round', tuck: 'clear', pad: 'soft' });
    expect(s.conflict).toBe(false);
    expect(s.coreConflict).toBe(true);
    expect(s.bcsPoint).toBe(6);
    expect([s.bcsLow, s.bcsHigh]).toEqual([6, 7]);
  });

  it('a resolved core conflict lands the fusion tier at solid, not vet_grade', () => {
    const s = scoreBcsCheck({ rib: 'must_press', waist: 'round', tuck: 'clear', pad: 'soft' });
    const fusedNoPhoto = fuseBcsSignals(s, null, ctx);
    expect(fusedNoPhoto.tier).toBe('solid');
  });
});

describe('fuseBcsSignals', () => {
  it('no photo → questionnaire stands, vet_grade when clean', () => {
    const check = scoreBcsCheck({ rib: 'light_pressure', waist: 'slight', tuck: 'slight' });
    const fused = fuseBcsSignals(check, null, ctx);
    expect(fused.bcs).toBe(5);
    expect(fused.tier).toBe('vet_grade');
    expect(fused.photoAgreement).toBe('none');
  });

  it('overlapping photo band narrows the result and keeps vet_grade', () => {
    const check = scoreBcsCheck({ rib: 'light_pressure', waist: 'clear', tuck: 'clear' }); // band [4,5], point 4
    const fused = fuseBcsSignals(check, photoRaw(4, 4), ctx);
    expect(fused.bcsLow).toBe(4);
    expect(fused.bcsHigh).toBe(4);
    expect(fused.bcs).toBe(4);
    expect(fused.photoAgreement).toBe('agree');
    expect(fused.tier).toBe('vet_grade');
  });

  it('disjoint photo band loses to palpation and drops the tier to solid', () => {
    const check = scoreBcsCheck({ rib: 'light_pressure', waist: 'clear', tuck: 'clear' });
    const fused = fuseBcsSignals(check, photoRaw(7, 8), ctx);
    expect(fused.bcs).toBe(check.bcsPoint);
    expect(fused.bcsLow).toBe(check.bcsLow);
    expect(fused.photoAgreement).toBe('disagree');
    expect(fused.tier).toBe('solid');
  });

  it('a photo suppressed by its own gating counts as absent', () => {
    const check = scoreBcsCheck({ rib: 'light_pressure', waist: 'slight', tuck: 'slight' });
    const fused = fuseBcsSignals(check, photoRaw(4, 5, 0.3), ctx); // below MIN_SUGGESTION_CONFIDENCE
    expect(fused.photoAgreement).toBe('none');
    expect(fused.tier).toBe('vet_grade');
  });

  it('a persistent conflict is rough regardless of the photo', () => {
    const check = scoreBcsCheck({ rib: 'cannot_feel', waist: 'clear', tuck: 'clear', pad: 'soft' });
    const fused = fuseBcsSignals(check, photoRaw(4, 5), ctx);
    expect(fused.tier).toBe('rough');
  });
});

describe('bcsPartialBand (live spectrum)', () => {
  it('narrows monotonically through an agreeing flow', () => {
    expect(bcsPartialBand({})).toEqual({ lo: 1, hi: 9 });
    expect(bcsPartialBand({ rib: 'light_pressure' })).toEqual({ lo: 4, hi: 5 });
    expect(bcsPartialBand({ rib: 'light_pressure', waist: 'slight' })).toEqual({ lo: 5, hi: 5 });
  });

  it('falls back to a rib-anchored envelope on contradiction', () => {
    expect(bcsPartialBand({ rib: 'cannot_feel', waist: 'clear' })).toEqual({ lo: 7, hi: 9 });
  });
});

describe('bcsCheckQuestions copy', () => {
  it('cat tuck hint explains the primordial pouch; dog hint does not', () => {
    const cat = bcsCheckQuestions('cat', 'Momo').find((q) => q.id === 'tuck')!;
    const dog = bcsCheckQuestions('dog', 'Rex').find((q) => q.id === 'tuck')!;
    expect(cat.hint.toLowerCase()).toContain('pouch');
    expect(dog.hint.toLowerCase()).not.toContain('pouch');
  });

  it('uses the pet name and offers 4/3/3/4 options', () => {
    const qs = bcsCheckQuestions('dog', 'Rex');
    expect(qs.map((q) => q.options.length)).toEqual([4, 3, 3, 4]);
    expect(qs[0].title).toContain('Rex');
  });
});
