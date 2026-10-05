/**
 * What to do when a permission the person just asked for is not granted.
 *
 * A line of red text was all most screens offered, and on Android that is a
 * dead end: after two refusals Android stops showing its own prompt, so the
 * button that asks again silently returns "denied" and nothing visible
 * happens. This gives every such moment the same way out — a plain reason and
 * a button straight to Pawtchi's page in the phone's settings — on both
 * platforms.
 */

import { Alert, Linking } from 'react-native';

export type BlockedPermission = 'location' | 'location_services' | 'camera';

export const BLOCKED_PERMISSION_COPY: Record<BlockedPermission, { title: string; body: string }> = {
  location: {
    title: 'Location is off for Pawtchi',
    body: 'Pawtchi uses your location only while a walk is running, to measure it. Allow location for Pawtchi in settings, then come back and start again.',
  },
  location_services: {
    title: 'Location is off on this phone',
    body: 'Turn on location in your phone’s settings, then come back and start the walk.',
  },
  camera: {
    title: 'Camera is off for Pawtchi',
    body: 'Allow the camera for Pawtchi in settings, then come back and take the photo.',
  },
};

/** Explain, and offer the settings page. Never blocks; "Not now" simply closes. */
export function showBlockedPermission(kind: BlockedPermission): void {
  const copy = BLOCKED_PERMISSION_COPY[kind];
  Alert.alert(copy.title, copy.body, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open settings', onPress: () => { void Linking.openSettings().catch(() => {}); } },
  ]);
}
