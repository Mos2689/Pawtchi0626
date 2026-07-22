import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { OwnerPrefsRow } from '../lib/routineDefaults';

interface OwnerPrefsState {
  prefs: OwnerPrefsRow | null;
  isLoading: boolean;
  hasFetched: boolean;
  // Staleness bookkeeping — mirrors useStreakStore's pattern.
  _fetchedAt: number;
  _fetchedUser: string | null;

  fetchPrefs: (userId: string, opts?: { force?: boolean }) => Promise<void>;
  upsertPrefs: (userId: string, row: OwnerPrefsRow) => Promise<boolean>;
  clearPrefs: () => void;
}

const PREFS_STALE_MS = 60_000;

export const useOwnerPrefsStore = create<OwnerPrefsState>((set, get) => ({
  prefs: null,
  isLoading: false,
  hasFetched: false,
  _fetchedAt: 0,
  _fetchedUser: null,

  fetchPrefs: async (userId, opts) => {
    const prev = get();
    if (!opts?.force && prev._fetchedUser === userId && Date.now() - prev._fetchedAt < PREFS_STALE_MS) {
      return;
    }
    set({ isLoading: true });
    const { data, error } = await supabase
      .from('owner_preferences')
      .select('*')
      .eq('owner_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[OwnerPrefsStore] fetch error:', error);
      set({ isLoading: false, hasFetched: true, _fetchedAt: Date.now(), _fetchedUser: userId });
      return;
    }
    set({
      prefs: (data as OwnerPrefsRow | null) ?? null,
      isLoading: false,
      hasFetched: true,
      _fetchedAt: Date.now(),
      _fetchedUser: userId,
    });
  },

  upsertPrefs: async (userId, row) => {
    // Optimistic update so the activity tab can re-render immediately.
    const prev = get().prefs;
    set({ prefs: { ...prev, ...row }, hasFetched: true });

    const payload = { owner_id: userId, ...row, updated_at: new Date().toISOString() };
    const { error } = await supabase
      .from('owner_preferences')
      .upsert(payload, { onConflict: 'owner_id' });

    if (error) {
      console.error('[OwnerPrefsStore] upsert error:', error);
      set({ prefs: prev });
      return false;
    }
    set({ _fetchedAt: Date.now(), _fetchedUser: userId });
    return true;
  },

  clearPrefs: () => set({
    prefs: null,
    isLoading: false,
    hasFetched: false,
    _fetchedAt: 0,
    _fetchedUser: null,
  }),
}));
