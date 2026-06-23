import React, { useEffect, useState } from 'react';
import { Tabs as ExpoTabs, useRouter, Redirect } from 'expo-router';
import { useAuth } from '../../providers/AuthProvider';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { useSubscription } from '../../hooks/useSubscription';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/Theme';
import { color, font } from '../../constants/design';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, View } from 'react-native';
import { Hotspot } from '../../components/walkthrough/Hotspot';
import { CoinToast } from '../../components/CoinToast';

export default function TabLayout() {
  const theme = Colors.light;
  const insets = useSafeAreaInsets();
  const { session, isLoading: authLoading } = useAuth();
  const { fetchPet, activePet, isLoading: petLoading } = useActivePetStore();
  const { fetchStreak, isLoading: streakLoading } = useStreakStore();
  const { fetchContext } = usePetContextStore();
  const router = useRouter();
  const { status: subStatus } = useSubscription();

  useEffect(() => {
    if (!authLoading && session) {
      fetchPet(session.user.id);
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

  // 1. Auth still resolving — show spinner
  if (authLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={color.navy} />
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

  // 3. Session exists, wait for pet & streak data
  if (petLoading || streakLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={color.navy} />
      </View>
    );
  }

  // 4. Data loaded but no pet configured — onboarding
  if (!activePet) {
    return <Redirect href="/onboarding/species" />;
  }

  return (
    <>
      <CoinToast />
      <ExpoTabs
        screenOptions={{
          headerShown: false,
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
            tabBarIcon: ({ color }) => (
              <MaterialIcons name="directions-run" size={26} color={color} />
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
    </>
  );
}
