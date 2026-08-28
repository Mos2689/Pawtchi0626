/**
 * Place cell quantization.
 *
 * The coverage test at the bottom is the one that matters: it pins the property
 * the whole place-memory feature rests on. If the neighbour block ever fails to
 * cover the match radius, the symptom is not an error — it is a tree that
 * quietly stops remembering you, at one latitude, months later.
 */

import { haversineMeters } from './geo';
import {
  PLACE_CELL_DEG,
  PLACE_MATCH_RADIUS_M,
  neighbourPlaceKeys,
  placeCellOf,
  placeKey,
  placeKeyOrNull,
  withinPlaceRadius,
} from './placeKey';

describe('placeCellOf / placeKey', () => {
  it('puts coordinates a few metres apart in the same cell', () => {
    // ~11 m north — well inside one cell.
    expect(placeKey(51.5001, -0.1201)).toBe(placeKey(51.50011, -0.1201));
  });

  it('separates coordinates a cell apart', () => {
    expect(placeKey(51.5, -0.12)).not.toBe(placeKey(51.5 + PLACE_CELL_DEG, -0.12));
    expect(placeKey(51.5, -0.12)).not.toBe(placeKey(51.5, -0.12 + PLACE_CELL_DEG));
  });

  it('floors, so cells tile the plane with no overlap and no gap', () => {
    // Negative coordinates are where round-vs-floor bugs surface.
    expect(placeCellOf(-0.0001, -0.0001)).toEqual({ latIndex: -1, lngIndex: -1 });
    expect(placeCellOf(0.0001, 0.0001)).toEqual({ latIndex: 0, lngIndex: 0 });
  });

  it('is deterministic', () => {
    expect(placeKey(-33.8688, 151.2093)).toBe(placeKey(-33.8688, 151.2093));
  });
});

describe('placeKeyOrNull', () => {
  it('returns null for a walk whose coordinate never resolved', () => {
    expect(placeKeyOrNull(null, null)).toBeNull();
    expect(placeKeyOrNull(51.5, null)).toBeNull();
    expect(placeKeyOrNull(undefined, undefined)).toBeNull();
  });

  it('returns null for junk rather than keying on NaN', () => {
    expect(placeKeyOrNull(NaN, -0.12)).toBeNull();
    expect(placeKeyOrNull(51.5, Infinity)).toBeNull();
  });

  it('matches placeKey for a real coordinate', () => {
    expect(placeKeyOrNull(51.5, -0.12)).toBe(placeKey(51.5, -0.12));
  });
});

describe('neighbourPlaceKeys', () => {
  it('always includes the origin cell', () => {
    expect(neighbourPlaceKeys(51.5, -0.12)).toContain(placeKey(51.5, -0.12));
  });

  it('returns nothing for junk instead of an unbounded key list', () => {
    expect(neighbourPlaceKeys(NaN, -0.12)).toEqual([]);
  });

  it('stays small at ordinary latitudes — this list goes into a DB query', () => {
    expect(neighbourPlaceKeys(51.5, -0.12).length).toBeLessThanOrEqual(25);
    expect(neighbourPlaceKeys(-33.87, 151.21).length).toBeLessThanOrEqual(25);
  });

  it('widens the longitude ring as cells narrow toward the poles', () => {
    // Same latitude ring, more longitude cells — the adaptive part.
    const equator = neighbourPlaceKeys(0.5, 10).length;
    const arctic = neighbourPlaceKeys(78, 15).length;
    expect(arctic).toBeGreaterThan(equator);
  });

  it('stays bounded even at absurd latitudes', () => {
    expect(neighbourPlaceKeys(89.9, 15).length).toBeLessThanOrEqual(11 * 11);
  });
});

describe('withinPlaceRadius', () => {
  it('accepts two points at the same tree', () => {
    expect(withinPlaceRadius({ lat: 51.5, lng: -0.12 }, { lat: 51.50005, lng: -0.12 })).toBe(true);
  });

  it('rejects points a block apart', () => {
    expect(withinPlaceRadius({ lat: 51.5, lng: -0.12 }, { lat: 51.502, lng: -0.12 })).toBe(false);
  });
});

describe('coverage guarantee', () => {
  /**
   * The property: for a point p, EVERY point within PLACE_MATCH_RADIUS_M of p
   * must fall in a cell that `neighbourPlaceKeys(p)` returned. Stage 1 may
   * over-return freely; it must never under-return, or the distance filter in
   * stage 2 never gets the chance to see the match.
   *
   * Sampled on a ring at exactly the match radius (the worst case) plus a few
   * bearings, at latitudes chosen to stress the cos(latitude) narrowing.
   */
  it.each([
    [51.5, -0.12], // London
    [-33.87, 151.21], // Sydney — southern hemisphere
    [1.35, 103.82], // Singapore — near the equator
    [64.13, -21.9], // Reykjavik — high latitude, narrow longitude cells
    [-0.0001, -0.0001], // straddling both origins — the sign-flip case
  ])('holds at %p, %p', (lat, lng) => {
    const covered = new Set(neighbourPlaceKeys(lat, lng));

    for (let bearing = 0; bearing < 360; bearing += 15) {
      const rad = (bearing * Math.PI) / 180;
      // Offset by exactly the match radius, converted back into degrees.
      const dLat = (PLACE_MATCH_RADIUS_M * Math.cos(rad)) / 110540;
      const dLng =
        (PLACE_MATCH_RADIUS_M * Math.sin(rad)) /
        (111320 * Math.cos((lat * Math.PI) / 180));

      const near = { lat: lat + dLat, lng: lng + dLng };
      // Sanity: the sample really is within the radius we claim to cover.
      expect(haversineMeters({ lat, lng }, near)).toBeLessThanOrEqual(
        PLACE_MATCH_RADIUS_M * 1.02,
      );
      expect(covered.has(placeKey(near.lat, near.lng))).toBe(true);
    }
  });
});
