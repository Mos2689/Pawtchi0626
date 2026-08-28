// One of the three ways into support.
//
// A full-width row rather than a grid of tiles: the labels are sentences, not
// nouns, and sentences need width. The blue icon tile carries the structural
// colour of this surface; nothing here is yellow, because the three doors are
// equals and highlighting one would be a recommendation we do not mean.

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { Typography } from '../Typography';
import { color, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';

interface Props {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}

export function SupportDoor({ icon, title, subtitle, onPress }: Props) {
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
    >
      <View style={styles.iconTile}>
        <MaterialIcons name={icon} size={20} color={color.letter.accent} />
      </View>

      <View style={styles.text}>
        <Typography variant="body" weight="bold" color={color.navy}>
          {title}
        </Typography>
        <Typography variant="caption" color={color.slateMuted} style={styles.subtitle}>
          {subtitle}
        </Typography>
      </View>

      <MaterialIcons name="chevron-right" size={20} color={color.letter.accent} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.letter.hairline,
    backgroundColor: color.letter.paper,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.letter.accentSoft,
  },
  text: { flex: 1, gap: 2 },
  // The caption preset carries display letter-spacing; this copy is a sentence,
  // so it is reset to read as prose rather than as a label.
  subtitle: { letterSpacing: 0, lineHeight: 16 },
});
