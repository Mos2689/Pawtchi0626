/**
 * useKeepsakeImage — resolve a keepsake to something renderable.
 *
 * Walks the degradation ladder from lib/walk/keepsakeResolve.ts and turns the
 * chosen rung into a uri an <Image> can take:
 *
 *   1a. Pawtchi's own copy, in the app container. No permission, ever.
 *   1b. the camera-roll original, when the photo library still has it
 *   2.  the durable cloud thumbnail, via a short-lived signed URL
 *   3.  nothing — the caller renders the moment's context instead
 *
 * Rung 1a is checked first and always, because reading our own container is
 * free in every sense: no prompt, no permission state to lose, and it works
 * identically on Android, which is deliberately never granted READ_MEDIA_IMAGES
 * and could therefore never reach 1b at all.
 *
 * ── Why 1b is opt-in ──
 * Reading the LIBRARY is not free of consequence. For anyone on iOS "limited"
 * access, the first read in an app launch makes the system put up its own
 * "Would Like to Access Your Photos" sheet — unprompted, over whatever screen
 * happened to mount first. Home draws keepsake pins as soon as its map is
 * ready, so leaving this on by default meant an unrequested photo prompt at
 * launch: the most alarming thing an app can do to someone who chose limited
 * access precisely because they were being careful.
 *
 * So that rung defaults to OFF and each caller opts in. It exists only for
 * keepsakes captured before Pawtchi kept its own copy — for those the camera
 * roll is genuinely the only original — and a 46dp map pin has nothing to gain
 * from one. Only a surface the user opened to LOOK at the photo asks.
 *
 * Neither local rung trusts the row. A `localPath` proves only that we once
 * wrote a file, and a `localAssetId` proves even less: after a device migration
 * every keepsake still carries one and none of them resolve. Both are checked
 * against the filesystem, and only a real answer counts.
 *
 * Never throws and never leaves a broken image behind — a failure at any step
 * simply falls to the next rung.
 */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { resolveKeepsake, type PhotoAccess } from '../lib/walk/keepsakeResolve';
import { keepsakeFileUri } from '../lib/walk/keepsakeFile';
import { thumbnailUrl } from '../lib/walk/keepsakeThumbnail';
import type { Keepsake } from '../lib/walk/keepsake';

export interface ResolvedKeepsakeImage {
  uri: string | null;
  /** Which rung answered — surfaces let the UI phrase a missing original. */
  rung: 'original' | 'thumbnail' | 'context';
  loading: boolean;
}

export interface KeepsakeImageOptions {
  /**
   * May this surface read the PHOTO LIBRARY when Pawtchi has no copy of its own?
   *
   * Pass true only where the user has asked to see the photograph itself — a
   * full-screen viewer, or a share that needs a real file — and only because
   * pre-existing keepsakes have nowhere else to get an original. Everywhere
   * else the thumbnail is both sufficient and quieter. See the note above.
   *
   * Has no bearing on Pawtchi's own copy, which is always used when present.
   */
  allowLocalOriginal?: boolean;
}

export function useKeepsakeImage(
  keepsake: Keepsake | null,
  options: KeepsakeImageOptions = {},
): ResolvedKeepsakeImage {
  // Read as a primitive: an options object is a fresh reference every render,
  // and depending on it directly would re-run the effect forever.
  const allowLocalOriginal = options.allowLocalOriginal ?? false;

  const [state, setState] = useState<ResolvedKeepsakeImage>({
    uri: null,
    rung: 'context',
    loading: Boolean(keepsake),
  });

  useEffect(() => {
    if (!keepsake) {
      setState({ uri: null, rung: 'context', loading: false });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    void (async () => {
      // ── Rung 1a: our own copy ──
      //
      // Unconditional. No permission is involved, so there is no state of the
      // world in which asking is the wrong thing to do, and no platform fork —
      // this is the same code path on Android, which is the only way Android
      // ever sees an original.
      const ownedUri = keepsakeFileUri(keepsake.localPath);
      if (ownedUri) {
        if (cancelled) return;
        setState({ uri: ownedUri, rung: 'original', loading: false });
        return;
      }

      // ── Rung 1b: the camera-roll original ──
      let localAvailable = false;
      let localUri: string | null = null;
      // 'denied' is also the right value when we simply did not look: it makes
      // resolveKeepsake say "cannot reach it from here" rather than "it is
      // gone", which is the honest reading of a lookup we chose not to run.
      let access: PhotoAccess = 'denied';

      // Android deliberately does not request READ_MEDIA_IMAGES, so it can
      // never resolve a library asset — only iOS reaches this rung, and only
      // for keepsakes older than rung 1a.
      if (allowLocalOriginal && keepsake.localAssetId && Platform.OS !== 'android') {
        try {
          const permission = await MediaLibrary.getPermissionsAsync();
          access = permission.granted
            ? permission.accessPrivileges === 'limited'
              ? 'limited'
              : 'granted'
            : 'denied';

          if (permission.granted) {
            const info = await MediaLibrary.getAssetInfoAsync(keepsake.localAssetId);
            // localUri is the platform-usable path; on Android the bare asset
            // id is not something <Image> can load.
            localUri = info?.localUri ?? info?.uri ?? null;
            localAvailable = Boolean(localUri);
          }
        } catch {
          localAvailable = false;
        }
      }

      if (cancelled) return;

      const render = resolveKeepsake({ keepsake, localAvailable, access });

      if (render.rung === 'original' && localUri) {
        setState({ uri: localUri, rung: 'original', loading: false });
        return;
      }

      if (render.rung === 'thumbnail') {
        const signed = await thumbnailUrl(render.thumbPath);
        if (cancelled) return;
        // A signed-URL failure is not a reason to show a broken frame; drop to
        // context, which still describes a real moment.
        setState({
          uri: signed,
          rung: signed ? 'thumbnail' : 'context',
          loading: false,
        });
        return;
      }

      setState({ uri: null, rung: 'context', loading: false });
    })();

    return () => {
      cancelled = true;
    };
  }, [keepsake, allowLocalOriginal]);

  return state;
}
