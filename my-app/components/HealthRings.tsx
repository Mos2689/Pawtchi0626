import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, useAnimatedStyle, withTiming, withSequence, withSpring, Easing,
} from 'react-native-reanimated';
import { motion } from '../constants/design';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Apple-Health-style concentric rings — calories (orange), activity (yellow), hydrate (blue).
// Shared by the real Home and the future-state preview so the two never drift visually.

export const RING_SIZE = 280;
export const cx = RING_SIZE / 2;
export const cy = RING_SIZE / 2;
export const PHOTO_RADIUS = 82;

export const RING_CONFIG = [
  { r: 130, color: '#f97316', stroke: 14 }, // outer — calories
  { r: 108, color: '#F7F602', stroke: 13 }, // mid — move
  { r: 86, color: '#3091F9', stroke: 12 },  // inner — hydrate
];

interface RingArcProps {
  r: number;
  color: string;
  strokeWidth: number;
  progress: number; // 0–1
}

export function RingArc({ r, color, strokeWidth, progress }: RingArcProps) {
  const circumference = 2 * Math.PI * r;
  const clampedProgress = Math.min(Math.max(progress, 0), 1);

  // Animate the fill: keep the dash one full circumference long and ease the
  // dash offset from "empty" (offset = circumference) to the target. Re-runs when
  // progress changes (e.g. after logging a meal), so the ring fills smoothly.
  const animatedProgress = useSharedValue(0);
  // A one-shot stroke "heartbeat" the moment this ring first reaches 100% — a
  // restrained reward for closing the goal. Multiplied into strokeWidth.
  const pulse = useSharedValue(1);
  const wasComplete = useRef(false);

  useEffect(() => {
    animatedProgress.value = withTiming(clampedProgress, {
      duration: motion.duration.ring,
      easing: Easing.out(Easing.cubic),
    });
    const isComplete = clampedProgress >= 1;
    if (isComplete && !wasComplete.current) {
      // Fire after the fill lands so the pulse reads as "goal closed".
      pulse.value = withSequence(
        withTiming(1, { duration: motion.duration.ring }),
        withSpring(1.32, motion.spring.bouncy),
        withSpring(1, motion.spring.gentle),
      );
    }
    wasComplete.current = isComplete;
  }, [clampedProgress, animatedProgress, pulse]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - animatedProgress.value),
    strokeWidth: strokeWidth * pulse.value,
  }));

  return (
    <>
      <Circle cx={cx} cy={cy} r={r} stroke={color} strokeWidth={strokeWidth} strokeOpacity={0.18} fill="none" />
      <AnimatedCircle
        cx={cx}
        cy={cy}
        r={r}
        stroke={color}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        animatedProps={animatedProps}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
    </>
  );
}

export function ProgressBar({ progress, color }: { progress: number; color: string }) {
  // Glide the fill toward its value instead of snapping (matches the rings).
  const pct = useSharedValue(0);
  const target = Math.min(Math.max(progress, 0), 1);
  useEffect(() => {
    pct.value = withTiming(target, {
      duration: motion.duration.slow,
      easing: Easing.out(Easing.cubic),
    });
  }, [target, pct]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${pct.value * 100}%`,
  }));

  return (
    <View style={progressStyles.track}>
      <Animated.View style={[progressStyles.fill, { backgroundColor: color }, animatedStyle]} />
    </View>
  );
}

/** Convenience wrapper: the three concentric arcs with arbitrary center content. */
export function HealthRings({
  calorieProgress,
  activityProgress,
  waterProgress,
  children,
}: {
  calorieProgress: number;
  activityProgress: number;
  waterProgress: number;
  children?: React.ReactNode;
}) {
  return (
    <View style={{ width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={RING_SIZE} height={RING_SIZE} style={StyleSheet.absoluteFill}>
        <RingArc r={RING_CONFIG[0].r} color={RING_CONFIG[0].color} strokeWidth={RING_CONFIG[0].stroke} progress={calorieProgress} />
        <RingArc r={RING_CONFIG[1].r} color={RING_CONFIG[1].color} strokeWidth={RING_CONFIG[1].stroke} progress={activityProgress} />
        <RingArc r={RING_CONFIG[2].r} color={RING_CONFIG[2].color} strokeWidth={RING_CONFIG[2].stroke} progress={waterProgress} />
      </Svg>
      {children}
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: {
    width: '100%',
    height: 4,
    backgroundColor: '#f1f5f9',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
});
