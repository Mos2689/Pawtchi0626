import {
  matchWalkToActivity,
  buildUnmatchedWalkPayload,
  MatchableActivity,
  MATCH_WINDOW_MS,
} from './activityMatcher';
import { deriveDogWalkProfile } from './dogCalibration';
import { WalkSummary } from './walkSession';
import { getLocalYMD } from '../dateUtils';

/** A walk today from `startHH:MM` local, `durationMin` long. */
function summaryAt(startHH: number, startMM: number, durationMin: number): WalkSummary {
  const start = new Date();
  start.setHours(startHH, startMM, 0, 0);
  const startedAt = start.getTime();
  const endedAt = startedAt + durationMin * 60_000;
  return {
    startedAt,
    endedAt,
    durationS: durationMin * 60,
    movingTimeS: durationMin * 55,
    distanceM: 1400,
    avgMovingSpeedKmh: 4.2,
    path: [],
    startPoint: null,
    endPoint: null,
    farthestPoint: null,
    maxExcursionM: 0,
    acceptedCount: 200,
    rejectedForAccuracy: 2,
    rejectedForSpeed: 0,
    endReason: 'auto_home',
    pausePoints: [],
  };
}

const today = getLocalYMD(new Date());

function activity(overrides: Partial<MatchableActivity>): MatchableActivity {
  return {
    id: 'a1',
    activity_type: 'walk',
    status: 'pending',
    scheduled_date: today,
    scheduled_time: '08:00:00',
    ...overrides,
  };
}

describe('matchWalkToActivity', () => {
  it('claims the pending walk nearest the session midpoint', () => {
    const morning = activity({ id: 'morning', scheduled_time: '08:00:00' });
    const evening = activity({ id: 'evening', scheduled_time: '18:00:00' });
    const match = matchWalkToActivity([evening, morning], summaryAt(8, 10, 30));
    expect(match?.id).toBe('morning');
  });

  it('never touches completed or skipped rows', () => {
    const done = activity({ id: 'done', status: 'completed' });
    const skipped = activity({ id: 'skipped', status: 'skipped' });
    expect(matchWalkToActivity([done, skipped], summaryAt(8, 0, 30))).toBeNull();
  });

  it('ignores non-walk activities at the same slot', () => {
    const feeding = activity({ id: 'feed', activity_type: 'feeding' });
    expect(matchWalkToActivity([feeding], summaryAt(8, 0, 30))).toBeNull();
  });

  it('leaves slots outside the ±3h window alone', () => {
    const evening = activity({ id: 'evening', scheduled_time: '19:30:00' });
    expect(matchWalkToActivity([evening], summaryAt(8, 0, 30))).toBeNull();
  });

  it('ignores rows scheduled for another day', () => {
    const tomorrow = activity({ id: 't', scheduled_date: '2099-01-01' });
    expect(matchWalkToActivity([tomorrow], summaryAt(8, 0, 30))).toBeNull();
  });

  it('claims an untimed pending walk, but lets a timed slot win', () => {
    const untimed = activity({ id: 'untimed', scheduled_time: null });
    const timed = activity({ id: 'timed', scheduled_time: '08:15:00' });
    expect(matchWalkToActivity([untimed], summaryAt(8, 0, 30))?.id).toBe('untimed');
    expect(matchWalkToActivity([untimed, timed], summaryAt(8, 0, 30))?.id).toBe('timed');
  });

  it('exposes a sane window constant', () => {
    expect(MATCH_WINDOW_MS).toBe(3 * 60 * 60_000);
  });
});

describe('buildUnmatchedWalkPayload', () => {
  const profile = deriveDogWalkProfile({
    species: 'dog',
    breed: 'Labrador Retriever',
    ageYears: 4,
    weightKg: 30,
  });

  it('mirrors the manual-log payload shape', () => {
    const s = summaryAt(8, 0, 32);
    const payload = buildUnmatchedWalkPayload('pet-1', s, 'ws-1', profile);
    expect(payload).toMatchObject({
      pet_id: 'pet-1',
      activity_type: 'walk',
      status: 'completed',
      is_ai_generated: false,
      walk_session_id: 'ws-1',
      scheduled_date: today,
      // duration_minutes = elapsed (display); active_minutes = moving time
      // (32 min × 55s moving/min = 29), which is what kcal derives from.
      duration_minutes: 32,
      active_minutes: 29,
      distance_km: 1.4,
    });
    expect(payload.scheduled_time).toBe('08:00:00');
    expect(['low', 'moderate', 'high']).toContain(payload.intensity);
  });

  it('keeps burn honest for a stationary drift session', () => {
    // The "131 minutes on the couch" bug: elapsed 131 min, moving 4 min.
    // The timeline may say 131, but the kcal basis must say 4.
    const s = { ...summaryAt(8, 0, 131), movingTimeS: 4 * 60, distanceM: 180 };
    const payload = buildUnmatchedWalkPayload('pet-1', s, 'ws-1', profile);
    expect(payload.duration_minutes).toBe(131);
    expect(payload.active_minutes).toBe(4);
  });
});
