import { ALL_FILTERS, applyFilter, availableFilters, categoriesFor } from './filters';
import type { PawtchiSpot, SpotCategory } from './types';

function spot(category: SpotCategory, id = category): PawtchiSpot {
  return {
    id: `osm:node/${id}`,
    provider: 'osm',
    providerPlaceId: `node/${id}`,
    category,
    name: null,
    latitude: 51.5,
    longitude: -0.12,
    dogAccess: 'unknown',
    accessDescription: null,
    address: null,
    openingHours: null,
    website: null,
    phone: null,
    surface: null,
    fenced: null,
    lit: null,
    dogWaterConfirmed: false,
    emergencyCareConfirmed: false,
    sourceUpdatedAt: null,
    fetchedAt: '2026-08-16T10:00:00.000Z',
  };
}

const EVERYTHING = [
  spot('off_leash_park'),
  spot('dog_friendly_park'),
  spot('dog_friendly_beach'),
  spot('walking_trail'),
  spot('veterinary'),
  spot('pet_store'),
  spot('drinking_water'),
];

describe('applyFilter', () => {
  it('all passes everything through', () => {
    expect(applyFilter(EVERYTHING, 'all')).toHaveLength(EVERYTHING.length);
  });

  it('off_leash narrows to just off-leash parks', () => {
    expect(applyFilter(EVERYTHING, 'off_leash').map(s => s.category)).toEqual([
      'off_leash_park',
    ]);
  });

  it('parks INCLUDES off-leash — an off-leash park is still a park', () => {
    // Someone filtering for green space would be confused to see the nearest
    // park vanish because it happens to be the good one.
    expect(applyFilter(EVERYTHING, 'parks').map(s => s.category)).toContain(
      'off_leash_park',
    );
  });

  it.each([
    ['vets', 'veterinary'],
    ['stores', 'pet_store'],
    ['water', 'drinking_water'],
  ] as const)('%s selects only %s', (filter, category) => {
    expect(applyFilter(EVERYTHING, filter).map(s => s.category)).toEqual([category]);
  });

  it('does not mutate its input', () => {
    const before = EVERYTHING.map(s => s.id);
    applyFilter(EVERYTHING, 'vets');
    expect(EVERYTHING.map(s => s.id)).toEqual(before);
  });

  it('every filter maps to at least one category', () => {
    for (const filter of ALL_FILTERS) {
      if (filter === 'all') continue;
      expect(categoriesFor(filter)!.length).toBeGreaterThan(0);
    }
  });

  it('every category is reachable by some filter', () => {
    // Guards against adding a category and orphaning it behind no chip.
    const reachable = new Set<SpotCategory>();
    for (const filter of ALL_FILTERS) {
      categoriesFor(filter)?.forEach(c => reachable.add(c));
    }
    for (const s of EVERYTHING) expect(reachable.has(s.category)).toBe(true);
  });
});

describe('availableFilters', () => {
  it('always offers all', () => {
    expect(availableFilters([]).has('all')).toBe(true);
  });

  it('offers only chips that would lead somewhere', () => {
    const available = availableFilters([spot('veterinary')]);
    expect(available.has('vets')).toBe(true);
    expect(available.has('water')).toBe(false);
    expect(available.has('off_leash')).toBe(false);
  });

  it('an off-leash park lights both off_leash and parks', () => {
    const available = availableFilters([spot('off_leash_park')]);
    expect(available.has('off_leash')).toBe(true);
    expect(available.has('parks')).toBe(true);
  });
});
