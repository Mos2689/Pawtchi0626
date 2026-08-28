/**
 * directions — hand the destination to the device's own map app.
 *
 * ⚠️ PARKED, NOT DEAD. Nothing imports this today. The "Get directions" CTA was
 * pulled from SpotDetailsSheet because ejecting an owner into Apple or Google
 * Maps is the opposite of what Spots is for — we want them to *walk the dog*
 * there, which is what "Walk here" will do instead. The module stays because it
 * is pure, tested and costs nothing unimported (Metro never bundles it), and
 * because "for now" was the word used: if a place ever turns out to need real
 * navigation, this is ready rather than rewritten from memory.
 *
 * Pawtchi does not navigate. Turn-by-turn is a whole product with a whole
 * liability surface, and the phone already has one that is better than anything
 * we would build. Our job ends at "here is where it is".
 *
 * Pure URL construction, no `Linking` import: this file is under ts-jest, where
 * react-native is a stub, and the caller does the `openURL` anyway. Keeping the
 * side effect at the call site also means the URL itself is testable.
 */

import { displayName } from './copy';
import type { PawtchiSpot } from './types';

export type DirectionsPlatform = 'ios' | 'android' | 'web';

/**
 * The destination label shown in the map app.
 *
 * Sanitised because it lands in a URL: OSM names are free text and can contain
 * ampersands, quotes and newlines, any of which would truncate or corrupt the
 * link. Falls back to the category label so an unnamed park still arrives with
 * something readable rather than a blank pin.
 */
function labelFor(spot: PawtchiSpot): string {
  return displayName(spot.name, spot.category)
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Build the platform-appropriate URL.
 *
 *   iOS      → `maps://` opens Apple Maps directly, matching the basemap the
 *              user was just looking at.
 *   Android  → `geo:` is the ANDROID-SANCTIONED intent: it opens whichever map
 *              app the user has chosen as their default, rather than forcing
 *              Google Maps on someone who prefers something else. The `q=`
 *              label makes the pin readable instead of raw coordinates.
 *   web      → an OSM link. Notably NOT Google Maps: this data came from
 *              OpenStreetMap, and sending people to a competitor's map to view
 *              it would be both discourteous and slightly absurd.
 *
 * Coordinates, not a name search. A search for "Park" resolves to whatever the
 * map provider thinks you meant, which may be a different park entirely.
 */
export function directionsUrl(spot: PawtchiSpot, platform: DirectionsPlatform): string {
  const lat = spot.latitude;
  const lng = spot.longitude;
  const label = labelFor(spot);

  if (platform === 'ios') {
    return `maps://?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`;
  }
  if (platform === 'android') {
    return `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`;
  }
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

/**
 * Where to go if the scheme above has no handler.
 *
 * Rare but real: an iOS device with Apple Maps removed, or an Android build
 * with no map app at all. A web OSM link always opens in a browser, so the
 * action never silently does nothing.
 */
export function directionsFallbackUrl(spot: PawtchiSpot): string {
  return directionsUrl(spot, 'web');
}
