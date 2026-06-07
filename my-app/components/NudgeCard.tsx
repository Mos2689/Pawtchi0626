import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { usePetContextStore } from '../store/usePetContextStore';
import { useSubscription } from '../hooks/useSubscription';

interface NudgeCardProps {}

const iconMap: Record<string, { name: keyof typeof MaterialIcons.glyphMap; color: string }> = {
  suggest_walk: { name: 'directions-walk', color: '#FFFC00' },
  remind_log: { name: 'restaurant', color: '#FFFC00' },
  remind_water: { name: 'water-drop', color: '#3091F9' },
  remind_weight: { name: 'monitor-weight', color: '#c084fc' },
  remind_activity: { name: 'sports-tennis', color: '#4ade80' },
  treat_ok: { name: 'check-circle', color: '#4ade80' },
  reduce_dinner: { name: 'restaurant-menu', color: '#fb923c' },
  start_trial: { name: 'info-outline', color: '#FFFC00' },
};

const routeMap: Record<string, string> = {
  suggest_walk: '/(tabs)/activity',
  remind_log: '/(tabs)/meal',
  remind_water: '/(tabs)/activity',
  remind_weight: '/(tabs)/health',
  remind_activity: '/(tabs)/activity',
  treat_ok: '/(tabs)/meal',
  reduce_dinner: '/(tabs)/meal',
  start_trial: '/paywall',
};

export function NudgeCard({}: NudgeCardProps) {
  const nudge = usePetContextStore(s => s.nudge);
  const dismissNudge = usePetContextStore(s => s.dismissNudge);
  const router = useRouter();
  const { isPro } = useSubscription();

  // Don't nudge an existing subscriber to start a trial they already have.
  if (nudge?.actionType === 'start_trial' && isPro) {
    return null;
  }

  // Dynamic nudge from the context engine
  if (nudge && nudge.title) {
    const isAction = nudge.priority === 'action';
    const icon = (nudge.actionType && iconMap[nudge.actionType]) ? iconMap[nudge.actionType] : { name: 'info-outline' as const, color: '#FFFC00' };
    const route = (nudge.actionType && routeMap[nudge.actionType]) ? routeMap[nudge.actionType] : null;

    const card = (
      <LinearGradient
        colors={isAction ? ['#0f172a', '#1e293b'] : ['#1e293b', '#334155']}
        style={styles.gradient}
      >
        <View style={styles.left}>
          <View style={styles.iconContainer}>
            <MaterialIcons name={icon.name} size={28} color={icon.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, !isAction && { color: '#e2e8f0' }]}>{nudge.title}</Text>
            {nudge.message && <Text style={styles.sub}>{nudge.message}</Text>}
          </View>
        </View>
        {isAction && route && (
          <View style={styles.arrowContainer}>
            <MaterialIcons name="arrow-forward-ios" size={16} color="#94a3b8" />
          </View>
        )}
      </LinearGradient>
    );

    if (isAction && route) {
      return (
        <TouchableOpacity
          style={[styles.container, { marginBottom: 20 }]}
          onPress={() => {
            dismissNudge();
            router.push(route as any);
          }}
          activeOpacity={0.9}
        >
          {card}
        </TouchableOpacity>
      );
    }

    return <View style={[styles.container, { marginBottom: 20 }]}>{card}</View>;
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
    overflow: 'hidden',
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    borderRadius: 20,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    paddingRight: 12,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,252,0,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 15,
    color: '#FFFC00',
    marginBottom: 3,
    lineHeight: 20,
  },
  sub: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 17,
  },
  arrowContainer: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
