import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';

import { color, font, radius, space, motion, makeShadow } from '../../constants/design';
import { usePetStore } from '../../store/usePetStore';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SelectableChip } from '../../components/SelectableChip';
import { OnboardingHeader } from '../../components/OnboardingHeader';
import { RunningDogIcon } from '../../components/icons/RunningDogIcon';
import { SittingCatIcon } from '../../components/icons/SittingCatIcon';
import { stepIndex, trackStepCompleted, useOnboardingStepTracking } from '../../lib/onboardingFunnel';
import { track } from '../../lib/analytics';

// Picking a species auto-advances after this beat — long enough to see the
// selection land, short enough to keep the flow conversational.
const AUTO_ADVANCE_MS = 450;

// Step 1 of 6 — choose species. One decision, two silhouettes; a tap answers
// and advances. Continue stays as the fallback affordance.
export default function SpeciesScreen() {
  const router = useRouter();
  useOnboardingStepTracking('species');

  const { species, setSpecies } = usePetStore();

  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigatedRef = useRef(false);

  // Re-arm auto-advance when the user comes back to this screen.
  useFocusEffect(
    useCallback(() => {
      navigatedRef.current = false;
      return () => {
        if (advanceTimer.current) clearTimeout(advanceTimer.current);
      };
    }, []),
  );

  const goNext = (chosen: 'dog' | 'cat') => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    trackStepCompleted('species', { species: chosen });
    router.push('/onboarding/identity' as any);
  };

  const handleSelect = (s: 'dog' | 'cat') => {
    setSpecies(s);
    track('onboarding_option_selected', { step: 'species', option: s });
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => goNext(s), AUTO_ADVANCE_MS);
  };

  const cards: { value: 'dog' | 'cat'; title: string; sub: string }[] = [
    { value: 'dog', title: 'Dog', sub: 'Canine friend' },
    { value: 'cat', title: 'Cat', sub: 'Feline friend' },
  ];

  return (
    <View style={styles.container}>
      <OnboardingHeader step={stepIndex('species')} stepId="species" showBack={false} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(420)}>
          <Text style={styles.eyebrow}>STEP {stepIndex('species')}</Text>
          <Text style={styles.title}>Dog or cat?</Text>
          <Text style={styles.subtitle}>
            Meals, movement and watch-outs all start from this one answer.
          </Text>
        </Animated.View>

        <View style={styles.cardsContainer}>
          {cards.map((card, i) => {
            const selected = species === card.value;
            return (
              <Animated.View key={card.value} entering={FadeInDown.duration(420).delay(60 + i * 60)}>
                <SelectableChip
                  selected={selected}
                  style={styles.card}
                  selectedStyle={styles.cardSelected}
                  scaleTo={motion.scale.press}
                  onPress={() => handleSelect(card.value)}
                >
                  <View>
                    <Text style={[styles.cardTitle, selected && styles.cardTitleSelected]}>
                      {card.title}
                    </Text>
                    <Text style={styles.cardSubtitle}>{card.sub}</Text>
                  </View>
                  <View style={styles.cardIcon}>
                    {card.value === 'dog' ? (
                      <RunningDogIcon size={84} color={selected ? color.navy : color.slateFaint} />
                    ) : (
                      <SittingCatIcon size={54} color={selected ? color.navy : color.slateFaint} />
                    )}
                  </View>
                  {selected && (
                    <Animated.View
                      entering={ZoomIn.springify()
                        .damping(motion.spring.bouncy.damping)
                        .stiffness(motion.spring.bouncy.stiffness)}
                      style={styles.checkBadge}
                    >
                      <MaterialIcons name="check" size={14} color={color.navy} />
                    </Animated.View>
                  )}
                </SelectableChip>
              </Animated.View>
            );
          })}
        </View>

        <Animated.Text entering={FadeInDown.duration(420).delay(200)} style={styles.footerNote}>
          You can add more pets later in your profile.
        </Animated.Text>
      </ScrollView>

      <View style={styles.sticky}>
        <PawtchiButton
          title="Continue"
          variant="primary"
          iconName="arrow-forward"
          iconPosition="right"
          disabled={!species}
          onPress={() => {
            if (species) goNext(species);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  scrollContent: { paddingHorizontal: space.xxl, paddingBottom: 120 },

  eyebrow: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    color: color.slateFaint,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  title: {
    fontFamily: font.display,
    fontSize: 40,
    lineHeight: 40,
    letterSpacing: 0.5,
    color: color.ink,
  },
  subtitle: {
    fontFamily: font.regular,
    fontSize: 14.5,
    lineHeight: 21,
    color: color.slateMuted,
    marginTop: space.md,
    marginBottom: space.xxl,
    maxWidth: 320,
  },

  cardsContainer: { gap: space.lg },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingVertical: space.xxl,
    paddingHorizontal: space.xxl,
    minHeight: 132,
  },
  cardSelected: {
    backgroundColor: color.surface,
    borderColor: color.yellow,
    borderWidth: 2,
  },
  cardTitle: {
    fontFamily: font.display,
    fontSize: 42,
    lineHeight: 42,
    letterSpacing: 1,
    color: color.slateMuted,
    marginBottom: 2,
  },
  cardTitleSelected: { color: color.ink },
  cardSubtitle: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.slateFaint,
  },
  cardIcon: {
    width: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadge: {
    position: 'absolute',
    top: space.lg,
    right: space.lg,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: color.yellow,
    borderWidth: 2,
    borderColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footerNote: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: color.slateFaint,
    textAlign: 'center',
    marginTop: space.xxl,
    paddingHorizontal: space.xxxl,
  },

  sticky: {
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    backgroundColor: color.surface,
    ...makeShadow(-6, 14, 0.06),
  },
});
