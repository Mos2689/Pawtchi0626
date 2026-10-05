import { NEARBY_RADIUS_KM, boxAround, parsePhoton, photonSearchUrl, wantsExactAddress } from './placeSearch';

const BENGALURU = { lat: 12.97194, lng: 77.59369 };

const feature = (props: Record<string, unknown>, lng = 77.6, lat = 12.97) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { osm_type: 'W', osm_id: Math.floor(lng * 1000 + lat), ...props },
});

describe('photonSearchUrl', () => {
  it('confines a nearby search to a box around a rounded centre', () => {
    const url = photonSearchUrl('MG Road', { center: BENGALURU, countryCode: 'IN' }, true);
    expect(url).toContain('q=MG%20Road');
    expect(url).toContain('lat=12.97');
    expect(url).toContain('lon=77.59');
    expect(url).not.toContain('12.97194');
    expect(url).toMatch(/bbox=77\.\d{3},12\.\d{3},77\.\d{3},13\.\d{3}/);
  });

  it('only biases, without a box, when searching everywhere', () => {
    const url = photonSearchUrl('MG Road', { center: BENGALURU, countryCode: 'IN' }, false);
    expect(url).toContain('lat=12.97');
    expect(url).not.toContain('bbox=');
  });

  it('sends no location at all when none is known', () => {
    const url = photonSearchUrl('129 tall', { center: null, countryCode: 'AU' }, true);
    expect(url).not.toContain('lat=');
    expect(url).not.toContain('bbox=');
  });

  it('builds a box about the requested radius', () => {
    const box = boxAround(BENGALURU, NEARBY_RADIUS_KM);
    expect(box.maxLat - box.minLat).toBeCloseTo((2 * NEARBY_RADIUS_KM) / 111, 3);
    expect(box.maxLng - box.minLng).toBeGreaterThan(box.maxLat - box.minLat);
  });
});

describe('wantsExactAddress', () => {
  const road = { id: 'w1', title: 'Tallawong Road', subtitle: 'Rouse Hill, Sydney', lat: -33.69, lng: 150.9 };
  const house = { ...road, id: 'n1', title: '129 Tallawong Road' };

  it('offers the exact lookup when the number is missing from every suggestion', () => {
    expect(wantsExactAddress('129 Tallawong Road', [road])).toBe(true);
    expect(wantsExactAddress('129 Tallawong', [])).toBe(true);
    expect(wantsExactAddress('12A Smith St', [road])).toBe(true);
    expect(wantsExactAddress('3/45 King St', [road])).toBe(true);
  });

  it('does not when a suggestion already has the house, or nothing looks like an address', () => {
    expect(wantsExactAddress('129 Tallawong Road', [house])).toBe(false);
    expect(wantsExactAddress('Tallawong Road', [road])).toBe(false);
    expect(wantsExactAddress('129', [road])).toBe(false);
  });
});

describe('parsePhoton', () => {
  const area = { center: BENGALURU, countryCode: 'IN' };

  it('titles an address by number and street, and places it', () => {
    const [first] = parsePhoton({ features: [feature({ housenumber: '129', street: 'Tallawong Road', district: 'Rouse Hill', city: 'Sydney', state: 'New South Wales', countrycode: 'AU' })] }, { center: null, countryCode: 'AU' });
    expect(first).toMatchObject({ title: '129 Tallawong Road', subtitle: 'Rouse Hill, Sydney, New South Wales' });
  });

  it('titles a place by its name, with the area underneath', () => {
    const [first] = parsePhoton({ features: [feature({ name: 'MG Road', district: 'Shanthala Nagar', city: 'Bengaluru', state: 'Karnataka', countrycode: 'IN' })] }, area);
    expect(first).toMatchObject({ title: 'MG Road', subtitle: 'Shanthala Nagar, Bengaluru, Karnataka', lat: 12.97, lng: 77.6 });
  });

  it('keeps an unanchored search inside the device’s country', () => {
    const answer = { features: [
      feature({ name: 'MG Road', city: 'Pune', countrycode: 'IN' }),
      feature({ name: 'MG Road', city: 'Somewhere', countrycode: 'GB' }),
    ] };
    expect(parsePhoton(answer, { center: null, countryCode: 'IN' }).map(s => s.subtitle)).toEqual(['Pune']);
  });

  it('names the country only when nothing else locates the search', () => {
    const [first] = parsePhoton({ features: [feature({ name: 'MG Road', city: 'Pune', country: 'India' })] }, { center: null, countryCode: null });
    expect(first.subtitle).toBe('Pune, India');
  });

  it('drops duplicates and malformed features, and stops at six', () => {
    const many = Array.from({ length: 10 }, (_, i) => feature({ name: `Park ${i}`, city: 'Bengaluru' }, 77.6 + i / 100));
    const answer = { features: [
      feature({ name: 'MG Road', city: 'Bengaluru' }),
      feature({ name: 'MG Road', city: 'Bengaluru' }),
      { geometry: { coordinates: ['x', 1] }, properties: { name: 'Bad' } },
      { geometry: { coordinates: [200, 1] }, properties: { name: 'Off the map' } },
      feature({}),
      ...many,
    ] };
    const out = parsePhoton(answer, area);
    expect(out).toHaveLength(6);
    expect(out.filter(s => s.title === 'MG Road')).toHaveLength(1);
    expect(out.map(s => s.title)).not.toContain('Bad');
  });

  it('returns nothing for an answer that is not one', () => {
    expect(parsePhoton(null, area)).toEqual([]);
    expect(parsePhoton({ features: 'x' }, area)).toEqual([]);
  });
});
