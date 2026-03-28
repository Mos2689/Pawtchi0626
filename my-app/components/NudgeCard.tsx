import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { usePetContextStore } from '../store/usePetContextStore';

interface NudgeCardProps {
  isProfileComplete: boolean;
  onProfilePress: () => void;
}

const iconMap: Record<string, { name: keyof typeof MaterialIcons.glyphMap; color: string }> = {
  suggest_walk: { name: 'directions-walk', color: '#FFFC00' },
  remind_log: { name: 'restaurant', color: '#FFFC00' },
  remind_water: { name: 'water-drop', color: '#3091F9' },
  treat_ok: { name: 'celebration', color: '#4ade80' },
  reduce_dinner: { name: 'restaurant-menu', color: '#fb923c' },
};

const routeMap: Record<string, string> = {
  suggest_walk: '/(tabs)/activity',
  remind_log: '/(tabs)/log',
  remind_water: '/(tabs)/activity',
  treat_ok: '/(tabs)/log',
  reduce_dinner: '/(tabs)/log',
};

export function NudgeCard({ isProfileComplete, onProfilePress }: NudgeCardProps) {
  const nudge = usePetContextStore(s => s.nudge);
  const router = useRouter();

  // Dynamic nudge from the context engine
  if (nudge) {
    const isAction = nudge.priority === 'action';
    const icon = nudge.actionType ? iconMap[nudge.actionType] : { name: 'info-outline' as const, color: '#FFFC00' };
    const route = nudge.actionType ? routeMap[nudge.actionType] : null;

    const card = (
      <LinearGradient
        colors={isAction ? ['#0f172a', '#1e293b'] : ['#1e293b', '#334155']}
        style={styles.gradient}
      >
        <View style={styles.left}>
          <MaterialIcons name={icon.name} size={32} color={icon.color} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, !isAction && { color: '#e2e8f0' }]}>{nudge.title}</Text>
            <Text style={styles.sub}>{nudge.message}</Text>
          </View>
        </View>
        {isAction && route && (
          <MaterialIcons name="arrow-forward-ios" size={16} color="#94a3b8" />
        )}
      </LinearGradient>
    );

    if (isAction && route) {
      return (
        <TouchableOpacity
          style={[styles.container, { marginBottom: 32 }]}
          onPress={() => router.push(route as any)}
          activeOpacity={0.9}
        >
          {card}
        </TouchableOpacity>
      );
    }

    return <View style={[styles.container, { marginBottom: 32 }]}>{card}</View>;
  }

  // Fallback: incomplete profile nudge
  if (!isProfileComplete) {
    return (
      <TouchableOpacity
        style={[styles.container, { marginBottom: 32 }]}
        onPress={onProfilePress}
        activeOpacity={0.9}
      >
        <LinearGradient colors={['#0f172a', '#1e293b']} style={styles.gradient}>
          <View style={styles.left}>
            <MaterialIcons name="health-and-safety" size={32} color="#FFFC00" />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Clinical Profile Setup</Text>
              <Text style={styles.sub}>Gemini AI needs this data to start.</Text>
            </View>
          </View>
          <MaterialIcons name="arrow-forward-ios" size={16} color="#94a3b8" />
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
    borderRadius: 24,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flex: 1,
    paddingRight: 16,
  },
  title: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 16,
    color: '#FFFC00',
    marginBottom: 4,
  },
  sub: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 18,
  },
});
