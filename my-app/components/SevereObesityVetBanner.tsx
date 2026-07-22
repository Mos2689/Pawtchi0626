/**
 * SevereObesityVetBanner
 *
 * Persistent home-tab banner when the pet has a body condition score of 8 or 9
 * AND the owner has not yet recorded a vet consultation for the weight-loss
 * plan. AAHA/WSAVA guidelines: severe obesity needs bloodwork (rule out
 * hypothyroidism, Cushing's) before a kcal-restricted plan.
 *
 * Tapping "I've checked with the vet" stamps `severe_obesity_vet_confirmed_at`
 * on the pet row so the banner stops showing.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useActivePetStore } from '../store/useActivePetStore';

export interface SevereObesityVetBannerProps {
  petId: string | null | undefined;
  petName: string;
  bcs: number | null | undefined;
  severeObesityVetConfirmedAt: string | null | undefined;
}

export function SevereObesityVetBanner({
  petId, petName, bcs, severeObesityVetConfirmedAt,
}: SevereObesityVetBannerProps) {
  const [saving, setSaving] = useState(false);
  const [optimisticConfirmed, setOptimisticConfirmed] = useState(false);

  if (!petId) return null;
  if (typeof bcs !== 'number' || bcs < 8) return null;
  if (severeObesityVetConfirmedAt || optimisticConfirmed) return null;

  const handleConfirm = async () => {
    if (saving) return;
    setSaving(true);
    setOptimisticConfirmed(true);
    try {
      await supabase
        .from('pets')
        .update({ severe_obesity_vet_confirmed_at: new Date().toISOString() })
        .eq('id', petId);
      // Refresh the active pet so the column update propagates.
      const userId = useActivePetStore.getState().activePet?.owner_id as string | undefined;
      if (userId) await useActivePetStore.getState().fetchPet(userId, { silent: true });
    } catch {
      // If the network call fails, revert the optimistic dismissal so the
      // banner shows again next time and the owner can retry.
      setOptimisticConfirmed(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container} accessibilityRole="alert">
      <View style={styles.iconWrap}>
        <MaterialIcons name="local-hospital" size={20} color="#7c2d12" />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>Vet check recommended for {petName}</Text>
        <Text style={styles.body}>
          A body condition of {bcs}/9 often goes with thyroid or hormonal issues that change the right plan. Please confirm with your vet before relying on this calorie target.
        </Text>
        <TouchableOpacity onPress={handleConfirm} disabled={saving} style={styles.cta} activeOpacity={0.7}>
          <Text style={styles.ctaText}>I&apos;ve checked with our vet</Text>
        </TouchableOpacity>
      </View>
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
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  textWrap: {
    flex: 1,
    gap: 6,
  },
  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 13.5,
    color: '#7c2d12',
  },
  body: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 12.5,
    lineHeight: 17,
    color: '#991b1b',
  },
  cta: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#fecaca',
    borderRadius: 10,
    marginTop: 4,
  },
  ctaText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 12,
    color: '#7c2d12',
  },
});
