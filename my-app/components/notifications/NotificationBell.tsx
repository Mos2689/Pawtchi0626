/**
 * NotificationBell — the way into the notification center.
 *
 * Sits in HomeTopBar's trailing slot, next to the Walks/Spots control, and
 * replaces `NotificationBellChip`. It absorbs that chip's job rather than
 * sitting beside it: the header has room for exactly one object at this edge
 * (see the width comments in HomeTopBar), and two notification controls in the
 * same corner would be indefensible.
 *
 * Three states, one control:
 *
 *   unreachable — the OS will not deliver to this owner. A slashed bell and a
 *                 solid red dot. Tapping routes by *why*, exactly as the chip
 *                 did: system settings when the prompt is spent, the primer
 *                 when it is still available.
 *   unread      — a count. Red when anything unread needs a decision, yellow
 *                 when it is all information.
 *   clear       — a plain outline bell that says nothing.
 *
 * Still deliberately not a two-way switch, for the reason the chip documented:
 * an OS-level disable cannot be undone from inside the app, so this control is
 * only ever allowed to move an owner toward being reachable.
 */

import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { color, font, makeShadow, motion } from '../../constants/design';

interface Props {
  /** Unread items in the center. Zero renders the plain bell. */
  count: number;
  /** True when anything unread is clinical or needs an action. Drives the colour. */
  urgent: boolean;
  /** True when the OS will not deliver pushes — outranks the count. */
  unreachable: boolean;
  /** Only meaningful while `unreachable`; changes where a tap goes. */
  isBlocked?: boolean;
  onPress: () => void;
}

/** Two digits is the widest the badge can be before it starts pushing the row. */
function formatCount(count: number): string {
  return count > 9 ? '9+' : String(count);
}

export function NotificationBell({ count, urgent, unreachable, isBlocked, onPress }: Props) {
  const hasUnread = !unreachable && count > 0;
  const badgeVisible = unreachable || hasUnread;

  // One pulse when the count goes up, and only then. A looping animation in the
  // busiest corner of the app stops being a signal within a day — this is the
  // same "breathe while working, one beat on arrival" language the loader uses.
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (count <= 0) return;
    pulse.value = withSequence(
      withTiming(motion.loader.heartbeatScale + 0.12, { duration: motion.duration.instant }),
      withTiming(1, { duration: motion.duration.fast }),
    );
  }, [count, pulse]);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const accessibilityLabel = unreachable
    ? isBlocked
      ? 'Notifications are off in system settings. Opens settings.'
      : 'Notifications are off. Turn them on.'
    : count > 0
      ? `Notifications, ${count} unread`
      : 'Notifications';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <MaterialIcons
        name={unreachable ? 'notifications-off' : hasUnread ? 'notifications' : 'notifications-none'}
        size={20}
        color={color.ink}
      />

      {badgeVisible && (
        <Animated.View
          style={[
            styles.badge,
            // Red is reserved for "something is wrong or needs deciding".
            // An inbox of cheerful walk notes gets the brand yellow instead, so
            // red never becomes the colour the bell simply is.
            { backgroundColor: unreachable || urgent ? color.error : color.yellow },
            !unreachable && styles.badgeWithCount,
            badgeStyle,
          ]}
          pointerEvents="none"
        >
          {!unreachable && (
            <Text
              style={[
                styles.badgeText,
                // Yellow is far too light to carry white text; navy on yellow
                // is the pairing used everywhere else a yellow chip has a label.
                { color: urgent ? color.surface : color.navy },
              ]}
            >
              {formatCount(count)}
            </Text>
          )}
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A round white object in the same material as the name pill and the
  // segmented control beside it — the header is a row of floating things, not
  // a bar with icons in it.
  button: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...makeShadow(2, 10, 0.1),
  },
  pressed: {
    opacity: 0.75,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 10,
    height: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    // Separates the badge from the glyph behind it without a hard outline.
    borderWidth: 1.5,
    borderColor: color.surface,
  },
  badgeWithCount: {
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 3,
  },
  badgeText: {
    fontFamily: font.bold,
    fontSize: 9.5,
    lineHeight: 12,
  },
});
