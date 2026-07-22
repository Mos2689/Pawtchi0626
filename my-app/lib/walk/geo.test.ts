import { haversineMeters, simplifyRoute, GeoPoint } from './geo';

describe('haversineMeters', () => {
  it('measures one thousandth of a degree of latitude as ~111m', () => {
    const a = { lat: 40.0, lng: -74.0 };
    const b = { lat: 40.001, lng: -74.0 };
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(109);
    expect(d).toBeLessThan(113);
  });

  it('is zero for identical points and symmetric', () => {
    const a = { lat: 12.34, lng: 56.78 };
    const b = { lat: 12.35, lng: 56.79 };
    expect(haversineMeters(a, a)).toBe(0);
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('simplifyRoute', () => {
  it('collapses a straight line to its endpoints', () => {
    const points: GeoPoint[] = Array.from({ length: 500 }, (_, i) => ({
      lat: 40 + i * 0.00001,
      lng: -74,
    }));
    const out = simplifyRoute(points, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out[0]).toEqual(points[0]);
    expect(out[out.length - 1]).toEqual(points[points.length - 1]);
    // A perfectly straight line needs only its two ends.
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it('keeps short routes untouched', () => {
    const points: GeoPoint[] = [
      { lat: 40, lng: -74 },
      { lat: 40.001, lng: -74.001 },
      { lat: 40.002, lng: -74 },
    ];
    expect(simplifyRoute(points, 200)).toEqual(points);
  });

  it('fits a noisy zigzag inside the point budget', () => {
    const points: GeoPoint[] = Array.from({ length: 2000 }, (_, i) => ({
      lat: 40 + i * 0.00002 + (i % 2 === 0 ? 0.00004 : -0.00004),
      lng: -74 + i * 0.00001,
    }));
    const out = simplifyRoute(points, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out[0]).toEqual(points[0]);
  });
});
