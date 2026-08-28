// Write a support request.
//
// ONE screen for both topics. "Report a problem" and "Ask a question" differ by
// a headline, a placeholder, and how prominent the screenshot row is — nothing
// else. Two screens would have been two things to keep in sync forever, for a
// seam the owner cannot perceive.
//
// Operational surface (white ground, `color.letter.*`), structured after
// app/letter/compose.tsx: hero copy block, bordered `inputCard`, CTA disabled
// until there is something to send.
//
// ── The one idea this screen is built around ────────────────────────────────
//
// The owner should only have to describe what happened. Everything else — the
// build, the phone, the screen they were on, the failure they just saw, the
// last twenty-five things the app did — is collected without asking, and the
// area chip usually arrives already selected because the failure they tapped
// through from says which part of Pawtchi it belongs to.
//
// So the form is: one chip (usually pre-answered), one box, one optional photo.
// Anything added here has to earn its place against that.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Header } from '../../components/Header';
import { Typography } from '../../components/Typography';
import { SelectableChip } from '../../components/SelectableChip';
import { PawtchiSuccessModal } from '../../components/PawtchiModal';
import { FailureModal } from '../../components/FailureModal';
import { DiagnosticsDisclosure } from '../../components/support/DiagnosticsDisclosure';
import { color, displayLine, font, radius, shadow, space } from '../../constants/design';
import { track } from '../../lib/analytics';
import { haptic } from '../../lib/haptics';
import { useAuth } from '../../providers/AuthProvider';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useSubscription } from '../../hooks/useSubscription';
import { useWalkEnabled } from '../../hooks/useWalkEnabled';
import { prepareImageForUpload } from '../../lib/imagePrep';
import {
  errorCopy, toAppError, reportError, type AppErrorKind, type ErrorContext, type ErrorCopy,
} from '../../lib/appError';
import {
  COMPOSER_COPY, CONFIRMATION_COPY, SUPPORT_MAX_CHARS, TOPIC_COPY,
  areaFromContext, ticketReference, visibleAreas,
  type SupportArea, type SupportEntrySource, type SupportTopic,
} from '../../lib/support/copy';
import { buildDiagnostics, describeDiagnostics } from '../../lib/support/diagnostics';
import { collectDeviceContext } from '../../lib/support/deviceContext';
import { attachScreenshot, remainingToday, submitTicket } from '../../lib/support/supportTickets';

export default function NewSupportRequestScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    topic?: string;
    area?: string;
    source?: string;
    screen?: string;
    errorKind?: string;
    errorContext?: string;
    walkId?: string;
    scanId?: string;
  }>();

  const { user } = useAuth();
  const activePet = useActivePetStore((s) => s.activePet);
  const { status: subStatus, isPro } = useSubscription();
  const walkEnabled = useWalkEnabled();

  const topic: SupportTopic = params.topic === 'question' ? 'question' : 'bug';
  const entrySource = (params.source as SupportEntrySource) || 'profile';
  const errorContext = (params.errorContext as ErrorContext) || null;
  const topicCopy = TOPIC_COPY[topic];

  const areas = useMemo(() => visibleAreas(walkEnabled), [walkEnabled]);

  // The pre-selection that makes this form a one-tap affair for the reports we
  // most want: an explicit `area` param wins, otherwise the failure's context
  // is mapped, otherwise the owner picks. `prefilled` is instrumented because
  // if this guess is usually wrong, the fix is a better map — not a longer form.
  const presetArea = useMemo<SupportArea | null>(() => {
    const explicit = areas.find((a) => a.id === params.area)?.id;
    if (explicit) return explicit;
    const guessed = areaFromContext(errorContext);
    // Never preselect a chip that is not on screen (walks, for a cat).
    return guessed && areas.some((a) => a.id === guessed) ? guessed : null;
  }, [params.area, errorContext, areas]);

  const [area, setArea] = useState<SupportArea | null>(presetArea);
  const [body, setBody] = useState('');
  const [shot, setShot] = useState<{ uri: string; mimeType: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [failure, setFailure] = useState<ErrorCopy | null>(null);

  // Fired once, on the first keystroke — not on mount. Opening the screen is
  // not the same intent as starting to write, and conflating them would inflate
  // the funnel's most important step. (Same reasoning as letter/compose.tsx.)
  const startedRef = useRef(false);

  const trimmed = body.trim();
  const canSend = trimmed.length > 0 && !sending;
  const petName = activePet?.name?.trim() || 'your animal';

  // Read the remaining allowance up front so someone who has run out finds out
  // before writing a detailed report, not after.
  useEffect(() => {
    let alive = true;
    remainingToday()
      .then((n) => { if (alive) setRemaining(n); })
      .catch(() => { /* display-only; the RPC is the real gate */ });
    return () => { alive = false; };
  }, []);

  // Assembled once per render of the disclosure rather than at submit time, so
  // what the owner is shown is built by the same function that builds what is
  // actually sent. See lib/support/diagnostics.ts.
  const diagnostics = useMemo(
    () =>
      buildDiagnostics({
        device: collectDeviceContext(),
        topic,
        area: area ?? 'other',
        entrySource,
        screen: params.screen ?? null,
        errorKind: (params.errorKind as AppErrorKind) ?? null,
        errorContext,
        petId: activePet?.id ?? null,
        species: activePet?.species ?? null,
        subscriptionStatus: subStatus,
        isPro,
        walkId: params.walkId ?? null,
        scanId: params.scanId ?? null,
      }),
    [
      topic, area, entrySource, params.screen, params.errorKind, params.walkId,
      params.scanId, errorContext, activePet?.id, activePet?.species, subStatus, isPro,
    ],
  );

  const handleChange = (next: string) => {
    if (!startedRef.current && next.trim().length > 0) {
      startedRef.current = true;
      track('support_compose_started', {
        topic,
        area: area ?? 'none',
        prefilled: presetArea != null,
        entry_source: entrySource,
      });
    }
    setBody(next);
  };

  const pickScreenshot = async () => {
    haptic.tap();
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    // Downscale before it ever crosses the network — a screenshot is 3–5 MB
    // straight off the camera roll and carries no extra diagnostic value at
    // full resolution.
    const prepared = await prepareImageForUpload(result.assets[0]);
    setShot({ uri: prepared.uri, mimeType: prepared.mimeType });
  };

  const handleSend = async () => {
    if (!canSend) return;
    Keyboard.dismiss();
    setSending(true);
    setFailure(null);
    try {
      const id = await submitTicket({
        body: trimmed,
        topic,
        area: area ?? 'other',
        entrySource,
        petId: activePet?.id ?? null,
        diagnostics,
      });

      // The request is already safely filed at this point. The screenshot is a
      // bonus and `attachScreenshot` resolves false rather than throwing, so a
      // failed upload can never turn a delivered report into an error.
      if (shot && user?.id) {
        await attachScreenshot({
          ticketId: id,
          ownerId: user.id,
          uri: shot.uri,
          mimeType: shot.mimeType,
        });
      }

      track('support_ticket_submitted', {
        topic,
        area: area ?? 'other',
        entry_source: entrySource,
        has_attachment: shot != null,
        body_length: trimmed.length,
        prefilled: presetArea != null,
        error_kind: params.errorKind ?? null,
      });
      haptic.success();
      setSentId(id);
    } catch (e) {
      const appErr = toAppError(e);
      reportError(appErr, 'generic');
      if (appErr.kind === 'rate_limited') {
        track('support_ticket_capped', { topic });
        setRemaining(0);
        setSending(false);
        return;
      }
      track('support_ticket_failed', { topic, kind: appErr.kind });
      setFailure(errorCopy(appErr, { petName }));
    } finally {
      setSending(false);
    }
  };

  const outOfRequests = remaining === 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(500)} style={styles.hero}>
            <Typography style={styles.heroTitle}>{topicCopy.headline}</Typography>
            <Typography variant="body" color={color.slateMuted} style={styles.heroSub}>
              {topicCopy.subtitle}
            </Typography>
          </Animated.View>

          {outOfRequests ? (
            /* Calm, not an error. Hitting the cap means someone tried hard to
               be helped, and that deserves better than a red banner. */
            <View style={styles.capPanel}>
              <MaterialIcons name="mark-email-read" size={26} color={color.letter.accent} />
              <Typography variant="heading" weight="bold" align="center" style={{ marginTop: space.sm }}>
                {COMPOSER_COPY.capTitle}
              </Typography>
              <Typography variant="body" color={color.slateMuted} align="center" style={{ marginTop: 4 }}>
                {COMPOSER_COPY.capBody}
              </Typography>
            </View>
          ) : (
            <>
              {/* ── The one structured field, usually already answered ── */}
              <Typography variant="label" color={color.navy} style={styles.fieldLabel}>
                {COMPOSER_COPY.areaLabel}
              </Typography>
              <View style={styles.chipRow}>
                {areas.map((opt) => {
                  const selected = area === opt.id;
                  return (
                    <SelectableChip
                      key={opt.id}
                      selected={selected}
                      style={styles.chip}
                      selectedStyle={styles.chipSelected}
                      onPress={() => setArea(opt.id)}
                    >
                      <Typography
                        variant="caption"
                        weight={selected ? 'extrabold' : 'semibold'}
                        color={selected ? color.navy : color.slateMuted}
                        style={styles.chipText}
                      >
                        {opt.label}
                      </Typography>
                    </SelectableChip>
                  );
                })}
              </View>

              <View style={styles.inputCard}>
                <TextInput
                  style={styles.input}
                  value={body}
                  onChangeText={handleChange}
                  multiline
                  maxLength={SUPPORT_MAX_CHARS}
                  placeholder={topicCopy.placeholder}
                  placeholderTextColor={color.slateFaint}
                  editable={!sending}
                />
                <Typography
                  variant="caption"
                  color={color.slateFaint}
                  align="right"
                  style={styles.counter}
                >
                  {body.length}/{SUPPORT_MAX_CHARS}
                </Typography>
              </View>

              {/* ── Optional screenshot ── */}
              {shot ? (
                <View style={styles.shotRow}>
                  <Image source={{ uri: shot.uri }} style={styles.shotThumb} contentFit="cover" />
                  <View style={styles.shotText}>
                    <Typography variant="body" weight="medium" color={color.navy}>
                      Screenshot added
                    </Typography>
                    <TouchableOpacity onPress={pickScreenshot} hitSlop={8}>
                      <Typography variant="caption" color={color.letter.accentInk} style={styles.shotAction}>
                        {COMPOSER_COPY.attachReplace}
                      </Typography>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={() => { haptic.tap(); setShot(null); }}
                    hitSlop={10}
                    accessibilityLabel={COMPOSER_COPY.attachRemove}
                  >
                    <MaterialIcons name="close" size={20} color={color.slateFaint} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.attachRow, topicCopy.attachmentProminent && styles.attachRowProminent]}
                  activeOpacity={0.75}
                  onPress={pickScreenshot}
                >
                  <MaterialIcons name="add-photo-alternate" size={20} color={color.letter.accent} />
                  <View style={styles.shotText}>
                    <Typography variant="body" weight="medium" color={color.navy}>
                      {COMPOSER_COPY.attachLabel}
                    </Typography>
                    <Typography variant="caption" color={color.slateFaint} style={styles.shotAction}>
                      {COMPOSER_COPY.attachHint}
                    </Typography>
                  </View>
                </TouchableOpacity>
              )}

              <DiagnosticsDisclosure
                lines={describeDiagnostics(diagnostics)}
                onExpand={() => track('support_diagnostics_expanded', { topic })}
              />
            </>
          )}
        </ScrollView>

        {!outOfRequests && (
          <View style={styles.ctaBar}>
            <TouchableOpacity
              style={[styles.cta, !canSend && styles.ctaDisabled]}
              disabled={!canSend}
              activeOpacity={0.85}
              onPress={handleSend}
            >
              <Typography
                variant="body"
                weight="extrabold"
                color={canSend ? color.navy : color.slateFaint}
              >
                {sending ? COMPOSER_COPY.sending : COMPOSER_COPY.send}
              </Typography>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* A receipt, not a filing. The reference is small and secondary — enough
          to point at in a follow-up, not enough to imply a queue behind it. */}
      <PawtchiSuccessModal
        visible={sentId != null}
        onClose={() => router.back()}
        title={CONFIRMATION_COPY.title}
        icon={{ name: 'mark-email-read', color: color.letter.accent }}
        lines={[
          { text: CONFIRMATION_COPY.bodyLine, type: 'normal' },
          { text: CONFIRMATION_COPY.replyLine, type: 'normal' },
          {
            text: `${CONFIRMATION_COPY.referenceLabel} ${ticketReference(sentId ?? '')}`,
            type: 'sub',
          },
        ]}
        primaryAction={{ label: CONFIRMATION_COPY.done, onPress: () => router.back() }}
      />

      {/* The one screen where "Contact support" is dropped rather than wired:
          the owner is already in the composer, and routing them to it again
          would stack this screen on itself. Everything else — the retry above
          all — renders as the copy wrote it. */}
      <FailureModal
        copy={failure && {
          ...failure,
          actions: failure.actions.filter((a) => a.action !== 'contact_support'),
        }}
        onClose={() => setFailure(null)}
        onAction={(action) => { if (action === 'retry') void handleSend(); }}
        icon={{ name: 'error-outline', color: color.error }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.letter.paper },
  flex: { flex: 1 },
  scroll: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xxxl,
    gap: space.lg,
  },

  hero: { marginBottom: space.xs },
  heroTitle: { ...displayLine(34), letterSpacing: 0.5, color: color.navy },
  heroSub: { marginTop: space.sm, lineHeight: 21 },

  fieldLabel: { marginBottom: -space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.letter.hairline,
    backgroundColor: color.letter.paper,
  },
  // Selected reads as a tinted, blue-edged pill. Not yellow: yellow is reserved
  // for the single action that matters on this surface, which is Send.
  chipSelected: {
    borderColor: color.letter.accent,
    backgroundColor: color.letter.accentSoft,
  },
  chipText: { letterSpacing: 0 },

  inputCard: {
    backgroundColor: color.letter.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.letter.hairline,
    overflow: 'hidden',
    ...shadow.card,
  },
  input: {
    minHeight: 150,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    textAlignVertical: 'top',
    fontFamily: font.medium,
    fontSize: 16,
    color: color.ink,
    lineHeight: 23,
  },
  counter: { paddingHorizontal: space.lg, paddingBottom: space.md, paddingTop: space.sm },

  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.letter.hairline,
  },
  // A screenshot is worth far more on "it looks wrong" than on "how does this
  // work", so the row is only tinted for bug reports.
  attachRowProminent: { backgroundColor: color.letter.accentSoft, borderStyle: 'solid' },
  shotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.letter.hairline,
  },
  shotThumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: color.track },
  shotText: { flex: 1, gap: 1 },
  shotAction: { letterSpacing: 0 },

  capPanel: {
    alignItems: 'center',
    backgroundColor: color.letter.accentSoft,
    borderRadius: radius.lg,
    padding: space.xxl,
  },

  ctaBar: { paddingHorizontal: space.xl, paddingVertical: space.md },
  cta: {
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: color.letter.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { backgroundColor: color.track },
});
