/**
 * The creator's own screen. Their code, how many people have used it, and one
 * way to share it.
 *
 * ── Why this is cheap ───────────────────────────────────────────────────────
 *
 * Collaborating creators are Pawtchi users — they have accounts and dogs. So the
 * "creator dashboard" is a screen in an app they are already signed into rather
 * than a second web product with its own login, its own hosting and its own
 * password resets. The entire mechanism is one column (creator_owner_id), one
 * RLS policy, and get_my_creator_code() returning nothing for everyone else.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 *
 * No chart, no target, no earnings, no leaderboard. A plain count is a fact; a
 * chart implies a trend that a handful of redemptions cannot support, and a
 * target invents a number for someone to fall short of. If a creator wants to
 * talk about performance, that is a conversation with a person, and the numbers
 * on this screen are there so they arrive at it already informed.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { color, displayLine, font, radius, space } from '../constants/design';
import { BreathingPaw } from '../components/BreathingPaw';
import { track } from '../lib/analytics';
import { loadMyCreatorCode, type MyCreatorCode } from '../lib/creatorCode/client';
import {
  CREATOR_EYEBROW,
  CREATOR_HEADLINE,
  CREATOR_HOLD_TO_COPY,
  CREATOR_INACTIVE_NOTE,
  CREATOR_SHARE_ACTION,
  CREATOR_SUBCOPY,
  creatorCompLine,
  creatorRedemptionLine,
  creatorShareMessage,
} from '../lib/creatorCode/copy';
import { PAWTCHI_INVITE_URL } from '../lib/referral';

export default function CreatorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [row, setRow] = useState<MyCreatorCode | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Guarded for the same reason as the redeem screen's impression: a bare
  // mount effect fired twice in a real dev build, and `alive` only suppresses
  // a late result, not a second mount.
  const impressionRef = useRef(false);
  useEffect(() => {
    let alive = true;
    loadMyCreatorCode().then(result => {
      if (!alive) return;
      setRow(result);
      setLoaded(true);
      if (result && !impressionRef.current) {
        impressionRef.current = true;
        track('creator_dashboard_viewed', { redemptions: result.redemptionsGranted });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const exit = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as never);
  }, [router]);

  const share = async () => {
    if (!row) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      track('creator_code_shared', {});
      const message = creatorShareMessage(row.code);
      if (Platform.OS === 'ios') {
        // The URL goes in its own field so iOS unfurls the Open Graph card from
        // pawtchi.com instead of pasting a bare link. Same split as
        // app/invite.tsx, which is where this behaviour was worked out.
        await Share.share({ message, url: PAWTCHI_INVITE_URL });
      } else {
        await Share.share({ message: `${message} ${PAWTCHI_INVITE_URL}` });
      }
    } catch {
      // Dismissing the sheet is the normal case, not a failure.
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.nav}>
        <TouchableOpacity
          onPress={exit}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <MaterialIcons name="arrow-back" size={24} color={color.cream} />
        </TouchableOpacity>
      </View>

      {!loaded ? (
        <View style={styles.centred}>
          <BreathingPaw size={26} workingColor={color.cream} />
        </View>
      ) : !row ? (
        // Reachable only by typing the route, since Profile hides the row
        // without a code. Says the plain thing rather than pretending to load
        // forever.
        <View style={styles.centred}>
          <Text style={styles.body}>There is no creator code on this account.</Text>
        </View>
      ) : (
        <View style={styles.content}>
          <Animated.View entering={FadeInDown.duration(520)}>
            <Text style={styles.eyebrow}>{CREATOR_EYEBROW}</Text>
            <Text style={styles.headline}>{CREATOR_HEADLINE}</Text>
            <Text style={styles.body}>{CREATOR_SUBCOPY}</Text>
          </Animated.View>

          <Animated.View entering={FadeIn.duration(520).delay(140)} style={styles.codeCard}>
            {/* `selectable` is the copy affordance — long press, then Copy. It
                is the platform's own, and it saved adding a native clipboard
                module (and therefore a new build) for one button. */}
            <Text style={styles.code} selectable accessibilityLabel={`Your code, ${row.code}`}>
              {row.code}
            </Text>
            <Text style={styles.hint}>{CREATOR_HOLD_TO_COPY}</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(520).delay(220)} style={styles.stats}>
            <Text style={styles.count}>{creatorRedemptionLine(row.redemptionsGranted)}</Text>
            {!!row.compExpiresAt && (
              <Text style={styles.hint}>{creatorCompLine(row.compExpiresAt)}</Text>
            )}
            {!row.isActive && <Text style={styles.paused}>{CREATOR_INACTIVE_NOTE}</Text>}
          </Animated.View>
        </View>
      )}

      {!!row && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space.xl }]}>
          <TouchableOpacity
            style={[styles.cta, !row.isActive && styles.ctaDisabled]}
            onPress={share}
            disabled={!row.isActive}
            activeOpacity={0.88}
          >
            <Text style={styles.ctaText}>{CREATOR_SHARE_ACTION}</Text>
            <MaterialIcons name="arrow-forward" size={20} color={color.navy} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.navy,
  },
  nav: {
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
  },
  content: {
    flex: 1,
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
  },
  eyebrow: {
    fontFamily: font.bold,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: color.yellow,
    marginBottom: space.md,
  },
  headline: {
    ...displayLine(46),
    letterSpacing: 0.5,
    color: color.cream,
    marginBottom: space.lg,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 24,
    color: color.creamDim,
  },
  /** The code is the subject of this screen, so it gets the largest thing on it. */
  codeCard: {
    marginTop: space.xxxl,
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.yellow,
    backgroundColor: color.navyRaised,
    alignItems: 'center',
  },
  code: {
    fontFamily: font.extrabold,
    fontSize: 30,
    lineHeight: 38,
    // Wide tracking so it can be read back character by character — which is
    // exactly what a creator does before saying it to camera.
    letterSpacing: 6,
    color: color.yellow,
    textAlign: 'center',
  },
  hint: {
    marginTop: space.sm,
    fontFamily: font.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.creamFaint,
    textAlign: 'center',
  },
  stats: {
    marginTop: space.xxxl,
    alignItems: 'center',
  },
  count: {
    fontFamily: font.semibold,
    fontSize: 16,
    lineHeight: 24,
    color: color.cream,
    textAlign: 'center',
  },
  paused: {
    marginTop: space.lg,
    fontFamily: font.medium,
    fontSize: 13,
    lineHeight: 20,
    color: color.cream,
    textAlign: 'center',
  },
  bottomBar: {
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 58,
    borderRadius: radius.xl,
    backgroundColor: color.yellow,
  },
  ctaDisabled: {
    opacity: 0.4,
  },
  ctaText: {
    fontFamily: font.extrabold,
    fontSize: 16,
    color: color.navy,
  },
});
