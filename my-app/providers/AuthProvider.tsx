import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

import { useActivePetStore } from '../store/useActivePetStore';
import { useStreakStore } from '../store/useStreakStore';
import { usePetContextStore } from '../store/usePetContextStore';

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
        if (!authSession) {
          useActivePetStore.getState().clearPet();
          useStreakStore.getState().clearStreak();
          usePetContextStore.getState().clearContext();
        }
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
      try { useActivePetStore.getState().clearPet(); } catch {}
      try { useStreakStore.getState().clearStreak(); } catch {}
      try { usePetContextStore.getState().clearContext(); } catch {}

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
