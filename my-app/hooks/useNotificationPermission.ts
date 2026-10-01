/**
 * useNotificationPermission — the single read of OS notification state.
 *
 * Deliberately lightweight: it queries the OS and registers no notification
 * listeners, so it is safe to mount in several places at once (the Home
 * header chip, the settings screen, the value-moment primer). All the
 * listener-owning work stays in `usePushNotifications`, which mounts once.
 *
 * The refresh-on-foreground is the important part. A user who denies at the
 * OS level can only recover by leaving for Settings and coming back, and
 * without re-reading on return the app would keep telling them notifications
 * are off after they had just switched them on.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { isPerfFlagOn } from '@/lib/perfFlags';
import { markSynced, readPushEnabled, rememberPushEnabled, shouldSync } from '@/lib/notifications/notifSync';

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'loading';

export interface NotificationPermission {
  status: PermissionState;
  /** True when the OS will still show a prompt. iOS allows exactly one. */
  canAsk: boolean;
  /** Granted at the OS level — a token can be issued. */
  isGranted: boolean;
  /**
   * Spent prompt. The only route back is the system settings app; nothing the
   * app renders can re-open the OS dialog.
   */
  isBlocked: boolean;
  /**
   * `owner_preferences.push_enabled` — Pawtchi's own master switch. Null until
   * loaded. Separate from OS permission on purpose: an owner can have granted
   * at the system level and still have turned Pawtchi off inside the app.
   */
  pushEnabledInApp: boolean | null;
  /**
   * The question every surface actually wants answered: can Pawtchi reach this
   * person? Both gates must be open. Checking only the OS permission was a bug
   * — it reported "reachable" for an owner who had switched Pawtchi off in the
   * settings screen and was receiving nothing.
   */
  isReachable: boolean;
  refresh: () => Promise<PermissionState>;
  openSystemSettings: () => void;
}

/**
 * Tell the server the OS permission. Every mounted copy of this hook used to
 * send it at least once per launch (each copy's `lastSynced` only knew about
 * itself). With the `pushChangeDetection` perf flag on, a state the server
 * already accepted this week is skipped — shared across copies via the ledger
 * in notifSync.ts, which sign-out wipes. Remembered only after success.
 */
function recordPermission(state: PermissionState, ownerId: string | undefined): void {
  const send = () => {
    supabase.rpc('record_notification_permission', { p_status: state })
      .then(({ error }) => {
        if (error) {
          if (__DEV__) console.log('record_notification_permission:', error.message);
          return;
        }
        if (ownerId) void markSynced('notification_permission', ownerId, state).catch(() => {});
      });
  };
  if (!ownerId || !isPerfFlagOn('pushChangeDetection')) {
    send();
    return;
  }
  void shouldSync('notification_permission', ownerId, state).then(needed => {
    if (needed) send();
  });
}

/** Normalises the platform differences into the three states we care about. */
function toState(perm: Notifications.NotificationPermissionsStatus): PermissionState {
  if (perm.granted) return 'granted';
  // iOS reports `undetermined` before the first ask; once asked and refused,
  // canAskAgain goes false. Android 13+ behaves the same way for POST_NOTIFICATIONS.
  if (perm.canAskAgain && perm.status === 'undetermined') return 'undetermined';
  return perm.canAskAgain ? 'undetermined' : 'denied';
}

export function useNotificationPermission(): NotificationPermission {
  const [status, setStatus] = useState<PermissionState>('loading');
  const [canAsk, setCanAsk] = useState(false);
  const [pushEnabledInApp, setPushEnabledInApp] = useState<boolean | null>(null);
  // Only write to the server when the value actually changes, so a foreground
  // event does not produce an RPC call on every single app switch.
  const lastSynced = useRef<PermissionState | null>(null);

  /**
   * The pass currently in flight, if any.
   *
   * Home calls `refresh` from its focus effect while this hook's own mount
   * effect is already running one — the two fire in the same commit — so every
   * cold start was paying for the whole pass twice. Handing the second caller
   * the first one's promise collapses that without introducing a staleness
   * window, which matters: the one thing this hook must never miss is the owner
   * coming back from the settings screen having just changed the answer.
   */
  const inFlight = useRef<Promise<PermissionState> | null>(null);

  const runRefresh = useCallback(async (): Promise<PermissionState> => {
    let next: PermissionState = 'undetermined';
    let ask = true;
    try {
      const perm = await Notifications.getPermissionsAsync();
      next = toState(perm);
      ask = perm.canAskAgain && !perm.granted;
    } catch {
      // Expo Go on some platforms, or a simulator without the module. Treat as
      // unknown-but-askable rather than blocking the UI on it.
      next = 'undetermined';
      ask = true;
    }

    setStatus(next);
    setCanAsk(ask);

    // `getSession` rather than `getUser`: the latter is a round trip to the auth
    // server, and this pass runs on every foreground and every Home focus. The
    // session is already on disk and carries the same id — the only thing this
    // needs it for.
    let ownerId: string | undefined;
    try {
      const { data: auth } = await supabase.auth.getSession();
      ownerId = auth?.session?.user?.id;
    } catch {
      ownerId = undefined;
    }

    if (lastSynced.current !== next) {
      lastSynced.current = next;
      recordPermission(next, ownerId);
    }

    // Pawtchi's own switch. A missing row means the owner never opened the
    // settings screen, which defaults to enabled.
    if (ownerId) {
      // Perf flag on: a read from the last few minutes is reused, so a
      // foreground or a Home focus no longer queries owner_preferences each
      // time. The settings screen writes through on save (preferences.ts).
      const remembered = isPerfFlagOn('pushChangeDetection') ? readPushEnabled(ownerId) : undefined;
      if (remembered !== undefined) {
        setPushEnabledInApp(remembered);
      } else {
        try {
          const { data } = await supabase
            .from('owner_preferences')
            .select('push_enabled')
            .eq('owner_id', ownerId)
            .maybeSingle();
          const value = (data as { push_enabled?: boolean } | null)?.push_enabled ?? true;
          rememberPushEnabled(ownerId, value);
          setPushEnabledInApp(value);
        } catch {
          // A dropped connection is not evidence the owner switched Pawtchi off.
          // Leaving the previous answer in place keeps `isReachable` honest, and
          // an unhandled rejection here would surface on a screen that only
          // wanted to know whether to draw a badge.
        }
      }
    }

    return next;
  }, []);

  const refresh = useCallback(async (): Promise<PermissionState> => {
    if (inFlight.current) return inFlight.current;
    const pass = runRefresh().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = pass;
    return pass;
  }, [runRefresh]);

  useEffect(() => {
    void refresh();

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      // Coming back from the system settings app is the whole reason this
      // listener exists.
      if (next === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const openSystemSettings = useCallback(() => {
    // openSettings() lands on the app's own settings page on both platforms.
    if (Platform.OS === 'ios') {
      void Linking.openURL('app-settings:');
    } else {
      void Linking.openSettings();
    }
  }, []);

  return {
    status,
    canAsk,
    isGranted: status === 'granted',
    isBlocked: status === 'denied',
    pushEnabledInApp,
    // Both gates. `pushEnabledInApp === null` means not loaded yet, so treat it
    // as open rather than flashing an "off" state while the query is in flight.
    isReachable: status === 'granted' && pushEnabledInApp !== false,
    refresh,
    openSystemSettings,
  };
}
