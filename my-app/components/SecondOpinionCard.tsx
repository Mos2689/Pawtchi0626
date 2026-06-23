import React, { useEffect } from 'react';
import { Text, View, StyleSheet, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing,
} from 'react-native-reanimated';
import { color, font, radius, shadow, space } from '../constants/design';
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

  useEffect(() => {
    breathe.value = withRepeat(
      withTiming(1.04, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, []);

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
        <PulseMark size={26} ringColor={color.yellow} strokeColor={color.yellow} animated resting={resting} />
      </Animated.View>

      <View style={styles.copy}>
        <Text style={styles.eyebrow}>EXPERT GUIDANCE</Text>
        <Text style={styles.title}>Second opinion</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <View style={styles.go}>
        <MaterialIcons name="arrow-forward" size={16} color={color.navy} />
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 24,
    ...shadow.card,
  },
  chip: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: color.navy,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.navyRaised,
  },
  chipResting: { opacity: 0.6 },
  copy: { flex: 1, minWidth: 0 },
  eyebrow: {
    fontFamily: font.semibold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: color.slateFaint,
    marginBottom: 3,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 16,
    color: color.ink,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateMuted,
    marginTop: 2,
  },
  go: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
