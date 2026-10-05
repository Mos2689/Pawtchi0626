/**
 * Rewrites links from the operating system before Expo Router reads them.
 *
 * Without this, a shared invite (`https://pawtchi.com/app/community-invite?…`)
 * opened the app on "Unmatched Route": Expo Router took `/app/community-invite`
 * literally. The mapping itself lives in lib/notifications/deepLink.ts
 * (`systemPathFor`), beside the push and email routing it shares a table with.
 *
 * Runs for the launch URL and for every link while the app is open. It must
 * never throw — an exception here crashes the app on the way in — so any
 * surprise falls back to the URL as given.
 */

import 'react-native-url-polyfill/auto';
import { systemPathFor } from '../lib/notifications/deepLink';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return systemPathFor(path) ?? path;
  } catch {
    return path;
  }
}
