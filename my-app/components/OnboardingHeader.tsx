import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import Svg, { Circle, Ellipse } from 'react-native-svg';
import { color, font, radius, space, motion } from '../constants/design';
import { ONBOARDING_TOTAL_STEPS, OnboardingStepId, trackStepBack } from '../lib/onboardingFunnel';

// One header for the whole onboarding flow, so every step reads as the same
// product: back affordance, wordmark, quiet step caption, progress line with
// a paw marker riding its leading edge.
//
// Each screen mounts its own header, so the fill can't animate across screens
// by itself. We remember the last progress at module level and spring from
// there on mount — the bar appears to travel between steps.
let lastProgress = 0;

interface OnboardingHeaderProps {
  step: number; // 1-based — kept for the printed indicator
  total?: number;
  showBack?: boolean;
  stepId?: OnboardingStepId;
  /** When provided, the right side shows a quiet Skip action instead of the counter. */
  onSkip?: () => void;
}

function PawMarker() {
  return (
    <Svg width={9} height={9} viewBox="0 0 24 24">
      <Circle cx={6.5} cy={7.5} r={2.6} fill={color.navy} />
      <Circle cx={12} cy={5.5} r={2.6} fill={color.navy} />
      <Circle cx={17.5} cy={7.5} r={2.6} fill={color.navy} />
      <Ellipse cx={12} cy={15} rx={5.2} ry={4.4} fill={color.navy} />
    </Svg>
  );
}

export function OnboardingHeader({ step, total = ONBOARDING_TOTAL_STEPS, showBack = true, stepId, onSkip }: OnboardingHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const target = Math.min(Math.max(step / total, 0), 1);

  const progress = useSharedValue(lastProgress);
  const [trackW, setTrackW] = useState(0);

  useEffect(() => {
    progress.value = withSpring(target, motion.spring.gentle);
    lastProgress = target;
  }, [target, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));
  const markerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * trackW - 8 }],
  }));

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
          {onSkip ? (
            <TouchableOpacity
              onPress={onSkip}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.skip}>Skip</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.step}>{`${step} / ${total}`}</Text>
          )}
        </View>
      </View>
      <View
        style={styles.trackWrap}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      >
        <View style={styles.track}>
          <Animated.View style={[styles.fill, fillStyle]} />
        </View>
        {trackW > 0 && (
          <Animated.View style={[styles.marker, markerStyle]}>
            <PawMarker />
          </Animated.View>
        )}
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
  skip: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.slateMuted,
    textDecorationLine: 'underline',
  },
  trackWrap: {
    justifyContent: 'center',
    height: 16,
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
  marker: {
    position: 'absolute',
    left: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: color.yellow,
    borderWidth: 1.5,
    borderColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
