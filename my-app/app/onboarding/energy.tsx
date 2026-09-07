import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { RunningDogIcon } from '../../components/icons/RunningDogIcon';
import Animated, {
  FadeInDown, useSharedValue, useAnimatedStyle, withSequence, withSpring,
} from 'react-native-reanimated';

import { color, font, radius, space, motion, makeShadow } from '../../constants/design';
import { usePetStore, ActivityLevel } from '../../store/usePetStore';
import { forwardCompletionParams } from '../../lib/onboarding/completionMode';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SelectableChip } from '../../components/SelectableChip';
import { OnboardingHeader } from '../../components/OnboardingHeader';
import { RealityCheckSheet } from '../../components/RealityCheckSheet';
import { getBreedDefaults } from '../../lib/breedData';
import {
  stepIndex, trackStepCompleted, useOnboardingStepTracking,
} from '../../lib/onboardingFunnel';
import { track } from '../../lib/analytics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Activity-level definitions are intentionally concrete (time, not feel) — when
// an owner picks "highly active" because it sounds nice, the resulting kcal
// target inflates 60–100%, which over months is real obesity risk. The
// per-option `clinicalDescription` is shown to the user and matters here.
const ACTIVITY_OPTIONS: {
  level: ActivityLevel;
  label: string;
  description: string;
  clinicalDescription: string;
  icon: keyof typeof MaterialIcons.glyphMap | '__dog__';
  /** Numerical rank so we can detect "more active than breed typical". */
  rank: number;
}[] = [
  { level: 'sedentary',     label: 'Couch potato',    description: 'Under 30 min/day',         clinicalDescription: 'Mostly indoor, under 30 minutes of walking or play a day.',                       icon: 'weekend',         rank: 0 },
  { level: 'normal',        label: 'Casual walker',   description: '30–60 min/day',            clinicalDescription: 'A walk or two and some daily play, 30–60 minutes total.',                          icon: 'pets',            rank: 1 },
  { level: 'active',        label: 'Active explorer', description: '1–2 hr/day',               clinicalDescription: 'Long daily walks, hikes, or active play — 1 to 2 hours of movement most days.',  icon: '__dog__',         rank: 2 },
  { level: 'highly_active', label: 'Athlete',         description: '3+ hr/day · working dog', clinicalDescription: 'Working, sporting, or sport-dog level: 3+ hours of intense exercise daily.',        icon: 'fitness-center',  rank: 3 },
];

// Step 4 of 6 — energy. Big tappable cards, one decision. Breed pre-selects the
// likely answer, and we *tell* the user we did it so the intelligence is felt.
export default function EnergyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const completionParams = useLocalSearchParams<{ mode?: string; feature?: string }>();
  useOnboardingStepTracking('energy');

  const { species, name, breed, activityLevel, setActivityLevel, imageUri } = usePetStore();
  const petName = name.trim() || 'your pet';

  // Track whether the prefill came from the breed default — surface it as a hint
  // so the user knows "Pawtchi already chose this for you" (visible intelligence).
  const [prefilledFromBreed, setPrefilledFromBreed] = useState(false);
  const hasManuallySet = useRef(false);

  // The pre-picked card asks for a look when the prefill lands — the hint chip
  // says "we chose this"; the pulse points at what was chosen.
  const prefillPulse = useSharedValue(1);
  const prefillPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: prefillPulse.value }],
  }));

  useEffect(() => {
    if (!breed || hasManuallySet.current) return;
    const defaults = getBreedDefaults(species, breed);
    if (defaults?.typicalActivityLevel) {
      setActivityLevel(defaults.typicalActivityLevel);
      setPrefilledFromBreed(true);
      prefillPulse.value = withSequence(
        withSpring(1.03, motion.spring.gentle),
        withSpring(1, motion.spring.gentle),
      );
    }
  }, [breed, species, setActivityLevel, prefillPulse]);

  // Reality check: when the owner picks an activity level meaningfully higher
  // than what's typical for the breed, confirm before setting it — via a
  // branded sheet, not a system alert. Over-claiming activity inflates the
  // daily kcal target ~60-100%; the most common cause of consumer-app obesity
  // is owner-asserted activity.
  const [realityCheck, setRealityCheck] = useState<{
    newOpt: (typeof ACTIVITY_OPTIONS)[number];
    typicalOpt: (typeof ACTIVITY_OPTIONS)[number];
  } | null>(null);

  const handleSelect = (level: ActivityLevel) => {
    hasManuallySet.current = true;
    setPrefilledFromBreed(false);

    const breedDefaults = breed ? getBreedDefaults(species, breed) : null;
    const typical = breedDefaults?.typicalActivityLevel;
    const newOpt = ACTIVITY_OPTIONS.find((o) => o.level === level);
    const typicalOpt = typical ? ACTIVITY_OPTIONS.find((o) => o.level === typical) : null;
    if (newOpt && typicalOpt && newOpt.rank - typicalOpt.rank >= 2 && breed) {
      setRealityCheck({ newOpt, typicalOpt });
      return;
    }

    setActivityLevel(level);
    track('onboarding_option_selected', { step: 'energy', option: 'activityLevel', value: level });
  };

  const handleContinue = () => {
    trackStepCompleted('energy', { level: activityLevel, prefilled: prefilledFromBreed });
    router.push({ pathname: '/onboarding/allergies', params: forwardCompletionParams(completionParams) } as never);
  };

  return (
    <View style={styles.container}>
      <OnboardingHeader step={stepIndex('energy')} stepId="energy" />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(420)}>
          <Text style={styles.eyebrow}>STEP {stepIndex('energy')}</Text>
          <Text style={styles.title}>How energetic is{'\n'}{petName}?</Text>
          <Text style={styles.subtitle}>
            This sets {petName}&apos;s baseline movement target each day.
          </Text>
        </Animated.View>

        {/* Visible intelligence chip — tell the user when Pawtchi pre-picked one */}
        {prefilledFromBreed && breed && (
          <Animated.View entering={FadeInDown.duration(420).delay(60)} style={styles.hintRow}>
            <MaterialIcons name="auto-awesome" size={14} color={color.navy} />
            <Text style={styles.hintText}>
              {breed}s are usually <Text style={styles.hintBold}>{ACTIVITY_OPTIONS.find(o => o.level === activityLevel)?.label.toLowerCase()}</Text> — we&apos;ve picked it for you.
            </Text>
          </Animated.View>
        )}

        <View style={styles.choiceGrid}>
          {ACTIVITY_OPTIONS.map((opt, i) => {
            const selected = activityLevel === opt.level;
            return (
              <Animated.View
                key={opt.level}
                entering={FadeInDown.duration(380).delay(120 + i * 40)}
                style={[
                  styles.choiceWrap,
                  prefilledFromBreed && selected ? prefillPulseStyle : undefined,
                ]}
              >
                <SelectableChip
                  selected={selected}
                  style={styles.choiceCard}
                  selectedStyle={styles.choiceCardSelected}
                  scaleTo={motion.scale.press}
                  onPress={() => handleSelect(opt.level)}
                >
                  <View style={[styles.choiceIcon, selected && styles.choiceIconSelected]}>
                    {opt.icon === '__dog__' ? (
                      <RunningDogIcon size={22} color={selected ? color.navy : color.slateMuted} />
                    ) : (
                      <MaterialIcons name={opt.icon} size={22} color={selected ? color.navy : color.slateMuted} />
                    )}
                  </View>
                  <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{opt.label}</Text>
                  <Text style={[styles.choiceDesc, selected && styles.choiceDescSelected]}>{opt.description}</Text>
                  {selected && (
                    <Text style={styles.choiceClinicalDesc}>
                      {opt.clinicalDescription}
                    </Text>
                  )}
                </SelectableChip>
              </Animated.View>
            );
          })}
        </View>
      </ScrollView>

      <View
        style={[
          styles.sticky,
          { paddingBottom: space.xxl + (Platform.OS === 'android' ? insets.bottom : 0) },
        ]}
      >
        <PawtchiButton
          title="Continue"
          variant="primary"
          iconName="arrow-forward"
          iconPosition="right"
          onPress={handleContinue}
        />
      </View>

      {realityCheck && (
        <RealityCheckSheet
          visible
          petName={petName}
          species={species === 'cat' ? 'cat' : 'dog'}
          imageUri={imageUri}
          breed={breed || ''}
          proposedLabel={realityCheck.newOpt.label}
          proposedClinical={realityCheck.newOpt.clinicalDescription}
          typicalLabel={realityCheck.typicalOpt.label}
          typicalDescription={realityCheck.typicalOpt.description}
          onConfirm={() => {
            setActivityLevel(realityCheck.newOpt.level);
            track('onboarding_option_selected', {
              step: 'energy', option: 'activityLevel',
              value: realityCheck.newOpt.level, confirmed_override: true,
            });
            setRealityCheck(null);
          }}
          onCancel={() => setRealityCheck(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  scrollContent: { paddingHorizontal: space.xxl, paddingBottom: 120 },

  eyebrow: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    color: color.slateFaint,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  title: {
    fontFamily: font.display,
    fontSize: 40,
    lineHeight: 40,
    letterSpacing: 0.5,
    color: color.ink,
  },
  subtitle: {
    fontFamily: font.regular,
    fontSize: 14.5,
    lineHeight: 21,
    color: color.slateMuted,
    marginTop: space.md,
    marginBottom: space.xxl,
    maxWidth: 320,
  },

  hintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: color.yellowSoft,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: space.lg,
  },
  hintText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.navy,
    lineHeight: 17,
  },
  hintBold: { fontFamily: font.bold },

  // 2×2 grid
  choiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  choiceWrap: { flexBasis: '47%', flexGrow: 1 },
  choiceCard: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingVertical: 18,
    paddingHorizontal: 16,
    minHeight: 132,
  },
  choiceCardSelected: {
    backgroundColor: color.surface,
    borderColor: color.yellow,
    borderWidth: 2,
  },
  choiceIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  choiceIconSelected: {
    backgroundColor: color.yellow,
    borderColor: color.yellow,
  },
  choiceLabel: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.slateMuted,
    letterSpacing: -0.2,
  },
  choiceLabelSelected: { color: color.ink },
  choiceDesc: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateFaint,
    marginTop: 3,
  },
  choiceDescSelected: { color: color.slateMuted },
  choiceClinicalDesc: {
    fontFamily: font.regular,
    fontSize: 11.5,
    lineHeight: 16,
    color: color.slateMuted,
    marginTop: 8,
  },

  sticky: {
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    backgroundColor: color.surface,
    ...makeShadow(-6, 14, 0.06),
  },
});
