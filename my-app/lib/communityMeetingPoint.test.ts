import {
  EMPTY_MEETING_POINT,
  coordinateLabel,
  isMeetingPointReady,
  isPinned,
  meetingPointStatus,
  suggestLabel,
} from './communityMeetingPoint';

const at = (lat: number | null, lng: number | null, label = 'The park') => ({ label, lat, lng });

describe('isPinned', () => {
  it('accepts a real coordinate', () => {
    expect(isPinned(at(-33.8968, 151.2333))).toBe(true);
  });

  it('accepts the null island rather than inventing a rule against it', () => {
    // 0,0 is in the Gulf of Guinea and is almost always a bug — but it is a
    // valid coordinate, and this function's job is validity, not plausibility.
    expect(isPinned(at(0, 0))).toBe(true);
  });

  it('rejects a missing coordinate', () => {
    expect(isPinned(at(null, null))).toBe(false);
    expect(isPinned(at(-33.8968, null))).toBe(false);
    expect(isPinned(at(null, 151.2333))).toBe(false);
  });

  it('rejects NaN, which a null check would let through', () => {
    // The failure this exists for: `NaN != null` is true, so a NaN latitude
    // survives every obvious guard and lands a pin in the Atlantic.
    expect(isPinned(at(NaN, 151.2333))).toBe(false);
    expect(isPinned(at(-33.8968, NaN))).toBe(false);
  });

  it('rejects infinities', () => {
    expect(isPinned(at(Infinity, 0))).toBe(false);
    expect(isPinned(at(0, -Infinity))).toBe(false);
  });

  it('rejects out-of-range values, including a swapped pair', () => {
    // 151 is a perfectly good longitude and an impossible latitude. Catching it
    // here is how a lat/lng transposition stops being a mystery pin.
    expect(isPinned(at(151.2333, -33.8968))).toBe(false);
    expect(isPinned(at(0, 181))).toBe(false);
  });

  it('accepts the exact poles and the antimeridian', () => {
    expect(isPinned(at(90, 180))).toBe(true);
    expect(isPinned(at(-90, -180))).toBe(true);
  });
});

describe('isMeetingPointReady', () => {
  it('needs words, not a pin', () => {
    expect(isMeetingPointReady(at(null, null, 'By the gates'))).toBe(true);
  });

  it('refuses whitespace dressed up as a label', () => {
    expect(isMeetingPointReady(at(-33.9, 151.2, '   '))).toBe(false);
  });

  it('refuses a single character', () => {
    expect(isMeetingPointReady(at(null, null, 'a'))).toBe(false);
  });

  it('refuses the empty point', () => {
    expect(isMeetingPointReady(EMPTY_MEETING_POINT)).toBe(false);
  });
});

describe('meetingPointStatus', () => {
  it('reports what it actually has', () => {
    expect(meetingPointStatus(EMPTY_MEETING_POINT)).toBe('empty');
    expect(meetingPointStatus(at(null, null, 'By the gates'))).toBe('described');
    expect(meetingPointStatus(at(-33.8968, 151.2333, 'By the gates'))).toBe('pinned');
  });

  it('is empty when there is a pin but no words', () => {
    // A coordinate nobody can read is not a meeting point someone can find.
    expect(meetingPointStatus(at(-33.8968, 151.2333, ''))).toBe('empty');
  });
});

describe('coordinateLabel', () => {
  it('rounds to about eleven metres', () => {
    expect(coordinateLabel(at(-33.89681234, 151.23334321))).toBe('-33.8968, 151.2333');
  });

  it('says nothing when there is no pin', () => {
    expect(coordinateLabel(at(null, null))).toBeNull();
  });
});

describe('suggestLabel', () => {
  it('never overwrites what a person typed', () => {
    expect(suggestLabel('by the gates', 'Anzac Parade')).toBe('by the gates');
  });

  it('fills an untouched field from the map', () => {
    expect(suggestLabel('', 'Anzac Parade')).toBe('Anzac Parade');
  });

  it('treats whitespace as untouched', () => {
    expect(suggestLabel('   ', 'Anzac Parade')).toBe('Anzac Parade');
  });

  it('leaves the field empty when the map has no name either', () => {
    expect(suggestLabel('', null)).toBe('');
  });

  it('preserves the typed value exactly, spacing included', () => {
    // Returned untrimmed on purpose: this feeds a controlled TextInput, and
    // trimming mid-edit would eat the space someone just typed between words.
    expect(suggestLabel('by the gates ', null)).toBe('by the gates ');
  });
});
