import { CONFIRMED_ACCESS_BONUS_M, prepareForDisplay, rankSpots, withDistances, withinRadius } from './rank';
import type { DogAccessStatus, PawtchiSpot } from './types';

const HERE = { lat: 51.5, lng: -0.12 };
const METRE_LAT = 1 / 111_320;

function at(metresNorth: number, over: Partial<PawtchiSpot> = {}): PawtchiSpot {
  return {
    id: `osm:node/${metresNorth}`,
    provider: 'osm',
    providerPlaceId: `node/${metresNorth}`,
    category: 'dog_friendly_park',
    name: null,
    latitude: HERE.lat + METRE_LAT * metresNorth,
    longitude: HERE.lng,
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
    ...over,
  };
}

describe('withDistances', () => {
  it('measures from the real position, not the cell centre', () => {
    const [spot] = withDistances([at(500)], HERE);
    expect(spot.distanceMeters).toBeGreaterThan(480);
    expect(spot.distanceMeters).toBeLessThan(520);
  });
});

describe('withinRadius', () => {
  it('drops the cell query over-fetch', () => {
    const spots = withDistances([at(1000), at(4000)], HERE);
    expect(withinRadius(spots, 3000).map(s => s.id)).toEqual(['osm:node/1000']);
  });
});

describe('rankSpots', () => {
  it('sorts by distance when access confidence is equal', () => {
    const spots = withDistances([at(2000), at(300), at(900)], HERE);
    expect(rankSpots(spots).map(s => s.distanceMeters)).toEqual(
      [...spots.map(s => s.distanceMeters!)].sort((a, b) => a - b),
    );
  });

  it('lifts a confirmed spot above nearer unverified ones', () => {
    // The point of the whole file: without this, the one park we can vouch for
    // sits under four patches of grass nobody has tagged.
    const confirmed = at(600, { id: 'osm:node/confirmed', dogAccess: 'off_leash' });
    const unknownNearer = at(400, { id: 'osm:node/unknown' });
    const ranked = rankSpots(withDistances([unknownNearer, confirmed], HERE));
    expect(ranked[0].id).toBe('osm:node/confirmed');
  });

  it('still lets a much nearer unknown win — geography dominates at scale', () => {
    const confirmed = at(3000, { id: 'osm:node/confirmed', dogAccess: 'off_leash' });
    const unknownMuchNearer = at(100, { id: 'osm:node/unknown' });
    const ranked = rankSpots(withDistances([confirmed, unknownMuchNearer], HERE));
    expect(ranked[0].id).toBe('osm:node/unknown');
  });

  it('applies the bonus at exactly the documented threshold', () => {
    const confirmed = at(1000, { id: 'osm:a', dogAccess: 'off_leash' });
    // Just inside the bonus — the confirmed one should still lead.
    const unknown = at(1000 + CONFIRMED_ACCESS_BONUS_M - 50, { id: 'osm:b' });
    expect(rankSpots(withDistances([unknown, confirmed], HERE))[0].id).toBe('osm:a');
  });

  it.each<DogAccessStatus>(['off_leash', 'on_leash', 'dog_friendly'])(
    'treats %s as confirmed',
    access => {
      const confirmed = at(600, { id: 'osm:a', dogAccess: access });
      const unknown = at(400, { id: 'osm:b' });
      expect(rankSpots(withDistances([unknown, confirmed], HERE))[0].id).toBe('osm:a');
    },
  );

  it('is a total, stable order — equal spots never swap between renders', () => {
    const a = at(500, { id: 'osm:node/a' });
    const b = at(500, { id: 'osm:node/b' });
    expect(rankSpots(withDistances([a, b], HERE)).map(s => s.id)).toEqual(
      rankSpots(withDistances([b, a], HERE)).map(s => s.id),
    );
  });

  it('does not mutate its input', () => {
    const spots = withDistances([at(2000), at(300)], HERE);
    const before = spots.map(s => s.id);
    rankSpots(spots);
    expect(spots.map(s => s.id)).toEqual(before);
  });
});

describe('prepareForDisplay', () => {
  it('measures, trims and orders in one pass', () => {
    const result = prepareForDisplay(
      [at(4000), at(800), at(200, { dogAccess: 'off_leash' })],
      HERE,
      3000,
    );
    expect(result.map(s => s.id)).toEqual(['osm:node/200', 'osm:node/800']);
    expect(result.every(s => typeof s.distanceMeters === 'number')).toBe(true);
  });
});
