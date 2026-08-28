// A single letter and its reply.
//
// This is the screen the push notification opens, and the reason the whole
// feature has retention value at all: sending a letter is a one-off act, but a
// reply landing days later is a return visit.
//
// Both sides render as paper artifacts (`color.moment.*`) so the exchange reads
// as correspondence rather than as a chat thread. The founder's side is set on
// the deeper paper with a yellow rule so it's unmistakably the reply.

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Header } from '../../components/Header';
import { Typography } from '../../components/Typography';
import { ErrorState } from '../../components/ErrorState';
import { BreathingPaw } from '../../components/BreathingPaw';
import { color, radius, space } from '../../constants/design';
import { track } from '../../lib/analytics';
import { errorCopy, toAppError, type ErrorCopy } from '../../lib/appError';
import {
  getLetter, markReplyRead, type FounderLetter,
} from '../../lib/founderLetters';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function LetterThreadScreen() {
  const router = useRouter();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const [letter, setLetter] = useState<FounderLetter | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<ErrorCopy | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;

    // `from=push` is set by the notification deep link, so the return-visit
    // metric can be read straight off this event.
    track(from === 'push' ? 'letter_reply_push_opened' : 'letter_thread_opened', {});

    getLetter(id)
      .then((row) => {
        if (!alive) return;
        setLetter(row);
        setLoading(false);
        // Stamp the receipt only once there's actually a reply on screen.
        if (row?.reply) markReplyRead(id);
      })
      .catch((e) => {
        if (!alive) return;
        setFailure(errorCopy(toAppError(e), { petName: 'your animal' }));
        setLoading(false);
      });

    return () => { alive = false; };
  }, [id, from]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="" />

      {loading ? (
        <View style={styles.center}>
          <BreathingPaw size={28} />
        </View>
      ) : failure || !letter ? (
        <View style={styles.center}>
          <ErrorState
            copy={
              failure ?? {
                title: 'That letter isn’t here',
                message: 'It may have been removed. Your other letters are still on the previous screen.',
                actions: [{ label: 'Go back', action: 'go_back' }],
              }
            }
            onAction={() => router.back()}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* The owner's letter */}
          <Animated.View entering={FadeInDown.duration(500)} style={styles.paper}>
            <Typography variant="caption" weight="semibold" color={color.slateFaint} style={styles.label}>
              YOU WROTE · {formatDate(letter.createdAt).toUpperCase()}
            </Typography>
            <Typography variant="body" color={color.slate} style={styles.bodyText}>
              {letter.body}
            </Typography>
          </Animated.View>

          {letter.reply ? (
            <Animated.View
              entering={FadeInDown.duration(500).delay(120)}
              style={[styles.paper, styles.replyPaper]}
            >
              <View style={styles.replyRule} />
              <Typography variant="caption" weight="extrabold" style={styles.replyLabel}>
                WE REPLIED · {formatDate(letter.reply.createdAt).toUpperCase()}
              </Typography>
              <Typography variant="body" color={color.navy} style={styles.bodyText}>
                {letter.reply.body}
              </Typography>
            </Animated.View>
          ) : (
            /* No reply yet. This must not read as a delivery failure, and must
               not promise one is coming — see FOUNDER_PROMISE on the letter. */
            <View style={styles.pending}>
              <MaterialIcons name="schedule-send" size={20} color={color.letter.accent} />
              <Typography variant="body" color={color.slateMuted} style={styles.pendingText}>
                We have this. If a reply comes, it&apos;ll show up right here.
              </Typography>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.letter.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  scroll: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xxxl, gap: space.lg },

  // The owner's half: quiet, outlined, no fill — it is the thing already said.
  paper: {
    backgroundColor: color.letter.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.letter.hairline,
    padding: space.xl,
    gap: space.sm,
  },
  // The reply is the reason this screen exists, so it carries the blue: tinted
  // ground, blue rule, blue label. The eye lands on it first.
  replyPaper: {
    backgroundColor: color.letter.accentSoft,
    borderColor: 'transparent',
  },
  replyRule: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: color.letter.accent,
    marginBottom: space.xs,
  },
  label: { letterSpacing: 1.2 },
  replyLabel: { letterSpacing: 1.2, color: color.letter.accentInk },
  bodyText: { lineHeight: 23 },

  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  pendingText: { flex: 1, lineHeight: 20 },
});
