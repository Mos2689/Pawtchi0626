import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
    }),
});

export function usePushNotifications() {
    const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
    const [notification, setNotification] = useState<Notifications.Notification | null>(null);
    const responseListener = useRef<Notifications.Subscription>();

    useEffect(() => {
        registerForPushNotificationsAsync().then((token) => setExpoPushToken(token ?? null));

        responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
            console.log('User tapped notification', response);
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
            console.log('Failed to get push token for push notification!');
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
            console.log('Push token successfully generated:', token);
        } catch (e: unknown) {
            console.error('Push token error:', e);
            token = `Error: ${e}`;
        }
    } else {
        console.log('Must use physical device for Push Notifications');
    }

    return token;
}
