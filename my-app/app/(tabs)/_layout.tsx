import React, { useEffect, useState } from 'react';
import { Tabs as ExpoTabs, useRouter, Redirect } from 'expo-router';
import { useAuth } from '../../providers/AuthProvider';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/Theme';
import { color, font, radius, space, type } from '../../constants/design';
import { AppState, Text, TouchableOpacity, View } from 'react-native';
import { Hotspot } from '../../components/walkthrough/Hotspot';
import { CoinToast } from '../../components/CoinToast';
import { PawLoader } from '../../components/loader/PawLoader';
import { WalkTrackingIndicator } from '../../components/WalkTrackingIndicator';
import { SplitTabBar } from '../../components/navigation/SplitTabBar';
import { ProfileTabIcon } from '../../components/navigation/ProfileTabIcon';
import { useWalkEnabled } from '../../hooks/useWalkEnabled';
import { reconcilePersistedWeightPlan } from '../../lib/weightPlanService';

// The boot gate's escape hatch: shown when the first pet/streak load times
// out or errors. Without it, a hung or failed fetch stranded users on the
// loader forever (the Android login report) — or worse, mis-routed existing
// accounts into onboarding because activePet was null for network reasons.
function BootRetryScreen({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  return (
    <View style={{
      flex: 1,
      backgroundColor: color.surface,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.xxxl,
    }}>
      <Text style={{ ...type.title, color: color.navy, textAlign: 'center' }}>
        This is taking too long
      </Text>
      <Text style={{ ...type.body, color: color.slateMuted, textAlign: 'center', marginTop: space.md }}>
        The connection is slow right now. Check your internet, then try again.
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        activeOpacity={0.9}
        style={{
          backgroundColor: color.yellow,
          borderRadius: radius.pill,
          paddingVertical: 14,
          paddingHorizontal: space.xxxl,
          marginTop: space.xxl,
        }}
      >
        <Text style={{ ...type.heading, color: color.navy }}>Try again</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onSignOut} style={{ paddingVertical: space.lg }}>
        <Text style={{ ...type.label, color: color.slateMuted }}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function TabLayout() {
  const theme = Colors.light;
  const { session, isLoading: authLoading, signOut } = useAuth();
  // Fine-grained selectors — this component wraps the whole tab navigator, so
  // it must not re-render on unrelated store churn (pantry, coins, tailoring).
  const fetchPet = useActivePetStore(s => s.fetchPet);
  const activePet = useActivePetStore(s => s.activePet);
  // Walks are dogs-only — cats keep a plain "Activity" tab with no walk surfaces.
  const walkEnabled = useWalkEnabled();
  const petLoading = useActivePetStore(s => s.isLoading);
  const petError = useActivePetStore(s => s.error);
  const fetchStreak = useStreakStore(s => s.fetchStreak);
  const streakLoading = useStreakStore(s => s.isLoading);
  const fetchContext = usePetContextStore(s => s.fetchContext);
  const router = useRouter();
  // Boot-gate stall flag: flipped by the loader's timeout, cleared on retry.
  const [bootStuck, setBootStuck] = useState(false);

  /**
   * Whether the persisted snapshot has actually come off disk yet.
   *
   * Zustand rehydrates asynchronously, so on the first render `activePet` is
   * null even for an owner who has used the app for a year — and the mount
   * effect below used to run before that read landed. The snapshot was
   * therefore always read as "absent": every launch revalidated non-silently,
   * `isLoading` went true, and the loader covered the entire round trip. The
   * optimization was correct and never once applied to the launch it was
   * written for, which is why a returning user still opened onto an empty app.
   *
   * Waiting for hydration is what makes `silent` below able to be true.
   */
  const [petHydrated, setPetHydrated] = useState(() =>
    useActivePetStore.persist.hasHydrated(),
  );

  useEffect(() => {
    if (petHydrated) return;
    const unsubscribe = useActivePetStore.persist.onFinishHydration(() =>
      setPetHydrated(true),
    );
    // It can land between the initial read above and this subscription.
    if (useActivePetStore.persist.hasHydrated()) setPetHydrated(true);
    return unsubscribe;
  }, [petHydrated]);

  const retryBoot = () => {
    setBootStuck(false);
    // If the disk read is what hung, stop waiting on it. The snapshot is only
    // ever a head start; the network is the authority for pet data, and
    // blocking the retry on a stalled read would make the button do nothing.
    setPetHydrated(true);
    if (session) {
      fetchPet(session.user.id);
      fetchStreak(session.user.id, { force: true });
    }
  };

  // A persisted snapshot that belongs to THIS user lets the tabs render
  // instantly while the network revalidates behind it. owner_id is the
  // cross-account guard: another user's snapshot is never trusted.
  const snapshotUsable = !!session && !!activePet && activePet.owner_id === session.user.id;

  useEffect(() => {
    if (authLoading || !session || !petHydrated) return;
    // With a usable snapshot, refresh silently so isLoading never flips true
    // and blanks the already-rendered tabs. First-ever load keeps the loader.
    const snap = useActivePetStore.getState().activePet;
    fetchPet(session.user.id, { silent: !!snap && snap.owner_id === session.user.id });
    fetchStreak(session.user.id);
  }, [session, authLoading, petHydrated]);

  // Hydrate pet context store once the active pet is loaded
  useEffect(() => {
    if (activePet?.id) {
      fetchContext(activePet.id);
    }
  }, [activePet?.id]);

  // Repair an interrupted/offline weight-plan reconciliation at boot and each
  // time the app returns to the foreground.
  useEffect(() => {
    if (!activePet?.id) return;
    const reconcile = () => {
      const currentPet = useActivePetStore.getState().activePet;
      if (currentPet) {
        void reconcilePersistedWeightPlan(currentPet).catch((error) => {
          console.warn('Weight plan reconciliation deferred:', error);
        });
      }
    };
    reconcile();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcile();
    });
    return () => subscription.remove();
  }, [activePet?.id]);

  // ── Guard cascade ──
  // Order matters: auth must resolve before we check session; session must
  // exist before we wait on pet/streak (otherwise clearPet's isLoading:true
  // during signout would trap us in a spinner forever).

  // 1. Auth still resolving — the living system takes over from the splash
  if (authLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <PawLoader visible />
      </View>
    );
  }

  // 2. Auth resolved, no session — render nothing and let the centralized auth
  //    gate (app/_layout.tsx) navigate to the welcome screen. This layout must
  //    NOT redirect on `session` itself: a <Redirect> here re-fires router.replace
  //    via useFocusEffect every commit while mounted, which is exactly what
  //    caused "Maximum update depth exceeded". The gate is the single authority.
  if (!session) {
    return null;
  }

  // 3. Session exists, wait for pet & streak data — unless a snapshot for this
  //    user is already hydrated, in which case render immediately and let the
  //    silent revalidate settle behind the live UI. If the boot fetches stall
  //    past the loader's timeout, escalate to a real retry screen — never a
  //    permanent spinner, never a blank dismissal.
  //
  //    The disk read is waited on here too, and deliberately inside this guard
  //    rather than as an earlier bare return: it is the branch that carries the
  //    timeout, so a wedged AsyncStorage escalates to the retry screen like
  //    every other stall instead of hanging on a spinner forever. It is also
  //    what stops guard 4 below from reading "not hydrated yet" as "no pet" and
  //    bouncing a long-standing account into onboarding.
  if (!petHydrated || ((petLoading || streakLoading) && !snapshotUsable)) {
    if (bootStuck) {
      return <BootRetryScreen onRetry={retryBoot} onSignOut={signOut} />;
    }
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <PawLoader visible timeoutMs={20000} onTimeout={() => setBootStuck(true)} />
      </View>
    );
  }

  // 4. Data loaded but no pet configured — onboarding. A pet that's null
  //    because the FETCH FAILED is not "no pet": routing an existing account
  //    into onboarding on a network error would be destructive — offer retry.
  if (!activePet) {
    if (petError) {
      return <BootRetryScreen onRetry={retryBoot} onSignOut={signOut} />;
    }
    return <Redirect href="/onboarding/identity" />;
  }

  return (
    <>
      <CoinToast />
      <ExpoTabs
        // Custom bar: a floating record disc beside a floating tab pill. Icons
        // and labels still come from each Screen's options below, so there is
        // one place that decides what a tab looks like. `tabBarStyle` is inert
        // once tabBar is supplied — except for `position`, which React
        // Navigation reads to decide whether screens are laid out ABOVE the bar
        // or behind it. See the note on it below.
        tabBar={props => <SplitTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          // Suspend React rendering of blurred tabs — every tab refreshes on
          // focus (staleness-guarded), so nothing relies on background renders.
          freezeOnBlur: true,
          // Yellow icons fail contrast on a white bar — active is ink, the
          // yellow lives in content CTAs (one yellow per surface).
          tabBarActiveTintColor: color.ink,
          tabBarInactiveTintColor: color.slateFaint,
          /**
           * Genuinely inert, and deliberately left minimal.
           *
           * With a custom `tabBar` prop, BottomTabView never applies this to
           * anything it renders — it only reads it to compute a height number
           * for `useBottomTabBarHeight()`, which nothing in this app consumes.
           * In particular `position: 'absolute'` here does NOT make the bar
           * float; that is done by the bar's own root style. See the note on
           * `wrap` in SplitTabBar.tsx.
           */
          tabBarStyle: {
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
          },
          tabBarLabelStyle: {
            fontFamily: font.semibold,
            fontSize: 11,
            marginTop: 4,
          }
        }}
      >
        {/*
          One icon family, one size, outline at rest and filled when active.

          Every tab glyph below is Ionicons at 22, except Profile, which shows
          the dog's own photo. That uniformity is the point:
          the previous set mixed MaterialIcons at 26, a 32px filled `add-circle`
          that read as a floating action button rather than a destination, and
          RunningDogIcon — a filled silhouette on a 1536x1024 viewBox, so it
          rendered two-thirds as tall as everything beside it and visibly broke
          the row.

          Outline-to-filled on selection is the iOS convention and gives the
          active tab a second signal beyond colour, which matters on chrome that
          floats over a map. RunningDogIcon is untouched and still used by the
          Activity screen, onboarding and the tracking indicator — it is simply
          not a tab bar glyph any more.
        */}
        <ExpoTabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color} />
            ),
          }}
        />
        <ExpoTabs.Screen
          name="meal"
          options={{
            title: 'Meal',
            // `restaurant`, not a plus-in-a-circle: this is a destination, and
            // a `+` glyph promises a compose action the tab does not perform.
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'restaurant' : 'restaurant-outline'}
                size={22}
                color={color}
              />
            ),
          }}
        />
        <ExpoTabs.Screen
          name="activity"
          options={{
            title: 'Activity',
            // A paw, not a walking human. `walk`/`fitness`/`barbell` all draw a
            // person, which is the wrong subject — the activity being planned
            // is the dog's. Ionicons is also the only family here with a
            // paw that has an outline/filled pair, so it stays consistent with
            // the rest of the row; MaterialCommunityIcons' `dog-side` is a
            // closer likeness but is filled-only and a different grid.
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'paw' : 'paw-outline'} size={22} color={color} />
            ),
          }}
        />
        <ExpoTabs.Screen
          name="community"
          options={{
            href: null,
          }}
        />
        <ExpoTabs.Screen
          name="shop"
          options={{
            href: null,
            title: 'Shop',
            tabBarIcon: ({ color }) => <MaterialIcons name="local-mall" size={26} color={color} />,
          }}
        />
        <ExpoTabs.Screen
          name="explore"
          options={{
            href: null,
          }}
        />
        <ExpoTabs.Screen
          name="health"
          options={{
            title: 'Health',
            tabBarIcon: ({ color, focused }) => (
              <Hotspot
                stepKey="health_tab"
                title="Health Dashboard"
                description="See the complete nutritional and activity history here"
                position="top-right"
              >
                <Ionicons
                  name={focused ? 'pulse' : 'pulse-outline'}
                  size={22}
                  color={color}
                />
              </Hotspot>
            ),
          }}
        />
        <ExpoTabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            // The dog's face rather than a person glyph — see ProfileTabIcon.
            tabBarIcon: ({ focused }) => <ProfileTabIcon focused={focused} />,
          }}
        />
      </ExpoTabs>
      {/* WalkTabDock is gone: it docked a "start walk" button above the Activity
          tab, and the record disc now sits in the bar itself on every tab —
          two walk buttons on one screen is one too many. */}
      {walkEnabled && (
        // Floating proof-of-tracking + leak recovery, above every tab.
        <WalkTrackingIndicator />
      )}
    </>
  );
}
