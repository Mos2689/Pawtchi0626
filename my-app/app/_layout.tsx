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
import {
  Geist_300Light,
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
} from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import {
  PlayfairDisplay_500Medium,
  PlayfairDisplay_500Medium_Italic,
} from '@expo-google-fonts/playfair-display';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { ProOfferInboxBridge } from '@/components/ProOfferInboxBridge';
import { AuthProvider } from '@/providers/AuthProvider';
import { WalkthroughProvider } from '@/providers/WalkthroughContext';
import { SubscriptionProvider } from '@/providers/SubscriptionProvider';
import { useAuth } from '@/providers/AuthProvider';
import { posthog } from '@/lib/analytics';
import { consumeFreshSignup } from '@/lib/onboardingFunnel';
import { isRecoveryInProgress } from '@/lib/passwordRecovery';
import { PostHogProvider } from 'posthog-react-native';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { registerPushToken } from '@/lib/notifications/pushRegistration';
import { useEmailDeepLinks } from '@/hooks/useEmailDeepLinks';
import * as QuickActions from 'expo-quick-actions';
import { useQuickActionCallback } from 'expo-quick-actions/hooks';
import { WRITE_TO_FOUNDER_LABEL } from '@/lib/founderLetters';
import { supabase } from '@/lib/supabase';
import { WALK_TRACKING_ENABLED } from '@/constants/features';
import { WalkLiveActivityBridge } from '@/components/WalkLiveActivityBridge';
import { initFirebaseAnalytics, setFirebaseUserId } from '@/lib/firebaseAnalytics';
import { installBreadcrumbs } from '@/lib/support/breadcrumbs';
// Side-effect import: defines the walk-tracking background task at bundle
// load so the OS can deliver GPS fixes without any walk screen mounted, and so
// a stale OS registration self-stops on the first delivery (the task reads the
// durable record). Kept even while walks are disabled — defineTask is inert JS
// registration (already try/caught) and the task self-stops with no record.
import '@/lib/walk/walkTracker';

// Start recording the in-memory breadcrumb trail that support requests carry.
// At module scope rather than in an effect so the very first events of a cold
// start — the ones surrounding a launch crash — are already being captured
// before any component mounts. Idempotent, and it stores event NAMES only:
// see lib/support/breadcrumbs.ts for why props are deliberately excluded.
installBreadcrumbs();

const INFORMATIONAL_ENTITLEMENT_VERIFICATION =
  'INFORMATIONAL' as NonNullable<PurchasesConfiguration['entitlementVerificationMode']>;

// Push token sync + notification routing, once per session.
//
// This deliberately does NOT request permission. It used to: the hook fired
// requestPermissionsAsync() the instant a session existed, so the OS prompt
// landed on the first authed frame — before the owner had seen a single screen
// of value, sometimes mid-onboarding. iOS grants exactly one prompt per
// install, and spending it there left opt-in at 9% (16 valid tokens across 177
// users), which hard-caps the reach of every notification the product sends.
//
// The ask now lives in components/NotificationPrimer.tsx, after the plan
// reveal, behind an explicit tap. This bridge only registers a token when
// permission has already been granted, and keeps it fresh across rotations.
//
// It is also the ONLY place `usePushNotifications` may be mounted. The hook owns
// the response / received / token-rotation listeners, so a second copy routes a
// tapped notification twice and double-counts the delivery funnel. Home, the
// notification settings screen and the onboarding reveal each used to mount one
// purely to reach the permission request; they now call `requestPushPermission()`
// from lib/notifications/pushRegistration.ts instead.
function PushNotificationsBridge({ userId }: { userId: string }) {
  const { registration, setMarkOpened } = usePushNotifications();

  useEffect(() => {
    setMarkOpened((dedupeKey: string) => {
      supabase.rpc('mark_notification_opened', { p_dedupe_key: dedupeKey })
        .then(({ error }) => {
          // Open tracking is telemetry — never let it surface to the user.
          if (error && __DEV__) console.log('mark_notification_opened:', error.message);
        });
    });
  }, [setMarkOpened]);

  // Destructured rather than passing `registration` straight through, so the
  // dependency list is the three VALUES the RPC actually sends. The hook hands
  // back a fresh object on every permission re-read, and depending on the object
  // would re-sync an unchanged token on each one.
  const token = registration?.token;
  const platform = registration?.platform;
  const timezone = registration?.timezone;
  useEffect(() => {
    if (!userId || !token || !platform) return;
    registerPushToken({ token, platform, timezone: timezone ?? null });
  }, [userId, token, platform, timezone]);

  return null;
}


/**
 * Home Screen quick actions — the long-press shortcut on the app icon.
 *
 * Registered only once there is a session: a shortcut that drops a signed-out
 * person on the auth screen is worse than no shortcut. Mounted alongside the
 * push bridge for the same reason.
 *
 * Native module, so this does nothing in Expo Go — the item only appears in a
 * build that has run prebuild.
 */
function QuickActionsBridge() {
  const router = useRouter();

  useEffect(() => {
    QuickActions.setItems([
      {
        id: 'write-to-founder',
        title: WRITE_TO_FOUNDER_LABEL,
        subtitle: 'A letter to the people who make Pawtchi',
        icon: 'compose',
        params: { href: '/letter?source=quick_action' },
      },
    ]).catch(() => {
      // Unsupported launcher, or too many items. Never fatal — every entry
      // point this feature has also exists inside the app.
    });
  }, []);

  // Fires for both a cold launch from the shortcut and a warm tap.
  useQuickActionCallback((action) => {
    const href = action?.params?.href;
    if (typeof href === 'string') router.push(href as never);
  });

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

  // Emailed universal links. Mounted here rather than in the push bridge
  // because that bridge only renders for a signed-in user, and a link tapped
  // by somebody logged out still needs to route once the auth gate resolves
  // rather than silently dropping them on the home tab.
  useEmailDeepLinks();

  // Brand fonts load once here for the whole app (screens never call useFonts
  // themselves). The splash stays up until both fonts and auth state resolve,
  // so the first painted frame is already in the brand typography.
  const [fontsLoaded] = useFonts({
    BebasNeue_400Regular,
    PlayfairDisplay_500Medium,
    PlayfairDisplay_500Medium_Italic,
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
    // Walk Story ("Popsicle") typography — Geist for display + labels, Geist
    // Mono for the tag/meta lines. Story viewer only.
    Geist_300Light,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    GeistMono_400Regular,
    // Walk Memory typography — the listing face. Viewer only; see the fence in
    // constants/design.ts.
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
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
    // The privacy policy sits outside the gate entirely — neither redirect
    // applies. APP 5 / IPP 3 require the collection notice to be readable
    // BEFORE an account exists, and Profile links to the same screen after,
    // so bouncing it in either direction breaks one of the two.
    if (first === 'privacy') return;
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
        console.log('[authGate]', fresh ? 'fresh signup → /onboarding/identity' : 'session → /(tabs)');
      }
      router.replace(fresh ? '/onboarding/identity' : '/(tabs)');
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
      {session?.user?.id && <QuickActionsBridge />}
      {/* Publishes the win-back offer's notification-centre entry. Mounted here
          rather than on the paywall because the entry has to exist for someone
          who never opens the paywall during their window — that is the whole
          point of the second surface. Renders nothing; with the offer's kill
          switch off it does nothing at all. */}
      {session?.user?.id && <ProOfferInboxBridge />}
      {/* Mirrors a live walk onto the iOS Lock Screen / Dynamic Island. Renders
          nothing, observes the walk store only, and cannot influence tracking —
          on Android, in Expo Go, or with the flag off it does nothing at all.
          Not gated on a session: it only ever acts on a walk in progress, and a
          walk cannot exist without one. */}
      <WalkLiveActivityBridge />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="welcome" options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="invite" options={{ presentation: 'card', headerShown: false }} />
        {/* Pushed from the paywall footer, so a card rather than a modal —
            stacking a modal on the modal paywall traps the close gesture. */}
        <Stack.Screen name="redeem" options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="creator" options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="walk" options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="walk-story" options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="ask" options={{ presentation: 'card', headerShown: false }} />
        {/* Write to the Founder. `letter/index` is a brand moment on the navy
            ground; compose and the thread are operational surfaces. */}
        <Stack.Screen name="letter/index" options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="letter/compose" options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="letter/[id]" options={{ presentation: 'card', headerShown: false }} />
        {/* Help & Support. The structured sibling of the letter above: same
            white ground and two-colour system, different voice — the team
            rather than the founders. All three are operational surfaces. */}
        <Stack.Screen name="support/index" options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="support/new" options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="support/[id]" options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="notifications" options={{ presentation: 'card', headerShown: false }} />
        {/* The center. `notifications` above is the settings screen — the two
            are reached from each other, never confused for each other. */}
        <Stack.Screen name="inbox" options={{ presentation: 'card', headerShown: false }} />
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
