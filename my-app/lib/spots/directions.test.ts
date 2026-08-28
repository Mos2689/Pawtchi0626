import { directionsFallbackUrl, directionsUrl } from './directions';
import type { PawtchiSpot } from './types';

function spot(over: Partial<PawtchiSpot> = {}): PawtchiSpot {
  return {
    id: 'osm:node/1',
    provider: 'osm',
    providerPlaceId: 'node/1',
    category: 'off_leash_park',
    name: 'Elm Row Dog Park',
    latitude: 51.5007,
    longitude: -0.1246,
    dogAccess: 'off_leash',
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

describe('directionsUrl', () => {
  it('opens Apple Maps on iOS, matching the basemap the user was looking at', () => {
    expect(directionsUrl(spot(), 'ios')).toContain('maps://?daddr=51.5007,-0.1246');
  });

  it('uses the geo: intent on Android so the user default map app wins', () => {
    // Not a Google Maps URL: forcing one map app on someone who chose another
    // is exactly what the geo: scheme exists to avoid.
    const url = directionsUrl(spot(), 'android');
    expect(url).toMatch(/^geo:51\.5007,-0\.1246\?q=/);
    expect(url).not.toContain('google');
  });

  it('falls back to OpenStreetMap on the web, not a competitor map', () => {
    const url = directionsUrl(spot(), 'web');
    expect(url).toContain('openstreetmap.org');
    expect(url).not.toContain('google');
  });

  it('always navigates by coordinate, never by name search', () => {
    // A search for "Park" resolves to whatever the provider thinks you meant.
    for (const platform of ['ios', 'android', 'web'] as const) {
      expect(directionsUrl(spot(), platform)).toContain('51.5007');
      expect(directionsUrl(spot(), platform)).toContain('-0.1246');
    }
  });

  it('labels an unnamed place with its category rather than leaving it blank', () => {
    const url = directionsUrl(spot({ name: null }), 'ios');
    expect(decodeURIComponent(url)).toContain('Off-leash dog park');
  });

  it('escapes names that would otherwise corrupt the URL', () => {
    const url = directionsUrl(spot({ name: 'Bob & Sons? Park' }), 'ios');
    expect(url).toContain(encodeURIComponent('Bob & Sons? Park'));
    // The raw ampersand would have started a new query parameter.
    expect(url.split('&q=')[1]).not.toContain('&');
  });

  it('strips newlines and caps runaway names', () => {
    const url = directionsUrl(spot({ name: `A\nB${'x'.repeat(200)}` }), 'android');
    const decoded = decodeURIComponent(url);
    expect(decoded).not.toContain('\n');
    expect(decoded.length).toBeLessThan(200);
  });

  it('handles southern/eastern hemisphere coordinates', () => {
    const url = directionsUrl(spot({ latitude: -33.8688, longitude: 151.2093 }), 'ios');
    expect(url).toContain('-33.8688,151.2093');
  });
});

describe('directionsFallbackUrl', () => {
  it('is always openable in a browser, so the action never silently fails', () => {
    expect(directionsFallbackUrl(spot())).toMatch(/^https:\/\//);
  });
});
