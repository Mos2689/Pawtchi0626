/**
 * wayfinding — which way a place is, and roughly how long it would take.
 *
 * ── What this deliberately is not ──
 *
 * Not navigation. Pawtchi does not route, and `walkStartIntent.ts` says so:
 * a destination is a note, not a path. What was missing is more modest and more
 * honest — a pin plus "1.7 km" never told anyone which way to set off, and that
 * is the entire gap this closes.
 *
 * So: a compass bearing, and a time estimate at this dog's own pace. Both are
 * computed on the device from two coordinates and a pace band we already hold.
 * No routing engine, no API key, no second public endpoint, and nothing that
 * stops working when the signal does — which matters, because the moment an
 * owner needs this is the moment they are outside and unsure.
 *
 * A bearing cannot route you around a river. It is never *wrong*, though, in
 * the way a cached route can be: it degrades to "keep heading north-east" and
 * the map beside it carries the rest.
 */

import { GeoPoint } from './geo';

export type CompassPoint =
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west'
  | 'north-west';

const COMPASS_POINTS: CompassPoint[] = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
];

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Initial great-circle bearing from one point to another, in degrees
 * clockwise from true north (0 = north, 90 = east).
 *
 * "Initial" matters over long distances, where the bearing changes along the
 * path. At dog-walk range the difference is far below the resolution of an
 * eight-point compass, so the caller never has to think about it.
 */
export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * The nearest of eight compass points.
 *
 * Eight rather than sixteen on purpose: "north-north-east" is precision nobody
 * can act on while holding a lead, and it reads like an instrument rather than
 * a person giving directions.
 */
export function compassPoint(bearingDeg: number): CompassPoint {
  const normalized = ((bearingDeg % 360) + 360) % 360;
  // Offset by half a sector so each point is centred on its cardinal.
  const index = Math.round(normalized / 45) % 8;
  return COMPASS_POINTS[index];
}

/**
 * A comfortable walking pace for this dog, in km/h.
 *
 * The midpoint of the band `dogCalibration` already derives from breed size and
 * life stage — so a Frenchie's estimate is slower than a Kelpie's without this
 * module knowing anything about either.
 */
export function dogPaceKmh(paceBandKmh: { min: number; max: number }): number {
  return (paceBandKmh.min + paceBandKmh.max) / 2;
}

/**
 * Minutes to cover a straight-line distance at that pace, rounded to five.
 *
 * Rounded coarsely because the input is a bearing distance, not a route: the
 * real walk is always longer, and a number like "27 min" would claim a
 * precision the straight line cannot support.
 */
export function walkEtaMinutes(distanceM: number, paceKmh: number): number {
  if (distanceM <= 0 || paceKmh <= 0) return 0;
  const minutes = (distanceM / 1000 / paceKmh) * 60;
  return Math.max(5, Math.round(minutes / 5) * 5);
}

/**
 * The estimate as a phrase. Vague on purpose at both ends — a straight line
 * under five minutes away is "close", and anything past an hour is a different
 * kind of outing, not a number to plan around.
 */
export function formatEta(minutes: number): string {
  if (minutes <= 0) return '';
  if (minutes < 5) return 'under 5 min';
  if (minutes < 60) return `about ${minutes} min`;
  if (minutes < 90) return 'about an hour';
  return 'over an hour';
}

/**
 * When you would get there, given how long it takes.
 *
 * A duration answers "how far is it"; a clock time answers "can I be back
 * before dark" — which is the question someone standing at their door with a
 * lead in one hand is actually asking. Every maps app shows both for this
 * reason.
 *
 * Pure and takes `now` explicitly so it is testable without freezing a clock.
 * Formatting is the caller's job: the device's locale decides 24h vs am/pm, and
 * this module has no business having an opinion about that.
 */
export function arrivalAt(now: Date, etaMinutes: number): Date {
  return new Date(now.getTime() + Math.max(0, etaMinutes) * 60_000);
}

export interface WayDescription {
  /** Eight-point compass word, ready to render. */
  direction: CompassPoint;
  bearingDeg: number;
  /** Empty when there is no usable pace or distance. */
  eta: string;
  etaMinutes: number;
}

/**
 * Everything the UI needs about getting there, in one call.
 *
 * Returns null when the origin is unknown — which is the honest answer, and the
 * reason the caller must pass the OWNER's position rather than the map's. Those
 * are two different facts on a pannable map, and a heading measured from a
 * suburb the owner is merely looking at would point confidently at nothing.
 */
export function describeWay(
  from: GeoPoint | null | undefined,
  to: GeoPoint | null | undefined,
  distanceM: number | null | undefined,
  paceKmh: number,
): WayDescription | null {
  if (!from || !to) return null;
  if (typeof distanceM !== 'number' || distanceM <= 0) return null;

  const bearingDeg = bearingDegrees(from, to);
  const etaMinutes = walkEtaMinutes(distanceM, paceKmh);

  return {
    direction: compassPoint(bearingDeg),
    bearingDeg,
    eta: formatEta(etaMinutes),
    etaMinutes,
  };
}
