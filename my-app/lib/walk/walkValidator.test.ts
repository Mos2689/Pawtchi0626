import { deriveDogWalkProfile } from './dogCalibration';
import { WalkSummary } from './walkSession';
import { validateWalk } from './walkValidator';

const profile = deriveDogWalkProfile({
  species: 'dog',
  breed: 'Labrador Retriever',
  ageYears: 4,
  weightKg: 30,
});

function summary(overrides: Partial<WalkSummary> = {}): WalkSummary {
  return {
    startedAt: 0,
    endedAt: 25 * 60_000,
    durationS: 25 * 60,
    movingTimeS: 22 * 60,
    distanceM: 1600,
    avgMovingSpeedKmh: 4.4,
    path: [],
    startPoint: null,
    endPoint: null,
    farthestPoint: null,
    maxExcursionM: 0,
    acceptedCount: 280,
    rejectedForAccuracy: 6,
    rejectedForSpeed: 0,
    endReason: 'auto_home',
    pausePoints: [],
    ...overrides,
  };
}

describe('validateWalk', () => {
  it('passes a clean, plausible walk', () => {
    const r = validateWalk(summary(), profile);
    expect(r.verdict).toBe('valid');
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('flags a drive by average speed', () => {
    const r = validateWalk(
      summary({ avgMovingSpeedKmh: 13.5, distanceM: 5000 }),
      profile,
    );
    expect(r.verdict).toBe('likely_vehicle');
  });

  it('flags a drive by the share of speed-gated segments', () => {
    const r = validateWalk(
      summary({ rejectedForSpeed: 120, acceptedCount: 200 }),
      profile,
    );
    expect(r.verdict).toBe('likely_vehicle');
  });

  it('rejects the phone-left-at-home session as too short', () => {
    const r = validateWalk(
      summary({ durationS: 3 * 60, distanceM: 20, avgMovingSpeedKmh: 0.4 }),
      profile,
    );
    expect(r.verdict).toBe('too_short');
  });

  it('rejects a doorstep loop under the dog-scaled distance floor', () => {
    // 250m floor for a large adult
    const r = validateWalk(summary({ distanceM: 180 }), profile);
    expect(r.verdict).toBe('too_short');
  });

  it('accepts the same distance for a senior toy dog', () => {
    const toySenior = deriveDogWalkProfile({
      species: 'dog',
      breed: null,
      ageYears: 14,
      weightKg: 3,
    });
    const r = validateWalk(
      summary({ distanceM: 180, avgMovingSpeedKmh: 1.8 }),
      toySenior,
    );
    expect(r.verdict).toBe('valid');
  });

  it('cannot conclude anything from a handful of fixes', () => {
    const r = validateWalk(summary({ acceptedCount: 4 }), profile);
    expect(r.verdict).toBe('gps_junk');
  });

  it('distrusts a trace that mostly failed the accuracy gate', () => {
    const r = validateWalk(
      summary({ acceptedCount: 40, rejectedForAccuracy: 90 }),
      profile,
    );
    expect(r.verdict).toBe('gps_junk');
  });

  it('prefers gps_junk over vehicle when both apply', () => {
    const r = validateWalk(
      summary({
        acceptedCount: 20,
        rejectedForAccuracy: 200,
        avgMovingSpeedKmh: 20,
      }),
      profile,
    );
    expect(r.verdict).toBe('gps_junk');
  });
});
