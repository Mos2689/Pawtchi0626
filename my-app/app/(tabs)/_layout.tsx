import React, { useEffect, useState } from 'react';
import { Tabs as ExpoTabs, useRouter, Redirect } from 'expo-router';
import { useAuth } from '../../providers/AuthProvider';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { MaterialIcons } from '@expo/vector-icons';
import { RunningDogIcon } from '../../components/icons/RunningDogIcon';
import { Colors } from '../../constants/Theme';
import { color, font, radius, space, type } from '../../constants/design';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TouchableOpacity, View } from 'react-native';
import { Hotspot } from '../../components/walkthrough/Hotspot';
import { CoinToast } from '../../components/CoinToast';
import { PawLoader } from '../../components/loader/PawLoader';
import { WalkTabDock } from '../../components/WalkTabDock';
import { WalkTrackingIndicator } from '../../components/WalkTrackingIndicator';
import { WALK_TRACKING_ENABLED } from '../../constants/features';

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
  const insets = useSafeAreaInsets();
  const { session, isLoading: authLoading, signOut } = useAuth();
  // Fine-grained selectors — this component wraps the whole tab navigator, so
  // it must not re-render on unrelated store churn (pantry, coins, tailoring).
  const fetchPet = useActivePetStore(s => s.fetchPet);
  const activePet = useActivePetStore(s => s.activePet);
  const petLoading = useActivePetStore(s => s.isLoading);
  const petError = useActivePetStore(s => s.error);
  const fetchStreak = useStreakStore(s => s.fetchStreak);
  const streakLoading = useStreakStore(s => s.isLoading);
  const fetchContext = usePetContextStore(s => s.fetchContext);
  const router = useRouter();
  // Boot-gate stall flag: flipped by the loader's timeout, cleared on retry.
  const [bootStuck, setBootStuck] = useState(false);

  const retryBoot = () => {
    setBootStuck(false);
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
    if (!authLoading && session) {
      // With a usable snapshot, refresh silently so isLoading never flips true
      // and blanks the already-rendered tabs. First-ever load keeps the loader.
      const snap = useActivePetStore.getState().activePet;
      fetchPet(session.user.id, { silent: !!snap && snap.owner_id === session.user.id });
      fetchStreak(session.user.id);
    }
  }, [session, authLoading]);

  // Hydrate pet context store once the active pet is loaded
  useEffect(() => {
    if (activePet?.id) {
      fetchContext(activePet.id);
    }
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
  if ((petLoading || streakLoading) && !snapshotUsable) {
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
    return <Redirect href="/onboarding/species" />;
  }

  return (
    <>
      <CoinToast />
      <ExpoTabs
        screenOptions={{
          headerShown: false,
          // Suspend React rendering of blurred tabs — every tab refreshes on
          // focus (staleness-guarded), so nothing relies on background renders.
          freezeOnBlur: true,
          // Yellow icons fail contrast on a white bar — active is ink, the
          // yellow lives in content CTAs (one yellow per surface).
          tabBarActiveTintColor: color.ink,
          tabBarInactiveTintColor: color.slateFaint,
          tabBarStyle: {
            backgroundColor: color.surface,
            borderTopColor: color.hairline,
            height: 60 + insets.bottom,
            paddingBottom: insets.bottom || 12,
            paddingTop: 12,
          },
          tabBarLabelStyle: {
            fontFamily: font.semibold,
            fontSize: 11,
            marginTop: 4,
          }
        }}
      >
        <ExpoTabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color }) => <MaterialIcons name="home" size={26} color={color} />,
          }}
        />
        <ExpoTabs.Screen
          name="meal"
          options={{
            title: 'Meal',
            tabBarIcon: ({ color }) => <MaterialIcons name="add-circle" size={32} color={color} />,
          }}
        />
        <ExpoTabs.Screen
          name="activity"
          options={{
            title: 'Activity',
            // Reads "Walk" while this tab is focused — tying the label to the
            // docked walk button above it — and "Activity" from every other tab.
            tabBarLabel: ({ focused, color: tintColor }) => (
              <Text
                style={{
                  fontFamily: font.semibold,
                  fontSize: 11,
                  marginTop: 4,
                  color: tintColor,
                }}
              >
                {WALK_TRACKING_ENABLED && focused ? 'Walk' : 'Activity'}
              </Text>
            ),
            tabBarIcon: ({ color }) => (
              <RunningDogIcon size={26} color={color} />
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
            tabBarIcon: ({ color }) => (
              <Hotspot
                stepKey="health_tab"
                title="Health Dashboard"
                description="See the complete nutritional and activity history here"
                position="top-right"
              >
                <MaterialIcons name="monitor-heart" size={26} color={color} />
              </Hotspot>
            ),
          }}
        />
        <ExpoTabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color }) => <MaterialIcons name="person" size={26} color={color} />,
          }}
        />
      </ExpoTabs>
      {WALK_TRACKING_ENABLED && (
        <>
          <WalkTabDock />
          {/* Floating proof-of-tracking + leak recovery, above every tab. */}
          <WalkTrackingIndicator />
        </>
      )}
    </>
  );
}
