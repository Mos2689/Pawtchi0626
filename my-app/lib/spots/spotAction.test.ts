/**
 * Which button a place gets.
 *
 * The test that matters is the last one: every category must be classified, and
 * an unclassified one must fall to 'maps'. That is the property protecting
 * someone else's routing server from a category we add later and forget about.
 */

import { ALL_SPOT_CATEGORIES, type SpotCategory } from './types';
import { WALK_TO_CATEGORIES, isWalkToSpot, spotAction } from './spotAction';

describe('spotAction — places you walk to', () => {
  it.each<SpotCategory>([
    'off_leash_park',
    'dog_friendly_park',
    'dog_friendly_beach',
    'walking_trail',
  ])('routes %s in-app', category => {
    expect(spotAction(category)).toBe('walk');
  });

  it('keeps drinking water in-app — outdoors, not a premises', () => {
    expect(spotAction('drinking_water')).toBe('walk');
  });
});

describe('spotAction — errands', () => {
  it.each<SpotCategory>(['veterinary', 'pet_store'])(
    'hands %s to the maps app',
    category => {
      expect(spotAction(category)).toBe('maps');
    },
  );

  it('does not offer a tracked walk to a vet', () => {
    // Pawtchi has no traffic and no opening-hours awareness. For a sick animal
    // the right answer is the app that does.
    expect(isWalkToSpot('veterinary')).toBe(false);
  });
});

describe('spotAction — totality', () => {
  it('classifies every category in the model', () => {
    for (const category of ALL_SPOT_CATEGORIES) {
      expect(['walk', 'maps']).toContain(spotAction(category));
    }
  });

  it('defaults an unknown category to maps, never to a routing request', () => {
    // The safe direction to fail: a category added to types.ts and forgotten
    // here sends the owner to a map that works, rather than quietly spending a
    // request on donated infrastructure.
    expect(spotAction('something_new_entirely' as SpotCategory)).toBe('maps');
  });

  it('lists only real categories as walk-to', () => {
    for (const category of WALK_TO_CATEGORIES) {
      expect(ALL_SPOT_CATEGORIES).toContain(category);
    }
  });
});
