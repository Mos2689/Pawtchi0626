import React, { useEffect, useRef } from 'react';
import { Pressable, StyleProp, ViewStyle, GestureResponderEvent } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSequence, withSpring,
} from 'react-native-reanimated';
import { motion } from '../constants/design';
import { haptic } from '../lib/haptics';

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

interface Props {
  selected: boolean;
  onPress: () => void;
  children: React.ReactNode;
  /** Base style (always applied). */
  style?: StyleProp<ViewStyle>;
  /** Extra style applied only while selected. */
  selectedStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  /** Rest-state press scale; defaults to the chip scale. */
  scaleTo?: number;
}

/**
 * A selectable surface with consistent tactile feedback: press-scale + a
 * selection haptic on every tap, and a small one-shot "pop" the moment it
 * becomes selected. Visuals are caller-owned (pass `style` / `selectedStyle`)
 * so the same primitive fits pill chips, full-width rows, and list items.
 *
 * Children render as direct descendants of the styled surface (no wrapper), so
 * the caller's flexDirection / layout applies normally. Press and pop scales
 * compose multiplicatively on the one element.
 */
export function SelectableChip({
  selected,
  onPress,
  children,
  style,
  selectedStyle,
  disabled,
  scaleTo = motion.scale.chip,
}: Props) {
  const press = useSharedValue(1);
  const pop = useSharedValue(1);

  // Pop only on the false→true transition, not on every render where selected.
  const wasSelected = useRef(selected);
  useEffect(() => {
    if (selected && !wasSelected.current) {
      pop.value = withSequence(
        withSpring(1.06, motion.spring.bouncy),
        withSpring(1, motion.spring.gentle),
      );
    }
    wasSelected.current = selected;
  }, [selected, pop]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: press.value * pop.value }],
  }));

  const handlePressIn = (_e: GestureResponderEvent) => {
    if (disabled) return;
    press.value = withSpring(scaleTo, motion.spring.press);
    haptic.select();
  };
  const handlePressOut = () => {
    press.value = withSpring(1, motion.spring.press);
  };

  return (
    <AnimatedPressableBase
      onPress={onPress}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, selected && selectedStyle, animatedStyle]}
    >
      {children}
    </AnimatedPressableBase>
  );
}
