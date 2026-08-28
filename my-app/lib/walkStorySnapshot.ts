import {
  resolveSniffStops,
  type MomentRoutePoint,
  type MomentStats,
  type SniffStop,
} from './momentCard';
import type { WalkTotals } from './pawPrints';
import {
  buildWalkStory,
  type WalkStory,
  type WalkStoryInput,
  type WalkWeather,
} from './walkStory';
import type { WalkLabels } from './walk/geoLabels';
import { normalizeKeepsake, sortKeepsakes, type Keepsake } from './walk/keepsake';

/** v2 added `keepsakes`. */
export const WALK_STORY_SNAPSHOT_VERSION = 2 as const;

/**
 * Versions this build can still render.
 *
 * `version` is typed as a plain number rather than the literal so a cached v1
 * object — written by a previous build, missing `keepsakes` entirely — still
 * satisfies the type and still renders. Every field v2 added is optional or
 * defaulted precisely so that stays true: a story from before this feature
 * existed must never fail to open.
 */
export const SUPPORTED_SNAPSHOT_VERSIONS: readonly number[] = [1, 2];

/**
 * Everything the native Story renderer needs, normalized and safe to cache.
 * Screen dimensions deliberately stay out: the same snapshot can be projected
 * into any viewport at render time.
 */
export interface WalkStorySnapshot {
  version: number;
  walkSessionId: string;
  petId: string;
  petName: string | null;
  petGender: string | null;
  breedLine: string | null;
  startedAt: number;
  route: MomentRoutePoint[];
  sniffStops: SniffStop[];
  labels: WalkLabels;
  stats: MomentStats;
  avgSpeedKmh: number | null;
  weather: WalkWeather | null;
  totals: WalkTotals | null;
  /** v2+. Absent on cached v1 snapshots, which simply have no keepsake beat. */
  keepsakes?: Keepsake[];
  cachedAt: number;
}

export interface WalkStorySnapshotSource {
  walkSessionId: unknown;
  petId: unknown;
  petName?: unknown;
  petGender?: unknown;
  breed?: unknown;
  ageYears?: unknown;
  startedAt: unknown;
  durationS?: unknown;
  movingTimeS?: unknown;
  distanceM?: unknown;
  avgSpeedKmh?: unknown;
  route?: unknown;
  pausePoints?: unknown;
  sniffPoints?: unknown;
  startLabel?: unknown;
  endLabel?: unknown;
  farthestLabel?: unknown;
  weather?: unknown;
  totals?: WalkTotals | null;
  /** Raw `walk_media` rows; each is normalized and malformed ones dropped. */
  keepsakes?: unknown;
  cachedAt?: number;
}

/** JSONB route fields may be [[lat,lng], ...] or [{lat,lng}, ...]. */
export function parseWalkStoryGeoPoints(raw: unknown): MomentRoutePoint[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.flatMap((entry) => {
    if (Array.isArray(entry)) {
      const lat = Number(entry[0]);
      const lng = Number(entry[1]);
      return Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : [];
    }
    if (entry && typeof entry === 'object') {
      const lat = Number((entry as MomentRoutePoint).lat);
      const lng = Number((entry as MomentRoutePoint).lng);
      return Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : [];
    }
    return [];
  });
}

/**
 * Normalize the walk's keepsake rows, dropping any that are malformed.
 *
 * Same posture as parseWalkStoryGeoPoints above: one bad row must not cost the
 * user the rest of their story.
 */
export function parseWalkStoryKeepsakes(raw: unknown): Keepsake[] {
  if (!Array.isArray(raw)) return [];
  return sortKeepsakes(raw.flatMap((row) => normalizeKeepsake(row) ?? []));
}

export function parseWalkStoryWeather(raw: unknown): WalkWeather | null {
  if (!raw || typeof raw !== 'object') return null;
  const weather = raw as Partial<WalkWeather>;
  const tempC = Number(weather.tempC);
  if (!Number.isFinite(tempC) || typeof weather.label !== 'string') return null;
  return {
    tempC,
    code: Number.isFinite(Number(weather.code)) ? Number(weather.code) : 0,
    label: weather.label,
  };
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildWalkStoryBreedLine(
  breed: unknown,
  ageYears: unknown,
): string | null {
  const cleanBreed = nullableText(breed);
  const parsedAge = Number(ageYears);
  const wholeYears = Number.isFinite(parsedAge) && parsedAge >= 1
    ? Math.floor(parsedAge)
    : null;
  const line = [
    cleanBreed,
    wholeYears ? `${wholeYears} year${wholeYears === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return line || null;
}

export function createWalkStorySnapshot(
  source: WalkStorySnapshotSource,
): WalkStorySnapshot | null {
  const walkSessionId = nullableText(source.walkSessionId);
  const petId = nullableText(source.petId);
  const startedAt = source.startedAt instanceof Date
    ? source.startedAt.getTime()
    : typeof source.startedAt === 'string'
      ? Date.parse(source.startedAt)
      : Number(source.startedAt);
  if (!walkSessionId || !petId || !Number.isFinite(startedAt)) return null;

  const route = parseWalkStoryGeoPoints(source.route);
  const pausePoints = parseWalkStoryGeoPoints(source.pausePoints);
  const farthestLabel = nullableText(source.farthestLabel);

  return {
    version: WALK_STORY_SNAPSHOT_VERSION,
    walkSessionId,
    petId,
    petName: nullableText(source.petName),
    petGender: nullableText(source.petGender),
    breedLine: buildWalkStoryBreedLine(source.breed, source.ageYears),
    startedAt,
    route,
    sniffStops: resolveSniffStops(source.sniffPoints, pausePoints),
    labels: {
      startLabel: nullableText(source.startLabel),
      endLabel: nullableText(source.endLabel),
      farthestLabel,
      isLoop: Boolean(farthestLabel),
    },
    stats: {
      durationS: finiteNumber(source.durationS),
      movingTimeS: finiteNumber(source.movingTimeS),
      distanceM: finiteNumber(source.distanceM),
    },
    avgSpeedKmh:
      source.avgSpeedKmh == null ? null : finiteNumber(source.avgSpeedKmh),
    weather: parseWalkStoryWeather(source.weather),
    totals: source.totals ?? null,
    keepsakes: parseWalkStoryKeepsakes(source.keepsakes),
    cachedAt: source.cachedAt ?? Date.now(),
  };
}

export function snapshotToWalkStoryInput(
  snapshot: WalkStorySnapshot,
): WalkStoryInput {
  return {
    petName: snapshot.petName,
    petGender: snapshot.petGender,
    sessionId: snapshot.walkSessionId,
    startedAt: snapshot.startedAt,
    route: snapshot.route,
    sniffStops: snapshot.sniffStops,
    labels: snapshot.labels,
    stats: snapshot.stats,
    avgSpeedKmh: snapshot.avgSpeedKmh,
    weather: snapshot.weather,
    totals: snapshot.totals,
    // `?? []` is what makes a v1 snapshot render: no keepsakes, no beat, same
    // story it told before.
    keepsakes: snapshot.keepsakes ?? [],
  };
}

export function buildStoryFromSnapshot(snapshot: WalkStorySnapshot): WalkStory {
  return buildWalkStory(snapshotToWalkStoryInput(snapshot));
}
