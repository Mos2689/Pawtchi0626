/**
 * locationDisclosure — the one-time "here is what tracking collects" gate that
 * must run BEFORE the OS location prompt.
 *
 * Why this exists: Google Play's Location Permissions policy requires a
 * prominent in-app disclosure before the runtime permission request whenever an
 * app collects location in the background — which a tracked walk does, via the
 * Android foreground service and the iOS background-location mode. Until this
 * shipped, tapping Walk went straight to the system dialog, so the only text a
 * user ever saw about location was the OS permission string.
 *
 * The acknowledgement is deliberately durable and separate from the OS grant:
 * the system prompt appears once, but the disclosure has to have preceded it,
 * and a user who denies and later retries should see the explanation again
 * rather than a bare dialog. Storage failures fail OPEN (treated as "not
 * acknowledged") so a broken read shows the disclosure one extra time rather
 * than skipping it — showing it twice is a papercut, skipping it is a policy
 * violation.
 *
 * The acknowledgement is per ACCOUNT, not per device. It used to be one global
 * key, which meant a second account created on the same phone inherited the
 * first owner's acknowledgement and never saw the disclosure at all — the
 * device had consented, but that person had not. Namespacing on the Supabase
 * user id follows `hooks/useFirstWalkIntro.ts` and, unlike clearing on
 * sign-out, keeps each owner's own answer: signing back into the first account
 * does not re-show a disclosure it already accepted, and a missed reset can no
 * longer leak consent between people.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const ACK_PREFIX = 'walk:location_disclosure_ack';

/**
 * The pre-namespacing key. Nothing reads it any more — every account is asked
 * once under its own key, which is the whole point: consent given by one person
 * cannot stand in for another's. It is only listed so the sweep below can
 * remove it.
 */
const LEGACY_GLOBAL_ACK_KEY = ACK_PREFIX;

/** Per-account storage key. */
export function locationDisclosureKey(userId: string): string {
  return `${ACK_PREFIX}:${userId}`;
}

/**
 * True once THIS user has seen and accepted the disclosure.
 *
 * A missing user id reads as "not acknowledged" — the same fail-open rule as a
 * storage error. There is no one to have consented yet, so the only safe answer
 * is to show the disclosure.
 */
export async function hasAcknowledgedLocationDisclosure(
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await AsyncStorage.getItem(locationDisclosureKey(userId))) === '1';
  } catch {
    // Fail open — show the disclosure again rather than risk skipping it.
    return false;
  }
}

/** Record acceptance for this user. A write failure only costs one extra viewing. */
export async function acknowledgeLocationDisclosure(
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(locationDisclosureKey(userId), '1');
  } catch {
    // Non-fatal by design — see the module comment.
  }
}

/**
 * Clear the acknowledgement. With a userId, only that account's; with no
 * argument, every account's plus the legacy global key.
 *
 * Used by account deletion. Sign-out no longer needs it — the keys are
 * namespaced, so nothing crosses accounts in the first place.
 */
export async function resetLocationDisclosure(userId?: string): Promise<void> {
  try {
    if (userId) {
      await AsyncStorage.removeItem(locationDisclosureKey(userId));
      return;
    }
    const keys = await AsyncStorage.getAllKeys();
    const targets = keys.filter(
      k => k === LEGACY_GLOBAL_ACK_KEY || k.startsWith(`${ACK_PREFIX}:`),
    );
    if (targets.length > 0) await AsyncStorage.multiRemove(targets);
  } catch {
    // Non-fatal — the next read failing open has the same effect.
  }
}
