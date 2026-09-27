/**
 * HomeTopBar — the floating chrome at the top of the map.
 *
 * Nothing here sits in a bar: the map runs edge to edge underneath and every
 * control is its own rounded, elevated object. That is what keeps the screen
 * reading as a map with things on it rather than a page with a map in it.
 *
 * One row: the avatar (whose map this is, and the way into the story), the
 * segmented control (what the pins mean), and a slot that carries a
 * notification warning when there is one.
 *
 * The name and walksign used to sit in a pill between the avatar and the
 * control. They are gone from here — three identity objects in a row that also
 * has to carry navigation read as clutter, and both facts are already on the
 * dog's own profile, which the avatar one tap to its left opens. The walksign
 * keeps its own surfaces: the profile, the reveal, and its moment card.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { color, font, makeShadow, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import type { RailSegment } from '../../lib/home/homeRail';
import { WalkStoryRing } from '../WalkStoryRing';

/**
 * Three segments, and the split is the whole idea:
 *
 *   Walk     — where this dog HAS been, from walk history.
 *   Nearby   — where they COULD go, from OpenStreetMap.
 *   Together — where they are going WITH someone, from shared Trails.
 *
 * Each answers a different question, which is why they can share a row without
 * competing. The first two are about this dog alone; the third is the only one
 * that involves another household, and it is last because an arrangement with
 * friends is rarer than a walk or a park.
 *
 * There was briefly a different third, "Sniffs". It was removed because it split
 * apart two things that only mean something together: a sniff stop has no name
 * of its own, so its card borrowed the walk's place name and the list read as
 * the same title repeated — while the route those stops belonged to sat one tab
 * away. They are now pins on the selected walk's own route, which is where they
 * were always about to make sense.
 */
const SEGMENTS: { key: RailSegment; label: string }[] = [
  { key: 'walks', label: 'Walk' },
  { key: 'spots', label: 'Nearby' },
  { key: 'together', label: 'Connect' },
];

interface HomeTopBarProps {
  /** Still needed: the avatar's accessible name and the story ring's label. */
  petName?: string | null;
  avatarUri: string;
  storyRingEnabled: boolean;
  hasFreshStory: boolean;
  onAvatarPress: () => void;
  segment: RailSegment;
  onSegmentChange: (segment: RailSegment) => void;
  /**
   * Whether the Spots segment exists at all. Driven by the feature flag, so
   * with Spots off this row is byte-for-byte the two-segment control that
   * shipped before it — no dimmed third option hinting at something missing.
   */
  spotsEnabled: boolean;
  /**
   * Same contract for Together. Withheld rather than dimmed: a chip that
   * cannot be used is a worse answer than a chip that was never offered.
   */
  togetherEnabled: boolean;
  /** The right-hand slot — a notification chip or the coin pill. */
  trailing?: React.ReactNode;
}

export function HomeTopBar({
  petName,
  avatarUri,
  storyRingEnabled,
  hasFreshStory,
  onAvatarPress,
  segment,
  onSegmentChange,
  spotsEnabled,
  togetherEnabled,
  trailing,
}: HomeTopBarProps) {
  const name = petName?.trim() || 'Your dog';
  const segments = SEGMENTS.filter(s => {
    if (s.key === 'spots') return spotsEnabled;
    if (s.key === 'together') return togetherEnabled;
    return true;
  });

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {/* One row: the dog, the filter, the bell. */}
      <View style={styles.row} pointerEvents="box-none">
        {storyRingEnabled ? (
          <WalkStoryRing
            imageUri={avatarUri}
            mode={hasFreshStory ? 'story' : 'nudge'}
            onPress={onAvatarPress}
            petName={petName ?? null}
            size={40}
          />
        ) : (
          <TouchableOpacity
            style={styles.avatarPlain}
            onPress={onAvatarPress}
            accessibilityRole="button"
            accessibilityLabel={`${name}'s profile`}
          />
        )}

        <View style={styles.segmentRow} pointerEvents="box-none">
        <View style={styles.segmented}>
          {segments.map(s => {
            const active = s.key === segment;
            // Neither segment is ever dimmed. Walks always has something to say
            // (even if only the empty card), and Spots content is not known
            // until it has been asked for — pre-judging it would hide the tab
            // behind a state it has not reached yet.
            return (
              <TouchableOpacity
                key={s.key}
                style={[styles.segment, active && styles.segmentActive]}
                onPress={() => {
                  if (active) return;
                  haptic.select();
                  onSegmentChange(s.key);
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={s.label}
              >
                <Text
                  style={[
                    styles.segmentText,
                    active && styles.segmentTextActive,
                  ]}
                >
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          </View>
        </View>

        <View pointerEvents="box-none">{trailing}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  avatarPlain: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.ink,
  },
  // Centred in what the name pill used to occupy, rather than shoved against
  // the bell. With the pill gone this row has three objects and plenty of
  // slack: the avatar anchors the left, the bell the right, and the control
  // floats between them with even air on both sides.
  segmentRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  // High-contrast black-on-white: the navigation is the only place on this
  // screen allowed to be pure ink, which is what keeps the yellow CTA singular.
  segmented: {
    flexDirection: 'row',
    backgroundColor: color.surface,
    borderRadius: radius.pill,
    padding: 3,
    ...makeShadow(2, 10, 0.1),
  },
  // Tighter than the two-segment original. The padding was trimmed back when a
  // third label had to share the row with the name pill; the pill is gone now,
  // but the control reads better compact than sprawling, so it stays.
  //
  // "Together" is the longest label this row carries, and nothing in the row
  // shrinks any more — a clipped filter label has nowhere else to be read, and
  // with the pill gone there is no longer anything competing for the width.
  segment: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  segmentActive: {
    backgroundColor: color.ink,
  },
  segmentText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slateMuted,
  },
  segmentTextActive: {
    color: color.surface,
  },
});
