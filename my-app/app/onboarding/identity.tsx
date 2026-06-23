import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { color, font, radius, space } from '../../constants/design';
import { usePetStore } from '../../store/usePetStore';
import { PawtchiButton } from '../../components/PawtchiButton';
import { OnboardingHeader } from '../../components/OnboardingHeader';
import { supabase } from '../../lib/supabase';
import { track } from '../../lib/analytics';
import {
  stepIndex, trackFieldSkipped, trackStepCompleted, useOnboardingStepTracking,
} from '../../lib/onboardingFunnel';

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
    // The fields the vet scan can populate downstream:
    setBreed, setGender, setIsNeutered, setWeight, setAgeYears, setAgeMonths,
    setAllergies, setMedicalConditions, setBodyConditionScore,
  } = usePetStore();

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanFilled, setScanFilled] = useState<number | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canContinue = trimmedName.length > 0;

  const pickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      Haptics.selectionAsync();
      setImageUri(result.assets[0].uri);
    }
  };

  const handleVetScan = async (source: 'camera' | 'gallery') => {
    track('onboarding_vet_scan_started', { source });
    setScanError(null);
    setScanFilled(null);

    const options: ImagePicker.ImagePickerOptions = {
      base64: true,
      quality: 0.7,
      allowsEditing: true,
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
    const asset = result.assets[0];

    setScanning(true);
    try {
      const base64 = asset.base64!;
      const mimeType = asset.uri.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const { data, error } = await supabase.functions.invoke('parse-onboarding-report', {
        body: { imageBase64: base64, mimeType, species: species || 'dog' },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to parse report');

      const extracted = data.data || {};
      let filled = 0;
      if (extracted.name) { setName(extracted.name); filled++; }
      if (extracted.breed) { setBreed(extracted.breed); filled++; }
      if (extracted.gender) { setGender(extracted.gender); filled++; }
      if (extracted.is_neutered !== null && extracted.is_neutered !== undefined) setIsNeutered(extracted.is_neutered);
      if (extracted.weight_kg) { setWeight(String(Math.round(extracted.weight_kg * 10) / 10)); filled++; }
      if (extracted.age_years !== null && extracted.age_years !== undefined) { setAgeYears(String(extracted.age_years)); filled++; }
      if (extracted.age_months !== null && extracted.age_months !== undefined) setAgeMonths(String(extracted.age_months));
      if (extracted.allergies && extracted.allergies.length > 0) setAllergies(extracted.allergies);
      if (extracted.medical_conditions && extracted.medical_conditions.length > 0) setMedicalConditions(extracted.medical_conditions);
      if (extracted.body_condition_score) setBodyConditionScore(extracted.body_condition_score);

      setScanFilled(filled);
      track('onboarding_vet_scan_succeeded', { filled });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      const message = err?.message || 'We had trouble reading that image.';
      track('onboarding_vet_scan_failed', { reason: message });
      setScanError(message);
    } finally {
      setScanning(false);
    }
  };

  const handleContinue = () => {
    if (!canContinue) {
      setNameError(`What do you call your ${species || 'pet'}?`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (!imageUri) trackFieldSkipped('identity', 'photo');
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
            <Text style={styles.title}>Who are we{'\n'}meeting?</Text>
            <Text style={styles.subtitle}>
              A name and a photo — so Pawtchi talks to your pet, not to "your pet."
            </Text>
          </Animated.View>

          {/* Avatar — the emotional anchor of this step */}
          <Animated.View entering={FadeInDown.duration(420).delay(60)} style={styles.avatarBlock}>
            <TouchableOpacity onPress={pickAvatar} activeOpacity={0.85} style={styles.avatarPicker}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <MaterialIcons name="add-a-photo" size={32} color={color.slateFaint} />
                  <Text style={styles.avatarHint}>Add a photo</Text>
                </View>
              )}
              <View style={styles.avatarBadge}>
                <MaterialIcons name={imageUri ? 'edit' : 'add'} size={14} color={color.navy} />
              </View>
            </TouchableOpacity>
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
                autoFocus={!imageUri && !trimmedName}
                returnKeyType="done"
              />
            </View>
            {nameError && <Text style={styles.errorText}>{nameError}</Text>}
          </Animated.View>

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
            {scanFilled !== null && !scanError && (
              <View style={styles.scanSuccess}>
                <MaterialIcons name="check-circle" size={14} color={color.success} />
                <Text style={styles.scanSuccessText}>
                  {scanFilled} detail{scanFilled === 1 ? '' : 's'} filled — review on the next screens.
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
                {scanning ? (
                  <ActivityIndicator color={color.navy} size="small" />
                ) : (
                  <>
                    <MaterialIcons name="photo-library" size={15} color={color.navy} />
                    <Text style={styles.scanBtnText}>Photo library</Text>
                  </>
                )}
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
    color: '#15803d',
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
    color: '#991b1b',
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
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 12,
  },
});
