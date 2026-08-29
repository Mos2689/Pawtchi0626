import { estimateDogSteps, formatSteps, formatStepsProse } from './stepEstimate';
import { deriveDogWalkProfile } from './dogCalibration';
import type { SizeCategory } from '../breedData';
import type { LifeStage } from '../lifeStage';

/** A profile shaped like the real one, without going through breed lookup. */
function profileFor(
  sizeCategory: SizeCategory,
  lifeStage: LifeStage = 'adult',
  paceBandKmh = { min: 1.5, max: 6.0 },
) {
  return { sizeCategory, lifeStage, paceBandKmh };
}

/** The walk from the screenshot: 1.18 km, ~15 min actually moving. */
const REAL_WALK = { distanceM: 1180, movingTimeS: 15 * 60 };

describe('estimateDogSteps', () => {
  it('lands in a plausible range for a real medium-dog walk', () => {
    // A ~20kg dog covering 1.18km. Human rule of thumb is ~1,300 steps/km for
    // a person; a medium dog's stride is a little shorter than an adult human's
    // and it puts down four paws per cycle, so several thousand is expected.
    const { steps } = estimateDogSteps({ ...REAL_WALK, profile: profileFor('medium') });
    expect(steps).toBeGreaterThan(4500);
    expect(steps).toBeLessThan(8000);
  });

  it('makes a toy dog work three to four times harder than a giant', () => {
    // The entire reason this is the dog's number and not the owner's.
    const toy = estimateDogSteps({
      ...REAL_WALK,
      profile: profileFor('toy', 'adult', { min: 1.0, max: 4.5 }),
    }).steps;
    const giant = estimateDogSteps({
      ...REAL_WALK,
      profile: profileFor('giant', 'adult', { min: 1.2, max: 5.5 }),
    }).steps;

    const ratio = toy / giant;
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(4.5);
  });

  it('orders monotonically by size for the same walk', () => {
    const sizes: SizeCategory[] = ['giant', 'large', 'medium', 'small', 'toy'];
    const counts = sizes.map(
      size => estimateDogSteps({ ...REAL_WALK, profile: profileFor(size) }).steps,
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    }
  });

  it('lengthens the stride as the dog moves faster within its own band', () => {
    const slow = estimateDogSteps({
      distanceM: 1000,
      movingTimeS: 30 * 60, // 2 km/h — near the bottom of the band
      profile: profileFor('medium'),
    });
    const brisk = estimateDogSteps({
      distanceM: 1000,
      movingTimeS: 10 * 60, // 6 km/h — top of the band
      profile: profileFor('medium'),
    });

    expect(brisk.strideLengthM).toBeGreaterThan(slow.strideLengthM);
    // Same ground covered with a longer stride means fewer steps.
    expect(brisk.steps).toBeLessThan(slow.steps);
  });

  it('judges pace against THIS dog’s band, not an absolute speed', () => {
    // 4 km/h is near the top of a toy dog's band and mid-range for a large one.
    const walk = { distanceM: 1000, movingTimeS: 15 * 60 };
    const toy = estimateDogSteps({
      ...walk,
      profile: profileFor('toy', 'adult', { min: 1.0, max: 4.5 }),
    });
    const large = estimateDogSteps({
      ...walk,
      profile: profileFor('large', 'adult', { min: 1.5, max: 7.0 }),
    });
    expect(toy.pacePosition).toBeGreaterThan(large.pacePosition);
  });

  it('gives a puppy more, shorter steps than an adult of its adult size', () => {
    // Size category comes from the breed's ADULT size, so without the life-stage
    // correction a Labrador puppy would be modelled with a fully grown stride.
    const puppy = estimateDogSteps({
      ...REAL_WALK,
      profile: profileFor('large', 'puppy'),
    });
    const adult = estimateDogSteps({
      ...REAL_WALK,
      profile: profileFor('large', 'adult'),
    });
    expect(puppy.strideLengthM).toBeLessThan(adult.strideLengthM);
    expect(puppy.steps).toBeGreaterThan(adult.steps);
  });

  it('shortens a senior’s stride too', () => {
    const senior = estimateDogSteps({ ...REAL_WALK, profile: profileFor('medium', 'senior') });
    const adult = estimateDogSteps({ ...REAL_WALK, profile: profileFor('medium', 'adult') });
    expect(senior.steps).toBeGreaterThan(adult.steps);
  });

  it('returns zero for a walk that covered no ground, never a floor', () => {
    expect(
      estimateDogSteps({ distanceM: 0, movingTimeS: 600, profile: profileFor('medium') }).steps,
    ).toBe(0);
  });

  it('survives zero moving time without dividing by it', () => {
    const result = estimateDogSteps({
      distanceM: 500,
      movingTimeS: 0,
      profile: profileFor('medium'),
    });
    expect(Number.isFinite(result.steps)).toBe(true);
    expect(result.pacePosition).toBe(0);
  });

  it('rounds coarsely, so the number reads as the estimate it is', () => {
    const { steps } = estimateDogSteps({ ...REAL_WALK, profile: profileFor('medium') });
    expect(steps % 100).toBe(0);
  });

  it('accepts a real DogWalkProfile unchanged', () => {
    // The profile the walk already carries — no new data, no new column.
    const profile = deriveDogWalkProfile({
      species: 'dog',
      breed: 'Labrador Retriever',
      ageYears: 4,
      weightKg: 30,
      medicalConditions: null,
    });
    const { steps } = estimateDogSteps({ ...REAL_WALK, profile });
    expect(steps).toBeGreaterThan(0);
  });
});

describe('formatSteps', () => {
  it('marks the number as an approximation', () => {
    // A health app does not print a modelled figure as though it were measured.
    expect(formatSteps(6000)).toBe('~6,000');
    expect(formatSteps(13100)).toBe('~13,100');
  });

  it('hedges in words when the number sits in a sentence', () => {
    expect(formatStepsProse(6000)).toBe('around 6,000');
  });

  it('never presents a modelled number without a hedge', () => {
    for (const value of [50, 950, 6000, 13100]) {
      expect(formatSteps(value)).toMatch(/^~/);
      expect(formatStepsProse(value)).toMatch(/^around /);
    }
  });
});
