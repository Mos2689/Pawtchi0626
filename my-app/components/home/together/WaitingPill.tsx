/**
 * WaitingPill — the things on this screen that are waiting on YOU.
 *
 * It floats on the map rather than living in the sheet, and that placement is
 * the point: the sheet is about arrangements, this is about people, and a
 * request buried three cards down a list is a request nobody answers. It is
 * also the only object here that expires — an invitation has a deadline and a
 * join request leaves somebody stuck until it is answered.
 *
 * Navy, because it has to win against live map tiles of unknown colour, and
 * because it is the only floating chrome on this segment that is asking for
 * something rather than offering it.
 *
 * It counts, names nobody, and opens the sheet. The answering happens there,
 * next to the context that makes it answerable — approving "R" from a pill is
 * approving an initial.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { color, font, makeShadow, radius, space, type } from '../../../constants/design';
import type { CommunityDog } from '../../../lib/communityWalks';
import { DogStack } from '../../community/CommunityUI';

export function WaitingPill({
  count,
  dogs,
  onPress,
}: {
  count: number;
  /** Faces from whoever is asking, when we have them. */
  dogs: CommunityDog[];
  onPress: () => void;
}) {
  if (count <= 0) return null;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${count} ${count === 1 ? 'thing is' : 'things are'} waiting on you. Open your trails.`}
    >
      <Ionicons name="notifications-outline" size={16} color={color.yellow} />
      <Text style={styles.text} numberOfLines={1}>
        {count} waiting on you
      </Text>
      {dogs.length ? (
        <View style={styles.faces}>
          <DogStack dogs={dogs} max={3} />
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={15} color={color.creamFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    alignSelf: 'flex-start',
    minHeight: 46,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: radius.pill,
    backgroundColor: color.navy,
    ...makeShadow(8, 20, 0.20),
  },
  pressed: { opacity: 0.9 },
  text: { ...type.label, fontSize: 12.5, fontFamily: font.semibold, color: color.cream },
  // Tighter than the stack's own rhythm: this is a pill, not a card, and the
  // faces are a hint at who rather than a roll call.
  faces: { transform: [{ scale: 0.68 }], marginHorizontal: -space.sm },
});
