import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Image,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { prepareImageForUpload } from '../../lib/imagePrep';
import Animated, {
  FadeIn, FadeInDown, ZoomIn,
  useSharedValue, useAnimatedStyle, useAnimatedProps,
  withSequence, withSpring, withTiming, Easing,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { color, font, radius, space, motion, makeShadow } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { usePetStore } from '../../store/usePetStore';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SelectableChip } from '../../components/SelectableChip';
import { OnboardingHeader } from '../../components/OnboardingHeader';
import { PawLoader } from '../../components/loader/PawLoader';
import { supabase } from '../../lib/supabase';
import { withTimeout } from '../../lib/withTimeout';
import {
  errorCopy, extractInvokeErrorCode, fromEdgeBody, isAppError, reportError, toAppError,
} from '../../lib/appError';
import { track } from '../../lib/analytics';
import {
  stepIndex, trackFieldSkipped, trackStepCompleted, useOnboardingStepTracking,
} from '../../lib/onboardingFunnel';

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
    // The fields the vet scan can populate downstream:
    setBreed, setGender, setIsNeutered, setWeight, setAgeYears, setAgeMonths,
    setAllergies, setMedicalConditions, setBodyConditionScore, setBcsSource,
  } = usePetStore();

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanFilled, setScanFilled] = useState<number | null>(null);
  const [scanFilledFields, setScanFilledFields] = useState<string[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canContinue = trimmedName.length > 0;

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

  const handleVetScan = async (source: 'camera' | 'gallery') => {
    track('onboarding_vet_scan_started', { source });
    setScanError(null);
    setScanFilled(null);
    setScanFilledFields([]);

    const options: ImagePicker.ImagePickerOptions = {
      base64: true,
      quality: 0.6,
      allowsEditing: false,
      mediaTypes: ['images'],
    };

    let result;
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setScanError('Camera permission is needed to scan the report.');
        return;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }
    if (result.canceled || !result.assets?.[0]?.base64) return;
    // Downscale before the network round trip; falls back to the picker's
    // original base64 when the manipulator can't process the image.
    const asset = await prepareImageForUpload(result.assets[0]);

    setScanning(true);
    try {
      const base64 = asset.base64!;
      const mimeType = asset.downscaled
        ? asset.mimeType
        : asset.uri.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const { data, error } = await withTimeout(
        supabase.functions.invoke('parse-onboarding-report', {
          body: { imageBase64: base64, mimeType, species: species || 'dog' },
        }),
        45_000,
        'parse-onboarding-report',
      );
      if (error) throw error;
      if (!data?.success) throw fromEdgeBody(data) ?? new Error('scan returned no data');

      const extracted = data.data || {};
      let filled = 0;
      const filledLabels: string[] = [];
      if (extracted.name) { setName(extracted.name); filled++; filledLabels.push('name'); }
      if (extracted.breed) { setBreed(extracted.breed); filled++; filledLabels.push('breed'); }
      if (extracted.gender) { setGender(extracted.gender); filled++; filledLabels.push('sex'); }
      if (extracted.is_neutered !== null && extracted.is_neutered !== undefined) { setIsNeutered(extracted.is_neutered); filledLabels.push('desexed'); }
      if (extracted.weight_kg) { setWeight(String(Math.round(extracted.weight_kg * 10) / 10)); filled++; filledLabels.push('weight'); }
      if (extracted.age_years !== null && extracted.age_years !== undefined) { setAgeYears(String(extracted.age_years)); filled++; filledLabels.push('age'); }
      if (extracted.age_months !== null && extracted.age_months !== undefined) setAgeMonths(String(extracted.age_months));
      if (extracted.allergies && extracted.allergies.length > 0) { setAllergies(extracted.allergies); filledLabels.push('allergies'); }
      if (extracted.medical_conditions && extracted.medical_conditions.length > 0) { setMedicalConditions(extracted.medical_conditions); filledLabels.push('conditions'); }
      if (extracted.body_condition_score) {
        setBodyConditionScore(extracted.body_condition_score);
        setBcsSource('vet_report');
        filledLabels.push('body condition');
      }

      setScanFilled(filled);
      setScanFilledFields(filledLabels);
      track('onboarding_vet_scan_succeeded', { filled });
      haptic.success();
    } catch (err: unknown) {
      const appErr = isAppError(err)
        ? err
        : toAppError(err, { errorCode: await extractInvokeErrorCode(err) });
      reportError(appErr, 'vet_scan');
      track('onboarding_vet_scan_failed', { reason: appErr.kind });
      setScanError(errorCopy(appErr, { context: 'vet_scan', petName: name }).message);
    } finally {
      setScanning(false);
    }
  };

  const handleContinue = () => {
    if (!canContinue) {
      setNameError(`What do you call your ${species || 'pet'}?`);
      haptic.warning();
      return;
    }
    if (!imageUri) trackFieldSkipped('identity', 'photo');
    if (species === 'dog' && firstDog === null) trackFieldSkipped('identity', 'first_dog');
    trackStepCompleted('identity', { has_photo: !!imageUri, used_vet_scan: scanFilled !== null });
    router.push('/onboarding/body-basics' as any);
  };

  return (
    <View style={styles.container}>
      <OnboardingHeader step={stepIndex('identity')} stepId="identity" />

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
            <Text style={styles.eyebrow}>STEP {stepIndex('identity')}</Text>
            {/* The handover moment: the app learns the name and immediately
                starts using it. Key on the flip so the swap crossfades once. */}
            <View style={styles.titleWrap}>
              <Animated.Text
                key={hasName ? 'named' : 'anon'}
                entering={FadeIn.duration(motion.duration.base)}
                style={styles.title}
                numberOfLines={2}
                adjustsFontSizeToFit
              >
                {hasName ? `Hi, ${trimmedName}.` : `Who are we\nmeeting?`}
              </Animated.Text>
            </View>
            <Text style={styles.subtitle}>
              A name and a photo — so Pawtchi talks to your pet, not to "your pet."
            </Text>
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
            <View style={[styles.inputWrap, nameError && styles.inputWrapError]}>
              <TextInput
                style={styles.input}
                placeholder={species === 'cat' ? 'e.g. Luna' : 'e.g. Bunny'}
                placeholderTextColor={color.slateFaint}
                value={name}
                onChangeText={(v) => { if (nameError) setNameError(null); setName(v); }}
                returnKeyType="done"
              />
            </View>
            {nameError && <Text style={styles.errorText}>{nameError}</Text>}
          </Animated.View>

          {/* First dog — one quiet, skippable fact. It seeds the Walksign's
              Newbond reading; skipping it costs nothing downstream. */}
          {species === 'dog' && (
            <Animated.View entering={FadeInDown.duration(420).delay(150)} style={styles.formGroup}>
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
            </Animated.View>
          )}

          {/* Vet-scan autofill — quiet, optional, inline */}
          <Animated.View entering={FadeInDown.duration(420).delay(180)} style={styles.scanCard}>
            <View style={styles.scanHead}>
              <View style={styles.scanIcon}>
                <MaterialIcons name="document-scanner" size={17} color={color.navy} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.scanTitle}>Have a vet report?</Text>
                <Text style={styles.scanSub}>
                  Pawtchi can pull the breed, age, weight and more from the photo.
                </Text>
              </View>
            </View>
            {scanFilled !== null && !scanError && scanFilledFields.length > 0 && (
              <View style={styles.scanChipsWrap}>
                {scanFilledFields.map((field, i) => (
                  <Animated.View
                    key={field}
                    entering={ZoomIn.springify()
                      .damping(motion.spring.bouncy.damping)
                      .stiffness(motion.spring.bouncy.stiffness)
                      .delay(i * 80)}
                    style={styles.scanChip}
                  >
                    <MaterialIcons name="check" size={12} color={color.success} />
                    <Text style={styles.scanChipText}>{field}</Text>
                  </Animated.View>
                ))}
                <Text style={styles.scanReviewNote}>Review on the next screens.</Text>
              </View>
            )}
            {scanFilled !== null && scanFilledFields.length === 0 && !scanError && (
              <View style={styles.scanSuccess}>
                <MaterialIcons name="check-circle" size={14} color={color.success} />
                <Text style={styles.scanSuccessText}>
                  No details found in that image — you can fill them in on the next screens.
                </Text>
              </View>
            )}
            {scanError && (
              <View style={styles.scanError}>
                <MaterialIcons name="error-outline" size={14} color={color.error} />
                <Text style={styles.scanErrorText}>{scanError}</Text>
              </View>
            )}
            <View style={styles.scanActions}>
              <TouchableOpacity
                style={[styles.scanBtn, scanning && styles.scanBtnDisabled]}
                onPress={() => handleVetScan('gallery')}
                disabled={scanning}
                activeOpacity={0.85}
              >
                <MaterialIcons name="photo-library" size={15} color={color.navy} />
                <Text style={styles.scanBtnText}>Photo library</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.scanBtn, scanning && styles.scanBtnDisabled]}
                onPress={() => handleVetScan('camera')}
                disabled={scanning}
                activeOpacity={0.85}
              >
                <MaterialIcons name="photo-camera" size={15} color={color.navy} />
                <Text style={styles.scanBtnText}>Camera</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </ScrollView>

        {/* Sticky continue */}
        <View style={styles.sticky}>
          <PawtchiButton
            title="Continue"
            variant="primary"
            iconName="arrow-forward"
            iconPosition="right"
            onPress={handleContinue}
            disabled={!canContinue}
          />
        </View>
      </KeyboardAvoidingView>
      <PawLoader visible={scanning} message="Scanning vet report…" />
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
  titleWrap: {
    // Two display lines — fixed so the greeting swap doesn't shift the layout.
    minHeight: 80,
    justifyContent: 'flex-end',
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
    maxWidth: 320,
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
  label: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slate,
    marginBottom: space.sm,
  },
  inputWrap: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    height: 56,
    justifyContent: 'center',
  },
  inputWrapError: { borderColor: color.error },
  input: {
    fontFamily: font.medium,
    fontSize: 16,
    color: color.ink,
  },
  errorText: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.error,
    marginTop: 6,
  },

  // First-dog chips
  firstDogRow: { flexDirection: 'row', gap: 8 },
  firstDogChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
  },
  firstDogChipSelected: {
    backgroundColor: color.navy,
    borderColor: color.navy,
  },
  firstDogChipText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slate,
  },
  firstDogChipTextSelected: {
    color: color.cream,
  },

  // Vet-scan card
  scanCard: {
    marginTop: space.lg,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
  },
  scanHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  scanIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanTitle: { fontFamily: font.bold, fontSize: 14, color: color.ink },
  scanSub: {
    fontFamily: font.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.slateMuted,
    marginTop: 3,
  },
  scanSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: space.md,
    backgroundColor: 'rgba(22, 163, 74, 0.10)',
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  scanSuccessText: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.success,
  },
  scanChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: space.md,
  },
  scanChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: color.successSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  scanChipText: {
    fontFamily: font.semibold,
    fontSize: 11.5,
    color: color.success,
  },
  scanReviewNote: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: color.slateFaint,
    marginLeft: 2,
  },
  scanError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: space.md,
    backgroundColor: color.errorSoft,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  scanErrorText: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.error,
  },
  scanActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: space.md,
  },
  scanBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.pill,
    paddingVertical: 10,
  },
  scanBtnDisabled: { opacity: 0.5 },
  scanBtnText: {
    fontFamily: font.bold,
    fontSize: 12.5,
    color: color.navy,
  },

  // Sticky CTA plinth
  sticky: {
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    backgroundColor: color.surface,
    ...makeShadow(-6, 14, 0.06),
  },
});
