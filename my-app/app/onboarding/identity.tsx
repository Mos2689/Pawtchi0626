import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Modal, Pressable,
  type GestureResponderEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { prepareImageForUpload } from '../../lib/imagePrep';
import Animated, {
  FadeIn, FadeInDown,
  useSharedValue, useAnimatedStyle, useAnimatedProps,
  withSequence, withSpring, withTiming, Easing,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { color, font, radius, space, motion, makeShadow } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { usePetStore } from '../../store/usePetStore';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SelectableChip } from '../../components/SelectableChip';
import { TextField } from '../../components/ui/TextField';
import { BreedPickerModal } from '../../components/BreedPickerModal';
import { OnboardingHeader } from '../../components/OnboardingHeader';
import {
  OnboardingFormScaffold, ScaffoldField,
} from '../../components/onboarding/OnboardingFormScaffold';

import { supabase } from '../../lib/supabase';
import { errorCopy, reportError, toAppError } from '../../lib/appError';
import { track } from '../../lib/analytics';
import {
  stepIndex, trackFieldSkipped, trackStepCompleted, useOnboardingStepTracking,
} from '../../lib/onboardingFunnel';
import { createLightweightPet, uploadPetAvatar } from '../../lib/onboarding/petProfile';
import { useActivePetStore } from '../../store/useActivePetStore';

/**
 * Age as a short list of taps rather than a number pad.
 *
 * Age only has to be good enough to pick a life stage and seed the Walksign —
 * asking a new owner to be precise on the second screen of the app is friction
 * for accuracy nobody needs yet. The health flow collects exact years+months
 * later, when it genuinely matters for calorie maths.
 */
const AGE_CHOICES: { label: string; years: number }[] = [
  { label: 'Puppy', years: 0.5 },
  { label: '1', years: 1 },
  { label: '2', years: 2 },
  { label: '3', years: 3 },
  { label: '4', years: 4 },
  { label: '5', years: 5 },
  { label: '6', years: 6 },
  { label: '7', years: 7 },
  { label: '8', years: 8 },
  { label: '9', years: 9 },
  { label: '10+', years: 10 },
];

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Ring geometry for the photo-arrival sweep around the 128px avatar.
const RING_R = 66;
const RING_C = 2 * Math.PI * RING_R;

// Step 2 of 6 — the emotional commitment. Name + photo first; this is what
// makes Bunny *Bunny* in the user's head. The vet-scan autofill rides along as
// a quiet affordance, no longer its own step.
export default function IdentityScreen() {
  const router = useRouter();
  useOnboardingStepTracking('identity');

  const {
    species,
    name, setName,
    imageUri, setImageUri,
    firstDog, setFirstDog,
    householdWalkers, setHouseholdWalkers,
    breed, setBreed,
    ageYears, setAgeYears,
    resetForm,
  } = usePetStore();

  const [nameError, setNameError] = useState<string | null>(null);
  // Dogs create their pet row on this screen, so this screen can now fail.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [breedModalVisible, setBreedModalVisible] = useState(false);
  const [ageModalVisible, setAgeModalVisible] = useState(false);

  const trimmedName = name.trim();
  const canContinue = trimmedName.length > 0;

  /**
   * What the age select shows.
   *
   * Reads back the AGE_CHOICES entry rather than formatting the raw number:
   * 0.5 is "Puppy" to the owner, not "0.5 yrs". Null when unset, so the select
   * falls through to its placeholder.
   */
  const ageLabel = (() => {
    if (!ageYears) return null;
    const choice = AGE_CHOICES.find((c) => String(c.years) === ageYears);
    if (!choice) return null;
    if (choice.label === 'Puppy') return 'Puppy (under 1)';
    return choice.label === '1' ? '1 yr' : `${choice.label} yrs`;
  })();

  // The title greets the pet by name once one exists — debounced so it flips
  // when the user pauses, not on every keystroke.
  const [hasName, setHasName] = useState(trimmedName.length > 0);
  useEffect(() => {
    const t = setTimeout(() => setHasName(trimmedName.length > 0), 300);
    return () => clearTimeout(t);
  }, [trimmedName]);

  // No autofocus: the keyboard covered the photo picker and Continue button on
  // mount, hiding half the screen. It opens only when the user taps the field.

  // Photo-arrival ceremony: yellow ring sweeps around the avatar while the
  // surface pops — the pet "arrives" rather than appearing.
  const ringProgress = useSharedValue(imageUri ? 1 : 0);
  const avatarPop = useSharedValue(1);
  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_C * (1 - ringProgress.value),
  }));
  const avatarPopStyle = useAnimatedStyle(() => ({
    transform: [{ scale: avatarPop.value }],
  }));

  const pickAvatar = async () => {
    track('ui_button_tapped', { button_name: 'pick_avatar', screen: 'identity' });
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      // Downscale now so whatever uploads this later ships ~100 KB, not a
      // full camera-roll frame. Falls back to the original uri on failure.
      const prepared = await prepareImageForUpload(result.assets[0]);
      setImageUri(prepared.uri);
      haptic.success();
      ringProgress.value = 0;
      ringProgress.value = withTiming(1, {
        duration: motion.duration.ring,
        easing: Easing.out(Easing.cubic),
      });
      avatarPop.value = withSequence(
        withSpring(1.06, motion.spring.bouncy),
        withSpring(1, motion.spring.gentle),
      );
    }
  };

  const handleContinue = async () => {
    if (!canContinue) {
      setNameError(`What do you call your ${species || 'pet'}?`);
      haptic.warning();
      return;
    }
    if (!imageUri) trackFieldSkipped('identity', 'photo');
    if (species === 'dog' && firstDog === null) trackFieldSkipped('identity', 'first_dog');
    if (species === 'dog' && householdWalkers === null) {
      trackFieldSkipped('identity', 'household_walkers');
    }
    trackStepCompleted('identity', {
      has_photo: !!imageUri,
      household_walkers_answered: householdWalkers !== null,
    });

    // ── Cats keep the health-first flow ───────────────────────────────────
    // Walk is dogs-only, so a cat has nothing to enter the app *for* yet; the
    // calorie plan is the whole product for them. Their pet row is still
    // created at the end of that flow, which is also what lets a cat owner
    // who quits half way resume cleanly instead of landing in the app with a
    // half-built profile.
    if (species !== 'dog') {
      router.push('/onboarding/body-basics' as any);
      return;
    }

    // ── Dogs stop here ────────────────────────────────────────────────────
    // Everything a walk needs is now known. The remaining screens only feed a
    // calorie target, so they move behind the health gate and this owner goes
    // straight to the map.
    setSaving(true);
    setSaveError(null);

    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) {
      setSaving(false);
      setSaveError('We could not find your account. Try signing in again.');
      haptic.warning();
      return;
    }

    // A failed upload is non-fatal — the row falls back to the stock image.
    const imageUrl = await uploadPetAvatar(userId, imageUri);
    const parsedAge = parseFloat(ageYears);

    const { petId, error, walksign } = await createLightweightPet({
      ownerId: userId,
      species: 'dog',
      name: trimmedName,
      breed: breed?.trim() || null,
      ageYears: Number.isFinite(parsedAge) && parsedAge > 0 ? parsedAge : null,
      imageUrl,
      firstDog,
      householdWalkers,
    });

    if (error || !petId) {
      setSaving(false);
      const appErr = toAppError(error);
      reportError(appErr, 'pet_save');
      track('onboarding_pet_create_failed', { reason: appErr.kind });
      haptic.warning();
      setSaveError(errorCopy(appErr, { context: 'pet_save', petName: trimmedName }).message);
      return;
    }

    if (walksign) {
      track('walksign_assigned', { sign: walksign, status: 'provisional', reason: 'onboarding' });
    }
    track('onboarding_lightweight_completed', {
      has_photo: !!imageUri,
      has_breed: !!breed?.trim(),
      has_age: Number.isFinite(parsedAge) && parsedAge > 0,
    });

    // Hydrate before navigating — the (tabs) layout redirects back to
    // onboarding while activePet is null, so arriving un-hydrated would bounce
    // the owner straight back to the screen they just left.
    await useActivePetStore.getState().fetchPet(userId);
    resetForm();
    setSaving(false);
    router.replace('/(tabs)' as any);
  };

  return (
    <View style={styles.container}>
      {/* Now the FIRST screen — the species picker before it was retired, so
          there is nothing behind this and the back chevron is suppressed.

          Dogs finish here, so the bar completes here too and the counter drops
          its denominator. The cat branch is unreachable from onboarding now,
          but the conditional stays: it costs nothing and it is what would keep
          the header honest if a second species is ever reintroduced. */}
      <OnboardingHeader
        step={stepIndex('identity')}
        stepId="identity"
        showBack={false}
        total={species === 'dog' ? stepIndex('identity') : undefined}
        showTotal={species !== 'dog'}
      />

      <OnboardingFormScaffold
        contentContainerStyle={styles.scrollContent}
        footer={
          <View style={styles.sticky}>
            {saveError && <Text style={styles.errorText}>{saveError}</Text>}
            <PawtchiButton
              title={species === 'dog' ? 'Start walking' : 'Continue'}
              variant="primary"
              iconName="arrow-forward"
              iconPosition="right"
              onPress={handleContinue}
              disabled={!canContinue || saving}
              loading={saving}
            />
          </View>
        }
      >
          {/* No "STEP 1" eyebrow. The header directly above already prints the
              step and draws the progress bar, so it said the same thing twice
              and pushed the greeting a third of the way down the screen. */}
          <Animated.View entering={FadeInDown.duration(420)}>
            {/* The handover moment: the app learns the name and immediately
                starts using it. Key on the flip so the swap crossfades once. */}
            <View style={styles.titleWrap}>
              {/* One line in both states, which is what lets the reserved
                  two-line box go away. It was there so the block below wouldn't
                  jump when the greeting swapped from two lines to one — that
                  swap lands 300ms after the owner stops typing, with the
                  keyboard up, so a 40pt shift would move the field under their
                  finger. Same line count either way means nothing to reserve
                  and nothing to jump; adjustsFontSizeToFit handles the narrow
                  screens where the longer greeting won't fit at 40pt. */}
              <Animated.Text
                key={hasName ? 'named' : 'anon'}
                entering={FadeIn.duration(motion.duration.base)}
                style={styles.title}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {hasName ? `Hi, ${trimmedName}.` : 'Who are we meeting?'}
              </Animated.Text>
            </View>
          </Animated.View>

          {/* Avatar — the emotional anchor of this step */}
          <Animated.View entering={FadeInDown.duration(420).delay(60)} style={styles.avatarBlock}>
            <Animated.View style={avatarPopStyle}>
              <TouchableOpacity onPress={pickAvatar} activeOpacity={0.85} style={styles.avatarPicker}>
                {imageUri ? (
                  <Image source={{ uri: imageUri }} style={styles.avatarImg} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <MaterialIcons name="add-a-photo" size={32} color={color.slateFaint} />
                    <Text style={styles.avatarHint}>Add a photo</Text>
                  </View>
                )}
                {imageUri && (
                  <Svg width={144} height={144} viewBox="0 0 144 144" style={styles.avatarRing} pointerEvents="none">
                    <AnimatedCircle
                      cx={72}
                      cy={72}
                      r={RING_R}
                      stroke={color.yellow}
                      strokeWidth={3}
                      strokeLinecap="round"
                      fill="none"
                      strokeDasharray={`${RING_C}`}
                      animatedProps={ringProps}
                      transform="rotate(-90 72 72)"
                    />
                  </Svg>
                )}
                <View style={styles.avatarBadge}>
                  <MaterialIcons name={imageUri ? 'edit' : 'add'} size={14} color={color.navy} />
                </View>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>

          {/* Name — the required field */}
          <Animated.View entering={FadeInDown.duration(420).delay(120)} style={styles.formGroup}>
            <Text style={styles.label}>Pet name</Text>
            <ScaffoldField id="name" label="Pet name">
              {({ onFocus, onBlur }) => (
                <TextField
                  error={!!nameError}
                  placeholder={species === 'cat' ? 'e.g. Luna' : 'e.g. Bunny'}
                  value={name}
                  onChangeText={(v) => { if (nameError) setNameError(null); setName(v); }}
                  onFocus={onFocus}
                  onBlur={onBlur}
                  returnKeyType="done"
                />
              )}
            </ScaffoldField>
            {nameError && <Text style={styles.errorText}>{nameError}</Text>}
          </Animated.View>

          {/* ── Group one: the dog ───────────────────────────────────────────
              Breed and age feed walk pace calibration and the provisional
              Walksign, and both are optional: a dog with neither still walks,
              just with generic defaults.

              They sit in a labelled group rather than in the flat column they
              used to share with the two walk questions below. Five questions at
              identical weight read as a survey — nothing said which mattered,
              which were optional, or what any of them were for. The group
              carries the "why" once instead of a hint under every row. */}
          {species === 'dog' && (
            <Animated.View entering={FadeInDown.duration(420).delay(135)} style={styles.group}>
              <Text style={styles.groupEyebrow}>ABOUT {(trimmedName || 'YOUR DOG').toUpperCase()}</Text>
              <Text style={styles.groupPurpose}>
                Both optional — they sharpen what Pawtchi expects on a walk.
              </Text>

              <Text style={styles.label}>Breed</Text>
              {/* The same sheet the health flow uses — searchable presets with
                  free text as a fallback. A plain text field here would let
                  "lab" and "Labrador Retriever" both reach the breed lookup
                  that pace calibration and the calorie modifier read. */}
              <TouchableOpacity
                style={styles.groupSelect}
                onPress={() => setBreedModalVisible(true)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={breed ? `Breed: ${breed}` : 'Select breed'}
              >
                <View style={styles.selectRow}>
                  <Text style={breed ? styles.inputValue : styles.inputPlaceholder} numberOfLines={1}>
                    {breed || 'Select a breed'}
                  </Text>
                  <MaterialIcons name="expand-more" size={22} color={color.slateFaint} />
                </View>
              </TouchableOpacity>

              {/* Age was a horizontal chip rail. Eleven choices in a row that
                  clipped at the screen edge with no fade and no indicator, so
                  seven of them were invisible and nothing said to scroll — an
                  owner with an eight-year-old dog could reasonably conclude the
                  option wasn't there. A select shows the chosen value and hides
                  nothing; the same eleven choices live in the sheet. */}
              <Text style={[styles.label, styles.labelSpaced]}>Age</Text>
              <TouchableOpacity
                style={styles.groupSelect}
                onPress={() => { haptic.select(); setAgeModalVisible(true); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={ageLabel ? `Age: ${ageLabel}` : 'Add age'}
              >
                <View style={styles.selectRow}>
                  <Text style={ageLabel ? styles.inputValue : styles.inputPlaceholder} numberOfLines={1}>
                    {ageLabel ?? 'Add age'}
                  </Text>
                  <MaterialIcons name="expand-more" size={22} color={color.slateFaint} />
                </View>
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* ── Group two: the walks ─────────────────────────────────────────
              First dog seeds the Walksign's Newbond reading; the walker count
              is the Packheart signal. Both are skippable and cost nothing
              downstream — which is exactly why they need to say what they are
              for, or they read as data collection for its own sake. */}
          {species === 'dog' && (
            <Animated.View entering={FadeInDown.duration(420).delay(150)} style={styles.group}>
              <Text style={styles.groupEyebrow}>ABOUT YOUR WALKS</Text>
              <Text style={styles.groupPurpose}>
                Both optional — they shape what Pawtchi notices out there.
              </Text>

              <Text style={styles.label}>
                {trimmedName ? `Is ${trimmedName} your first dog?` : 'Your first dog?'}
              </Text>
              <View style={styles.firstDogRow}>
                <SelectableChip
                  selected={firstDog === true}
                  onPress={() => setFirstDog(firstDog === true ? null : true)}
                  style={styles.firstDogChip}
                  selectedStyle={styles.firstDogChipSelected}
                >
                  <Text style={[styles.firstDogChipText, firstDog === true && styles.firstDogChipTextSelected]}>
                    My first
                  </Text>
                </SelectableChip>
                <SelectableChip
                  selected={firstDog === false}
                  onPress={() => setFirstDog(firstDog === false ? null : false)}
                  style={styles.firstDogChip}
                  selectedStyle={styles.firstDogChipSelected}
                >
                  <Text style={[styles.firstDogChipText, firstDog === false && styles.firstDogChipTextSelected]}>
                    There have been others
                  </Text>
                </SelectableChip>
              </View>

              {/* Packheart signal — parallel to the first-dog question and
                  equally skippable. We store the thresholded household size,
                  not a claim inferred from whose phone happened to track the
                  walk. It shares this group because it is the same kind of
                  question: about the walking, not about the dog. */}
              <Text style={[styles.label, styles.labelSpaced]}>
                {trimmedName
                  ? `Who regularly walks ${trimmedName}?`
                  : 'Who regularly walks your dog?'}
              </Text>
              <View style={styles.firstDogRow}>
                <SelectableChip
                  selected={householdWalkers === 1}
                  onPress={() =>
                    setHouseholdWalkers(householdWalkers === 1 ? null : 1)
                  }
                  style={styles.firstDogChip}
                  selectedStyle={styles.firstDogChipSelected}
                >
                  <Text
                    style={[
                      styles.firstDogChipText,
                      householdWalkers === 1 &&
                        styles.firstDogChipTextSelected,
                    ]}
                  >
                    One or two of us
                  </Text>
                </SelectableChip>
                <SelectableChip
                  selected={householdWalkers === 3}
                  onPress={() =>
                    setHouseholdWalkers(householdWalkers === 3 ? null : 3)
                  }
                  style={styles.firstDogChip}
                  selectedStyle={styles.firstDogChipSelected}
                >
                  <Text
                    style={[
                      styles.firstDogChipText,
                      householdWalkers === 3 &&
                        styles.firstDogChipTextSelected,
                    ]}
                  >
                    Three or more
                  </Text>
                </SelectableChip>
              </View>
            </Animated.View>
          )}

      </OnboardingFormScaffold>
      <BreedPickerModal
        visible={breedModalVisible}
        species={species}
        value={breed}
        onSelect={setBreed}
        onClose={() => setBreedModalVisible(false)}
      />

      {/* Age sheet — the same eleven AGE_CHOICES the chip rail held, in a list
          that can't clip. Tapping a value picks and closes; tapping the current
          value clears it, which is what the chips did too. */}
      <Modal
        visible={ageModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setAgeModalVisible(false)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setAgeModalVisible(false)}>
          {/* Swallows taps on the sheet itself so they don't reach the overlay
              behind it and dismiss what the owner is trying to use. */}
          <Pressable style={styles.sheet} onPress={(e: GestureResponderEvent) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {trimmedName ? `How old is ${trimmedName}?` : 'How old are they?'}
              </Text>
              <TouchableOpacity
                onPress={() => setAgeModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialIcons name="close" size={22} color={color.ink} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={styles.sheetScroll}>
              {AGE_CHOICES.map(({ label, years }) => {
                const selected = ageYears === String(years);
                return (
                  <SelectableChip
                    key={label}
                    selected={selected}
                    style={[styles.ageRow, selected && styles.ageRowSelected]}
                    scaleTo={motion.scale.press}
                    onPress={() => {
                      setAgeYears(selected ? '' : String(years));
                      setAgeModalVisible(false);
                    }}
                  >
                    <Text style={[styles.ageRowText, selected && styles.ageRowTextSelected]}>
                      {label === 'Puppy' ? 'Puppy (under 1)' : label}
                    </Text>
                    {selected && <MaterialIcons name="check" size={18} color={color.navy} />}
                  </SelectableChip>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  // Bottom clearance is the scaffold's — it has to clear whichever bar is up.
  scrollContent: { paddingHorizontal: space.xxl },

  // No reserved height any more: the greeting is one line in both states, so
  // there is nothing to reserve. It used to hold two lines and anchor the
  // greeting to the bottom of them, which is what put a block of empty space
  // under the progress bar.
  titleWrap: {
    marginTop: space.lg,
  },
  title: {
    fontFamily: font.display,
    fontSize: 40,
    lineHeight: 40,
    letterSpacing: 0.5,
    color: color.ink,
  },

  // Avatar
  avatarBlock: { alignItems: 'center', marginTop: space.xxxl, marginBottom: space.xl },
  avatarPicker: { width: 128, height: 128, position: 'relative' },
  avatarImg: { width: 128, height: 128, borderRadius: 64 },
  avatarPlaceholder: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1.5,
    borderColor: color.hairline,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  avatarHint: {
    fontFamily: font.medium,
    fontSize: 11,
    color: color.slateFaint,
  },
  avatarRing: {
    position: 'absolute',
    top: -8,
    left: -8,
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: color.surface,
  },

  // Form
  formGroup: { marginBottom: space.lg },
  // The question. Deliberately the darkest, heaviest text in its block — the
  // options below it must never out-weigh it, which is exactly what happened
  // when this and the chip text were the same family, size, weight and colour.
  label: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.ink,
    marginBottom: space.sm,
  },
  labelSpaced: {
    marginTop: space.lg,
  },
  // ── Grouped optional questions ────────────────────────────────────────────
  // A quiet raised panel, not a card: the group has to read as "these belong
  // together and here is why" without competing with the name field above it,
  // which is the only required thing on this screen.
  group: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
    marginBottom: space.lg,
  },
  groupEyebrow: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 1.8,
    color: color.slateFaint,
  },
  groupPurpose: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.slateMuted,
    marginTop: 3,
    marginBottom: space.lg,
  },
  // Inside a group the panel is already the tinted surface, so the controls
  // invert to white or they disappear into their own container.
  groupSelect: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    minHeight: 52,
    justifyContent: 'center',
    paddingVertical: 10,
  },

  // ── Age sheet ─────────────────────────────────────────────────────────────
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 32, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
    paddingBottom: space.xxxl,
    maxHeight: '70%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  sheetTitle: {
    flex: 1,
    fontFamily: font.bold,
    fontSize: 17,
    color: color.ink,
    letterSpacing: -0.2,
    marginRight: space.md,
  },
  sheetScroll: { flexGrow: 0 },
  ageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    marginBottom: space.sm,
  },
  ageRowSelected: {
    backgroundColor: color.yellowSoft,
    borderColor: color.yellow,
  },
  ageRowText: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: color.ink,
  },
  ageRowTextSelected: { color: color.navy },

  // The select fields' Text, in its two states. A Text inside a centred wrapper
  // does centre correctly — which is why that field always looked right.
  inputValue: {
    fontFamily: font.medium,
    fontSize: 16,
    color: color.ink,
  },
  inputPlaceholder: {
    fontFamily: font.medium,
    fontSize: 16,
    color: color.slateFaint,
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  errorText: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.error,
    marginTop: 6,
  },

  // First-dog chips
  firstDogRow: { flexDirection: 'row', gap: 8, marginBottom: space.xs },
  // White, like the selects in the group above. These used to be filled with
  // surfaceSubtle — the group panel's own colour — so they read as flat text
  // on the panel rather than as things you tap.
  firstDogChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: 11,
  },
  firstDogChipSelected: {
    backgroundColor: color.navy,
    borderColor: color.navy,
  },
  // Medium, not semibold: the option is an answer, the label above is the
  // question. If these two ever match again, the hierarchy is gone.
  firstDogChipText: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.slate,
  },
  firstDogChipTextSelected: {
    fontFamily: font.semibold,
    color: color.cream,
  },

  // Vet-scan card

  // Sticky CTA plinth
  sticky: {
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    backgroundColor: color.surface,
    ...makeShadow(-6, 14, 0.06),
  },
});
