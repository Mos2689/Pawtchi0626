/**
 * Reveal — fade and slide a block in after it mounts.
 *
 * Why not Reanimated's `entering` layout animations: on iOS a TextInput that
 * mounts inside one measures its own height while the layout animation is
 * setting up, and keeps the wrong one — its text and placeholder sit clipped
 * at the bottom of the field. It only shows when the step animates in (a fast
 * refresh mounts without the animation and looks fine), which is why it
 * looked fixed and then broke again on device (25 Oct).
 *
 * This animates an ordinary style instead (opacity and a transform), which
 * never touches layout, so inputs measure exactly as they would unanimated.
 * Same motion as signupMotion.ts: strong ease-out, small distances, no
 * springs. Reduced motion shows the block straight away.
 */

import React, { useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

interface Props {
  children: React.ReactNode;
  /** Stagger position: 0 is first; each step is 50 ms behind the last. */
  i?: number;
  /** Explicit delay in ms; overrides `i`. */
  delay?: number;
  /** Travel in pt while it fades in. */
  dx?: number;
  dy?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

export function Reveal({ children, i, delay, dx = 0, dy = 8, duration = 360, style }: Props) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      t.value = 1;
      return;
    }
    const wait = delay ?? (i === undefined ? 0 : 60 + i * 50);
    t.value = withDelay(wait, withTiming(1, { duration, easing: EASE_OUT }));
    // Once, on mount: a block reveals when it arrives, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animated = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateX: dx * (1 - t.value) }, { translateY: dy * (1 - t.value) }],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
