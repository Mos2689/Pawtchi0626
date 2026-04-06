import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/Theme';
import { LinearGradient } from 'expo-linear-gradient';
import { usePetStore } from '../../store/usePetStore';
import { getBreedDefaults } from '../../lib/breedData';

const COMMON_ALLERGENS = [
  'Chicken', 'Beef', 'Grain/Wheat', 'Dairy', 'Egg',
  'Soy', 'Fish', 'Lamb', 'Corn', 'Pork',
];

export default function AllergiesScreen() {
  const router = useRouter();
  const theme = Colors.light;
  const insets = useSafeAreaInsets();

  const { species, breed, name, setAllergies } = usePetStore();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [noneSelected, setNoneSelected] = useState(true);
  const [customAllergens, setCustomAllergens] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');

  const breedDefaults = getBreedDefaults(species, breed);
  const breedAllergens = breedDefaults?.commonAllergens ?? [];

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
    router.push('/onboarding/goal');
  };

  const handleSkip = () => {
    setAllergies([]);
    router.push('/onboarding/goal');
  };

  const isChipSelected = (allergen: string) => selected.has(allergen);
  const isBreedSuggested = (allergen: string) => breedAllergens.includes(allergen);

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={24} color={theme['on-surface']} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme['on-surface'] }]}>Pet Journey</Text>
        </View>
        <View style={[styles.stepBadge, { backgroundColor: '#F1F5F9' }]}>
          <Text style={[styles.stepText, { color: theme['on-surface-variant'] }]}>Step 3 of 4</Text>
        </View>
      </View>

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
              <MaterialIcons name="auto-awesome" size={18} color="#92400e" />
              <Text style={styles.breedBannerTitle}>
                Common sensitivities for {breed}
              </Text>
            </View>
            <View style={styles.breedChipsRow}>
              {breedAllergens.map(allergen => (
                <TouchableOpacity
                  key={`breed-${allergen}`}
                  style={[
                    styles.breedChip,
                    isChipSelected(allergen) && styles.breedChipSelected,
                  ]}
                  onPress={() => toggleAllergen(allergen)}
                  activeOpacity={0.7}
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
                </TouchableOpacity>
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
              <TouchableOpacity
                key={allergen}
                style={[
                  styles.chip,
                  isChipSelected(allergen) && styles.chipSelected,
                ]}
                onPress={() => toggleAllergen(allergen)}
                activeOpacity={0.7}
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
              </TouchableOpacity>
            ))}

            {/* Custom allergens */}
            {customAllergens.map(allergen => (
              <TouchableOpacity
                key={`custom-${allergen}`}
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
                activeOpacity={0.7}
              >
                <MaterialIcons name="check" size={16} color="#243036" />
                <Text style={[styles.chipText, styles.chipTextSelected]}>{allergen}</Text>
                <MaterialIcons name="close" size={14} color="#64748b" />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* None that I know of */}
        <TouchableOpacity
          style={[
            styles.noneChip,
            noneSelected && styles.noneChipSelected,
          ]}
          onPress={handleNone}
          activeOpacity={0.7}
        >
          {noneSelected && <MaterialIcons name="check-circle" size={20} color="#243036" />}
          <Text style={[
            styles.noneChipText,
            noneSelected && styles.noneChipTextSelected,
          ]}>
            None that I know of
          </Text>
        </TouchableOpacity>

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
          <TouchableOpacity
            style={[styles.nextBtn, { backgroundColor: '#FFFC00' }]}
            onPress={handleNext}
            activeOpacity={0.9}
          >
            <Text style={[styles.nextBtnText, { color: '#243036' }]}>Next</Text>
            <MaterialIcons name="chevron-right" size={24} color="#243036" />
          </TouchableOpacity>
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
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 28,
    letterSpacing: -0.5,
  },
  stepBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  stepText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
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
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 36,
    lineHeight: 40,
    letterSpacing: -1,
    marginBottom: 8,
    textAlign: 'center',
  },
  subHeading: {
    fontFamily: 'Plus Jakarta Sans',
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
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
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
    borderColor: '#fbbf24',
  },
  breedChipSelected: {
    backgroundColor: '#fde68a',
    borderColor: '#f59e0b',
  },
  breedChipText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
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
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
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
    backgroundColor: '#FFFC00',
    borderColor: '#E6E300',
    borderWidth: 2,
  },
  chipText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
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
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
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
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 15,
    backgroundColor: '#FFFFFF',
  },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#FFFC00',
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
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
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
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 20,
  },
});
