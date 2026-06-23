import React, { useEffect } from 'react';
import { ViewStyle } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, withTiming, Easing,
} from 'react-native-reanimated';
import { color } from '../constants/design';

// ─────────────────────────────────────────────────────────────────────────────
// "The Pulse" — the bespoke mark for the Second Opinion feature.
//
// One motif, reused across surfaces (home crest, Ask header, thinking loader):
// an aperture ring (ties to the tagline "Notice everything") crossed by a
// vital-sign line (vet / health). Drawn in a 100-unit space and scaled to `size`.
// ─────────────────────────────────────────────────────────────────────────────

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

// Vital-sign line points in the 100-unit viewBox, and its measured length
// (used so the line can "draw itself" on mount via strokeDashoffset).
const PULSE_POINTS = '30,50 42,50 48,36 56,66 62,50 70,50';
const PULSE_LENGTH = 86;

export type PulseVariant = 'crest' | 'listening';

interface PulseMarkProps {
  size?: number;
  /** Aperture ring colour. */
  ringColor?: string;
  /** Vital-sign line colour. */
  strokeColor?: string;
  variant?: PulseVariant;
  /** Draw the vital-sign line on mount (crest only). */
  animated?: boolean;
  /** Dim to a resting state (e.g. when no questions remain). */
  resting?: boolean;
  style?: ViewStyle;
}

export function PulseMark({
  size = 64,
  ringColor = color.yellow,
  strokeColor = color.yellow,
  variant = 'crest',
  animated = false,
  resting = false,
  style,
}: PulseMarkProps) {
  const dash = useSharedValue(animated ? PULSE_LENGTH : 0);

  useEffect(() => {
    if (animated) {
      dash.value = PULSE_LENGTH;
      dash.value = withTiming(0, { duration: 900, easing: Easing.out(Easing.cubic) });
    }
  }, [animated]);

  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: dash.value }));

  if (variant === 'listening') {
    // Concentric "listening" halo — used behind the pet avatar in the loader.
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100" style={style}>
        <Circle cx="50" cy="50" r="46" fill="none" stroke={ringColor} strokeWidth="1" opacity={0.18} />
        <Circle cx="50" cy="50" r="34" fill="none" stroke={ringColor} strokeWidth="1.5" opacity={0.4} />
        <Circle cx="50" cy="50" r="22" fill="none" stroke={ringColor} strokeWidth="2" opacity={0.85} />
      </Svg>
    );
  }

  const op = resting ? 0.4 : 1;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={style} opacity={op}>
      <Circle cx="50" cy="50" r="29" fill="none" stroke={ringColor} strokeWidth="2.5" />
      <Circle cx="50" cy="50" r="22" fill="none" stroke={ringColor} strokeWidth="1" opacity={0.28} />
      <AnimatedPolyline
        points={PULSE_POINTS}
        fill="none"
        stroke={strokeColor}
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={PULSE_LENGTH}
        animatedProps={lineProps}
      />
    </Svg>
  );
}
