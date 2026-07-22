import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
    }),
});

// Route a tapped notification to the right place. Returns true if handled.
function routeFromNotification(router: ReturnType<typeof useRouter>, response: Notifications.NotificationResponse | null) {
    const data = response?.notification?.request?.content?.data as Record<string, unknown> | undefined;
    if (!data) return;
    if (data.type === 'vet_checkin' && typeof data.questionId === 'string') {
        router.push(`/ask?case=${data.questionId}&mode=checkin` as any);
    } else if (data.type === 'activity_reminder') {
        // Anticipatory walk/feeding/training nudge — open the activity tab so
        // the user can see what's coming up next. The activity id is in
        // `data.activityId` if we ever want to scroll-to or expand it.
        router.push('/(tabs)/activity' as any);
    }
}

export function usePushNotifications() {
    const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
    const [notification, setNotification] = useState<Notifications.Notification | null>(null);
    const responseListener = useRef<Notifications.Subscription | undefined>(undefined);
    const router = useRouter();

    useEffect(() => {
        registerForPushNotificationsAsync().then((token) => setExpoPushToken(token ?? null));

        // Cold start: app opened by tapping a notification.
        Notifications.getLastNotificationResponseAsync().then((response) => {
            routeFromNotification(router, response);
        });

        // Warm taps while the app is running.
        responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
            routeFromNotification(router, response);
        });

        return () => {
            responseListener.current?.remove();
        };
    }, []);

    return { expoPushToken, notification };
}

async function registerForPushNotificationsAsync() {
    let token;

    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
        });
    }

    if (Device.isDevice) {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }
        if (finalStatus !== 'granted') {
            if (__DEV__) console.log('Failed to get push token for push notification!');
            return null;
        }

        try {
            const projectId =
                Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;

            token = (
                await Notifications.getExpoPushTokenAsync(
                    projectId ? { projectId } : undefined
                )
            ).data;
            // Never log the token in production — it's sensitive.
            if (__DEV__) console.log('Push token successfully generated:', token);
        } catch (e: unknown) {
            // Return null — never an error string. A string here used to flow
            // into register_push_token and get stored as a "token", silently
            // breaking pushes for that user.
            console.error('Push token error:', e);
            token = null;
        }
    } else {
        if (__DEV__) console.log('Must use physical device for Push Notifications');
    }

    return token;
}
