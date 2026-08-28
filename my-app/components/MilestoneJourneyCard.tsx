import React, { useCallback, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Reanimated, { FadeIn } from 'react-native-reanimated';

import { color, font, radius, shadow, space } from '../constants/design';
import { WeightJourneyBar } from './WeightJourneyBar';
import { useActivePetStore } from '../store/useActivePetStore';
import { supabase } from '../lib/supabase';
import { weightPlanViewModelFromRecord } from '../lib/weightPlanRecord';
import type { WeightMeasurementEvidence } from '../lib/weightPlan';

interface MilestoneJourneyCardProps {
  /** Opens the weight-entry sheet. Renders the corner button only when set. */
  onLogWeight?: () => void;
}

export function MilestoneJourneyCard({ onLogWeight }: MilestoneJourneyCardProps) {
  const router = useRouter();
  const activePet = useActivePetStore((state) => state.activePet);
  const [measurements, setMeasurements] = useState<WeightMeasurementEvidence[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!activePet?.id) {
        setMeasurements([]);
        return;
      }

      const loadPlanEvidence = async () => {
        const { data } = await supabase
          .from('weight_logs')
          .select('weight_kg, logged_at')
          .eq('pet_id', activePet.id)
          .order('logged_at', { ascending: false })
          .limit(3);

        if (!cancelled) {
          setMeasurements(
            (data ?? []).map((row) => ({
              weightKg: Number(row.weight_kg),
              loggedAt: String(row.logged_at),
            }))
          );
        }
      };

      void loadPlanEvidence();
      return () => {
        cancelled = true;
      };
    }, [activePet])
  );

  const plan = useMemo(
    () => (activePet ? weightPlanViewModelFromRecord(activePet, measurements) : null),
    [activePet, measurements]
  );

  if (!activePet || !(activePet.current_weight_kg > 0) || !plan) return null;
  if (plan.status === 'growth' || plan.status === 'supervised') return null;

  const current = activePet.current_weight_kg;
  const petName = activePet.name?.trim() || 'Your pet';
  const frameLabel =
    activePet.breed &&
    activePet.breed !== 'Mixed Breed' &&
    activePet.breed !== 'Mixed Breed / Domestic Shorthair' &&
    activePet.breed !== 'Other'
      ? activePet.breed
      : activePet.species === 'cat'
        ? 'cat'
        : 'dog';

  return (
    <Reanimated.View entering={FadeIn.duration(420)} style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>{petName.toUpperCase()}&apos;S JOURNEY</Text>
        {plan.progressPct != null && plan.progressPct > 0 && !plan.showHealthyBanner && (
          <Text style={styles.headProgress}>{plan.progressPct}% to ideal</Text>
        )}
      </View>

      {/* Log weight — a cutout badge punched into the card's top-right corner.
          Half outside the card (matching the surface colour of the ring behind
          it so it reads as notched rather than stuck on), half in — the same
          spot the flag glyph used to sit, now an actual action instead of
          decoration. This is Bunny's Journey's own entry point for the number
          that drives everything else in the card. */}
      {onLogWeight && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Log weight"
          onPress={onLogWeight}
          style={styles.logWeightCutout}
          activeOpacity={0.85}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="add" size={15} color={color.cream} />
          <Text style={styles.logWeightLabel}>Log weight</Text>
        </TouchableOpacity>
      )}

      {plan.showHealthyBanner ? (
        <View style={styles.zoneRow}>
          <MaterialIcons name="check-circle" size={18} color={color.success} />
          <Text style={styles.zoneText}>
            {petName} is in the confirmed healthy zone — we&apos;ll keep it that way.
          </Text>
        </View>
      ) : plan.idealWeightKg != null && plan.targetWeightKg != null ? (
        <>
          <WeightJourneyBar
            currentKg={current}
            startKg={
              activePet.weight_journey_start_kg ??
              activePet.weight_assessment_kg ??
              undefined
            }
            milestoneKg={plan.targetWeightKg}
            idealKg={plan.idealWeightKg}
            band={plan.healthyBand}
            zoneLabel={`Healthy ${frameLabel} range`}
            variant="light"
            compact
          />
          {(plan.status === 'verify_change' || plan.status === 'needs_reassessment') && (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => router.push('/(tabs)/health')}
              style={styles.recheck}
            >
              <MaterialIcons name="monitor-weight" size={17} color={color.ink} />
              <View style={styles.recheckCopy}>
                <Text style={styles.recheckTitle}>
                  {plan.status === 'verify_change'
                    ? 'Confirm this weight change'
                    : 'Body check needed'}
                </Text>
                <Text style={styles.recheckText}>
                  {plan.status === 'verify_change'
                    ? 'Add another reading at least 12 hours later.'
                    : `We’re still measuring progress against the confirmed ${plan.idealWeightKg.toFixed(1)} kg ideal.`}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={color.slateFaint} />
            </TouchableOpacity>
          )}
        </>
      ) : (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => router.push('/(tabs)/health')}
          style={styles.recheck}
        >
          <MaterialIcons name="monitor-weight" size={17} color={color.ink} />
          <View style={styles.recheckCopy}>
            <Text style={styles.recheckTitle}>Set a confirmed healthy range</Text>
            <Text style={styles.recheckText}>
              Complete a body check so Pawtchi can assess a reliable ideal.
            </Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color={color.slateFaint} />
        </TouchableOpacity>
      )}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    // Explicit rather than relying on RN's implicit default, since it is what
    // anchors the absolutely-positioned cutout button below.
    position: 'relative',
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
    gap: space.sm,
    marginBottom: space.xs,
  },
  logWeightCutout: {
    position: 'absolute',
    top: -14,
    right: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: color.navy,
    borderWidth: 3,
    borderColor: color.surface,
    ...shadow.raised,
  },
  logWeightLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    color: color.cream,
    letterSpacing: 0.2,
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
  recheck: {
    marginTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    paddingTop: space.sm,
    paddingBottom: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recheckCopy: {
    flex: 1,
  },
  recheckTitle: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.ink,
  },
  recheckText: {
    marginTop: 2,
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.slate,
  },
});
