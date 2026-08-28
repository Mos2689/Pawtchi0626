/**
 * SpotFilterRail — the category chips that float above the rail in Spots mode.
 *
 * Filtering never fetches (see lib/spots/filters.ts): one query returns every
 * category for the area and these chips are a view over it. That is why they
 * can feel instant, and why tapping through all six costs nothing upstream.
 *
 * A chip with nothing behind it is dimmed rather than removed. The row is part
 * of the screen's shape, and a control that changes width as data arrives is
 * more disorienting than one with an unavailable option in it.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';

import { color, font, makeShadow, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { ALL_FILTERS, type SpotFilter } from '../../lib/spots/filters';
import { copy } from '../../lib/spots/copy';

interface SpotFilterRailProps {
  selected: SpotFilter;
  available: Set<SpotFilter>;
  onSelect: (filter: SpotFilter) => void;
}

export function SpotFilterRail({ selected, available, onSelect }: SpotFilterRailProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      // The chips scroll; the map underneath must still receive the gaps.
      style={styles.scroll}
    >
      {ALL_FILTERS.map(filter => {
        const active = filter === selected;
        const disabled = !available.has(filter);
        return (
          <TouchableOpacity
            key={filter}
            style={[styles.chip, active && styles.chipActive]}
            activeOpacity={disabled ? 1 : 0.85}
            onPress={() => {
              if (active || disabled) return;
              haptic.select();
              onSelect(filter);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            accessibilityLabel={disabled ? `${copy.filters[filter]}, none nearby` : copy.filters[filter]}
          >
            <Text
              style={[
                styles.label,
                active && styles.labelActive,
                disabled && styles.labelDisabled,
              ]}
            >
              {copy.filters[filter]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    // Sized to its content so the row never becomes a full-height touch target
    // sitting invisibly over the map.
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    gap: space.xs,
    paddingHorizontal: space.md,
  },
  // Same high-contrast black-on-white language as the segmented control above
  // it — this is navigation, so it is allowed to be pure ink. Yellow stays
  // reserved for the one action that matters on the screen.
  chip: {
    backgroundColor: color.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...makeShadow(2, 8, 0.1),
  },
  chipActive: {
    backgroundColor: color.ink,
  },
  label: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slateMuted,
  },
  labelActive: {
    color: color.surface,
  },
  labelDisabled: {
    color: color.slateFaint,
  },
});
