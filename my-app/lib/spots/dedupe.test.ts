import { MERGE_RADIUS_M, dedupeSpots, richness } from './dedupe';
import type { PawtchiSpot } from './types';

function spot(over: Partial<PawtchiSpot> = {}): PawtchiSpot {
  return {
    id: 'osm:node/1',
    provider: 'osm',
    providerPlaceId: 'node/1',
    category: 'veterinary',
    name: null,
    latitude: 51.5,
    longitude: -0.12,
    dogAccess: 'dog_friendly',
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
    ...over,
  };
}

/** ~1 m of latitude, for building "same building, two mappings" cases. */
const METRE_LAT = 1 / 111_320;

describe('dedupeSpots', () => {
  it('collapses the same element returned twice by a union query', () => {
    expect(dedupeSpots([spot(), spot()])).toHaveLength(1);
  });

  it('collapses two mappings of one place — node plus building outline', () => {
    const asNode = spot({ id: 'osm:node/1', providerPlaceId: 'node/1' });
    const asWay = spot({
      id: 'osm:way/2',
      providerPlaceId: 'way/2',
      latitude: 51.5 + METRE_LAT * 10,
    });
    expect(dedupeSpots([asNode, asWay])).toHaveLength(1);
  });

  it('keeps genuinely separate neighbours apart', () => {
    const a = spot({ id: 'osm:node/1' });
    const b = spot({ id: 'osm:node/2', latitude: 51.5 + METRE_LAT * (MERGE_RADIUS_M + 40) });
    expect(dedupeSpots([a, b])).toHaveLength(2);
  });

  it('never merges across categories, however close', () => {
    const vet = spot({ id: 'osm:node/1', category: 'veterinary' });
    const shop = spot({ id: 'osm:node/2', category: 'pet_store' });
    expect(dedupeSpots([vet, shop])).toHaveLength(2);
  });

  it('keeps the name when the richer record has one', () => {
    const unnamed = spot({ id: 'osm:node/1' });
    const named = spot({
      id: 'osm:way/2',
      providerPlaceId: 'way/2',
      name: 'Fairhaven Veterinary',
      latitude: 51.5 + METRE_LAT * 5,
    });
    expect(dedupeSpots([unnamed, named])[0].name).toBe('Fairhaven Veterinary');
    // Order must not change the outcome.
    expect(dedupeSpots([named, unnamed])[0].name).toBe('Fairhaven Veterinary');
  });

  it('unions fields rather than discarding the poorer record wholesale', () => {
    // The real case: a node carries the phone, the building way carries hours.
    const withPhone = spot({ id: 'osm:node/1', name: 'Vet', phone: '+44 117' });
    const withHours = spot({
      id: 'osm:way/2',
      providerPlaceId: 'way/2',
      openingHours: 'Mo-Fr 09:00-18:00',
      latitude: 51.5 + METRE_LAT * 5,
    });
    const [merged] = dedupeSpots([withPhone, withHours]);
    expect(merged.phone).toBe('+44 117');
    expect(merged.openingHours).toBe('Mo-Fr 09:00-18:00');
  });

  it('prefers a known dog access over an unknown one regardless of richness', () => {
    const richButUnknown = spot({
      id: 'osm:node/1',
      category: 'dog_friendly_park',
      name: 'Big Park',
      website: 'https://x.test',
      phone: '1',
      address: 'a',
      dogAccess: 'unknown',
    });
    const poorButKnown = spot({
      id: 'osm:way/2',
      providerPlaceId: 'way/2',
      category: 'dog_friendly_park',
      dogAccess: 'on_leash',
      latitude: 51.5 + METRE_LAT * 5,
    });
    expect(dedupeSpots([richButUnknown, poorButKnown])[0].dogAccess).toBe('on_leash');
  });

  it('is deterministic and order-preserving for survivors', () => {
    const a = spot({ id: 'osm:node/1', latitude: 51.5 });
    const b = spot({ id: 'osm:node/2', latitude: 51.6 });
    const c = spot({ id: 'osm:node/3', latitude: 51.7 });
    const once = dedupeSpots([a, b, c]).map(s => s.id);
    expect(once).toEqual(['osm:node/1', 'osm:node/2', 'osm:node/3']);
    expect(dedupeSpots([a, b, c]).map(s => s.id)).toEqual(once);
  });

  it('handles an empty list', () => {
    expect(dedupeSpots([])).toEqual([]);
  });
});

describe('richness', () => {
  it('weights a name above everything else combined', () => {
    const named = spot({ name: 'X' });
    const detailedButAnonymous = spot({
      openingHours: 'x',
      phone: 'x',
      website: 'x',
      address: 'x',
    });
    expect(richness(named)).toBeGreaterThan(richness(detailedButAnonymous));
  });
});
