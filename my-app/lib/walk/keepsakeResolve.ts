/**
 * Resolving a keepsake to something showable — and re-finding it on a new phone.
 *
 * ── The degradation ladder ──
 * Media lives on the device, so it can vanish for entirely ordinary reasons:
 * the user cleared their camera roll, iCloud offloaded the original, they got a
 * new phone, they revoked photo permission, or they granted only limited
 * access. None of those are errors and none of them may produce a broken image
 * icon in a dog's biography.
 *
 *   1. `original`  — the local asset resolved. Full quality.
 *   2. `thumbnail` — original unavailable here, but the durable ~20 KB copy
 *                    survives. The memory outlives the file.
 *   3. `context`   — no image at all. The pin, the time into the walk and the
 *                    place still describe a real moment, so a lost photo leaves
 *                    a scar in the story rather than a hole.
 *
 * `resolveKeepsake` is total: every keepsake resolves to one of the three. That
 * totality IS rung 4 ("never a broken image") — it is enforced by the type,
 * not by remembering to write an else branch at each call site.
 *
 * ── Why this file is pure ──
 * The photo library is injected as plain data (an availability flag, a list of
 * asset candidates) rather than imported, so the whole ladder is testable under
 * ts-jest with no native mocks. expo-media-library calls live in the hook that
 * feeds this.
 */

import type { Keepsake } from './keepsake';

/** Photo-library permission as the app sees it. */
export type PhotoAccess = 'granted' | 'limited' | 'denied';

export type KeepsakeRender =
  | { rung: 'original'; localAssetId: string }
  | {
      rung: 'thumbnail';
      thumbPath: string;
      blurhash: string | null;
      /** True when an original exists somewhere, just not reachable here. */
      originalElsewhere: boolean;
    }
  | { rung: 'context'; elapsedS: number | null; hasPin: boolean };

export interface ResolveInput {
  keepsake: Keepsake;
  /**
   * Did the photo library actually return this asset? The caller checks; a
   * non-null `localAssetId` alone proves nothing — it is a cache hint, and a
   * stale one is the normal state of affairs after a device migration.
   */
  localAvailable: boolean;
  access: PhotoAccess;
}

/**
 * Pick the highest rung this keepsake can honestly reach.
 *
 * Note the ordering: permission is checked before availability, because with
 * access denied we have not looked and must not imply the original is gone —
 * the user can restore it by changing their mind, and the copy differs.
 */
export function resolveKeepsake(input: ResolveInput): KeepsakeRender {
  const { keepsake, localAvailable, access } = input;

  const canReadLibrary = access !== 'denied';
  if (canReadLibrary && localAvailable && keepsake.localAssetId) {
    return { rung: 'original', localAssetId: keepsake.localAssetId };
  }

  if (keepsake.thumbPath) {
    return {
      rung: 'thumbnail',
      thumbPath: keepsake.thumbPath,
      blurhash: keepsake.thumbBlurhash,
      // With access denied we genuinely do not know, so we do not claim the
      // original is missing — only that we cannot reach it from here.
      originalElsewhere: !canReadLibrary || Boolean(keepsake.localAssetId),
    };
  }

  return {
    rung: 'context',
    elapsedS: keepsake.elapsedS,
    hasPin: keepsake.lat != null && keepsake.lng != null,
  };
}

// ── Rehydration ──────────────────────────────────────────────────────────────

/**
 * How far apart two timestamps may be and still be the same photo.
 *
 * The capture time we stored and the library's `creationTime` come from the
 * same event but not always the same clock, and transfers can round to the
 * second. Three seconds absorbs that without being wide enough to swallow the
 * next frame of a burst.
 */
export const REHYDRATE_TOLERANCE_MS = 3000;

/** The subset of a photo-library asset that rehydration needs. */
export interface AssetCandidate {
  id: string;
  /** ms since epoch. */
  creationTime: number;
  width?: number | null;
  height?: number | null;
}

/**
 * Re-bind a keepsake to a local asset on a device that has never seen it.
 *
 * This is what makes device migration work without ever uploading an original.
 * `localAssetId` does not survive the move — iOS `ph://` ids do not cross
 * devices and Android MediaStore ids are unstable across reinstall — so the
 * durable locator is content-independent: capture time, plus dimensions as a
 * tiebreaker.
 *
 * Returns the new asset id, or null when nothing is confidently the same photo.
 * Null is a fine outcome: the keepsake simply renders from its thumbnail.
 * A wrong match would silently swap a stranger's photo into a dog's biography,
 * so ties are broken conservatively and anything ambiguous is refused.
 */
export function matchAssetForKeepsake(
  keepsake: Keepsake,
  candidates: readonly AssetCandidate[],
  toleranceMs: number = REHYDRATE_TOLERANCE_MS,
): string | null {
  const inWindow = candidates.filter(
    (c) =>
      Number.isFinite(c.creationTime) &&
      Math.abs(c.creationTime - keepsake.capturedAt) <= toleranceMs,
  );
  if (inWindow.length === 0) return null;
  if (inWindow.length === 1) return inWindow[0].id;

  // Several photos in the same three seconds — a burst. Dimensions usually
  // separate them; if they do not, prefer the closest capture time.
  const dimensionMatches =
    keepsake.width != null && keepsake.height != null
      ? inWindow.filter((c) => c.width === keepsake.width && c.height === keepsake.height)
      : [];

  const pool = dimensionMatches.length > 0 ? dimensionMatches : inWindow;

  let best = pool[0];
  let bestDelta = Math.abs(best.creationTime - keepsake.capturedAt);
  let tied = false;
  for (let i = 1; i < pool.length; i++) {
    const delta = Math.abs(pool[i].creationTime - keepsake.capturedAt);
    if (delta < bestDelta) {
      best = pool[i];
      bestDelta = delta;
      tied = false;
    } else if (delta === bestDelta) {
      tied = true;
    }
  }

  // An exact tie means two indistinguishable candidates. Refusing costs a
  // thumbnail; guessing costs the wrong photo in a memory.
  return tied ? null : best.id;
}

/** Apply a rehydration result, leaving the rest of the keepsake untouched. */
export function withLocalAsset(keepsake: Keepsake, localAssetId: string | null): Keepsake {
  return { ...keepsake, localAssetId };
}
