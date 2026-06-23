import React from 'react';
import { Pressable, PressableProps, GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring,
} from 'react-native-reanimated';
import { motion } from '../constants/design';
import { haptic as hapticFns } from '../lib/haptics';

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

type HapticKind = 'tap' | 'select' | 'medium' | 'none';

interface Props extends Omit<PressableProps, 'style'> {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Rest-state scale the surface springs down to while pressed. */
  scaleTo?: number;
  /** Haptic fired on press-in. Defaults to a light tap. */
  haptic?: HapticKind;
}

/**
 * The reusable tactile surface for the whole app: a Pressable that springs
 * down on press and fires a haptic on press-in. Build buttons, chips, tiles and
 * rows on this instead of bare TouchableOpacity so feedback stays consistent.
 */
export function AnimatedPressable({
  children,
  style,
  scaleTo = motion.scale.press,
  haptic = 'tap',
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: Props) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = (e: GestureResponderEvent) => {
    if (!disabled) {
      scale.value = withSpring(scaleTo, motion.spring.press);
      if (haptic === 'tap') hapticFns.tap();
      else if (haptic === 'select') hapticFns.select();
      else if (haptic === 'medium') hapticFns.medium();
    }
    onPressIn?.(e);
  };

  const handlePressOut = (e: GestureResponderEvent) => {
    scale.value = withSpring(1, motion.spring.press);
    onPressOut?.(e);
  };

  return (
    <AnimatedPressableBase
      style={[style, animatedStyle]}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...rest}
    >
      {children}
    </AnimatedPressableBase>
  );
}
