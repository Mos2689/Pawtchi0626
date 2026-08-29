/**
 * PawtchiLiveActivity — the JS door to the walk's Lock Screen card.
 *
 * Every export here is safe to call anywhere, always. `requireOptionalNativeModule`
 * returns null in Expo Go (where `npm start` runs by default), on Android, and
 * in any build where the widget extension did not compile — and each wrapper
 * below then resolves to a harmless `false`. Callers do not have to platform-check,
 * and a missing native module can never become a thrown error inside a walk.
 */

import { requireOptionalNativeModule } from 'expo';
import type { LiveWalkContent } from '../../lib/walk/liveActivity';

/** The payload the module actually receives — content plus the walk's identity. */
export type LiveActivityPayload = LiveWalkContent & { walkId: string };

interface PawtchiLiveActivityNativeModule {
  isSupported(): boolean;
  start(content: LiveActivityPayload): Promise<boolean>;
  update(content: LiveActivityPayload): Promise<boolean>;
  end(content: LiveActivityPayload, dismissAfterMs: number): Promise<void>;
  endAll(): Promise<void>;
}

const native = requireOptionalNativeModule<PawtchiLiveActivityNativeModule>(
  'PawtchiLiveActivity',
);

/**
 * Can this device show a walk card right now?
 *
 * False on Android, in Expo Go, below iOS 16.2, and — importantly — when the
 * owner has turned Live Activities off for Pawtchi in Settings. That last case
 * is a preference, not a failure, so the bridge simply stops working rather
 * than retrying.
 */
export function isLiveActivitySupported(): boolean {
  try {
    return native?.isSupported() ?? false;
  } catch {
    return false;
  }
}

export async function startLiveActivity(content: LiveActivityPayload): Promise<boolean> {
  try {
    return (await native?.start(content)) ?? false;
  } catch {
    return false;
  }
}

export async function updateLiveActivity(content: LiveActivityPayload): Promise<boolean> {
  try {
    return (await native?.update(content)) ?? false;
  } catch {
    return false;
  }
}

export async function endLiveActivity(
  content: LiveActivityPayload,
  dismissAfterMs: number,
): Promise<void> {
  try {
    await native?.end(content, dismissAfterMs);
  } catch {
    // See the module header: an activity that has already been dismissed by
    // hand throws here, and that is not something a walk needs to know about.
  }
}

export async function endAllLiveActivities(): Promise<void> {
  try {
    await native?.endAll();
  } catch {
    // Best-effort sweep; the staleDate on every update is the other backstop.
  }
}
