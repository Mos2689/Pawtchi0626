/**
 * VetReportScanner — the optional "photograph your vet report" autofill.
 *
 * It lives on the health screen, not on the identity screen. The fields it
 * fills are weight, sex, desexed status, allergies, conditions and body score —
 * health data. On the walk-first identity screen it was offering to do work for
 * a step that no longer asks for any of it, and offering it before the owner
 * has typed their dog's name is asking for a document from someone who has not
 * yet finished introducing their pet.
 *
 * Extracted into a component rather than moved by copy-paste: it owns ~90 lines
 * of picker, timeout, edge-function and error handling, and a second copy would
 * drift from this one the first time either was touched.
 *
 * Writes straight into the onboarding draft (`usePetStore`), which is the same
 * store every onboarding screen reads — so a scan on the health screen fills
 * the fields on the screens either side of it.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { color, font, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { track } from '../../lib/analytics';
import { supabase } from '../../lib/supabase';
import { withTimeout } from '../../lib/withTimeout';
import { prepareImageForUpload } from '../../lib/imagePrep';
import {
  errorCopy, extractInvokeErrorCode, fromEdgeBody, isAppError, reportError, toAppError,
} from '../../lib/appError';
import { usePetStore } from '../../store/usePetStore';
import { PawLoader } from '../loader/PawLoader';

interface VetReportScannerProps {
  /** Entrance stagger index, so it lines up with the host screen's rhythm. */
  delay?: number;
}

export function VetReportScanner({ delay = 180 }: VetReportScannerProps) {
  const {
    species, name,
    setName, setBreed, setGender, setIsNeutered, setWeight,
    setAgeYears, setAgeMonths, setAllergies, setMedicalConditions,
    setBodyConditionScore, setBcsSource,
  } = usePetStore();

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanFilled, setScanFilled] = useState<number | null>(null);
  const [scanFilledFields, setScanFilledFields] = useState<string[]>([]);

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

  return (
    <>
      <Animated.View entering={FadeInDown.duration(420).delay(delay)} style={styles.scanCard}>
        <View style={styles.scanHead}>
          <View style={styles.scanIcon}>
            <MaterialIcons name="document-scanner" size={17} color={color.navy} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.scanTitle}>Have a vet report?</Text>
            <Text style={styles.scanSub}>
              Pawtchi can pull the weight, age, body condition and more from the photo.
            </Text>
          </View>
        </View>

        {scanFilled !== null && !scanError && scanFilledFields.length > 0 && (
          <View style={styles.scanChips}>
            {scanFilledFields.map((field, i) => (
              <View key={`${field}:${i}`} style={styles.scanChip}>
                <MaterialIcons name="check" size={12} color={color.navy} />
                <Text style={styles.scanChipText}>{field}</Text>
              </View>
            ))}
          </View>
        )}

        {scanFilled !== null && scanFilledFields.length === 0 && !scanError && (
          <Text style={styles.scanEmpty}>
            Nothing readable in that one — you can still fill things in by hand.
          </Text>
        )}

        {scanError && (
          <View style={styles.scanError}>
            <MaterialIcons name="error-outline" size={14} color={color.error} />
            <Text style={styles.scanErrorText}>{scanError}</Text>
          </View>
        )}

        <View style={styles.scanBtnRow}>
          <TouchableOpacity
            style={[styles.scanBtn, scanning && styles.scanBtnDisabled]}
            onPress={() => handleVetScan('gallery')}
            disabled={scanning}
          >
            <MaterialIcons name="photo-library" size={15} color={color.navy} />
            <Text style={styles.scanBtnText}>Photo library</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scanBtn, scanning && styles.scanBtnDisabled]}
            onPress={() => handleVetScan('camera')}
            disabled={scanning}
          >
            <MaterialIcons name="photo-camera" size={15} color={color.navy} />
            <Text style={styles.scanBtnText}>Camera</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      <PawLoader visible={scanning} message="Scanning vet report…" />
    </>
  );
}

const styles = StyleSheet.create({
  scanCard: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xl,
    padding: space.lg,
    gap: space.md,
    marginTop: space.xl,
  },
  scanHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  scanIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanTitle: {
    fontFamily: font.bold,
    fontSize: 14.5,
    color: color.ink,
  },
  scanSub: {
    fontFamily: font.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.slateMuted,
    marginTop: 2,
  },
  scanChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  scanChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: color.yellowSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  scanChipText: {
    fontFamily: font.semibold,
    fontSize: 11.5,
    color: color.navy,
  },
  scanEmpty: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: color.slateMuted,
  },
  scanError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  scanErrorText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.error,
  },
  scanBtnRow: {
    flexDirection: 'row',
    gap: space.md,
  },
  scanBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.surface,
    borderRadius: radius.pill,
    paddingVertical: 11,
  },
  scanBtnDisabled: {
    opacity: 0.5,
  },
  scanBtnText: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.navy,
  },
});
