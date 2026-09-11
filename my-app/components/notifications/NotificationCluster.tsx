/**
 * NotificationCluster — the arrival pill that comes out of the bell.
 *
 * A short red pill of icon+count pairs, hung below the bell. Three details make
 * it read as *emerging from* the bell rather than as a slab parked underneath
 * it, and all three are load-bearing:
 *
 *   1. a caret on its top edge, pointing up at the bell;
 *   2. a red dot on the bell's own top-right corner (rendered by the bell), so
 *      the caret has something to point AT — the pill and the dot are one
 *      object interrupted by the circle;
 *   3. an entrance that scales up from its top-right corner, i.e. from the
 *      bell, instead of fading in where it already is.
 *
 * Drop any one of them and it goes back to looking patched on.
 *
 * ── Why it is allowed to cover things ───────────────────────────────────────
 *
 * It hangs over the map and whatever card is sitting on it, and that is fine
 * *because* it is temporary — the same trade every toast makes. What it must
 * never do is take a tap meant for something underneath, which is why it is
 * `pointerEvents="none"`: it is pixels only, and the bell above it is the thing
 * you press.
 */

import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { color, font, makeShadow, motion } from '../../constants/design';
import {
  SEGMENT_ICON,
  visibleLanes,
  type SegmentCounts,
} from '../../lib/notificationCenter/segments';

/** Past two digits a lane starts stretching the pill across the whole header. */
function formatCount(count: number): string {
  return count > 9 ? '9+' : String(count);
}

/**
 * Where the caret sits, measured from the pill's right edge.
 *
 * The pill is right-aligned to the bell, so the bell's centre is 19pt in — half
 * the 38pt circle. Half the caret's width again puts its point directly under
 * that centre. Keep this in step with the circle if it is ever resized.
 */
const CARET_SIZE = 9;
const CARET_RIGHT = 19 - CARET_SIZE / 2;

interface Props {
  counts: SegmentCounts;
  /** True when anything unread needs a decision. Red if so, brand yellow if not. */
  urgent: boolean;
}

export function NotificationCluster({ counts, urgent }: Props) {
  const lanes = visibleLanes(counts);
  const total = lanes.reduce((n, key) => n + counts[key], 0);

  // Red is reserved for "something needs deciding". A pill of nothing but
  // milestones and recaps is yellow, so red never decays into the colour the
  // bell simply is.
  const fill = urgent ? color.error : color.yellow;
  const foreground = urgent ? color.surface : color.navy;

  /**
   * One shared value doing two jobs, in order: grow out of the bell on the
   * first frame, then beat once per later arrival.
   *
   * The ref is what keeps them apart — without it the mount run of the effect
   * would fire the heartbeat on top of the entrance and the pill would arrive
   * twitching.
   */
  const scale = useSharedValue(0.7);
  const opacity = useSharedValue(0);
  const entered = useRef(false);

  useEffect(() => {
    if (total <= 0) return;

    if (!entered.current) {
      entered.current = true;
      opacity.value = withTiming(1, { duration: motion.duration.instant });
      scale.value = withSpring(1, motion.spring.bouncy);
      return;
    }

    // A later arrival while the pill is already up: one beat, the same
    // "breathe while working, one beat on completion" language as the loader.
    scale.value = withSequence(
      withTiming(motion.loader.heartbeatScale + 0.09, { duration: motion.duration.instant }),
      withTiming(1, { duration: motion.duration.fast }),
    );
  }, [total, scale, opacity]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.pill,
        { backgroundColor: fill },
        enterStyle,
      ]}
      // Pixels only. The bell above it takes the tap, and whatever it covers
      // keeps its own.
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* A square stood on its corner, half of it buried in the pill's top
          edge — the visible half is the point. Cheaper and crisper at this size
          than a border-triangle, and it inherits the pill's colour so the two
          can never drift apart. */}
      <View style={[styles.caret, { backgroundColor: fill }]} />

      {lanes.map(key => (
        <View key={key} style={styles.lane}>
          <MaterialIcons name={SEGMENT_ICON[key] as any} size={13} color={foreground} />
          <Text style={[styles.count, { color: foreground }]}>{formatCount(counts[key])}</Text>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    // Hangs below the bell rather than beside it. Sitting to the left put it
    // straight across the Walk/Nearby control; below, it drops over the map,
    // which is the one surface here with nothing to collide with.
    //
    // Right-aligned to the bell because the pill is ~123pt at three lanes and
    // the bell is already at the screen's right margin — centring it under the
    // bell would push half of it off screen.
    right: 0,
    // Clear of the circle, not tucked behind it. The caret is what carries the
    // connection now, and a caret half-swallowed by the bell reads as a glitch
    // rather than a pointer — so the pill sits just below the 38pt circle with
    // the caret bridging the gap.
    top: 42,
    height: 26,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 11,
    ...makeShadow(2, 8, 0.14),
    // The caret pokes above this view's own bounds.
    overflow: 'visible',
    // Grow from the corner nearest the bell, so the pill reads as coming out of
    // it. Without this it scales from its middle and just appears.
    transformOrigin: 'top right',
  },
  caret: {
    position: 'absolute',
    right: CARET_RIGHT,
    // Half the rotated square's height above the pill's edge, so exactly its
    // top corner shows.
    top: -CARET_SIZE / 2,
    width: CARET_SIZE,
    height: CARET_SIZE,
    transform: [{ rotate: '45deg' }],
    borderTopLeftRadius: 2,
  },
  lane: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  count: {
    fontFamily: font.bold,
    fontSize: 12,
    // Matched to the glyph's optical height so the pair sits on one baseline —
    // leaving this unset is most of what made the first pass look cramped.
    lineHeight: 14,
    letterSpacing: -0.2,
  },
});
