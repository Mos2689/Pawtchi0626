/**
 * WalkTrackingIndicator — the always-visible proof that location tracking is
 * (or isn't) running, and the manual escape hatch if it ever leaks.
 *
 * Rendered once as a root overlay by the tab layout so it floats over every
 * tab. Two states, driven by useTrackingIndicator:
 *   • active — a live walk is tracking. Reassurance: breathing paw, pet name,
 *     running timer, tap to open the walk, and a Stop that finishes the walk.
 *   • leak   — the OS service is still on with no walk in flight (the bug this
 *     component guards against). A calm alert with a prominent Stop tracking
 *     that hard-kills the service immediately — no force-close required.
 *
 * Hidden on /walk itself (that screen already shows live state).
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Reanimated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { color, font, radius, shadow, space } from '../constants/design';
import { BreathingPaw } from './BreathingPaw';
import { useTrackingIndicator } from '../hooks/useTrackingIndicator';

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function WalkTrackingIndicator() {
  const { visible, mode, petName, elapsedMs, onStop } = useTrackingIndicator();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();

  // The walk screen owns its own live UI — never double up there.
  if (!visible || pathname.endsWith('/walk')) return null;

  const isLeak = mode === 'leak';
  const name = petName ?? 'your dog';

  const handleStop = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onStop();
  };

  const openWalk = () => {
    if (isLeak) return; // no live walk to open
    router.push('/walk' as any);
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + space.sm }]}
    >
      <Reanimated.View
        entering={FadeInDown.duration(220)}
        exiting={FadeOut.duration(160)}
        style={[styles.card, isLeak && styles.cardLeak]}
      >
        <TouchableOpacity
          style={styles.body}
          activeOpacity={isLeak ? 1 : 0.85}
          onPress={openWalk}
          accessibilityRole={isLeak ? 'text' : 'button'}
          accessibilityLabel={
            isLeak
              ? 'Location tracking is still active'
              : `Tracking ${name}'s walk, open walk`
          }
        >
          {isLeak ? (
            <MaterialIcons name="warning-amber" size={18} color={color.alert} />
          ) : (
            <BreathingPaw size={16} workingColor={color.cream} />
          )}
          <View style={styles.copy}>
            {isLeak ? (
              <>
                <Text style={styles.leakTitle} numberOfLines={1}>
                  Location still active
                </Text>
                <Text style={styles.leakSub} numberOfLines={1}>
                  A walk ended but tracking didn’t stop — tap to fix
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.title} numberOfLines={1}>
                  Tracking {name}’s walk
                </Text>
                <Text style={styles.timer}>{formatElapsed(elapsedMs)}</Text>
              </>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.stopPill}
          activeOpacity={0.9}
          onPress={handleStop}
          accessibilityRole="button"
          accessibilityLabel={isLeak ? 'Stop tracking' : 'Finish walk'}
        >
          <MaterialIcons name="stop" size={15} color={color.navy} />
          <Text style={styles.stopText}>{isLeak ? 'Stop' : 'Finish'}</Text>
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
  title: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.cream,
  },
  timer: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.yellow,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
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
