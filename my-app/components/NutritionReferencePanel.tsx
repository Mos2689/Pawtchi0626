/**
 * Shared Nutrition Reference panel — rendered identically in both the
 * post-scan preview (meal.tsx) and the historical Scan Details view
 * (app/scan/[id].tsx) so the user sees the exact same nutrition layer
 * before and after logging.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { FoodAnalysis, NutrientStatus } from '../lib/foodVerdict';

const STATUS_ICON: Record<NutrientStatus, { icon: 'check-circle' | 'warning' | 'help-outline'; color: string }> = {
  meets_baseline: { icon: 'check-circle', color: '#16a34a' },
  meets_adjusted: { icon: 'check-circle', color: '#16a34a' },
  below_baseline: { icon: 'warning', color: '#f59e0b' },
  above_baseline: { icon: 'warning', color: '#f59e0b' },
  below_adjusted: { icon: 'warning', color: '#dc2626' },
  above_adjusted: { icon: 'warning', color: '#dc2626' },
  unknown: { icon: 'help-outline', color: '#94a3b8' },
};

const NUTRIENT_LABEL: Record<string, string> = {
  crude_protein: 'Protein',
  crude_fat: 'Fat',
  crude_fiber: 'Fiber',
  calcium: 'Calcium',
  phosphorus: 'Phosphorus',
};

function formatRange(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—';
  if (min != null && max != null) return `${min}–${max}`;
  if (min != null) return `≥${min}`;
  return `≤${max}`;
}

interface Props {
  foodAnalysis: FoodAnalysis;
  /**
   * Optional override for "this meal" kcal — useful in the preview
   * where serving count multiplies the per-serving kcal. If omitted,
   * we fall back to whatever foodAnalysis.meal_kcal already holds.
   */
  mealKcalOverride?: number;
}

export default function NutritionReferencePanel({ foodAnalysis, mealKcalOverride }: Props) {
  const dailyTarget = foodAnalysis.daily_kcal_target;
  const mealKcal = mealKcalOverride ?? foodAnalysis.meal_kcal;
  const mealPct =
    dailyTarget && dailyTarget > 0 && mealKcal != null
      ? Math.round((mealKcal / dailyTarget) * 100)
      : null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Nutrition Reference</Text>

      {dailyTarget > 0 && mealPct != null && (
        <View style={styles.mealContext}>
          <Text style={styles.mealContextLabel}>This meal</Text>
          <Text style={styles.mealContextValue}>
            {mealKcal} kcal — {mealPct}% of daily target ({dailyTarget} kcal)
          </Text>
        </View>
      )}

      {foodAnalysis.active_clinical_adjustments && foodAnalysis.active_clinical_adjustments.length > 0 && (
        <View style={styles.adjustmentsBox}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <MaterialIcons name="info" size={16} color="#92400e" />
            <Text style={styles.adjustmentsTitle}>Active adjustments</Text>
          </View>
          {foodAnalysis.active_clinical_adjustments.map(key => (
            <Text key={key} style={styles.adjustmentItem}>• {key.replace(/_/g, ' ')}</Text>
          ))}
        </View>
      )}

      <View style={{ gap: 10, marginTop: 12 }}>
        {foodAnalysis.nutrients.map(n => {
          const ind = STATUS_ICON[n.status];
          const label = NUTRIENT_LABEL[n.nutrient] ?? n.nutrient;
          const baselineRange = formatRange(n.aafco_baseline_min, n.aafco_baseline_max);
          const hasAdj = n.adjustment_rationale != null
            || n.adjusted_target_min !== n.aafco_baseline_min
            || n.adjusted_target_max !== n.aafco_baseline_max;
          return (
            <View key={n.nutrient} style={styles.nutrientRow}>
              <MaterialIcons name={ind.icon} size={20} color={ind.color} />
              <View style={{ flex: 1 }}>
                <Text style={styles.nutrientName}>{label}</Text>
                <Text style={styles.nutrientValue}>
                  {n.g_per_1000kcal != null ? `${n.g_per_1000kcal} g/1000 kcal` : 'not stated on label'}
                  {n.dry_matter_pct != null ? `  ·  ${n.dry_matter_pct}% DMB` : ''}
                </Text>
                <Text style={styles.nutrientRef}>
                  AAFCO reference: {baselineRange}
                </Text>
                {hasAdj && (
                  <Text style={styles.nutrientAdj}>
                    Adjusted target: {formatRange(n.adjusted_target_min, n.adjusted_target_max)}
                    {n.adjustment_rationale ? ` — ${n.adjustment_rationale}` : ''}
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {foodAnalysis.ca_phosphorus_ratio != null && (
        <View style={[styles.nutrientRow, { marginTop: 10 }]}>
          <MaterialIcons
            name={foodAnalysis.ca_phosphorus_ratio_status === 'in_range' ? 'check-circle' : 'warning'}
            size={20}
            color={foodAnalysis.ca_phosphorus_ratio_status === 'in_range' ? '#16a34a' : '#f59e0b'}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.nutrientName}>Ca:P ratio</Text>
            <Text style={styles.nutrientValue}>{foodAnalysis.ca_phosphorus_ratio}</Text>
            <Text style={styles.nutrientRef}>AAFCO reference: 1.0–2.0</Text>
          </View>
        </View>
      )}

      {foodAnalysis.notes && foodAnalysis.notes.length > 0 && (
        <View style={styles.notesBox}>
          {foodAnalysis.notes.map((note, i) => (
            <Text key={i} style={styles.noteItem}>· {note}</Text>
          ))}
        </View>
      )}

      <Text style={styles.disclaimer}>
        Label values are stated minimums and maximums, not actual nutrient content. Crude protein doesn&apos;t measure digestibility or amino-acid balance. AAFCO 2014 reference ranges are minimums for typical animals — not optimal for any specific animal. Clinical adjustments shown reflect general veterinary nutrition guidance and should always be confirmed with your vet.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 24,
    paddingTop: 8,
  },
  sectionTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800' as const,
    fontSize: 18,
    color: '#041015',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  mealContext: {
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  mealContextLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#6B7280',
  },
  mealContextValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 14,
    color: '#041015',
    marginTop: 4,
  },
  adjustmentsBox: {
    backgroundColor: '#FEF3C7',
    borderRadius: 16,
    padding: 14,
  },
  adjustmentsTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 13,
    color: '#92400e',
    textTransform: 'capitalize' as const,
  },
  adjustmentItem: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600' as const,
    fontSize: 13,
    color: '#92400e',
    textTransform: 'capitalize' as const,
    marginLeft: 4,
  },
  nutrientRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 12,
  },
  nutrientName: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800' as const,
    fontSize: 14,
    color: '#041015',
  },
  nutrientValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 13,
    color: '#374151',
    marginTop: 2,
  },
  nutrientRef: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500' as const,
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  nutrientAdj: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600' as const,
    fontSize: 12,
    color: '#92400e',
    marginTop: 4,
    lineHeight: 16,
  },
  notesBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 4,
  },
  noteItem: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500' as const,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  disclaimer: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500' as const,
    fontSize: 11,
    color: '#9CA3AF',
    lineHeight: 16,
    marginTop: 16,
    paddingHorizontal: 4,
  },
});
