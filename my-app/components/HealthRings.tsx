import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

// Apple-Health-style concentric rings — calories (orange), activity (yellow), hydrate (blue).
// Shared by the real Home and the future-state preview so the two never drift visually.

export const RING_SIZE = 280;
export const cx = RING_SIZE / 2;
export const cy = RING_SIZE / 2;
export const PHOTO_RADIUS = 82;

export const RING_CONFIG = [
  { r: 130, color: '#f97316', stroke: 14 }, // outer — calories
  { r: 108, color: '#FFFC00', stroke: 13 }, // mid — move
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
  const filledLength = circumference * clampedProgress;

  return (
    <>
      <Circle cx={cx} cy={cy} r={r} stroke={color} strokeWidth={strokeWidth} strokeOpacity={0.18} fill="none" />
      <Circle
        cx={cx}
        cy={cy}
        r={r}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${filledLength} ${circumference}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
    </>
  );
}

export function ProgressBar({ progress, color }: { progress: number; color: string }) {
  return (
    <View style={progressStyles.track}>
      <View style={[progressStyles.fill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: color }]} />
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
