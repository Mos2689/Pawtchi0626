import React, { useEffect } from 'react';
import { TextInput, TextStyle, StyleProp, Platform } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedProps, useAnimatedReaction, withDelay, withTiming,
  Easing, runOnJS,
} from 'react-native-reanimated';
import { motion } from '../constants/design';
import { haptic } from '../lib/haptics';

Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

interface Props {
  /** Final value the number settles on. */
  value: number;
  /** Starting value; defaults to 0. */
  from?: number;
  decimals?: number;
  /** Sweep duration in ms; defaults to the ring sweep. */
  duration?: number;
  delay?: number;
  style?: StyleProp<TextStyle>;
  /** Fires once when the sweep lands on the final value. */
  onDone?: () => void;
  /** Light haptic ticks at 25/50/75% of the sweep (iOS only via lib/haptics). */
  hapticTicks?: boolean;
}

/**
 * A number that visibly earns its value: sweeps from `from` to `value` with the
 * standard ease-out curve, rendered via an uneditable TextInput so the digits
 * update on the UI thread. Used for the reveal kcal hero, login stat stack and
 * the goal-screen weight settle.
 */
export function CountUpText({
  value,
  from = 0,
  decimals = 0,
  duration = motion.duration.ring,
  delay = 0,
  style,
  onDone,
  hapticTicks = false,
}: Props) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      delay,
      withTiming(1, { duration, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished && onDone) runOnJS(onDone)();
      }),
    );
    // Re-run the sweep only when the target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, from]);

  useAnimatedReaction(
    () => (hapticTicks ? Math.floor(progress.value * 4) : 0),
    (quarter, prev) => {
      if (hapticTicks && prev !== null && quarter > prev && quarter > 0 && quarter < 4) {
        runOnJS(haptic.tap)();
      }
    },
    [hapticTicks],
  );

  const animatedProps = useAnimatedProps(() => {
    const v = from + (value - from) * progress.value;
    return { text: v.toFixed(decimals) } as any;
  });

  return (
    <AnimatedTextInput
      editable={false}
      underlineColorAndroid="transparent"
      defaultValue={from.toFixed(decimals)}
      animatedProps={animatedProps}
      pointerEvents="none"
      style={[
        { padding: 0, margin: 0 },
        Platform.OS === 'android' && { includeFontPadding: false as const },
        style,
      ]}
    />
  );
}
