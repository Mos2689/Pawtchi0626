/**
 * useKeepsakeImage — resolve a keepsake to something renderable.
 *
 * Walks the degradation ladder from lib/walk/keepsakeResolve.ts and turns the
 * chosen rung into a uri an <Image> can take:
 *
 *   1. the local original, when the photo library still has it
 *   2. the durable cloud thumbnail, via a short-lived signed URL
 *   3. nothing — the caller renders the moment's context instead
 *
 * The local lookup is what makes rung 1 honest. A non-null `localAssetId` is a
 * cache hint, not proof: after a device migration every keepsake still carries
 * one and none of them resolve. So the asset is actually requested, and only a
 * real answer counts.
 *
 * Never throws and never leaves a broken image behind — a failure at any step
 * simply falls to the next rung.
 */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { resolveKeepsake, type PhotoAccess } from '../lib/walk/keepsakeResolve';
import { thumbnailUrl } from '../lib/walk/keepsakeThumbnail';
import type { Keepsake } from '../lib/walk/keepsake';

export interface ResolvedKeepsakeImage {
  uri: string | null;
  /** Which rung answered — surfaces let the UI phrase a missing original. */
  rung: 'original' | 'thumbnail' | 'context';
  loading: boolean;
}

export function useKeepsakeImage(keepsake: Keepsake | null): ResolvedKeepsakeImage {
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
      // ── Is the original actually reachable on THIS device? ──
      let localAvailable = false;
      let localUri: string | null = null;
      let access: PhotoAccess = 'denied';

      // Android deliberately does not request READ_MEDIA_IMAGES. Captures are
      // rendered from Pawtchi's durable thumbnail; the original remains in the
      // user's gallery. iOS can still resolve the saved asset id.
      if (keepsake.localAssetId && Platform.OS !== 'android') {
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
  }, [keepsake]);

  return state;
}
