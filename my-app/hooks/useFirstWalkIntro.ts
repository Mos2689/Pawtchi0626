/**
 * useFirstWalkIntro — eligibility + persistence for the one-time Home intro
 * video that shows a fresh dog owner what a Pawtchi walk feels like.
 *
 * The rules live here (not on Home) so the trigger cannot re-fire on every
 * navigation re-render, and so the same "seen" gate is honoured by the skip
 * control, the CTA, the completion path, and the failure path alike.
 *
 * Persistence: one AsyncStorage key per (version, user). A device-scoped key
 * would starve every subsequent account on the same install of the intro —
 * the exact bug we hit during test: the first logged-in owner watched it,
 * then two freshly-created accounts on the same device saw nothing because
 * the flag was already set device-wide. The key is namespaced with the
 * Supabase user id so each new owner gets their own first-view.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const FIRST_WALK_INTRO_VERSION = 'v1' as const;

/**
 * Per-user storage key. Namespacing on the Supabase user id keeps each owner's
 * first-view independent — logging out and creating a second account on the
 * same device (or two owners sharing a phone) still gets the intro once.
 */
export function firstWalkIntroStorageKey(userId: string): string {
  return `pawtchi_walk_intro_${FIRST_WALK_INTRO_VERSION}_seen:${userId}`;
}

/**
 * Wait after the caller reports "ready" before presenting the overlay. Long
 * enough for the map layer to have painted its first frame; short enough that
 * it still feels attached to the arrival, not a delayed pop-up.
 */
const PRESENT_DELAY_MS = 300;

export type FirstWalkIntroInput = {
  /** Signed-in owner. Null while auth is resolving — the hook stays inert. */
  userId: string | null | undefined;
  /** True once the surface that should host the intro is mounted and settled. */
  ready: boolean;
  /**
   * True only when the app is safe to interrupt with a full-screen overlay.
   * Home passes `walkPhase === 'idle'` — a tracking / starting / saving /
   * summary walk must never be covered by the intro.
   */
  interruptible: boolean;
};

export type FirstWalkIntro = {
  /** The overlay should be visible right now. */
  visible: boolean;
  /**
   * Persist the seen flag AND hide the overlay. Idempotent — safe to call from
   * skip, complete, CTA-tap, and error paths without double-writes or double
   * navigations. Returns once the flag has been stored, so a caller that
   * navigates immediately after (e.g. the CTA) can await it before pushing.
   */
  markSeenAndClose: () => Promise<void>;
};

/**
 * Read the persisted flag once we know the surface is ready and safe to
 * interrupt. The eligibility check is latched per userId — a sign-out /
 * sign-in cycle with a different account re-runs the check under the new
 * namespace, so each account gets its own once-only presentation.
 */
export function useFirstWalkIntro(input: FirstWalkIntroInput): FirstWalkIntro {
  const { userId, ready, interruptible } = input;
  const [visible, setVisible] = useState(false);
  // Which user id have we already made a show/skip decision for? Re-set to
  // null when the user changes, so account switches don't share latches.
  const consideredForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    if (consideredForRef.current === userId) return;
    if (!ready || !interruptible) return;
    consideredForRef.current = userId;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        const key = firstWalkIntroStorageKey(userId);
        const seen = await AsyncStorage.getItem(key);
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          // eslint-disable-next-line no-console
          console.log('[firstWalkIntro] considered', { userId, seen });
        }
        if (cancelled || seen) return;
        timer = setTimeout(() => {
          if (!cancelled) setVisible(true);
        }, PRESENT_DELAY_MS);
      } catch {
        // Storage failure must never trap the user. Treat it as "already
        // seen" — the intro is a nice-to-have, not a required step.
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [userId, ready, interruptible]);

  // Re-arm consideration when the user id changes (sign-out / sign-in).
  // Without this, the ref would stay latched to the previous account and the
  // next account would never re-enter the eligibility branch above.
  useEffect(() => {
    if (consideredForRef.current && consideredForRef.current !== userId) {
      consideredForRef.current = null;
      setVisible(false);
    }
  }, [userId]);

  const markSeenAndClose = useCallback(async () => {
    setVisible(false);
    if (!userId) return;
    try {
      await AsyncStorage.setItem(
        firstWalkIntroStorageKey(userId),
        FIRST_WALK_INTRO_VERSION,
      );
    } catch {
      // Same reasoning as above — a write failure at worst re-shows the
      // overlay on next launch, which is still better than crashing here.
    }
  }, [userId]);

  return { visible, markSeenAndClose };
}

/**
 * Clear the seen flag(s). Development-only helper for testing the flow
 * repeatedly. With no argument, wipes every per-user flag; with a userId,
 * wipes just that account's flag. Wired to a global in __DEV__ so it can be
 * invoked from Metro / the debugger without adding UI to production.
 */
export async function resetFirstWalkIntro(userId?: string): Promise<void> {
  try {
    if (userId) {
      await AsyncStorage.removeItem(firstWalkIntroStorageKey(userId));
      return;
    }
    // Full sweep: every key that matches the versioned prefix, including the
    // legacy unscoped key from the first cut of this feature.
    const prefix = `pawtchi_walk_intro_${FIRST_WALK_INTRO_VERSION}_seen`;
    const keys = await AsyncStorage.getAllKeys();
    const targets = keys.filter(k => k === prefix || k.startsWith(`${prefix}:`));
    if (targets.length > 0) await AsyncStorage.multiRemove(targets);
  } catch {
    // Nothing to do — the reset is best-effort.
  }
}

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  // Exposed on globalThis so a developer can run
  //   __resetFirstWalkIntro()          // wipes every account's flag
  //   __resetFirstWalkIntro(userId)    // wipes just one account's flag
  // from the Metro console / Chrome debugger to replay the intro. Never
  // included in production bundles — the __DEV__ branch is dead-code
  // eliminated by Metro at release time.
  (globalThis as unknown as {
    __resetFirstWalkIntro?: (userId?: string) => Promise<void>;
  }).__resetFirstWalkIntro = resetFirstWalkIntro;
}
