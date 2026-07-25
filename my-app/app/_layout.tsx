import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments, useRootNavigationState, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import Purchases, { LOG_LEVEL, type PurchasesConfiguration } from 'react-native-purchases';

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
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { AuthProvider } from '@/providers/AuthProvider';
import { WalkthroughProvider } from '@/providers/WalkthroughContext';
import { SubscriptionProvider } from '@/providers/SubscriptionProvider';
import { useAuth } from '@/providers/AuthProvider';
import { posthog } from '@/lib/analytics';
import { consumeFreshSignup } from '@/lib/onboardingFunnel';
import { isRecoveryInProgress } from '@/lib/passwordRecovery';
import { PostHogProvider } from 'posthog-react-native';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { supabase } from '@/lib/supabase';
import { WALK_TRACKING_ENABLED } from '@/constants/features';
import { initFirebaseAnalytics, setFirebaseUserId } from '@/lib/firebaseAnalytics';
// Side-effect import: defines the walk-tracking background task at bundle
// load so the OS can deliver GPS fixes without any walk screen mounted, and so
// a stale OS registration self-stops on the first delivery (the task reads the
// durable record). Kept even while walks are disabled — defineTask is inert JS
// registration (already try/caught) and the task self-stops with no record.
import '@/lib/walk/walkTracker';

const INFORMATIONAL_ENTITLEMENT_VERIFICATION =
  'INFORMATIONAL' as NonNullable<PurchasesConfiguration['entitlementVerificationMode']>;

// Push registration + token sync, once per session — not per Home mount.
// Rendered only while a session exists, so the permission prompt still fires
// on the first authed screen (same timing as when this lived in Home).
function PushNotificationsBridge({ userId }: { userId: string }) {
  const { expoPushToken } = usePushNotifications();
  useEffect(() => {
    if (userId && expoPushToken) {
      supabase.rpc('register_push_token', { push_token: expoPushToken })
        .then(({ error }) => {
          if (error) console.error('Failed to sync push token:', error.message);
        });
    }
  }, [userId, expoPushToken]);
  return null;
}


export const unstable_settings = {
  initialRouteName: '(tabs)',
};

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session, isLoading: authLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const navState = useRootNavigationState();
  const pathname = usePathname();

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
    // Social-artifact typography (Paw Moment cards) — the locked June 2026
    // social visual guidelines type in Inter, not the in-app brand pair.
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
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
        Purchases.configure({
          apiKey,
          // RevenueCat still grants access in informational mode, while the
          // returned entitlement tells measurement code whether it verified.
          entitlementVerificationMode: INFORMATIONAL_ENTITLEMENT_VERIFICATION,
        });
      } else {
        console.warn('RevenueCat API key is missing from environment variables.');
      }
    } catch (e) {
      console.warn('RevenueCat configure failed (likely running in Expo Go without native modules):', e);
    }
  }, []);

  // Register the narrow Firebase sink once. It sits beside PostHog; it does
  // not replace or alter any existing product analytics delivery.
  useEffect(() => {
    initFirebaseAnalytics();
  }, []);

  // Tracked walks, launch reconcile: the ONLY launch-time tracking action. It
  // reads the durable active-walk record and either continues a genuinely
  // ongoing walk or finalizes an orphan — and, with the flag off, hard-stops any
  // leftover session. It NEVER starts tracking; a stale OS registration is also
  // self-stopped by the task itself on its first delivery. No reconciler or
  // AppState janitor needed — the record is the single authority.
  useEffect(() => {
    const { useWalkStore } = require('@/store/useWalkStore');
    const store = useWalkStore.getState();
    const operation = WALK_TRACKING_ENABLED
      ? store.recoverOrphanedWalk()
      : store.hardStopTracking();
    operation.catch(() => {});
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

  // Link RevenueCat identity and PostHog identity to Supabase user.
  // `Purchases.isConfigured` is an async guard in v9 — treating it as a
  // synchronous boolean (as an older version exposed) would always be truthy
  // and would throw on Expo Go where the native module is absent.
  useEffect(() => {
    (async () => {
      try {
        const rcReady = await Purchases.isConfigured().catch(() => false);
        if (session?.user?.id) {
          if (rcReady) {
            Purchases.logIn(session.user.id).catch((e) =>
              console.warn('RevenueCat logIn error:', e)
            );
          }
          posthog?.identify(session.user.id);
          setFirebaseUserId(session.user.id);
        } else {
          if (rcReady) {
            Purchases.logOut().catch(() => {});
          }
          posthog?.reset();
          setFirebaseUserId(null);
        }
      } catch (e) {
        console.warn('RevenueCat logIn/out failed (likely running in Expo Go without native modules):', e);
      }
    })();
  }, [session?.user?.id]);

  // PostHog screen tracking
  useEffect(() => {
    if (pathname && posthog) {
      posthog.screen(pathname, { segments });
    }
  }, [pathname, segments]);

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
    } else if (session && inPublic && !isRecoveryInProgress()) {
      // Logged in while on welcome/login → into the app. A fresh signup goes
      // straight to onboarding: the account provably has no pet yet, so
      // mounting the tabs boot gate (a network fetch behind a full-screen
      // loader) just to rediscover that would be a dead beat in the funnel's
      // most fragile moment.
      const fresh = consumeFreshSignup();
      if (__DEV__) {
        // Debugging breadcrumb: shows in Metro which way the gate routed.
        // eslint-disable-next-line no-console
        console.log('[authGate]', fresh ? 'fresh signup → /onboarding/species' : 'session → /(tabs)');
      }
      router.replace(fresh ? '/onboarding/species' : '/(tabs)');
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
      {session?.user?.id && <PushNotificationsBridge userId={session.user.id} />}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="welcome" options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="invite" options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="walk" options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="ask" options={{ presentation: 'card', headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const providers = (
    <AuthProvider>
      <SubscriptionProvider>
        <WalkthroughProvider>
          {/* Render-crash backstop. Sits INSIDE the providers so a "Start
              again" remount keeps the session — the user returns to their
              screen, not the welcome video. */}
          <AppErrorBoundary>
            <RootLayoutNav />
          </AppErrorBoundary>
        </WalkthroughProvider>
      </SubscriptionProvider>
    </AuthProvider>
  );

  if (posthog) {
    const Provider = PostHogProvider as any;
    return <Provider client={posthog} autocapture>{providers}</Provider>;
  }
  return providers;
}
