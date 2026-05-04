import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { PantryItem } from '../store/useActivePetStore';

const FOOD_TYPE_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  kibble: 'pets',
  wet_food: 'soup-kitchen',
  treat: 'cookie',
  raw: 'egg-alt',
  supplement: 'medication',
  human_food: 'restaurant',
};

interface Props {
  pantryItems: PantryItem[];
  onLog: (item: PantryItem) => void | Promise<void>;
  isBusy?: boolean;
}

export default function QuickLogRail({ pantryItems, onLog, isBusy }: Props) {
  // Rank by frequency (scan_count desc) and keep the top 6.
  // Items earn their spot by being repeatedly scanned, not by recency —
  // recency would re-promote a one-off scan.
  const ranked = useMemo(
    () =>
      [...pantryItems]
        .sort((a, b) => (b.scan_count || 0) - (a.scan_count || 0))
        .slice(0, 6),
    [pantryItems],
  );

  if (ranked.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>Quick Log</Text>
        <Text style={styles.subtitle}>Tap a regular food</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        {ranked.map((item) => {
          const icon = FOOD_TYPE_ICONS[item.food_type] || 'pets';
          const kcal = item.kcal_per_serving ?? 0;
          const label = item.brand.length > 14 ? item.brand.slice(0, 13) + '…' : item.brand;
          const sub = kcal > 0
            ? `${Math.round(kcal)} kcal/${item.serving_unit || 'srv'}`
            : (item.serving_unit || 'serving');

          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.chip, isBusy && { opacity: 0.5 }]}
              activeOpacity={0.85}
              onPress={() => onLog(item)}
              disabled={isBusy}
            >
              <View style={styles.chipIconBox}>
                <MaterialIcons name={icon} size={20} color="#605e00" />
              </View>
              <View style={styles.chipText}>
                <Text style={styles.chipBrand} numberOfLines={1}>{label}</Text>
                <Text style={styles.chipSub} numberOfLines={1}>{sub}</Text>
              </View>
              <View style={styles.chipPlus}>
                <MaterialIcons name="add" size={18} color="#1A1A1A" />
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  title: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 22,
    letterSpacing: -0.5,
    color: '#2e2f2d',
  },
  subtitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  rail: {
    paddingRight: 24,
    gap: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    minWidth: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  chipIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFF9DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    flex: 1,
  },
  chipBrand: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
    color: '#1A1A1A',
  },
  chipSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 11,
    fontWeight: '500',
    color: '#64748b',
    marginTop: 2,
  },
  chipPlus: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFC00',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
