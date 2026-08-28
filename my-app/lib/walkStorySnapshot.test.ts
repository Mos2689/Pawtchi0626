import {
  buildStoryFromSnapshot,
  buildWalkStoryBreedLine,
  createWalkStorySnapshot,
  parseWalkStoryGeoPoints,
  parseWalkStoryWeather,
} from './walkStorySnapshot';

describe('Walk Story snapshots', () => {
  test('normalizes a complete walk row for immediate rendering', () => {
    const snapshot = createWalkStorySnapshot({
      walkSessionId: 'walk-1',
      petId: 'pet-1',
      petName: 'Bruno',
      petGender: 'male',
      breed: 'English Bulldog',
      ageYears: 4.8,
      startedAt: '2026-07-27T06:30:00.000Z',
      durationS: 780,
      movingTimeS: 610,
      distanceM: 920,
      avgSpeedKmh: 5.4,
      route: [
        [12.9716, 77.5946],
        [12.9721, 77.5952],
      ],
      sniffPoints: [{ lat: 12.9718, lng: 77.5949, dwellS: 45 }],
      pausePoints: [],
      startLabel: 'Arpora',
      endLabel: 'Arpora',
      farthestLabel: 'Market Road',
      weather: { tempC: 27.2, code: 51, label: 'drizzle' },
      totals: null,
      cachedAt: 123,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.breedLine).toBe('English Bulldog · 4 years');
    expect(snapshot?.route).toEqual([
      { lat: 12.9716, lng: 77.5946 },
      { lat: 12.9721, lng: 77.5952 },
    ]);
    expect(snapshot?.sniffStops).toEqual([
      { lat: 12.9718, lng: 77.5949, dwellS: 45 },
    ]);
    expect(snapshot?.labels.isLoop).toBe(true);
    expect(snapshot?.weather?.label).toBe('drizzle');
    expect(buildStoryFromSnapshot(snapshot!).beats.map((beat) => beat.id)).toContain(
      'sniff_spot',
    );
  });

  test('carries keepsakes through to the story, newest last', () => {
    const startedAt = Date.parse('2026-07-27T06:30:00.000Z');
    const snapshot = createWalkStorySnapshot({
      walkSessionId: 'walk-1',
      petId: 'pet-1',
      startedAt,
      keepsakes: [
        {
          id: 'late',
          walk_session_id: 'walk-1',
          pet_id: 'pet-1',
          captured_at: startedAt + 600_000,
          thumb_path: 'thumbs/late.jpg',
        },
        {
          id: 'early',
          walk_session_id: 'walk-1',
          pet_id: 'pet-1',
          captured_at: startedAt + 60_000,
          thumb_path: 'thumbs/early.jpg',
        },
        // A malformed row must cost only itself, never the story.
        { id: null, captured_at: 'not-a-date' },
      ],
    });

    expect(snapshot?.keepsakes?.map((k) => k.id)).toEqual(['early', 'late']);
    expect(buildStoryFromSnapshot(snapshot!).beats.map((b) => b.id)).toContain('keepsake');
  });

  test('a v1 snapshot from a previous build still renders', () => {
    // The compatibility guarantee behind the version bump: a cached snapshot
    // with no `keepsakes` key at all opens exactly as it always did.
    const v1 = {
      version: 1,
      walkSessionId: 'walk-1',
      petId: 'pet-1',
      petName: 'Bruno',
      petGender: 'male',
      breedLine: null,
      startedAt: Date.parse('2026-07-27T06:30:00.000Z'),
      route: [{ lat: 12.9716, lng: 77.5946 }],
      sniffStops: [{ lat: 12.9718, lng: 77.5949, dwellS: 45 }],
      labels: { startLabel: 'Arpora', endLabel: 'Arpora', farthestLabel: null, isLoop: false },
      stats: { durationS: 780, movingTimeS: 610, distanceM: 920 },
      avgSpeedKmh: 5.4,
      weather: null,
      totals: null,
      cachedAt: 123,
    };

    const beats = buildStoryFromSnapshot(v1).beats.map((b) => b.id);
    expect(beats[0]).toBe('opener');
    expect(beats).toContain('sniff_spot');
    expect(beats).not.toContain('keepsake');
  });

  test('rejects snapshots without stable identity or time', () => {
    expect(
      createWalkStorySnapshot({
        walkSessionId: '',
        petId: 'pet-1',
        startedAt: Date.now(),
      }),
    ).toBeNull();
    expect(
      createWalkStorySnapshot({
        walkSessionId: 'walk-1',
        petId: 'pet-1',
        startedAt: 'not-a-date',
      }),
    ).toBeNull();
  });

  test('drops malformed geometry and weather instead of caching bad data', () => {
    expect(
      parseWalkStoryGeoPoints([
        [12.9, 77.5],
        ['bad', 77.6],
        { lat: 13, lng: 77.7 },
        null,
      ]),
    ).toEqual([
      { lat: 12.9, lng: 77.5 },
      { lat: 13, lng: 77.7 },
    ]);
    expect(parseWalkStoryWeather({ tempC: 'bad', label: 'clear' })).toBeNull();
  });

  test('keeps identity copy compact when age or breed is missing', () => {
    expect(buildWalkStoryBreedLine('Labrador', null)).toBe('Labrador');
    expect(buildWalkStoryBreedLine(null, 1)).toBe('1 year');
    expect(buildWalkStoryBreedLine(null, null)).toBeNull();
  });
});
