/**
 * The network half of place search (the rules are in placeSearch.ts).
 *
 * Plain fetch, not the Supabase client: this never touches Pawtchi's server,
 * which is the point — search-as-you-type would otherwise be a stream of
 * requests to the one database everything else waits on.
 */

import * as Localization from 'expo-localization';
import { parsePhoton, photonSearchUrl, type PlaceSuggestion, type SearchArea } from './placeSearch';

const TIMEOUT_MS = 6_000;

export async function searchPlaces(
  query: string,
  area: SearchArea,
  nearbyOnly: boolean,
  signal: AbortSignal,
): Promise<PlaceSuggestion[]> {
  // The caller's signal cancels a superseded keystroke; this one caps a slow
  // answer. Either ends the request.
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort);
  const timer = setTimeout(abort, TIMEOUT_MS);
  try {
    const response = await fetch(photonSearchUrl(query, area, nearbyOnly), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`place search answered ${response.status}`);
    return parsePhoton(await response.json(), area);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** The device's region ("IN", "AU"), to keep an unanchored search in-country. */
export function deviceCountryCode(): string | null {
  try {
    return Localization.getLocales()[0]?.regionCode ?? null;
  } catch {
    return null;
  }
}
