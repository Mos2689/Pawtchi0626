import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  Montserrat_800ExtraBold,
} from '@expo-google-fonts/montserrat';
import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider } from '@/providers/AuthProvider';
import { WalkthroughProvider } from '@/providers/WalkthroughContext';
import { SubscriptionProvider } from '@/providers/SubscriptionProvider';
import { useAuth } from '@/providers/AuthProvider';


export const unstable_settings = {
  initialRouteName: '(tabs)',
};

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session, isLoading: authLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const navState = useRootNavigationState();

  // Brand fonts load once here for the whole app (screens never call useFonts
  // themselves). The splash stays up until both fonts and auth state resolve,
  // so the first painted frame is already in the brand typography.
  const [fontsLoaded] = useFonts({
    BebasNeue_400Regular,
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
  });

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

  // Initialize Meta (Facebook) SDK + ATT consent on mount.
  // The FBSDK package executes NativeEventEmitter in its global scope, which
  // throws an invariant when the native module is missing (Expo Go / dev client
  // without the native build). We guard with a NativeModules check BEFORE
  // require() so the module never loads in environments that lack the native code.
  useEffect(() => {
    const initMeta = async () => {
      try {
        const { NativeModules: NM } = require('react-native');
        if (!NM.FBLoginManager && !NM.LoginManager) {
          return;
        }
        const { Settings } = require('react-native-fbsdk-next');
        const { requestTrackingPermissionsAsync } = require('expo-tracking-transparency');
        const { initMetaAnalytics } = require('@/lib/metaEvents');

        if (Platform.OS === 'ios') {
          const { status } = await requestTrackingPermissionsAsync();
          await Settings.setAdvertiserTrackingEnabled(status === 'granted');
        }
        Settings.initializeSDK();
        initMetaAnalytics();
      } catch (e) {
        console.warn('Meta SDK init skipped (native module unavailable):', e);
      }
    };
    initMeta();
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

  // ── Centralized auth gate — THE single authority for auth-based navigation ──
  // Navigation is a pure function of auth state, decided in exactly one place.
  // No screen redirects on `session` itself; they only read it. This converges
  // (sign out → '/' → public segment → predicate false → stop) so the competing
  // redirects that caused "Maximum update depth exceeded" cannot recur.
  useEffect(() => {
    // Wait until auth is resolved AND the root navigator is mounted.
    if (authLoading || !navState?.key) return;
    const first = segments[0];
    const inPublic = first === 'welcome' || first === '(auth)';
    if (!session && !inPublic) {
      // Logged out while on an authed screen → welcome. Uses the explicit
      // /welcome path (not '/') because '/' collides with (tabs)/index and
      // would resolve back into the tabs group we just signed the user out of.
      router.replace('/welcome');
    } else if (session && inPublic) {
      // Logged in while on welcome/login → into the app.
      router.replace('/(tabs)');
    }
  }, [session, authLoading, navState?.key, segments, router]);

  // Hide splash once fonts are ready and the initial auth check has resolved,
  // so the first painted frame is already on the correct (public vs authed)
  // side — no welcome-video flash for returning authed users.
  useEffect(() => {
    if (fontsLoaded && !authLoading) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, authLoading]);

  if (!fontsLoaded || authLoading) {
    return null; // splash is still covering the app
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="welcome" options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="invite" options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="ask" options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="preview-home" options={{ presentation: 'card', headerShown: false, gestureEnabled: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <SubscriptionProvider>
        <WalkthroughProvider>
          <RootLayoutNav />
        </WalkthroughProvider>
      </SubscriptionProvider>
    </AuthProvider>
  );
}
