/**
 * Copy tests, which in this feature are correctness tests.
 *
 * The label attached to a `dogAccess` value is the whole difference between an
 * honest product and one that gets a dog into trouble, so the mapping is
 * asserted rather than trusted to survive a later tidy-up.
 */

import {
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  DOG_ACCESS_LABEL,
  copy,
  displayName,
  distanceBucket,
  formatDistance,
  showsDogAccess,
} from './copy';
import { ALL_SPOT_CATEGORIES, type DogAccessStatus } from './types';

describe('labels', () => {
  it('covers every category', () => {
    for (const c of ALL_SPOT_CATEGORIES) {
      expect(CATEGORY_LABEL[c]).toBeTruthy();
      expect(CATEGORY_SHORT[c]).toBeTruthy();
    }
  });

  it('never claims dog access it cannot support', () => {
    expect(DOG_ACCESS_LABEL.unknown).toBe('Dog access not confirmed');
    // The failure mode this guards: someone "simplifying" unknown to a yes.
    expect(DOG_ACCESS_LABEL.unknown.toLowerCase()).not.toMatch(/allowed|friendly|welcome/);
  });

  it('reserves off-leash wording for the off-leash status only', () => {
    const offLeashish = (Object.entries(DOG_ACCESS_LABEL) as [DogAccessStatus, string][])
      .filter(([, label]) => /off-leash/i.test(label))
      .map(([status]) => status);
    expect(offLeashish).toEqual(['off_leash']);
  });

  it('labels generic water as water, not dog water', () => {
    expect(CATEGORY_LABEL.drinking_water).toBe('Drinking water');
    expect(CATEGORY_LABEL.drinking_water.toLowerCase()).not.toContain('dog');
  });

  it('does not call a vet an emergency vet by default', () => {
    expect(CATEGORY_LABEL.veterinary.toLowerCase()).not.toContain('emergency');
  });

  it('keeps the accuracy disclaimer on the details sheet', () => {
    expect(copy.details.accuracyNote).toContain('may have changed');
  });

  it('blames the map, not the world, in the empty state', () => {
    expect(copy.empty.title).toContain('mapped');
  });

  it('has something to cycle while the request is in flight', () => {
    // A card that never changes reads as frozen well before it has failed.
    expect(copy.loadingLines.length).toBeGreaterThan(1);
    for (const line of copy.loadingLines) expect(line.trim().length).toBeGreaterThan(0);
  });

  it('does not narrate steps the request does not take', () => {
    // One Overpass call covers every category at once, so copy implying a
    // sequence ("now checking vets…") would be describing work that is not
    // happening in that order.
    for (const line of copy.loadingLines) {
      expect(line.toLowerCase()).not.toMatch(/\bnow\b|\bnext\b|step|then/);
    }
  });

  it('names the slow part honestly rather than apologising vaguely', () => {
    expect(copy.loadingSlow).toContain('OpenStreetMap');
  });
});

describe('showsDogAccess', () => {
  it('shows the badge where a dog policy is a real question', () => {
    expect(showsDogAccess('off_leash_park')).toBe(true);
    expect(showsDogAccess('dog_friendly_park')).toBe(true);
    expect(showsDogAccess('dog_friendly_beach')).toBe(true);
    expect(showsDogAccess('walking_trail')).toBe(true);
  });

  it('suppresses it where the question is meaningless', () => {
    // A live London probe captioned 46 drinking fountains "Dog access not
    // confirmed". Repeating a hedge that often teaches people to stop reading
    // it — exactly when it would have mattered on the park below.
    expect(showsDogAccess('drinking_water')).toBe(false);
    expect(showsDogAccess('veterinary')).toBe(false);
    expect(showsDogAccess('pet_store')).toBe(false);
  });

  it('covers every category', () => {
    for (const c of ALL_SPOT_CATEGORIES) {
      expect(typeof showsDogAccess(c)).toBe('boolean');
    }
  });
});

describe('displayName', () => {
  it('uses the real name when there is one', () => {
    expect(displayName('Elm Row Dog Park', 'off_leash_park')).toBe('Elm Row Dog Park');
  });

  it('falls back to the category, never to an identifier', () => {
    expect(displayName(null, 'off_leash_park')).toBe('Off-leash dog park');
    expect(displayName('', 'veterinary')).toBe('Veterinary clinic');
    expect(displayName('   ', 'pet_store')).toBe('Pet store');
    expect(displayName(undefined, 'drinking_water')).toBe('Drinking water');
  });
});

describe('formatDistance', () => {
  it('rounds metres to a readable step', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(123)).toBe('120 m');
    expect(formatDistance(999)).toBe('1000 m');
  });

  it('switches to km with one decimal, then drops it when large', () => {
    expect(formatDistance(1400)).toBe('1.4 km');
    expect(formatDistance(12000)).toBe('12 km');
  });

  it('returns null rather than a fake distance', () => {
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(undefined)).toBeNull();
    expect(formatDistance(NaN)).toBeNull();
    expect(formatDistance(-5)).toBeNull();
  });
});

describe('distanceBucket', () => {
  it('buckets rather than reporting a coordinate-grade number', () => {
    // A precise distance plus a timestamp is a location fix; buckets answer
    // every product question we actually have.
    expect(distanceBucket(120)).toBe('0-500m');
    expect(distanceBucket(700)).toBe('500m-1km');
    expect(distanceBucket(1500)).toBe('1-2km');
    expect(distanceBucket(3000)).toBe('2-5km');
    expect(distanceBucket(9000)).toBe('5km+');
    expect(distanceBucket(null)).toBe('unknown');
  });

  it('never emits a raw number', () => {
    for (const d of [0, 42, 999, 4321, 99999]) {
      expect(distanceBucket(d)).not.toMatch(/^\d+$/);
    }
  });
});
