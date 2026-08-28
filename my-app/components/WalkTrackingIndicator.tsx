/**
 * WalkTrackingIndicator — the always-visible proof that location tracking is
 * (or isn't) running, and the manual escape hatch if it ever leaks.
 *
 * Rendered once as a root overlay by the tab layout so it floats over every
 * tab. Two states, driven by useTrackingIndicator:
 *   • active — a live walk is tracking. A compact branded badge in the
 *     top-right corner (yellow circle, walking glyph, a soft live pulse); tap
 *     it to open the walk. Finish now lives on the walk screen itself — the
 *     badge is purely a "back to your walk" affordance, no words, no timer.
 *   • leak   — the OS service is still on with no walk in flight (the bug this
 *     component guards against). This one STAYS explanatory: a calm alert with
 *     a prominent Stop tracking that hard-kills the service immediately — a
 *     "you're still being tracked" warning must never be a mystery icon.
 *
 * Hidden on /walk itself (that screen already shows live state).
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Reanimated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { color, font, radius, shadow, space } from '../constants/design';
import { haptic } from '../lib/haptics';
import { RunningDogIcon } from './icons/RunningDogIcon';
import { useTrackingIndicator } from '../hooks/useTrackingIndicator';

const BADGE = 46;
const PULSE_MS = 1800;

// Compact active badge — a running-dog glyph in a navy circle with a soft pulse
// ring that reads as "live" without a single word. Tap opens the walk.
function ActiveBadge({ name, onOpen }: { name: string; onOpen: () => void }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.7 }],
    opacity: 0.5 * (1 - pulse.value),
  }));

  return (
    <Reanimated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={styles.badgeWrap}>
      <Reanimated.View style={[styles.ring, ringStyle]} pointerEvents="none" />
      <TouchableOpacity
        style={styles.badge}
        activeOpacity={0.85}
        onPress={() => {
          haptic.tap();
          onOpen();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Tracking ${name}'s walk, open walk`}
      >
        <RunningDogIcon size={26} color={color.cream} />
      </TouchableOpacity>
    </Reanimated.View>
  );
}

export function WalkTrackingIndicator() {
  const { visible, mode, petName, onStop } = useTrackingIndicator();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();

  // The walk screen owns its own live UI — never double up there.
  if (!visible || pathname.endsWith('/walk')) return null;

  const name = petName ?? 'your dog';

  // ── Active: the branded corner badge ──
  if (mode === 'active') {
    return (
      <View pointerEvents="box-none" style={[styles.wrap, styles.wrapActive, { top: insets.top + space.sm }]}>
        <ActiveBadge name={name} onOpen={() => router.push('/walk' as any)} />
      </View>
    );
  }

  // ── Leak: stays a full, explanatory warning (safety-critical) ──
  const handleStop = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onStop();
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + space.sm }]}>
      <Reanimated.View
        entering={FadeInDown.duration(220)}
        exiting={FadeOut.duration(160)}
        style={[styles.card, styles.cardLeak]}
      >
        <View
          style={styles.body}
          accessibilityRole="text"
          accessibilityLabel="Location tracking is still active"
        >
          <MaterialIcons name="warning-amber" size={18} color={color.alert} />
          <View style={styles.copy}>
            <Text style={styles.leakTitle} numberOfLines={1}>
              Location still active
            </Text>
            <Text style={styles.leakSub} numberOfLines={1}>
              A walk ended but tracking didn’t stop — tap to fix
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.stopPill}
          activeOpacity={0.9}
          onPress={handleStop}
          accessibilityRole="button"
          accessibilityLabel="Stop tracking"
        >
          <MaterialIcons name="stop" size={15} color={color.navy} />
          <Text style={styles.stopText}>Stop</Text>
        </TouchableOpacity>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    zIndex: 30,
  },
  // Active badge hugs the top-right corner.
  wrapActive: {
    alignItems: 'flex-end',
  },
  badgeWrap: {
    width: BADGE,
    height: BADGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    borderWidth: 2,
    borderColor: color.navy,
  },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    backgroundColor: color.navy,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  // ── Leak banner ──
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.navy,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    ...shadow.raised,
  },
  cardLeak: {
    borderWidth: 1,
    borderColor: color.alert,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flex: 1,
    paddingVertical: space.xs,
  },
  copy: {
    flex: 1,
    gap: 1,
  },
  leakTitle: {
    fontFamily: font.bold,
    fontSize: 13,
    color: color.cream,
  },
  leakSub: {
    fontFamily: font.medium,
    fontSize: 11.5,
    color: color.creamDim,
  },
  stopPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: color.yellow,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    marginLeft: space.sm,
  },
  stopText: {
    fontFamily: font.bold,
    fontSize: 12,
    color: color.navy,
  },
});
