import {
  STEP_LENGTH_INTERCEPT,
  STEP_LENGTH_PER_CM,
  STUDY_HEIGHT_MAX_CM,
  STUDY_HEIGHT_MIN_CM,
  estimateDogSteps,
  formatSteps,
  formatStepsProse,
} from './stepEstimate';
import { DOG_BREEDS } from '../../constants/breeds';
import { getBreedHeightCm } from '../breedData';

/** The walk that exposed the v1 bug: a French Bulldog over 100 metres. */
const SHORT_WALK = 100;

function stepsFor(breed: string, distanceM = 1000, extra: Record<string, unknown> = {}) {
  return estimateDogSteps({ distanceM, species: 'dog', breed, ...extra });
}

describe('the published regression', () => {
  it('reproduces the paper’s own step length at both ends of its range', () => {
    // stepLength = 0.33769340 + 0.0112636838 × heightCm
    const atMin = STEP_LENGTH_INTERCEPT + STEP_LENGTH_PER_CM * STUDY_HEIGHT_MIN_CM;
    const atMax = STEP_LENGTH_INTERCEPT + STEP_LENGTH_PER_CM * STUDY_HEIGHT_MAX_CM;
    expect(atMin).toBeCloseTo(0.5742, 3);
    expect(atMax).toBeCloseTo(0.9403, 3);
  });

  it('derives step length from the resolved height, not from weight', () => {
    // Beagle and French Bulldog weigh about the same and are built completely
    // differently — the whole reason the study preferred shoulder height.
    const beagle = stepsFor('Beagle');
    const frenchie = stepsFor('French Bulldog');
    expect(beagle.estimatedHeightCm).toBeGreaterThan(frenchie.estimatedHeightCm);
    expect(beagle.steps).toBeLessThan(frenchie.steps);
  });
});

describe('the v1 regression case', () => {
  it('gives a French Bulldog a believable count over 100m, not hundreds', () => {
    // v1 reported ~800 here because it counted four paw-falls per stride cycle.
    const { steps } = stepsFor('French Bulldog', SHORT_WALK);
    expect(steps).toBeGreaterThan(130);
    expect(steps).toBeLessThan(170);
  });

  it('keeps a large breed lower still over the same ground', () => {
    const lab = stepsFor('Labrador Retriever', SHORT_WALK).steps;
    const frenchie = stepsFor('French Bulldog', SHORT_WALK).steps;
    expect(lab).toBeLessThan(frenchie);
  });
});

describe('height resolution chain', () => {
  it('uses the breed standard for a known adult, at high confidence', () => {
    const result = stepsFor('Border Collie', 1000, { ageYears: 4 });
    expect(result.source).toBe('breed_standard');
    expect(result.confidence).toBe('high');
  });

  it('reads the sex-specific range when sex is known', () => {
    const male = stepsFor('Labrador Retriever', 1000, { sex: 'male' });
    const female = stepsFor('Labrador Retriever', 1000, { sex: 'female' });
    expect(male.estimatedHeightCm).toBeGreaterThan(female.estimatedHeightCm);
  });

  it('averages both sexes when sex is unknown, rather than guessing one', () => {
    const male = getBreedHeightCm('dog', 'Labrador Retriever', 'male')!;
    const female = getBreedHeightCm('dog', 'Labrador Retriever', 'female')!;
    expect(stepsFor('Labrador Retriever').estimatedHeightCm).toBeCloseTo(
      (male + female) / 2,
      1,
    );
  });

  it('shrinks a puppy allometrically from its adult standard', () => {
    // A Labrador puppy at half adult weight is classed 'large' by breed, but is
    // nowhere near a grown dog's height — without this it is badly undercounted.
    const puppy = stepsFor('Labrador Retriever', 1000, {
      ageYears: 0,
      ageMonths: 5,
      weightKg: 15,
    });
    const adult = stepsFor('Labrador Retriever', 1000, { ageYears: 4, weightKg: 30 });

    expect(puppy.source).toBe('puppy_estimate');
    expect(puppy.estimatedHeightCm).toBeLessThan(adult.estimatedHeightCm);
    expect(puppy.steps).toBeGreaterThan(adult.steps);
    // Cube root of a half-weight ratio is ~0.794, never below it by much.
    expect(puppy.estimatedHeightCm / adult.estimatedHeightCm).toBeCloseTo(0.794, 1);
  });

  it('never lets a puppy exceed its adult height', () => {
    const heavy = stepsFor('Labrador Retriever', 1000, {
      ageYears: 0,
      ageMonths: 10,
      weightKg: 60, // heavier than the breed's adult midpoint
    });
    const adult = stepsFor('Labrador Retriever', 1000, { ageYears: 4 });
    expect(heavy.estimatedHeightCm).toBeLessThanOrEqual(adult.estimatedHeightCm + 0.01);
  });

  it('falls back to weight for an unknown breed', () => {
    const result = estimateDogSteps({
      distanceM: 1000,
      species: 'dog',
      breed: 'Mixed Breed',
      weightKg: 22,
    });
    expect(result.source).toBe('weight_estimate');
    expect(result.confidence).toBe('low');
    expect(result.estimatedHeightCm).toBe(50);
  });

  it('falls back to the size class when even weight is missing', () => {
    const result = estimateDogSteps({ distanceM: 1000, species: 'dog', breed: 'Other' });
    expect(result.source).toBe('size_class');
    expect(result.confidence).toBe('low');
  });
});

describe('extrapolation guardrail', () => {
  it('still estimates for a dog shorter than any in the study', () => {
    const pom = stepsFor('Pomeranian'); // ~16.5cm, below the 21cm floor
    expect(pom.extrapolated).toBe(true);
    expect(pom.steps).toBeGreaterThan(0);
  });

  it('still estimates for a dog taller than any in the study', () => {
    const rottweiler = stepsFor('Rottweiler'); // ~62cm, above the 53.5cm ceiling
    expect(rottweiler.extrapolated).toBe(true);
    expect(rottweiler.steps).toBeGreaterThan(0);
  });

  it('demotes confidence one rung when extrapolating', () => {
    // Breed standard would be 'high'; outside the measured range it is not.
    expect(stepsFor('Rottweiler').confidence).toBe('medium');
  });

  it('leaves a dog inside the study range at full confidence', () => {
    const collie = stepsFor('Border Collie'); // ~51cm, inside 21–53.5
    expect(collie.extrapolated).toBe(false);
    expect(collie.confidence).toBe('high');
  });
});

describe('ordering and spread', () => {
  it('orders by height for the same walk', () => {
    const byHeight = ['Rottweiler', 'Labrador Retriever', 'Border Collie', 'Beagle', 'Pug', 'Pomeranian'];
    const counts = byHeight.map(b => stepsFor(b).steps);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    }
  });

  it('keeps the small-to-large spread modest, as the regression does', () => {
    // Asserted loosely and deliberately: the published fit compresses the small
    // end, and pretending otherwise by widening it here would be inventing data.
    const ratio = stepsFor('Pomeranian').steps / stepsFor('Rottweiler').steps;
    expect(ratio).toBeGreaterThan(1.3);
    expect(ratio).toBeLessThan(2.5);
  });
});

describe('rounding', () => {
  it('rounds to 10 below a thousand', () => {
    expect(stepsFor('French Bulldog', SHORT_WALK).steps % 10).toBe(0);
  });

  it('rounds to 25 between one and five thousand', () => {
    expect(stepsFor('Beagle', 2000).steps % 25).toBe(0);
  });

  it('rounds to 50 above five thousand', () => {
    expect(stepsFor('Pomeranian', 5000).steps % 50).toBe(0);
  });

  it('keeps the unrounded value for analytics only', () => {
    const result = stepsFor('Beagle', 2000);
    expect(result.rawSteps).not.toBe(result.steps);
    expect(Math.abs(result.rawSteps - result.steps)).toBeLessThan(25);
  });
});

describe('edge cases', () => {
  it('returns zero for a walk that covered no ground, never a floor', () => {
    expect(stepsFor('Beagle', 0).steps).toBe(0);
  });

  it('still reports the resolved height for a zero-distance walk', () => {
    expect(stepsFor('Beagle', 0).estimatedHeightCm).toBeGreaterThan(0);
  });

  it('survives a pet with nothing recorded but a species', () => {
    const result = estimateDogSteps({ distanceM: 1000, species: 'dog' });
    expect(Number.isFinite(result.steps)).toBe(true);
    expect(result.steps).toBeGreaterThan(0);
  });
});

describe('breed coverage', () => {
  it('every breed the picker offers resolves to a real height', () => {
    // The guard against a breed being added to the picker and silently dropping
    // to the size-class fallback, which no one would notice.
    const needsHeight = DOG_BREEDS.filter(b => b !== 'Mixed Breed' && b !== 'Other');
    const missing = needsHeight.filter(b => getBreedHeightCm('dog', b, null) === null);
    expect(missing).toEqual([]);
  });

  it('every breed height is anatomically plausible', () => {
    // A transposed or mistyped number is silent and permanent, so bound it.
    for (const breed of DOG_BREEDS) {
      const height = getBreedHeightCm('dog', breed, null);
      if (height === null) continue;
      expect(height).toBeGreaterThan(12);
      expect(height).toBeLessThan(90);
    }
  });

  it('has no height for cats — they never walk', () => {
    expect(getBreedHeightCm('cat', 'Ragdoll', null)).toBeNull();
  });
});

describe('formatting', () => {
  it('marks the number as an approximation', () => {
    expect(formatSteps(1650)).toBe('~1,650');
    expect(formatStepsProse(1650)).toBe('around 1,650');
  });

  it('never presents a modelled number without a hedge', () => {
    for (const value of [50, 950, 1650, 13100]) {
      expect(formatSteps(value)).toMatch(/^~/);
      expect(formatStepsProse(value)).toMatch(/^around /);
    }
  });
});
