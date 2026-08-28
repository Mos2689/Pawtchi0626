/**
 * Map spot types, kept in lib rather than beside the map component.
 *
 * WalkMap is a .tsx and the ts-jest suite only resolves .ts, so anything under
 * lib/ that reaches for these types has to find them here — importing them from
 * the component would break the moment a pure module wanted one. Types only, no
 * runtime, so both sides can depend on it freely.
 */

/**
 * Pin colours. Pastels carry category (which walk, which spot) and never state;
 * `ink` is reserved for the one pin the rail is currently pointing at.
 */
export type WalkMapSpotTone = 'pink' | 'mint' | 'butter' | 'sky' | 'ink' | 'sniff';

export interface WalkMapSpot {
  id: string;
  lat: number;
  lng: number;
  tone: WalkMapSpotTone;
}
