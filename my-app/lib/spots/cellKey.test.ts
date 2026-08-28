/**
 * Cell quantization — the cache key and the privacy boundary.
 *
 * The coverage test at the bottom is the important one: it is the property the
 * whole "query the cell, not the person" design rests on, and it fails silently
 * in the real world (a user near a cell edge just quietly misses places).
 */

import { haversineMeters } from '../walk/geo';
import {
  CELL_COVER_M,
  CELL_SIZE_DEG,
  DEFAULT_RADIUS_M,
  MAX_RADIUS_M,
  cellCentre,
  cellKey,
  cellOf,
  isFresh,
  queryRadiusFor,
  radiusBucketFor,
  spotCacheKey,
} from './cellKey';

describe('cellOf / cellKey', () => {
  it('puts nearby coordinates in the same cell', () => {
    expect(cellKey(51.5001, -0.1201)).toBe(cellKey(51.5002, -0.1202));
  });

  it('separates coordinates a cell apart', () => {
    expect(cellKey(51.5, -0.12)).not.toBe(cellKey(51.5 + CELL_SIZE_DEG, -0.12));
    expect(cellKey(51.5, -0.12)).not.toBe(cellKey(51.5, -0.12 + CELL_SIZE_DEG));
  });

  it('floors, so cells tile the plane with no overlap and no gap', () => {
    // Negative coordinates are where round-vs-floor bugs surface.
    expect(cellOf(-0.001, -0.001)).toEqual({ latIndex: -1, lngIndex: -1 });
    expect(cellOf(0.001, 0.001)).toEqual({ latIndex: 0, lngIndex: 0 });
  });

  it('is deterministic', () => {
    expect(cellKey(-33.8688, 151.2093)).toBe(cellKey(-33.8688, 151.2093));
  });
});

describe('cellCentre', () => {
  it('returns a point inside the cell it names', () => {
    const centre = cellCentre(51.5037, -0.1195);
    expect(cellKey(centre.lat, centre.lng)).toBe(cellKey(51.5037, -0.1195));
  });

  it('does not leak the input coordinate', () => {
    const centre = cellCentre(51.503712345, -0.119512345);
    expect(centre.lat).not.toBeCloseTo(51.503712345, 5);
  });
});

describe('radius buckets', () => {
  it('snaps anything at or under the default down to it', () => {
    expect(radiusBucketFor(500)).toBe(DEFAULT_RADIUS_M);
    expect(radiusBucketFor(DEFAULT_RADIUS_M)).toBe(DEFAULT_RADIUS_M);
  });

  it('snaps anything larger to the max — never above it', () => {
    expect(radiusBucketFor(4000)).toBe(MAX_RADIUS_M);
    expect(radiusBucketFor(50_000)).toBe(MAX_RADIUS_M);
  });

  it('treats junk as the default rather than propagating NaN', () => {
    expect(radiusBucketFor(NaN)).toBe(DEFAULT_RADIUS_M);
  });
});

describe('spotCacheKey', () => {
  it('changes when the query version changes — the invalidation mechanism', () => {
    expect(spotCacheKey('100_-6', 3000, 1)).not.toBe(spotCacheKey('100_-6', 3000, 2));
  });

  it('separates radii so a wider search never reads a narrower cached answer', () => {
    expect(spotCacheKey('100_-6', 3000, 1)).not.toBe(spotCacheKey('100_-6', 5000, 1));
  });
});

describe('coverage guarantee', () => {
  /**
   * The property: querying the CELL CENTRE at `queryRadiusFor(r)` must reach
   * everything within `r` of a user standing ANYWHERE in that cell — including
   * the worst case, a corner.
   *
   * If this fails, users near cell edges silently lose results that are well
   * inside their stated search radius.
   */
  it.each([
    [51.5, -0.12], // London
    [-33.87, 151.21], // Sydney — southern hemisphere
    [1.35, 103.82], // Singapore — near the equator
    [64.13, -21.9], // Reykjavik — high latitude, narrow longitude
  ])('holds at %p, %p', (lat, lng) => {
    const { latIndex, lngIndex } = cellOf(lat, lng);
    const centre = cellCentre(lat, lng);

    const corners = [
      { lat: latIndex * CELL_SIZE_DEG, lng: lngIndex * CELL_SIZE_DEG },
      { lat: (latIndex + 1) * CELL_SIZE_DEG, lng: lngIndex * CELL_SIZE_DEG },
      { lat: latIndex * CELL_SIZE_DEG, lng: (lngIndex + 1) * CELL_SIZE_DEG },
      { lat: (latIndex + 1) * CELL_SIZE_DEG, lng: (lngIndex + 1) * CELL_SIZE_DEG },
    ];

    for (const corner of corners) {
      const cornerToCentre = haversineMeters(corner, { lat: centre.lat, lng: centre.lng });
      // A user at the corner searching `r` reaches r + cornerToCentre from the
      // centre; our query radius must cover that.
      expect(cornerToCentre).toBeLessThanOrEqual(CELL_COVER_M);
      expect(queryRadiusFor(MAX_RADIUS_M)).toBeGreaterThanOrEqual(
        MAX_RADIUS_M + cornerToCentre,
      );
    }
  });
});

describe('isFresh', () => {
  const now = Date.parse('2026-08-16T12:00:00.000Z');
  const HOUR = 60 * 60 * 1000;

  it('is fresh inside the TTL and stale outside it', () => {
    expect(isFresh('2026-08-16T11:00:00.000Z', 24 * HOUR, now)).toBe(true);
    expect(isFresh('2026-08-14T11:00:00.000Z', 24 * HOUR, now)).toBe(false);
  });

  it('treats an unparseable timestamp as stale', () => {
    expect(isFresh('not-a-date', 24 * HOUR, now)).toBe(false);
  });

  it('treats a future timestamp as fresh rather than hammering the endpoint', () => {
    // Clock skew between device and server is real; the failure mode of the
    // alternative is an infinite refetch loop.
    expect(isFresh('2026-08-17T12:00:00.000Z', 24 * HOUR, now)).toBe(true);
  });
});
