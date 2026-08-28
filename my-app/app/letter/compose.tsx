// Compose a letter to the founder.
//
// Operational surface (light ground), structured after `app/ask.tsx`: hero copy
// block, bordered `inputCard`, CTA disabled until there's something to send.
//
// Deliberately missing: categories, tags, a rating, a subject line, an
// attachment picker. Every one of those turns this back into a support form,
// which is the thing the feature exists not to be.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Header } from '../../components/Header';
import { Typography } from '../../components/Typography';
import { PawtchiSuccessModal } from '../../components/PawtchiModal';
import { FailureModal } from '../../components/FailureModal';
import { PostageStamp } from '../../components/letter/LetterMotifs';
import { color, displayLine, font, radius, shadow, space } from '../../constants/design';
import { track } from '../../lib/analytics';
import { haptic } from '../../lib/haptics';
import { useActivePetStore } from '../../store/useActivePetStore';
import { errorCopy, toAppError, reportError, type AppErrorKind, type ErrorCopy } from '../../lib/appError';
import {
  submitLetter, remainingToday, LETTER_MAX_CHARS, LETTERS_PER_DAY,
  WRITE_TO_FOUNDER_LABEL, type LetterEntrySource,
} from '../../lib/founderLetters';

export default function ComposeLetterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string }>();
  const activePet = useActivePetStore((s) => s.activePet);

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [failure, setFailure] = useState<ErrorCopy | null>(null);
  // Rides into the support composer's diagnostics if the owner taps through.
  const [failureKind, setFailureKind] = useState<AppErrorKind | null>(null);

  // Fired once, on the first keystroke — not on mount. Opening the screen is
  // not the same intent as starting to write, and conflating them would inflate
  // the funnel's most important step.
  const startedRef = useRef(false);

  const source = (params.source as LetterEntrySource) || 'profile';
  const petName = activePet?.name?.trim() || 'your animal';
  const trimmed = body.trim();
  const canSend = trimmed.length > 0 && !sending;

  // Read the remaining allowance up front so someone who has run out finds out
  // before writing 2000 characters, not after.
  useEffect(() => {
    let alive = true;
    remainingToday()
      .then((n) => { if (alive) setRemaining(n); })
      .catch(() => { /* display-only; the RPC is the real gate */ });
    return () => { alive = false; };
  }, []);

  const handleChange = (next: string) => {
    if (!startedRef.current && next.trim().length > 0) {
      startedRef.current = true;
      track('letter_compose_started', { entry_source: source });
    }
    setBody(next);
  };

  const handleSend = async () => {
    if (!canSend) return;
    Keyboard.dismiss();
    setSending(true);
    setFailure(null);
    try {
      await submitLetter({
        body: trimmed,
        entrySource: source,
        petId: activePet?.id ?? null,
      });
      track('letter_sent', { entry_source: source, length: trimmed.length });
      haptic.success();
      setSent(true);
    } catch (e) {
      const appErr = toAppError(e);
      reportError(appErr, 'generic');
      track('letter_send_failed', { entry_source: source, kind: appErr.kind });
      setFailureKind(appErr.kind);
      setFailure(errorCopy(appErr, { petName }));
    } finally {
      setSending(false);
    }
  };

  const outOfLetters = remaining === 0;

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
            <PostageStamp size={76} style={styles.heroStamp} />
            <Typography style={styles.heroTitle}>
              {WRITE_TO_FOUNDER_LABEL.toUpperCase()}
            </Typography>
            <Typography variant="body" color={color.slateMuted} align="center" style={styles.heroSub}>
              No thought is too small. Tell us what&apos;s working for {petName}, what
              isn&apos;t, or what you wish Pawtchi did.
            </Typography>
          </Animated.View>

          {outOfLetters ? (
            /* Calm, not an error. Hitting the cap means someone cared enough to
               write three times today — that deserves better than a red banner. */
            <View style={styles.capPanel}>
              <MaterialIcons name="mark-email-read" size={26} color={color.letter.accent} />
              <Typography variant="heading" weight="bold" align="center" style={{ marginTop: space.sm }}>
                That&apos;s {LETTERS_PER_DAY} letters today
              </Typography>
              <Typography variant="body" color={color.slateMuted} align="center" style={{ marginTop: 4 }}>
                We&apos;d rather read those properly than skim more. Write again tomorrow —
                we&apos;ll still be here.
              </Typography>
            </View>
          ) : (
            <>
              <View style={styles.inputCard}>
                <TextInput
                  style={styles.input}
                  value={body}
                  onChangeText={handleChange}
                  multiline
                  maxLength={LETTER_MAX_CHARS}
                  placeholder="Share your honest thoughts…"
                  placeholderTextColor={color.slateFaint}
                  editable={!sending}
                />
                <Typography
                  variant="caption"
                  color={color.slateFaint}
                  align="right"
                  style={styles.counter}
                >
                  {body.length}/{LETTER_MAX_CHARS}
                </Typography>
              </View>

              <Typography variant="caption" color={color.slateFaint} align="center" style={styles.privacy}>
                Sent straight to us. Nothing about {petName} is attached.
              </Typography>
            </>
          )}
        </ScrollView>

        {!outOfLetters && (
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
                {sending ? 'Sending…' : 'Send letter'}
              </Typography>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Reuses the success sheet with no `strip` — icon, title, lines, one CTA. */}
      <PawtchiSuccessModal
        visible={sent}
        onClose={() => router.back()}
        title="It's on its way"
        icon={{ name: 'mark-email-read', color: color.letter.accent }}
        lines={[
          {
            text: 'We read every letter that comes through here. If there\'s a reply, it\'ll land right in the app.',
            type: 'normal',
          },
        ]}
        primaryAction={{ label: 'Done', onPress: () => router.back() }}
      />

      {/* The letter's own actions, not a lone "OK": a send that failed should
          offer the retry the copy already wrote, and the support door on the
          failures that have nothing else to offer. */}
      <FailureModal
        copy={failure}
        onClose={() => setFailure(null)}
        onAction={(action) => { if (action === 'retry') void handleSend(); }}
        icon={{ name: 'error-outline', color: color.error }}
        meta={{ kind: failureKind, context: 'generic', screen: '/letter/compose' }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.letter.paper },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xxxl },

  hero: { alignItems: 'center', marginBottom: space.xl },
  heroStamp: { marginBottom: space.lg, transform: [{ rotate: '-4deg' }] },
  heroTitle: {
    ...displayLine(34),
    letterSpacing: 0.5,
    color: color.navy,
    textAlign: 'center',
  },
  heroSub: { marginTop: space.sm, maxWidth: 320, lineHeight: 21 },

  inputCard: {
    backgroundColor: color.letter.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.letter.hairline,
    overflow: 'hidden',
    ...shadow.card,
  },
  input: {
    minHeight: 180,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    textAlignVertical: 'top',
    fontFamily: font.medium,
    fontSize: 16,
    color: color.ink,
    lineHeight: 23,
  },
  counter: { paddingHorizontal: space.lg, paddingBottom: space.md, paddingTop: space.sm },
  privacy: { marginTop: space.md, lineHeight: 18 },

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
