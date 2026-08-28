import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Share, TouchableOpacity, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  completionReturnPath,
  isCompletionMode,
} from '../../lib/onboarding/completionMode';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  FadeIn, FadeInDown, FadeInUp, FadeOut,
  useSharedValue, useAnimatedStyle, withSequence, withTiming,
} from 'react-native-reanimated';

import { color, displayLine, font, radius, space, motion } from '../../constants/design';
import { PawtchiButton } from '../../components/PawtchiButton';
import { PortionPlateCard } from '../../components/PortionPlateCard';
import { WatchOutsCard } from '../../components/WatchOutsCard';
import { CountUpText } from '../../components/CountUpText';
import { WeightJourneyBar } from '../../components/WeightJourneyBar';
import { usePetStore } from '../../store/usePetStore';
import { useActivePetStore } from '../../store/useActivePetStore';
import { haptic } from '../../lib/haptics';
import { PAWTCHI_INVITE_URL } from '../../lib/referral';
import { track } from '../../lib/analytics';
import { derivePortionPlan } from '../../lib/portionMath';
import { getBreedWatchOuts } from '../../lib/breedWatchOuts';
import { getBreedDefaults, sizeCategoryFromWeight } from '../../lib/breedData';
import { deriveLifeStage, getLifeStageCalorieMultiplier } from '../../lib/lifeStage';
import { deriveGoal } from '../../lib/healthMath';
import { deriveKcalReceipt } from '../../lib/kcalReceipt';
import { stageCount } from '../../lib/idealWeight';
import { SAFE_PCT_PER_WEEK } from '../../lib/weightLossRate';
import { WalksignCrest } from '../../components/walksign/WalksignCrest';
import { WALKSIGN_COPY, buildProvisionalNote, buildRevealTitle } from '../../lib/walksign/copy';
import type { WalksignId } from '../../lib/walksign/types';
import { useSubscription } from '../../hooks/useSubscription';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useNotificationPermission } from '../../hooks/useNotificationPermission';
import { NotificationPrimer } from '../../components/NotificationPrimer';

// The reveal — the missing climax. The whole onboarding exists to compute one
// magic number: the daily calorie plan. Old flow ran calculateDailyKcal
// invisibly in handleComplete and routed away. The user never saw the thing
// they invested 6 steps to receive.
//
// Three psychological levers do real work here:
//  1. Labour illusion — a ~1.6s "Building Bunny's plan…" beat. Perceived effort
//     increases perceived value (the Harvard Norton/Mochon study replicated in
//     onboarding many times over).
//  2. Explanation effect — the receipt card itemizes the ACTUAL factor chain
//     from calculateDailyKcal (basal need → routine → breed → life stage →
//     safety floors). Stated reasons dramatically increase trust and
//     compliance; the labour beat pays off into visible evidence.
//  3. Reciprocity — by handing the user a personalized deliverable BEFORE the
//     paywall, we shift their stance from "is this worth paying for?" to
//     "they already gave me something tailored to my pet."
//
// The numbers come from the pet store (stashed by goal.tsx) — no re-fetch.
//
// The build beat is a sequential checklist, not a loop — each phase appears,
// completes, and stays completed. Loops read as fake; sequences read as work.
const BUILD_PHASES = [
  'Reading the breed file',
  'Tuning for life stage',
  'Sizing the daily plate',
  'Plotting movement targets',
];
// Dogs get one more beat — the Walksign's first reading rides the same
// labour-illusion sequence rather than adding a second loading moment.
const WALKSIGN_PHASE = 'Reading the first signs';
const PHASE_MS = 400;

export default function RevealScreen() {
  const router = useRouter();
  const completionParams = useLocalSearchParams<{ mode?: string; feature?: string }>();
  const completing = isCompletionMode(completionParams);
  const notifPermission = useNotificationPermission();
  const insets = useSafeAreaInsets();
  const { isPro } = useSubscription();
  const { requestPermission } = usePushNotifications();
  const [primerVisible, setPrimerVisible] = useState(false);

  const {
    name, breed, species, weight, ageYears, ageMonths, bodyConditionScore,
    isNeutered, activityLevel, reproductiveStatus, pregnancyWeeks,
    targetWeightKg, dailyKcal, lifeStageLabel,
    idealWeightKg, healthyBandLow, healthyBandHigh,
    resetForm,
  } = usePetStore();
  const activePet = useActivePetStore(s => s.activePet);
  const petName = name?.trim() || activePet?.name?.trim() || 'your pet';

  // The provisional Walksign, stamped on the pet row at creation (dogs only).
  // fetchPet ran before navigation, so it's already in the store — no fetch.
  const walksignId: WalksignId | null =
    activePet?.species === 'dog' && activePet?.walksign
      ? (activePet.walksign as WalksignId)
      : null;
  const buildPhases = walksignId ? [...BUILD_PHASES, WALKSIGN_PHASE] : BUILD_PHASES;
  const revealDelayMs = PHASE_MS * buildPhases.length + 200;

  // ── Personalised insights, derived on-device (no fetch, no cost) ──
  const weightKg = parseFloat(weight) || activePet?.current_weight_kg || 0;
  const speciesVal = species === 'cat' ? 'cat' : 'dog';
  const breedDefaults = getBreedDefaults(speciesVal, breed, weightKg);
  const sizeCategory = breedDefaults?.sizeCategory ?? sizeCategoryFromWeight(speciesVal, weightKg);
  const lifeStage = deriveLifeStage(speciesVal, parseInt(ageYears) || 0, parseInt(ageMonths) || 0, sizeCategory);
  const portionGoal = deriveGoal(weightKg, targetWeightKg ?? null, bodyConditionScore);
  const portion = dailyKcal ? derivePortionPlan({ dailyKcal, currentWeightKg: weightKg, goal: portionGoal }) : null;
  const watchOuts = getBreedWatchOuts({
    species: speciesVal,
    breed,
    sizeCategory,
    lifeStage,
    bcs: bodyConditionScore,
    weightVsTargetKg: targetWeightKg != null && weightKg > 0 ? weightKg - targetWeightKg : null,
    currentWeightKg: weightKg > 0 ? weightKg : null,
  });

  const frameLabel =
    breed && breed !== 'Mixed Breed' && breed !== 'Mixed Breed / Domestic Shorthair' && breed !== 'Other'
      ? breed
      : speciesVal === 'cat' ? 'cat' : 'dog';
  const breedName = frameLabel === breed ? breed : null;

  // ── The receipt: re-walk the kcal factor chain with the same inputs
  // goal.tsx fed to calculateDailyKcal. Guarded — if the receipt total drifts
  // from the stored plan number, we hide the math rather than show a
  // contradiction. ──
  const totalAgeMonths = (parseInt(ageYears) || 0) * 12 + (parseInt(ageMonths) || 0);
  const lifeStageMultiplier = getLifeStageCalorieMultiplier(lifeStage, speciesVal);
  const receipt = useMemo(() => {
    if (dailyKcal == null || weightKg <= 0) return null;
    return deriveKcalReceipt({
      species: speciesVal,
      weightKg,
      targetWeightKg,
      isNeutered,
      activityLevel: activityLevel || 'normal',
      goal: portionGoal,
      ageMonths: totalAgeMonths || undefined,
      lifeStageMultiplier,
      lifeStageLabel,
      metabolicModifier: breedDefaults?.metabolicModifier ?? 1.0,
      breedName,
      bcs: bodyConditionScore,
      reproductiveStatus,
      pregnancyWeeks,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyKcal, weightKg, speciesVal, targetWeightKg, isNeutered, activityLevel, portionGoal, totalAgeMonths, lifeStageMultiplier, lifeStageLabel, breedName, bodyConditionScore, reproductiveStatus, pregnancyWeeks]);
  const receiptOk = receipt != null && dailyKcal != null && receipt.totalKcal === dailyKcal;
  useEffect(() => {
    if (receipt != null && dailyKcal != null && receipt.totalKcal !== dailyKcal) {
      track('plan_receipt_mismatch', { receipt_total: receipt.totalKcal, plan_kcal: dailyKcal });
    }
  }, [receipt, dailyKcal]);

  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const expandTracked = useRef<Set<string>>(new Set());
  const toggleRow = (id: string) => {
    haptic.tap();
    setExpandedRow((cur) => (cur === id ? null : id));
    if (!expandTracked.current.has(id)) {
      expandTracked.current.add(id);
      track('plan_receipt_row_expanded', { row: id });
    }
  };

  // ── Journey continuity: the same map the user set on the goal step. ──
  const band = healthyBandLow != null && healthyBandHigh != null
    ? { low: healthyBandLow, high: healthyBandHigh }
    : null;
  const showJourney = idealWeightKg != null && targetWeightKg != null && weightKg > 0;
  const journeyAtIdeal = showJourney
    && Math.abs(idealWeightKg - weightKg) < 0.05
    && Math.abs(targetWeightKg - weightKg) < 0.05;
  const milestoneIsStop = showJourney
    && Math.abs(targetWeightKg - idealWeightKg) >= 0.1
    && Math.abs(targetWeightKg - weightKg) >= 0.05;
  const totalStages = showJourney ? stageCount(weightKg, idealWeightKg) : 1;
  const milestoneWeeks = showJourney && Math.abs(targetWeightKg - weightKg) >= 0.05
    ? Math.ceil((Math.abs(targetWeightKg - weightKg) / weightKg) * 100 / SAFE_PCT_PER_WEEK[speciesVal])
    : 0;

  const scrolledTracked = useRef(false);
  const insightsTracked = useRef(false);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    if (!scrolledTracked.current && y > 40) {
      scrolledTracked.current = true;
      track('plan_reveal_scrolled', {});
    }
    if (!insightsTracked.current && y > 200) {
      insightsTracked.current = true;
      track('plan_reveal_insight_viewed', { type: 'portion' });
      if (watchOuts.length > 0) track('plan_reveal_insight_viewed', { type: 'watch_outs' });
    }
  };

  const [building, setBuilding] = useState(true);
  // Number of completed phases; the row at this index is the one in progress.
  const [phaseCount, setPhaseCount] = useState(0);

  useEffect(() => {
    track('plan_reveal_viewed', {
      daily_kcal: dailyKcal ?? null,
      target_weight_kg: targetWeightKg ?? null,
    });
    const interval = setInterval(() => {
      setPhaseCount((c) => Math.min(c + 1, buildPhases.length));
    }, PHASE_MS);
    const t = setTimeout(() => {
      clearInterval(interval);
      setBuilding(false);
    }, revealDelayMs);
    return () => { clearInterval(interval); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyKcal, targetWeightKg]);

  // The identity beat has its own view event — the plan and the sign are
  // different gifts.
  useEffect(() => {
    if (!building && walksignId) {
      track('walksign_reveal_viewed', { sign: walksignId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building]);

  // Glow bloom behind the hero number — fires once, when the count-up lands.
  const glowOpacity = useSharedValue(0);
  const glowScale = useSharedValue(0.85);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));
  const handleCountDone = () => {
    haptic.success();
    glowOpacity.value = withSequence(
      withTiming(1, { duration: motion.duration.fast }),
      withTiming(0, { duration: motion.duration.ring }),
    );
    glowScale.value = withSequence(
      withTiming(1.1, { duration: motion.duration.fast }),
      withTiming(1.3, { duration: motion.duration.ring }),
    );
  };

  const handleShare = async () => {
    track('plan_reveal_shared', {});
    // Journey framing shares better than a bare number — the story is the artifact.
    const journeyPart = showJourney && !journeyAtIdeal
      ? `, on the way from ${weightKg.toFixed(1)} to ${idealWeightKg.toFixed(1)} kg in safe stages`
      : targetWeightKg ? `, aiming for ${targetWeightKg.toFixed(1)} kg` : '';
    const summary = `${petName}'s daily plan on Pawtchi: ${dailyKcal} kcal a day${journeyPart}.`;
    try {
      await Share.share({ message: `${summary} ${PAWTCHI_INVITE_URL}` });
    } catch {
      // User dismissed the sheet or sharing is unavailable — nothing to do.
    }
  };

  // Leaving the reveal is the single best moment to ask for notifications:
  // the owner has just seen the plan Pawtchi built for their animal, so the
  // ask has something concrete behind it. Previously the OS prompt fired on
  // the first authed frame with no context at all, and opt-in sat at 9%.
  const finishReveal = () => {
    resetForm();
    // Onboarding lands on Home; a health-profile completion lands back on the
    // feature that asked for the data, so the owner arrives at the thing they
    // were originally trying to do rather than being dropped at the map.
    //
    // The paywall fires either way. It was never tied to onboarding — it is
    // tied to having just been shown a personalised plan, which is exactly what
    // both paths have in common.
    router.replace(
      (completing ? completionReturnPath(completionParams.feature) : '/(tabs)') as never,
    );
    if (!isPro) {
      setTimeout(() => router.push('/paywall' as any), 120);
    }
  };

  const handleContinue = () => {
    track('plan_reveal_continued', {});
    // Only ask when asking can still achieve something.
    //
    // This screen used to be reachable only by a brand-new account, so an
    // unconditional primer was always a first ask. It is now also the end of
    // the health-completion flow, which existing owners reach — and showing
    // someone who already granted notifications a card asking them to turn
    // notifications on reads as a broken app. `canAsk` is false once the OS
    // prompt has been spent, in either direction.
    if (notifPermission.status === 'loading' || notifPermission.isGranted || !notifPermission.canAsk) {
      finishReveal();
      return;
    }
    setPrimerVisible(true);
  };

  const handlePrimerAccept = async () => {
    setPrimerVisible(false);
    // Failure here must never block the funnel — a denied prompt, a simulator,
    // or a network error all just mean no token yet.
    try {
      await requestPermission();
    } catch {
      // Nothing to do; the owner can enable notifications from Profile later.
    }
    finishReveal();
  };

  const handlePrimerDecline = () => {
    setPrimerVisible(false);
    // The OS prompt was never fired, so we can ask again from Profile.
    finishReveal();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + space.lg }]}>
      <StatusBar style="light" />

      {building ? (
        // Phase 1 — labour evidence: each build step appears, completes, stays.
        <Animated.View
          key="building"
          entering={FadeIn.duration(400)}
          exiting={FadeOut.duration(motion.duration.base)}
          style={styles.buildingWrap}
        >
          <Text style={styles.buildingTitle}>
            Building {petName}&apos;s{'\n'}plan…
          </Text>
          <View style={[styles.phaseList, { minHeight: buildPhases.length * 32 }]}>
            {buildPhases.map((phase, i) => {
              if (i > phaseCount) return null;
              const done = i < phaseCount;
              return (
                <Animated.View key={phase} entering={FadeInDown.duration(280)} style={styles.phaseRow}>
                  {done ? (
                    <MaterialIcons name="check" size={16} color={color.yellow} />
                  ) : (
                    <View style={styles.phaseDot} />
                  )}
                  <Text style={[styles.phaseText, done && styles.phaseTextDone]}>{phase}</Text>
                </Animated.View>
              );
            })}
          </View>
        </Animated.View>
      ) : (
        // Phase 2 — the reveal. Consultation arc: verdict → reasoning →
        // journey → what happens next → tonight's actions.
        <>
          <ScrollView
            style={styles.revealScroll}
            contentContainerStyle={[styles.revealContent, { paddingBottom: insets.bottom + 96 }]}
            showsVerticalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={64}
          >
            <Animated.View entering={FadeInDown.duration(500)}>
              <Text style={styles.eyebrow}>{petName.toUpperCase()}&apos;S DAILY PLAN</Text>
            </Animated.View>

            <Animated.View entering={FadeInUp.duration(600).delay(120)} style={styles.heroBlock}>
              {/* The number six screens existed to compute — earned on screen,
                  not printed. Ticks under the thumb, blooms when it lands. */}
              <Animated.View pointerEvents="none" style={[styles.heroGlow, glowStyle]} />
              <View style={styles.heroRow}>
                {dailyKcal != null ? (
                  <CountUpText
                    value={dailyKcal}
                    duration={motion.duration.ring}
                    delay={motion.duration.base}
                    style={styles.heroNumber}
                    hapticTicks
                    onDone={handleCountDone}
                  />
                ) : (
                  <Text style={styles.heroNumber}>—</Text>
                )}
                <Text style={styles.heroUnitText}>kcal</Text>
              </View>
              <Text style={styles.heroSub}>
                a day — built from what you told us about {petName}
              </Text>
            </Animated.View>

            {/* The receipt — the labour beat pays off into evidence. Each row
                is one factor from the ACTUAL math, expandable to one calm
                sentence of veterinary reasoning. */}
            {receiptOk && receipt && (
              <Animated.View entering={FadeInDown.duration(500).delay(240)} style={styles.panelCard}>
                <Text style={styles.cardLabel}>THE MATH, SHOWN</Text>
                {receipt.rows.map((row, i) => (
                  <Animated.View key={row.id} entering={FadeInDown.duration(360).delay(320 + i * 90)}>
                    <TouchableOpacity
                      style={[styles.receiptRow, i > 0 && styles.receiptRowBorder]}
                      activeOpacity={0.7}
                      onPress={() => toggleRow(row.id)}
                    >
                      <MaterialIcons
                        name={row.icon as any}
                        size={16}
                        color={row.kind === 'safety' ? color.viz.green : color.creamDim}
                        style={styles.receiptIcon}
                      />
                      <View style={styles.receiptBody}>
                        <Text style={styles.receiptTitle}>{row.title}</Text>
                        <Text style={styles.receiptSub}>{row.subtitle}</Text>
                      </View>
                      {row.effect === '✓' ? (
                        <MaterialIcons name="check" size={16} color={color.viz.green} />
                      ) : (
                        <Text style={styles.receiptEffect}>{row.effect}</Text>
                      )}
                    </TouchableOpacity>
                    {expandedRow === row.id && (
                      <Animated.View entering={FadeIn.duration(motion.duration.fast)}>
                        <Text style={styles.receiptDetail}>{row.detail}</Text>
                      </Animated.View>
                    )}
                  </Animated.View>
                ))}
                <View style={styles.receiptTotalRow}>
                  <Text style={styles.receiptTotalLabel}>{petName}&apos;s daily target</Text>
                  <Text style={styles.receiptTotalValue}>{dailyKcal!.toLocaleString()} kcal</Text>
                </View>
              </Animated.View>
            )}

            {/* The Walksign — the identity beat. The plan is what Pawtchi
                computed; this is who Pawtchi met. Honest provisional framing:
                the sign is a first reading until real walks confirm it. */}
            {walksignId && (
              <Animated.View entering={FadeInDown.duration(500).delay(360)} style={[styles.panelCard, styles.walksignCard]}>
                <Text style={styles.cardLabel}>{buildRevealTitle(petName).toUpperCase()}</Text>
                <View style={styles.walksignCrestWrap}>
                  <WalksignCrest sign={walksignId} size={96} color={color.cream} />
                </View>
                <Text style={styles.walksignName}>{WALKSIGN_COPY[walksignId].displayName}</Text>
                <Text style={styles.walksignTagline}>{WALKSIGN_COPY[walksignId].tagline}</Text>
                <Text style={styles.walksignNote}>{buildProvisionalNote(petName)}</Text>
              </Animated.View>
            )}

            {/* Journey continuity — the same map from the goal step, so the
                promise and the tracking share one visual language. */}
            {showJourney && (
              <Animated.View entering={FadeInDown.duration(500).delay(420)} style={styles.panelCard}>
                <Text style={styles.cardLabel}>THE JOURNEY, CONTINUED</Text>
                <Text style={styles.cardSub}>the map you set — home tracks it from tomorrow</Text>
                <WeightJourneyBar
                  variant="dark"
                  currentKg={weightKg}
                  milestoneKg={targetWeightKg!}
                  idealKg={idealWeightKg!}
                  band={band}
                  zoneLabel={`Healthy ${frameLabel} range`}
                />
                <View style={styles.milestoneChip}>
                  <MaterialIcons name="flag" size={14} color={color.yellow} />
                  {journeyAtIdeal ? (
                    <Text style={styles.milestoneChipText}>
                      Right in the healthy zone — we&apos;ll keep it that way
                    </Text>
                  ) : milestoneIsStop ? (
                    <Text style={styles.milestoneChipText}>
                      Milestone <Text style={styles.milestoneChipBold}>1{totalStages >= 2 && totalStages <= 5 ? ` of ~${totalStages}` : ''}</Text>
                      {' '}· first stop <Text style={styles.milestoneChipBold}>{targetWeightKg!.toFixed(1)} kg</Text>
                      {milestoneWeeks > 0 ? ` · ~${milestoneWeeks} week${milestoneWeeks === 1 ? '' : 's'}` : ''}
                    </Text>
                  ) : (
                    <Text style={styles.milestoneChipText}>
                      Straight to ideal{milestoneWeeks > 0 ? ` · about ${milestoneWeeks} week${milestoneWeeks === 1 ? '' : 's'} at a safe pace` : ''}
                    </Text>
                  )}
                </View>
              </Animated.View>
            )}

            {/* The living-plan promise — truthful: adjustDailyTarget flexes
                daily targets ±10% off weight trends, and milestones re-run
                the math. This is the reason to come back. */}
            <Animated.View entering={FadeInDown.duration(500).delay(520)} style={styles.panelCard}>
              <Text style={styles.cardLabel}>A PLAN THAT ADAPTS</Text>
              <View style={styles.adaptRow}>
                <MaterialIcons name="sync" size={15} color={color.viz.green} style={styles.adaptIcon} />
                <Text style={styles.adaptText}>
                  Daily targets flex with {petName}&apos;s weight trend — never more than ±10%
                </Text>
              </View>
              <View style={styles.adaptRow}>
                <MaterialIcons name="flag" size={15} color={color.viz.green} style={styles.adaptIcon} />
                <Text style={styles.adaptText}>
                  {milestoneIsStop && targetWeightKg != null
                    ? `At ${targetWeightKg.toFixed(1)} kg we re-run the math and set the next milestone together`
                    : `Every weigh-in re-runs the math as ${petName} progresses`}
                </Text>
              </View>
            </Animated.View>

            {/* Tonight's actions — supporting tier, below the reasoning */}
            {portion && (
              <View style={styles.insightBlock}>
                <PortionPlateCard petName={petName} plan={portion} />
              </View>
            )}
            {watchOuts.length > 0 && (
              <View style={styles.insightBlock}>
                <WatchOutsCard petName={petName} items={watchOuts} />
              </View>
            )}

            {/* Quiet share at peak pride — emotional share only, no rewards */}
            {dailyKcal != null && (
              <Animated.View entering={FadeIn.duration(500).delay(800)}>
                <TouchableOpacity
                  onPress={handleShare}
                  style={styles.shareBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <MaterialIcons name="ios-share" size={16} color={color.creamDim} />
                  <Text style={styles.shareText}>Share {petName}&apos;s plan</Text>
                </TouchableOpacity>
              </Animated.View>
            )}
          </ScrollView>

          {/* Sticky CTA — always reachable while scrolling */}
          <View style={[styles.stickyBar, { paddingBottom: insets.bottom + space.md }]}>
            <PawtchiButton
              title="See the home Pawtchi just built"
              variant="primary"
              size="large"
              iconName="arrow-forward"
              iconPosition="right"
              onPress={handleContinue}
            />
          </View>
        </>
      )}

      <NotificationPrimer
        visible={primerVisible}
        petName={petName}
        source="plan_reveal"
        onAccept={handlePrimerAccept}
        onDecline={handlePrimerDecline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.navy,
  },

  // Phase 1 — building (fills + centres)
  buildingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xxl, paddingHorizontal: space.xxl },
  buildingTitle: {
    fontFamily: font.display,
    fontSize: 44,
    lineHeight: 44,
    letterSpacing: 0.5,
    color: color.cream,
    textAlign: 'center',
  },
  phaseList: {
    alignSelf: 'stretch',
    gap: space.md,
    paddingHorizontal: space.xxxl,
    // Fixed height for all four rows so the title doesn't shift as they land.
    minHeight: 4 * 32,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: 24,
  },
  phaseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
    borderWidth: 1.5,
    borderColor: color.creamFaint,
  },
  phaseText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    letterSpacing: 1.2,
    color: color.creamFaint,
    textTransform: 'uppercase',
  },
  phaseTextDone: {
    color: color.cream,
  },

  // Phase 2 — reveal
  revealScroll: { flex: 1 },
  revealContent: {
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
    gap: space.xl,
  },
  insightBlock: { marginTop: -space.sm },
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    backgroundColor: color.navyRaised,
    borderTopWidth: 1,
    borderTopColor: color.hairlineOnNavy,
  },
  eyebrow: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2.6,
    color: color.yellow,
    textAlign: 'left',
  },
  heroBlock: { alignItems: 'flex-start' },
  heroGlow: {
    position: 'absolute',
    top: -12,
    left: -24,
    width: 260,
    height: 130,
    borderRadius: 65,
    backgroundColor: color.yellowSoft,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
  },
  heroNumber: {
    ...displayLine(96),
    letterSpacing: 1,
    color: color.cream,
  },
  heroUnitText: {
    fontFamily: font.display,
    fontSize: 32,
    lineHeight: 40,
    color: color.creamFaint,
    paddingBottom: 6,
  },
  heroSub: {
    fontFamily: font.regular,
    fontSize: 14.5,
    lineHeight: 21,
    color: color.creamDim,
    marginTop: space.md,
  },

  // Shared navy panel card
  panelCard: {
    backgroundColor: color.navyRaised,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
    borderRadius: radius.xl,
    padding: space.lg,
  },
  cardLabel: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 2,
    color: color.yellow,
  },
  cardSub: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: color.creamFaint,
    marginTop: 2,
    marginBottom: space.md,
  },

  // Walksign beat
  walksignCard: { alignItems: 'center' },
  walksignCrestWrap: { marginTop: space.lg, marginBottom: space.md },
  walksignName: {
    fontFamily: font.display,
    fontSize: 36,
    lineHeight: 38,
    letterSpacing: 1,
    color: color.cream,
    textAlign: 'center',
  },
  walksignTagline: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.creamDim,
    textAlign: 'center',
    marginTop: space.sm,
  },
  walksignNote: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: color.creamFaint,
    textAlign: 'center',
    marginTop: space.md,
  },

  // Receipt rows
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
  },
  receiptRowBorder: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(244, 241, 236, 0.08)',
  },
  receiptIcon: {
    width: 18,
  },
  receiptBody: {
    flex: 1,
  },
  receiptTitle: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.cream,
  },
  receiptSub: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: color.creamFaint,
    marginTop: 1,
  },
  receiptEffect: {
    fontFamily: font.bold,
    fontSize: 12.5,
    color: color.creamDim,
  },
  receiptDetail: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: color.creamDim,
    paddingLeft: 28,
    paddingBottom: space.md,
  },
  receiptTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.hairlineOnNavy,
  },
  receiptTotalLabel: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.creamDim,
  },
  receiptTotalValue: {
    fontFamily: font.display,
    fontSize: 20,
    lineHeight: 22,
    letterSpacing: 0.5,
    color: color.yellow,
  },

  // Journey card extras
  milestoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: color.yellowSoft,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: space.sm,
  },
  milestoneChipText: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.cream,
    flexShrink: 1,
    textAlign: 'center',
  },
  milestoneChipBold: {
    fontFamily: font.bold,
    color: color.cream,
  },

  // Adapts card
  adaptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: space.md,
  },
  adaptIcon: {
    marginTop: 1,
    width: 18,
  },
  adaptText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.creamDim,
  },

  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    alignSelf: 'center',
    paddingVertical: space.sm,
  },
  shareText: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.creamDim,
  },
});
