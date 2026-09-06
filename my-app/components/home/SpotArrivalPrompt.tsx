/**
 * SpotArrivalPrompt — "You're at Calangute Beach. Start the walk?"
 *
 * The other end of the "Get directions" button. An owner asked how to drive to
 * a place they walk their dog, drove there, and opened Pawtchi; this is Pawtchi
 * having remembered, and offering the one thing they came here to do.
 *
 * ── Why it is a card and not a modal ──
 * It appears unbidden, which is the whole design problem. Something that takes
 * the screen the instant an app opens is an interruption no matter how useful
 * it turns out to be, and it would land on someone still walking from the car
 * with a lead in one hand. A card on the map can be read at a glance, acted on
 * with one tap, and ignored completely by an owner who opened the app for
 * something else entirely.
 *
 * It sits where MapLocationPrompt sits and is built from the same parts, for a
 * reason worth stating: those are the two things on this screen that appear
 * because of context rather than because the owner navigated to them, and an
 * owner should be able to recognise that class of thing on sight.
 *
 * ── Why the place name is the headline ──
 * Because the only thing that makes an unrequested prompt feel like help rather
 * than like being watched is that the owner can verify it instantly. "You're at
 * Calangute Beach" is checkable by looking up. It states an observation and
 * makes no claim about what they should be doing with their afternoon.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';

import { color, font, makeShadow, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { copy } from '../../lib/spots/copy';

interface SpotArrivalPromptProps {
  /** Already resolved for display by the time it was stored. */
  placeName: string;
  onStart: () => void;
  onDismiss: () => void;
}

export function SpotArrivalPrompt({
  placeName,
  onStart,
  onDismiss,
}: SpotArrivalPromptProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.icon}>
            <MaterialCommunityIcons name="paw" size={18} color={color.navy} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.title} numberOfLines={2}>
              {copy.arrival.title(placeName)}
            </Text>
            <Text style={styles.body}>{copy.arrival.body}</Text>
          </View>

          {/* A dismiss that is findable without being the loudest thing here.
              The owner may simply be somewhere else in their day, and saying so
              should not require reading to the bottom of the card. */}
          <TouchableOpacity
            style={styles.close}
            onPress={() => {
              haptic.tap();
              onDismiss();
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={copy.arrival.dismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialIcons name="close" size={17} color={color.slateMuted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.startBtn}
          onPress={() => {
            haptic.tap();
            onStart();
          }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`${copy.arrival.action}: ${placeName}`}
        >
          <Text style={styles.startText}>{copy.arrival.action}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingTop: space.md,
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
    gap: space.md,
    ...makeShadow(3, 12, 0.07),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.ink,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.slateMuted,
    marginTop: 2,
  },
  close: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: color.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtn: {
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
  },
  startText: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.navy,
  },
});
