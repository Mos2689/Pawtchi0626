import { decodePolyline, encodePolyline } from './livePolyline';

describe('encoded polylines', () => {
  const sample = [
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ];

  it('matches the reference encoding', () => {
    expect(encodePolyline(sample)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 10)).toEqual(sample);
  });

  it('round-trips at 1e5 precision, including loops and repeated points', () => {
    const loop = [
      { lat: -33.87123, lng: 151.20456 },
      { lat: -33.87150, lng: 151.20500 },
      { lat: -33.87123, lng: 151.20456 },
      { lat: -33.87123, lng: 151.20456 },
    ];
    expect(decodePolyline(encodePolyline(loop), 10)).toEqual(loop);
  });

  it('treats the empty string as no points', () => {
    expect(encodePolyline([])).toBe('');
    expect(decodePolyline('', 20)).toEqual([]);
  });

  it('refuses anything malformed instead of throwing', () => {
    const good = encodePolyline(sample);
    expect(decodePolyline(good.slice(0, -1), 10)).toBeNull(); // truncated mid-value
    expect(decodePolyline(good.slice(0, 5), 10)).toBeNull(); // a latitude with no longitude
    expect(decodePolyline('abc def', 10)).toBeNull(); // a character outside the alphabet
    expect(decodePolyline('~~~~~~~~~~', 10)).toBeNull(); // a value that never ends
    expect(decodePolyline(42, 10)).toBeNull();
    expect(decodePolyline(null, 10)).toBeNull();
  });

  it('refuses more points than allowed', () => {
    expect(decodePolyline(encodePolyline(sample), 2)).toBeNull();
    expect(decodePolyline(encodePolyline(sample), 3)).toHaveLength(3);
  });

  it('refuses coordinates out of range', () => {
    expect(decodePolyline(encodePolyline([{ lat: 95, lng: 0 }]), 10)).toBeNull();
    expect(decodePolyline(encodePolyline([{ lat: 0, lng: 181 }]), 10)).toBeNull();
  });
});
