import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { color, font, radius, space } from '../constants/design';
import type { PortionPlan } from '../lib/portionMath';

interface PortionPlateCardProps {
  petName: string;
  plan: PortionPlan;
}

// Personalised "plate" — turns the daily kcal into something an owner can act
// on tonight: grams per meal, treat-cap grams, water target. Calm navy card,
// one yellow accent on the treat slice. No claims, no exclamation.
export function PortionPlateCard({ petName, plan }: PortionPlateCardProps) {
  const total = Math.max(plan.mealKcal + plan.treatKcal, 1);
  const mealPct = (plan.mealKcal / total) * 100;
  const treatPct = 100 - mealPct;
  const treatCapPct = Math.round(plan.treatCapPercent * 100);

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>{petName.toUpperCase()}&apos;S DAILY PLATE</Text>

      {/* Split bar: meals (cream) + treat cap (yellow) */}
      <View style={styles.bar}>
        <View style={[styles.meals, { width: `${mealPct}%` }]} />
        <View style={[styles.treats, { width: `${treatPct}%` }]} />
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: color.cream }]} />
          <Text style={styles.legendText}>meals · {Math.round(mealPct)}%</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: color.yellow }]} />
          <Text style={styles.legendText}>treat cap · {treatCapPct}%</Text>
        </View>
      </View>

      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{plan.gramsPerMeal}<Text style={styles.statUnit}> g</Text></Text>
          <Text style={styles.statLabel}>per meal · {plan.mealsPerDay} a day</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{plan.treatGrams}<Text style={styles.statUnit}> g</Text></Text>
          <Text style={styles.statLabel}>treats a day</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{plan.waterMl}<Text style={styles.statUnit}> ml</Text></Text>
          <Text style={styles.statLabel}>water target</Text>
        </View>
      </View>

      <Text style={styles.caption}>
        estimates from a typical dry kibble — adjust if {petName} eats wet or raw.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.navyRaised,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
    padding: space.xl,
    gap: space.lg,
  },
  eyebrow: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    color: color.yellow,
  },
  bar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: color.navy,
    overflow: 'hidden',
  },
  meals: { backgroundColor: color.cream, height: '100%' },
  treats: { backgroundColor: color.yellow, height: '100%' },
  legendRow: {
    flexDirection: 'row',
    gap: space.xl,
    marginTop: -space.sm,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: {
    fontFamily: font.medium,
    fontSize: 11.5,
    color: color.creamDim,
    letterSpacing: 0.2,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: color.hairlineOnNavy,
    paddingTop: space.lg,
  },
  stat: { flex: 1 },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: color.hairlineOnNavy,
    marginHorizontal: space.sm,
  },
  statValue: {
    fontFamily: font.display,
    fontSize: 24,
    lineHeight: 24,
    letterSpacing: 0.3,
    color: color.cream,
  },
  statUnit: { fontSize: 12, color: color.creamFaint },
  statLabel: {
    fontFamily: font.medium,
    fontSize: 10.5,
    letterSpacing: 0.4,
    color: color.creamFaint,
    marginTop: 4,
  },
  caption: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.creamDim,
  },
});
