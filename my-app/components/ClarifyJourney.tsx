import React, { useEffect, useMemo, useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn, FadeInRight, useSharedValue, useAnimatedStyle, withTiming, Easing,
} from 'react-native-reanimated';
import { Typography } from './Typography';
import { color, font, radius, space, shadow } from '../constants/design';
import type { ClarifyPayload, ClarifyQuestion } from '../lib/askVet';

interface ClarifyJourneyProps {
  /** The owner's original question, shown as quiet context. */
  question: string;
  clarify: ClarifyPayload;
  petName: string;
  /** Compiled one-line summary of the owner's answers. */
  onSubmit: (summary: string) => void;
  /** Best-judgment read without adding detail. */
  onSkip: () => void;
}

// A guided, one-question-per-screen assessment — not a form. Progress, big type,
// card choices that auto-advance with a calm confirmation, and a deliberate final
// action. Restrained motion and voice (no hype, no exclamation) per the brand.
export function ClarifyJourney({ question, clarify, petName, onSubmit, onSkip }: ClarifyJourneyProps) {
  // Order: quick-pick questions first (easiest momentum), free-text note last.
  const steps: ClarifyQuestion[] = useMemo(() => {
    const pick = clarify.questions.filter((q) => q.options && q.options.length > 0);
    const note = clarify.questions.find((q) => !q.options || q.options.length === 0);
    return note ? [...pick, note] : pick;
  }, [clarify.questions]);

  const total = steps.length;
  const [idx, setIdx] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');

  const current = steps[idx];
  const isNoteStep = !current?.options || current.options.length === 0;
  const isLast = idx === total - 1;

  // Smooth progress bar.
  const progress = useSharedValue(1 / Math.max(total, 1));
  useEffect(() => {
    progress.value = withTiming((idx + 1) / Math.max(total, 1), {
      duration: 420,
      easing: Easing.out(Easing.cubic),
    });
  }, [idx, total]);
  const barStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const compile = (): string => {
    const parts: string[] = [];
    for (const q of steps) {
      if (q.options && q.options.length > 0 && selections[q.id]) {
        parts.push(`${q.label}: ${selections[q.id]}.`);
      }
    }
    if (note.trim()) parts.push(`Notes: ${note.trim()}.`);
    return parts.join(' ');
  };

  const goNext = () => {
    if (idx < total - 1) setIdx(idx + 1);
    else onSubmit(compile());
  };

  const choose = (id: string, value: string) => {
    setSelections((s) => ({ ...s, [id]: value }));
    Haptics.selectionAsync();
    // Brief pause lets the selected state register, then carry momentum forward.
    if (!isLast) setTimeout(() => setIdx((i) => Math.min(i + 1, total - 1)), 240);
  };

  const selectedForCurrent = current ? selections[current.id] : undefined;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* ── Top: back + progress ── */}
      <View style={styles.top}>
        <TouchableOpacity
          onPress={() => (idx > 0 ? setIdx(idx - 1) : undefined)}
          disabled={idx === 0}
          style={styles.back}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialIcons name="arrow-back" size={20} color={idx === 0 ? 'transparent' : color.slateMuted} />
        </TouchableOpacity>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, barStyle]} />
        </View>
        <Typography variant="caption" color={color.slateFaint} style={styles.stepCount}>
          {idx + 1}/{total}
        </Typography>
      </View>

      <Typography variant="caption" color={color.slateFaint} numberOfLines={1} style={styles.context}>
        About {petName} · {question}
      </Typography>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* key swap replays the entrance — each screen feels like a step forward */}
        <Animated.View key={idx} entering={FadeInRight.duration(300)}>
          {/* Intro only on the first screen, as a warm opener */}
          {idx === 0 && !!clarify.intro && (
            <Animated.View entering={FadeIn.duration(300)}>
              <Typography variant="body" color={color.slateMuted} style={styles.intro}>
                {clarify.intro}
              </Typography>
            </Animated.View>
          )}

          <Typography variant="title" weight="bold" color={color.ink} style={styles.question}>
            {current?.label}
          </Typography>

          {!!current?.why && (
            <Typography variant="body" color={color.slateMuted} style={styles.why}>
              {current.why}
            </Typography>
          )}

          {isNoteStep ? (
            <>
              <TextInput
                style={styles.note}
                value={note}
                onChangeText={setNote}
                multiline
                maxLength={300}
                placeholder="Optional — anything that might matter"
                placeholderTextColor={color.slateFaint}
              />
              <TouchableOpacity style={styles.primary} activeOpacity={0.9} onPress={() => onSubmit(compile())}>
                <Typography variant="body" weight="bold" color={color.navy}>
                  Get {petName}&apos;s answer
                </Typography>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.options}>
              {current?.options.map((opt) => {
                const selected = selectedForCurrent === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.option, selected && styles.optionSelected]}
                    activeOpacity={0.9}
                    onPress={() => choose(current.id, opt)}
                  >
                    <Typography
                      variant="body"
                      weight={selected ? 'semibold' : 'medium'}
                      color={color.ink}
                      style={styles.optionText}
                    >
                      {opt}
                    </Typography>
                    <View style={[styles.radio, selected && styles.radioOn]}>
                      {selected && <MaterialIcons name="check" size={14} color={color.navy} />}
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* On the (rare) last pick step with no note, an explicit resolve. */}
              {isLast && (
                <TouchableOpacity style={styles.primary} activeOpacity={0.9} onPress={() => onSubmit(compile())}>
                  <Typography variant="body" weight="bold" color={color.navy}>
                    Get {petName}&apos;s answer
                  </Typography>
                </TouchableOpacity>
              )}
            </View>
          )}
        </Animated.View>
      </ScrollView>

      {/* ── Persistent calm escape ── */}
      <View style={styles.footer}>
        {!isNoteStep && !isLast && (
          <TouchableOpacity onPress={goNext} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Typography variant="body" weight="medium" color={color.slateMuted}>
              I&apos;m not sure — skip this
            </Typography>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onSkip} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Typography variant="caption" color={color.slateFaint}>
            Skip and use your best read
          </Typography>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xxl,
    paddingTop: space.sm,
  },
  back: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  track: {
    flex: 1,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: color.track,
    overflow: 'hidden',
  },
  fill: { height: 5, borderRadius: radius.pill, backgroundColor: color.navy },
  stepCount: { fontFamily: font.semibold, minWidth: 28, textAlign: 'right' },

  context: {
    paddingHorizontal: space.xxl,
    marginTop: space.md,
    opacity: 0.9,
  },

  scroll: { paddingHorizontal: space.xxl, paddingTop: space.xl, paddingBottom: space.xxl },
  intro: { marginBottom: space.lg, lineHeight: 22 },
  question: { fontSize: 26, lineHeight: 32, letterSpacing: -0.4, marginBottom: space.sm },
  why: { marginBottom: space.xl, lineHeight: 21 },

  options: { gap: space.md },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.hairline,
    borderRadius: radius.xl,
    paddingVertical: 18,
    paddingHorizontal: space.xl,
    ...shadow.card,
  },
  optionSelected: {
    borderColor: color.navy,
    backgroundColor: color.yellowSoft,
  },
  optionText: { flex: 1, fontSize: 16, paddingRight: space.md },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: color.slateFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: color.navy, backgroundColor: color.yellow },

  note: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    minHeight: 96,
    textAlignVertical: 'top',
    fontFamily: font.medium,
    fontSize: 16,
    color: color.ink,
    marginBottom: space.xl,
  },
  primary: {
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },

  footer: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
  },
});
