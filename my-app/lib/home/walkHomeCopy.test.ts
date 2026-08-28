import {
  buildHeaderMeta,
  buildVoiceLine,
  deriveUsualHour,
  formatSinceLastWalk,
  isUsualHourNow,
} from './walkHomeCopy';

// Words banned by the Pawtchi Copy Spec v1 (brand book § 6.04).
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

/** A fixed clock so every case is deterministic: Sun 26 Jul 2026, 09:18 local. */
const NOW = new Date(2026, 6, 26, 9, 18, 0).getTime();
const hoursAgo = (h: number) => NOW - h * 3_600_000;

describe('formatSinceLastWalk', () => {
  test('reports hours, then days, then the no-walk case', () => {
    expect(formatSinceLastWalk(hoursAgo(0.2), NOW)).toBe('walked just now');
    expect(formatSinceLastWalk(hoursAgo(6), NOW)).toBe('6h since last walk');
    expect(formatSinceLastWalk(hoursAgo(23), NOW)).toBe('23h since last walk');
    expect(formatSinceLastWalk(hoursAgo(25), NOW)).toBe('1 day since last walk');
    expect(formatSinceLastWalk(hoursAgo(72), NOW)).toBe('3 days since last walk');
    expect(formatSinceLastWalk(null, NOW)).toBe('no walks yet');
    expect(formatSinceLastWalk('not a date', NOW)).toBe('no walks yet');
  });

  test('a future timestamp never produces a negative count', () => {
    expect(formatSinceLastWalk(NOW + 3_600_000, NOW)).toBe('walked just now');
  });
});

describe('buildHeaderMeta', () => {
  test('reads "Sun · Jul 26 · 6h since last walk"', () => {
    expect(buildHeaderMeta(hoursAgo(6), NOW)).toBe('Sun · Jul 26 · 6h since last walk');
  });

  test('degrades cleanly with no walk history', () => {
    expect(buildHeaderMeta(null, NOW)).toBe('Sun · Jul 26 · no walks yet');
  });
});

describe('deriveUsualHour', () => {
  test('needs enough walks before claiming a routine', () => {
    const threeMornings = [
      new Date(2026, 6, 23, 8, 5).getTime(),
      new Date(2026, 6, 24, 8, 40).getTime(),
      new Date(2026, 6, 25, 7, 55).getTime(),
    ];
    expect(deriveUsualHour(threeMornings)).toBeNull();
  });

  test('folds nearby times into one slot and returns its start hour', () => {
    const mornings = [
      new Date(2026, 6, 22, 7, 50).getTime(),
      new Date(2026, 6, 23, 8, 5).getTime(),
      new Date(2026, 6, 24, 8, 40).getTime(),
      new Date(2026, 6, 25, 9, 10).getTime(),
      new Date(2026, 6, 25, 18, 30).getTime(),
    ];
    // 07:50 / 08:05 / 08:40 all land in the 06–09 slot; 09:10 and 18:30 do not.
    expect(deriveUsualHour(mornings)).toBe(6);
  });

  test('returns null when walks are scattered across the day', () => {
    const scattered = [
      new Date(2026, 6, 22, 6, 0).getTime(),
      new Date(2026, 6, 23, 11, 0).getTime(),
      new Date(2026, 6, 24, 15, 0).getTime(),
      new Date(2026, 6, 25, 21, 0).getTime(),
    ];
    expect(deriveUsualHour(scattered)).toBeNull();
  });

  test('ignores unparseable timestamps', () => {
    expect(deriveUsualHour(['nonsense', 'also nonsense'])).toBeNull();
  });
});

describe('isUsualHourNow', () => {
  test('covers the three-hour slot and nothing outside it', () => {
    expect(isUsualHourNow(9, NOW)).toBe(true); // 09:18 is in 09–12
    expect(isUsualHourNow(6, NOW)).toBe(false);
    expect(isUsualHourNow(12, NOW)).toBe(false);
    expect(isUsualHourNow(null, NOW)).toBe(false);
  });
});

describe('buildVoiceLine', () => {
  test('invites a first walk when there is no history', () => {
    const line = buildVoiceLine({ petName: 'Momo', lastWalkAt: null, now: NOW });
    expect(line).toBe('Momo has a first walk waiting.');
    assertBrandVoice(line);
  });

  test('acknowledges a walk already taken today', () => {
    const line = buildVoiceLine({ petName: 'Momo', lastWalkAt: hoursAgo(2), now: NOW });
    expect(line).toBe('Momo has already been out today.');
    assertBrandVoice(line);
  });

  test('names the usual hour with the right pronoun', () => {
    expect(
      buildVoiceLine({
        petName: 'Momo',
        gender: 'male',
        lastWalkAt: hoursAgo(20),
        usualHour: 9,
        now: NOW,
      }),
    ).toBe('It is his usual hour.');

    expect(
      buildVoiceLine({
        petName: 'Pixel',
        gender: 'female',
        lastWalkAt: hoursAgo(20),
        usualHour: 9,
        now: NOW,
      }),
    ).toBe('It is her usual hour.');

    // No gender on record — they/their, never a guess.
    expect(
      buildVoiceLine({ petName: 'Momo', lastWalkAt: hoursAgo(20), usualHour: 9, now: NOW }),
    ).toBe('It is their usual hour.');
  });

  test('states the plain gap outside the usual hour', () => {
    expect(
      buildVoiceLine({ petName: 'Momo', lastWalkAt: hoursAgo(8), usualHour: 18, now: NOW }),
    ).toBe('8 hours since Momo last went out.');

    expect(
      buildVoiceLine({ petName: 'Momo', lastWalkAt: hoursAgo(30), now: NOW }),
    ).toBe('It has been a day since Momo last went out.');

    expect(
      buildVoiceLine({ petName: 'Momo', lastWalkAt: hoursAgo(80), now: NOW }),
    ).toBe('It has been 3 days since Momo last went out.');
  });

  test('a long gap stays factual, never shaming', () => {
    const line = buildVoiceLine({ petName: 'Momo', lastWalkAt: hoursAgo(240), now: NOW });
    assertBrandVoice(line);
    expect(line.toLowerCase()).not.toContain('should');
    expect(line.toLowerCase()).not.toContain('finally');
  });

  test('every branch survives a missing name', () => {
    const cases = [
      buildVoiceLine({ lastWalkAt: null, now: NOW }),
      buildVoiceLine({ lastWalkAt: hoursAgo(1), now: NOW }),
      buildVoiceLine({ lastWalkAt: hoursAgo(20), usualHour: 9, now: NOW }),
      buildVoiceLine({ lastWalkAt: hoursAgo(10), now: NOW }),
      buildVoiceLine({ lastWalkAt: hoursAgo(50), now: NOW }),
    ];
    for (const line of cases) {
      assertBrandVoice(line);
      expect(line).not.toContain('null');
      expect(line).not.toContain('undefined');
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });
});
