// Centralised haptic feedback. One-liner call sites, iOS-gated in one place so
// Android (and any future platform without haptics) silently no-ops instead of
// throwing. Mirrors the EXPO_OS guard used in components/haptic-tab.tsx.
//
// Usage:
//   import { haptic } from '../lib/haptics';
//   haptic.tap();      // light press feedback on a button/chip
//   haptic.select();   // selection change in a picker
//   haptic.success();  // an action committed (log, scan, complete)
//   haptic.warning();  // a soft "can't do that" / validation miss

import * as Haptics from 'expo-haptics';

// Haptics are only meaningful on iOS in this app; Android's generic vibration
// feels worse than nothing here. Gate centrally.
const enabled = process.env.EXPO_OS === 'ios';

function run(fn: () => Promise<unknown>): void {
  if (!enabled) return;
  // Fire-and-forget — never let a haptic failure bubble into UI logic.
  fn().catch(() => {});
}

export const haptic = {
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  soft: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)),
  medium: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  select: () => run(() => Haptics.selectionAsync()),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
