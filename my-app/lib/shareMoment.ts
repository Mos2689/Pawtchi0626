// shareMoment — capture a rendered MomentCard and post it.
//
// Two paths, best one first:
//
//   Instagram story (direct) — Meta's sharing-to-stories handoff via
//     react-native-share: the card rides in as a STICKER over a navy story
//     background, so its rounded corners survive and the user can pinch /
//     move it in the composer before posting. Requires Instagram installed
//     and the Facebook App ID (Meta rejects story shares without one).
//
//   Native share sheet — everywhere else (WhatsApp, Messages, saving the
//     image, or Instagram feed). The card itself is the message: route,
//     stats and the pawtchi.com mark are baked into the pixels, so the
//     share carries no extra text and works identically wherever it lands.

import { Linking, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { color } from '../constants/design';
import { track } from './analytics';

// react-native-share and react-native-view-shot are NATIVE modules added for
// Paw Moments. walk.tsx imports this file, and expo-router evaluates every
// route module at startup — so a top-level import that throws on a dev client
// built before these modules existed (or in Expo Go) takes the router down
// with it. Lazy-require inside the functions instead, the same pattern
// WalkMap uses for MapLibre; on an old client sharing degrades gracefully
// instead of breaking the app.
function requireShare(): { Share: any; Social: any } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-share');
    return { Share: mod.default ?? mod, Social: mod.Social };
  } catch {
    return null;
  }
}

function requireCaptureRef(): ((ref: any, opts: any) => Promise<string>) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-view-shot').captureRef;
  } catch {
    return null;
  }
}

// Must match the react-native-fbsdk-next appID in app.json — Instagram's
// story API attributes the share to this app and rejects calls without it.
const FB_APP_ID = '26757552720610335';

export type ShareMomentOutcome = 'shared' | 'unavailable' | 'failed';
export type ShareMomentChannel = 'instagram_stories' | 'sheet';

export interface ShareMomentContext {
  source:
    | 'walk_summary'
    | 'walk_history'
    | 'home_feed'
    | 'milestone'
    | 'monthly_recap'
    | 'walk_gallery';
  /** Which ground the card was shared with (map / paper / photo). */
  ground?: string;
}

/** True when the direct story composer can be opened on this device. */
export async function canShareToInstagramStory(): Promise<boolean> {
  try {
    const share = requireShare();
    if (!share) return false;
    if (Platform.OS === 'ios') {
      // Resolves only when LSApplicationQueriesSchemes declares the scheme.
      return await Linking.canOpenURL('instagram-stories://share');
    }
    const { isInstalled } = await share.Share.isPackageInstalled('com.instagram.android');
    return isInstalled;
  } catch {
    return false;
  }
}

/**
 * Hand the card straight to Instagram's story composer. `shared` means the
 * composer opened — Instagram never reports whether the user actually
 * posted, so reaching the composer is the funnel's success signal.
 */
export async function shareMomentToInstagramStory(
  ref: React.Component | React.RefObject<any>,
  context: ShareMomentContext,
): Promise<ShareMomentOutcome> {
  try {
    const share = requireShare();
    const captureRef = requireCaptureRef();
    if (!share || !captureRef) {
      track('moment_card_share_failed', {
        source: context.source,
        channel: 'instagram_stories',
        reason: 'native_module_missing',
      });
      return 'unavailable';
    }

    // Stories want base64 here: iOS hands the sticker over via the
    // pasteboard and Android via a content grant react-native-share builds
    // from the data-uri — a bare tmpfile path is flaky across both.
    const dataUri = await captureRef(ref, { format: 'png', quality: 1, result: 'data-uri' });

    // Story canvas behind the sticker: warm stone, per the social identity —
    // the paper card floats on it with just enough contrast to read as a card.
    await share.Share.shareSingle({
      social: share.Social.InstagramStories,
      appId: FB_APP_ID,
      stickerImage: dataUri,
      backgroundTopColor: color.moment.paperMap,
      backgroundBottomColor: color.moment.hairline,
    });

    track('moment_card_shared', {
      source: context.source,
      channel: 'instagram_stories',
      ground: context.ground ?? null,
    });
    return 'shared';
  } catch (err) {
    track('moment_card_share_failed', {
      source: context.source,
      channel: 'instagram_stories',
      reason: err instanceof Error ? err.message : 'unknown',
    });
    return 'failed';
  }
}

/**
 * Capture the view behind `ref` to a PNG and open the native share sheet.
 * `shared` means the sheet was presented and dismissed without error.
 */
export async function shareMoment(
  ref: React.Component | React.RefObject<any>,
  context: ShareMomentContext,
): Promise<ShareMomentOutcome> {
  try {
    const captureRef = requireCaptureRef();
    if (!captureRef || !(await Sharing.isAvailableAsync())) {
      track('moment_card_share_failed', {
        source: context.source,
        channel: 'sheet',
        reason: captureRef ? 'unavailable' : 'native_module_missing',
      });
      return 'unavailable';
    }

    // Card pixels are ~320dp wide; captureRef renders at the device pixel
    // ratio, so the PNG holds up on a 1080×1920 story canvas.
    const uri = await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });

    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      dialogTitle: 'Share this walk',
      UTI: 'public.png',
    });

    track('moment_card_shared', {
      source: context.source,
      channel: 'sheet',
      ground: context.ground ?? null,
    });
    return 'shared';
  } catch (err) {
    track('moment_card_share_failed', {
      source: context.source,
      channel: 'sheet',
      reason: err instanceof Error ? err.message : 'unknown',
    });
    return 'failed';
  }
}
