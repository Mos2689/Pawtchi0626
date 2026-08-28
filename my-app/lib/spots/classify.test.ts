/**
 * The rules that decide what Pawtchi claims about a place.
 *
 * Weighted heavily toward the negative cases, because those are the ones that
 * hurt someone: a missed park is an inconvenience, a private estate shown as a
 * dog park is a person trespassing, and an untagged field labelled "off-leash"
 * is a dog loose near livestock.
 */

import {
  categoryOf,
  dogAccessOf,
  fencedOf,
  isDogWater,
  isEmergencyVet,
  isExcluded,
  litOf,
} from './classify';

describe('isExcluded', () => {
  it('drops explicitly dog-free places', () => {
    expect(isExcluded({ leisure: 'park', dog: 'no' })).toBe(true);
  });

  it.each(['no', 'private', 'permit'])('drops access=%s', access => {
    expect(isExcluded({ leisure: 'park', access })).toBe(true);
  });

  it('keeps access=customers — a pet shop car park is where owners belong', () => {
    expect(isExcluded({ shop: 'pet', access: 'customers' })).toBe(false);
  });

  it('drops places you cannot walk into', () => {
    expect(isExcluded({ leisure: 'park', foot: 'no' })).toBe(true);
  });

  it('drops lifecycle-flagged places', () => {
    expect(isExcluded({ amenity: 'veterinary', disused: 'yes' })).toBe(true);
    expect(isExcluded({ amenity: 'veterinary', abandoned: 'yes' })).toBe(true);
  });

  it('drops the lifecycle PREFIX form, which is how closed vets are really tagged', () => {
    expect(isExcluded({ 'disused:amenity': 'veterinary' })).toBe(true);
    expect(isExcluded({ 'abandoned:shop': 'pet' })).toBe(true);
    expect(isExcluded({ 'demolished:leisure': 'park' })).toBe(true);
  });

  it('keeps an ordinary park with no access tags at all', () => {
    expect(isExcluded({ leisure: 'park' })).toBe(false);
  });

  it('drops tidal foreshore, which is not a beach you can walk a dog on', () => {
    // A live London probe returned twelve of these, one 480m from Leicester
    // Square — the entire Thames foreshore, unnamed, each rendering as a card
    // saying "Beach". It is submerged half of every day.
    expect(
      isExcluded({ natural: 'beach', surface: 'sand', tidal: 'yes' }),
    ).toBe(true);
  });

  it('keeps a real beach', () => {
    expect(isExcluded({ natural: 'beach', surface: 'sand' })).toBe(false);
    expect(isExcluded({ natural: 'beach', tidal: 'no' })).toBe(false);
  });

  it('does not let tidal exclude non-beaches', () => {
    // `tidal=yes` on a river or a path says something else entirely.
    expect(isExcluded({ leisure: 'park', tidal: 'yes' })).toBe(false);
  });
});

describe('categoryOf', () => {
  it.each([
    [{ leisure: 'dog_park' }, 'off_leash_park'],
    [{ leisure: 'park', dog: 'unleashed' }, 'off_leash_park'],
    [{ amenity: 'veterinary' }, 'veterinary'],
    [{ shop: 'pet' }, 'pet_store'],
    [{ shop: 'pet_grooming' }, 'pet_store'],
    [{ amenity: 'drinking_water' }, 'drinking_water'],
    [{ natural: 'beach' }, 'dog_friendly_beach'],
    [{ leisure: 'park' }, 'dog_friendly_park'],
    [{ leisure: 'garden' }, 'dog_friendly_park'],
    [{ leisure: 'nature_reserve' }, 'dog_friendly_park'],
    [{ route: 'hiking' }, 'walking_trail'],
  ])('%p → %s', (tags, expected) => {
    expect(categoryOf(tags as Record<string, string>)).toBe(expected);
  });

  it('prefers off-leash when a dog run sits inside a park', () => {
    // The ordering in CATEGORY_RULES is what guarantees this. If someone
    // reorders that array for tidiness, this is the test that catches it.
    expect(categoryOf({ leisure: 'dog_park', park: 'yes' })).toBe('off_leash_park');
    expect(categoryOf({ leisure: 'park', dog: 'unleashed' })).toBe('off_leash_park');
  });

  it('returns null for anything unrecognised', () => {
    expect(categoryOf({ amenity: 'restaurant' })).toBeNull();
    expect(categoryOf({})).toBeNull();
  });
});

describe('dogAccessOf', () => {
  it('reads explicit tags rather than inferring', () => {
    expect(dogAccessOf({ dog: 'unleashed' }, 'dog_friendly_park')).toBe('off_leash');
    expect(dogAccessOf({ dog: 'leashed' }, 'dog_friendly_park')).toBe('on_leash');
    expect(dogAccessOf({ dog: 'yes' }, 'dog_friendly_park')).toBe('dog_friendly');
    expect(dogAccessOf({ dog: 'no' }, 'dog_friendly_park')).toBe('prohibited');
  });

  it('treats designated as off-leash ONLY inside a dog park', () => {
    expect(dogAccessOf({ dog: 'designated' }, 'off_leash_park')).toBe('off_leash');
    // Anywhere else "designated" means dogs are catered for, not loose.
    expect(dogAccessOf({ dog: 'designated' }, 'dog_friendly_beach')).toBe('dog_friendly');
  });

  it('THE untagged-park rule: no dog tag means unknown, never yes', () => {
    expect(dogAccessOf({}, 'dog_friendly_park')).toBe('unknown');
    expect(dogAccessOf({}, 'dog_friendly_beach')).toBe('unknown');
    expect(dogAccessOf({}, 'walking_trail')).toBe('unknown');
  });

  it('infers off-leash only where the category IS the claim', () => {
    expect(dogAccessOf({}, 'off_leash_park')).toBe('off_leash');
  });

  it('does not badge the obvious', () => {
    expect(dogAccessOf({}, 'veterinary')).toBe('dog_friendly');
    expect(dogAccessOf({}, 'pet_store')).toBe('dog_friendly');
  });

  it('lets a dog=no override even a dog_park category', () => {
    // A dog park closed to dogs is contradictory mapping, but if a mapper says
    // no we say no — the refusal must be the one signal nothing overrides.
    expect(dogAccessOf({ dog: 'no' }, 'off_leash_park')).toBe('prohibited');
  });
});

describe('confirmed-only badges', () => {
  it('only calls water dog-usable when the source says so', () => {
    expect(isDogWater({})).toBe(false);
    expect(isDogWater({ amenity: 'drinking_water' })).toBe(false);
    expect(isDogWater({ bowl: 'yes' })).toBe(true);
    expect(isDogWater({ dog: 'yes' })).toBe(true);
  });

  it('never infers an emergency vet', () => {
    expect(isEmergencyVet({ amenity: 'veterinary' })).toBe(false);
    expect(isEmergencyVet({ amenity: 'veterinary', opening_hours: '24/7' })).toBe(false);
    expect(isEmergencyVet({ amenity: 'veterinary', emergency: 'yes' })).toBe(true);
  });
});

describe('tri-state details', () => {
  it('distinguishes false from unknown', () => {
    expect(fencedOf({ barrier: 'fence' })).toBe(true);
    expect(fencedOf({ fence_type: 'chain_link' })).toBe(true);
    expect(fencedOf({ barrier: 'no' })).toBe(false);
    expect(fencedOf({})).toBeNull();

    expect(litOf({ lit: 'yes' })).toBe(true);
    expect(litOf({ lit: 'no' })).toBe(false);
    expect(litOf({})).toBeNull();
  });
});
