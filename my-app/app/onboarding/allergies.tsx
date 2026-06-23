import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/Theme';
import { LinearGradient } from 'expo-linear-gradient';
import { usePetStore } from '../../store/usePetStore';
import { getBreedDefaults } from '../../lib/breedData';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SelectableChip } from '../../components/SelectableChip';
import { OnboardingHeader } from '../../components/OnboardingHeader';
import { motion } from '../../constants/design';
import {
  stepIndex, trackFieldSkipped, trackStepCompleted, useOnboardingStepTracking,
} from '../../lib/onboardingFunnel';

const COMMON_ALLERGENS = [
  'Chicken', 'Beef', 'Grain/Wheat', 'Dairy', 'Egg',
  'Soy', 'Fish', 'Lamb', 'Corn', 'Pork',
];

export default function AllergiesScreen() {
  const router = useRouter();
  const theme = Colors.light;
  const insets = useSafeAreaInsets();
  useOnboardingStepTracking('allergies');

  const { species, breed, name, allergies, setAllergies } = usePetStore();

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
      } else {
        next.add(allergen);
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
    }
  };

  const handleNext = () => {
    const allAllergens = Array.from(selected);
    setAllergies(allAllergens);
    trackStepCompleted('allergies', { count: allAllergens.length, none: noneSelected });
    router.push('/onboarding/goal');
  };

  const handleSkip = () => {
    setAllergies([]);
    trackFieldSkipped('allergies', 'allergens');
    trackStepCompleted('allergies', { count: 0, none: true, skipped: true });
    router.push('/onboarding/goal');
  };

  const isChipSelected = (allergen: string) => selected.has(allergen);
  const isBreedSuggested = (allergen: string) => breedAllergens.includes(allergen);

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      <OnboardingHeader step={stepIndex('allergies')} stepId="allergies" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Headline */}
        <View style={styles.headlineSection}>
          <View style={[styles.blurBlob, { backgroundColor: 'rgba(255,252,0,0.1)' }]} />
          <Text style={[styles.mainHeading, { color: theme['on-surface'] }]}>
            Any food sensitivities?
          </Text>
          <Text style={[styles.subHeading, { color: theme['on-surface-variant'] }]}>
            We'll flag these when you scan food labels for {name || 'your pet'}.
          </Text>
        </View>

        {/* Breed-aware suggestion banner */}
        {breedAllergens.length > 0 && breed && (
          <View style={styles.breedBanner}>
            <View style={styles.breedBannerHeader}>
              <MaterialIcons name="info-outline" size={18} color="#92400e" />
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
                  onPress={() => toggleAllergen(allergen)}
                >
                  <Text style={[
                    styles.breedChipText,
                    isChipSelected(allergen) && styles.breedChipTextSelected,
                  ]}>
                    {allergen}
                  </Text>
                  {isChipSelected(allergen) && (
                    <MaterialIcons name="check" size={14} color="#92400e" />
                  )}
                </SelectableChip>
              ))}
            </View>
          </View>
        )}

        {/* Common Allergen Chips */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme['on-surface-variant'] }]}>
            Common Allergens
          </Text>
          <View style={styles.chipGrid}>
            {COMMON_ALLERGENS.filter(a => !isBreedSuggested(a)).map(allergen => (
              <SelectableChip
                key={allergen}
                selected={isChipSelected(allergen)}
                style={styles.chip}
                selectedStyle={styles.chipSelected}
                onPress={() => toggleAllergen(allergen)}
              >
                {isChipSelected(allergen) && (
                  <MaterialIcons name="check" size={16} color="#243036" />
                )}
                <Text style={[
                  styles.chipText,
                  isChipSelected(allergen) && styles.chipTextSelected,
                ]}>
                  {allergen}
                </Text>
              </SelectableChip>
            ))}

            {/* Custom allergens */}
            {customAllergens.map(allergen => (
              <SelectableChip
                key={`custom-${allergen}`}
                selected
                style={[styles.chip, styles.chipSelected]}
                onPress={() => {
                  setCustomAllergens(prev => prev.filter(a => a !== allergen));
                  setSelected(prev => {
                    const next = new Set(prev);
                    next.delete(allergen);
                    if (next.size === 0) setNoneSelected(true);
                    return next;
                  });
                }}
              >
                <MaterialIcons name="check" size={16} color="#243036" />
                <Text style={[styles.chipText, styles.chipTextSelected]}>{allergen}</Text>
                <MaterialIcons name="close" size={14} color="#64748b" />
              </SelectableChip>
            ))}
          </View>
        </View>

        {/* None that I know of */}
        <SelectableChip
          selected={noneSelected}
          style={styles.noneChip}
          selectedStyle={styles.noneChipSelected}
          scaleTo={motion.scale.press}
          onPress={handleNone}
        >
          {noneSelected && <MaterialIcons name="check-circle" size={20} color="#243036" />}
          <Text style={[
            styles.noneChipText,
            noneSelected && styles.noneChipTextSelected,
          ]}>
            None that I know of
          </Text>
        </SelectableChip>

        {/* Add Custom */}
        <View style={styles.customRow}>
          <TextInput
            style={styles.customInput}
            placeholder="Add other allergen..."
            placeholderTextColor="#94a3b8"
            value={customInput}
            onChangeText={setCustomInput}
            onSubmitEditing={addCustomAllergen}
            returnKeyType="done"
          />
          <TouchableOpacity
            style={[styles.addBtn, !customInput.trim() && { opacity: 0.4 }]}
            onPress={addCustomAllergen}
            disabled={!customInput.trim()}
            activeOpacity={0.7}
          >
            <MaterialIcons name="add" size={20} color="#243036" />
          </TouchableOpacity>
        </View>

      </ScrollView>

      {/* Sticky Footer */}
      <View style={styles.stickyFooterContainer}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.95)', '#FFFFFF']}
          style={[styles.footerGradient, { paddingBottom: insets.bottom + 40 }]}
          locations={[0, 0.4, 1]}
        >
          <TouchableOpacity onPress={handleSkip} activeOpacity={0.7}>
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
          <PawtchiButton
            title="Next"
            variant="primary"
            iconName="chevron-right"
            iconPosition="right"
            onPress={handleNext}
            style={{ width: 250, maxWidth: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 15, elevation: 8 }}
          />
        </LinearGradient>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(238,238,238,0.5)',
    zIndex: 50,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  backBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 28,
    letterSpacing: -0.5,
  },
  stepBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  stepText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 200,
  },
  headlineSection: {
    width: '100%',
    marginBottom: 32,
    alignItems: 'center',
  },
  blurBlob: {
    position: 'absolute',
    top: -24,
    right: -16,
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  mainHeading: {
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 36,
    lineHeight: 40,
    letterSpacing: -1,
    marginBottom: 8,
    textAlign: 'center',
  },
  subHeading: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 18,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  breedBanner: {
    backgroundColor: '#fef3c7',
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  breedBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  breedBannerTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14,
    color: '#92400e',
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
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: '#FFC400',
  },
  breedChipSelected: {
    backgroundColor: '#fde68a',
    borderColor: '#f59e0b',
  },
  breedChipText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14,
    color: '#92400e',
  },
  breedChipTextSelected: {
    fontWeight: '700',
  },
  section: {
    marginBottom: 20,
    gap: 12,
  },
  sectionLabel: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14,
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: 'rgba(209,213,225,0.3)',
  },
  chipSelected: {
    backgroundColor: '#F7F602',
    borderColor: '#E6E300',
    borderWidth: 2,
  },
  chipText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14,
    color: '#64748b',
  },
  chipTextSelected: {
    color: '#243036',
    fontWeight: '700',
  },
  noneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: 'rgba(209,213,225,0.3)',
    marginBottom: 20,
  },
  noneChipSelected: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
    borderWidth: 2,
  },
  noneChipText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 15,
    color: '#64748b',
  },
  noneChipTextSelected: {
    color: '#166534',
    fontWeight: '700',
  },
  customRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  customInput: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: 'rgba(209,213,225,0.3)',
    borderRadius: 16,
    paddingHorizontal: 16,
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 15,
    backgroundColor: '#FFFFFF',
  },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#F7F602',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  stickyFooterContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  footerGradient: {
    paddingHorizontal: 24,
    paddingTop: 24,
    alignItems: 'center',
    gap: 12,
  },
  skipText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 15,
    color: '#94a3b8',
    textDecorationLine: 'underline',
  },
  nextBtn: {
    width: 250,
    maxWidth: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    borderRadius: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 8,
    gap: 8,
  },
  nextBtnText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 20,
  },
});
