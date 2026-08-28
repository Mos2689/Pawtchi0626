/**
 * HomeTopBar — the floating chrome at the top of the map.
 *
 * Nothing here sits in a bar: the map runs edge to edge underneath and every
 * control is its own rounded, elevated object. That is what keeps the screen
 * reading as a map with things on it rather than a page with a map in it.
 *
 * One row: the avatar (whose map this is, and the way into the story), the name,
 * the segmented control (what the pins mean), and a slot that carries a
 * notification warning when there is one.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { color, font, makeShadow, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { WALKSIGN_COPY } from '../../lib/walksign/copy';
import { ALL_WALKSIGNS, type WalksignId } from '../../lib/walksign/types';
import type { RailSegment } from '../../lib/home/homeRail';
import { WalkStoryRing } from '../WalkStoryRing';

/**
 * Two segments, and the split is the whole idea:
 *
 *   Walks — where this dog HAS been, from walk history.
 *   Spots — where they COULD go, from OpenStreetMap.
 *
 * There was briefly a third, "Sniffs". It was removed because it split apart
 * two things that only mean something together: a sniff stop has no name of its
 * own, so its card borrowed the walk's place name and the list read as the same
 * title repeated — while the route those stops belonged to sat one tab away.
 * They are now pins on the selected walk's own route, which is where they were
 * always about to make sense.
 */
const SEGMENTS: { key: RailSegment; label: string }[] = [
  { key: 'walks', label: 'Walk' },
  { key: 'spots', label: 'Nearby' },
];

/** Narrow the free-form DB string to a known sign; anything else reads as none. */
function toWalksignId(raw?: string | null): WalksignId | null {
  const v = (raw ?? '').trim() as WalksignId;
  return ALL_WALKSIGNS.includes(v) ? v : null;
}

interface HomeTopBarProps {
  petName?: string | null;
  walksign?: string | null;
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
  /** The right-hand slot — a notification chip or the coin pill. */
  trailing?: React.ReactNode;
}

export function HomeTopBar({
  petName,
  walksign,
  avatarUri,
  storyRingEnabled,
  hasFreshStory,
  onAvatarPress,
  segment,
  onSegmentChange,
  spotsEnabled,
  trailing,
}: HomeTopBarProps) {
  const name = petName?.trim() || 'Your dog';
  const sign = toWalksignId(walksign);
  const segments = spotsEnabled ? SEGMENTS : SEGMENTS.filter(s => s.key !== 'spots');

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {/* One row: the dog, the filter, the balance. The identity pill that used
          to sit between them pushed the filter onto a second line and cost the
          map ~60px of its own screen — the name is on the avatar's own profile,
          the filter is what this row is for. */}
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

        {/* Flexes rather than sitting at a fixed width: it is the only thing in
            this row whose content length we don't control, so it is the only
            thing that should absorb a narrow screen. The name truncates; the
            filter and the balance never shrink. */}
        <View style={styles.namePill}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {sign && (
            <Text style={styles.sign} numberOfLines={1}>
              {WALKSIGN_COPY[sign].displayName}
            </Text>
          )}
        </View>

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
  namePill: {
    flexShrink: 1,
    minWidth: 0,
    backgroundColor: color.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    ...makeShadow(2, 10, 0.1),
  },
  name: {
    fontFamily: font.bold,
    fontSize: 13.5,
    color: color.ink,
    letterSpacing: -0.2,
  },
  sign: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    // Identity, not action — the sanctioned electric blue.
    color: color.electric,
    marginTop: 1,
  },
  // Pushed to the right so the avatar anchors the far left and the control
  // anchors the far right, with the name pill floating between them.
  //
  // The slack now falls in the MIDDLE of the row rather than at either end,
  // which is what stops the third segment from clipping the pet's name the way
  // it did when a coin pill still held this edge.
  segmentRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
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
  // Tighter than the two-segment original. A third label pushed the control
  // wide enough to squeeze the name pill to a couple of characters on a small
  // screen; trimming the chip padding buys that space back from the control
  // rather than from the dog's name.
  segment: {
    paddingHorizontal: 11,
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
