import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { track } from '@/lib/analytics';
import { campaignKeyFor, routeFor, type NotificationPayload } from '@/lib/notifications/deepLink';
import {
  buildPushRegistration,
  deviceTimezone,
  ensureAndroidChannel,
  requestPushPermission,
  type PushRegistration,
} from '@/lib/notifications/pushRegistration';

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
    }),
});

/**
 * Route a tapped notification. All routing decisions live in
 * lib/notifications/deepLink.ts, which is unit-tested against both the current
 * payload contract and the legacy `event` / `action` shapes still sitting in
 * users' notification trays.
 *
 * Before the August 2026 rebuild this function branched on `data.type`, a key
 * that only the two functions which had never delivered anything ever set — so
 * every tap fell through every branch and went nowhere.
 */
function handleNotificationResponse(
    router: ReturnType<typeof useRouter>,
    response: Notifications.NotificationResponse | null,
    markOpened: (dedupeKey: string) => void,
) {
    const data = response?.notification?.request?.content?.data as NotificationPayload | undefined;
    if (!data) return;

    const campaign = campaignKeyFor(data);
    const route = routeFor(data);

    track('notification_opened', {
        campaign_key: campaign,
        routed: Boolean(route),
        route,
    });

    if (typeof data.dedupeKey === 'string' && data.dedupeKey) {
        markOpened(data.dedupeKey);
    }

    // No route is better than an arbitrary one — leave the user where they are.
    if (route) router.push(route as never);
}

export type { PushRegistration };

/**
 * The notification listeners, and the token that keeps them worth having.
 *
 * MOUNT THIS ONCE PER SESSION — it is currently mounted by
 * `PushNotificationsBridge` in app/_layout.tsx and nowhere else. Every mount
 * registers its own response / received / token-rotation listeners, so a second
 * copy routes a tapped notification twice and double-counts the funnel.
 *
 * A screen that only needs to ASK for permission wants
 * `requestPushPermission()` from lib/notifications/pushRegistration.ts instead;
 * it is the same request without the listeners.
 */
export function usePushNotifications(options?: { autoRequest?: boolean }) {
    // Default false: the OS prompt is a one-shot resource and is now triggered
    // by an explicit tap in the primer, not by a component mounting. Opt-in was
    // 9% (16 of 177 users) while this fired cold on the first authed frame.
    const autoRequest = options?.autoRequest ?? false;

    const [registration, setRegistration] = useState<PushRegistration | null>(null);
    const [permissionStatus, setPermissionStatus] = useState<Notifications.PermissionStatus | null>(null);
    const [notification, setNotification] = useState<Notifications.Notification | null>(null);
    const responseListener = useRef<Notifications.Subscription | undefined>(undefined);
    const receivedListener = useRef<Notifications.Subscription | undefined>(undefined);
    const tokenListener = useRef<Notifications.Subscription | undefined>(undefined);
    const markOpenedRef = useRef<(key: string) => void>(() => {});
    const router = useRouter();

    /** Registers only if permission is already granted. Never prompts. */
    const refreshIfGranted = useCallback(async () => {
        const { status } = await Notifications.getPermissionsAsync();
        setPermissionStatus(status);
        if (status !== 'granted') return null;
        const next = await buildPushRegistration();
        setRegistration(next);
        return next;
    }, []);

    /** Explicitly asks the OS. Call this from a user-initiated tap only. */
    const requestPermission = useCallback(async () => {
        const next = await requestPushPermission();
        // The request re-reads permission on the way through; mirror whatever it
        // settled on rather than asking the OS a third time.
        const { status } = await Notifications.getPermissionsAsync();
        setPermissionStatus(status);
        setRegistration(next);
        return next;
    }, []);

    useEffect(() => {
        void (async () => {
            await ensureAndroidChannel();
            if (autoRequest) {
                await requestPermission();
            } else {
                await refreshIfGranted();
            }
        })();

        // Cold start: the app was opened by tapping a notification.
        Notifications.getLastNotificationResponseAsync().then((response) => {
            handleNotificationResponse(router, response, (key) => markOpenedRef.current(key));
        });

        // Warm taps while the app is running.
        responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
            handleNotificationResponse(router, response, (key) => markOpenedRef.current(key));
        });

        // Foreground arrivals — the delivery half of the funnel.
        receivedListener.current = Notifications.addNotificationReceivedListener((incoming) => {
            setNotification(incoming);
            const data = incoming.request.content.data as NotificationPayload | undefined;
            track('notification_received', { campaign_key: campaignKeyFor(data) });
        });

        // The OS rotates push tokens (reinstall, restore, APNs refresh). Without
        // this listener a rotated token silently orphans the user: the server
        // keeps pushing to a dead address and nothing ever notices.
        tokenListener.current = Notifications.addPushTokenListener((next) => {
            setRegistration({
                token: next.data,
                platform: Platform.OS,
                timezone: deviceTimezone(),
            });
            track('push_token_registered', { platform: Platform.OS, reason: 'rotated' });
        });

        return () => {
            responseListener.current?.remove();
            receivedListener.current?.remove();
            tokenListener.current?.remove();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
        registration,
        expoPushToken: registration?.token ?? null,
        permissionStatus,
        notification,
        requestPermission,
        refreshIfGranted,
        /** Wired by the bridge so a tap can mark the ledger row opened. */
        setMarkOpened: (fn: (key: string) => void) => { markOpenedRef.current = fn; },
    };
}

