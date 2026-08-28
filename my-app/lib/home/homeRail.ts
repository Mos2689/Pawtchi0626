/**
 * homeRail — turns recent walks into the horizontal rail that floats over
 * Home's map, and into the pins scattered across it.
 *
 * Pure functions, no React and no queries: the rail is the screen's whole
 * information architecture, so its rules should be readable and testable in one
 * place rather than inferred from JSX.
 *
 * Two segments here, and only two: "Walks" and "Sniffs" are both things the app
 * genuinely RECORDS, so both are derived from walk history by this file.
 *
 * The third segment on Home, "Spots", is not one of them. It is nearby places
 * fetched from OpenStreetMap and it lives entirely in lib/spots — different
 * source, different lifecycle, nothing to do with walk history. Keeping it out
 * of this module is the boundary that stops "where this dog has been" and
 * "where this dog could go" from becoming one tangled list.
 *
 * (The sniffs segment was called "Spots" until the OSM layer arrived and needed
 * the name. Sniffs is the more accurate word for it anyway — these are
 * resolveSniffStops outputs, not places.)
 */

import type { GeoPoint } from '../walk/geo';
import { resolveSniffStops } from '../momentCard';
import { getLocalYMD } from '../dateUtils';
import type { WalkMapSpotTone } from '../walk/mapSpot';

/**
 * What the rail says while this dog's own walks are still loading.
 *
 * Only ever seen on a first-ever launch or after a pet switch: from the second
 * launch onward the feed is painted from cache before the query runs, so there
 * is nothing to wait for. Phrased about the archive rather than the network,
 * because "fetching" is our problem and not the owner's.
 */
export const walkFeedLoadingCopy = {
  title: 'Opening the logbook',
  lines: [
    'Gathering the last few walks',
    'Retracing where you have been',
  ],
  /** Shown once the wait is long enough to read as broken rather than busy. */
  slowLine: 'The connection is taking a moment',
} as const;

/** The palette pins cycle through. Order is the cycle. */
const TONES: WalkMapSpotTone[] = ['pink', 'mint', 'butter', 'sky'];

/** A dwell this long or more is worth calling a sniff rather than a pause. */
const NOTABLE_DWELL_S = 45;

/**
 * `spots` is listed here because the segmented control needs one type, but this
 * module never builds anything for it — see the header note.
 */
export type RailSegment = 'walks' | 'spots';

export interface RailWalkSource {
  id: string;
  started_at: string;
  duration_s: number;
  distance_m: number;
  route: GeoPoint[] | null;
  pause_points: GeoPoint[];
  sniff_points: unknown[] | null;
  start_label: string | null;
  end_label: string | null;
  farthest_label: string | null;
}

export interface RailWalkItem {
  kind: 'walk';
  id: string;
  /** "The long way round" — the walk's place, not a generated title. */
  title: string;
  startedAt: string;
  km: number;
  minutes: number;
  sniffCount: number;
  /** Frames the map when this card is centred. */
  route: GeoPoint[] | null;
}

export interface RailSniffItem {
  kind: 'sniff';
  id: string;
  title: string;
  /** Which walk it came from, so the card can say when. */
  startedAt: string;
  dwellS: number;
  point: GeoPoint;
}

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  tone: WalkMapSpotTone;
}

export interface TodayTotals {
  walks: number;
  km: number;
  minutes: number;
}

function cleanLabel(label: string | null | undefined): string | null {
  const t = (label ?? '').trim();
  return t.length > 0 ? t : null;
}

/**
 * A walk's name is a place, never an invention.
 *
 * "Elm Row → Fairhaven Green" when the walk went somewhere, the single label
 * when it looped back, and a plain fallback when reverse geocoding gave us
 * nothing. We do not generate titles: a made-up name on someone's real walk
 * reads as the app talking over them.
 */
export function buildWalkTitle(walk: RailWalkSource, petName?: string | null): string {
  const start = cleanLabel(walk.start_label);
  const end = cleanLabel(walk.end_label);
  const farthest = cleanLabel(walk.farthest_label);

  if (start && end && start !== end) return `${start} → ${end}`;
  if (start && farthest && start !== farthest) return `${start} → ${farthest}`;
  const single = start ?? end ?? farthest;
  if (single) return single;

  const name = (petName ?? '').trim();
  return name ? `${name}'s walk` : 'A walk';
}

/** Walk cards, newest first. */
export function buildWalkItems(
  walks: readonly RailWalkSource[],
  petName?: string | null,
): RailWalkItem[] {
  return walks.map(w => ({
    kind: 'walk' as const,
    id: w.id,
    title: buildWalkTitle(w, petName),
    startedAt: w.started_at,
    km: (Number(w.distance_m) || 0) / 1000,
    minutes: Math.round((Number(w.duration_s) || 0) / 60),
    sniffCount: resolveSniffStops(w.sniff_points, w.pause_points).length,
    route: w.route,
  }));
}

/**
 * Sniff cards — the places a dog actually stopped and read.
 *
 * Filtered to the longer dwells on purpose. Every walk produces a scatter of
 * brief pauses (a kerb, a lead tangle) and showing all of them would bury the
 * handful that meant something. The label is the walk's place, because a sniff
 * episode has coordinates but no name of its own.
 */
export function buildSniffItems(
  walks: readonly RailWalkSource[],
  petName?: string | null,
): RailSniffItem[] {
  const items: RailSniffItem[] = [];

  for (const walk of walks) {
    const stops = resolveSniffStops(walk.sniff_points, walk.pause_points);
    const place = buildWalkTitle(walk, petName);
    stops.forEach((stop, i) => {
      if (stop.dwellS < NOTABLE_DWELL_S) return;
      items.push({
        kind: 'sniff',
        id: `${walk.id}:${i}`,
        title: place,
        startedAt: walk.started_at,
        dwellS: Math.round(stop.dwellS),
        point: { lat: stop.lat, lng: stop.lng },
      });
    });
  }

  // Longest dwell first — the most interesting stop leads the rail.
  return items.sort((a, b) => b.dwellS - a.dwellS);
}

/**
 * One pin per walk, dropped at where that walk began.
 *
 * The selected walk's pin turns to ink so it reads as the thing the rail is
 * pointing at; the rest cycle the pastels, which carry no meaning beyond
 * "a different walk".
 */
export function buildWalkPins(
  walkItems: readonly RailWalkItem[],
  selectedId: string | null,
): MapPin[] {
  const pins: MapPin[] = [];
  for (const walk of walkItems) {
    const point = walk.route?.[0];
    if (!point) continue;
    pins.push({
      id: walk.id,
      lat: point.lat,
      lng: point.lng,
      tone: walk.id === selectedId ? 'ink' : TONES[pins.length % TONES.length],
    });
  }
  return pins;
}

/**
 * The selected walk's sniff stops, dropped along its route.
 *
 * These used to live behind their own segment, which split apart two things
 * that only mean something together: a sniff has no name of its own — its card
 * borrowed the WALK's place name — so a list of them read as the same title
 * repeated, while the route it belonged to sat one tab away. Meanwhile the
 * walk card advertised "3 sniffs" and tapping it went nowhere.
 *
 * On the route, they are the walk's story: this is where they insisted on
 * stopping. Electric blue because that is the tone reserved for what the dog
 * found, and the sniff count on the card already uses it.
 *
 * Caller filters to one walk — passing every walk's stops would scatter pins
 * across routes that are not drawn.
 */
export function buildSniffPins(
  sniffItems: readonly RailSniffItem[],
  openSniffId: string | null,
): MapPin[] {
  return sniffItems.map(sniff => ({
    id: sniff.id,
    lat: sniff.point.lat,
    lng: sniff.point.lng,
    // Ink for the one whose dwell is being shown, so it reads as selected in
    // the same language a chosen walk does.
    tone: sniff.id === openSniffId ? 'ink' : ('sniff' as const),
  }));
}

/** The stops belonging to one walk. Ids are `{walkId}:{index}`. */
export function sniffsForWalk(
  sniffItems: readonly RailSniffItem[],
  walkId: string | null,
): RailSniffItem[] {
  if (!walkId) return [];
  return sniffItems.filter(s => s.id.startsWith(`${walkId}:`));
}

/**
 * Today's totals, scoped to today and never to a lifetime.
 *
 * Lifetime numbers only go up, so they say nothing about the day you are in and
 * quietly punish anyone who joined last week.
 */
export function buildTodayTotals(
  walks: readonly RailWalkSource[],
  now: Date = new Date(),
): TodayTotals {
  const ymd = getLocalYMD(now);
  const mine = walks.filter(w => getLocalYMD(new Date(w.started_at)) === ymd);
  return {
    walks: mine.length,
    km: mine.reduce((s, w) => s + (Number(w.distance_m) || 0), 0) / 1000,
    minutes: Math.round(mine.reduce((s, w) => s + (Number(w.duration_s) || 0), 0) / 60),
  };
}

/** "38 min" / "1h 12m" — dwell and duration read the same way everywhere. */
export function formatDuration(seconds: number): string {
  const mins = Math.max(0, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "40s" for the short dwells a sniff card leads with. */
export function formatDwell(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 90 ? `${s}s` : formatDuration(s);
}
