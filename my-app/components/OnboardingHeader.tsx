import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, space } from '../constants/design';
import { ONBOARDING_TOTAL_STEPS, OnboardingStepId, trackStepBack } from '../lib/onboardingFunnel';

// One header for the whole onboarding flow, so every step reads as the same
// product: back affordance, wordmark, quiet step caption, thin progress line.
//
// Pass a `stepId` (preferred) so the header can fire a `back_pressed` event
// scoped to the right step in the funnel charts.
interface OnboardingHeaderProps {
  step: number; // 1-based — kept for the printed indicator
  total?: number;
  showBack?: boolean;
  stepId?: OnboardingStepId;
}

export function OnboardingHeader({ step, total = ONBOARDING_TOTAL_STEPS, showBack = true, stepId }: OnboardingHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pct = Math.min(Math.max(step / total, 0), 1) * 100;

  const handleBack = () => {
    if (stepId) trackStepBack(stepId);
    if (router.canGoBack()) router.back();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + space.md }]}>
      <View style={styles.row}>
        <View style={styles.side}>
          {showBack && (
            <TouchableOpacity
              onPress={handleBack}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialIcons name="arrow-back" size={22} color={color.ink} />
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.wordmark}>PAWTCHI</Text>
        <View style={[styles.side, styles.sideRight]}>
          <Text style={styles.step}>{`${step} / ${total}`}</Text>
        </View>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: space.xxl,
    paddingBottom: space.lg,
    backgroundColor: 'transparent',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  side: { width: 48 },
  sideRight: { alignItems: 'flex-end' },
  wordmark: {
    fontFamily: font.display,
    fontSize: 18,
    letterSpacing: 3,
    color: color.ink,
  },
  step: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.slateFaint,
  },
  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: color.track,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
  },
});
