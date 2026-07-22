import React, { useEffect } from 'react';
import { Text, View, StyleSheet, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useIsFocused } from '@react-navigation/native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation,
} from 'react-native-reanimated';
import { color, font, radius, shadow } from '../constants/design';
import { PulseMark } from './PulseMark';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface SecondOpinionCardProps {
  remaining: number | null;
  resetsAt?: string;
  onPress: () => void;
}

function formatReset(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

// Compact but crafted: the bespoke "Pulse" lives in a navy chip (the brand's
// navy+yellow signature, miniaturised into the feature's mark), framed by a
// refined trailing affordance. Premium through detail, not size.
export function SecondOpinionCard({ remaining, resetsAt, onPress }: SecondOpinionCardProps) {
  const breathe = useSharedValue(1);
  const press = useSharedValue(1);
  const resting = remaining === 0;
  const isFocused = useIsFocused();

  // The breathe loop is infinite — run it only while this screen is focused so
  // it doesn't burn UI-thread frames from behind another tab. Same curve and
  // timing as before when visible.
  useEffect(() => {
    if (!isFocused) return;
    breathe.value = withRepeat(
      withTiming(1.04, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(breathe);
      breathe.value = 1;
    };
  }, [isFocused, breathe]);

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value }] }));

  const subtitle = (() => {
    const reset = formatReset(resetsAt);
    if (resting) return reset ? `Refreshes ${reset}` : 'Refreshes next month';
    if (remaining === null) return 'A calm, expert read — anytime';
    const q = remaining === 1 ? 'question' : 'questions';
    return `${remaining} ${q} left this month`;
  })();

  return (
    <AnimatedPressable
      style={[styles.card, cardStyle]}
      onPress={onPress}
      onPressIn={() => {
        press.value = withTiming(0.985, { duration: 110 });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      onPressOut={() => {
        press.value = withTiming(1, { duration: 150 });
      }}
    >
      <Animated.View style={[styles.chip, markStyle, resting && styles.chipResting]}>
        <PulseMark size={22} ringColor={color.yellow} strokeColor={color.yellow} animated resting={resting} />
      </Animated.View>

      <View style={styles.copy}>
        <Text style={styles.title}>Second opinion</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      
      <MaterialIcons name="chevron-right" size={20} color={color.ink} style={{ opacity: 0.6 }} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 56,
    backgroundColor: color.yellow,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.yellow,
    paddingHorizontal: 12,
    ...shadow.card,
  },
  chip: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: color.navy,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.navyRaised,
  },
  chipResting: { opacity: 0.6 },
  copy: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.ink,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: font.medium,
    fontSize: 11,
    color: color.ink,
    opacity: 0.7,
    marginTop: 1,
  },
});
