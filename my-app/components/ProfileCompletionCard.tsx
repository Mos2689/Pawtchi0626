import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  FadeInDown, useSharedValue, useAnimatedProps, withTiming, Easing,
} from 'react-native-reanimated';
import { motion } from '../constants/design';

import { useActivePetStore } from '../store/useActivePetStore';
import { computeCompleteness, MissingItem } from '../lib/profileCompleteness';
import { track } from '../lib/analytics';
import { color, font, makeShadow } from '../constants/design';

// ─── Tokens (aligned to the rest of the home surface) ──────────────────────
// Card is intentionally light & airy so it nests under the colorful ring hero
// without competing. Yellow is reserved for the ONE call to action (§4.02).
const INK = color.ink;
const INK_MUTED = color.slateMuted;
const INK_FAINT = color.slateFaint;
const HAIRLINE = color.hairline;
const TRACK = color.track;
const RING_FILL = color.viz.amber;
const CTA_FILL = color.yellow;
const CTA_INK = color.navy;

const DISMISS_KEY = 'profile_completion_dismissed_at';
const RESURFACE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

// Possessive that handles names ending in "s" cleanly ("Lucas’s", "Bunny’s").
function possessive(name: string): string {
  return name.endsWith('s') ? `${name}’` : `${name}’s`;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// A tight, agency-grade progress ring. Single arc, no inner chrome, percent
// rendered outside for legibility — the ring becomes a glyph, not a chart.
// The arc sweeps to its value (same pattern as HealthRings.RingArc) instead of
// snapping, so the card reads as "filling toward done".
function ScoreRing({ pct }: { pct: number }) {
  const size = 56;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(pct / 100, 0), 1);

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(clamped, {
      duration: motion.duration.ring,
      easing: Easing.out(Easing.cubic),
    });
  }, [clamped, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: c * (1 - progress.value),
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={TRACK} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={RING_FILL}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          animatedProps={animatedProps}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={styles.ringPct}>{pct}</Text>
      <Text style={styles.ringUnit}>%</Text>
    </View>
  );
}

// A thin progress bar — the "ledger line" beneath the headline. Mirrors the
// ring's fill so the user sees the same number twice (anchor + reinforcement).
function ProgressLine({ pct }: { pct: number }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${clamped}%` }]} />
    </View>
  );
}

export function ProfileCompletionCard() {
  const router = useRouter();
  const activePet = useActivePetStore(s => s.activePet);
  const foodPantry = useActivePetStore(s => s.foodPantry);
  const [dismissed, setDismissed] = useState(true); // hidden until storage check

  const { score, missing, isAccurateEnough } = computeCompleteness(activePet, {
    pantryCount: foodPantry?.length ?? 0,
  });

  useEffect(() => {
    (async () => {
      try {
        const ts = await AsyncStorage.getItem(DISMISS_KEY);
        const recentlyDismissed = ts ? Date.now() - parseInt(ts, 10) < RESURFACE_AFTER_MS : false;
        setDismissed(recentlyDismissed);
      } catch {
        setDismissed(false);
      }
    })();
  }, []);

  const handleDismiss = async () => {
    setDismissed(true);
    try {
      await AsyncStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // best-effort
    }
  };

  if (!activePet || isAccurateEnough || dismissed) return null;

  const petName = activePet.name?.trim() || 'your pet';
  const owns = activePet.name?.trim() ? possessive(petName) : 'your pet’s';

  // ONE focal next step — highest-impact missing field. This is the whole
  // point of the redesign: no wrapping list, no vertical stack of chips.
  const next: MissingItem = missing[0];
  const more = Math.max(missing.length - 1, 0);

  // Most labels are imperative phrases ("Add a photo"). Convert to a clean
  // button label by stripping the leading verb and presenting it as a Next.
  const nextLabel = next.label;

  const goNext = () => {
    track('profile_completion_chip_tapped', { key: next.key });
    router.push(`/(tabs)/profile?focus=${next.focus}` as any);
  };

  const goAll = () => {
    track('profile_completion_chip_tapped', { key: 'all' });
    router.push('/(tabs)/profile' as any);
  };

  return (
    <Animated.View entering={FadeInDown.duration(380)} style={styles.card}>
      {/* Row 1 — identity: who, how complete, escape hatch ───────────────── */}
      <View style={styles.headerRow}>
        <ScoreRing pct={score} />
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>PROFILE</Text>
          <Text style={styles.title} numberOfLines={1}>
            {owns} full picture
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleDismiss}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.closeBtn}
          accessibilityLabel="Dismiss"
        >
          <MaterialIcons name="close" size={18} color={INK_FAINT} />
        </TouchableOpacity>
      </View>

      {/* Row 2 — progress + remaining count, calm one-liner ──────────────── */}
      <View style={styles.progressRow}>
        <ProgressLine pct={score} />
        <Text style={styles.progressMeta}>
          {missing.length === 1
            ? `1 detail left to make ${petName}’s results more accurate`
            : `${missing.length} details left to make ${petName}’s results more accurate`}
        </Text>
      </View>

      {/* Row 3 — the ONE call to action + a quiet way into the rest ──────── */}
      <Pressable
        onPress={goNext}
        android_ripple={{ color: 'rgba(26,26,0,0.08)', borderless: false }}
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
      >
        <View style={styles.ctaLeft}>
          <View style={styles.ctaIcon}>
            <MaterialIcons name="add" size={16} color={CTA_INK} />
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.ctaNext}>NEXT STEP</Text>
            <Text style={styles.ctaLabel} numberOfLines={1}>
              {nextLabel}
            </Text>
          </View>
        </View>
        <MaterialIcons name="arrow-forward" size={18} color={CTA_INK} />
      </Pressable>

      {more > 0 && (
        <TouchableOpacity onPress={goAll} style={styles.moreBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={styles.moreText}>
            {more === 1 ? 'See 1 more detail' : `See ${more} more details`}
          </Text>
          <MaterialIcons name="chevron-right" size={16} color={INK_MUTED} />
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // ─── Surface ───────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 16,
    // Calibrated depth — present without competing with the ring hero above.
    ...makeShadow(6, 14, 0.06),
  },

  // ─── Header row ────────────────────────────────────────────────────────
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  headerText: { flex: 1, minWidth: 0 },
  closeBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: TRACK,
  },
  eyebrow: {
    fontFamily: font.bold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: INK_FAINT,
    marginBottom: 4,
  },
  title: {
    fontFamily: font.extrabold,
    fontSize: 17,
    color: INK,
    letterSpacing: -0.2,
  },

  // Ring percent label — number large, "%" small for a designed feel.
  ringPct: {
    fontFamily: font.extrabold,
    fontSize: 15,
    color: INK,
    lineHeight: 16,
  },
  ringUnit: {
    position: 'absolute',
    bottom: 10,
    fontFamily: font.bold,
    fontSize: 9,
    color: INK_FAINT,
  },

  // ─── Progress row ──────────────────────────────────────────────────────
  progressRow: { marginTop: 16, marginBottom: 14 },
  progressTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: TRACK,
    overflow: 'hidden',
  },
  progressFill: {
    height: 5,
    borderRadius: 999,
    backgroundColor: RING_FILL,
  },
  progressMeta: {
    marginTop: 8,
    fontFamily: font.medium,
    fontSize: 12,
    color: INK_MUTED,
    lineHeight: 17,
  },

  // ─── CTA (the only yellow in the card) ────────────────────────────────
  cta: {
    backgroundColor: CTA_FILL,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ctaPressed: { opacity: 0.92 },
  ctaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
  },
  ctaIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(26,26,0,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaNext: {
    fontFamily: font.extrabold,
    fontSize: 9.5,
    letterSpacing: 1.2,
    color: 'rgba(7, 32, 42, 0.66)',
    marginBottom: 2,
  },
  ctaLabel: {
    fontFamily: font.bold,
    fontSize: 14.5,
    color: CTA_INK,
    letterSpacing: -0.1,
  },

  // ─── "+N more" — text-only, quiet, no chrome ───────────────────────────
  moreBtn: {
    marginTop: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
  },
  moreText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: INK_MUTED,
  },
});
