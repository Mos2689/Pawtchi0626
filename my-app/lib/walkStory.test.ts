import {
  buildWalkStory,
  classifyDaylight,
  storyDepth,
  sunTimesLocalHours,
  type StoryBeat,
  type WalkStoryInput,
} from './walkStory';
import type { Keepsake } from './walk/keepsake';
import type { WalkTotals } from './pawPrints';

// Same locked brand voice the moment card enforces (Copy Spec v1).
const BANNED_WORDS = [
  'immediately',
  'urgent',
  'ensure',
  'incredible',
  'amazing',
  'superstar',
  'alert',
  "don't forget",
  'ai-powered',
];

function assertBrandVoice(text: string) {
  expect(text).not.toContain('!');
  expect(text.toLowerCase()).not.toContain('your pet');
  for (const word of BANNED_WORDS) {
    expect(text.toLowerCase()).not.toContain(word);
  }
}

/** Every user-facing string a beat can surface. */
function beatStrings(beat: StoryBeat): string[] {
  switch (beat.id) {
    case 'opener':
      return [beat.headline, beat.dateLine, beat.chapter ?? '', beat.speedLabel ?? ''];
    case 'keepsake':
      return [beat.line];
    case 'sniff_spot':
      return [beat.line];
    case 'golden_hour':
      return [beat.title, beat.line];
    case 'weather':
      return [beat.tempLabel, beat.conditionLabel, beat.line];
    case 'closer':
      return [beat.title, beat.line];
  }
}

// A clean, routed, mid-length walk in London. 2026-07-09 is a Thursday.
const ROUTE = [
  { lat: 51.5, lng: -0.12 },
  { lat: 51.502, lng: -0.118 },
  { lat: 51.504, lng: -0.115 },
];

function baseInput(overrides: Partial<WalkStoryInput> = {}): WalkStoryInput {
  return {
    petName: 'Bruno',
    petGender: 'male',
    sessionId: 'session-abc',
    startedAt: new Date(2026, 6, 9, 13, 0).getTime(), // 1pm — plainly daytime
    route: ROUTE,
    sniffStops: [],
    labels: { startLabel: 'Riverside Park', endLabel: 'Elm Street', farthestLabel: null, isLoop: false },
    stats: { durationS: 30 * 60, movingTimeS: 26 * 60, distanceM: 2400 },
    avgSpeedKmh: 4.8,
    weather: null,
    totals: null,
    ...overrides,
  };
}

function ids(input: WalkStoryInput): string[] {
  return buildWalkStory(input).beats.map((b) => b.id);
}

/** A showable keepsake `minutesIn` minutes into the base walk. */
function keepsake(id: string, minutesIn: number, overrides: Partial<Keepsake> = {}): Keepsake {
  const startedAt = new Date(2026, 6, 9, 13, 0).getTime();
  return {
    id,
    walkSessionId: 'session-abc',
    petId: 'pet-1',
    capturedAt: startedAt + minutesIn * 60_000,
    lat: 51.502,
    lng: -0.118,
    routeIndex: 1,
    elapsedS: minutesIn * 60,
    mediaType: 'photo',
    source: 'camera',
    localAssetId: `ph://${id}`,
    width: 4032,
    height: 3024,
    thumbPath: `thumbs/${id}.jpg`,
    thumbBlurhash: null,
    placeKey: '103004_-236',
    caption: null,
    ...overrides,
  };
}

describe('storyDepth', () => {
  test('climbs with the archive', () => {
    expect(storyDepth(0)).toBe('new');
    expect(storyDepth(2)).toBe('new');
    expect(storyDepth(3)).toBe('regular');
    expect(storyDepth(7)).toBe('seasoned');
    expect(storyDepth(30)).toBe('veteran');
    expect(storyDepth(null)).toBe('new');
  });
});

describe('buildWalkStory — structure', () => {
  test('always bookends with opener and closer', () => {
    const list = ids(baseInput());
    expect(list[0]).toBe('opener');
    expect(list[list.length - 1]).toBe('closer');
  });

  test('a routeless, statless patchy walk still tells a story', () => {
    const list = ids(
      baseInput({
        route: [],
        sniffStops: [],
        avgSpeedKmh: null,
        labels: { startLabel: null, endLabel: null, farthestLabel: null, isLoop: false },
        stats: { durationS: 60, movingTimeS: 30, distanceM: 0 },
      }),
    );
    // Opener + closer — never a dead end.
    expect(list).toEqual(['opener', 'closer']);
  });

  test('sniff beat appears only with at least one stop, and reports the count', () => {
    expect(ids(baseInput())).not.toContain('sniff_spot');
    const withSniffs = buildWalkStory(
      baseInput({
        sniffStops: [
          { lat: 51.5, lng: -0.12, dwellS: 45 },
          { lat: 51.502, lng: -0.118, dwellS: 190 },
        ],
      }),
    ).beats.find((b) => b.id === 'sniff_spot');
    expect(withSniffs).toMatchObject({ count: 2, longestDwellS: 190 });
  });

  test('opener carries a pace only for walks long enough to characterise it', () => {
    const opener = (input: WalkStoryInput) =>
      buildWalkStory(input).beats.find((b) => b.id === 'opener');
    expect(opener(baseInput())).toMatchObject({ speedLabel: '4.8 km/h' });
    // 2-minute doorstep loop: average speed is noise.
    expect(
      opener(baseInput({ stats: { durationS: 120, movingTimeS: 110, distanceM: 150 } })),
    ).toMatchObject({ speedLabel: null });
    // No speed recorded at all.
    expect(opener(baseInput({ avgSpeedKmh: null }))).toMatchObject({ speedLabel: null });
  });
});

describe('buildWalkStory — weather + golden hour', () => {
  test('weather beat only when weather is present', () => {
    expect(ids(baseInput())).not.toContain('weather');
    const beat = buildWalkStory(
      baseInput({ weather: { tempC: 11.6, code: 61, label: 'light rain' } }),
    ).beats.find((b) => b.id === 'weather');
    expect(beat).toMatchObject({ tempLabel: '12°', conditionLabel: 'light rain' });
  });

  test('golden-hour beat rides the classifier, and skips a plain-daytime walk', () => {
    expect(ids(baseInput())).not.toContain('golden_hour');
    // A walk that starts half an hour after sunrise IS golden hour.
    const sun = sunTimesLocalHours(new Date(2026, 6, 9), 51.5, -0.12)!;
    const at = new Date(2026, 6, 9);
    const h = sun.sunrise + 0.5;
    at.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
    const beat = buildWalkStory(baseInput({ startedAt: at.getTime() })).beats.find(
      (b) => b.id === 'golden_hour',
    );
    expect(beat).toMatchObject({ phase: 'sunrise' });
  });

  test('golden hour is unknown without a coordinate — routeless walks never guess', () => {
    expect(classifyDaylight(baseInput().startedAt, null, null)).toBe('unknown');
    expect(ids(baseInput({ route: [] }))).not.toContain('golden_hour');
  });
});

describe('sunTimesLocalHours', () => {
  // Day length is the offset-independent invariant (the timezone cancels in
  // the subtraction), so these hold whatever machine runs the suite.
  const dayLength = (sun: { sunrise: number; sunset: number }) =>
    (sun.sunset - sun.sunrise + 24) % 24;

  test('London in July is a long day (~16.4h)', () => {
    const sun = sunTimesLocalHours(new Date(Date.UTC(2026, 6, 9)), 51.5, -0.12)!;
    expect(dayLength(sun)).toBeGreaterThan(15.5);
    expect(dayLength(sun)).toBeLessThan(17);
  });

  test('the equator holds near 12h year-round', () => {
    const sun = sunTimesLocalHours(new Date(Date.UTC(2026, 6, 9)), 0, 0)!;
    expect(dayLength(sun)).toBeGreaterThan(11.5);
    expect(dayLength(sun)).toBeLessThan(12.5);
  });

  test('polar summer returns null (the sun never sets)', () => {
    expect(sunTimesLocalHours(new Date(Date.UTC(2026, 6, 9)), 80, 20)).toBeNull();
  });
});

describe('buildWalkStory — keepsakes', () => {
  test('a walk with no keepsakes still tells the same story it always did', () => {
    // The regression that matters: every walk recorded before this feature, and
    // every walk where nobody took a photo, must be untouched.
    expect(ids(baseInput())).not.toContain('keepsake');
    expect(ids(baseInput({ keepsakes: [] }))).not.toContain('keepsake');
    expect(ids(baseInput({ keepsakes: undefined }))).toEqual(ids(baseInput()));
  });

  test('emits the beat when the walk produced a moment', () => {
    expect(ids(baseInput({ keepsakes: [keepsake('k1', 10)] }))).toContain('keepsake');
  });

  test('leads the derived beats — unpredictable content comes first', () => {
    const list = ids(
      baseInput({
        keepsakes: [keepsake('k1', 10)],
        sniffStops: [{ lat: 51.5, lng: -0.12, dwellS: 45 }],
        weather: { tempC: 8, code: 3, label: 'overcast' },
      }),
    );
    expect(list.indexOf('keepsake')).toBeLessThan(list.indexOf('sniff_spot'));
    expect(list.indexOf('keepsake')).toBeLessThan(list.indexOf('weather'));
  });

  test('ignores moments with no image left to show', () => {
    const lost = keepsake('gone', 10, { thumbPath: null, localAssetId: null });
    expect(ids(baseInput({ keepsakes: [lost] }))).not.toContain('keepsake');
  });

  test('counts only the showable ones', () => {
    const story = buildWalkStory(
      baseInput({
        keepsakes: [
          keepsake('k1', 10),
          keepsake('gone', 15, { thumbPath: null, localAssetId: null }),
          keepsake('k2', 20),
        ],
      }),
    );
    const beat = story.beats.find((b) => b.id === 'keepsake');
    expect(beat).toMatchObject({ count: 2 });
  });

  test('orders moments as they happened, whatever order they arrived in', () => {
    const story = buildWalkStory(
      baseInput({ keepsakes: [keepsake('late', 25), keepsake('early', 5)] }),
    );
    const beat = story.beats.find((b) => b.id === 'keepsake');
    expect(beat && beat.id === 'keepsake' && beat.keepsakes.map((k) => k.id)).toEqual([
      'early',
      'late',
    ]);
  });

  test('reads naturally for one moment and for several', () => {
    const one = buildWalkStory(baseInput({ keepsakes: [keepsake('k1', 10)] })).beats.find(
      (b) => b.id === 'keepsake',
    );
    const many = buildWalkStory(
      baseInput({ keepsakes: [keepsake('k1', 10), keepsake('k2', 20)] }),
    ).beats.find((b) => b.id === 'keepsake');

    expect(one).toMatchObject({ line: 'One moment kept from this walk.' });
    expect(many).toMatchObject({ line: '2 moments kept along the way.' });
  });

  test('still appears on a patchy, routeless walk', () => {
    const list = ids(
      baseInput({
        route: [],
        stats: { durationS: 0, movingTimeS: 0, distanceM: 0 },
        avgSpeedKmh: null,
        keepsakes: [keepsake('k1', 2)],
      }),
    );
    expect(list).toContain('keepsake');
  });
});

describe('buildWalkStory — voice', () => {
  test('every string across a rich story is brand-voiced', () => {
    const story = buildWalkStory(
      baseInput({
        sniffStops: [
          { lat: 51.5, lng: -0.12, dwellS: 45 },
          { lat: 51.502, lng: -0.118, dwellS: 190 },
        ],
        weather: { tempC: 8, code: 3, label: 'overcast' },
        keepsakes: [keepsake('k1', 10), keepsake('k2', 20)],
        totals: totalsWith({
          walkCount: 42,
          longestWalk: { sessionId: 'session-abc', km: 2.4, label: 'Riverside Park' },
        }),
      }),
    );
    for (const beat of story.beats) {
      for (const s of beatStrings(beat)) assertBrandVoice(s);
    }
  });

  test('missing name never leaks a token', () => {
    const story = buildWalkStory(baseInput({ petName: null, petGender: null }));
    for (const beat of story.beats) {
      for (const s of beatStrings(beat)) {
        expect(s).not.toContain('undefined');
        expect(s).not.toContain('null');
      }
    }
  });
});

function totalsWith(overrides: Partial<WalkTotals>): WalkTotals {
  return {
    totalKm: 50,
    walkCount: 10,
    totalSniffs: 30,
    distinctPlaces: 4,
    favouritePlace: 'Riverside Park',
    longestWalk: null,
    firstWalkMonth: 'May',
    ...overrides,
  };
}
