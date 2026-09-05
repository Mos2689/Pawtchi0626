/**
 * WalkTabDock — the "start a walk" affordance, docked above the Activity tab.
 *
 * Rendered as a root overlay by the tab layout so it can sit ON TOP of the
 * tab bar (a screen-level element can't — the bar draws above screen content).
 * It's a white "collar" bump carrying the navy record ring, seated half in /
 * half out of the bar's top edge so it reads as an extension of the tab bar
 * rather than a floating FAB.
 *
 * Only shown on the Activity tab — walks live there, and the bump aligns to
 * the centre (Activity) tab column. Tap starts a tracked walk on every plan.
 */

import React, { useCallback } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { color, shadow } from '../constants/design';
import { armWalkStart } from '../lib/walk/walkStartIntent';

// Matches the tabBarStyle height base in app/(tabs)/_layout.tsx.
const TAB_BAR_BASE = 60;

export function WalkTabDock() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const onPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    armWalkStart();
    router.push('/walk' as any);
  }, [router]);

  // Only surfaces on the Activity tab.
  if (!pathname.endsWith('/activity')) return null;

  const tabBarHeight = TAB_BAR_BASE + insets.bottom;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.dock, { bottom: tabBarHeight - 37 }]}
    >
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={styles.collar}
        accessibilityRole="button"
        accessibilityLabel="Start a tracked walk"
      >
        <View style={styles.ring}>
          <View style={styles.dot} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  collar: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  ring: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2.5,
    borderColor: color.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.navy,
  },
});
