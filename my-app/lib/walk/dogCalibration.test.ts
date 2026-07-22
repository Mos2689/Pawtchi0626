import {
  deriveDogWalkProfile,
  sessionConfigFor,
  intensityForPace,
} from './dogCalibration';
import { DEFAULT_SESSION_CONFIG } from './walkSession';

describe('deriveDogWalkProfile', () => {
  it('gives an adult Labrador a large-dog profile', () => {
    const p = deriveDogWalkProfile({
      species: 'dog',
      breed: 'Labrador Retriever',
      ageYears: 4,
      weightKg: 30,
    });
    expect(p.sizeCategory).toBe('large');
    expect(p.minValidDistanceM).toBe(250);
    expect(p.paceBandKmh.max).toBe(7);
    expect(p.sessionCapMinutes).toBeNull();
    expect(p.stationaryToleranceMultiplier).toBe(1);
  });

  it('softens everything for a senior toy dog', () => {
    const p = deriveDogWalkProfile({
      species: 'dog',
      breed: null, // unknown breed → weight-based size
      ageYears: 14,
      weightKg: 3,
    });
    expect(p.sizeCategory).toBe('toy');
    expect(['senior', 'geriatric']).toContain(p.lifeStage);
    expect(p.minValidDistanceM).toBe(60); // 100m floor × 0.6 senior scale
    expect(p.paceBandKmh.max).toBeLessThan(4.5);
    expect(p.stationaryToleranceMultiplier).toBeGreaterThan(1);
  });

  it('scales down expectations for puppies', () => {
    const p = deriveDogWalkProfile({
      species: 'dog',
      breed: 'German Shepherd',
      ageYears: 0,
      ageMonths: 4,
      weightKg: 12,
    });
    expect(p.lifeStage).toBe('puppy');
    expect(p.minValidDistanceM).toBe(175); // 250 × 0.7
    expect(p.stationaryToleranceMultiplier).toBe(1.3);
  });

  it('applies the clinical session cap from activityRestrictions', () => {
    const p = deriveDogWalkProfile({
      species: 'dog',
      breed: 'Beagle',
      ageYears: 6,
      weightKg: 12,
      medicalConditions: ['Heart disease'],
    });
    expect(p.sessionCapMinutes).toBe(30);
    expect(p.restrictionLabels).toContain('limit vigorous exercise');
  });

  it('caps moderate-restriction dogs at an hour', () => {
    const p = deriveDogWalkProfile({
      species: 'dog',
      breed: 'Labrador Retriever',
      ageYears: 8,
      weightKg: 34,
      medicalConditions: ['Arthritis'],
    });
    expect(p.sessionCapMinutes).toBe(60);
  });
});

describe('sessionConfigFor', () => {
  it('stretches the stationary windows for patient walkers', () => {
    const profile = deriveDogWalkProfile({
      species: 'dog',
      breed: null,
      ageYears: 13,
      weightKg: 4,
    });
    const config = sessionConfigFor(profile);
    expect(config.autoPauseAfterMs).toBeGreaterThan(
      DEFAULT_SESSION_CONFIG.autoPauseAfterMs,
    );
    expect(config.autoStopStationaryMs).toBeGreaterThan(
      DEFAULT_SESSION_CONFIG.autoStopStationaryMs,
    );
    // Non-stationary thresholds are untouched.
    expect(config.maxSpeedKmh).toBe(DEFAULT_SESSION_CONFIG.maxSpeedKmh);
  });
});

describe('intensityForPace', () => {
  const largeAdult = deriveDogWalkProfile({
    species: 'dog',
    breed: 'Labrador Retriever',
    ageYears: 4,
    weightKg: 30,
  });

  it('judges pace against the dog, not an absolute scale', () => {
    expect(intensityForPace(2.0, largeAdult)).toBe('low');
    expect(intensityForPace(5.0, largeAdult)).toBe('moderate');
    expect(intensityForPace(6.8, largeAdult)).toBe('high');
  });

  it('calls the same pace harder work for a toy senior', () => {
    const toySenior = deriveDogWalkProfile({
      species: 'dog',
      breed: null,
      ageYears: 14,
      weightKg: 3,
    });
    expect(intensityForPace(3.2, toySenior)).toBe('high');
  });
});
