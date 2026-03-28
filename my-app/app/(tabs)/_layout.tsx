import React, { useEffect, useState } from 'react';
import { Tabs as ExpoTabs, useRouter } from 'expo-router';
import { useAuth } from '../../providers/AuthProvider';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/Theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, View } from 'react-native';
import { CoinToast } from '../../components/CoinToast';

export default function TabLayout() {
  const theme = Colors.light;
  const insets = useSafeAreaInsets();
  const { session, isLoading: authLoading } = useAuth();
  const { fetchPet, activePet, isLoading: petLoading } = useActivePetStore();
  const { fetchStreak, isLoading: streakLoading } = useStreakStore();
  const { fetchContext } = usePetContextStore();
  const router = useRouter();
  const [redirectingToOnboarding, setRedirectingToOnboarding] = useState(false);

  useEffect(() => {
    if (!authLoading) {
      if (!session) {
        router.replace('/(auth)/login' as any);
      } else {
        fetchPet(session.user.id);
        fetchStreak(session.user.id);
      }
    }
  }, [session, authLoading]);

  // Redirect users without a configured pet into onboarding (via useEffect, not render body)
  useEffect(() => {
    if (!authLoading && session && !petLoading && !activePet && !redirectingToOnboarding) {
      setRedirectingToOnboarding(true);
      router.replace('/onboarding/species');
    }
  }, [authLoading, session, petLoading, activePet]);

  // Hydrate pet context store once the active pet is loaded
  useEffect(() => {
    if (activePet?.id) {
      fetchContext(activePet.id);
    }
  }, [activePet?.id]);

  // Block rendering while loading or redirecting to prevent flickering
  if (authLoading || (session && (petLoading || streakLoading)) || redirectingToOnboarding) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#FFFC00" />
      </View>
    );
  }

  return (
    <>
    <CoinToast />
    <ExpoTabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme['on-surface-variant'],
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme['surface-container-highest'],
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom || 12,
          paddingTop: 12,
        },
        tabBarLabelStyle: {
          fontFamily: 'Plus Jakarta Sans',
          fontWeight: '600',
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
        name="log"
        options={{
          title: 'Log',
          tabBarIcon: ({ color }) => <MaterialIcons name="add-circle" size={32} color={color} />,
        }}
      />
      <ExpoTabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color }) => <MaterialIcons name="directions-run" size={26} color={color} />,
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
          tabBarIcon: ({ color }) => <MaterialIcons name="monitor-heart" size={26} color={color} />,
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
