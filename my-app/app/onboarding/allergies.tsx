import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { usePetStore } from '../../store/usePetStore';
import { forwardCompletionParams } from '../../lib/onboarding/completionMode';
import { getBreedDefaults } from '../../lib/breedData';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SelectableChip } from '../../components/SelectableChip';
import { TextField } from '../../components/ui/TextField';
import { OnboardingHeader } from '../../components/OnboardingHeader';
import {
  OnboardingFormScaffold, ScaffoldField,
} from '../../components/onboarding/OnboardingFormScaffold';
import { color, font, radius, space, motion } from '../../constants/design';
import {
  stepIndex, trackFieldSkipped, trackStepCompleted, useOnboardingStepTracking,
} from '../../lib/onboardingFunnel';
import { track } from '../../lib/analytics';

const COMMON_ALLERGENS = [
  'Chicken', 'Beef', 'Grain/Wheat', 'Dairy', 'Egg',
  'Soy', 'Fish', 'Lamb', 'Corn', 'Pork',
];

// "chicken" / "chicken and beef" / "chicken, beef and 2 more"
function formatAllergenList(items: string[]): string {
  const lower = items.map((a) => a.toLowerCase());
  if (lower.length === 1) return lower[0];
  if (lower.length === 2) return `${lower[0]} and ${lower[1]}`;
  return `${lower[0]}, ${lower[1]} and ${lower.length - 2} more`;
}

// Step 5 of 6 — food sensitivities. The data feeds the label scanner, and the
// shield preview below the chips makes that payoff visible the moment the
// first allergen is picked.
export default function AllergiesScreen() {
  const router = useRouter();
  const completionParams = useLocalSearchParams<{ mode?: string; feature?: string }>();
  const insets = useSafeAreaInsets();
  useOnboardingStepTracking('allergies');

  const { species, breed, name, allergies, setAllergies } = usePetStore();
  const petName = name.trim() || 'your pet';

  const breedDefaults = getBreedDefaults(species, breed);
  const breedAllergens = breedDefaults?.commonAllergens ?? [];

  const initialCustom = (allergies || []).filter(
    a => !COMMON_ALLERGENS.includes(a) && !breedAllergens.includes(a)
  );

  const [selected, setSelected] = useState<Set<string>>(new Set(allergies || []));
  const [noneSelected, setNoneSelected] = useState((allergies || []).length === 0);
  const [customAllergens, setCustomAllergens] = useState<string[]>(initialCustom);
  const [customInput, setCustomInput] = useState('');

  const toggleAllergen = (allergen: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(allergen)) {
        next.delete(allergen);
        track('onboarding_option_selected', { step: 'allergies', option: 'allergen', action: 'remove', value: allergen });
      } else {
        next.add(allergen);
        track('onboarding_option_selected', { step: 'allergies', option: 'allergen', action: 'add', value: allergen });
      }
      if (next.size > 0) setNoneSelected(false);
      if (next.size === 0) setNoneSelected(true);
      return next;
    });
  };

  const handleNone = () => {
    setNoneSelected(true);
    setSelected(new Set());
    setCustomAllergens([]);
    track('onboarding_option_selected', { step: 'allergies', option: 'none' });
  };

  const addCustomAllergen = () => {
    const trimmed = customInput.trim();
    if (trimmed && !selected.has(trimmed) && !customAllergens.includes(trimmed)) {
      setCustomAllergens(prev => [...prev, trimmed]);
      setSelected(prev => {
        const next = new Set(prev);
        next.add(trimmed);
        return next;
      });
      setNoneSelected(false);
      setCustomInput('');
      track('onboarding_option_selected', { step: 'allergies', option: 'custom_allergen', action: 'add', value: trimmed });
    }
  };

  const handleNext = () => {
    const allAllergens = Array.from(selected);
    setAllergies(allAllergens);
    trackStepCompleted('allergies', { count: allAllergens.length, none: noneSelected });
    router.push({ pathname: '/onboarding/body-check', params: forwardCompletionParams(completionParams) } as never);
  };

  const handleSkip = () => {
    setAllergies([]);
    trackFieldSkipped('allergies', 'allergens');
    trackStepCompleted('allergies', { count: 0, none: true, skipped: true });
    router.push({ pathname: '/onboarding/body-check', params: forwardCompletionParams(completionParams) } as never);
  };

  const isChipSelected = (allergen: string) => selected.has(allergen);
  const isBreedSuggested = (allergen: string) => breedAllergens.includes(allergen);
  const selectedList = Array.from(selected);

  return (
    <View style={styles.container}>
      <OnboardingHeader step={stepIndex('allergies')} stepId="allergies" onSkip={handleSkip} />

      <OnboardingFormScaffold
        contentContainerStyle={styles.scrollContent}
        footer={
          <LinearGradient
            colors={['transparent', 'rgba(255,255,255,0.95)', color.surface]}
            style={[styles.footerGradient, { paddingBottom: insets.bottom + space.xl }]}
            locations={[0, 0.4, 1]}
          >
            <PawtchiButton
              title="Next"
              variant="primary"
              iconName="arrow-forward"
              iconPosition="right"
              onPress={handleNext}
            />
          </LinearGradient>
        }
      >
        <Animated.View entering={FadeInDown.duration(420)}>
          <Text style={styles.eyebrow}>STEP {stepIndex('allergies')}</Text>
          <Text style={styles.title}>Any food{'\n'}sensitivities?</Text>
          <Text style={styles.subtitle}>
            We&apos;ll flag these whenever you scan a food label for {petName}.
          </Text>
        </Animated.View>

        {/* Breed-aware suggestion banner */}
        {breedAllergens.length > 0 && breed && (
          <Animated.View entering={FadeInDown.duration(420).delay(60)} style={styles.breedBanner}>
            <View style={styles.breedBannerHeader}>
              <MaterialIcons name="info-outline" size={16} color={color.alertDeep} />
              <Text style={styles.breedBannerTitle}>
                Common sensitivities for {breed}
              </Text>
            </View>
            <View style={styles.breedChipsRow}>
              {breedAllergens.map(allergen => (
                <SelectableChip
                  key={`breed-${allergen}`}
                  selected={isChipSelected(allergen)}
                  style={styles.breedChip}
                  selectedStyle={styles.breedChipSelected}
                  scaleTo={motion.scale.chip}
                  onPress={() => toggleAllergen(allergen)}
                >
                  <Text style={[
                    styles.breedChipText,
                    isChipSelected(allergen) && styles.breedChipTextSelected,
                  ]}>
                    {allergen}
                  </Text>
                  {isChipSelected(allergen) && (
                    <MaterialIcons name="check" size={14} color={color.alertDeep} />
                  )}
                </SelectableChip>
              ))}
            </View>
          </Animated.View>
        )}

        {/* Common allergen chips */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Common allergens</Text>
          <View style={styles.chipGrid}>
            {COMMON_ALLERGENS.filter(a => !isBreedSuggested(a)).map((allergen, i) => (
              <Animated.View key={allergen} entering={FadeInDown.duration(300).delay(90 + i * 30)}>
                <SelectableChip
                  selected={isChipSelected(allergen)}
                  style={styles.chip}
                  selectedStyle={styles.chipSelected}
                  scaleTo={motion.scale.chip}
                  onPress={() => toggleAllergen(allergen)}
                >
                  {isChipSelected(allergen) && (
                    <MaterialIcons name="check" size={16} color={color.navy} />
                  )}
                  <Text style={[
                    styles.chipText,
                    isChipSelected(allergen) && styles.chipTextSelected,
                  ]}>
                    {allergen}
                  </Text>
                </SelectableChip>
              </Animated.View>
            ))}

            {/* Custom allergens */}
            {customAllergens.map(allergen => (
              <SelectableChip
                key={`custom-${allergen}`}
                selected
                style={[styles.chip, styles.chipSelected]}
                scaleTo={motion.scale.chip}
                onPress={() => {
                  setCustomAllergens(prev => prev.filter(a => a !== allergen));
                  setSelected(prev => {
                    const next = new Set(prev);
                    next.delete(allergen);
                    if (next.size === 0) setNoneSelected(true);
                    return next;
                  });
                  track('onboarding_option_selected', { step: 'allergies', option: 'custom_allergen', action: 'remove', value: allergen });
                }}
              >
                <MaterialIcons name="check" size={16} color={color.navy} />
                <Text style={[styles.chipText, styles.chipTextSelected]}>{allergen}</Text>
                <MaterialIcons name="close" size={14} color={color.slateMuted} />
              </SelectableChip>
            ))}
          </View>
        </View>

        {/* Add custom */}
        <View style={styles.customRow}>
          {/* "Add" on the accessory bar is the same call the return key makes —
              it just stops the owner having to find the return key to use it. */}
          <ScaffoldField
            id="custom-allergen"
            label="Add an allergen"
            actionLabel="Add"
            onAction={addCustomAllergen}
            style={styles.customFieldSpacing}
          >
            {({ onFocus, onBlur }) => (
              <TextField
                height={48}
                fontSize={15}
                placeholder="Add another allergen"
                value={customInput}
                onChangeText={setCustomInput}
                onSubmitEditing={addCustomAllergen}
                onFocus={onFocus}
                onBlur={onBlur}
                returnKeyType="done"
              />
            )}
          </ScaffoldField>
          <TouchableOpacity
            style={[styles.addBtn, !customInput.trim() && { opacity: 0.4 }]}
            onPress={addCustomAllergen}
            disabled={!customInput.trim()}
            activeOpacity={0.7}
          >
            <MaterialIcons name="add" size={20} color={color.navy} />
          </TouchableOpacity>
        </View>

        {/* None that I know of */}
        <SelectableChip
          selected={noneSelected}
          style={styles.noneChip}
          selectedStyle={styles.noneChipSelected}
          scaleTo={motion.scale.press}
          onPress={handleNone}
        >
          {noneSelected && <MaterialIcons name="check-circle" size={20} color={color.success} />}
          <Text style={[
            styles.noneChipText,
            noneSelected && styles.noneChipTextSelected,
          ]}>
            None that I know of
          </Text>
        </SelectableChip>

        {/* Shield preview — the payoff for picking allergens, made visible now */}
        {selectedList.length > 0 && (
          <Animated.View entering={FadeInDown.duration(motion.duration.slow)} style={styles.shieldCard}>
            <View style={styles.shieldIcon}>
              <MaterialIcons name="verified-user" size={18} color={color.navy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.shieldTitle}>
                {name.trim() ? `${name.trim()}'s label shield` : 'The label shield'}
              </Text>
              <Text style={styles.shieldSub}>
                Scan any food label and Pawtchi will flag{' '}
                <Text style={styles.shieldFlag}>{formatAllergenList(selectedList)}</Text> for {petName}.
              </Text>
            </View>
          </Animated.View>
        )}
      </OnboardingFormScaffold>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: space.xxl,
    paddingBottom: 180,
  },

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

  breedBanner: {
    backgroundColor: color.alertSoft,
    borderRadius: radius.xl,
    padding: space.lg,
    marginBottom: space.xl,
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.25)',
  },
  breedBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: space.md,
  },
  breedBannerTitle: {
    fontFamily: font.bold,
    fontSize: 13.5,
    color: color.alertDeep,
  },
  breedChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  breedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.alert,
  },
  breedChipSelected: {
    backgroundColor: color.alertSoft,
    borderWidth: 2,
  },
  breedChipText: {
    fontFamily: font.semibold,
    fontSize: 13.5,
    color: color.alertDeep,
  },
  breedChipTextSelected: {
    fontFamily: font.bold,
  },

  section: {
    marginBottom: space.xl,
    gap: space.md,
  },
  sectionLabel: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slate,
    marginLeft: 4,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  chipSelected: {
    backgroundColor: color.surface,
    borderColor: color.yellow,
    borderWidth: 2,
  },
  chipText: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: color.slateMuted,
  },
  chipTextSelected: {
    fontFamily: font.bold,
    color: color.ink,
  },

  noneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.lg,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
    marginBottom: space.xl,
  },
  noneChipSelected: {
    backgroundColor: color.successSoft,
    borderColor: color.success,
    borderWidth: 2,
  },
  noneChipText: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: color.slateMuted,
  },
  noneChipTextSelected: {
    fontFamily: font.bold,
    color: color.success,
  },

  customRow: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
    marginBottom: space.xl,
  },
  // Spacing only — the box is TextField's (lib/ui/textFieldLayout.ts).
  customFieldSpacing: {
    flex: 1,
  },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: color.yellow,
    justifyContent: 'center',
    alignItems: 'center',
  },

  shieldCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
  },
  shieldIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: color.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shieldTitle: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.ink,
  },
  shieldSub: {
    fontFamily: font.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.slateMuted,
    marginTop: 3,
  },
  shieldFlag: {
    fontFamily: font.bold,
    color: color.error,
  },

  // The absolute positioning that used to live here is the scaffold's job now.
  footerGradient: {
    paddingHorizontal: space.xxl,
    paddingTop: space.xxl,
  },
});
