import React, { useEffect, useState } from 'react';
import { Text, TextStyle, StyleProp } from 'react-native';
import {
  useSharedValue, withTiming, useAnimatedReaction, runOnJS, Easing,
} from 'react-native-reanimated';
import { motion } from '../constants/design';

interface Props {
  value: number;
  style?: StyleProp<TextStyle>;
  /** Format the (rounded) tweened value into a string. Defaults to thousands-separated. */
  format?: (n: number) => string;
  /** Animation duration; defaults to motion.duration.slow. */
  duration?: number;
}

/**
 * A <Text> that tweens between numeric values instead of snapping. Used for the
 * coin pill and any number that changes after an action, so the change reads as
 * motion rather than a jump. Reanimated drives the value; we mirror it to React
 * state on the JS thread for rendering (cheap — one Text node).
 */
export function AnimatedCounter({ value, style, format, duration }: Props) {
  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString('en-US'));
  const animated = useSharedValue(value);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    animated.value = withTiming(value, {
      duration: duration ?? motion.duration.slow,
      easing: Easing.out(Easing.cubic),
    });
  }, [value, duration, animated]);

  useAnimatedReaction(
    () => animated.value,
    (current) => {
      runOnJS(setDisplay)(current);
    },
    [],
  );

  return <Text style={style}>{fmt(display)}</Text>;
}
