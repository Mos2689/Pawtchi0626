import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';

import { usePetStore } from '../../store/usePetStore';
import { forwardCompletionParams } from '../../lib/onboarding/completionMode';
import { color, font, radius, space, motion } from '../../constants/design';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SelectableChip } from '../../components/SelectableChip';
import { OnboardingHeader } from '../../components/OnboardingHeader';
import { BodyShapeIcon } from '../../components/icons/BodyShapeIcon';
import { BcsCheckPhoto } from '../../components/BcsCheckPhoto';
import { BCS_OPTIONS } from '../../lib/bcsOptions';
import {
  BcsCheckAnswers, BcsCheckQuestionDef, bcsCheckQuestions, bcsPartialBand,
  buildBcsCheckRecord, fuseBcsSignals, needsTiebreaker, scoreBcsCheck,
} from '../../lib/bcsCheck';
import { bucketForBcs, deriveBcsSuggestion, resolveBcsSource } from '../../lib/bcsPhotoEstimate';
import { haptic } from '../../lib/haptics';
import { track } from '../../lib/analytics';
import { stepIndex, trackStepCompleted, useOnboardingStepTracking } from '../../lib/onboardingFunnel';

type Phase = 'intro' | 'questions' | 'reveal' | 'fallback';

// Live 1–9 spectrum — the refining band is the "labour" the owner watches:
// each answer visibly narrows where their pet sits. Lies wider on conflict,
// never narrower (bcsPartialBand).
function SpectrumBar({ lo, hi }: { lo: number; hi: number }) {
  const [trackW, setTrackW] = useState(0);
  const left = useSharedValue(0);
  const width = useSharedValue(1);

  useEffect(() => {
    if (trackW <= 0) return;
    left.value = withSpring(((lo - 1) / 9) * trackW, motion.spring.gentle);
    width.value = withSpring(((hi - lo + 1) / 9) * trackW, motion.spring.gentle);
  }, [lo, hi, trackW, left, width]);

  const bandStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: left.value }],
    width: width.value,
  }));

  return (
    <View style={styles.spectrumWrap}>
      <View style={styles.spectrumTrack} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
        <Animated.View style={[styles.spectrumBand, bandStyle]} />
        {[...Array(8)].map((_, i) => (
          <View key={i} style={[styles.spectrumTick, { left: `${((i + 1) / 9) * 100}%` }]} />
        ))}
      </View>
      <View style={styles.spectrumLabels}>
        <Text style={styles.spectrumLabel}>Lean</Text>
        <Text style={styles.spectrumLabel}>Round</Text>
      </View>
    </View>
  );
}

/**
 * The Hands-On Check — onboarding's BCS input. Three WSAVA palpation
 * questions (a conditional fourth as tiebreaker) replace the gestalt
 * silhouette pick: owners who'd never tap "overweight" will still answer
 * "I have to press to feel the ribs" honestly. Scoring + fusion with the
 * photo read live in lib/bcsCheck.ts; this screen is choreography.
 */
export default function BodyCheckScreen() {
  const router = useRouter();
  const completionParams = useLocalSearchParams<{ mode?: string; feature?: string }>();
  useOnboardingStepTracking('body_check');

  const petData = usePetStore();
  const speciesVal = petData.species === 'cat' ? 'cat' as const : 'dog' as const;
  const petName = petData.name?.trim() || (speciesVal === 'cat' ? 'your cat' : 'your dog');
  const currentWeight = parseFloat(petData.weight) || 0;

  const [phase, setPhase] = useState<Phase>('intro');
  const [answers, setAnswers] = useState<Partial<BcsCheckAnswers>>({});
  const [qIndex, setQIndex] = useState(0);
  const [askPad, setAskPad] = useState(false);
  const [fallbackPick, setFallbackPick] = useState<number | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);

  const allQuestions = useMemo(() => bcsCheckQuestions(speciesVal, petData.name?.trim() || ''), [speciesVal, petData.name]);
  const activeQuestions: BcsCheckQuestionDef[] = useMemo(
    () => (askPad ? allQuestions : allQuestions.slice(0, 3)),
    [allQuestions, askPad],
  );
  const question = activeQuestions[Math.min(qIndex, activeQuestions.length - 1)];
  const band = bcsPartialBand(answers);

  const fusionCtx = useMemo(() => ({
    species: speciesVal,
    breed: petData.breed || null,
    sex: (petData.gender === 'male' || petData.gender === 'female') ? petData.gender : null,
    currentWeightKg: currentWeight,
  }), [speciesVal, petData.breed, petData.gender, currentWeight]);

  // Final score + fusion — only meaningful once the three core answers exist.
  const finalResult = useMemo(() => {
    if (!answers.rib || !answers.waist || !answers.tuck) return null;
    const score = scoreBcsCheck(answers as BcsCheckAnswers);
    const fused = fuseBcsSignals(score, petData.bcsPhotoRaw, fusionCtx);
    return { score, fused };
  }, [answers, petData.bcsPhotoRaw, fusionCtx]);

  // Photo pre-highlight for the fallback quick pick — same gating as before.
  const photoSuggestion = useMemo(() => {
    if (!petData.bcsPhotoRaw) return null;
    return deriveBcsSuggestion(petData.bcsPhotoRaw, fusionCtx).suggestion;
  }, [petData.bcsPhotoRaw, fusionCtx]);

  const startCheck = () => {
    track('bcs_check_started', { species: speciesVal });
    setAnswers({});
    setQIndex(0);
    setAskPad(false);
    setPhase('questions');
  };

  const openFallback = (reason: 'intro' | 'mid_check') => {
    track('bcs_check_fallback_used', { reason });
    setPhase('fallback');
  };

  const handleAnswer = (value: string) => {
    const next = { ...answers, [question.id]: value } as Partial<BcsCheckAnswers>;
    setAnswers(next);
    track('bcs_check_answered', { question: question.id, value });

    // Short beat so the spectrum visibly narrows before the next card.
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      const answeredCore = next.rib && next.waist && next.tuck;
      if (question.id !== 'pad' && answeredCore && qIndex >= 2) {
        const core = { rib: next.rib!, waist: next.waist!, tuck: next.tuck! };
        if (needsTiebreaker(core)) {
          if (scoreBcsCheck(core).coreConflict) {
            track('bcs_check_conflict', { ...core });
          }
          setAskPad(true);
          setQIndex(3);
          return;
        }
        setPhase('reveal');
        return;
      }
      if (question.id === 'pad') {
        setPhase('reveal');
        return;
      }
      setQIndex((i) => i + 1);
    }, 450);
  };

  const handleBackAStep = () => {
    if (qIndex === 0) return;
    haptic.tap();
    const prev = activeQuestions[qIndex - 1];
    // Clear the answer being revisited and anything after it.
    setAnswers((a) => {
      const copy = { ...a };
      for (const q of activeQuestions.slice(qIndex - 1)) delete copy[q.id];
      return copy;
    });
    if (prev.id !== 'pad') setAskPad(false);
    setQIndex((i) => i - 1);
  };

  // One heartbeat on the reveal — completion, not chatter.
  useEffect(() => {
    if (phase !== 'reveal') return;
    const t = setTimeout(() => haptic.success(), 550);
    return () => clearTimeout(t);
  }, [phase]);

  const commitGuided = () => {
    if (!finalResult) return;
    const { score, fused } = finalResult;
    petData.setBodyConditionScore(fused.bcs);
    petData.setBcsSource('guided_check');
    petData.setBcsCheckRecord(
      buildBcsCheckRecord(answers as BcsCheckAnswers, score, fused, petData.bcsPhotoRaw),
    );
    track('bcs_check_completed', {
      bcs: fused.bcs,
      band_low: fused.bcsLow,
      band_high: fused.bcsHigh,
      tier: fused.tier,
      photo_agreement: fused.photoAgreement,
      conflict: score.conflict,
    });
    trackStepCompleted('body_check', { bcs: fused.bcs, tier: fused.tier, method: 'guided' });
    router.push({ pathname: '/onboarding/goal', params: forwardCompletionParams(completionParams) } as never);
  };

  const commitFallback = () => {
    if (fallbackPick == null) return;
    petData.setBodyConditionScore(fallbackPick);
    petData.setBcsSource(resolveBcsSource(fallbackPick, photoSuggestion));
    petData.setBcsCheckRecord(null);
    trackStepCompleted('body_check', { bcs: fallbackPick, method: 'quick_pick' });
    router.push({ pathname: '/onboarding/goal', params: forwardCompletionParams(completionParams) } as never);
  };

  const revealOption = finalResult
    ? BCS_OPTIONS.find((o) => o.bcs === bucketForBcs(finalResult.fused.bcs)) ?? BCS_OPTIONS[1]
    : BCS_OPTIONS[1];

  const tierBadge = finalResult
    ? finalResult.fused.tier === 'vet_grade'
      ? { icon: 'auto-awesome' as const, label: 'Vet-grade read' }
      : finalResult.fused.tier === 'solid'
        ? { icon: 'check-circle' as const, label: 'Solid read' }
        : { icon: 'info-outline' as const, label: 'Rough read — worth confirming with your vet' }
    : null;

  const revealCaption = finalResult
    ? finalResult.fused.photoAgreement === 'agree'
      ? `Your hands and ${petName}’s photo agree.`
      : finalResult.fused.photoAgreement === 'disagree'
        ? 'We trusted your hands over the photo — touch sees through the coat.'
        : 'Read straight from your hands-on answers.'
    : '';

  return (
    <View style={styles.container}>
      <OnboardingHeader step={stepIndex('body_check')} stepId="body_check" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {phase === 'intro' && (
          <Animated.View entering={FadeInDown.duration(420)}>
            <Text style={styles.eyebrow}>STEP {stepIndex('body_check')}</Text>
            <Text style={styles.title}>A quick{'\n'}hands-on check.</Text>
            <Text style={styles.subtitle}>
              Your hands read {petName}&apos;s body better than any photo — coats can hide a lot.
              Three little checks, about a minute. To {petName}, it&apos;s just petting.
            </Text>

            <View style={styles.introCard}>
              <BcsCheckPhoto id="rib" species={speciesVal} />
            </View>

            <PawtchiButton
              title={`Start — with ${petName} nearby`}
              variant="primary"
              iconName="pets"
              iconPosition="right"
              onPress={startCheck}
            />
            <TouchableOpacity activeOpacity={0.7} style={styles.quietLink} onPress={() => openFallback('intro')}>
              <Text style={styles.quietLinkText}>Can&apos;t check right now?</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {phase === 'questions' && question && (
          <View>
            <View style={styles.questionMetaRow}>
              <Text style={styles.eyebrow}>CHECK {Math.min(qIndex + 1, activeQuestions.length)} OF {activeQuestions.length}</Text>
              {qIndex > 0 && (
                <TouchableOpacity activeOpacity={0.7} onPress={handleBackAStep} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.backStepText}>‹ Previous</Text>
                </TouchableOpacity>
              )}
            </View>

            <SpectrumBar lo={band.lo} hi={band.hi} />

            <Animated.View key={question.id} entering={FadeInDown.duration(motion.duration.base)}>
              <View style={styles.illustrationCard}>
                <BcsCheckPhoto id={question.id} species={speciesVal} />
              </View>
              <Text style={styles.questionTitle}>{question.title}</Text>
              <Text style={styles.questionHint}>{question.hint}</Text>

              <View style={styles.optionsCol}>
                {question.options.map((opt) => {
                  const isSelected = answers[question.id] === opt.value;
                  return (
                    <SelectableChip
                      key={opt.value}
                      selected={isSelected}
                      style={styles.optionRow}
                      selectedStyle={styles.optionRowSelected}
                      scaleTo={motion.scale.press}
                      onPress={() => handleAnswer(opt.value)}
                    >
                      <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                        {opt.label}
                      </Text>
                    </SelectableChip>
                  );
                })}
              </View>
            </Animated.View>
          </View>
        )}

        {phase === 'reveal' && finalResult && tierBadge && (
          <View style={styles.revealWrap}>
            <Animated.View entering={FadeInDown.duration(motion.duration.slow)}>
              <Text style={styles.eyebrow}>NOSE-TO-TAIL CHECK DONE</Text>
              <Text style={styles.title}>{petName} looks{'\n'}{revealOption.label.toLowerCase()}.</Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(motion.duration.slow).delay(200)} style={styles.revealCard}>
              <BodyShapeIcon shape={revealOption.shape} species={speciesVal} size={96} color={color.navy} />
              <SpectrumBar lo={finalResult.fused.bcsLow} hi={finalResult.fused.bcsHigh} />
              <View style={styles.tierBadge}>
                <MaterialIcons name={tierBadge.icon} size={14} color={color.navy} />
                <Text style={styles.tierBadgeText}>{tierBadge.label}</Text>
              </View>
              <Text style={styles.revealCaption}>{revealCaption}</Text>
            </Animated.View>

            <Animated.View entering={FadeIn.duration(motion.duration.slow).delay(500)}>
              <PawtchiButton
                title="Looks right — set the goal"
                variant="primary"
                iconName="arrow-forward"
                iconPosition="right"
                onPress={commitGuided}
              />
              <TouchableOpacity activeOpacity={0.7} style={styles.quietLink} onPress={startCheck}>
                <Text style={styles.quietLinkText}>Redo the check</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        )}

        {phase === 'fallback' && (
          <Animated.View entering={FadeInDown.duration(420)}>
            <Text style={styles.eyebrow}>QUICK PICK</Text>
            <Text style={styles.title}>Which shape looks{'\n'}most like {petName}?</Text>
            <Text style={styles.subtitle}>
              A rough pick works for now — you can do the hands-on check any time from the goal screen.
            </Text>

            {photoSuggestion && (
              <View style={styles.suggestChip}>
                <MaterialIcons name="auto-awesome" size={14} color={color.navy} />
                <Text style={styles.suggestChipText}>
                  From the photo, <Text style={styles.suggestChipBold}>
                    {(BCS_OPTIONS.find((o) => o.bcs === photoSuggestion.bucket)?.label ?? '').toLowerCase()}
                  </Text> looks closest.
                </Text>
              </View>
            )}

            <View style={styles.optionsCol}>
              {BCS_OPTIONS.map((opt) => {
                const isSelected = fallbackPick === opt.bcs;
                const isSuggested = photoSuggestion?.bucket === opt.bcs && fallbackPick == null;
                return (
                  <SelectableChip
                    key={opt.bcs}
                    selected={isSelected}
                    style={[styles.shapeRow, isSuggested && styles.shapeRowSuggested]}
                    selectedStyle={styles.optionRowSelected}
                    scaleTo={motion.scale.press}
                    onPress={() => {
                      setFallbackPick(opt.bcs);
                      track('onboarding_option_selected', { step: 'body_check', option: 'quick_pick_bcs', value: opt.bcs });
                    }}
                  >
                    <BodyShapeIcon
                      shape={opt.shape}
                      species={speciesVal}
                      size={52}
                      color={isSelected ? color.navy : color.slateFaint}
                    />
                    <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>{opt.label}</Text>
                  </SelectableChip>
                );
              })}
            </View>

            <PawtchiButton
              title="Continue"
              variant="primary"
              iconName="arrow-forward"
              iconPosition="right"
              disabled={fallbackPick == null}
              onPress={commitFallback}
            />
            <TouchableOpacity activeOpacity={0.7} style={styles.quietLink} onPress={startCheck}>
              <Text style={styles.quietLinkText}>Actually — let&apos;s do the hands-on check</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: space.xxl,
    paddingBottom: 48,
  },

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
    fontSize: 38,
    lineHeight: 38,
    letterSpacing: 0.5,
    color: color.ink,
  },
  subtitle: {
    fontFamily: font.regular,
    fontSize: 14.5,
    lineHeight: 21,
    color: color.slateMuted,
    marginTop: space.md,
    marginBottom: space.xl,
    maxWidth: 320,
  },

  // Photo frames its own card (BcsCheckPhoto) — wrappers only own spacing.
  introCard: {
    marginBottom: space.xl,
  },

  questionMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backStepText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slateMuted,
    marginTop: space.lg,
    marginBottom: space.sm,
  },

  spectrumWrap: {
    marginBottom: space.lg,
    gap: 4,
  },
  spectrumTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: color.track,
    overflow: 'hidden',
  },
  spectrumBand: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
  },
  spectrumTick: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    width: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
  },
  spectrumLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  spectrumLabel: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    color: color.slateFaint,
    textTransform: 'uppercase',
  },

  illustrationCard: {
    marginBottom: space.lg,
  },
  questionTitle: {
    fontFamily: font.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: color.ink,
  },
  questionHint: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: color.slateMuted,
    marginTop: 4,
    marginBottom: space.lg,
  },

  optionsCol: {
    gap: 10,
    marginBottom: space.xl,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 16,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  optionRowSelected: {
    backgroundColor: color.surface,
    borderColor: color.yellow,
    borderWidth: 2,
  },
  optionText: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 19,
    color: color.slate,
  },
  optionTextSelected: {
    fontFamily: font.bold,
    color: color.ink,
  },

  shapeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 12,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  shapeRowSuggested: {
    backgroundColor: color.yellowSoft,
    borderColor: color.yellow,
  },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: color.yellowSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.yellow,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: space.lg,
  },
  suggestChipText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.slate,
  },
  suggestChipBold: {
    fontFamily: font.bold,
    color: color.ink,
  },

  revealWrap: {
    gap: space.xl,
  },
  revealCard: {
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.xxl,
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: color.yellowSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tierBadgeText: {
    fontFamily: font.bold,
    fontSize: 12.5,
    color: color.navy,
    flexShrink: 1,
  },
  revealCaption: {
    fontFamily: font.medium,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.slateMuted,
    textAlign: 'center',
  },

  quietLink: {
    alignItems: 'center',
    paddingVertical: space.lg,
  },
  quietLinkText: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.slateMuted,
    textDecorationLine: 'underline',
  },
});
