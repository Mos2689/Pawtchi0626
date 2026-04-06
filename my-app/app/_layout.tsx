import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider } from '@/providers/AuthProvider';
import { WalkthroughProvider } from '@/providers/WalkthroughContext';

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  // Initialize RevenueCat SDK on mount
  useEffect(() => {
    Purchases.setLogLevel(LOG_LEVEL.VERBOSE);
    const apiKey = 'test_EYcOTcqUpCQyBHlHvtZtqKFjQiv';
    Purchases.configure({ apiKey });
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="medical" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', headerShown: false, gestureEnabled: false }} />
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
