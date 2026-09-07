import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  FadeIn, FadeInDown, useSharedValue, useAnimatedStyle,
  withRepeat, withTiming, Easing, cancelAnimation,
} from 'react-native-reanimated';

import { Header } from '../components/Header';
import { Typography } from '../components/Typography';
import { PawtchiButton } from '../components/PawtchiButton';
import { ErrorState } from '../components/ErrorState';
import { VetAnswerCard } from '../components/VetAnswerCard';
import { PulseMark } from '../components/PulseMark';
import { color, font, motion, radius, shadow, space } from '../constants/design';
import { PawLoader } from '../components/loader/PawLoader';
import { useActivePetStore } from '../store/useActivePetStore';
import { useAuth } from '../providers/AuthProvider';
import { useSubscription } from '../hooks/useSubscription';
import { possessivePronoun } from '../lib/referral';
import { getSuggestedQuestions } from '../lib/vetQuestionPrompts';
import { track } from '../lib/analytics';
import { resolvePetImage } from '../lib/petFallbackImage';
import type { ErrorCopy, RecoveryActionId } from '../lib/appError';
import {
  askVet, askFollowup, getMonthlyUsage, getHistory, getThread, FOLLOWUP_CAP,
  type MonthlyUsage, type VetAnswer, type VetQuestionRecord, type ClarifyPayload,
  type VetFollowupTurn,
} from '../lib/askVet';
import { ClarifyJourney } from '../components/ClarifyJourney';

function formatShortDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

type Phase = 'idle' | 'thinking' | 'clarify' | 'answer';

// ─── The lively "thinking" moment — pulsing ring + rotating reassurance ───
function ThinkingState({ imageUri, lines }: { imageUri: string; lines: string[] }) {
  const pulse = useSharedValue(1);
  const [lineIdx, setLineIdx] = useState(0);

  useEffect(() => {
    // Breathing (the shared "working" signal), not a heartbeat — the single
    // heartbeat is reserved for completion, per the Living Paw motion language.
    pulse.value = withRepeat(
      withTiming(1.18, { duration: motion.loader.breatheCycle / 2, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    const id = setInterval(() => setLineIdx((i) => (i + 1) % lines.length), motion.loader.copyRotate);
    return () => {
      clearInterval(id);
      cancelAnimation(pulse);
    };
  }, [lines.length]);

  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.thinkingWrap}>
      <View style={styles.thinkingRingWrap}>
        <Animated.View style={[StyleSheet.absoluteFillObject, styles.thinkingCenter, ringStyle]}>
          <PulseMark size={160} variant="listening" ringColor={color.navy} />
        </Animated.View>
        <View style={styles.thinkingAvatarWrap}>
          <Image source={{ uri: imageUri }} style={styles.thinkingAvatar} contentFit="cover" cachePolicy="memory-disk" transition={200} />
        </View>
      </View>
      <Typography variant="body" color={color.slateMuted} align="center" style={styles.thinkingText}>
        {lines[lineIdx]}…
      </Typography>
    </Animated.View>
  );
}

export default function AskScreen() {
  const router = useRouter();
  const activePet = useActivePetStore(s => s.activePet);
  const { user } = useAuth();
  const { hasFullAccess } = useSubscription();

  const petName = activePet?.name?.trim() || 'your companion';
  const their = possessivePronoun(activePet?.gender);
  const imageUri = resolvePetImage(activePet?.image_url, activePet?.species, 400);

  const [usage, setUsage] = useState<MonthlyUsage | null>(null);
  const [question, setQuestion] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [answer, setAnswer] = useState<VetAnswer | null>(null);
  const [clarify, setClarify] = useState<ClarifyPayload | null>(null);
  const [askedQuestion, setAskedQuestion] = useState('');
  const [history, setHistory] = useState<VetQuestionRecord[]>([]);
  // In-flow failure card (branded copy from askVet). retryRef replays whatever
  // call failed — the first ask, a clarified ask, or a follow-up.
  const [failure, setFailure] = useState<ErrorCopy | null>(null);
  const retryRef = useRef<null | (() => void)>(null);
  const answerScrollRef = useRef<ScrollView>(null);
  const idleScrollRef = useRef<ScrollView>(null);

  // ── Case / thread state ──
  const [caseId, setCaseId] = useState<string | null>(null);
  const [turns, setTurns] = useState<VetFollowupTurn[]>([]);
  const [followupsLeft, setFollowupsLeft] = useState(FOLLOWUP_CAP);
  const [followupText, setFollowupText] = useState('');
  const [checkinMode, setCheckinMode] = useState(false);
  const [caseLoading, setCaseLoading] = useState(false);

  const params = useLocalSearchParams<{ case?: string; mode?: string }>();
  const caseParamHandled = useRef<string | null>(null);
  const openedTracked = useRef(false);

  const suggestions = getSuggestedQuestions(activePet?.name, activePet?.gender);

  const thinkingLines = [
    `Reading ${petName}'s recent logs`,
    `Looking at ${their} weight trend`,
    `Considering ${their} diet`,
    `Thinking it through calmly`,
  ];

  const loadMeta = useCallback(async () => {
    if (user?.id) setUsage(await getMonthlyUsage(user.id));
    if (activePet?.id) setHistory(await getHistory(activePet.id));
  }, [user?.id, activePet?.id]);

  // Gate: Ask Pawtchi is a full-access feature.
  useEffect(() => {
    if (!hasFullAccess) {
      track('vet_ask_blocked_paywall');
      router.replace('/paywall' as any);
    }
  }, [hasFullAccess]);

  useEffect(() => {
    if (!openedTracked.current) {
      openedTracked.current = true;
      track('vet_ask_opened', { species: activePet?.species ?? null });
    }
    loadMeta();
  }, [loadMeta]);

  // Hydrate a case thread (head + turns) into the answer view. Used both by the
  // deep-link/nudge path and by tapping a row in "Previous questions".
  const openCase = useCallback(
    async (id: string, opts?: { checkin?: boolean; source?: 'deep_link' | 'history' }) => {
      if (!activePet) return;
      setCaseLoading(true);
      const thread = await getThread(id);
      setCaseLoading(false);
      if (!thread) return;
      setCaseId(thread.head.id);
      setAnswer(thread.head.answer);
      setAskedQuestion(thread.head.question);
      setTurns(thread.turns);
      setFollowupsLeft(thread.followupsLeft);
      setCheckinMode(!!opts?.checkin);
      setPhase('answer');
      if (opts?.checkin) track('vet_checkin_opened', { source: opts.source ?? 'deep_link' });
      else if (opts?.source === 'history') track('vet_history_case_opened');
    },
    [activePet?.id],
  );

  // Deep-link / nudge: open an existing case (optionally straight into check-in).
  useEffect(() => {
    const id = params.case;
    if (!id || !activePet || caseParamHandled.current === id) return;
    caseParamHandled.current = id;
    openCase(id, { checkin: params.mode === 'checkin', source: 'deep_link' });
  }, [params.case, params.mode, activePet?.id, openCase]);

  const remaining = usage?.remaining ?? null;
  const outOfQuestions = remaining === 0;

  // Resolve a final answer for `text`, optionally with clarifying detail.
  // Used by the first ask (no clarify), and by submit/skip from the clarify card.
  const resolveAnswer = async (text: string, clarifyAnswers?: string) => {
    if (!activePet) return;
    setPhase('thinking');
    const result = await askVet(activePet.id, text, clarifyAnswers);
    if (result.kind === 'clarify') {
      setClarify(result.clarify);
      setPhase('clarify');
      track('vet_ask_clarify_shown', { questions: result.clarify.questions.length });
    } else if (result.kind === 'answer') {
      setAnswer(result.answer);
      setClarify(null);
      // Fresh assessment → start a new case thread.
      setCaseId(result.caseId);
      setTurns([]);
      setFollowupsLeft(FOLLOWUP_CAP);
      setCheckinMode(false);
      setPhase('answer');
      track('vet_ask_answered', {
        red_flag: result.answer.redFlag,
        urgency: result.answer.urgency ?? 'routine',
        off_topic: !!result.answer.offTopic,
        clarified: clarifyAnswers != null,
      });
      loadMeta();
    } else if (result.kind === 'limit') {
      setPhase('idle');
      setUsage((u) => (u ? { ...u, used: u.cap, remaining: 0, resetsAt: result.resetsAt } : u));
      track('vet_ask_limit_reached');
    } else {
      setPhase(clarify ? 'clarify' : 'idle');
      retryRef.current = () => resolveAnswer(text, clarifyAnswers);
      setFailure(result.copy);
    }
  };

  const handleSubmit = (override?: string) => {
    const text = (override ?? question).trim();
    if (!text || !activePet) return;
    Keyboard.dismiss();
    setAskedQuestion(text);
    track('vet_ask_submitted', { length: text.length, suggested: override != null });
    resolveAnswer(text);
  };

  const resolveWithClarify = (summary: string) => {
    // Empty summary (owner tapped through without picking) → best-judgment read.
    const detail = summary.trim() || '(owner skipped detail — use best judgment)';
    track('vet_ask_clarify_submitted', { provided: summary.trim().length > 0 });
    resolveAnswer(askedQuestion, detail);
  };

  const skipClarify = () => {
    track('vet_ask_clarify_skipped');
    resolveAnswer(askedQuestion, '(owner skipped detail — use best judgment)');
  };

  const askAnother = () => {
    setPhase('idle');
    setAnswer(null);
    setClarify(null);
    setQuestion('');
    setAskedQuestion('');
    setCaseId(null);
    setTurns([]);
    setFollowupsLeft(FOLLOWUP_CAP);
    setCheckinMode(false);
  };

  // Add a follow-up question or a check-in reply to the open case.
  const submitFollowup = async (text: string, kind: 'followup' | 'checkin') => {
    const body = text.trim();
    if (!body || !activePet || !caseId) return;
    Keyboard.dismiss();
    setFollowupText('');
    setCheckinMode(false);
    setPhase('thinking');
    const result = await askFollowup(activePet.id, caseId, body, kind);
    if (result.kind === 'answer') {
      setTurns((prev) => [
        ...prev,
        { id: `tmp-${Date.now()}`, kind, ownerText: body, answer: result.answer, createdAt: new Date().toISOString() },
      ]);
      setFollowupsLeft(result.followupsLeft);
      setPhase('answer');
      track(kind === 'checkin' ? 'vet_checkin_replied' : 'vet_followup_submitted', {
        urgency: result.answer.urgency ?? 'routine',
      });
    } else if (result.kind === 'limit') {
      setFollowupsLeft(0);
      setPhase('answer');
      track('vet_followup_limit');
    } else {
      setPhase('answer');
      retryRef.current = () => submitFollowup(text, kind);
      setFailure(result.copy);
    }
  };

  const handleFailureAction = (action: RecoveryActionId) => {
    setFailure(null);
    if (action === 'retry') retryRef.current?.();
  };

  // A docked, in-flow failure card — replaces the old blocking error modal on
  // every phase. Retry replays the failed call; "Not now" just clears it.
  const renderFailure = () =>
    failure ? (
      <View style={styles.failureDock}>
        <ErrorState
          copy={failure}
          variant="card"
          icon="error-outline"
          onAction={handleFailureAction}
          onDismiss={() => setFailure(null)}
          errorContext="ask_vet"
          screen="/ask"
        />
      </View>
    ) : null;

  // One-tap check-in replies (decision > tap), pet-name aware.
  const checkinOptions = [
    `${petName} is doing better`,
    'About the same',
    `${petName} is worse`,
    `${petName} saw the vet`,
  ];

  // ─── Loading an existing case (from a nudge / push deep-link) ───
  if (caseLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Second Opinion" />
        <PawLoader visible />
      </SafeAreaView>
    );
  }

  // ─── Thinking ───
  if (phase === 'thinking') {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Second Opinion" showBack={false} />
        <ThinkingState imageUri={imageUri} lines={thinkingLines} />
      </SafeAreaView>
    );
  }

  // ─── Clarify — a guided, one-question-per-screen assessment ───
  if (phase === 'clarify' && clarify) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Second Opinion" onBack={askAnother} />
        <ClarifyJourney
          question={askedQuestion}
          clarify={clarify}
          petName={petName}
          onSubmit={resolveWithClarify}
          onSkip={skipClarify}
        />
        {renderFailure()}
      </SafeAreaView>
    );
  }

  // ─── Answer / thread (head + follow-ups + check-in + composer) ───
  if (phase === 'answer' && answer) {
    const canFollowup = !answer.offTopic && caseId && followupsLeft > 0;
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Second Opinion" onBack={askAnother} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            ref={answerScrollRef}
            contentContainerStyle={[
              styles.scroll,
              Platform.OS === 'android' && { paddingBottom: 140 },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={FadeInDown.duration(380)}>
              {/* Original question + answer */}
              <View style={styles.askedBubble}>
                <Typography variant="caption" color={color.slateFaint} style={{ marginBottom: 4 }}>
                  YOU ASKED
                </Typography>
                <Typography variant="body" weight="semibold" color={color.ink}>
                  {askedQuestion}
                </Typography>
              </View>
              <View style={styles.answerCard}>
                <VetAnswerCard answer={answer} petName={activePet?.name} onExportReport={() => router.push({ pathname: '/vet-report', params: caseId ? { caseId } : {} } as any)} />
              </View>

              {/* Follow-up / check-in turns, in order */}
              {turns.map((t) => (
                <View key={t.id} style={styles.turn}>
                  <View style={[styles.askedBubble, t.kind === 'checkin' && styles.checkinBubble]}>
                    <Typography variant="caption" color={color.slateFaint} style={{ marginBottom: 4 }}>
                      {t.kind === 'checkin' ? 'YOUR UPDATE' : 'YOU FOLLOWED UP'}
                    </Typography>
                    <Typography variant="body" weight="semibold" color={color.ink}>{t.ownerText}</Typography>
                  </View>
                  {t.answer && (
                    <View style={styles.answerCard}>
                      <VetAnswerCard answer={t.answer} petName={activePet?.name} onExportReport={() => router.push({ pathname: '/vet-report', params: caseId ? { caseId } : {} } as any)} />
                    </View>
                  )}
                </View>
              ))}

              {answer.offTopic ? (
                <View style={styles.didntCount}>
                  <MaterialIcons name="check-circle-outline" size={15} color={color.success} />
                  <Typography variant="caption" color={color.slateMuted} style={styles.didntCountText}>
                    This one didn&apos;t count — your monthly questions are untouched.
                  </Typography>
                </View>
              ) : (
                <Typography variant="caption" color={color.slateFaint} align="center" style={styles.disclaimer}>
                  General guidance from Pawtchi based on {petName}&apos;s profile — not a substitute for a veterinary exam.
                </Typography>
              )}

              {/* Pawtchi check-in: one-tap update */}
              {checkinMode && caseId && (
                <View style={styles.checkinCard}>
                  <View style={styles.checkinHead}>
                    <PulseMark size={22} ringColor={color.navy} strokeColor={color.navy} />
                    <Typography variant="heading" weight="bold" color={color.ink} style={{ flex: 1 }}>
                      How is {petName} doing?
                    </Typography>
                  </View>
                  <View style={styles.checkinChips}>
                    {checkinOptions.map((opt) => (
                      <TouchableOpacity key={opt} style={styles.checkinChip} activeOpacity={0.9} onPress={() => submitFollowup(opt, 'checkin')}>
                        <Typography variant="body" weight="medium" color={color.ink}>{opt}</Typography>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* Follow-up composer */}
              {!checkinMode && canFollowup && (
                <View style={styles.composer}>
                  <Typography variant="caption" color={color.slateFaint} style={{ marginBottom: space.sm, letterSpacing: 1 }}>
                    {followupsLeft} OF {FOLLOWUP_CAP} FOLLOW-UPS LEFT
                  </Typography>
                  <View style={styles.composerRow}>
                    <TextInput
                      style={styles.composerInput}
                      value={followupText}
                      onChangeText={setFollowupText}
                      onFocus={() => {
                        if (Platform.OS === 'android') {
                          setTimeout(() => answerScrollRef.current?.scrollToEnd({ animated: true }), 60);
                        }
                      }}
                      multiline
                      maxLength={500}
                      placeholder={`Add an update or ask a follow-up about ${petName}`}
                      placeholderTextColor={color.slateFaint}
                    />
                    <TouchableOpacity
                      style={[styles.composerSend, !followupText.trim() && styles.askBtnDisabled]}
                      disabled={!followupText.trim()}
                      onPress={() => submitFollowup(followupText, 'followup')}
                      activeOpacity={0.9}
                    >
                      <MaterialIcons name="arrow-upward" size={20} color={color.navy} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* No follow-ups left → point to a fresh question */}
              {!checkinMode && !answer.offTopic && caseId && followupsLeft === 0 && (
                <Typography variant="body" color={color.slateMuted} align="center" style={{ marginTop: space.xl }}>
                  That&apos;s the {FOLLOWUP_CAP} follow-ups for this case. A new question starts a fresh one.
                </Typography>
              )}

              {/* Start a new assessment (costs a monthly question) */}
              {remaining !== null && remaining > 0 ? (
                <PawtchiButton
                  title={answer.offTopic ? `Ask about ${petName}` : 'Ask a new question'}
                  variant={canFollowup ? 'outline' : 'primary'}
                  iconName="add"
                  onPress={askAnother}
                  style={{ marginTop: space.xl }}
                />
              ) : (
                <Typography variant="body" color={color.slateMuted} align="center" style={{ marginTop: space.xl }}>
                  That was {petName}&apos;s last question this month. More on {formatShortDate(usage?.resetsAt)}.
                </Typography>
              )}
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>

        {renderFailure()}
      </SafeAreaView>
    );
  }

  // ─── Idle (ask + history) ───
  return (
    <SafeAreaView style={styles.container}>
      <Header title="Second Opinion" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={idleScrollRef}
          contentContainerStyle={[
            styles.scroll,
            Platform.OS === 'android' && { paddingBottom: 140 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <Animated.View entering={FadeInDown.duration(360)} style={styles.hero}>
            <View style={styles.heroAvatarRing}>
              <Image source={{ uri: imageUri }} style={styles.heroAvatar} contentFit="cover" cachePolicy="memory-disk" transition={200} />
            </View>
            <Typography variant="caption" color={color.slateFaint} style={{ marginTop: space.md }}>
              A CONCERN ABOUT {petName.toUpperCase()}
            </Typography>
            <Typography variant="title" weight="bold" align="center" style={styles.heroTitle}>
              Notice something off?
            </Typography>
            <Typography variant="body" color={color.slateMuted} align="center" style={styles.heroSub}>
              Describe what you&apos;re seeing with {petName}. Pawtchi reads the signs against {their} health profile and tells you what to watch and when to call the vet.
            </Typography>
          </Animated.View>

          {outOfQuestions ? (
            /* Limit panel */
            <View style={styles.limitPanel}>
              <MaterialIcons name="event-available" size={26} color={color.navy} />
              <Typography variant="heading" weight="bold" align="center" style={{ marginTop: space.sm }}>
                {petName}&apos;s questions are used for now
              </Typography>
              <Typography variant="body" color={color.slateMuted} align="center" style={{ marginTop: 4 }}>
                All {usage?.cap} for this month are done. They refresh on {formatShortDate(usage?.resetsAt)}.
              </Typography>
            </View>
          ) : (
            <>
              {/* Input */}
              <View style={styles.inputCard}>
                <TextInput
                  style={styles.input}
                  value={question}
                  onChangeText={setQuestion}
                  onFocus={() => {
                    if (Platform.OS === 'android') {
                      setTimeout(() => idleScrollRef.current?.scrollTo({ y: 140, animated: true }), 60);
                    }
                  }}
                  multiline
                  maxLength={500}
                  placeholder={`e.g. ${petName} has been scratching ${their} ears more than usual`}
                  placeholderTextColor={color.slateFaint}
                />
                <TouchableOpacity
                  style={[styles.askBtn, !question.trim() && styles.askBtnDisabled]}
                  activeOpacity={0.9}
                  disabled={!question.trim()}
                  onPress={() => handleSubmit()}
                >
                  <PulseMark size={20} ringColor={color.navy} strokeColor={color.navy} />
                  <Typography variant="body" weight="bold" color={color.navy} style={styles.askBtnText}>
                    Get a second opinion
                  </Typography>
                </TouchableOpacity>
              </View>

              {/* Suggested chips */}
              <Typography variant="caption" color={color.slateFaint} style={styles.sectionLabel}>
                NOT SURE WHERE TO START
              </Typography>
              <View style={styles.chips}>
                {suggestions.map((s, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.chip}
                    activeOpacity={0.8}
                    onPress={() => setQuestion(s.text)}
                  >
                    <Typography variant="body" weight="medium" color={color.ink} style={styles.chipText}>
                      {s.label}
                    </Typography>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Allowance */}
              {usage && (
                <View style={styles.allowanceRow}>
                  <MaterialIcons name="auto-awesome" size={14} color={color.slateFaint} />
                  <Typography variant="caption" color={color.slateFaint} style={{ letterSpacing: 0.3 }}>
                    {usage.remaining} of {usage.cap} left this month · resets {formatShortDate(usage.resetsAt)}
                  </Typography>
                </View>
              )}
            </>
          )}

          {/* History */}
          {history.length > 0 && (
            <View style={styles.historySection}>
              <View style={styles.sectionHead}>
                <Typography variant="caption" color={color.slateFaint}>PREVIOUS QUESTIONS</Typography>
                <View style={styles.sectionRule} />
              </View>
              {history.map((h) => (
                <View key={h.id} style={styles.historyItem}>
                  <TouchableOpacity
                    style={styles.historyHead}
                    activeOpacity={0.7}
                    onPress={() => openCase(h.id, { source: 'history' })}
                  >
                    <View style={{ flex: 1 }}>
                      <Typography variant="body" weight="semibold" color={color.ink} numberOfLines={2}>
                        {h.question}
                      </Typography>
                      <Typography variant="caption" color={color.slateFaint} style={{ marginTop: 2 }}>
                        {formatShortDate(h.created_at)}
                      </Typography>
                    </View>
                    <MaterialIcons name="chevron-right" size={22} color={color.slateFaint} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {renderFailure()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  scroll: { paddingHorizontal: space.xxl, paddingTop: space.md, paddingBottom: 60 },
  // Docks the in-flow failure card above the safe-area bottom on any phase.
  failureDock: { paddingHorizontal: space.xxl, paddingBottom: space.md },

  // Hero
  hero: { alignItems: 'center', marginBottom: space.xl },
  heroAvatarRing: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 2.5, borderColor: color.yellow, padding: 3,
  },
  heroAvatar: { width: '100%', height: '100%', borderRadius: 34 },
  heroTitle: { marginTop: 4 },
  heroSub: { marginTop: space.sm, maxWidth: 320, lineHeight: 21 },

  // Input
  inputCard: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
    gap: space.md,
    ...shadow.card,
  },
  input: {
    minHeight: 88,
    textAlignVertical: 'top',
    fontFamily: font.medium,
    fontSize: 16,
    color: color.ink,
    lineHeight: 23,
  },
  askBtn: {
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: color.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  askBtnDisabled: { opacity: 0.45 },
  askBtnText: { fontSize: 16, letterSpacing: 0.2 },

  // Chips
  sectionLabel: { marginTop: space.xxl, marginBottom: space.sm, letterSpacing: 1.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: 9,
    ...shadow.card,
  },
  chipText: { fontSize: 13.5 },

  allowanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: space.xl,
  },

  // Limit panel
  limitPanel: {
    alignItems: 'center',
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.xxl,
  },

  // Thinking
  thinkingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xxl, paddingBottom: 80 },
  thinkingRingWrap: { width: 160, height: 160, alignItems: 'center', justifyContent: 'center' },
  thinkingCenter: { alignItems: 'center', justifyContent: 'center' },
  thinkingAvatarWrap: {
    width: 96, height: 96, borderRadius: 48, overflow: 'hidden',
    borderWidth: 3, borderColor: color.surface, ...shadow.raised,
  },
  thinkingAvatar: { width: '100%', height: '100%' },
  thinkingText: { maxWidth: 280, lineHeight: 22 },

  // Answer
  askedBubble: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.lg,
  },
  answerCard: {
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.xl,
    ...shadow.card,
  },
  disclaimer: { marginTop: space.lg, lineHeight: 16, paddingHorizontal: space.md },

  // Case loading + thread
  caseLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  turn: { marginTop: space.xl },
  checkinBubble: { borderLeftWidth: 3, borderLeftColor: color.yellow },

  // Pawtchi check-in
  checkinCard: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.xl,
    marginTop: space.xl,
  },
  checkinHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg },
  checkinChips: { gap: space.sm },
  checkinChip: {
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.hairline,
    borderRadius: radius.lg,
    paddingVertical: 15,
    paddingHorizontal: space.lg,
    ...shadow.card,
  },

  // Follow-up composer
  composer: { marginTop: space.xl },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  composerInput: {
    flex: 1,
    minHeight: 50,
    maxHeight: 120,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    paddingTop: 14,
    paddingBottom: 14,
    fontFamily: font.medium,
    fontSize: 15,
    color: color.ink,
    textAlignVertical: 'top',
  },
  composerSend: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },

  didntCount: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: space.lg,
  },
  didntCountText: { letterSpacing: 0.2 },

  // History
  historySection: { marginTop: space.xxl },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  sectionRule: { flex: 1, height: 1, backgroundColor: color.hairline },
  historyItem: {
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.lg,
    marginBottom: space.sm,
    overflow: 'hidden',
  },
  historyHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg },
});
