/**
 * The redeem screen — where a creator's audience turns a code into three months.
 *
 * One field, one button, nine outcomes. Every string comes from
 * lib/creatorCode/copy.ts so the brand voice and the two store-compliance rules
 * (never "promo code", never a price) are asserted in a unit test rather than
 * reviewed by eye.
 *
 * ── Two decisions worth naming ──────────────────────────────────────────────
 *
 * The field does NOT autofocus. Nothing here is urgent enough to open a
 * keyboard over a screen someone has not read yet, and a keyboard covering the
 * sentence that explains what a creator code is would be exactly backwards.
 *
 * The screen is reachable while already subscribed, and says so rather than
 * hiding the entry point. Someone who subscribed last week and then heard their
 * favourite creator's code will come looking; a route that silently refuses to
 * exist is how that becomes a support ticket.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { color, displayLine, font, radius, space } from '../constants/design';
import { TextField } from '../components/ui/TextField';
import { BreathingPaw } from '../components/BreathingPaw';
import { useSubscription } from '../providers/SubscriptionProvider';
import { track } from '../lib/analytics';
import { redeemCreatorCode } from '../lib/creatorCode/client';
import {
  CREATOR_CODE_MAX_LENGTH,
  isPlausibleCreatorCode,
  normalizeCreatorCode,
} from '../lib/creatorCode/normalize';
import {
  REDEEM_CTA,
  REDEEM_CTA_WORKING,
  REDEEM_EYEBROW,
  REDEEM_FIELD_LABEL,
  REDEEM_FIELD_PLACEHOLDER,
  REDEEM_HEADLINE,
  REDEEM_REASSURANCE,
  REDEEM_SUBCOPY,
  REDEEM_SUCCESS_CTA,
  REDEEM_SUCCESS_TITLE,
  redeemFailureCopy,
  redeemSuccessBody,
} from '../lib/creatorCode/copy';
import type { RedeemOutcome } from '../lib/creatorCode/copy';

/**
 * RevenueCat writes the entitlement before it answers, so the refresh that
 * follows almost always sees it. Almost: propagation is not contractually
 * instant, and a person who just typed a code correctly must not be shown a
 * screen that behaves as though nothing happened. One retry, once.
 */
const ENTITLEMENT_SETTLE_MS = 1500;

type Phase =
  | { kind: 'entry' }
  | { kind: 'working' }
  | { kind: 'failed'; outcome: RedeemOutcome; creatorName: string | null }
  | { kind: 'done'; creatorName: string | null; expiresAt: Date | null };

export default function RedeemScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPro, isPromoAccess, refresh } = useSubscription();

  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'entry' });
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Fires the impression once per visit, not once per mount.
   *
   * A bare `useEffect(..., [])` double-fired in a real dev build — twice in the
   * logs, with no StrictMode anywhere in the app to explain it away. This event
   * is the top of the creator-code funnel, so counting it twice halves the
   * apparent redemption rate: the number that decides whether a collaboration
   * gets renewed would say the audience ignored the code.
   *
   * Same ref guard as `membershipImpressionRef` in app/(tabs)/profile.tsx,
   * which exists for exactly this reason.
   */
  const impressionRef = useRef(false);
  useEffect(() => {
    if (impressionRef.current) return;
    impressionRef.current = true;
    track('creator_code_screen_viewed', { already_pro: isPro });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const exit = useCallback(() => {
    // Reached from the paywall footer and from Profile, and pushed both times —
    // but ask() rather than assume, because a deep link into this route would
    // have nothing to pop and the close button would silently do nothing.
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as never);
  }, [router]);

  const normalised = normalizeCreatorCode(code);
  const canSubmit = isPlausibleCreatorCode(normalised) && phase.kind !== 'working';

  const submit = async () => {
    if (!canSubmit) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPhase({ kind: 'working' });
    track('creator_code_submitted');

    const result = await redeemCreatorCode(normalised);

    if (!result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      track(
        result.outcome === 'failed' ? 'creator_code_failed' : 'creator_code_rejected',
        { reason: result.outcome },
      );
      setPhase({ kind: 'failed', outcome: result.outcome, creatorName: result.creatorName });
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    track('creator_code_redeemed');

    // The grant is already live server-side; this pulls it into the app's own
    // state so every gated screen opens by the time the person taps through.
    await refresh();
    settleTimer.current = setTimeout(() => {
      refresh();
    }, ENTITLEMENT_SETTLE_MS);

    setPhase({ kind: 'done', creatorName: result.creatorName, expiresAt: result.expiresAt });
  };

  // ─── Already covered ───
  // Both a real subscriber and someone mid-way through granted access. Neither
  // can redeem, and both deserve to be told why rather than watching a code
  // they were given fail against a rule they cannot see.
  //
  // Gated on the phase, not just on `isPro`, and that is not defensive noise.
  // A successful redemption calls refresh() — which flips `isPro` true — before
  // the phase moves to 'done'. On the plain `isPro` check, React re-renders in
  // that gap and the happy path flashes "you have already used a creator code"
  // at the one person who just used one correctly.
  if (isPro && (phase.kind === 'entry' || phase.kind === 'failed')) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <Nav onClose={exit} />
        <View style={styles.centred}>
          <Text style={styles.eyebrow}>{REDEEM_EYEBROW}</Text>
          <Text style={styles.body}>
            {isPromoAccess
              ? redeemFailureCopy('already_redeemed')
              : redeemFailureCopy('ever_subscribed')}
          </Text>
        </View>
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space.xl }]}>
          <TouchableOpacity style={styles.cta} onPress={exit} activeOpacity={0.88}>
            <Text style={styles.ctaText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Redeemed ───
  if (phase.kind === 'done') {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <Nav onClose={exit} />
        <View style={styles.centred}>
          <Animated.View entering={FadeIn.duration(420)} style={styles.settledMark}>
            <BreathingPaw settled size={30} />
          </Animated.View>
          <Animated.View entering={FadeInDown.duration(520).delay(120)}>
            <Text style={styles.headline}>{REDEEM_SUCCESS_TITLE}</Text>
            {!!phase.expiresAt && (
              <Text style={styles.body}>
                {redeemSuccessBody(phase.creatorName, phase.expiresAt)}
              </Text>
            )}
          </Animated.View>
        </View>
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space.xl }]}>
          <TouchableOpacity style={styles.cta} onPress={exit} activeOpacity={0.88}>
            <Text style={styles.ctaText}>{REDEEM_SUCCESS_CTA}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Entry ───
  const working = phase.kind === 'working';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      <View style={{ paddingTop: insets.top }}>
        <Nav onClose={exit} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(520)}>
          <Text style={styles.eyebrow}>{REDEEM_EYEBROW}</Text>
          <Text style={styles.headline}>{REDEEM_HEADLINE}</Text>
          <Text style={styles.body}>{REDEEM_SUBCOPY}</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(520).delay(120)} style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>{REDEEM_FIELD_LABEL}</Text>
          <TextField
            value={code}
            // Normalised as they type, so the field always shows the canonical
            // form. Someone typing what they heard gets it corrected in front of
            // them rather than rejected after they commit.
            onChangeText={next => {
              setCode(normalizeCreatorCode(next));
              if (phase.kind === 'failed') setPhase({ kind: 'entry' });
            }}
            placeholder={REDEEM_FIELD_PLACEHOLDER}
            placeholderTextColor={color.creamFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
            // Deliberately absent: autoFocus. See the module note.
            maxLength={CREATOR_CODE_MAX_LENGTH}
            returnKeyType="go"
            onSubmitEditing={submit}
            editable={!working}
            error={phase.kind === 'failed'}
            containerStyle={styles.field}
            inputStyle={styles.fieldInput}
          />
          <Text style={styles.reassurance}>{REDEEM_REASSURANCE}</Text>

          {phase.kind === 'failed' && (
            <Animated.Text entering={FadeIn.duration(240)} style={styles.error}>
              {redeemFailureCopy(phase.outcome, phase.creatorName)}
            </Animated.Text>
          )}
        </Animated.View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space.xl }]}>
        <TouchableOpacity
          style={[styles.cta, !canSubmit && styles.ctaDisabled]}
          onPress={submit}
          disabled={!canSubmit}
          activeOpacity={0.88}
        >
          {working && <BreathingPaw size={18} />}
          <Text style={styles.ctaText}>{working ? REDEEM_CTA_WORKING : REDEEM_CTA}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function Nav({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.nav}>
      <TouchableOpacity
        onPress={onClose}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <MaterialIcons name="close" size={24} color={color.cream} />
      </TouchableOpacity>
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
  scroll: {
    paddingHorizontal: space.xxl,
    paddingTop: space.xxl,
    paddingBottom: space.xxxl,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
  },
  settledMark: {
    marginBottom: space.xxl,
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
    // displayLine carries the family, the size and the 1.2 line-height ratio
    // Bebas needs to clear its ascenders. Never hand-write a lineHeight here.
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
  fieldBlock: {
    marginTop: space.xxxl,
  },
  fieldLabel: {
    fontFamily: font.semibold,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: color.creamFaint,
    marginBottom: space.sm,
  },
  field: {
    backgroundColor: color.navyRaised,
    borderColor: color.hairlineOnNavy,
  },
  fieldInput: {
    fontFamily: font.bold,
    // Wider than body type: a code is read back character by character to check
    // it, and tracking is what makes that possible at a glance.
    letterSpacing: 3,
    color: color.cream,
  },
  reassurance: {
    marginTop: space.md,
    fontFamily: font.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.creamFaint,
  },
  error: {
    marginTop: space.lg,
    fontFamily: font.medium,
    fontSize: 13.5,
    lineHeight: 20,
    color: color.cream,
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
