/**
 * VetTunedNutritionBanner
 *
 * Persistent, dismissable banner shown on the home tab when the pet has a
 * medical condition that needs vet-tuned nutrition the Pawtchi plan can't
 * provide automatically. Conditions covered: diabetes, CKD (stages 2/3), and
 * oxalate urolithiasis — all listed in clinical_adjustments.json as
 * `_deferred_conditions` because their dietary management is dose-dependent
 * on lab values or other clinical context an app shouldn't guess at.
 *
 * The banner names the condition and tells the owner the current plan is
 * generic guidance, so they (or their vet) can layer on the right diet
 * without believing Pawtchi has handled it. Dismiss is local-only via
 * AsyncStorage — keyed by pet id, so a multi-pet household sees the banner
 * once per pet that needs it.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import clinicalAdjustments from '../data/clinical_adjustments.json';

const DISMISS_KEY_PREFIX = '@pawtchi/vet_tuned_banner_dismissed:';

// Friendly labels for the deferred conditions.
const DEFERRED_LABELS: Record<string, string> = {
  diabetes: 'Diabetes',
  ckd_stage_2: 'Kidney disease (CKD stage 2)',
  ckd_stage_3: 'Kidney disease (CKD stage 3)',
  urolithiasis_oxalate: 'Oxalate bladder stones',
};

export interface VetTunedNutritionBannerProps {
  petId: string | null | undefined;
  petName: string;
  medicalConditions: string[] | null | undefined;
}

export function VetTunedNutritionBanner({ petId, petName, medicalConditions }: VetTunedNutritionBannerProps) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  // Compute matching deferred conditions
  const deferredKeys = Object.keys(clinicalAdjustments._deferred_conditions ?? {}).filter(
    (k) => !k.startsWith('_'),
  );
  const matched = (medicalConditions ?? []).filter((c) => deferredKeys.includes(c));

  useEffect(() => {
    if (!petId || matched.length === 0) {
      setDismissed(true);
      return;
    }
    AsyncStorage.getItem(`${DISMISS_KEY_PREFIX}${petId}`)
      .then((v) => setDismissed(v === '1'))
      .catch(() => setDismissed(false));
  }, [petId, matched.length]);

  if (dismissed !== false || matched.length === 0) return null;

  const conditionList = matched
    .map((k) => DEFERRED_LABELS[k] ?? k)
    .join(', ');

  const handleDismiss = () => {
    if (petId) {
      AsyncStorage.setItem(`${DISMISS_KEY_PREFIX}${petId}`, '1').catch(() => {});
    }
    setDismissed(true);
  };

  return (
    <View style={styles.container} accessibilityRole="alert">
      <View style={styles.iconWrap}>
        <MaterialIcons name="medical-services" size={20} color="#92400e" />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>Vet-tuned nutrition needed</Text>
        <Text style={styles.body}>
          {conditionList} need{matched.length === 1 ? 's' : ''} diet targets your vet sets — the Pawtchi plan for {petName} is generic guidance, so check in with your vet before relying on it.
        </Text>
      </View>
      <TouchableOpacity onPress={handleDismiss} hitSlop={12} accessibilityLabel="Dismiss banner">
        <MaterialIcons name="close" size={18} color="#92400e" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fde68a',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  textWrap: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 13,
    color: '#78350f',
    letterSpacing: 0.2,
  },
  body: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 12.5,
    lineHeight: 17,
    color: '#92400e',
  },
});
