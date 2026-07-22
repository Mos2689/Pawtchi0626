import {
  estimateIdealWeight,
  getBreedBand,
  adultAgeMonths,
  computeSliderBounds,
  activitySuggestion,
  stageCount,
} from './idealWeight';

const adultLab = { ageMonths: 6 * 12 + 2 }; // 6.17y — the originally reported test case

describe('estimateIdealWeight — reported case (8 kg adult male Lab)', () => {
  // Design principle under test: the weight is a MEASUREMENT, never an error.
  // The estimator must accept it, classify the pet, and produce a safe plan —
  // and must NEVER endorse 8 kg as the ideal for an adult Labrador.
  test('BCS 5 ("just right") → recovery plan, not a block, and never 8 kg ideal', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: adultLab.ageMonths, currentWeightKg: 8, bcs: 5,
    });
    expect(r.mode).toBe('ok');
    expect(r.classification).toBe('underweight');
    expect(r.severity).toBe('severe');
    expect(r.confidence).toBe('low');
    expect(r.advisory).toMatch(/Labrador/);
    // Final ideal clamps to the low edge of the healthy band (23.2 → 23 rounded)
    expect(r.finalIdealKg).toBe(23);
    // First actionable target is staged: +12% of current, not a 190% jump
    expect(r.staged).toBe(true);
    expect(r.targetKg).toBe(9);
    // The one thing that must never happen:
    expect(r.finalIdealKg).not.toBe(8);
    expect(r.targetKg).not.toBe(8);
  });

  test('BCS 3 ("a bit thin") → same recovery path', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: adultLab.ageMonths, currentWeightKg: 8, bcs: 3,
    });
    expect(r.mode).toBe('ok');
    expect(r.classification).toBe('underweight');
    expect(r.severity).toBe('severe');
    expect(r.staged).toBe(true);
    expect(r.targetKg).toBe(9);
    expect(r.finalIdealKg).toBe(23);
    expect(r.advisory).toBeTruthy();
  });
});

describe('estimateIdealWeight — obese cases produce loss plans', () => {
  test('48 kg male Lab BCS 8 → obese, severe, staged loss target ~42 kg', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: adultLab.ageMonths, currentWeightKg: 48, bcs: 8,
    });
    expect(r.mode).toBe('ok');
    expect(r.classification).toBe('obese');
    expect(r.severity).toBe('severe');
    expect(r.staged).toBe(true);
    expect(r.targetKg).toBe(42); // 48 × 0.88
    expect(r.finalIdealKg).toBe(37); // 48 / 1.3, in band
    expect(r.confidence).toBe('high');
    expect(r.advisory).toBeNull();
  });

  test('60 kg male Lab BCS 5 (owner under-scored) → scale overrides: obese, clamped target', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: adultLab.ageMonths, currentWeightKg: 60, bcs: 5,
    });
    expect(r.classification).toBe('obese'); // 60 > band.high × 1.25
    expect(r.severity).toBe('severe');
    expect(r.finalIdealKg).toBe(43); // clamped to band.high 43.2
    expect(r.staged).toBe(true);
    expect(r.targetKg).toBe(53); // 60 × 0.88 = 52.8 → 53
    expect(r.advisory).toMatch(/above the typical/i);
  });

  test('45 kg male Lab BCS 9 → staged first target, not full 28% jump', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: adultLab.ageMonths, currentWeightKg: 45, bcs: 9,
    });
    expect(r.staged).toBe(true);
    expect(r.targetKg).toBe(39.5); // 45 × 0.88 = 39.6
    expect(r.bcsEstimate).toBe(32); // 45 / 1.4
    expect(r.classification).toBe('obese');
    expect(r.severity).toBe('severe');
  });
});

describe('estimateIdealWeight — normal-range happy paths', () => {
  test('32 kg male Lab BCS 5 → maintain at 32, no banner material', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: adultLab.ageMonths, currentWeightKg: 32, bcs: 5,
    });
    expect(r.mode).toBe('ok');
    expect(r.targetKg).toBe(32);
    expect(r.finalIdealKg).toBe(32);
    expect(r.staged).toBeFalsy();
    expect(r.classification).toBe('ideal');
    expect(r.severity).toBe('none');
    expect(r.advisory).toBeNull();
    expect(r.confidence).toBe('high');
    expect(r.estimatedWeeks).toBe(0);
  });

  test('40 kg male Lab BCS 7 → overweight, staged (16.7% > 12% cap)', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: adultLab.ageMonths, currentWeightKg: 40, bcs: 7,
    });
    expect(r.classification).toBe('overweight');
    expect(r.severity).toBe('none');
    expect(r.staged).toBe(true);
    expect(r.targetKg).toBe(35); // 40 × 0.88 = 35.2
    expect(r.finalIdealKg).toBe(33.5);
  });

  test('34 kg male Lab BCS 6 → single-step (~9% below staging cap)', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: adultLab.ageMonths, currentWeightKg: 34, bcs: 6,
    });
    expect(r.staged).toBeFalsy();
    expect(r.targetKg).toBeGreaterThanOrEqual(30.5);
    expect(r.targetKg).toBeLessThanOrEqual(31);
  });

  test('26 kg Lab BCS 3 → staged gain (+12% first step toward 32.5)', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: adultLab.ageMonths, currentWeightKg: 26, bcs: 3,
    });
    expect(r.classification).toBe('underweight');
    expect(r.severity).toBe('none'); // above band.low — mild, not severe
    expect(r.staged).toBe(true);
    expect(r.targetKg).toBe(29); // 26 × 1.12 = 29.12
    expect(r.finalIdealKg).toBe(32.5);
  });
});

describe('estimateIdealWeight — cats', () => {
  test('5 kg Bengal BCS 7 → staged loss, 0.1-kg precision', () => {
    const r = estimateIdealWeight({
      species: 'cat', breed: 'Bengal', sex: 'male',
      ageMonths: 4 * 12, currentWeightKg: 5, bcs: 7,
    });
    expect(r.staged).toBe(true);
    expect(r.targetKg).toBe(4.4); // 5 × 0.88
    expect(r.finalIdealKg).toBe(4.0); // 5 / 1.24
    expect(r.classification).toBe('overweight');
    expect(r.safeWeeklyPct).toBe(1.0); // cat-safe rate
    expect(r.estimatedWeeks).toBe(20);
  });

  test('4.5 kg Bengal BCS 6 → single-step to ~4.0', () => {
    const r = estimateIdealWeight({
      species: 'cat', breed: 'Bengal', sex: 'male',
      ageMonths: 4 * 12, currentWeightKg: 4.5, bcs: 6,
    });
    expect(r.staged).toBeFalsy();
    expect(r.targetKg).toBe(4.0);
  });

  test('8 kg mixed cat BCS 9 → staged, obese, severe; synthetic band NOT used to clamp', () => {
    const r = estimateIdealWeight({
      species: 'cat', breed: null, sex: 'female',
      ageMonths: 3 * 12, currentWeightKg: 8, bcs: 9,
    });
    expect(r.staged).toBe(true);
    expect(r.targetKg).toBe(7.0); // 8 × 0.88
    expect(r.finalIdealKg).toBe(5.4); // 8 / 1.48 — unclamped despite synthetic band
    expect(r.classification).toBe('obese');
    expect(r.severity).toBe('severe');
    expect(r.advisory).toBeNull(); // no false "above typical range" from circular band
    expect(r.confidence).toBe('low');
  });
});

describe('estimateIdealWeight — mixed breed with extreme BCS is not clamped', () => {
  test('4 kg mixed dog BCS 1 → gain plan from BCS alone, severe (emaciation)', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Mixed Breed', sex: null,
      ageMonths: 3 * 12, currentWeightKg: 4, bcs: 1,
    });
    expect(r.mode).toBe('ok');
    expect(r.finalIdealKg).toBeCloseTo(6.7, 1); // 4 / 0.6, no circular clamp
    expect(r.staged).toBe(true);
    expect(r.targetKg).toBe(4.5); // 4 × 1.12 = 4.48
    expect(r.severity).toBe('severe'); // BCS ≤ 2
    expect(r.classification).toBe('underweight');
  });
});

describe('estimateIdealWeight — no BCS provided', () => {
  test('known breed → breed midpoint, staged when far, classification from scale', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: adultLab.ageMonths, currentWeightKg: 8, bcs: null,
    });
    expect(r.mode).toBe('ok');
    expect(r.confidence).toBe('low');
    expect(r.classification).toBe('underweight');
    expect(r.severity).toBe('severe');
    expect(r.staged).toBe(true);
    expect(r.targetKg).toBe(9);
  });

  test('unknown breed, no signal → holds current at low confidence', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Other', sex: null,
      ageMonths: 4 * 12, currentWeightKg: 3, bcs: null,
    });
    expect(r.mode).toBe('ok');
    expect(r.targetKg).toBe(3);
    expect(r.confidence).toBe('low');
    expect(r.severity).toBe('none');
  });
});

describe('estimateIdealWeight — growth gate', () => {
  test('5-month Lab any BCS → growth mode, no targetKg', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: 5, currentWeightKg: 18, bcs: 5,
    });
    expect(r.mode).toBe('growth');
    expect(r.targetKg).toBeUndefined();
  });

  test('14-month large-breed dog → still growth (15-mo threshold)', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: 14, currentWeightKg: 32, bcs: 5,
    });
    expect(r.mode).toBe('growth');
  });

  test('16-month Lab → adult', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: 16, currentWeightKg: 32, bcs: 5,
    });
    expect(r.mode).toBe('ok');
  });
});

describe('estimateIdealWeight — plan math (timeline fields)', () => {
  test('weeks are positive and finite whenever there is a delta', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: adultLab.ageMonths, currentWeightKg: 48, bcs: 8,
    });
    expect(r.deltaKg).toBeLessThan(0);
    expect(Number.isFinite(r.estimatedWeeks!)).toBe(true);
    expect(r.estimatedWeeks!).toBeGreaterThan(0);
    expect(r.safeWeeklyPct).toBe(1.5); // dog-safe rate
  });

  test('recovery timeline reflects the full distance to ideal (honest, vet-flagged)', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: adultLab.ageMonths, currentWeightKg: 8, bcs: 5,
    });
    expect(r.deltaKg).toBeCloseTo(15.2, 1);
    expect(r.estimatedWeeks).toBe(127);
  });
});

describe('estimateIdealWeight — invalid input', () => {
  test('non-positive weight → invalid (the only true error case)', () => {
    const r = estimateIdealWeight({
      species: 'dog', breed: 'Labrador Retriever', sex: 'male',
      ageMonths: 24, currentWeightKg: 0, bcs: 5,
    });
    expect(r.mode).toBe('invalid');
  });
});

describe('estimateIdealWeight — property checks', () => {
  test('final ideal is non-increasing across BCS 1..9 for a 32 kg Lab', () => {
    let prev = Infinity;
    for (const b of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const r = estimateIdealWeight({
        species: 'dog', breed: 'Labrador Retriever', sex: 'male',
        ageMonths: adultLab.ageMonths, currentWeightKg: 32, bcs: b,
      });
      expect(r.mode).toBe('ok');
      expect(Number.isFinite(r.finalIdealKg!)).toBe(true);
      expect(r.finalIdealKg!).toBeLessThanOrEqual(prev + 0.01);
      prev = r.finalIdealKg!;
    }
  });

  test('every adult path always produces a target (no blocking modes remain)', () => {
    const weights = [1, 4, 8, 20, 45, 90];
    const bcss = [null, 1, 3, 5, 7, 9];
    for (const w of weights) {
      for (const b of bcss) {
        const r = estimateIdealWeight({
          species: 'dog', breed: 'Labrador Retriever', sex: 'male',
          ageMonths: adultLab.ageMonths, currentWeightKg: w, bcs: b,
        });
        expect(r.mode).toBe('ok');
        expect(r.targetKg).toBeGreaterThan(0);
        expect(r.finalIdealKg).toBeGreaterThan(0);
      }
    }
  });
});

describe('computeSliderBounds', () => {
  const labBand = getBreedBand('dog', 'Labrador Retriever', 'male', 45)!;

  test('3 kg cat → 0.1-kg step, proportional range', () => {
    const b = computeSliderBounds('cat', 3, null);
    expect(b.step).toBe(0.1);
    expect(b.min).toBeGreaterThanOrEqual(0.3);
    expect(b.min).toBeLessThanOrEqual(3 * 0.85);
    expect(b.max).toBeGreaterThanOrEqual(3 * 1.15);
    expect(b.max).toBeLessThanOrEqual(3 * 1.3 + 0.001);
  });

  test('45 kg Lab with band → spans down to band area and keeps current reachable', () => {
    const b = computeSliderBounds('dog', 45, labBand);
    expect(b.step).toBe(0.5);
    expect(b.min).toBeLessThanOrEqual(labBand.low * 0.9); // ~20.9
    expect(b.max).toBeGreaterThanOrEqual(45 * 1.15);
    expect(b.min).toBeLessThanOrEqual(45);
    expect(b.max).toBeGreaterThanOrEqual(45);
  });

  test('species hard floors respected', () => {
    expect(computeSliderBounds('cat', 0.5, null).min).toBeGreaterThanOrEqual(0.3);
    expect(computeSliderBounds('dog', 1, null).min).toBeGreaterThanOrEqual(0.5);
  });
});

describe('activitySuggestion', () => {
  test('returns a non-empty line for every classification × species', () => {
    for (const s of ['dog', 'cat'] as const) {
      for (const c of ['underweight', 'ideal', 'overweight', 'obese'] as const) {
        expect(activitySuggestion(s, c).length).toBeGreaterThan(10);
      }
    }
  });

  test('underweight advice is gentle, not more exercise', () => {
    expect(activitySuggestion('dog', 'underweight')).toMatch(/gentle|light/i);
    expect(activitySuggestion('cat', 'underweight')).toMatch(/gentle|light/i);
  });
});

describe('getBreedBand', () => {
  test('unknown sex takes union of male+female ranges', () => {
    const band = getBreedBand('dog', 'Labrador Retriever', null, 30)!;
    // female low 25 × 0.8 = 20; male high 36 × 1.2 = 43.2
    expect(band.low).toBeCloseTo(20, 5);
    expect(band.high).toBeCloseTo(43.2, 5);
  });

  test('mixed breed with no weight anchor → null band', () => {
    expect(getBreedBand('dog', 'Mixed Breed', null, null)).toBeNull();
  });
});

describe('adultAgeMonths', () => {
  test('cats mature at 12 months', () => {
    expect(adultAgeMonths('cat', 'medium')).toBe(12);
  });
  test('giant dogs mature at 18 months', () => {
    expect(adultAgeMonths('dog', 'giant')).toBe(18);
  });
  test('large dogs mature at 15 months', () => {
    expect(adultAgeMonths('dog', 'large')).toBe(15);
  });
  test('small dogs mature at 12 months', () => {
    expect(adultAgeMonths('dog', 'small')).toBe(12);
  });
});

describe('stageCount — milestone ladder length', () => {
  test('within one ±12% stage → 1 (matches applyStaging non-staged path)', () => {
    expect(stageCount(20, 20)).toBe(1);
    expect(stageCount(20, 18)).toBe(1); // −10%
    expect(stageCount(20, 17.6)).toBe(1); // exactly −12%
    expect(stageCount(20, 22.4)).toBe(1); // exactly +12%
  });

  test('gain: 15 → 23.2 kg Lab recovery ladder ≈ 4 stages', () => {
    expect(stageCount(15, 23.2)).toBe(4);
  });

  test('loss: 48 → 37 kg Lab loss ladder ≈ 3 stages', () => {
    // 48 × 0.88 = 42.24 → 37.17 → third stage reaches 37
    expect(stageCount(48, 37)).toBe(3);
  });

  test('degenerate inputs → 1, never NaN or 0', () => {
    expect(stageCount(0, 10)).toBe(1);
    expect(stageCount(NaN, 10)).toBe(1);
    expect(stageCount(10, NaN)).toBe(1);
    expect(stageCount(10, 0)).toBe(1);
  });
});
