/**
 * UpNextCard — the one thing on the Together screen worth leading with.
 *
 * ── Four states, and the colour IS the state ────────────────────────────────
 *
 *   live     navy, yellow eyebrow with a dot   a walk is running — join it
 *   planned  solid yellow                      a walk with a date. The default.
 *   undated  paper with a hairline             a walk with no day agreed
 *   empty    paper with a dashed hairline      nothing booked; host something
 *
 * The loudest surface in the app is reserved for the ten minutes when it is
 * actually useful. A screen where every trail was an equally bright card meant
 * the walk starting in twenty minutes looked exactly like one somebody might
 * plan a fortnight from now — so nothing looked urgent, which is the same as
 * nothing being urgent.
 *
 * The dashed border on `empty` is doing real work: it says "a card belongs here
 * and there isn't one yet" rather than presenting emptiness as a thing you have.
 *
 * Which state you are in is decided in lib/community/upNext.ts and tested
 * there. This paints it and nothing else.
 *
 * ── And a fifth, which is not a state of your plans ────────────────────────
 *
 * `UpNextSkeleton` is what shows while we do not know yet. It is the card's
 * shape with nothing in it and a breathing paw — never the `empty` card, whose
 * dashed border and "Host" button are a claim that nothing is booked. That
 * claim is only made once the server has made it (lib/community/connectStatus).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, font, radius, type } from '../../../constants/design';
import type { UpNextState } from '../../../lib/community/upNext';
import type { CommunityDog } from '../../../lib/communityWalks';
import { DogStack } from '../../community/CommunityUI';
import { BreathingPaw } from '../../BreathingPaw';

interface UpNextCardProps {
  state: UpNextState;
  eyebrow: string;
  title: string;
  subtitle: string;
  /** The row under the rule: who is coming. Absent on the empty state. */
  dogs?: CommunityDog[];
  footnote: string;
  actionLabel: string;
  onAction: () => void;
}

export const UpNextCard = React.memo(function UpNextCard({
  state,
  eyebrow,
  title,
  subtitle,
  dogs,
  footnote,
  actionLabel,
  onAction,
}: UpNextCardProps) {
  const onDark = state === 'live';
  const onYellow = state === 'planned';

  return (
    <View
      style={[
        styles.card,
        onDark && styles.cardLive,
        onYellow && styles.cardPlanned,
        state === 'undated' && styles.cardUndated,
        state === 'empty' && styles.cardEmpty,
      ]}
    >
      <View style={styles.top}>
        <View style={styles.copy}>
          <View style={styles.eyebrowRow}>
            {onDark ? <View style={styles.liveDot} /> : null}
            <Text
              style={[styles.eyebrow, onDark && styles.eyebrowLive, onYellow && styles.onYellowInk]}
              numberOfLines={1}
            >
              {eyebrow}
            </Text>
          </View>
          <Text style={[styles.title, onDark && styles.titleLive]} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.subtitle, onDark && styles.subtitleLive, onYellow && styles.subtitleOnYellow]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={onAction}
          style={({ pressed }) => [
            styles.action,
            onDark && styles.actionLive,
            onYellow && styles.actionOnYellow,
            state === 'undated' && styles.actionUndated,
            state === 'empty' && styles.actionEmpty,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel}. ${title}.`}
        >
          <Text
            style={[
              styles.actionText,
              onDark && styles.actionTextLive,
              onYellow && styles.actionTextOnYellow,
              state === 'undated' && styles.actionTextUndated,
              state === 'empty' && styles.actionTextEmpty,
            ]}
          >
            {actionLabel}
          </Text>
        </Pressable>
      </View>

      <View style={[styles.footer, onDark && styles.footerLive, onYellow && styles.footerOnYellow]}>
        {dogs?.length ? <DogStack dogs={dogs} max={3} /> : null}
        <Text
          style={[styles.footnote, onDark && styles.footnoteLive, onYellow && styles.subtitleOnYellow]}
          numberOfLines={1}
        >
          {footnote}
        </Text>
      </View>
    </View>
  );
});

/** The card's shape, holding its place while the first answer is on its way. */
export const UpNextSkeleton = React.memo(function UpNextSkeleton() {
  return (
    <View
      style={[styles.card, styles.cardSkeleton]}
      accessible
      accessibilityLabel="Finding your meetups"
    >
      <View style={styles.top}>
        <View style={styles.copy}>
          <View style={[styles.bar, styles.barEyebrow]} />
          <View style={[styles.bar, styles.barTitle]} />
          <View style={[styles.bar, styles.barSubtitle]} />
        </View>
        <View style={styles.skeletonAction}>
          <BreathingPaw size={20} workingColor={color.slateFaint} />
        </View>
      </View>
      <View style={styles.footer}>
        <View style={[styles.bar, styles.barFootnote]} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    padding: 16,
    gap: 12,
  },
  cardLive: { backgroundColor: color.navy },
  cardPlanned: { backgroundColor: color.yellow },
  cardUndated: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  cardEmpty: {
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: color.slateFaint,
  },

  cardSkeleton: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  bar: { borderRadius: 6, backgroundColor: color.surfaceSubtle },
  barEyebrow: { width: 92, height: 10 },
  barTitle: { width: '78%', height: 22, marginTop: 4 },
  barSubtitle: { width: '52%', height: 12, marginTop: 4 },
  barFootnote: { width: '46%', height: 12 },
  skeletonAction: {
    minHeight: 44,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.yellow },
  eyebrow: { ...type.caption, fontSize: 10, letterSpacing: 1.3, color: color.slateMuted },
  eyebrowLive: { color: color.yellow },
  onYellowInk: { color: color.navy },
  title: {
    fontFamily: font.bold,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: color.navy,
  },
  titleLive: { color: color.cream },
  subtitle: { ...type.body, fontSize: 12.5, color: color.slateMuted },
  subtitleLive: { color: color.creamDim },
  // Not slateMuted: a grey meant for white paper turns to mud on yellow.
  subtitleOnYellow: { color: '#3E3E22' },

  action: {
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  actionLive: { backgroundColor: color.yellow },
  actionOnYellow: { backgroundColor: color.navy },
  actionUndated: { borderWidth: 1, borderColor: color.navy },
  actionEmpty: { backgroundColor: color.navy },
  actionText: { fontFamily: font.bold, fontSize: 14 },
  actionTextLive: { color: color.navy },
  actionTextOnYellow: { color: color.cream },
  actionTextUndated: { color: color.navy },
  actionTextEmpty: { color: color.cream },
  pressed: { opacity: 0.88 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    paddingTop: 12,
  },
  footerLive: { borderTopColor: color.hairlineOnNavy },
  footerOnYellow: { borderTopColor: 'rgba(7,32,42,0.22)' },
  footnote: { ...type.body, fontSize: 12.5, color: color.slateMuted, flex: 1 },
  footnoteLive: { color: color.creamDim },
});
