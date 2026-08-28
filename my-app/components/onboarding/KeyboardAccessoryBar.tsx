/**
 * The slim bar that rides on top of the keyboard while a field is focused.
 *
 * It exists because of one specific dead end: the weight field is a
 * `decimal-pad`, and on iOS a decimal pad has no return key. With the Continue
 * button behind the keyboard there was literally no control on screen that
 * would put the keyboard away — the only exit was a tap on whatever sliver of
 * form was still visible. This bar is that missing control, and it doubles as
 * the "which field am I in" label.
 *
 * It is never on screen at the same time as the sticky Continue bar; they swap.
 * That is the point of the pattern — nothing competes with the keyboard for
 * space, because only one of the two ever exists at a time.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AnimatedPressable } from '../AnimatedPressable';
import { color, font, motion, radius, space } from '../../constants/design';

export const KEYBOARD_ACCESSORY_HEIGHT = 52;

export interface KeyboardAccessoryBarProps {
  /** Which field the keyboard belongs to, e.g. "Weight · kg". */
  label: string;
  /** Action word on the pill. "Done" dismisses; screens may pass "Add", "Next". */
  actionLabel?: string;
  onAction: () => void;
}

export function KeyboardAccessoryBar({
  label,
  actionLabel = 'Done',
  onAction,
}: KeyboardAccessoryBarProps) {
  return (
    <View style={styles.bar}>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <AnimatedPressable
        style={styles.action}
        scaleTo={motion.scale.chip}
        haptic="tap"
        onPress={onAction}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
      >
        <Text style={styles.actionText}>{actionLabel}</Text>
      </AnimatedPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: KEYBOARD_ACCESSORY_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: space.xxl,
    paddingRight: space.lg,
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
  },
  label: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 13,
    color: color.slateMuted,
    marginRight: space.md,
  },
  action: {
    backgroundColor: color.yellow,
    paddingHorizontal: space.xl,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  actionText: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.navy,
    letterSpacing: 0.1,
  },
});
