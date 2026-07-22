import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { usePetContextStore } from '../store/usePetContextStore';
import { useSubscription } from '../hooks/useSubscription';

interface NudgeCardProps {}

const iconMap: Record<string, { name: keyof typeof MaterialIcons.glyphMap; color: string }> = {
  suggest_walk: { name: 'directions-walk', color: '#F7F602' },
  remind_log: { name: 'restaurant', color: '#F7F602' },
  remind_water: { name: 'water-drop', color: '#3091F9' },
  remind_weight: { name: 'monitor-weight', color: '#c084fc' },
  remind_activity: { name: 'sports-tennis', color: '#4ade80' },
  treat_ok: { name: 'check-circle', color: '#4ade80' },
  reduce_dinner: { name: 'restaurant-menu', color: '#fb923c' },
  start_trial: { name: 'info-outline', color: '#F7F602' },
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
    const icon = (nudge.actionType && iconMap[nudge.actionType]) ? iconMap[nudge.actionType] : { name: 'info-outline' as const, color: '#F7F602' };
    const route = (nudge.actionType && routeMap[nudge.actionType]) ? routeMap[nudge.actionType] : null;

    const body = (
      <>
        <View style={styles.iconContainer}>
          <MaterialIcons name={icon.name} size={20} color={icon.color} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{nudge.title}</Text>
          {nudge.message && <Text style={styles.sub}>{nudge.message}</Text>}
        </View>
        {isAction && route && (
          <MaterialIcons name="chevron-right" size={18} color="#94a3b8" />
        )}
      </>
    );

    if (isAction && route) {
      return (
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            dismissNudge();
            router.push(route as any);
          }}
          activeOpacity={0.8}
        >
          {body}
        </TouchableOpacity>
      );
    }

    return <View style={styles.row}>{body}</View>;
  }

  return null;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#0B2A36',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,252,0,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 15,
    color: '#F7F602',
    letterSpacing: -0.2,
  },
  sub: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
    lineHeight: 16,
  },
});
