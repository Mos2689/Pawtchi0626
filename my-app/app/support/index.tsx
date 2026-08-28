// Help & Support — the hub.
//
// White ground with the two-colour system this app already uses for
// correspondence (`color.letter.*`): blue for structure, yellow reserved for
// the one thing that matters. Not the navy brand ground — support is
// operational, and the letter flow already proved this palette on white.
//
// ── Two decisions worth defending ───────────────────────────────────────────
//
// 1. There is no yellow on this screen. The three doors are equals, and making
//    one yellow would be a recommendation we do not mean. Yellow appears once
//    the owner has committed to writing — as the Send block on the composer.
//    (constants/design.ts §4.02: yellow marks the ONE thing that matters.)
//
// 2. The third door hands off to the founder letter rather than being a
//    feature-request form. A form would collect ideas into a table nobody
//    reads; the letter puts them in front of the two people who decide what
//    gets built. Support answers "something is wrong"; the letter answers
//    "here is what I think". Keeping them distinct is what lets support be
//    efficient without being cold.
//
// No PostageStamp here, deliberately: the postal motifs belong to the letter,
// and reusing them would blur exactly the line this screen is drawing.

import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { Typography } from '../../components/Typography';
import { SupportDoor } from '../../components/support/SupportDoor';
import { FaqAccordion } from '../../components/support/FaqAccordion';
import { color, displayLine, radius, space } from '../../constants/design';
import { track } from '../../lib/analytics';
import { haptic } from '../../lib/haptics';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useWalkEnabled } from '../../hooks/useWalkEnabled';
import { openManageSubscription } from '../../lib/manageSubscription';
import { visibleFaqs, type FaqActionId } from '../../lib/support/faqs';
import {
  DOOR_COPY, HUB_COPY, type SupportEntrySource,
} from '../../lib/support/copy';
import {
  listTickets, hasUnreadReply, type SupportTicket,
} from '../../lib/support/supportTickets';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function SupportHomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string }>();
  const activePet = useActivePetStore((s) => s.activePet);
  const walkEnabled = useWalkEnabled();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);

  const source = (params.source as SupportEntrySource) || 'profile';
  const faqs = visibleFaqs({ species: activePet?.species ?? null, walkEnabled });

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      track('support_home_viewed', { entry_source: source });
      listTickets()
        .then((rows) => { if (alive) setTickets(rows); })
        .catch(() => { /* the hub still works with no history */ });
      return () => { alive = false; };
    }, [source]),
  );

  const openComposer = (topic: 'bug' | 'question') => {
    track('support_door_tapped', { topic, entry_source: source });
    router.push({ pathname: '/support/new', params: { topic, source } } as never);
  };

  const openLetter = () => {
    track('support_door_tapped', { topic: 'idea', entry_source: source });
    haptic.tap();
    router.push({ pathname: '/letter', params: { source: 'support' } } as never);
  };

  const handleFaqAction = (action: FaqActionId, faqId: string) => {
    haptic.tap();
    switch (action) {
      case 'manage_subscription':
        openManageSubscription();
        break;
      case 'restore_purchases':
        // The paywall owns the RevenueCat restore path; sending someone to a
        // second implementation of it would be two things to keep correct.
        router.push('/paywall' as never);
        break;
      case 'open_notifications':
        router.push('/notifications' as never);
        break;
      case 'open_profile':
        router.push('/(tabs)/profile' as never);
        break;
      default:
        break;
    }
    track('support_faq_expanded', { faq_id: faqId, acted: true });
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']}>
        <View style={styles.nav}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.navBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Back"
          >
            <MaterialIcons name="arrow-back" size={24} color={color.navy} />
          </TouchableOpacity>
          <Typography variant="caption" weight="extrabold" color={color.navy} style={styles.wordmark}>
            PAWTCHI
          </Typography>
          <View style={styles.navBtn} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Masthead ────────────────────────────────────────────────────── */}
        <Animated.View entering={FadeIn.duration(450)} style={styles.masthead}>
          <View style={styles.eyebrowRow}>
            <View style={styles.eyebrowDash} />
            <Typography
              variant="caption"
              weight="extrabold"
              color={color.letter.accentInk}
              style={styles.eyebrow}
            >
              {HUB_COPY.eyebrow}
            </Typography>
          </View>

          <Animated.View entering={FadeInDown.duration(500).delay(80)}>
            <Typography style={styles.headline}>{HUB_COPY.headlineTop}</Typography>
            {/* The highlighter: a yellow block struck through the lower two
                thirds of the line, the way a marker actually lands. Yellow as a
                filled block behind navy text is the one use allowed on white. */}
            <View style={styles.highlightWrap}>
              <View style={styles.highlightBar} />
              <Typography style={styles.headline}>{HUB_COPY.headlineHighlighted}</Typography>
            </View>
          </Animated.View>

          <Typography variant="body" color={color.slate} style={styles.intro}>
            {HUB_COPY.intro}
          </Typography>
        </Animated.View>

        {/* ── The three doors ─────────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.duration(550).delay(140)} style={styles.doors}>
          <SupportDoor
            icon="bug-report"
            title={DOOR_COPY.bug.title}
            subtitle={DOOR_COPY.bug.subtitle}
            onPress={() => openComposer('bug')}
          />
          <SupportDoor
            icon="help-outline"
            title={DOOR_COPY.question.title}
            subtitle={DOOR_COPY.question.subtitle}
            onPress={() => openComposer('question')}
          />
          <SupportDoor
            icon="lightbulb-outline"
            title={DOOR_COPY.idea.title}
            subtitle={DOOR_COPY.idea.subtitle}
            onPress={openLetter}
          />
        </Animated.View>

        {/* ── FAQ ─────────────────────────────────────────────────────────── */}
        {faqs.length > 0 && (
          <Animated.View entering={FadeInDown.duration(550).delay(200)} style={styles.section}>
            <View style={styles.eyebrowRow}>
              <View style={styles.eyebrowDash} />
              <Typography
                variant="caption"
                weight="extrabold"
                color={color.letter.accentInk}
                style={styles.eyebrow}
              >
                {HUB_COPY.faqEyebrow}
              </Typography>
            </View>
            <FaqAccordion
              entries={faqs}
              onExpand={(id) => track('support_faq_expanded', { faq_id: id, acted: false })}
              onAction={handleFaqAction}
            />
          </Animated.View>
        )}

        {/* ── Past requests ───────────────────────────────────────────────── */}
        {tickets.length > 0 && (
          <Animated.View entering={FadeInDown.duration(550).delay(260)} style={styles.section}>
            <View style={styles.eyebrowRow}>
              <View style={styles.eyebrowDash} />
              <Typography
                variant="caption"
                weight="extrabold"
                color={color.letter.accentInk}
                style={styles.eyebrow}
              >
                {HUB_COPY.requestsEyebrow}
              </Typography>
            </View>

            {tickets.map((t) => {
              const answered = t.replies.length > 0;
              const unread = hasUnreadReply(t);
              return (
                <TouchableOpacity
                  key={t.id}
                  style={styles.historyRow}
                  activeOpacity={0.75}
                  onPress={() => router.push(`/support/${t.id}` as never)}
                >
                  {/* Answered requests get a solid blue seal, waiting ones a
                      hollow one, so the state reads before the text does. */}
                  <View style={[styles.seal, answered && styles.sealAnswered]}>
                    <MaterialIcons
                      name={answered ? 'mark-email-read' : 'schedule-send'}
                      size={16}
                      color={answered ? color.letter.paper : color.letter.accent}
                    />
                  </View>

                  <View style={styles.historyText}>
                    <Typography variant="body" weight="medium" color={color.navy} numberOfLines={1}>
                      {t.body}
                    </Typography>
                    <Typography variant="caption" color={color.slateMuted} style={styles.historyMeta}>
                      {answered
                        ? `Replied · ${formatDate(t.replies[t.replies.length - 1].createdAt)}`
                        : `Sent ${formatDate(t.createdAt)}`}
                    </Typography>
                  </View>

                  {unread && <View style={styles.unreadDot} />}
                  <MaterialIcons name="chevron-right" size={20} color={color.letter.accent} />
                </TouchableOpacity>
              );
            })}

            <Typography variant="caption" color={color.slateFaint} style={styles.footer}>
              {HUB_COPY.requestsFooter}
            </Typography>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.letter.paper },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    height: 48,
  },
  navBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  wordmark: { letterSpacing: 3 },
  scroll: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxxl },

  masthead: { marginBottom: space.xl },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  eyebrowDash: { width: 18, height: 2, backgroundColor: color.letter.accent },
  eyebrow: { letterSpacing: 1.4, flexShrink: 1 },

  headline: { ...displayLine(42), letterSpacing: 0.5, color: color.navy },
  highlightWrap: { alignSelf: 'flex-start', position: 'relative' },
  highlightBar: {
    position: 'absolute',
    left: -6,
    right: -6,
    bottom: 8,
    height: '54%',
    backgroundColor: color.letter.yellow,
  },
  intro: { marginTop: space.lg, lineHeight: 23 },

  doors: { gap: space.sm },
  section: { marginTop: space.xxxl },

  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.letter.hairline,
  },
  seal: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.letter.accentSoft,
  },
  sealAnswered: { backgroundColor: color.letter.accent },
  historyText: { flex: 1, gap: 1 },
  historyMeta: { letterSpacing: 0 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.letter.accent },
  footer: { letterSpacing: 0, marginTop: space.md, lineHeight: 16 },
});
