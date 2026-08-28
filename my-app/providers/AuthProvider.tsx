import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

import { useActivePetStore } from '../store/useActivePetStore';
import { useStreakStore } from '../store/useStreakStore';
import { usePetContextStore } from '../store/usePetContextStore';
import { useNotificationCenterStore } from '../store/useNotificationCenterStore';
import { useOwnerPrefsStore } from '../store/useOwnerPrefsStore';
import { useWalkStoryStore } from '../store/useWalkStoryStore';
import { usePawPrintStore } from '../store/usePawPrintStore';
import { usePetStore } from '../store/usePetStore';
import { invalidateAskCache } from '../lib/askVet';
import { clearProOfferCache } from '../lib/proOffer/client';
import { WALK_TRACKING_ENABLED } from '../constants/features';

/**
 * Everything the previous account left in memory or on disk.
 *
 * One function, called from both the explicit sign-out and the auth listener,
 * because the two had already drifted: the listener cleared three stores and
 * `signOut` cleared the same three plus walk tracking, while five other stores
 * were cleared by nobody.
 *
 * That gap is what let a notification about a deleted account's pet appear in
 * the next account's inbox — `useNotificationCenterStore` holds `runtimeItems`,
 * which unlike its derived items are pushed in by screens and never recomputed
 * away.
 *
 * Every call is individually guarded: a throw here must not be able to abort a
 * sign-out and strand someone in a half-authenticated state.
 */
function clearAllUserState(): void {
  try { useActivePetStore.getState().clearPet(); } catch {}
  try { useStreakStore.getState().clearStreak(); } catch {}
  try { usePetContextStore.getState().clearContext(); } catch {}
  try { useNotificationCenterStore.getState().clearCenter(); } catch {}
  // Owner routine (feeding and walk times) — rendered for the next user until
  // their own `fetchPrefs` resolved.
  try { useOwnerPrefsStore.getState().clearPrefs(); } catch {}
  // Up to five full walk-story snapshots, persisted to disk.
  try { useWalkStoryStore.getState().clear(); } catch {}
  // Milestone + template-unlock celebration queues, and the gallery totals.
  // Queued celebrations are pushed in by walk sync and only leave when they are
  // celebrated, so the next account was shown the previous owner's milestone.
  try { usePawPrintStore.getState().clearPawPrints(); } catch {}
  // Onboarding draft: name, breed, body-check answers. Without this it carried
  // into the *next* account's onboarding.
  try { usePetStore.getState().resetForm(); } catch {}
  // Module-level 60 s cache of ask-vet monthly usage.
  try { invalidateAskCache(); } catch {}
  // Cached win-back grants, keyed per user on disk. Left behind, the next
  // account on this device could be shown a discount belonging to the previous
  // one — the runtimeItems leak above, with a price attached. Async and
  // deliberately not awaited: sign-out must not wait on disk.
  try { void clearProOfferCache(); } catch {}
}

type AuthContextType = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isSigningOut: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  isLoading: true,
  isSigningOut: false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const signOutInFlight = useRef(false);

  useEffect(() => {
    // 1. Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    // 2. Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: any, authSession: Session | null) => {
        if (!authSession) clearAllUserState();
        setSession(authSession);
        setUser(authSession?.user ?? null);
        setIsLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    // signOut() ONLY mutates state — it performs ZERO navigation. The
    // centralized auth gate in app/_layout.tsx reacts to session === null and
    // moves the user to the welcome screen. Keeping navigation out of here is
    // what eliminates the competing-redirect loop ("Maximum update depth").
    // It also NEVER awaits an unbounded network call: the default
    // supabase.auth.signOut() hits /auth/v1/logout with no timeout and hung the
    // UI on flaky networks, so the blocking step uses scope: 'local' (no
    // network) and the remote revocation is fire-and-forget.
    if (signOutInFlight.current) return;
    signOutInFlight.current = true;
    setIsSigningOut(true);
    try {
      // 1. Clear in-memory stores synchronously so any render during the
      //    transition reads blank state, not stale activePet!.
      clearAllUserState();
      // Kill any live location tracking on the way out — the reconciler only
      // fires on phase change, and signing out mid-walk doesn't touch the walk
      // phase, so without this a service could leak past the session. Fire-and-
      // forget: never block the sign-out on the bounded OS stop.
      if (WALK_TRACKING_ENABLED) {
        import('../store/useWalkStore')
          .then(({ useWalkStore }) => useWalkStore.getState().hardStopTracking())
          .catch(() => {});
      }

      // 2. Fire-and-forget walkthrough wipes — SafeStorage already caps these at 2 s.
      AsyncStorage.removeItem('walkthrough_completed').catch(() => {});
      AsyncStorage.removeItem('walkthrough_completed_steps').catch(() => {});

      // 3. Local-only session clear — writes AsyncStorage, no network. Raced
      //    against a hard 1500 ms cap so a pathological storage stall can't hang.
      const LOCAL_SIGNOUT_TIMEOUT_MS = 1500;
      await Promise.race([
        supabase.auth.signOut({ scope: 'local' }).catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, LOCAL_SIGNOUT_TIMEOUT_MS)),
      ]);

      // 4. Force-reset auth state. The onAuthStateChange listener will also fire,
      //    but we don't wait for it — this immediate change is what the auth gate
      //    keys off to navigate to the welcome screen.
      setSession(null);
      setUser(null);

      // 5. Best-effort remote revocation — never awaited; the gate has already
      //    moved the user away by the time this resolves (or fails).
      supabase.auth.signOut({ scope: 'global' }).catch(() => {});
    } finally {
      signOutInFlight.current = false;
      setIsSigningOut(false);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ session, user, isLoading, isSigningOut, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
