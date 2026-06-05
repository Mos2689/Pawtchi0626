import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useActivePetStore } from '../store/useActivePetStore';
import { computeCompleteness } from '../lib/profileCompleteness';
import { track } from '../lib/analytics';

const DISMISS_KEY = 'profile_completion_dismissed_at';
const RESURFACE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // resurface gently, at most every 3 days

function MiniRing({ pct }: { pct: number }) {
  const size = 44;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = c * Math.min(Math.max(pct / 100, 0), 1);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="#f1f5f9" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#FFC400"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={styles.ringPct}>{pct}%</Text>
    </View>
  );
}

export function ProfileCompletionCard() {
  const router = useRouter();
  const { activePet, foodPantry } = useActivePetStore();
  const [dismissed, setDismissed] = useState(true); // hidden until we've checked storage

  const { score, missing, isAccurateEnough } = computeCompleteness(activePet, {
    pantryCount: foodPantry?.length ?? 0,
  });

  useEffect(() => {
    (async () => {
      try {
        const ts = await AsyncStorage.getItem(DISMISS_KEY);
        const recentlyDismissed = ts ? Date.now() - parseInt(ts, 10) < RESURFACE_AFTER_MS : false;
        setDismissed(recentlyDismissed);
      } catch {
        setDismissed(false);
      }
    })();
  }, []);

  const handleDismiss = async () => {
    setDismissed(true);
    try {
      await AsyncStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // best-effort
    }
  };

  if (!activePet || isAccurateEnough || dismissed) return null;

  const petName = activePet.name?.trim() || 'your pet';
  const topItems = missing.slice(0, 2);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <MiniRing pct={score} />
        <View style={styles.headerText}>
          <Text style={styles.title}>Sharpen {petName}&apos;s targets</Text>
          <Text style={styles.subtitle}>A few details make {petName}&apos;s results more accurate.</Text>
        </View>
        <TouchableOpacity onPress={handleDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialIcons name="close" size={20} color="#94a3b8" />
        </TouchableOpacity>
      </View>

      <View style={styles.chips}>
        {topItems.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.chip}
            activeOpacity={0.85}
            onPress={() => {
              track('profile_completion_chip_tapped', { key: item.key });
              router.push(`/(tabs)/profile?focus=${item.focus}` as any);
            }}
          >
            <MaterialIcons name="add" size={15} color="#1a1a00" />
            <Text style={styles.chipText}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    padding: 18,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  headerText: { flex: 1 },
  ringPct: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 12,
    color: '#1a1a00',
  },
  title: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 16,
    color: '#0f172a',
    marginBottom: 2,
  },
  subtitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFC00',
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  chipText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 13,
    color: '#1a1a00',
  },
});
