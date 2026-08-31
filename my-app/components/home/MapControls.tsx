/**
 * MapControls — the small round controls stacked on the right edge of the map.
 *
 * Map controls belong on the map, not in the chrome. Moving the gallery here
 * left the bottom bar with exactly two jobs — record on the left, navigate on
 * the right — and gave this screen somewhere obvious to put the next map
 * control without renegotiating the bar.
 *
 * Recentre is not a "my location" button and deliberately doesn't use that
 * icon: it reframes the map on the newest walk, which is what you want after
 * swiping the rail somewhere else. Home never asks for a live fix just to move
 * the camera.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { color, font, makeShadow, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { track } from '../../lib/analytics';
import { copy } from '../../lib/spots/copy';

interface MapControlsProps {
  /** Hidden until the archive is worth opening. */
  galleryEnabled: boolean;
  /** The compact replacement for the former final card in the Home rail. */
  onFindFriend: () => void;
  /** Shown only once the rail has been moved off its default. */
  canRecentre: boolean;
  onRecentre: () => void;
  /**
   * Re-ask about where the owner is standing. Present only in Spots mode.
   *
   * Distinct from `onSearchArea` below, which asks about wherever the map has
   * been dragged to. Refresh is "the answer may have changed"; Search this area
   * is "I'm asking about somewhere else" — and only the second one is worth
   * putting in front of someone unprompted.
   */
  onRefreshSpots?: () => void;
  /** Widen 3 km → 5 km. Hidden once already at the maximum. */
  onExpandSpots?: () => void;
  /**
   * Query the piece of map currently on screen.
   *
   * Appears only once the view has actually travelled far enough for the
   * results on screen to have stopped describing it — see
   * lib/spots/areaSearch.ts. Every tap is an upstream request against volunteer
   * infrastructure, so the offer is earned rather than permanent.
   */
  onSearchArea?: () => void;
}

export function MapControls({
  galleryEnabled,
  onFindFriend,
  canRecentre,
  onRecentre,
  onRefreshSpots,
  onExpandSpots,
  onSearchArea,
}: MapControlsProps) {
  const router = useRouter();

  return (
    <View style={styles.stack} pointerEvents="box-none">
      {/* Centred, above the round controls: it is a statement about the whole
          map rather than another switch on its edge. */}
      {!!onSearchArea && (
        <TouchableOpacity
          style={styles.areaPill}
          activeOpacity={0.85}
          onPress={() => {
            haptic.tap();
            onSearchArea();
          }}
          accessibilityRole="button"
          accessibilityLabel={copy.actions.searchArea}
        >
          <MaterialIcons name="search" size={16} color={color.ink} />
          <Text style={styles.areaPillText}>{copy.actions.searchArea}</Text>
        </TouchableOpacity>
      )}

      {!!onExpandSpots && (
        <TouchableOpacity
          style={styles.control}
          activeOpacity={0.85}
          onPress={() => {
            haptic.tap();
            onExpandSpots();
          }}
          accessibilityRole="button"
          accessibilityLabel="Search a wider area"
        >
          <MaterialIcons name="zoom-out-map" size={19} color={color.ink} />
        </TouchableOpacity>
      )}

      {!!onRefreshSpots && (
        <TouchableOpacity
          style={styles.control}
          activeOpacity={0.85}
          onPress={() => {
            haptic.tap();
            onRefreshSpots();
          }}
          accessibilityRole="button"
          accessibilityLabel="Refresh nearby spots"
        >
          <MaterialIcons name="refresh" size={19} color={color.ink} />
        </TouchableOpacity>
      )}

      {galleryEnabled && (
        <TouchableOpacity
          style={styles.control}
          activeOpacity={0.85}
          onPress={() => {
            haptic.tap();
            track('pawprint_teaser_tapped', { recap_headline: false });
            router.push('/walk-gallery' as never);
          }}
          accessibilityRole="button"
          accessibilityLabel="Walk gallery"
        >
          <MaterialIcons name="grid-view" size={19} color={color.ink} />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.control}
        activeOpacity={0.85}
        onPress={() => {
          haptic.tap();
          onFindFriend();
        }}
        accessibilityRole="button"
        accessibilityLabel="Find a friend"
        accessibilityHint="Opens the friend invitation screen"
      >
        <MaterialIcons name="group-add" size={20} color={color.ink} />
      </TouchableOpacity>

      {canRecentre && (
        <TouchableOpacity
          style={styles.control}
          activeOpacity={0.85}
          onPress={() => {
            haptic.tap();
            onRecentre();
          }}
          accessibilityRole="button"
          accessibilityLabel="Recentre on the latest walk"
        >
          <MaterialIcons name="filter-center-focus" size={19} color={color.ink} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    alignItems: 'flex-end',
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  control: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...makeShadow(3, 12, 0.14),
  },
  areaPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    marginBottom: space.xs,
    ...makeShadow(3, 12, 0.14),
  },
  areaPillText: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.ink,
  },
});
