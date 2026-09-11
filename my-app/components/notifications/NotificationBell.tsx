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
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { color, font, makeShadow, motion } from '../../constants/design';
import { NotificationCluster } from './NotificationCluster';
import {
  describeSegments,
  occupiedSegments,
  type SegmentCounts,
} from '../../lib/notificationCenter/segments';

interface Props {
  /** Unread items in the center. Zero renders the plain bell. */
  count: number;
  /** True when anything unread is clinical or needs an action. Drives the colour. */
  urgent: boolean;
  /** True when the OS will not deliver pushes — outranks the count. */
  unreachable: boolean;
  /** Only meaningful while `unreachable`; changes where a tap goes. */
  isBlocked?: boolean;
  /**
   * Unread split by lane. Drives the arrival pill; without it the bell is
   * exactly the control it has always been, so it keeps working anywhere it is
   * mounted that has no segment data.
   */
  segments?: SegmentCounts;
  /**
   * Whether anything unread still has an announcement owing. False collapses
   * the pill to the plain count badge.
   *
   * Owned by the store rather than by this component: the answer has to survive
   * this bell unmounting on a tab change and outlive the app being killed, or
   * every cold start would re-announce items the owner dealt with days ago.
   */
  announce?: boolean;
  onPress: () => void;
}

/** Two digits is the widest the badge can be before it starts pushing the row. */
function formatCount(count: number): string {
  return count > 9 ? '9+' : String(count);
}

export function NotificationBell({
  count,
  urgent,
  unreachable,
  isBlocked,
  segments,
  announce = false,
  onPress,
}: Props) {
  const hasUnread = !unreachable && count > 0;
  const badgeVisible = unreachable || hasUnread;

  // Never while unreachable — that state is one solid dot about the OS, not a
  // breakdown of what is waiting behind it.
  const showCluster = hasUnread && announce && !!segments && occupiedSegments(segments) > 0;

  // The badge carries a number only in the resting state. While the pill is up
  // it collapses to a dot: the breakdown is already on the pill, and a dot is
  // what the caret can point at without the two competing.
  const showsCount = !unreachable && !showCluster;

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
      ? // With the pill up, the breakdown is the more useful thing to hear —
        // it is exactly what a sighted owner is reading off the badge.
        showCluster
        ? `Notifications, ${describeSegments(segments!)}`
        : `Notifications, ${count} unread`
      : 'Notifications';

  return (
    // A zero-size anchor rather than a container with width: the pill is
    // absolute inside it and the circle keeps its own 38pt, so the header row
    // measures exactly what it always did and nothing shifts when a pill
    // appears. `overflow: visible` is the default but is stated because the
    // whole design depends on a child drawing outside its parent.
    <View style={styles.anchor} pointerEvents="box-none">
      {/* Before the circle in the tree, so the opaque circle paints over the
          pill's right end and it reads as coming out from behind the bell. */}
      {showCluster && <NotificationCluster counts={segments!} urgent={urgent} />}

      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <MaterialIcons
          name={
            unreachable ? 'notifications-off' : hasUnread ? 'notifications' : 'notifications-none'
          }
          size={20}
          color={color.ink}
        />

        {/*
          Three shapes, one slot:
            unreachable  — a bare dot about the OS, no count to give.
            pill showing — a bare dot again, and this one is doing real work:
                           it is what the pill's caret points at, so the two
                           read as one object interrupted by the circle rather
                           than a badge and an unrelated slab below it.
            otherwise    — the count, which is the collapsed resting state.
        */}
        {badgeVisible && (
          <Animated.View
            style={[
              styles.badge,
              // Red is reserved for "something is wrong or needs deciding".
              // An inbox of cheerful walk notes gets the brand yellow instead,
              // so red never becomes the colour the bell simply is.
              { backgroundColor: unreachable || urgent ? color.error : color.yellow },
              showsCount && styles.badgeWithCount,
              badgeStyle,
            ]}
            pointerEvents="none"
          >
            {showsCount && (
              <Text
                style={[
                  styles.badgeText,
                  // Yellow is far too light to carry white text; navy on yellow
                  // is the pairing used everywhere a yellow chip has a label.
                  { color: urgent ? color.surface : color.navy },
                ]}
              >
                {formatCount(count)}
              </Text>
            )}
          </Animated.View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sized by the circle alone. The pill is absolute inside it and contributes
  // nothing to layout, which is what lets it spill left over the header without
  // the row resizing or anything below it moving.
  anchor: {
    overflow: 'visible',
  },
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
