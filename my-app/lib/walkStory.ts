// Walk Story — pure engine that turns one finished walk into an ordered
// sequence of story "beats" (the slides the full-screen viewer plays).
//
// Renderer-agnostic and deterministic, exactly like momentCard.ts: the viewer
// (app/walk-story.tsx) and the slide components consume this module, and
// walkStory.test.ts enforces the brand voice and the beat logic under ts-jest.
// Every string here complies with the Pawtchi Copy Spec v1 — no exclamation
// marks, never "your pet", calm sentence case, three sentences max, none of
// the banned words.
//
// A beat is only emitted when the walk's own data supports it, so a patchy,
// routeless walk still gets a story (opener, time-of-day, weather, closer)
// rather than a dead end.

import {
  buildMomentHeadline,
  buildMomentJourneyLine,
  buildMomentStats,
  momentDateLine,
  type MomentRoutePoint,
  type MomentStat,
  type MomentStats,
  type SniffStop,
} from './momentCard';
import type { WalkLabels } from './walk/geoLabels';
import type { WalkTotals } from './pawPrints';

/** Weather captured at walk time (Open-Meteo). Null when unavailable. */
export interface WalkWeather {
  tempC: number;
  /** Open-Meteo WMO weather code. */
  code: number;
  /** Calm, already-resolved label: "clear", "light rain", "overcast". */
  label: string;
}

export type StoryBeatId =
  | 'opener'
  | 'journey'
  | 'sniff_spot'
  | 'pace'
  | 'golden_hour'
  | 'weather'
  | 'distance'
  | 'closer';

/** How seasoned this walker is — drives narration richness, not which beats
 *  appear (delightful cards are never hidden from newcomers). */
export type StoryDepth = 'new' | 'regular' | 'seasoned' | 'veteran';

interface OpenerBeat {
  id: 'opener';
  headline: string;
  dateLine: string;
  /** "Walk 42" for returning walkers — a quiet progression mark. Null for the
   *  first couple of walks, where a number would read as pressure. */
  chapter: string | null;
}

interface JourneyBeat {
  id: 'journey';
  /** "Riverside Park to Elm Street", or null — the slide falls back to a title. */
  journeyLine: string | null;
  stats: MomentStat[];
  hasRoute: boolean;
}

interface SniffBeat {
  id: 'sniff_spot';
  count: number;
  /** Longest single dwell, in whole seconds. */
  longestDwellS: number;
  line: string;
}

interface PaceBeat {
  id: 'pace';
  speedLabel: string;
  line: string;
}

interface GoldenHourBeat {
  id: 'golden_hour';
  phase: 'sunrise' | 'sunset';
  title: string;
  line: string;
}

interface WeatherBeat {
  id: 'weather';
  tempLabel: string;
  conditionLabel: string;
  line: string;
}

interface DistanceBeat {
  id: 'distance';
  distanceLabel: string;
  /** "a personal best" when this walk is the longest in the archive. */
  isLongest: boolean;
  line: string;
}

interface CloserBeat {
  id: 'closer';
  title: string;
  line: string;
}

export type StoryBeat =
  | OpenerBeat
  | JourneyBeat
  | SniffBeat
  | PaceBeat
  | GoldenHourBeat
  | WeatherBeat
  | DistanceBeat
  | CloserBeat;

export interface WalkStoryInput {
  petName: string | null | undefined;
  petGender: string | null | undefined;
  /** The walk session id — seeds every card's deterministic weave. */
  sessionId: string;
  /** Walk start, ms since epoch. */
  startedAt: number;
  route: MomentRoutePoint[];
  sniffStops: SniffStop[];
  labels: WalkLabels;
  stats: MomentStats;
  avgSpeedKmh: number | null;
  weather: WalkWeather | null;
  /** Archive aggregate — progression + longest-walk context. Null when unknown. */
  totals: WalkTotals | null;
}

export interface WalkStory {
  beats: StoryBeat[];
  depth: StoryDepth;
}

// A walk this short can't honestly headline its pace — a 90-second doorstep
// loop's average speed is noise, not character.
const PACE_MIN_DURATION_S = 5 * 60;
const PACE_MIN_DISTANCE_M = 300;

export function storyDepth(walkCount: number | null | undefined): StoryDepth {
  const n = walkCount ?? 0;
  if (n >= 30) return 'veteran';
  if (n >= 7) return 'seasoned';
  if (n >= 3) return 'regular';
  return 'new';
}

function cleanName(name: string | null | undefined): string {
  return (name ?? '').trim();
}

/** "under a minute", "3 minutes" — dwell phrased for a calm sentence. */
function dwellPhrase(dwellS: number): string {
  const mins = Math.round(dwellS / 60);
  if (mins < 1) return 'under a minute';
  return mins === 1 ? 'a minute' : `${mins} minutes`;
}

/** "4.8 km/h" — one decimal, trailing .0 trimmed. */
function formatSpeed(kmh: number): string {
  const s = kmh.toFixed(1);
  return `${s.endsWith('.0') ? s.slice(0, -2) : s} km/h`;
}

function formatKm(km: number): string {
  const s = km >= 10 ? km.toFixed(0) : km.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

// ── Time of day ──────────────────────────────────────────────────────────────

export type Daylight = 'golden_sunrise' | 'golden_sunset' | 'daytime' | 'night' | 'unknown';

const DEG = Math.PI / 180;

/**
 * Local sunrise/sunset for a date at a coordinate, in decimal local hours
 * (using the timezone offset carried by `date`). Null in polar day/night,
 * where the sun never crosses the horizon. A compact form of the standard
 * sunrise equation — accurate to a few minutes, which is all "golden hour"
 * needs.
 */
export function sunTimesLocalHours(
  date: Date,
  lat: number,
  lng: number,
): { sunrise: number; sunset: number } | null {
  // Standard sunrise equation (Wikipedia). `lw` is west-positive longitude.
  const J2000 = 2451545.0;
  const jDate = date.getTime() / 86_400_000 + 2440587.5;
  const lw = -lng;
  const n = Math.ceil(jDate - J2000 + 0.0008);
  const jStar = n + lw / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const Mr = M * DEG;
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const Lr = lambda * DEG;
  const jTransit = J2000 + jStar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * Lr);
  const decl = Math.asin(Math.sin(Lr) * Math.sin(23.44 * DEG));
  const latR = lat * DEG;
  const cosH = (Math.sin(-0.83 * DEG) - Math.sin(latR) * Math.sin(decl)) / (Math.cos(latR) * Math.cos(decl));
  if (cosH > 1 || cosH < -1) return null; // polar day / night
  const w0 = Math.acos(cosH) / DEG;
  const jRise = jTransit - w0 / 360;
  const jSet = jTransit + w0 / 360;

  const offsetH = -date.getTimezoneOffset() / 60;
  const toLocalHours = (jd: number) => {
    const utcDayFraction = (((jd - 2440587.5) % 1) + 1) % 1; // fractional UTC day
    return (utcDayFraction * 24 + offsetH + 24) % 24;
  };
  return { sunrise: toLocalHours(jRise), sunset: toLocalHours(jSet) };
}

/**
 * Classify a walk's start time by daylight. Golden hour is the hour just after
 * sunrise and the hour just before sunset — the warm, low-angle light. Returns
 * 'unknown' when there's no coordinate to reason from (a routeless walk simply
 * skips the golden-hour beat rather than guessing).
 */
export function classifyDaylight(
  startedAt: number,
  lat: number | null | undefined,
  lng: number | null | undefined,
): Daylight {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return 'unknown';
  const date = new Date(startedAt);
  const sun = sunTimesLocalHours(date, lat, lng);
  if (!sun) return 'unknown';
  const h = date.getHours() + date.getMinutes() / 60;
  const { sunrise, sunset } = sun;
  if (h >= sunrise && h <= sunrise + 1) return 'golden_sunrise';
  if (h >= sunset - 1 && h <= sunset) return 'golden_sunset';
  if (h > sunrise && h < sunset) return 'daytime';
  return 'night';
}

// ── The story ────────────────────────────────────────────────────────────────

/**
 * Build the ordered beat list for a walk. Opener and closer always bookend;
 * every beat between them appears only when the walk's data earns it.
 */
export function buildWalkStory(input: WalkStoryInput): WalkStory {
  const name = cleanName(input.petName);
  const walkCount = input.totals?.walkCount ?? null;
  const depth = storyDepth(walkCount);
  const beats: StoryBeat[] = [];

  const sniffCount = input.sniffStops.length;
  const km = input.stats.distanceM / 1000;
  const hasRoute = input.route.length >= 2;

  // ── Opener ──
  beats.push({
    id: 'opener',
    headline: buildMomentHeadline(input.petName, input.petGender, sniffCount, input.stats.durationS),
    dateLine: momentDateLine(input.startedAt),
    // A number only once it reads as a streak, not a scoreboard.
    chapter: walkCount != null && walkCount >= 3 ? `Walk ${walkCount}` : null,
  });

  // ── Journey (route + where) ──
  beats.push({
    id: 'journey',
    journeyLine: buildMomentJourneyLine(input.labels),
    stats: buildMomentStats(input.stats, sniffCount),
    hasRoute,
  });

  // ── Sniff spot ──
  if (sniffCount >= 1) {
    const longestDwellS = input.sniffStops.reduce((m, s) => Math.max(m, s.dwellS), 0);
    beats.push({
      id: 'sniff_spot',
      count: sniffCount,
      longestDwellS,
      line:
        sniffCount === 1
          ? `${name || 'They'} found one worth stopping for, ${dwellPhrase(longestDwellS)} of it.`
          : `${sniffCount} stops today. The best one lasted ${dwellPhrase(longestDwellS)}.`,
    });
  }

  // ── Golden hour (before pace so light leads the middle) ──
  const daylight = classifyDaylight(input.startedAt, input.route[0]?.lat, input.route[0]?.lng);
  if (daylight === 'golden_sunrise' || daylight === 'golden_sunset') {
    const phase = daylight === 'golden_sunrise' ? 'sunrise' : 'sunset';
    beats.push({
      id: 'golden_hour',
      phase,
      title: 'Golden hour',
      line:
        phase === 'sunrise'
          ? 'You were out for the first of the light.'
          : 'You caught the last of the light.',
    });
  }

  // ── Weather ──
  if (input.weather) {
    beats.push({
      id: 'weather',
      tempLabel: `${Math.round(input.weather.tempC)}°`,
      conditionLabel: input.weather.label,
      line: `${Math.round(input.weather.tempC)}° and ${input.weather.label}. Out you went anyway.`,
    });
  }

  // ── Pace ──
  if (
    input.avgSpeedKmh != null &&
    input.avgSpeedKmh > 0 &&
    input.stats.durationS >= PACE_MIN_DURATION_S &&
    input.stats.distanceM >= PACE_MIN_DISTANCE_M
  ) {
    beats.push({
      id: 'pace',
      speedLabel: formatSpeed(input.avgSpeedKmh),
      line: `A steady ${formatSpeed(input.avgSpeedKmh)}, start to finish.`,
    });
  }

  // ── Distance (veterans get the archive context: longest yet) ──
  const isLongest =
    input.totals?.longestWalk != null &&
    input.totals.longestWalk.sessionId === input.sessionId &&
    km > 0;
  if (hasRoute && km > 0 && (depth === 'seasoned' || depth === 'veteran' || isLongest)) {
    beats.push({
      id: 'distance',
      distanceLabel: `${formatKm(km)} km`,
      isLongest,
      line: isLongest
        ? `${formatKm(km)} km — a new farthest for ${name || 'them'}.`
        : `${formatKm(km)} km on the map today.`,
    });
  }

  // ── Closer ──
  beats.push({
    id: 'closer',
    title: 'Keep this one',
    line: name ? `A walk with ${name}, drawn as it happened.` : 'A walk, drawn as it happened.',
  });

  return { beats, depth };
}
