import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import Reanimated, { FadeIn } from 'react-native-reanimated';

import { color, font, radius, space, shadow } from '../constants/design';
import { WeightJourneyBar } from './WeightJourneyBar';
import { useActivePetStore } from '../store/useActivePetStore';
import { estimateIdealWeight } from '../lib/idealWeight';
import { getAgeMonths } from '../lib/lifeStage';
import { supabase } from '../lib/supabase';

// The weight journey, brought home. Reuses the same map the owner set during
// onboarding (WeightJourneyBar) and reflects the live weight — so a fresh
// weigh-in visibly advances progress toward the ideal. Derived entirely from
// the pet row + earliest weight log; no schema change, no persisted history.
export function MilestoneJourneyCard() {
  const activePet = useActivePetStore((s) => s.activePet);

  // Plan-start anchor: the earliest logged weight. Falls back to the current
  // weight when there are no logs yet (brand-new pet), giving a 0% start.
  const [startWeightKg, setStartWeightKg] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!activePet?.id) return;
      supabase
        .from('weight_logs')
        .select('weight_kg')
        .eq('pet_id', activePet.id)
        .order('logged_at', { ascending: true })
        .limit(1)
        .then(({ data }) => {
          if (!cancelled) setStartWeightKg(data?.[0]?.weight_kg ?? null);
        });
      return () => { cancelled = true; };
    }, [activePet?.id])
  );

  if (!activePet || !(activePet.current_weight_kg > 0)) return null;

  const current = activePet.current_weight_kg;
  const estimate = estimateIdealWeight({
    species: activePet.species,
    breed: activePet.breed ?? null,
    sex: activePet.gender ?? null,
    ageMonths: getAgeMonths(activePet),
    currentWeightKg: current,
    bcs: activePet.body_condition_score ?? null,
  });

  // Growth-phase pets (puppies/kittens) and any un-computable estimate (e.g. a
  // legacy pet with no BCS) have no adult ideal-weight journey — the growth
  // guard owns them. Hide the card.
  if (estimate.mode !== 'ok' || estimate.finalIdealKg == null || !Number.isFinite(estimate.finalIdealKg)) {
    return null;
  }

  const ideal = estimate.finalIdealKg;
  let stageTarget = activePet.target_weight_kg ?? estimate.targetKg ?? ideal;
  
  // If the user's current weight has already passed their saved target,
  // the fixed milestone in the DB is obsolete. We auto-promote them to the
  // next stage so the UI always points forward.
  const start = startWeightKg ?? current;
  const isLosing = ideal < start;
  const hasPassed = isLosing ? current <= stageTarget : current >= stageTarget;
  if (hasPassed && activePet.target_weight_kg) {
    stageTarget = estimate.targetKg ?? ideal;
  }
  
  const petName = activePet.name?.trim() || 'your pet';
  const frameLabel =
    activePet.breed && activePet.breed !== 'Mixed Breed'
      && activePet.breed !== 'Mixed Breed / Domestic Shorthair' && activePet.breed !== 'Other'
      ? activePet.breed
      : activePet.species === 'cat' ? 'cat' : 'dog';

  // Progress toward the FINAL ideal — same formula as the milestone engine.
  const atIdeal = Math.abs(ideal - current) / current <= 0.03;
  const progressPct = Math.abs(start - ideal) > 0.05
    ? Math.round(Math.max(0, Math.min(1, (start - current) / (start - ideal))) * 100)
    : null;

  return (
    <Reanimated.View entering={FadeIn.duration(420)} style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>{petName.toUpperCase()}&apos;S JOURNEY</Text>
        {!atIdeal && progressPct != null && progressPct > 0 ? (
          <Text style={styles.headProgress}>{progressPct}% to ideal</Text>
        ) : (
          <MaterialIcons name="flag" size={15} color={color.slateFaint} />
        )}
      </View>

      {atIdeal ? (
        <View style={styles.zoneRow}>
          <MaterialIcons name="check-circle" size={18} color={color.success} />
          <Text style={styles.zoneText}>
            {petName} is right in the healthy zone — we&apos;ll keep it that way.
          </Text>
        </View>
      ) : (
        <WeightJourneyBar
          currentKg={current}
          startKg={startWeightKg ?? undefined}
          milestoneKg={stageTarget}
          idealKg={ideal}
          band={estimate.band ?? null}
          zoneLabel={`Healthy ${frameLabel} range`}
          variant="light"
          compact
        />
      )}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
    ...shadow.card,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  eyebrow: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2,
    color: color.slateFaint,
  },
  headProgress: {
    fontFamily: font.bold,
    fontSize: 12,
    color: color.success,
  },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: space.xs,
  },
  zoneText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 13.5,
    lineHeight: 19,
    color: color.slate,
  },
});
