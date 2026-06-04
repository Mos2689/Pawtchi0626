import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import * as SplashScreen from 'expo-splash-screen';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider } from '@/providers/AuthProvider';
import { WalkthroughProvider } from '@/providers/WalkthroughContext';
import { useAuth } from '@/providers/AuthProvider';

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session } = useAuth();

  // Initialize RevenueCat SDK on mount
  useEffect(() => {
    try {
      // Only log verbosely in development — never in production builds
      if (__DEV__) {
        Purchases.setLogLevel(LOG_LEVEL.VERBOSE);
      }
      const apiKey = Platform.OS === 'ios' 
        ? process.env.EXPO_PUBLIC_RC_IOS_KEY 
        : process.env.EXPO_PUBLIC_RC_ANDROID_KEY;
      
      if (apiKey) {
        Purchases.configure({ apiKey });
      } else {
        console.warn('RevenueCat API key is missing from environment variables.');
      }
    } catch (e) {
      console.warn('RevenueCat configure failed (likely running in Expo Go without native modules):', e);
    }
  }, []);

  // Link RevenueCat identity to Supabase user so subscription persists across reinstalls
  useEffect(() => {
    try {
      if (session?.user?.id) {
        Purchases.logIn(session.user.id).catch((e) =>
          console.warn('RevenueCat logIn error:', e)
        );
      } else {
        // Log out of RevenueCat when user signs out
        Purchases.logOut().catch(() => {});
      }
    } catch (e) {
      console.warn('RevenueCat logIn/out failed (likely running in Expo Go without native modules):', e);
    }
  }, [session?.user?.id]);

  // Hide splash screen when session state is determined
  useEffect(() => {
    if (session !== undefined) {
      SplashScreen.hideAsync();
    }
  }, [session]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="invite" options={{ presentation: 'card', headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <WalkthroughProvider>
        <RootLayoutNav />
      </WalkthroughProvider>
    </AuthProvider>
  );
}
