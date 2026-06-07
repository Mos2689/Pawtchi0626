import { Linking, Platform } from 'react-native';

// Opens the platform's native subscription-management surface so an existing
// subscriber can review, change, or cancel their plan. Never routes through the
// in-app purchase paywall — that would risk a duplicate-purchase attempt.
export async function openManageSubscription(): Promise<void> {
    const primary =
        Platform.OS === 'ios'
            ? 'itms-apps://apps.apple.com/account/subscriptions'
            : 'https://play.google.com/store/account/subscriptions';
    try {
        await Linking.openURL(primary);
    } catch {
        // Fall back to the https form on iOS if the itms-apps scheme is unavailable.
        if (Platform.OS === 'ios') {
            try {
                await Linking.openURL('https://apps.apple.com/account/subscriptions');
            } catch {
                // best-effort
            }
        }
    }
}
