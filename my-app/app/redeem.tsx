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
import Svg, { Path } from 'react-native-svg';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ZoomIn,
  cancelAnimation,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { color, displayLine, font, motion, radius, space } from '../constants/design';
import { TextField } from '../components/ui/TextField';
import { lassoPath } from '../components/BrandLasso';
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
  REDEEM_SUCCESS_BENEFITS,
  REDEEM_SUCCESS_CTA,
  REDEEM_SUCCESS_EYEBROW,
  REDEEM_SUCCESS_NOTE,
  REDEEM_SUCCESS_TITLE,
  REDEEM_WORKING_BODY,
  REDEEM_WORKING_TITLE,
  redeemFailureCopy,
  redeemSuccessBody,
} from '../lib/creatorCode/copy';
import type { RedeemOutcome } from '../lib/creatorCode/copy';

/**
 * The transition has a short minimum duration so a fast network response does
 * not turn it into a flash. RevenueCat then gets three fresh reads in the
 * background because promotional entitlements can take a moment to propagate.
 */
const MIN_WORKING_MS = 850;
const RECONCILE_DELAYS_MS = [0, 700, 1400] as const;

const wait = (duration: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, duration));

type Phase =
  | { kind: 'entry' }
  | { kind: 'working' }
  | { kind: 'failed'; outcome: RedeemOutcome; creatorName: string | null }
  | { kind: 'done'; creatorName: string | null; expiresAt: Date | null };

export default function RedeemScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPro, isPromoAccess, refresh, activatePromotionalAccess } = useSubscription();

  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'entry' });

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

  const exit = useCallback(() => {
    // Reached from the paywall footer and from Profile, and pushed both times —
    // but ask() rather than assume, because a deep link into this route would
    // have nothing to pop and the close button would silently do nothing.
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as never);
  }, [router]);

  const goToProfile = useCallback(() => {
    // Remove both full-screen redemption and the paywall modal beneath it,
    // while selecting Profile as the tab destination. Returning one level
    // would expose the paywall's already-covered screen as an unnecessary
    // second confirmation.
    router.dismissTo('/(tabs)/profile' as never);
  }, [router]);

  const normalised = normalizeCreatorCode(code);
  const canSubmit = isPlausibleCreatorCode(normalised) && phase.kind !== 'working';

  const submit = async () => {
    if (!canSubmit) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPhase({ kind: 'working' });
    track('creator_code_submitted');

    // Keep the transition visible long enough to read as intentional progress
    // when the network answers immediately.
    const [result] = await Promise.all([
      redeemCreatorCode(normalised),
      wait(MIN_WORKING_MS),
    ]);

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

    // The edge function's success response is the grant boundary. Reflect it
    // in the shared app state before showing success so Profile and every gate
    // change in the same render, then reconcile RevenueCat in the background.
    if (result.expiresAt) activatePromotionalAccess(result.expiresAt);

    void (async () => {
      for (const delay of RECONCILE_DELAYS_MS) {
        if (delay) await wait(delay);
        const settled = await refresh({ invalidateCache: true, preserveAccessOnMiss: true });
        if (settled) return;
      }
    })();

    setPhase({ kind: 'done', creatorName: result.creatorName, expiresAt: result.expiresAt });
  };

  // ─── Already covered ───
  // Both a real subscriber and someone mid-way through granted access. Neither
  // can redeem, and both deserve to be told why rather than watching a code
  // they were given fail against a rule they cannot see.
  //
  // Gated on the phase, not just on `isPro`. A successful redemption activates
  // the shared subscription state before the done screen renders; the phase
  // guard prevents that new state from replacing the celebration with an
  // already-redeemed message.
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
        <Nav onClose={goToProfile} />
        <SuccessContent creatorName={phase.creatorName} expiresAt={phase.expiresAt} />
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space.xl }]}>
          <TouchableOpacity style={styles.cta} onPress={goToProfile} activeOpacity={0.88}>
            <Text style={styles.ctaText}>{REDEEM_SUCCESS_CTA}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (phase.kind === 'working') {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <Nav onClose={exit} />
        <WorkingContent />
      </View>
    );
  }

  // ─── Entry ───
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      <View style={{ paddingTop: insets.top }}>
        <Nav onClose={exit} />
      </View>

      {/* `style={flex:1}` is not decoration. Without it a ScrollView in a flex
          column sizes to its CONTENT rather than to the space left over, so it
          never scrolls: everything past the fold is clipped and the CTA bar
          below is pushed off-screen. With a 46pt display headline above it, the
          field itself was the thing that fell off the bottom — the screen
          opened, the impression fired, and there was no input to tap. */}
      <ScrollView
        style={styles.scrollView}
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
            editable
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
          <Text style={styles.ctaText}>{REDEEM_CTA}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function WorkingContent() {
  return (
    <View style={styles.workingContent} accessibilityLiveRegion="polite">
      <Animated.View entering={FadeInDown.duration(motion.duration.base).delay(80)}>
        <Text style={styles.workingTitle}>{REDEEM_WORKING_TITLE}</Text>
        <Text style={styles.workingBody}>{REDEEM_WORKING_BODY}</Text>
        <LassoJourney mode="working" />
        <View style={styles.workingPill}>
          <View style={styles.workingPillDot} />
          <Text style={styles.workingPillText}>{REDEEM_CTA_WORKING}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const LASSO_LENGTH = 430;
const LASSO_D = lassoPath(320, 120, 38);

function LassoJourney({ mode }: { mode: 'working' | 'complete' }) {
  const reducedMotion = useReducedMotion();
  const dashOffset = useSharedValue(mode === 'complete' ? LASSO_LENGTH : 0);

  useEffect(() => {
    if (reducedMotion) {
      dashOffset.value = mode === 'complete' ? 0 : -145;
      return;
    }

    if (mode === 'complete') {
      dashOffset.value = withTiming(0, {
        duration: motion.duration.ring,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      dashOffset.value = withRepeat(
        withTiming(-LASSO_LENGTH, { duration: 1450, easing: Easing.linear }),
        -1,
        false,
      );
    }
    return () => cancelAnimation(dashOffset);
  }, [dashOffset, mode, reducedMotion]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));

  return (
    <Animated.View
      entering={FadeIn.duration(motion.duration.base)}
      style={[styles.lassoStage, mode === 'complete' && styles.lassoStageComplete]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 320 120">
        <Path
          d={LASSO_D}
          fill="none"
          stroke={color.yellow}
          strokeOpacity={mode === 'working' ? 0.14 : 0.18}
          strokeWidth={mode === 'working' ? 2 : 7}
          strokeLinecap="round"
        />
        <AnimatedPath
          animatedProps={animatedProps}
          d={LASSO_D}
          fill="none"
          stroke={color.yellow}
          strokeWidth={mode === 'complete' ? 5 : 6}
          strokeLinecap="round"
          strokeDasharray={mode === 'complete' ? `${LASSO_LENGTH} ${LASSO_LENGTH}` : '92 338'}
        />
      </Svg>
      {mode === 'complete' && (
        <Animated.View entering={ZoomIn.delay(650).duration(motion.duration.fast)} style={styles.lassoCheck}>
          <MaterialIcons name="check" size={16} color={color.navy} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

const BENEFIT_ICONS = ['document-scanner', 'favorite', 'directions-walk', 'notifications'] as const;

function SuccessContent({
  creatorName,
  expiresAt,
}: {
  creatorName: string | null;
  expiresAt: Date | null;
}) {
  return (
    <ScrollView
      style={styles.successScroll}
      contentContainerStyle={styles.successContent}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View entering={FadeInDown.duration(motion.duration.base).delay(80)}>
        <Text style={[styles.eyebrow, styles.successEyebrow]}>{REDEEM_SUCCESS_EYEBROW}</Text>
        <Text style={[styles.headline, styles.successHeadline]}>{REDEEM_SUCCESS_TITLE}</Text>
        <LassoJourney mode="complete" />
        {!!expiresAt && (
          <Text style={[styles.body, styles.successBody]}>
            {redeemSuccessBody(creatorName, expiresAt)}
          </Text>
        )}
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(motion.duration.base).delay(140)} style={styles.accessCard}>
        <View style={styles.accessCardTop}>
          <Text style={styles.accessMonths}>3</Text>
          <View>
            <Text style={styles.accessLabel}>MONTHS INCLUDED</Text>
            <Text style={styles.accessPlan}>Pawtchi Plus</Text>
          </View>
        </View>
        <View style={styles.accessRule} />
        <View style={styles.benefitsGrid}>
          {REDEEM_SUCCESS_BENEFITS.map((benefit, index) => (
            <View key={benefit} style={styles.benefit}>
              <View style={styles.benefitIcon}>
                <MaterialIcons name={BENEFIT_ICONS[index]} size={17} color={color.yellow} />
              </View>
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={FadeIn.duration(motion.duration.base).delay(220)} style={styles.successNoteRow}>
        <MaterialIcons name="verified-user" size={16} color={color.creamFaint} />
        <Text style={styles.successNote}>{REDEEM_SUCCESS_NOTE}</Text>
      </Animated.View>
    </ScrollView>
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
  /** Bounds the scroller to the space between the nav and the CTA bar. */
  scrollView: {
    flex: 1,
  },
  scroll: {
    // flexGrow, not flex: the content must be allowed to exceed the viewport on
    // a small screen (that is the whole point of scrolling) while still filling
    // it when it is shorter.
    flexGrow: 1,
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
    //
    // 38 rather than the 46 this started at, and than app/creator.tsx uses. This
    // screen has one job and one interactive element, so the headline competing
    // for vertical space with the field is a straight loss: the point is to be
    // able to type a code without scrolling to find where.
    ...displayLine(38),
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
    marginTop: space.xxl,
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
  workingContent: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    paddingBottom: 72,
  },
  workingTitle: {
    ...displayLine(38),
    textAlign: 'center',
    letterSpacing: 0.5,
    color: color.cream,
    marginBottom: space.md,
  },
  workingBody: {
    alignSelf: 'center',
    maxWidth: 310,
    fontFamily: font.regular,
    fontSize: 14.5,
    lineHeight: 22,
    textAlign: 'center',
    color: color.creamDim,
  },
  lassoStage: {
    position: 'relative',
    width: '100%',
    height: 150,
    alignSelf: 'center',
    marginTop: space.xxl,
  },
  lassoStageComplete: {
    height: 96,
    marginTop: 0,
    marginBottom: space.sm,
  },
  lassoCheck: {
    position: 'absolute',
    right: 0,
    top: 43,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.cream,
    borderWidth: 3,
    borderColor: color.navy,
  },
  workingPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.yellowSoft,
  },
  workingPillDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
  },
  workingPillText: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.cream,
  },
  successScroll: {
    flex: 1,
  },
  successContent: {
    alignItems: 'center',
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    paddingBottom: space.xl,
  },
  successEyebrow: {
    textAlign: 'center',
    marginBottom: space.sm,
  },
  successHeadline: {
    textAlign: 'center',
    fontSize: 42,
    lineHeight: 51,
    marginBottom: space.md,
  },
  successBody: {
    maxWidth: 340,
    textAlign: 'center',
  },
  accessCard: {
    width: '100%',
    marginTop: space.xl,
    padding: space.xl,
    borderRadius: radius.xxl,
    backgroundColor: color.navyRaised,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
  },
  accessCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  accessMonths: {
    ...displayLine(54),
    color: color.yellow,
  },
  accessLabel: {
    fontFamily: font.bold,
    fontSize: 11,
    letterSpacing: 1.6,
    color: color.yellow,
  },
  accessPlan: {
    marginTop: 2,
    fontFamily: font.semibold,
    fontSize: 17,
    color: color.cream,
  },
  accessRule: {
    height: 1,
    marginVertical: space.lg,
    backgroundColor: color.hairlineOnNavy,
  },
  benefitsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: space.md,
  },
  benefit: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  benefitIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.yellowSoft,
  },
  benefitText: {
    flex: 1,
    paddingRight: space.sm,
    fontFamily: font.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.cream,
  },
  successNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
  },
  successNote: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.creamFaint,
  },
});
