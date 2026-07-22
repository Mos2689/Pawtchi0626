import React from 'react';
import { Stack } from 'expo-router';

// One transition language for the whole onboarding flow — a consistent
// slide keeps the six steps reading as one journey on both platforms
// (Android otherwise defaults to a fade that breaks the rhythm).
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    />
  );
}
