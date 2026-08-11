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
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const ACK_KEY = 'walk:location_disclosure_ack';

/** True once the user has seen and accepted the disclosure. */
export async function hasAcknowledgedLocationDisclosure(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ACK_KEY)) === '1';
  } catch {
    // Fail open — show the disclosure again rather than risk skipping it.
    return false;
  }
}

/** Record acceptance. A write failure only costs one extra viewing. */
export async function acknowledgeLocationDisclosure(): Promise<void> {
  try {
    await AsyncStorage.setItem(ACK_KEY, '1');
  } catch {
    // Non-fatal by design — see the module comment.
  }
}

/** Clear the acknowledgement. Used by account deletion and sign-out paths so a
 *  new user on the same device gets the disclosure rather than inheriting it. */
export async function resetLocationDisclosure(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ACK_KEY);
  } catch {
    // Non-fatal — the next read failing open has the same effect.
  }
}
