import React from 'react';
import { Text, View, StyleSheet, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { color, font, radius, shadow, space } from '../constants/design';
import { PulseMark } from './PulseMark';

interface VetCheckinNudgeProps {
  petName: string;
  reason: string | null;
  onPress: () => void;
}

// Home-feed surface for a pending Second Opinion check-in. Navy card carrying the
// Pulse mark — the same identity as the entry and loader — so a follow-through
// feels like the same caring thread, not a generic reminder.
export function VetCheckinNudge({ petName, reason, onPress }: VetCheckinNudgeProps) {
  return (
    <Pressable
      style={styles.card}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
    >
      <View style={styles.chip}>
        <PulseMark size={24} ringColor={color.yellow} strokeColor={color.yellow} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>Checking in on {petName}</Text>
        <Text style={styles.sub} numberOfLines={2}>
          {reason ? `How are things going ${reason}?` : `How is ${petName} doing now?`}
        </Text>
      </View>
      <MaterialIcons name="arrow-forward" size={18} color={color.yellow} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.navy,
    borderRadius: radius.xl,
    paddingVertical: 14,
    paddingHorizontal: 16,
    ...shadow.raised,
  },
  chip: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: color.navyRaised,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.bold, fontSize: 15.5, color: color.cream, letterSpacing: -0.2 },
  sub: { fontFamily: font.medium, fontSize: 12.5, color: color.creamDim, marginTop: 2, lineHeight: 17 },
});
