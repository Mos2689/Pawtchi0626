/**
 * MapLocationPrompt — the one offer to fill an empty map.
 *
 * Shown only to an owner who has no coordinate anywhere in the app: no walk has
 * ever logged a fix, so the canopy has nothing to draw. It exists because the
 * map is the hero of this screen, and a brand-new owner would otherwise meet a
 * blank half-screen on first launch.
 *
 * It is a prompt, not an auto-fire. Google Play requires a prominent in-app
 * disclosure before the runtime location request, so the OS dialog only ever
 * follows a deliberate tap on this card. Owners who already accepted the
 * disclosure to start a walk skip the explanation and go straight to the ask.
 *
 * Declining costs nothing and is never repeated — the hook records the ask once
 * per install, and the map fills itself in the moment the first walk logs a
 * point regardless.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { color, font, makeShadow, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';

interface MapLocationPromptProps {
  /** Show the full explanation first — false once the walk flow has shown it. */
  needsDisclosure: boolean;
  onAllow: () => void;
  onDismiss: () => void;
}

export function MapLocationPrompt({
  needsDisclosure,
  onAllow,
  onDismiss,
}: MapLocationPromptProps) {
  const [expanded, setExpanded] = useState(false);

  const showExplanation = needsDisclosure && expanded;

  const onPress = () => {
    haptic.tap();
    // The disclosure has to precede the OS dialog, so the first tap opens the
    // explanation and only the second one asks.
    if (needsDisclosure && !expanded) {
      setExpanded(true);
      return;
    }
    onAllow();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.icon}>
            <MaterialIcons name="my-location" size={18} color={color.navy} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.title}>Put your streets on the map</Text>
            <Text style={styles.body}>
              Pawtchi can show your neighbourhood here until the first walk draws itself.
            </Text>
          </View>
        </View>

        {showExplanation && (
          <Text style={styles.disclosure}>
            Pawtchi reads your device&apos;s location to centre this map, and again while a
            walk is running to measure the route, distance and rest stops. Because walks
            usually start at home, the map can show roughly where you live. Only you can
            see it. It is never used for advertising.
          </Text>
        )}

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.allowBtn}
            onPress={onPress}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.allowText}>
              {showExplanation || !needsDisclosure ? 'Use my location' : 'Show me how'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.dismissBtn}
            onPress={() => {
              haptic.tap();
              onDismiss();
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={styles.dismissText}>Not now</Text>
          </TouchableOpacity>
        </View>
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
  disclosure: {
    fontFamily: font.regular,
    fontSize: 11.5,
    lineHeight: 17,
    color: color.slateMuted,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  allowBtn: {
    flex: 1,
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 11,
    alignItems: 'center',
  },
  allowText: {
    fontFamily: font.bold,
    fontSize: 13,
    color: color.navy,
  },
  dismissBtn: {
    paddingVertical: 11,
    paddingHorizontal: space.sm,
  },
  dismissText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slateMuted,
  },
});
