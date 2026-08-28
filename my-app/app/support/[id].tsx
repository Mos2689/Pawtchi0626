// A single support request and its reply.
//
// This is the screen the push notification opens, and the reason support has
// retention value at all: writing in is a one-off act, but an answer landing
// two days later is a return visit — the same argument app/letter/[id].tsx
// makes for the founder letter.
//
// Both sides render as paper artifacts so the exchange reads as correspondence
// rather than as a chat thread. The reply carries the blue: tinted ground, blue
// rule, blue label, so the eye lands on the answer first.
//
// `replies` is rendered as a list even though v1 only ever writes one. The
// schema has no one-per-ticket index, so Phase 2 multi-turn threads are a
// rendering change here and nothing more.

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
import { THREAD_COPY, ticketReference } from '../../lib/support/copy';
import { getTicket, markReplyRead, type SupportTicket } from '../../lib/support/supportTickets';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SupportThreadScreen() {
  const router = useRouter();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<ErrorCopy | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;

    // `from=push` is set by the notification deep link, so the return-visit
    // metric can be read straight off this event.
    track(from === 'push' ? 'support_reply_push_opened' : 'support_thread_opened', {});

    getTicket(id)
      .then((row) => {
        if (!alive) return;
        setTicket(row);
        setLoading(false);
        // Stamp the receipt only once there is actually a reply on screen.
        if (row && row.replies.length > 0) markReplyRead(id);
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
      ) : failure || !ticket ? (
        <View style={styles.center}>
          <ErrorState
            copy={
              failure ?? {
                title: THREAD_COPY.missingTitle,
                message: THREAD_COPY.missingBody,
                actions: [{ label: 'Go back', action: 'go_back' }],
              }
            }
            onAction={() => router.back()}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* What the owner wrote */}
          <Animated.View entering={FadeInDown.duration(500)} style={styles.paper}>
            <Typography variant="caption" weight="semibold" color={color.slateFaint} style={styles.label}>
              {THREAD_COPY.youLabel} · {formatDate(ticket.createdAt).toUpperCase()}
            </Typography>
            <Typography variant="body" color={color.slate} style={styles.bodyText}>
              {ticket.body}
            </Typography>
            <Typography variant="caption" color={color.slateFaint} style={styles.reference}>
              {ticketReference(ticket.id)}
            </Typography>
          </Animated.View>

          {ticket.replies.length > 0 ? (
            ticket.replies.map((reply, i) => (
              <Animated.View
                key={reply.id}
                entering={FadeInDown.duration(500).delay(120 + i * 80)}
                style={[styles.paper, styles.replyPaper]}
              >
                <View style={styles.replyRule} />
                <Typography variant="caption" weight="extrabold" style={styles.replyLabel}>
                  {THREAD_COPY.replyLabel} · {formatDate(reply.createdAt).toUpperCase()}
                </Typography>
                <Typography variant="body" color={color.navy} style={styles.bodyText}>
                  {reply.body}
                </Typography>
              </Animated.View>
            ))
          ) : (
            /* No reply yet. Must not read as a delivery failure, and must not
               restate the response window — a promise repeated back with a
               clock attached becomes a deadline the owner starts watching. */
            <View style={styles.pending}>
              <MaterialIcons name="schedule-send" size={20} color={color.letter.accent} />
              <Typography variant="body" color={color.slateMuted} style={styles.pendingText}>
                {THREAD_COPY.pending}
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
  // The reply is the reason this screen exists, so it carries the blue.
  replyPaper: { backgroundColor: color.letter.accentSoft, borderColor: 'transparent' },
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
  reference: { letterSpacing: 1.2 },

  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  pendingText: { flex: 1, lineHeight: 20 },
});
