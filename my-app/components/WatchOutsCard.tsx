import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font, radius, space } from '../constants/design';
import type { WatchOut } from '../lib/breedWatchOuts';

interface WatchOutsCardProps {
  petName: string;
  items: WatchOut[];
}

// 2–3 calm, vet-informed things tailored to this pet — breed, life stage, body.
// Empty array → render nothing (no awkward "no tips" copy on the climax screen).
export function WatchOutsCard({ petName, items }: WatchOutsCardProps) {
  if (!items || items.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>WORTH KNOWING FOR {petName.toUpperCase()}</Text>
      <View style={styles.list}>
        {items.map((w, i) => (
          <View key={`${w.icon}-${i}`} style={[styles.row, i === items.length - 1 && styles.rowLast]}>
            <View style={styles.iconBox}>
              <MaterialIcons name={w.icon} size={18} color={color.yellow} />
            </View>
            <Text style={styles.text}>{w.text}</Text>
          </View>
        ))}
      </View>
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
  list: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.hairlineOnNavy,
  },
  rowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: color.navy,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  text: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: color.cream,
  },
});
