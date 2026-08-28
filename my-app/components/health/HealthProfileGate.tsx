/**
 * HealthProfileGate — the contextual ask that replaces up-front onboarding.
 *
 * A dog who came through walk-first onboarding has a name, a breed and an age,
 * and nothing else. That is enough to walk and not nearly enough to compute a
 * calorie target, so health surfaces have to ask for the rest — but at the
 * moment the owner reaches for the feature, not before they have seen the
 * product work.
 *
 * This wraps a health surface rather than blocking navigation. The tab still
 * opens, the screen still has a header; only the part that would have rendered
 * confidently wrong numbers is replaced. That distinction matters: an owner who
 * taps Health should find out what Health *is*, not hit a wall.
 *
 * Tone follows the brief: never "you cannot continue". The card says what the
 * feature would do for their dog by name, and what it needs to do it.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { color, font, makeShadow, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { track } from '../../lib/analytics';
import {
  checkFeature,
  isLightweightProfile,
  type HealthFeature,
  type HealthProfilePet,
} from '../../lib/health/featureRequirements';

/** What each feature is *for*, in the owner's terms rather than the schema's. */
const PROMISE: Record<HealthFeature, string> = {
  meal_logging: 'log meals and see portions that fit',
  calorie_target: 'work out how much food is right',
  weight_plan: 'build a weight plan',
  health_insights: 'spot changes worth noticing',
  activity_plan: 'plan activity around how they actually move',
};

interface HealthProfileGateProps {
  feature: HealthFeature;
  pet: HealthProfilePet | null | undefined;
  petName?: string | null;
  pantryCount?: number;
  /** Rendered when the profile can support the feature. */
  children: React.ReactNode;
}

export function HealthProfileGate({
  feature,
  pet,
  petName,
  pantryCount = 0,
  children,
}: HealthProfileGateProps) {
  const router = useRouter();
  const { ready, missing } = checkFeature(feature, pet, { pantryCount });
  const name = petName?.trim() || 'your dog';
  const lightweight = isLightweightProfile(pet);

  useEffect(() => {
    if (ready) return;
    track('health_gate_shown', { feature, missing_count: missing.length });
  }, [ready, feature, missing.length]);

  if (ready) return <>{children}</>;

  const onStart = () => {
    haptic.tap();
    track('health_gate_started', { feature, missing_count: missing.length });
    // The completion flow is the existing onboarding screens in `complete`
    // mode — the same questions, the same validation, none of it rebuilt.
    router.push({
      pathname: '/onboarding/body-basics',
      params: { mode: 'complete', feature },
    } as never);
  };

  return (
    <View style={styles.screen}>
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <MaterialIcons name="auto-awesome" size={18} color={color.navy} />
      </View>

      <Text style={styles.title}>Personalise this for {name}</Text>
      <Text style={styles.body}>
        {lightweight
          ? `A few things about ${name} and Pawtchi can ${PROMISE[feature]}.`
          : `One or two more details and Pawtchi can ${PROMISE[feature]}.`}
      </Text>

      <View style={styles.list}>
        {missing.slice(0, 3).map(item => (
          <View key={`${item.key}:${item.label}`} style={styles.listRow}>
            <View style={styles.dot} />
            <Text style={styles.listText}>{item.label}</Text>
          </View>
        ))}
        {missing.length > 3 && (
          <Text style={styles.more}>and {missing.length - 3} more</Text>
        )}
      </View>

      <TouchableOpacity
        style={styles.cta}
        onPress={onStart}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel={`Complete ${name}'s health profile`}
      >
        <Text style={styles.ctaText}>
          {lightweight ? "Set up the health profile" : 'Finish the profile'}
        </Text>
      </TouchableOpacity>

      {/* No dismiss. The card IS the screen's content here, so hiding it would
          leave an empty tab — the owner leaves by using the tab bar, which is
          always available. */}
      <Text style={styles.footnote}>Takes about a minute. Walks keep working either way.</Text>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Fills the tab so the card reads as the screen's content rather than a
  // fragment floating on an otherwise empty page.
  screen: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: color.surfaceSubtle,
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.xl,
    margin: space.lg,
    gap: space.sm,
    ...makeShadow(4, 16, 0.08),
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 17,
    color: color.ink,
    letterSpacing: -0.3,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 13.5,
    lineHeight: 20,
    color: color.slateMuted,
  },
  list: {
    gap: space.sm,
    marginTop: space.sm,
    marginBottom: space.xs,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.electric,
  },
  listText: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.ink,
  },
  more: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.slateFaint,
    marginLeft: 14,
  },
  cta: {
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: space.sm,
  },
  ctaText: {
    fontFamily: font.bold,
    fontSize: 14.5,
    color: color.navy,
  },
  footnote: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: color.slateFaint,
    textAlign: 'center',
    marginTop: space.xs,
  },
});
