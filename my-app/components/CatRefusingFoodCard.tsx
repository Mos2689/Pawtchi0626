/**
 * CatRefusingFoodCard
 *
 * Cat-specific safety nudge. Cats on weight-loss plans are at acute risk of
 * hepatic lipidosis when they stop eating — even a 48-72h fast can be fatal.
 * When the cat is on a `lose` plan and we see zero calories consumed today by
 * mid/late afternoon, we surface a card explicitly naming the risk and asking
 * the owner to call their vet if appetite is genuinely off.
 *
 * This doesn't change the math (the lib-level 14-day ramp does that). It's
 * the user-facing surface.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export interface CatRefusingFoodCardProps {
  species: 'dog' | 'cat' | string | null | undefined;
  goal: 'lose' | 'maintain' | 'gain' | null | undefined;
  todayCalories: number;
  /** Local hour 0–23. Used to avoid showing the card before lunch. */
  currentHour?: number;
  petName: string;
}

export function CatRefusingFoodCard({
  species, goal, todayCalories, currentHour, petName,
}: CatRefusingFoodCardProps) {
  if (species !== 'cat') return null;
  if (goal !== 'lose') return null;
  if (todayCalories > 0) return null;
  // Only show after ~2pm local — earlier in the day there's no signal yet.
  const hour = typeof currentHour === 'number' ? currentHour : new Date().getHours();
  if (hour < 14) return null;

  return (
    <View style={styles.container} accessibilityRole="alert">
      <View style={styles.iconWrap}>
        <MaterialIcons name="warning-amber" size={22} color="#92400e" />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>Has {petName} eaten today?</Text>
        <Text style={styles.body}>
          Cats on a weight-loss plan can develop a dangerous liver condition (hepatic lipidosis) if they stop eating. If {petName} has refused food for more than 24 hours, please call your vet — don&apos;t wait it out.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fdba74',
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fed7aa',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  textWrap: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14,
    color: '#7c2d12',
    letterSpacing: 0.2,
  },
  body: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 12.5,
    lineHeight: 17.5,
    color: '#9a3412',
  },
});
