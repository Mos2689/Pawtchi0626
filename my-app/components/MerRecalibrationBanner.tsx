/**
 * MerRecalibrationBanner
 *
 * Home-tab surface for the personalized-MER back-fit. Fires only when the
 * observed-MER calculator returns `recalibration_suggested` — i.e. the pet's
 * real maintenance calories drift more than 15% from what the formula
 * predicted. Tapping opens a confirmation modal with the old-vs-new numbers;
 * accepting persists the new target to `pets.target_daily_calories`.
 *
 * We never silently mutate the plan. The owner is always in the loop.
 * Local dismiss stashes for 14 days so a rejected suggestion doesn't nag.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { PawLoader } from './loader/PawLoader';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { useActivePetStore } from '../store/useActivePetStore';
import { usePetContextStore } from '../store/usePetContextStore';
import type { ObservedMerResult } from '../lib/observedMer';

const DISMISS_KEY_PREFIX = '@pawtchi/mer_recalib_dismissed_at:';
const DISMISS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export interface MerRecalibrationBannerProps {
  petId: string | null | undefined;
  petName: string;
  observedMer: ObservedMerResult | null;
}

export function MerRecalibrationBanner({ petId, petName, observedMer }: MerRecalibrationBannerProps) {
  const [dismissedRecently, setDismissedRecently] = useState<boolean | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const shouldConsider = !!(petId && observedMer && observedMer.status === 'recalibration_suggested');

  useEffect(() => {
    if (!shouldConsider) {
      setDismissedRecently(true);
      return;
    }
    AsyncStorage.getItem(`${DISMISS_KEY_PREFIX}${petId}`)
      .then((v) => {
        if (!v) return setDismissedRecently(false);
        const ts = Number(v);
        if (!Number.isFinite(ts)) return setDismissedRecently(false);
        setDismissedRecently(Date.now() - ts < DISMISS_WINDOW_MS);
      })
      .catch(() => setDismissedRecently(false));
  }, [petId, shouldConsider]);

  if (!shouldConsider || dismissedRecently !== false || !observedMer) return null;

  const oldKcal = observedMer.predictedDailyKcal;
  const newKcal = observedMer.suggestedDailyKcal ?? oldKcal;
  const runsFaster = newKcal > oldKcal;

  const dismiss = () => {
    if (petId) {
      AsyncStorage.setItem(`${DISMISS_KEY_PREFIX}${petId}`, String(Date.now())).catch(() => {});
    }
    setDismissedRecently(true);
    setModalOpen(false);
  };

  const accept = async () => {
    if (!petId || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('pets')
        .update({ target_daily_calories: newKcal })
        .eq('id', petId);
      if (error) throw error;
      // Optimistically update the active pet store so home + health re-derive.
      const pet = useActivePetStore.getState().activePet;
      if (pet) {
        useActivePetStore.getState().updatePetWeight(pet.current_weight_kg, newKcal);
      }
      // Invalidate context so the next refresh recomputes with the new target.
      usePetContextStore.getState().invalidateContext();
      const userId = pet?.owner_id;
      if (userId) await useActivePetStore.getState().fetchPet(userId, { silent: true });
      // Log the acceptance timestamp under the same key — the 14-day window
      // still applies before the next prompt (avoids re-firing on the next refresh).
      AsyncStorage.setItem(`${DISMISS_KEY_PREFIX}${petId}`, String(Date.now())).catch(() => {});
      setModalOpen(false);
      setDismissedRecently(true);
    } catch (err) {
      console.warn('[MerRecalibrationBanner] accept failed', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.banner}
        onPress={() => setModalOpen(true)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Recalibrate plan"
      >
        <View style={styles.iconWrap}>
          <MaterialIcons name="insights" size={20} color="#065f46" />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>Recalibrate {petName}&apos;s plan</Text>
          <Text style={styles.body}>
            4 weeks of logs suggest {petName} runs {runsFaster ? 'a bit faster' : 'a bit slower'} than our estimate. Tap to review a suggested target.
          </Text>
        </View>
        <MaterialIcons name="chevron-right" size={22} color="#065f46" />
      </TouchableOpacity>

      <Modal
        visible={modalOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <MaterialIcons name="insights" size={28} color="#065f46" />
            </View>
            <Text style={styles.modalTitle}>Update the daily target?</Text>
            <Text style={styles.modalBody}>
              Based on 4 weeks of your logs, {petName} looks like {runsFaster
                ? 'they need a little more food to hold weight.'
                : 'they need a little less food to hold weight.'}
            </Text>
            <View style={styles.compareRow}>
              <View style={styles.compareCell}>
                <Text style={styles.compareLabel}>Current</Text>
                <Text style={styles.compareValue}>{oldKcal}</Text>
                <Text style={styles.compareUnit}>kcal/day</Text>
              </View>
              <MaterialIcons name="arrow-forward" size={22} color="#065f46" />
              <View style={styles.compareCell}>
                <Text style={styles.compareLabel}>Suggested</Text>
                <Text style={[styles.compareValue, { color: runsFaster ? '#065f46' : '#7f1d1d' }]}>
                  {newKcal}
                </Text>
                <Text style={styles.compareUnit}>kcal/day</Text>
              </View>
            </View>
            <Text style={styles.modalFootnote}>
              We only suggest — nothing changes until you accept. If {petName} is on a vet-prescribed plan, keep the current target.
            </Text>
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionSecondary]}
                onPress={dismiss}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Not now"
              >
                <Text style={styles.actionSecondaryText}>Not now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionPrimary]}
                onPress={accept}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Update target"
              >
                <Text style={styles.actionPrimaryText}>Update target</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <PawLoader visible={saving} message="Updating target…" />
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#d1fae5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  textWrap: { flex: 1, gap: 4 },
  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 13,
    color: '#065f46',
    letterSpacing: 0.2,
  },
  body: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 12.5,
    lineHeight: 17,
    color: '#065f46',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 22,
    gap: 12,
  },
  modalIconWrap: {
    alignSelf: 'flex-start',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 18,
    color: '#0f172a',
  },
  modalBody: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 13,
    lineHeight: 19,
    color: '#334155',
  },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 4,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  compareCell: { flex: 1, alignItems: 'center' },
  compareLabel: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 11.5,
    color: '#64748b',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  compareValue: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 24,
    color: '#0f172a',
    marginTop: 2,
  },
  compareUnit: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 11,
    color: '#94a3b8',
  },
  modalFootnote: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 12,
    lineHeight: 16,
    color: '#64748b',
    marginTop: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionSecondary: {
    backgroundColor: '#f1f5f9',
  },
  actionSecondaryText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 13.5,
    color: '#334155',
  },
  actionPrimary: {
    backgroundColor: '#0f172a',
  },
  actionPrimaryText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 13.5,
    color: '#FFFFFF',
  },
});
