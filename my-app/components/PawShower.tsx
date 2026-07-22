/**
 * PawShower — the completion celebration.
 *
 * A short cascade of yellow / navy / hydrate-blue paw prints raining from the
 * top of the screen. Replaces the generic ConfettiCannon on the summary
 * screen so the emotional payoff reads as Pawtchi, not "some app."
 *
 * Motion is one-shot and unmanaged: mount → play → the paws drift off screen
 * and stay there. Callers should conditionally mount it (e.g., only when the
 * walk actually logged) rather than trying to toggle it back off.
 */

import React, { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { color } from '../constants/design';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const PAW_COUNT = 14;
const PAW_TINTS = [color.yellow, color.navy, color.viz.hydrate];
const FALL_DURATION_MS = 2200;
const SPAWN_JITTER_MS = 500;

interface PawSpec {
  x: number;
  delay: number;
  duration: number;
  rotateStart: number;
  rotateSpin: number;
  size: number;
  tint: string;
}

function makePaws(): PawSpec[] {
  return Array.from({ length: PAW_COUNT }, (_, i) => ({
    x: 16 + Math.random() * (SCREEN_W - 60),
    delay: Math.random() * SPAWN_JITTER_MS,
    duration: FALL_DURATION_MS + Math.random() * 900 - 450,
    rotateStart: Math.random() * 360,
    rotateSpin: (Math.random() > 0.5 ? 1 : -1) * (60 + Math.random() * 120),
    size: 20 + Math.random() * 16,
    tint: PAW_TINTS[i % PAW_TINTS.length],
  }));
}

function FallingPaw({ spec }: { spec: PawSpec }) {
  const y = useSharedValue(-60);
  const opacity = useSharedValue(0);
  const rotation = useSharedValue(spec.rotateStart);

  useEffect(() => {
    y.value = withDelay(
      spec.delay,
      withTiming(SCREEN_H + 60, {
        duration: spec.duration,
        easing: Easing.bezier(0.35, 0.05, 0.6, 1),
      }),
    );
    rotation.value = withDelay(
      spec.delay,
      withTiming(spec.rotateStart + spec.rotateSpin, {
        duration: spec.duration,
        easing: Easing.linear,
      }),
    );
    opacity.value = withDelay(
      spec.delay,
      withSequence(
        withTiming(1, { duration: 220 }),
        withTiming(1, { duration: Math.max(0, spec.duration - 700) }),
        withTiming(0, { duration: 480 }),
      ),
    );
    return () => {
      cancelAnimation(y);
      cancelAnimation(opacity);
      cancelAnimation(rotation);
    };
  }, [opacity, rotation, spec, y]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }, { rotate: `${rotation.value}deg` }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.paw, { left: spec.x }, animatedStyle]}>
      <MaterialIcons name="pets" size={spec.size} color={spec.tint} />
    </Animated.View>
  );
}

export function PawShower({ active }: { active: boolean }) {
  const paws = useMemo(() => (active ? makePaws() : []), [active]);
  if (!active) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      {paws.map((spec, i) => (
        <FallingPaw key={i} spec={spec} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  paw: {
    position: 'absolute',
    top: 0,
  },
});
