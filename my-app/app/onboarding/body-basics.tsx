import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Switch,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn, FadeInDown,
  useSharedValue, useAnimatedStyle, withTiming, interpolateColor,
} from 'react-native-reanimated';

import { color, font, radius, space, motion, makeShadow } from '../../constants/design';
import { usePetStore } from '../../store/usePetStore';
import { BreedPickerModal } from '../../components/BreedPickerModal';
import { VetReportScanner } from '../../components/onboarding/VetReportScanner';
import { useActivePetStore } from '../../store/useActivePetStore';
import { forwardCompletionParams, isCompletionMode } from '../../lib/onboarding/completionMode';
import { validateWeight } from '../../lib/weightBounds';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SelectableChip } from '../../components/SelectableChip';
import { TextField } from '../../components/ui/TextField';
import { OnboardingHeader } from '../../components/OnboardingHeader';
import {
  OnboardingFormScaffold, ScaffoldField,
} from '../../components/onboarding/OnboardingFormScaffold';
import {
  stepIndex, trackFieldSkipped, trackStepCompleted, useOnboardingStepTracking,
} from '../../lib/onboardingFunnel';
import { track } from '../../lib/analytics';
import { startBcsPhotoEstimate } from '../../lib/bcsPhotoEstimateClient';


// Age is picked, not typed — bounded lists make impossible ages (e.g. 200
// years) unrepresentable instead of validated after the fact. 25 years covers
// the documented lifespan of both species.
const AGE_YEARS_OPTIONS = Array.from({ length: 26 }, (_, i) => i); // 0–25
const AGE_MONTHS_OPTIONS = Array.from({ length: 12 }, (_, i) => i); // 0–11

// Step 3 of 6 — body basics. Five light fields on one screen, no scroll fatigue.
export default function BodyBasicsScreen() {
  const router = useRouter();
  const completionParams = useLocalSearchParams<{ mode?: string; feature?: string }>();
  const completing = isCompletionMode(completionParams);

  // Entering from a health gate rather than from onboarding: the draft store is
  // empty, so rebuild it from the pet that already exists. Without this the
  // owner is shown blank fields for facts they gave us at signup, and saving
  // would write those blanks back over the row.
  const hydrateFromPet = usePetStore(s => s.hydrateFromPet);
  const hydratedRef = React.useRef(false);
  React.useEffect(() => {
    if (!completing || hydratedRef.current) return;
    const pet = useActivePetStore.getState().activePet;
    if (!pet) return;
    hydratedRef.current = true;
    hydrateFromPet(pet);
  }, [completing, hydrateFromPet]);
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
  const [ageModalVisible, setAgeModalVisible] = useState(false);
  const [weightError, setWeightError] = useState<string | null>(null);
  const [weightErrorLevel, setWeightErrorLevel] = useState<'soft' | 'error'>('error');

  // Highlight flash on the breed field when a pick returns from the modal —
  // continuity of object between the sheet and the screen.
  const breedFlash = useSharedValue(0);
  const breedFlashStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      breedFlash.value,
      [0, 1],
      [color.surfaceSubtle, color.yellowSoft],
    ),
  }));

  const closeBreedModal = () => setBreedModalVisible(false);

  const pickBreed = (value: string) => {
    // Haptic comes from the SelectableChip / AnimatedPressable surface.
    setBreed(value);
    track('onboarding_option_selected', { step: 'body_basics', option: 'breed', value });
    closeBreedModal();
    breedFlash.value = 1;
    breedFlash.value = withTiming(0, { duration: motion.duration.slow });
  };

  // Validate on blur so typos surface while the field is still in mind,
  // not as a rejection at Continue time. Soft warnings inform, never block.
  const handleWeightBlur = () => {
    if (!weight.trim()) return;
    const w = parseFloat(weight);
    const validation = validateWeight(w, species === 'cat' ? 'cat' : 'dog', breed);
    if (validation.status !== 'ok') {
      setWeightError(validation.message ?? null);
      setWeightErrorLevel(validation.status === 'invalid' ? 'error' : 'soft');
    }
  };

  const petName = name.trim() || 'your pet';

  // Compact display for the merged Age field: "2 yrs 3 mo", "5 mo", "3 yrs".
  // Both explicitly zero reads as a newborn rather than as empty.
  const hasAge = ageYears !== '' || ageMonths !== '';
  const ageLabel = (() => {
    if (!hasAge) return null;
    const y = parseInt(ageYears) || 0;
    const m = parseInt(ageMonths) || 0;
    if (y === 0 && m === 0) return 'Under 1 mo';
    const parts: string[] = [];
    if (y > 0) parts.push(`${y} ${y === 1 ? 'yr' : 'yrs'}`);
    if (m > 0) parts.push(`${m} mo`);
    return parts.join(' ');
  })();

  const closeAgeModal = () => {
    setAgeModalVisible(false);
    if (hasAge) {
      track('onboarding_option_selected', {
        step: 'body_basics', option: 'age', value: `${ageYears || '0'}y ${ageMonths || '0'}m`,
      });
    }
  };

  // The calorie engine's inputs, made visible — endowed progress without
  // spoiling the output (the kcal number stays the reveal's climax).
  const engineInputs = [
    { key: 'weight', done: !!parseFloat(weight) },
    { key: 'age', done: !!(ageYears || ageMonths) },
    { key: 'breed', done: !!breed },
    { key: 'sex', done: !!gender },
  ];
  const engineCount = engineInputs.filter((i) => i.done).length;

  const handleContinue = () => {
    // Require weight — it's the math input for the whole plan
    const w = parseFloat(weight);
    if (!w || w <= 0) {
      setWeightError(`What does ${petName} weigh? (kg)`);
      setWeightErrorLevel('error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    // Species + breed-aware sanity bounds. Catch typos (e.g. 150kg Chihuahua,
    // 0.1kg Lab) before they feed into RER → kcal → portion plan.
    const validation = validateWeight(w, species === 'cat' ? 'cat' : 'dog', breed);
    if (validation.status === 'invalid') {
      setWeightError(validation.message ?? 'Please double-check the weight.');
      setWeightErrorLevel('error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    // Soft warnings are allowed but logged for the user — we don't block.
    if (validation.status === 'soft' && validation.message) {
      setWeightError(validation.message);
      setWeightErrorLevel('soft');
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
    // Photo body-condition read — fire-and-forget so the result is usually
    // waiting by the time the goal screen's shape picker renders. Never
    // blocks or throws; failures land as "no suggestion" on that screen.
    startBcsPhotoEstimate();
    router.push({
      pathname: '/onboarding/energy',
      params: forwardCompletionParams(completionParams),
    } as never);
  };

  return (
    <View style={styles.container}>
      <OnboardingHeader step={stepIndex('body_basics')} stepId="body_basics" />

      <OnboardingFormScaffold
        contentContainerStyle={styles.scrollContent}
        footer={
          <View style={styles.sticky}>
            <View style={styles.engineRow}>
              <MaterialIcons name="auto-awesome" size={13} color={color.navy} />
              <Animated.Text key={engineCount} entering={FadeIn.duration(motion.duration.base)} style={styles.engineText}>
                Calorie engine · {engineCount} of {engineInputs.length} inputs
              </Animated.Text>
              <View style={styles.engineDots}>
                {engineInputs.map((input) => (
                  <View key={input.key} style={[styles.engineDot, input.done && styles.engineDotOn]} />
                ))}
              </View>
            </View>
            <PawtchiButton
              title="Continue"
              variant="primary"
              iconName="arrow-forward"
              iconPosition="right"
              onPress={handleContinue}
            />
          </View>
        }
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
            <Animated.View style={[styles.selectWrap, breedFlashStyle]}>
              <TouchableOpacity
                style={styles.selectInner}
                onPress={() => setBreedModalVisible(true)}
                activeOpacity={0.85}
              >
                <Text style={[styles.selectText, !breed && styles.selectPlaceholder]}>
                  {breed || 'Pick a breed'}
                </Text>
                <MaterialIcons name="expand-more" size={20} color={color.slateMuted} />
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>

          {/* Age (picked, not typed) + weight — 2-column grid */}
          <Animated.View entering={FadeInDown.duration(420).delay(120)} style={styles.gridRow}>
            <View style={[styles.gridCell, styles.gridCellWide]}>
              <Text style={styles.label}>Age</Text>
              <TouchableOpacity
                style={styles.ageSelect}
                onPress={() => {
                  Haptics.selectionAsync();
                  setAgeModalVisible(true);
                }}
                activeOpacity={0.85}
              >
                <Text
                  style={[styles.ageSelectText, !ageLabel && styles.selectPlaceholder]}
                  numberOfLines={1}
                >
                  {ageLabel ?? 'Add age'}
                </Text>
                <MaterialIcons name="expand-more" size={18} color={color.slateMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.gridCell}>
              <Text style={styles.label}>Weight (kg)</Text>
              {/* A decimal pad has no return key on iOS, so this field had no
                  way to close its own keyboard. The scaffold gives it a Done. */}
              <ScaffoldField id="weight" label="Weight · kg" onBlur={handleWeightBlur}>
                {({ onFocus, onBlur }) => (
                  <TextField
                    containerStyle={
                      weightError
                        ? (weightErrorLevel === 'error' ? styles.numInputError : styles.numInputWarn)
                        : undefined
                    }
                    fontSize={18}
                    inputStyle={styles.numInputType}
                    placeholder="12.5"
                    keyboardType="decimal-pad"
                    value={weight}
                    onChangeText={(v) => { if (weightError) setWeightError(null); setWeight(v); }}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    textAlign="center"
                  />
                )}
              </ScaffoldField>
            </View>
          </Animated.View>
          {weightError && (
            <Text style={[styles.errorText, weightErrorLevel === 'soft' && styles.warnText]}>
              {weightError}
            </Text>
          )}
          <Animated.Text entering={FadeInDown.duration(420).delay(150)} style={styles.fieldJustification}>
            Weight anchors every portion · age sets the life stage.
          </Animated.Text>

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
                    onPress={() => {
                      Haptics.selectionAsync();
                      setGender(g);
                      track('onboarding_option_selected', { step: 'body_basics', option: 'sex', value: g });
                    }}
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
              onValueChange={(v) => {
                Haptics.selectionAsync();
                setIsNeutered(v);
                track('onboarding_option_selected', { step: 'body_basics', option: 'desexed', value: v });
              }}
              trackColor={{ false: color.track, true: color.yellow }}
              thumbColor={color.surface}
            />
          </Animated.View>

          {/* Vet-report autofill. It lives here rather than on the identity
              screen because everything it extracts — weight, sex, desexed,
              allergies, body condition — is asked for on this screen and the
              ones after it. */}
          <VetReportScanner />
      </OnboardingFormScaffold>

      {/* Breed picker */}
      <BreedPickerModal
        visible={breedModalVisible}
        species={species === 'cat' ? 'cat' : 'dog'}
        value={breed}
        onSelect={pickBreed}
        onClose={closeBreedModal}
      />

      {/* Age picker — bounded lists, same sheet language as the breed picker.
          Both columns visible at once so "2 yrs 3 mo" is one visit, not two. */}
      <Modal visible={ageModalVisible} animationType="slide" transparent onRequestClose={closeAgeModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>How old is {petName}?</Text>
              <TouchableOpacity onPress={closeAgeModal}>
                <MaterialIcons name="close" size={22} color={color.ink} />
              </TouchableOpacity>
            </View>

            <View style={styles.ageColumns}>
              <View style={styles.ageColumn}>
                <Text style={styles.ageColumnLabel}>Years</Text>
                <ScrollView
                  style={styles.ageColumnScroll}
                  showsVerticalScrollIndicator={false}
                >
                  {AGE_YEARS_OPTIONS.map((y) => {
                    const selected = ageYears === String(y);
                    return (
                      <SelectableChip
                        key={y}
                        selected={selected}
                        style={[styles.ageItem, selected && styles.ageItemSelected]}
                        scaleTo={motion.scale.press}
                        onPress={() => setAgeYears(selected ? '' : String(y))}
                      >
                        <Text style={[styles.ageItemText, selected && styles.ageItemTextSelected]}>
                          {y}
                        </Text>
                      </SelectableChip>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={styles.ageColumn}>
                <Text style={styles.ageColumnLabel}>Months</Text>
                <ScrollView
                  style={styles.ageColumnScroll}
                  showsVerticalScrollIndicator={false}
                >
                  {AGE_MONTHS_OPTIONS.map((m) => {
                    const selected = ageMonths === String(m);
                    return (
                      <SelectableChip
                        key={m}
                        selected={selected}
                        style={[styles.ageItem, selected && styles.ageItemSelected]}
                        scaleTo={motion.scale.press}
                        onPress={() => setAgeMonths(selected ? '' : String(m))}
                      >
                        <Text style={[styles.ageItemText, selected && styles.ageItemTextSelected]}>
                          {m}
                        </Text>
                      </SelectableChip>
                    );
                  })}
                </ScrollView>
              </View>
            </View>

            <PawtchiButton title="Done" variant="primary" onPress={closeAgeModal} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  // Bottom clearance is the scaffold's — it has to clear whichever bar is up.
  scrollContent: { paddingHorizontal: space.xxl },

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
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    height: 56,
  },
  selectInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
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
  gridCellWide: { flex: 1.35 },
  ageSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    height: 56,
    paddingHorizontal: 14,
  },
  ageSelectText: {
    flex: 1,
    fontFamily: font.bold,
    fontSize: 15.5,
    color: color.ink,
  },
  // Type only — the box is TextField's (lib/ui/textFieldLayout.ts).
  numInputType: {
    fontFamily: font.bold,
  },
  numInputError: { borderColor: color.error },
  numInputWarn: { borderColor: color.alert },

  errorText: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.error,
    marginTop: -8,
    marginBottom: space.md,
  },
  warnText: { color: color.alert },
  fieldJustification: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: color.slateFaint,
    marginTop: -6,
    marginBottom: space.lg,
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
    ...makeShadow(-6, 14, 0.06),
  },
  engineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  engineText: {
    fontFamily: font.semibold,
    fontSize: 11.5,
    color: color.navy,
  },
  engineDots: {
    flexDirection: 'row',
    gap: 5,
    marginLeft: 'auto',
  },
  engineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.track,
  },
  engineDotOn: {
    backgroundColor: color.yellow,
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

  // Age picker sheet
  ageColumns: {
    flexDirection: 'row',
    gap: space.md,
    marginBottom: space.lg,
  },
  ageColumn: { flex: 1 },
  ageColumnLabel: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slate,
    textAlign: 'center',
    marginBottom: space.sm,
  },
  ageColumnScroll: {
    maxHeight: 300,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  ageItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginHorizontal: 6,
    marginVertical: 2,
    borderRadius: radius.md,
  },
  ageItemSelected: {
    backgroundColor: color.yellow,
  },
  ageItemText: {
    fontFamily: font.medium,
    fontSize: 16,
    color: color.slate,
  },
  ageItemTextSelected: {
    fontFamily: font.bold,
    color: color.navy,
  },
});
