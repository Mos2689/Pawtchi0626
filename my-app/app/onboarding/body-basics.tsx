import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Modal, Switch,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { color, font, radius, space, motion } from '../../constants/design';
import { usePetStore } from '../../store/usePetStore';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SelectableChip } from '../../components/SelectableChip';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { OnboardingHeader } from '../../components/OnboardingHeader';
import {
  stepIndex, trackFieldSkipped, trackStepCompleted, useOnboardingStepTracking,
} from '../../lib/onboardingFunnel';

const DOG_BREEDS = [
  'Mixed Breed',
  'Labrador Retriever', 'Staffordshire Bull Terrier', 'French Bulldog', 'German Shepherd',
  'Golden Retriever', 'Border Collie', 'Cavalier King Charles Spaniel', 'Australian Kelpie',
  'Bulldog', 'Beagle', 'Rottweiler', 'Yorkshire Terrier', 'Boxer', 'Husky', 'Corgi',
  'Pug', 'Australian Shepherd', 'Australian Cattle Dog', 'Shih Tzu', 'Pomeranian',
  'Maltese', 'Jack Russell Terrier', 'Miniature Schnauzer', 'Cocker Spaniel',
  'West Highland White Terrier',
  'Toy Poodle', 'Miniature Poodle', 'Standard Poodle',
  'Miniature Dachshund', 'Standard Dachshund',
  'Cavoodle', 'Labradoodle', 'Groodle', 'Spoodle', 'Moodle', 'Puggle',
  'Other',
];
const CAT_BREEDS = [
  'Mixed Breed / Domestic Shorthair', 'Domestic Longhair', 'Ragdoll', 'Maine Coon', 'Persian',
  'British Shorthair', 'Sphynx', 'Bengal', 'Abyssinian', 'Scottish Fold', 'Siamese',
  'Russian Blue', 'Burmese', 'Birman', 'Other',
];

// Step 3 of 6 — body basics. Five light fields on one screen, no scroll fatigue.
export default function BodyBasicsScreen() {
  const router = useRouter();
  useOnboardingStepTracking('body_basics');

  const {
    species, name,
    breed, setBreed,
    ageYears, setAgeYears,
    ageMonths, setAgeMonths,
    weight, setWeight,
    gender, setGender,
    isNeutered, setIsNeutered,
  } = usePetStore();

  const [breedModalVisible, setBreedModalVisible] = useState(false);
  const [breedSearch, setBreedSearch] = useState('');
  const [weightError, setWeightError] = useState<string | null>(null);

  const closeBreedModal = () => {
    setBreedModalVisible(false);
    setBreedSearch('');
  };

  const pickBreed = (value: string) => {
    // Haptic comes from the SelectableChip / AnimatedPressable surface.
    setBreed(value);
    closeBreedModal();
  };

  // Filter the preset list against the search query, and decide whether to
  // offer the typed value as a custom breed (only when no preset matches it).
  const breedOptions = species === 'cat' ? CAT_BREEDS : DOG_BREEDS;
  const breedQuery = breedSearch.trim();
  const filteredBreeds = breedQuery
    ? breedOptions.filter((b) => b.toLowerCase().includes(breedQuery.toLowerCase()))
    : breedOptions;
  const hasExactMatch = breedQuery
    ? breedOptions.some((b) => b.toLowerCase() === breedQuery.toLowerCase())
    : false;
  const showCustomOption = breedQuery.length > 0 && !hasExactMatch;

  const petName = name.trim() || 'your pet';

  const handleContinue = () => {
    // Require weight — it's the math input for the whole plan
    const w = parseFloat(weight);
    if (!w || w <= 0) {
      setWeightError(`What does ${petName} weigh? (kg)`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (!breed) trackFieldSkipped('body_basics', 'breed');
    if (!ageYears && !ageMonths) trackFieldSkipped('body_basics', 'age');
    if (!gender) trackFieldSkipped('body_basics', 'sex');

    trackStepCompleted('body_basics', {
      has_breed: !!breed,
      has_age: !!(ageYears || ageMonths),
      has_sex: !!gender,
      weight_kg: w,
    });
    router.push('/onboarding/energy' as any);
  };

  return (
    <View style={styles.container}>
      <OnboardingHeader step={stepIndex('body_basics')} stepId="body_basics" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={20}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(420)}>
            <Text style={styles.eyebrow}>STEP {stepIndex('body_basics')}</Text>
            <Text style={styles.title}>The basics{'\n'}about {petName}.</Text>
            <Text style={styles.subtitle}>
              These numbers tune {petName}&apos;s daily calorie plan precisely.
            </Text>
          </Animated.View>

          {/* Breed */}
          <Animated.View entering={FadeInDown.duration(420).delay(60)} style={styles.formGroup}>
            <Text style={styles.label}>Breed <Text style={styles.optional}>(optional)</Text></Text>
            <TouchableOpacity
              style={styles.selectWrap}
              onPress={() => setBreedModalVisible(true)}
              activeOpacity={0.85}
            >
              <Text style={[styles.selectText, !breed && styles.selectPlaceholder]}>
                {breed || 'Pick a breed'}
              </Text>
              <MaterialIcons name="expand-more" size={20} color={color.slateMuted} />
            </TouchableOpacity>
          </Animated.View>

          {/* Age + weight — 3-column grid */}
          <Animated.View entering={FadeInDown.duration(420).delay(120)} style={styles.gridRow}>
            <View style={styles.gridCell}>
              <Text style={styles.label}>Years</Text>
              <TextInput
                style={styles.numInput}
                placeholder="2"
                placeholderTextColor={color.slateFaint}
                keyboardType="numeric"
                value={ageYears}
                onChangeText={setAgeYears}
                textAlign="center"
              />
            </View>
            <View style={styles.gridCell}>
              <Text style={styles.label}>Months</Text>
              <TextInput
                style={styles.numInput}
                placeholder="0"
                placeholderTextColor={color.slateFaint}
                keyboardType="numeric"
                value={ageMonths}
                onChangeText={(val) => {
                  const n = parseInt(val) || 0;
                  setAgeMonths(n > 11 ? '11' : val);
                }}
                textAlign="center"
              />
            </View>
            <View style={styles.gridCell}>
              <Text style={styles.label}>Weight (kg)</Text>
              <TextInput
                style={[styles.numInput, weightError && styles.numInputError]}
                placeholder="12.5"
                placeholderTextColor={color.slateFaint}
                keyboardType="decimal-pad"
                value={weight}
                onChangeText={(v) => { if (weightError) setWeightError(null); setWeight(v); }}
                textAlign="center"
              />
            </View>
          </Animated.View>
          {weightError && <Text style={styles.errorText}>{weightError}</Text>}

          {/* Sex */}
          <Animated.View entering={FadeInDown.duration(420).delay(180)} style={styles.formGroup}>
            <Text style={styles.label}>Sex <Text style={styles.optional}>(optional)</Text></Text>
            <View style={styles.choiceRow}>
              {(['male', 'female'] as const).map((g) => {
                const selected = gender === g;
                return (
                  <TouchableOpacity
                    key={g}
                    style={[styles.choiceCard, selected && styles.choiceCardSelected]}
                    onPress={() => { Haptics.selectionAsync(); setGender(g); }}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons
                      name={g === 'male' ? 'male' : 'female'}
                      size={20}
                      color={selected ? color.navy : color.slateMuted}
                    />
                    <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>
                      {g === 'male' ? 'Male' : 'Female'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>

          {/* Desexed toggle */}
          <Animated.View entering={FadeInDown.duration(420).delay(240)} style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.toggleTitle}>Desexed</Text>
              <Text style={styles.toggleSub}>Changes the daily calorie math by ~20%.</Text>
            </View>
            <Switch
              value={isNeutered}
              onValueChange={(v) => { Haptics.selectionAsync(); setIsNeutered(v); }}
              trackColor={{ false: color.track, true: color.yellow }}
              thumbColor="#FFFFFF"
            />
          </Animated.View>
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
      </KeyboardAvoidingView>

      {/* Breed picker */}
      <Modal visible={breedModalVisible} animationType="slide" transparent onRequestClose={closeBreedModal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select breed</Text>
              <TouchableOpacity onPress={closeBreedModal}>
                <MaterialIcons name="close" size={22} color={color.ink} />
              </TouchableOpacity>
            </View>

            {/* Search + free-text input — covers breeds not in the preset list. */}
            <View style={styles.breedSearchWrap}>
              <MaterialIcons name="search" size={18} color={color.slateFaint} />
              <TextInput
                style={styles.breedSearchInput}
                value={breedSearch}
                onChangeText={setBreedSearch}
                placeholder="Search or type your own breed"
                placeholderTextColor={color.slateFaint}
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (showCustomOption) pickBreed(breedQuery);
                }}
              />
              {breedSearch.length > 0 && (
                <TouchableOpacity onPress={() => setBreedSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialIcons name="close" size={16} color={color.slateFaint} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              style={{ maxHeight: 440 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {showCustomOption && (
                <AnimatedPressable
                  style={[styles.modalItem, styles.breedCustomItem]}
                  haptic="select"
                  scaleTo={motion.scale.press}
                  onPress={() => pickBreed(breedQuery)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 }}>
                    <MaterialIcons name="add-circle-outline" size={18} color={color.navy} />
                    <Text style={[styles.modalItemText, { color: color.ink, fontFamily: font.semibold }]} numberOfLines={1}>
                      Use “{breedQuery}”
                    </Text>
                  </View>
                </AnimatedPressable>
              )}

              {filteredBreeds.length === 0 && !showCustomOption && (
                <Text style={styles.breedEmpty}>No matches. Try a different spelling.</Text>
              )}

              {filteredBreeds.map((b) => (
                <SelectableChip
                  key={b}
                  selected={breed === b}
                  style={styles.modalItem}
                  scaleTo={motion.scale.press}
                  onPress={() => pickBreed(b)}
                >
                  <Text style={[styles.modalItemText, breed === b && { fontFamily: font.bold, color: color.ink }]}>{b}</Text>
                  {breed === b && <MaterialIcons name="check" size={18} color={color.navy} />}
                </SelectableChip>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    fontSize: 38,
    lineHeight: 38,
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

  formGroup: { marginBottom: space.lg },
  label: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slate,
    marginBottom: space.sm,
  },
  optional: {
    fontFamily: font.regular,
    color: color.slateFaint,
    fontSize: 11.5,
  },
  selectWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    height: 56,
  },
  selectText: {
    fontFamily: font.medium,
    fontSize: 16,
    color: color.ink,
  },
  selectPlaceholder: { color: color.slateFaint },

  gridRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: space.lg,
  },
  gridCell: { flex: 1 },
  numInput: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    height: 56,
    fontFamily: font.bold,
    fontSize: 18,
    color: color.ink,
  },
  numInputError: { borderColor: color.error },

  errorText: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.error,
    marginTop: -8,
    marginBottom: space.md,
  },

  choiceRow: { flexDirection: 'row', gap: 8 },
  choiceCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingVertical: 14,
  },
  choiceCardSelected: {
    backgroundColor: color.surface,
    borderColor: color.yellow,
    borderWidth: 2,
  },
  choiceLabel: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.slateMuted,
  },
  choiceLabelSelected: { color: color.ink },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
    marginTop: space.sm,
  },
  toggleTitle: {
    fontFamily: font.bold,
    fontSize: 14.5,
    color: color.ink,
  },
  toggleSub: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: color.slateMuted,
    marginTop: 3,
  },

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

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(7, 32, 42, 0.55)' },
  modalContent: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  modalTitle: { fontFamily: font.bold, fontSize: 18, color: color.ink },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.hairline,
  },
  modalItemText: {
    fontFamily: font.medium,
    fontSize: 15,
    color: color.slate,
  },
  breedSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: 14,
    height: 46,
    marginBottom: space.md,
  },
  breedSearchInput: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 14.5,
    color: color.ink,
    paddingVertical: 0,
  },
  breedCustomItem: {
    backgroundColor: color.yellowSoft,
    borderBottomWidth: 0,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    marginBottom: space.sm,
  },
  breedEmpty: {
    fontFamily: font.medium,
    fontSize: 13.5,
    color: color.slateFaint,
    paddingVertical: space.lg,
    textAlign: 'center',
  },
});
