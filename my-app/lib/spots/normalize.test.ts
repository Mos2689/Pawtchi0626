/**
 * Overpass element → PawtchiSpot.
 *
 * The coordinate cases carry the weight: Overpass gives position three
 * different ways depending on element type, and getting one wrong puts a pin on
 * the wrong street rather than failing visibly.
 */

import {
  coordinateOf,
  normalizeElement,
  normalizeResponse,
  type OverpassElement,
} from './normalize';

const AT = '2026-08-16T10:00:00.000Z';

function node(tags: Record<string, string>, id = 1): OverpassElement {
  return { type: 'node', id, lat: 51.5, lon: -0.12, tags };
}

describe('coordinateOf', () => {
  it('reads a node directly', () => {
    expect(coordinateOf({ type: 'node', id: 1, lat: 51.5, lon: -0.12 })).toEqual({
      lat: 51.5,
      lng: -0.12,
    });
  });

  it('prefers center for ways and relations', () => {
    expect(
      coordinateOf({ type: 'way', id: 2, center: { lat: 51.4, lon: -0.1 } }),
    ).toEqual({ lat: 51.4, lng: -0.1 });
  });

  it('falls back to the midpoint of bounds', () => {
    expect(
      coordinateOf({
        type: 'relation',
        id: 3,
        bounds: { minlat: 51, minlon: -1, maxlat: 53, maxlon: 1 },
      }),
    ).toEqual({ lat: 52, lng: 0 });
  });

  it('falls back to the first geometry vertex — a real point on the feature', () => {
    expect(
      coordinateOf({
        type: 'way',
        id: 4,
        geometry: [
          { lat: 51.1, lon: -0.2 },
          { lat: 51.2, lon: -0.3 },
        ],
      }),
    ).toEqual({ lat: 51.1, lng: -0.2 });
  });

  it('returns null rather than guessing when there is nothing to read', () => {
    expect(coordinateOf({ type: 'relation', id: 5 })).toBeNull();
  });

  it('rejects out-of-range and non-finite coordinates', () => {
    expect(coordinateOf({ type: 'node', id: 6, lat: 91, lon: 0 })).toBeNull();
    expect(coordinateOf({ type: 'node', id: 7, lat: NaN, lon: 0 })).toBeNull();
  });
});

describe('normalizeElement', () => {
  it('builds a provider-neutral spot with a stable id', () => {
    const spot = normalizeElement(node({ leisure: 'dog_park', name: 'Elm Row Dog Park' }, 42), AT);
    expect(spot).toMatchObject({
      id: 'osm:node/42',
      provider: 'osm',
      providerPlaceId: 'node/42',
      category: 'off_leash_park',
      name: 'Elm Row Dog Park',
      dogAccess: 'off_leash',
      fetchedAt: AT,
    });
  });

  it('leaves an unnamed place null rather than inventing a name', () => {
    // The fallback belongs in copy.displayName, not baked into stored data.
    expect(normalizeElement(node({ leisure: 'park' }), AT)?.name).toBeNull();
  });

  it('never lets an OSM id become a name', () => {
    const spot = normalizeElement(node({ amenity: 'veterinary' }, 998877), AT);
    expect(spot?.name).toBeNull();
    expect(JSON.stringify(spot?.name)).not.toContain('998877');
  });

  it('drops excluded, uncategorisable and unlocatable elements', () => {
    expect(normalizeElement(node({ leisure: 'park', dog: 'no' }), AT)).toBeNull();
    expect(normalizeElement(node({ amenity: 'restaurant' }), AT)).toBeNull();
    expect(
      normalizeElement({ type: 'relation', id: 9, tags: { leisure: 'park' } }, AT),
    ).toBeNull();
  });

  it('assembles an address only when there is something to assemble', () => {
    const withAddr = normalizeElement(
      node({
        amenity: 'veterinary',
        'addr:housenumber': '14',
        'addr:street': 'Fairhaven Road',
        'addr:city': 'Bristol',
      }),
      AT,
    );
    expect(withAddr?.address).toBe('14 Fairhaven Road, Bristol');
    expect(normalizeElement(node({ amenity: 'veterinary' }), AT)?.address).toBeNull();
  });

  it('takes contact: variants when the plain key is absent', () => {
    const spot = normalizeElement(
      node({ amenity: 'veterinary', 'contact:phone': '+44 117 000', 'contact:website': 'https://x.test' }),
      AT,
    );
    expect(spot?.phone).toBe('+44 117 000');
    expect(spot?.website).toBe('https://x.test');
  });

  it('resolves the two harmful-if-guessed claims to false by default', () => {
    // These are the badges that could actually hurt someone: a fountain a dog
    // cannot drink from, and a "24h emergency vet" that is neither.
    const water = normalizeElement(node({ amenity: 'drinking_water' }), AT);
    expect(water?.dogWaterConfirmed).toBe(false);

    const vet = normalizeElement(node({ amenity: 'veterinary', opening_hours: '24/7' }), AT);
    expect(vet?.emergencyCareConfirmed).toBe(false);
  });

  it('sets them only on an explicit source tag', () => {
    expect(
      normalizeElement(node({ amenity: 'drinking_water', bowl: 'yes' }), AT)
        ?.dogWaterConfirmed,
    ).toBe(true);
    expect(
      normalizeElement(node({ amenity: 'veterinary', emergency: 'yes' }), AT)
        ?.emergencyCareConfirmed,
    ).toBe(true);
  });

  it('scopes each confirmation to its own category', () => {
    // A park tagged `bowl=yes` must not acquire a water point's badge.
    const park = normalizeElement(node({ leisure: 'park', bowl: 'yes' }), AT);
    expect(park?.dogWaterConfirmed).toBe(false);

    const shop = normalizeElement(node({ shop: 'pet', emergency: 'yes' }), AT);
    expect(shop?.emergencyCareConfirmed).toBe(false);
  });

  it('keeps raw provider tags off the model entirely', () => {
    // The UI must not be able to re-derive its own answer from raw tags — that
    // is how a cautious rule gets quietly relaxed in a later layout tweak.
    const spot = normalizeElement(node({ leisure: 'park', dog: 'no_idea' }), AT);
    expect(spot).not.toHaveProperty('rawTags');
    expect(JSON.stringify(spot)).not.toContain('no_idea');
  });

  it('drops an essay-length description rather than passing it to a card', () => {
    const spot = normalizeElement(
      node({ leisure: 'park', description: 'x'.repeat(400) }),
      AT,
    );
    expect(spot?.accessDescription).toBeNull();
  });
});

describe('normalizeResponse', () => {
  it('survives a malformed element without losing the batch', () => {
    const spots = normalizeResponse(
      {
        elements: [
          node({ leisure: 'dog_park' }, 1),
          null as unknown as OverpassElement,
          node({ amenity: 'veterinary' }, 2),
        ],
      },
      AT,
    );
    expect(spots).toHaveLength(2);
  });

  it('returns empty for junk input rather than throwing', () => {
    expect(normalizeResponse(null, AT)).toEqual([]);
    expect(normalizeResponse({}, AT)).toEqual([]);
    expect(normalizeResponse({ elements: 'nope' } as never, AT)).toEqual([]);
  });
});
