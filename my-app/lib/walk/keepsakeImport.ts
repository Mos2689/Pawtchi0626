/**
 * Timestamp import — the backstop behind the in-walk camera.
 *
 * ── Why this exists even though we built a camera ──
 * The in-app camera cannot win a race it is structurally set up to lose. Native
 * camera is a lock-screen swipe, about a second; reaching Pawtchi's camera is
 * unlock, find app, tap, warm up — call it six. The moment a dog does something
 * worth photographing lasts about two. So for spontaneous captures the user
 * will, correctly, use the native camera, and a product that punishes them for
 * that by losing the moment is a product they stop trusting.
 *
 * Pawtchi already knows when the walk started and ended and where it went. That
 * is enough to find those photos afterwards and offer them, so the walk ends up
 * complete no matter which camera won. The camera is the hero; this is what
 * stops the hero having holes.
 *
 * ── Placement honesty ──
 * Two kinds of photo arrive here. One carries EXIF GPS: it gets a real
 * coordinate, a snapped route index and a place key, and can take part in place
 * memory. The other carries only a timestamp: it gets an ESTIMATED route index
 * from elapsed time and keeps `lat`/`lng` null. That asymmetry is deliberate —
 * see `draftFromAsset`. A guessed coordinate would quietly pollute the place
 * index with trees the dog never stood under.
 *
 * Pure. The photo-library query lives in the hook that calls this.
 */

import {
  IMPORT_GRACE_MS,
  estimateRouteIndexByTime,
  elapsedSecondsInto,
  isWithinWalkWindow,
  snapToRoute,
  type KeepsakeMediaType,
} from './keepsake';
import { placeKeyOrNull } from './placeKey';
import type { GeoPoint } from './geo';

/** A photo-library asset as the importer needs to see it. */
export interface ImportCandidate {
  id: string;
  /** ms since epoch. */
  creationTime: number;
  mediaType?: KeepsakeMediaType;
  width?: number | null;
  height?: number | null;
  /** EXIF location, when the camera recorded one. */
  lat?: number | null;
  lng?: number | null;
}

/**
 * A proposed keepsake, not yet accepted by the user.
 *
 * Nothing is written until someone taps. Silently absorbing photos into a walk
 * would be a surprising thing for a photo app to do and a worse thing for a
 * pet app to do.
 */
export interface KeepsakeDraft {
  localAssetId: string;
  capturedAt: number;
  lat: number | null;
  lng: number | null;
  routeIndex: number | null;
  elapsedS: number | null;
  placeKey: string | null;
  mediaType: KeepsakeMediaType;
  width: number | null;
  height: number | null;
  /** True when the position came from elapsed time rather than EXIF GPS. */
  positionEstimated: boolean;
}

export interface ImportContext {
  startedAt: number;
  endedAt: number;
  route: readonly GeoPoint[];
  graceMs?: number;
}

function finiteOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn one library asset into a draft, or refuse it.
 *
 * Refuses when the asset falls outside the walk window, or when it has a real
 * coordinate that is nowhere near the route — the second case is the photo of
 * the kitchen taken mid-walk, or a picture someone was sent. Both would
 * otherwise be offered as "moments from this walk", which is worse than
 * offering nothing.
 */
export function draftFromAsset(
  asset: ImportCandidate,
  context: ImportContext,
): KeepsakeDraft | null {
  const capturedAt = Number(asset.creationTime);
  if (!Number.isFinite(capturedAt)) return null;
  if (
    !isWithinWalkWindow(
      context.startedAt,
      context.endedAt,
      capturedAt,
      context.graceMs ?? IMPORT_GRACE_MS,
    )
  ) {
    return null;
  }

  const lat = finiteOrNull(asset.lat);
  const lng = finiteOrNull(asset.lng);
  const hasCoordinate = lat != null && lng != null;

  let routeIndex: number | null;
  let positionEstimated: boolean;

  if (hasCoordinate) {
    routeIndex = snapToRoute(context.route, { lat, lng });
    // A real coordinate that will not snap means the photo was genuinely taken
    // somewhere else during the window. Decline rather than pin it wrongly.
    if (routeIndex == null && context.route.length > 0) return null;
    positionEstimated = false;
  } else {
    routeIndex = estimateRouteIndexByTime(
      context.route,
      context.startedAt,
      context.endedAt,
      capturedAt,
    );
    positionEstimated = routeIndex != null;
  }

  return {
    localAssetId: asset.id,
    capturedAt,
    // Only an observed coordinate is ever stored. An estimate places a pin; it
    // must never masquerade as a place the dog actually stood.
    lat: hasCoordinate ? lat : null,
    lng: hasCoordinate ? lng : null,
    routeIndex,
    elapsedS: elapsedSecondsInto(context.startedAt, capturedAt),
    placeKey: hasCoordinate ? placeKeyOrNull(lat, lng) : null,
    mediaType: asset.mediaType === 'video' ? 'video' : 'photo',
    width: finiteOrNull(asset.width),
    height: finiteOrNull(asset.height),
    positionEstimated,
  };
}

/**
 * How many drafts to offer at the end of a walk.
 *
 * Someone who shot forty frames of their dog in a puddle does not want forty
 * checkboxes on the summary screen. Twelve is more than any walk usually
 * produces and few enough to stay a glance rather than a task.
 */
export const MAX_IMPORT_SUGGESTIONS = 12;

/**
 * Everything from the library worth offering for this walk, oldest first.
 *
 * `alreadyImported` carries the local asset ids the walk already holds — both
 * the in-app captures (which are saved to the library and would otherwise come
 * straight back as suggestions) and anything imported on a previous pass.
 */
export function suggestImports(
  assets: readonly ImportCandidate[],
  context: ImportContext,
  alreadyImported: readonly string[] = [],
): KeepsakeDraft[] {
  const seen = new Set(alreadyImported);

  return assets
    .filter((asset) => !seen.has(asset.id))
    .flatMap((asset) => draftFromAsset(asset, context) ?? [])
    .sort((a, b) => a.capturedAt - b.capturedAt)
    .slice(0, MAX_IMPORT_SUGGESTIONS);
}
