import {
  arrivalAt,
  bearingDegrees,
  compassPoint,
  describeWay,
  dogPaceKmh,
  formatEta,
  walkEtaMinutes,
} from './wayfinding';
import { haversineMeters } from './geo';
import { deriveDogWalkProfile } from './dogCalibration';

/** Calangute, roughly where the screenshot was taken. */
const HERE = { lat: 15.5439, lng: 73.7553 };

/** A point a known distance away on a given bearing, for round-tripping. */
function offset(from: { lat: number; lng: number }, dLat: number, dLng: number) {
  return { lat: from.lat + dLat, lng: from.lng + dLng };
}

describe('bearingDegrees', () => {
  it('reads 0 due north and 180 due south', () => {
    expect(bearingDegrees(HERE, offset(HERE, 0.01, 0))).toBeCloseTo(0, 1);
    expect(bearingDegrees(HERE, offset(HERE, -0.01, 0))).toBeCloseTo(180, 1);
  });

  it('reads 90 due east and 270 due west', () => {
    expect(bearingDegrees(HERE, offset(HERE, 0, 0.01))).toBeCloseTo(90, 1);
    expect(bearingDegrees(HERE, offset(HERE, 0, -0.01))).toBeCloseTo(270, 1);
  });

  it('always returns a value in [0, 360)', () => {
    for (const [dLat, dLng] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, -0.5]]) {
      const b = bearingDegrees(HERE, offset(HERE, dLat, dLng));
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });

  it('is roughly reciprocal — there and back differ by about 180', () => {
    const there = offset(HERE, 0.01, 0.01);
    const out = bearingDegrees(HERE, there);
    const back = bearingDegrees(there, HERE);
    const separation = (((out - back) % 360) + 360) % 360;
    expect(Math.abs(separation - 180)).toBeLessThan(1);
  });
});

describe('compassPoint', () => {
  it('maps each cardinal and intercardinal to its word', () => {
    expect(compassPoint(0)).toBe('north');
    expect(compassPoint(45)).toBe('north-east');
    expect(compassPoint(90)).toBe('east');
    expect(compassPoint(135)).toBe('south-east');
    expect(compassPoint(180)).toBe('south');
    expect(compassPoint(225)).toBe('south-west');
    expect(compassPoint(270)).toBe('west');
    expect(compassPoint(315)).toBe('north-west');
  });

  it('centres each sector on its cardinal rather than starting at it', () => {
    // 20° is still north; 25° has tipped into north-east.
    expect(compassPoint(20)).toBe('north');
    expect(compassPoint(25)).toBe('north-east');
  });

  it('wraps cleanly around 360', () => {
    expect(compassPoint(359)).toBe('north');
    expect(compassPoint(360)).toBe('north');
    expect(compassPoint(-10)).toBe('north');
  });
});

describe('walkEtaMinutes', () => {
  it('scales with distance at a fixed pace', () => {
    expect(walkEtaMinutes(1000, 4)).toBe(15);
    expect(walkEtaMinutes(2000, 4)).toBe(30);
  });

  it('rounds to five minutes, never claiming a precise figure', () => {
    for (const d of [700, 1300, 1700, 2400]) {
      expect(walkEtaMinutes(d, 3.5) % 5).toBe(0);
    }
  });

  it('never reports less than five minutes for a real distance', () => {
    expect(walkEtaMinutes(50, 5)).toBe(5);
  });

  it('returns zero rather than Infinity for nonsense input', () => {
    expect(walkEtaMinutes(0, 4)).toBe(0);
    expect(walkEtaMinutes(1000, 0)).toBe(0);
  });
});

describe('formatEta', () => {
  it('is vague at both ends and specific in between', () => {
    expect(formatEta(0)).toBe('');
    expect(formatEta(3)).toBe('under 5 min');
    expect(formatEta(30)).toBe('about 30 min');
    expect(formatEta(65)).toBe('about an hour');
    expect(formatEta(120)).toBe('over an hour');
  });

  it('always hedges — never states a bare number', () => {
    for (const m of [5, 20, 45, 75, 200]) {
      expect(formatEta(m)).toMatch(/about|under|over/);
    }
  });
});

describe('dogPaceKmh', () => {
  it('gives a small breed a slower pace than a working breed', () => {
    const frenchie = deriveDogWalkProfile({
      species: 'dog', breed: 'French Bulldog', ageYears: 4, weightKg: 12, medicalConditions: null,
    });
    const kelpie = deriveDogWalkProfile({
      species: 'dog', breed: 'Australian Kelpie', ageYears: 4, weightKg: 18, medicalConditions: null,
    });
    expect(dogPaceKmh(frenchie.paceBandKmh)).toBeLessThan(dogPaceKmh(kelpie.paceBandKmh));
  });

  it('slows a senior, because dogCalibration already does', () => {
    const adult = deriveDogWalkProfile({
      species: 'dog', breed: 'Labrador Retriever', ageYears: 4, weightKg: 30, medicalConditions: null,
    });
    const senior = deriveDogWalkProfile({
      species: 'dog', breed: 'Labrador Retriever', ageYears: 12, weightKg: 30, medicalConditions: null,
    });
    expect(dogPaceKmh(senior.paceBandKmh)).toBeLessThan(dogPaceKmh(adult.paceBandKmh));
  });
});

describe('describeWay', () => {
  const SPOT = { lat: 15.5501, lng: 73.7625 }; // north-east of HERE
  const distance = haversineMeters(HERE, SPOT);

  it('describes direction and time together', () => {
    const way = describeWay(HERE, SPOT, distance, 3.5)!;
    expect(way.direction).toBe('north-east');
    expect(way.eta).toMatch(/^about \d+ min$/);
  });

  it('returns null without an origin — the honest answer', () => {
    // The caller must pass the OWNER's position, not the map's. On a pannable
    // map those are different facts, and a heading from a suburb the owner is
    // only looking at would point confidently at nothing.
    expect(describeWay(null, SPOT, distance, 3.5)).toBeNull();
    expect(describeWay(undefined, SPOT, distance, 3.5)).toBeNull();
  });

  it('returns null without a destination or a usable distance', () => {
    expect(describeWay(HERE, null, distance, 3.5)).toBeNull();
    expect(describeWay(HERE, SPOT, 0, 3.5)).toBeNull();
    expect(describeWay(HERE, SPOT, null, 3.5)).toBeNull();
  });

  it('agrees with the distance it was handed, not one of its own', () => {
    // Distance and bearing must share an origin or the line contradicts itself.
    const way = describeWay(HERE, SPOT, 1700, 3.4)!;
    expect(way.etaMinutes).toBe(30);
  });
});

describe('arrivalAt', () => {
  const NOON = new Date('2026-08-30T12:00:00.000Z');

  it('adds the estimate to now', () => {
    expect(arrivalAt(NOON, 20).toISOString()).toBe('2026-08-30T12:20:00.000Z');
  });

  it('crosses the hour, and the day, without help', () => {
    expect(arrivalAt(NOON, 75).toISOString()).toBe('2026-08-30T13:15:00.000Z');
    expect(arrivalAt(new Date('2026-08-30T23:50:00.000Z'), 20).toISOString()).toBe(
      '2026-08-31T00:10:00.000Z',
    );
  });

  it('never arrives in the past', () => {
    // A negative estimate is a bug upstream, but "you got there ten minutes
    // ago" is a worse way to find out than simply "now".
    expect(arrivalAt(NOON, -30).toISOString()).toBe(NOON.toISOString());
  });

  it('does not mutate the clock it was given', () => {
    const now = new Date(NOON);
    arrivalAt(now, 45);
    expect(now.toISOString()).toBe(NOON.toISOString());
  });
});
