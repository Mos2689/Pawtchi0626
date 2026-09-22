/**
 * Asked once, on the screen where the answer starts mattering.
 *
 * ── Why here and not at sign-up ────────────────────────────────────────────
 *
 * A username does exactly one thing: it lets somebody who already knows you
 * type your handle and find you. On the day an account is created there is
 * nobody to find and nothing to explain, so asking then is asking for a
 * decision whose purpose cannot yet be stated. Here, the person has just
 * opened Together — the answer to "why do you want this" is the screen behind
 * the sheet.
 *
 * It also closes a real gap. The only other place that ever asked for a
 * username was the trails list, and Home's Together panel replaced that screen:
 * unless somebody claimed an external invite link, they could use the whole
 * feature without ever being offered one — and then wonder why no friend could
 * add them.
 *
 * ── Once, and dismissible ──────────────────────────────────────────────────
 *
 * It stops appearing for good the moment a username exists, because the thing
 * it asks for has been answered. Until then it can be closed, and the caller
 * is expected not to re-open it in the same session — a sheet that returns
 * every time you tap a chip is a nag, and a nag about an optional field is how
 * people learn to dismiss things without reading them.
 *
 * Nothing is blocked either way. Everything on Together works without a
 * username except other people finding you, which is exactly what the copy
 * says.
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { color, radius, space, type } from '../../constants/design';
import { UsernameEditor } from './UsernameEditor';

export function UsernamePrompt({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: (username: string) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <View style={styles.grip} />

        <View style={styles.head}>
          <View style={styles.mark}><Text style={styles.markAt}>@</Text></View>
          <Pressable
            onPress={onClose}
            style={styles.close}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Not now"
          >
            <Ionicons name="close" size={20} color={color.navy} />
          </Pressable>
        </View>

        <Text style={styles.title}>Pick how friends find you</Text>
        <Text style={styles.body}>
          Someone who already knows you types your exact username to invite you. Pawtchi has no
          people search and never lists you anywhere.
        </Text>

        <UsernameEditor
          onSaved={onSaved}
          saveLabel="Save and continue"
          // The person opened this sheet's one field on purpose, which is the
          // only case the app allows a keyboard to appear on its own.
          autoFocus
        />

        <Pressable onPress={onClose} style={styles.later} accessibilityRole="button">
          <Text style={styles.laterText}>Not now</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(7,32,42,0.38)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.surfaceSubtle,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
  },
  grip: {
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: color.slateFaint,
    alignSelf: 'center',
    marginTop: 10,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.lg,
  },
  mark: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markAt: { ...type.heading, fontSize: 22, color: color.navy },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...type.heading, fontSize: 21, color: color.navy, marginTop: space.lg },
  body: { ...type.body, fontSize: 13.5, lineHeight: 20, color: color.slateMuted, marginTop: 6, marginBottom: space.xl },
  later: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  laterText: { ...type.label, fontSize: 13, color: color.slateMuted },
});

export const USERNAME_PROMPT_RADIUS = radius.xxl;
