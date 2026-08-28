// "Write to Founder" — the letter.
//
// White ground with a two-colour system scoped to this flow (`color.letter.*`):
// electric yellow for the things you act on, blue for structure. The postal
// motifs in components/letter/LetterMotifs.tsx carry the personality — airmail
// edging, a franked stamp, a tear line, a hand-drawn signature rule — so the
// screen announces itself as correspondence rather than another settings page.
//
// Contrast rule: yellow never appears as ink on white. It is a filled block
// behind navy text (the CTA, the highlighter) and nothing else.

import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { Typography } from '../../components/Typography';
import {
  PostageStamp, PerforatedDivider, SignatureRule,
} from '../../components/letter/LetterMotifs';
import { color, displayLine, radius, space } from '../../constants/design';
import { track } from '../../lib/analytics';
import { haptic } from '../../lib/haptics';
import {
  listLetters, FOUNDER_ROLE, WRITE_TO_FOUNDER_LABEL,
  type FounderLetter, type LetterEntrySource,
} from '../../lib/founderLetters';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function LetterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string }>();
  const [letters, setLetters] = useState<FounderLetter[]>([]);

  const source = (params.source as LetterEntrySource) || 'profile';

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      track('letter_entry_tapped', { entry_source: source });
      listLetters()
        .then((rows) => { if (alive) setLetters(rows); })
        .catch(() => { /* the letter still reads fine with no history */ });
      return () => { alive = false; };
    }, [source]),
  );

  const openCompose = () => {
    haptic.tap();
    router.push({ pathname: '/letter/compose', params: { source } } as never);
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
        {/* ── Masthead: stamp, eyebrow, and the highlighted display headline ── */}
        <Animated.View entering={FadeIn.duration(450)} style={styles.masthead}>
          <View style={styles.mastheadTop}>
            <View style={styles.mastheadCopy}>
              <View style={styles.eyebrowRow}>
                <View style={styles.eyebrowDash} />
                <Typography
                  variant="caption"
                  weight="extrabold"
                  color={color.letter.accentInk}
                  style={styles.eyebrow}
                >
                  A LETTER FROM THE MAKERS
                </Typography>
              </View>
            </View>
            {/* Rotated slightly so it looks stuck on rather than laid out. */}
            <PostageStamp size={84} style={styles.stamp} />
          </View>

          <Animated.View entering={FadeInDown.duration(500).delay(80)}>
            <Typography style={styles.headline}>WE&apos;D LOVE TO</Typography>
            {/* The highlighter: a yellow block struck through the lower two
                thirds of the line, the way a marker actually lands. */}
            <View style={styles.highlightWrap}>
              <View style={styles.highlightBar} />
              <Typography style={styles.headline}>HEAR FROM YOU</Typography>
            </View>
          </Animated.View>
        </Animated.View>

        {/* ── The letter ─────────────────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.duration(550).delay(140)} style={styles.card}>
          <View style={styles.cardBody}>
            <Typography variant="body" color={color.slate} style={styles.para}>
              We build Pawtchi. Not a company you&apos;ll never reach — the two of us,
              and a short list of people who care about this as much as we do.
            </Typography>

            <Typography variant="body" color={color.slate} style={styles.para}>
              If something felt wrong, or the plan didn&apos;t fit your animal, or you
              wish this app did something it doesn&apos;t — write it down and send it
              here. Not a support form. No categories to pick.
            </Typography>

            {/* The promise is the load-bearing sentence on this screen, so it
                gets the blue rule and a tinted ground rather than sitting flat
                in the run of body copy. */}
            <View style={styles.promise}>
              <View style={styles.promiseRule} />
              <Typography variant="body" weight="medium" color={color.navy} style={styles.promiseText}>
                {FOUNDER_PROMISE}
              </Typography>
            </View>

            <PerforatedDivider style={styles.divider} />

            {/* Unsigned on purpose — no name here any more. The hand-drawn rule
                is left to read as the signature itself: "Regards," then the
                mark of someone who wrote it, then who they are. */}
            <Typography variant="caption" color={color.slateFaint}>
              Regards,
            </Typography>
            <SignatureRule width={148} style={styles.signatureRule} />
            <Typography variant="caption" color={color.slateMuted} style={styles.role}>
              {FOUNDER_ROLE}
            </Typography>
          </View>
        </Animated.View>

        {/* ── Past letters ───────────────────────────────────────────────────── */}
        {letters.length > 0 && (
          <Animated.View entering={FadeInDown.duration(550).delay(200)} style={styles.history}>
            <View style={styles.eyebrowRow}>
              <View style={styles.eyebrowDash} />
              <Typography
                variant="caption"
                weight="extrabold"
                color={color.letter.accentInk}
                style={styles.eyebrow}
              >
                YOUR LETTERS
              </Typography>
            </View>

            {letters.map((l) => {
              const unread = l.reply != null && l.reply.readAt == null;
              return (
                <TouchableOpacity
                  key={l.id}
                  style={styles.historyRow}
                  activeOpacity={0.75}
                  onPress={() => router.push(`/letter/${l.id}` as never)}
                >
                  {/* Replied letters get a solid blue seal; unanswered ones a
                      hollow one, so the state reads before the text does. */}
                  <View style={[styles.seal, l.reply != null && styles.sealAnswered]}>
                    <MaterialIcons
                      name={l.reply != null ? 'mark-email-read' : 'schedule-send'}
                      size={16}
                      color={l.reply != null ? color.letter.paper : color.letter.accent}
                    />
                  </View>

                  <View style={styles.historyText}>
                    <Typography variant="body" weight="medium" color={color.navy} numberOfLines={1}>
                      {l.body}
                    </Typography>
                    <Typography variant="caption" color={color.slateMuted}>
                      {l.reply
                        ? `We replied · ${formatDate(l.reply.createdAt)}`
                        : `Sent ${formatDate(l.createdAt)}`}
                    </Typography>
                  </View>

                  {unread && <View style={styles.unreadDot} />}
                  <MaterialIcons name="chevron-right" size={20} color={color.letter.accent} />
                </TouchableOpacity>
              );
            })}
          </Animated.View>
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.ctaBar}>
        <TouchableOpacity style={styles.cta} onPress={openCompose} activeOpacity={0.85}>
          <Typography variant="body" weight="extrabold" color={color.navy}>
            {WRITE_TO_FOUNDER_LABEL}
          </Typography>
          <MaterialIcons name="arrow-forward" size={20} color={color.navy} />
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

/**
 * The one line that must never drift into a promise we can't keep. "We read
 * every letter" is operationally true — the 3-per-24h cap in
 * submit_founder_letter() exists to keep it true. "We reply to as many as we
 * can" is deliberately not "we reply to everyone".
 */
const FOUNDER_PROMISE =
  'We read every letter that comes through here. We reply to as many as we can, and we answer as ourselves — not a template.';

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

  // ── Masthead ──────────────────────────────────────────────────────────────
  masthead: { marginBottom: space.xl },
  mastheadTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.md },
  mastheadCopy: { flex: 1, paddingTop: space.sm },
  stamp: { transform: [{ rotate: '4deg' }] },

  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  eyebrowDash: { width: 18, height: 2, backgroundColor: color.letter.accent },
  eyebrow: { letterSpacing: 1.4, flexShrink: 1 },

  headline: {
    ...displayLine(42),
    letterSpacing: 0.5,
    color: color.navy,
  },
  highlightWrap: { alignSelf: 'flex-start', position: 'relative' },
  highlightBar: {
    position: 'absolute',
    left: -6,
    right: -6,
    bottom: 8,
    height: '54%',
    backgroundColor: color.letter.yellow,
  },

  // ── Letter card ───────────────────────────────────────────────────────────
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.letter.hairline,
    backgroundColor: color.letter.paper,
    overflow: 'hidden',
  },
  cardBody: { padding: space.xl },
  para: { lineHeight: 23, marginBottom: space.md },

  promise: {
    flexDirection: 'row',
    gap: space.md,
    backgroundColor: color.letter.accentSoft,
    borderRadius: radius.md,
    padding: space.lg,
    marginTop: space.xs,
  },
  promiseRule: { width: 3, borderRadius: 2, backgroundColor: color.letter.accent },
  promiseText: { flex: 1, lineHeight: 22 },

  divider: { marginVertical: space.xl },
  // The squiggle now follows "Regards," directly, so it carries the spacing a
  // named signature used to.
  signatureRule: { marginTop: space.sm, marginBottom: space.xs },
  role: { marginTop: space.sm },

  // ── History ───────────────────────────────────────────────────────────────
  history: { marginTop: space.xxxl, gap: space.xs },
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
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.letter.accent,
  },

  // ── CTA ───────────────────────────────────────────────────────────────────
  ctaBar: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    backgroundColor: color.letter.paper,
    borderTopWidth: 1,
    borderTopColor: color.letter.hairline,
  },
  cta: {
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: color.letter.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
});
