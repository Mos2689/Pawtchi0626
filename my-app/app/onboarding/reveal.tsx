import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Image, ScrollView, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';

import { color, font, radius, space } from '../../constants/design';
import { PawtchiButton } from '../../components/PawtchiButton';
import { PortionPlateCard } from '../../components/PortionPlateCard';
import { WatchOutsCard } from '../../components/WatchOutsCard';
import { usePetStore } from '../../store/usePetStore';
import { useActivePetStore } from '../../store/useActivePetStore';
import { track } from '../../lib/analytics';
import { derivePortionPlan } from '../../lib/portionMath';
import { getBreedWatchOuts } from '../../lib/breedWatchOuts';
import { getBreedDefaults, sizeCategoryFromWeight } from '../../lib/breedData';
import { deriveLifeStage } from '../../lib/lifeStage';

// The reveal — the missing climax. The whole onboarding exists to compute one
// magic number: the daily calorie plan. Old flow ran calculateDailyKcal
// invisibly in handleComplete and routed away. The user never saw the thing
// they invested 6 steps to receive.
//
// Two psychological levers do real work here:
//  1. Labour illusion — a ~1.6s "Building Bunny's plan…" beat. Perceived effort
//     increases perceived value (the Harvard Norton/Mochon study replicated in
//     onboarding many times over).
//  2. Reciprocity — by handing the user a personalized deliverable BEFORE the
//     paywall, we shift their stance from "is this worth paying for?" to
//     "they already gave me something tailored to my pet."
//
// The numbers come from the pet store (stashed by goal.tsx) — no re-fetch.
const REVEAL_DELAY_MS = 1600;

function lifeStageHint(label: string | null): string | null {
  if (!label) return null;
  const lower = label.toLowerCase();
  if (lower.includes('puppy') || lower.includes('kitten')) return 'higher energy needs while growing';
  if (lower.includes('senior')) return 'gentler movement, watchful eyes';
  if (lower.includes('adult')) return 'steady targets, real consistency';
  return null;
}

export default function RevealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const {
    name, breed, species, weight, ageYears, ageMonths, bodyConditionScore,
    targetWeightKg, dailyKcal, lifeStageLabel, imageUri, resetForm,
  } = usePetStore();
  const { activePet } = useActivePetStore();
  const petName = name?.trim() || activePet?.name?.trim() || 'your pet';

  // ── Personalised insights, derived on-device (no fetch, no cost) ──
  const weightKg = parseFloat(weight) || activePet?.current_weight_kg || 0;
  const speciesVal = species === 'cat' ? 'cat' : 'dog';
  const breedDefaults = getBreedDefaults(speciesVal, breed, weightKg);
  const sizeCategory = breedDefaults?.sizeCategory ?? sizeCategoryFromWeight(speciesVal, weightKg);
  const lifeStage = deriveLifeStage(speciesVal, parseInt(ageYears) || 0, parseInt(ageMonths) || 0, sizeCategory);
  const portion = dailyKcal ? derivePortionPlan({ dailyKcal, currentWeightKg: weightKg }) : null;
  const watchOuts = getBreedWatchOuts({
    species: speciesVal,
    breed,
    sizeCategory,
    lifeStage,
    bcs: bodyConditionScore,
    weightVsTargetKg: targetWeightKg != null && weightKg > 0 ? weightKg - targetWeightKg : null,
  });

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
  const [phaseLine, setPhaseLine] = useState('Reading the breed file');

  // Rotate phase lines so the wait feels productive, not idle.
  useEffect(() => {
    track('plan_reveal_viewed', {
      daily_kcal: dailyKcal ?? null,
      target_weight_kg: targetWeightKg ?? null,
    });
    const phases = [
      'Reading the breed file',
      'Tuning for life stage',
      'Sizing the daily plate',
      'Plotting movement targets',
    ];
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % phases.length;
      setPhaseLine(phases[i]);
    }, 400);
    const t = setTimeout(() => {
      clearInterval(interval);
      setBuilding(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, REVEAL_DELAY_MS);
    return () => { clearInterval(interval); clearTimeout(t); };
  }, [dailyKcal, targetWeightKg]);

  const handleContinue = () => {
    track('plan_reveal_continued', {});
    resetForm();
    router.replace('/preview-home' as any);
  };

  // Derived headline numbers — read directly from the store
  const moveTarget = 45; // matches the home ring default; could be made dynamic later
  const breedLine = breed ? `tuned for a ${lifeStageLabel?.toLowerCase() || ''} ${breed}`.trim() : null;
  const stageHint = lifeStageHint(lifeStageLabel);

  return (
    <View style={[styles.container, { paddingTop: insets.top + space.lg }]}>
      <StatusBar style="light" />

      {building ? (
        // Phase 1 — labour illusion
        <Animated.View key="building" entering={FadeIn.duration(400)} style={styles.buildingWrap}>
          <View style={styles.buildingSpinnerRing}>
            <ActivityIndicator color={color.yellow} size="large" />
          </View>
          <Text style={styles.buildingTitle}>
            Building {petName}&apos;s{'\n'}plan…
          </Text>
          <Animated.Text
            key={phaseLine}
            entering={FadeIn.duration(280)}
            style={styles.buildingPhase}
          >
            {phaseLine}
          </Animated.Text>
        </Animated.View>
      ) : (
        // Phase 2 — the reveal (hero stays the climax; insights live below the fold)
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
              <Text style={styles.heroNumber}>
                {dailyKcal ?? '—'}
                <Text style={styles.heroUnit}> kcal</Text>
              </Text>
              <Text style={styles.heroSub}>a day, calibrated to {petName}</Text>
            </Animated.View>

            {/* Stat strip — the supporting numbers that make the kcal feel earned */}
            <Animated.View entering={FadeInDown.duration(500).delay(260)} style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{moveTarget}<Text style={styles.statUnit}> min</Text></Text>
                <Text style={styles.statLabel}>moving</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{targetWeightKg ? targetWeightKg.toFixed(1) : '—'}<Text style={styles.statUnit}> kg</Text></Text>
                <Text style={styles.statLabel}>goal weight</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>7<Text style={styles.statUnit}> days</Text></Text>
                <Text style={styles.statLabel}>plan ready</Text>
              </View>
            </Animated.View>

            {/* Provenance line — turns the number from "magic" into "earned" */}
            <Animated.View entering={FadeInDown.duration(500).delay(380)} style={styles.provenanceRow}>
              <View style={styles.avatarMini}>
                {imageUri ? (
                  <Image source={{ uri: imageUri }} style={styles.avatarImg} />
                ) : (
                  <View style={[styles.avatarImg, styles.avatarFallback]}>
                    <Text style={styles.avatarInitials}>
                      {(petName?.[0] || (species === 'cat' ? 'C' : 'D')).toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
              <View style={{ flex: 1 }}>
                {breedLine && <Text style={styles.provenanceLine}>{breedLine}</Text>}
                {stageHint && <Text style={styles.provenanceHint}>{stageHint}</Text>}
              </View>
            </Animated.View>

            {/* Curiosity gap — signals there's more without cluttering the hero */}
            {(portion || watchOuts.length > 0) && (
              <Animated.View entering={FadeIn.duration(500).delay(640)} style={styles.whyMore}>
                <Text style={styles.whyMoreText}>What this plan means for {petName}</Text>
                <MaterialIcons name="keyboard-arrow-down" size={22} color={color.yellow} />
              </Animated.View>
            )}

            {/* Insight cards — the "oh, I didn't know that" payoff */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.navy,
  },

  // Phase 1 — building (fills + centres)
  buildingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingHorizontal: space.xxl },
  buildingSpinnerRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: color.navyRaised,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  buildingTitle: {
    fontFamily: font.display,
    fontSize: 44,
    lineHeight: 44,
    letterSpacing: 0.5,
    color: color.cream,
    textAlign: 'center',
  },
  buildingPhase: {
    fontFamily: font.semibold,
    fontSize: 13,
    letterSpacing: 1.4,
    color: color.yellow,
    textTransform: 'uppercase',
  },

  // Phase 2 — reveal
  revealScroll: { flex: 1 },
  revealContent: {
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
    gap: space.xxl,
  },
  whyMore: {
    alignItems: 'center',
    gap: 2,
    marginTop: -space.sm,
  },
  whyMoreText: {
    fontFamily: font.semibold,
    fontSize: 12,
    letterSpacing: 0.6,
    color: color.creamDim,
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
  heroNumber: {
    fontFamily: font.display,
    fontSize: 96,
    lineHeight: 92,
    letterSpacing: 1,
    color: color.cream,
  },
  heroUnit: {
    fontSize: 32,
    color: color.creamFaint,
  },
  heroSub: {
    fontFamily: font.regular,
    fontSize: 14.5,
    lineHeight: 21,
    color: color.creamDim,
    marginTop: space.md,
  },

  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.hairlineOnNavy,
    borderBottomWidth: 1,
    borderBottomColor: color.hairlineOnNavy,
  },
  stat: { flex: 1 },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: color.hairlineOnNavy,
    marginHorizontal: space.sm,
  },
  statValue: {
    fontFamily: font.display,
    fontSize: 26,
    lineHeight: 26,
    letterSpacing: 0.4,
    color: color.cream,
  },
  statUnit: {
    fontSize: 13,
    color: color.creamFaint,
  },
  statLabel: {
    fontFamily: font.medium,
    fontSize: 11,
    letterSpacing: 0.4,
    color: color.creamFaint,
    marginTop: 4,
  },

  provenanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  avatarMini: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: color.yellow,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarFallback: {
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: font.display,
    fontSize: 22,
    color: color.navy,
  },
  provenanceLine: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.cream,
    textTransform: 'capitalize',
  },
  provenanceHint: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.creamDim,
    marginTop: 2,
  },
});
