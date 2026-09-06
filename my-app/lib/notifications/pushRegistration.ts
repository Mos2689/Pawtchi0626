/**
 * pushRegistration — asking for notifications, and recording the answer.
 *
 * Plain functions rather than a hook, and that is the entire point.
 *
 * `usePushNotifications` owns real singletons: the response listener that routes
 * a tapped notification, the received listener that reports delivery, and the
 * token-rotation listener that keeps the address alive. Mounting it twice
 * registers all three twice — a tapped notification then routes twice (two
 * stacked screens to back out of), `notification_opened` and
 * `notification_received` are double-counted, and every mount spends a fresh
 * round trip on Expo's token service.
 *
 * That is exactly what was happening: the root bridge in app/_layout.tsx mounts
 * the hook for the whole session, and Home, the notification settings screen and
 * the onboarding reveal each mounted a second copy — while using nothing from it
 * except the permission request. This module is that request, on its own, so a
 * screen that only wants to ask can ask without becoming a second listener.
 *
 * ── One prompt, ever ──
 * iOS grants exactly one system dialog per install. Everything here must be
 * called from an explicit tap; nothing in this file may run because a component
 * mounted. The hook enforces the same rule (`autoRequest` defaults to false).
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import { track } from '../analytics';
import { supabase } from '../supabase';

export interface PushRegistration {
  token: string | null;
  platform: string;
  timezone: string | null;
}

/** The device's IANA zone, so the dispatcher can push at a sane local hour. */
export function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Android needs a channel before anything it posts has a sound or a priority. */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF231F7C',
  });
}

/**
 * Turn a granted permission into an address we can push to.
 *
 * Returns null — never an error string. A string here used to flow into
 * `register_push_token` and get stored as a "token"; seven such rows are still
 * in production, and the RPC now rejects them at the boundary too.
 */
export async function buildPushRegistration(): Promise<PushRegistration | null> {
  if (!Device.isDevice) {
    if (__DEV__) console.log('Must use physical device for Push Notifications');
    return null;
  }

  try {
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;

    const token = (
      await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    ).data;

    // Never log the token in production — it's sensitive.
    if (__DEV__) console.log('Push token successfully generated:', token);
    track('push_token_registered', { platform: Platform.OS, reason: 'fresh' });

    return { token, platform: Platform.OS, timezone: deviceTimezone() };
  } catch (e: unknown) {
    console.error('Push token error:', e);
    track('push_token_failed', { platform: Platform.OS });
    return null;
  }
}

/**
 * Hand the address to the server. Idempotent — the RPC upserts on the token.
 *
 * Fire-and-forget by contract: a failed sync costs one notification cycle and is
 * retried on the next launch, whereas surfacing it would interrupt whatever the
 * owner was actually doing.
 */
export function registerPushToken(registration: PushRegistration | null): void {
  if (!registration?.token) return;
  supabase
    .rpc('register_push_token', {
      push_token: registration.token,
      platform: registration.platform,
      timezone: registration.timezone,
    })
    .then(({ error }) => {
      if (error) console.error('Failed to sync push token:', error.message);
    });
}

/**
 * Ask the OS, from a user-initiated tap only.
 *
 * Registers the resulting token with the server itself rather than leaving it in
 * a caller's state. The root bridge only syncs what ITS own mount-time
 * `refreshIfGranted` found, and by the time a primer is tapped that effect has
 * long since run — so a token earned here would otherwise sit on the device
 * until the next cold start before anything could be delivered to it.
 */
export async function requestPushPermission(): Promise<PushRegistration | null> {
  await ensureAndroidChannel();

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  track('notification_permission_result', { status, platform: Platform.OS });

  if (status !== 'granted') return null;

  const registration = await buildPushRegistration();
  registerPushToken(registration);
  return registration;
}
