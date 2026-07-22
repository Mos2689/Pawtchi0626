import React, { useEffect } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withRepeat, withTiming, withSequence,
  cancelAnimation, Easing,
} from 'react-native-reanimated';
import { color, motion } from '../constants/design';

// The inline sibling of the full-screen PawLoader — a small paw that breathes
// while background work is in flight, then fires the single completion
// heartbeat when `settled` flips true (Living Paw motion language). Use this
// anywhere a full-screen loader would be too heavy: inline cards, banners,
// modal status rows.
export function BreathingPaw({
  settled = false,
  size = 18,
  workingColor = color.navy,
}: {
  settled?: boolean;
  size?: number;
  workingColor?: string;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    if (settled) {
      cancelAnimation(opacity);
      opacity.value = withTiming(1, { duration: motion.duration.fast });
      scale.value = withSequence(
        withSpring(motion.loader.heartbeatScale, motion.spring.bouncy),
        withSpring(1, motion.spring.gentle),
      );
      return;
    }
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: motion.loader.breatheCycle / 2, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.4, { duration: motion.loader.breatheCycle / 2, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
    return () => cancelAnimation(opacity);
  }, [settled, opacity, scale]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={style}>
      <MaterialIcons
        name={settled ? 'check-circle' : 'pets'}
        size={size}
        color={settled ? color.success : workingColor}
      />
    </Animated.View>
  );
}
