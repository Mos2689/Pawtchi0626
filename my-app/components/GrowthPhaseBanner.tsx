/**
 * GrowthPhaseBanner
 *
 * Shown on the home tab when a puppy/kitten (age < 12 months) has a target
 * weight below current — a scenario the kcal engine intentionally overrides
 * to maintenance to prevent stunted growth and orthopedic disease. This
 * banner tells the owner *why* the plan isn't restricting calories, so they
 * don't think the engine is ignoring their goal.
 *
 * Dismissable per pet via AsyncStorage; re-appears if a new pet trips the
 * same condition.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DISMISS_KEY_PREFIX = '@pawtchi/growth_phase_banner_dismissed:';

export interface GrowthPhaseBannerProps {
  petId: string | null | undefined;
  petName: string;
  ageMonths: number | undefined;
  currentWeightKg: number | null | undefined;
  targetWeightKg: number | null | undefined;
}

export function GrowthPhaseBanner({
  petId,
  petName,
  ageMonths,
  currentWeightKg,
  targetWeightKg,
}: GrowthPhaseBannerProps) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  const isGrowing = typeof ageMonths === 'number' && ageMonths < 12;
  const wantsRestriction =
    typeof currentWeightKg === 'number' &&
    typeof targetWeightKg === 'number' &&
    targetWeightKg > 0 &&
    targetWeightKg < currentWeightKg;
  const shouldShow = isGrowing && wantsRestriction;

  useEffect(() => {
    if (!petId || !shouldShow) {
      setDismissed(true);
      return;
    }
    AsyncStorage.getItem(`${DISMISS_KEY_PREFIX}${petId}`)
      .then((v) => setDismissed(v === '1'))
      .catch(() => setDismissed(false));
  }, [petId, shouldShow]);

  if (dismissed !== false || !shouldShow) return null;

  const handleDismiss = () => {
    if (petId) {
      AsyncStorage.setItem(`${DISMISS_KEY_PREFIX}${petId}`, '1').catch(() => {});
    }
    setDismissed(true);
  };

  return (
    <View style={styles.container} accessibilityRole="alert">
      <View style={styles.iconWrap}>
        <MaterialIcons name="child-care" size={20} color="#92400e" />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>Growing pets need calories</Text>
        <Text style={styles.body}>
          {petName} is still growing — we&apos;re keeping the plan focused on healthy portions, not restriction. Talk to your vet if you&apos;re concerned about weight.
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
