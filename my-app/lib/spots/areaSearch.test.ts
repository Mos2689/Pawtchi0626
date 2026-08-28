import {
  AREA_SEARCH_SHIFT_FRACTION,
  MIN_AREA_SEARCH_SHIFT_M,
  areaSearchThreshold,
  shouldOfferAreaSearch,
} from './areaSearch';
import { haversineMeters } from '../walk/geo';

const HERE = { lat: 15.5449, lng: 73.7553 };

/** A point `metres` due north of `from`. Keeps the tests readable. */
function north(from: { lat: number; lng: number }, metres: number) {
  return { lat: from.lat + metres / 111_320, lng: from.lng };
}

describe('areaSearchThreshold', () => {
  test('scales with the radius once past the floor', () => {
    expect(areaSearchThreshold(3000)).toBeCloseTo(3000 * AREA_SEARCH_SHIFT_FRACTION, 6);
    expect(areaSearchThreshold(5000)).toBeCloseTo(5000 * AREA_SEARCH_SHIFT_FRACTION, 6);
  });

  test('never drops below the floor, however small the radius', () => {
    expect(areaSearchThreshold(100)).toBe(MIN_AREA_SEARCH_SHIFT_M);
    expect(areaSearchThreshold(1)).toBe(MIN_AREA_SEARCH_SHIFT_M);
  });

  test('a wider search tolerates a longer pan before re-asking', () => {
    expect(areaSearchThreshold(5000)).toBeGreaterThan(areaSearchThreshold(3000));
  });
});

describe('shouldOfferAreaSearch', () => {
  const RADIUS = 3000;

  test('a nudge is not a new question', () => {
    expect(
      shouldOfferAreaSearch({
        viewCenter: north(HERE, 200),
        searchedCenter: HERE,
        radiusMeters: RADIUS,
      }),
    ).toBe(false);
  });

  test('moving well past the threshold earns the offer', () => {
    const far = north(HERE, 2000);
    // Guard the fixture itself: the helper's flat-earth metres must really be
    // past the threshold under the real haversine the function uses.
    expect(haversineMeters(HERE, far)).toBeGreaterThan(areaSearchThreshold(RADIUS));
    expect(
      shouldOfferAreaSearch({ viewCenter: far, searchedCenter: HERE, radiusMeters: RADIUS }),
    ).toBe(true);
  });

  test('exactly at the threshold does not offer — the boundary is exclusive', () => {
    // Same point is the only distance we can assert exactly; it stands for the
    // "has not moved past it" side of the comparison.
    expect(
      shouldOfferAreaSearch({ viewCenter: HERE, searchedCenter: HERE, radiusMeters: RADIUS }),
    ).toBe(false);
  });

  test('a wider radius swallows a pan that a narrow one would question', () => {
    const moved = north(HERE, 1300);
    expect(
      shouldOfferAreaSearch({ viewCenter: moved, searchedCenter: HERE, radiusMeters: 3000 }),
    ).toBe(true);
    expect(
      shouldOfferAreaSearch({ viewCenter: moved, searchedCenter: HERE, radiusMeters: 5000 }),
    ).toBe(false);
  });

  // Every one of these is a state the screen genuinely passes through on the
  // way up: the map has not reported yet, or nothing has been searched yet.
  test('missing information never produces an offer', () => {
    expect(
      shouldOfferAreaSearch({ viewCenter: null, searchedCenter: HERE, radiusMeters: RADIUS }),
    ).toBe(false);
    expect(
      shouldOfferAreaSearch({
        viewCenter: north(HERE, 5000),
        searchedCenter: null,
        radiusMeters: RADIUS,
      }),
    ).toBe(false);
    expect(
      shouldOfferAreaSearch({
        viewCenter: north(HERE, 5000),
        searchedCenter: HERE,
        radiusMeters: 0,
      }),
    ).toBe(false);
    expect(
      shouldOfferAreaSearch({
        viewCenter: north(HERE, 5000),
        searchedCenter: HERE,
        radiusMeters: NaN,
      }),
    ).toBe(false);
  });

  test('a corrupt coordinate is refused rather than compared', () => {
    expect(
      shouldOfferAreaSearch({
        viewCenter: { lat: NaN, lng: 73.75 },
        searchedCenter: HERE,
        radiusMeters: RADIUS,
      }),
    ).toBe(false);
  });
});
