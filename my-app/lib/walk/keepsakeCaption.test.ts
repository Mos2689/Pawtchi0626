/**
 * Keepsake captions.
 *
 * Two things are being protected here. First the honesty rule: every line is
 * derived, so a missing fact must produce a missing line rather than a filler
 * one. Second the brand voice, which this feature could quietly wreck — it is
 * the most "written" copy in the product and the easiest place to drift into
 * sentiment the rest of Pawtchi does not use.
 */

import {
  agoPhrase,
  buildKeepsakeCaption,
  dateLineFor,
  distancePhrase,
  elapsedPhrase,
  partOfDay,
  weatherPhrase,
  type KeepsakeCaption,
} from './keepsakeCaption';

/** Every user-facing string a caption can surface. */
function captionStrings(c: KeepsakeCaption): string[] {
  return [
    c.dateLine,
    c.headline,
    ...c.facts.map(f => f.text),
    ...(c.note ? [c.note.lead, c.note.highlight, c.note.trail] : []),
  ];
}

function factText(c: KeepsakeCaption, kind: string): string | undefined {
  return c.facts.find(f => f.kind === kind)?.text;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// A Thursday.
const THURSDAY_8AM = new Date(2026, 7, 20, 8, 15).getTime();
const NOW = new Date(2026, 7, 20, 12, 0).getTime();

// Same locked brand voice the moment card and Walk Story enforce.
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
  expect(text).not.toContain('undefined');
  expect(text).not.toContain('null');
  expect(text).not.toContain('NaN');
  for (const word of BANNED_WORDS) {
    expect(text.toLowerCase()).not.toContain(word);
  }
}

describe('partOfDay', () => {
  it('reads the clock the way an owner would', () => {
    expect(partOfDay(new Date(2026, 7, 20, 6, 0).getTime())).toBe('morning');
    expect(partOfDay(new Date(2026, 7, 20, 13, 0).getTime())).toBe('afternoon');
    expect(partOfDay(new Date(2026, 7, 20, 19, 0).getTime())).toBe('evening');
    expect(partOfDay(new Date(2026, 7, 20, 23, 0).getTime())).toBe('night');
    expect(partOfDay(new Date(2026, 7, 20, 3, 0).getTime())).toBe('night');
  });
});

describe('elapsedPhrase', () => {
  it('describes where in the walk it happened', () => {
    expect(elapsedPhrase(720)).toBe('12 minutes in');
    expect(elapsedPhrase(60)).toBe('1 minute in');
  });

  it('has a phrase for the very beginning', () => {
    expect(elapsedPhrase(10)).toBe('Right at the start');
  });

  it('says nothing when the walk start is unknown', () => {
    expect(elapsedPhrase(null)).toBeNull();
    expect(elapsedPhrase(undefined)).toBeNull();
    expect(elapsedPhrase(NaN)).toBeNull();
    expect(elapsedPhrase(-5)).toBeNull();
  });
});

describe('distancePhrase', () => {
  it('switches to km once there is a km to talk about', () => {
    expect(distancePhrase(1240)).toBe('1.2 km in');
    expect(distancePhrase(320)).toBe('320 m in');
  });

  it('stays quiet about a distance too small to be interesting', () => {
    // "8 m in" is noise, not context.
    expect(distancePhrase(8)).toBeNull();
    expect(distancePhrase(null)).toBeNull();
    expect(distancePhrase(NaN)).toBeNull();
  });
});

describe('weatherPhrase', () => {
  it('reports what was recorded', () => {
    expect(weatherPhrase({ tempC: 23.4, label: 'Clear' })).toBe('23°, clear');
  });

  it('degrades to the temperature alone', () => {
    expect(weatherPhrase({ tempC: 8, label: '' })).toBe('8°');
  });

  it('says nothing when no weather was recorded', () => {
    expect(weatherPhrase(null)).toBeNull();
    expect(weatherPhrase(undefined)).toBeNull();
    expect(weatherPhrase({ tempC: NaN, label: 'clear' })).toBeNull();
  });
});

describe('dateLineFor', () => {
  it('reads as a dateline', () => {
    expect(dateLineFor(THURSDAY_8AM)).toBe('THURSDAY, 20 AUGUST');
  });
});

describe('agoPhrase', () => {
  it('stays quiet about something recent', () => {
    // A photo from this morning does not need telling you it was today.
    expect(agoPhrase(NOW - 2 * DAY_MS, NOW)).toBeNull();
    expect(agoPhrase(NOW - 6 * DAY_MS, NOW)).toBeNull();
  });

  it('scales its unit with the distance in time', () => {
    expect(agoPhrase(NOW - 8 * DAY_MS, NOW)).toBe('A week ago');
    expect(agoPhrase(NOW - 21 * DAY_MS, NOW)).toBe('3 weeks ago');
    expect(agoPhrase(NOW - 120 * DAY_MS, NOW)).toBe('4 months ago');
    expect(agoPhrase(NOW - 400 * DAY_MS, NOW)).toBe('A year ago');
    expect(agoPhrase(NOW - 900 * DAY_MS, NOW)).toBe('2 years ago');
  });
});

describe('buildKeepsakeCaption', () => {
  const base = {
    capturedAt: THURSDAY_8AM,
    elapsedS: 720,
    distanceM: 900,
    petName: 'Bunny',
    placeLabel: 'Arpora',
    weather: { tempC: 23, label: 'Clear' },
    now: NOW,
  };

  it('names the dog and sets the scene', () => {
    const caption = buildKeepsakeCaption(base);
    expect(caption.headline).toBe('Bunny, Thursday morning');
    expect(factText(caption, 'elapsed')).toBe('12 minutes in');
    expect(factText(caption, 'distance')).toBe('900 m in');
    expect(factText(caption, 'place')).toBe('Near Arpora');
    expect(factText(caption, 'weather')).toBe('23°, clear');
  });

  it('opens on a dateline', () => {
    expect(buildKeepsakeCaption(base).dateLine).toBe('THURSDAY, 20 AUGUST');
  });

  it('orders facts so the walk comes before the world', () => {
    // Time, then distance, then place, then weather — narrowing from "where in
    // the walk" out to "what it was like".
    expect(buildKeepsakeCaption(base).facts.map(f => f.kind)).toEqual([
      'elapsed',
      'distance',
      'place',
      'weather',
    ]);
  });

  it('still works with no name', () => {
    const caption = buildKeepsakeCaption({ ...base, petName: null });
    expect(caption.headline).toBe('Thursday morning');
  });

  it('drops missing facts rather than inventing them', () => {
    const caption = buildKeepsakeCaption({
      capturedAt: THURSDAY_8AM,
      now: NOW,
      petName: 'Bunny',
    });
    expect(caption.facts).toEqual([]);
    expect(caption.headline).toBe('Bunny, Thursday morning');
  });

  it('keeps only the facts it actually has', () => {
    const caption = buildKeepsakeCaption({ ...base, weather: null, placeLabel: null });
    expect(caption.facts.map(f => f.kind)).toEqual(['elapsed', 'distance']);
  });

  describe('the note', () => {
    it('says nothing for an ordinary, recent first visit', () => {
      expect(buildKeepsakeCaption(base).note).toBeNull();
    });

    it('counts every stop here, including this one', () => {
      // 1 prior visit + this photo = "2 times". Off-by-one here would make the
      // product quietly wrong about the thing it is proudest of noticing.
      expect(buildKeepsakeCaption({ ...base, priorVisits: 1 }).note).toEqual({
        kind: 'visits',
        lead: 'You’ve stopped here together ',
        highlight: '2 times',
        trail: '.',
      });
      expect(buildKeepsakeCaption({ ...base, priorVisits: 6 }).note?.highlight).toBe('7 times');
    });

    it('falls back to how long ago it was', () => {
      const old = { ...base, capturedAt: NOW - 400 * DAY_MS };
      expect(buildKeepsakeCaption(old).note).toEqual({
        kind: 'ago',
        lead: '',
        highlight: 'A year ago',
        trail: '.',
      });
    });

    it('prefers the place over the calendar — the relationship outranks the date', () => {
      const old = { ...base, capturedAt: NOW - 400 * DAY_MS, priorVisits: 2 };
      expect(buildKeepsakeCaption(old).note?.highlight).toBe('3 times');
    });
  });

  describe('voice', () => {
    it('every line of a rich caption is brand-voiced', () => {
      const caption = buildKeepsakeCaption({ ...base, priorVisits: 2 });
      for (const line of captionStrings(caption)) assertBrandVoice(line);
    });

    it('a caption with nothing to say leaks no tokens', () => {
      const caption = buildKeepsakeCaption({ capturedAt: THURSDAY_8AM, now: NOW });
      for (const line of captionStrings(caption)) assertBrandVoice(line);
    });
  });
});
