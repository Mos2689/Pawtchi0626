/**
 * OsmAttribution — the credit ODbL requires, wherever OSM-derived data shows.
 *
 * ── Why this exists separately from the basemap's own attribution ──
 * On Android the basemap IS OpenStreetMap, and WalkMap already credits the
 * tiles. On iOS the basemap is Apple's, so the screen carries Apple's
 * attribution and no OSM credit at all — but every SPOT pin on it is derived
 * from OpenStreetMap data. ODbL attaches to the derived data, not just to
 * tiles, so iOS needs this and would otherwise be quietly non-compliant.
 *
 * Shown on both platforms rather than only iOS. Two credits on Android is
 * harmless; a conditional that a future refactor could invert is not.
 */

import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity } from 'react-native';

import { color, font, radius, space } from '../../constants/design';
import { OSM_ATTRIBUTION } from '../../lib/walk/osmStyle';

const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

export function OsmAttribution() {
  return (
    <TouchableOpacity
      style={styles.chip}
      activeOpacity={0.7}
      onPress={() => {
        Linking.openURL(OSM_COPYRIGHT_URL).catch(() => {});
      }}
      accessibilityRole="link"
      accessibilityLabel="OpenStreetMap copyright and licence"
    >
      <Text style={styles.text}>{OSM_ATTRIBUTION}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Quiet, but never invisible: the licence asks for it to be readable, so it
  // sits on its own translucent chip rather than as bare text that could vanish
  // against a dark patch of map.
  chip: {
    alignSelf: 'flex-start',
    marginHorizontal: space.md,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  text: {
    fontFamily: font.regular,
    fontSize: 9.5,
    color: color.slateMuted,
  },
});
