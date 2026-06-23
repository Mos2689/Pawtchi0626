import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { color, font, radius, space, motion } from '../../constants/design';
import { usePetStore, ActivityLevel } from '../../store/usePetStore';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SelectableChip } from '../../components/SelectableChip';
import { OnboardingHeader } from '../../components/OnboardingHeader';
import { getBreedDefaults } from '../../lib/breedData';
import {
  stepIndex, trackStepCompleted, useOnboardingStepTracking,
} from '../../lib/onboardingFunnel';

const ACTIVITY_OPTIONS: { level: ActivityLevel; label: string; description: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { level: 'sedentary', label: 'Couch potato', description: 'Mostly resting', icon: 'weekend' },
  { level: 'normal', label: 'Casual walker', description: 'Regular walks', icon: 'pets' },
  { level: 'active', label: 'Active explorer', description: 'Loves to play', icon: 'directions-run' },
  { level: 'highly_active', label: 'Athlete', description: 'High energy', icon: 'fitness-center' },
];

// Step 4 of 6 — energy. Big tappable cards, one decision. Breed pre-selects the
// likely answer, and we *tell* the user we did it so the intelligence is felt.
export default function EnergyScreen() {
  const router = useRouter();
  useOnboardingStepTracking('energy');

  const { species, name, breed, activityLevel, setActivityLevel } = usePetStore();
  const petName = name.trim() || 'your pet';

  // Track whether the prefill came from the breed default — surface it as a hint
  // so the user knows "Pawtchi already chose this for you" (visible intelligence).
  const [prefilledFromBreed, setPrefilledFromBreed] = useState(false);
  const hasManuallySet = useRef(false);

  useEffect(() => {
    if (!breed || hasManuallySet.current) return;
    const defaults = getBreedDefaults(species, breed);
    if (defaults?.typicalActivityLevel) {
      setActivityLevel(defaults.typicalActivityLevel);
      setPrefilledFromBreed(true);
    }
  }, [breed, species, setActivityLevel]);

  const handleSelect = (level: ActivityLevel) => {
    hasManuallySet.current = true;
    setPrefilledFromBreed(false);
    // Selection haptic comes from the SelectableChip surface.
    setActivityLevel(level);
  };

  const handleContinue = () => {
    trackStepCompleted('energy', { level: activityLevel, prefilled: prefilledFromBreed });
    router.push('/onboarding/allergies' as any);
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
                style={styles.choiceWrap}
              >
                <SelectableChip
                  selected={selected}
                  style={styles.choiceCard}
                  selectedStyle={styles.choiceCardSelected}
                  scaleTo={motion.scale.press}
                  onPress={() => handleSelect(opt.level)}
                >
                  <View style={[styles.choiceIcon, selected && styles.choiceIconSelected]}>
                    <MaterialIcons name={opt.icon} size={22} color={selected ? color.navy : color.slateMuted} />
                  </View>
                  <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{opt.label}</Text>
                  <Text style={[styles.choiceDesc, selected && styles.choiceDescSelected]}>{opt.description}</Text>
                </SelectableChip>
              </Animated.View>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.sticky}>
        <PawtchiButton
          title="Continue"
          variant="primary"
          iconName="arrow-forward"
          iconPosition="right"
          onPress={handleContinue}
        />
      </View>
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

  sticky: {
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    backgroundColor: color.surface,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 12,
  },
});
