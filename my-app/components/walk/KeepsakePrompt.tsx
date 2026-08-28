/**
 * KeepsakePrompt — the offer that appears mid-walk, and almost never otherwise.
 *
 * Two shapes, one surface:
 *
 *   • `sniff` — the dog has been nose-down at the same spot for half a minute.
 *     The owner is stationary, unoccupied, and holding a phone, and Pawtchi is
 *     the only app that knows it. This is the moment the walk camera exists
 *     for; the gating lives in lib/walk/capturePrompt.ts.
 *
 *   • `place` — this exact spot holds a photo from months ago. Offering the
 *     pair is what turns walking the same loop every day from the thing that
 *     flattens the product into the thing that gives it depth. Gating lives in
 *     lib/walk/placeMemory.ts.
 *
 * ── The design constraint that matters most ──
 * This must be refusable in one gesture and must never block the walk. It sits
 * above the walk UI, not over it; dismissing is a tap anywhere on the card's
 * close affordance, and a prompt that is ignored simply fades. Nothing here is
 * modal, because a dog does not wait for a dialog.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Reanimated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font, radius, shadow, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';

export type KeepsakePromptKind = 'sniff' | 'place';

interface KeepsakePromptProps {
  kind: KeepsakePromptKind;
  /** Thumbnail of the past moment. `place` only. */
  anchorUri?: string | null;
  /** How long ago that past moment was, in whole days. `place` only. */
  anchorAgeDays?: number | null;
  onCapture: () => void;
  onDismiss: () => void;
  /** Auto-dismiss after this long. The moment passes; so should the prompt. */
  autoDismissMs?: number;
}

/**
 * Long enough to notice and act on, short enough that a prompt for a sniff that
 * ended twenty seconds ago does not linger into the next street.
 */
const DEFAULT_AUTO_DISMISS_MS = 20_000;

/** "3 months ago", "last year" — calm, never a precise date. */
export function anchorAgeLabel(days: number): string {
  if (days < 45) return 'a few weeks ago';
  const months = Math.round(days / 30);
  if (months < 12) return `${months} months ago`;
  const years = Math.round(days / 365);
  return years <= 1 ? 'a year ago' : `${years} years ago`;
}

export function KeepsakePrompt({
  kind,
  anchorUri,
  anchorAgeDays,
  onCapture,
  onDismiss,
  autoDismissMs = DEFAULT_AUTO_DISMISS_MS,
}: KeepsakePromptProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, onDismiss]);

  const isPlace = kind === 'place';
  const title = isPlace ? 'You have been here before' : 'Something worth stopping for';
  const body = isPlace
    ? anchorAgeDays != null
      ? `You photographed this spot ${anchorAgeLabel(anchorAgeDays)}. Take another.`
      : 'You photographed this spot once before. Take another.'
    : 'A good long sniff. Worth a photo while you wait.';

  return (
    <Reanimated.View
      entering={FadeInUp.duration(320)}
      exiting={FadeOutDown.duration(200)}
      style={styles.card}
      accessibilityRole="alert"
    >
      {isPlace && anchorUri ? (
        <Image source={{ uri: anchorUri }} style={styles.anchor} contentFit="cover" transition={180} />
      ) : (
        <View style={styles.glyph}>
          <MaterialIcons
            name={isPlace ? 'history' : 'pets'}
            size={20}
            color={color.electric}
          />
        </View>
      )}

      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.body} numberOfLines={2}>
          {body}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.action}
        onPress={() => {
          haptic.tap();
          onCapture();
        }}
        accessibilityRole="button"
        accessibilityLabel={isPlace ? 'Take the matching photo' : 'Take a photo'}
      >
        <MaterialIcons name="photo-camera" size={20} color={color.navy} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.dismiss}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Not now"
        hitSlop={10}
      >
        <MaterialIcons name="close" size={16} color={color.creamFaint} />
      </TouchableOpacity>
    </Reanimated.View>
  );
}

const ANCHOR = 44;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingLeft: space.md,
    paddingRight: space.xl,
    borderRadius: radius.xl,
    backgroundColor: color.navyRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineOnNavy,
    ...shadow.raised,
  },
  anchor: {
    width: ANCHOR,
    height: ANCHOR,
    borderRadius: radius.md,
    backgroundColor: color.navy,
  },
  glyph: {
    width: ANCHOR,
    height: ANCHOR,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    // Electric blue marks discovery — something the dog found — which is
    // exactly what both of these prompts are about.
    backgroundColor: color.electricSoft,
  },
  copy: { flex: 1 },
  title: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: color.cream,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.creamDim,
    marginTop: 2,
  },
  action: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismiss: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
