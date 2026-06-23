import { create } from 'zustand';
import { supabase } from '../lib/supabase';

// Reason labels for toast display
const REASON_LABELS: Record<string, string> = {
  food_log: 'Food logged!',
  activity_complete: 'Activity complete!',
  weight_log: 'Weight tracked!',
  brand_setup: 'Brands saved!',
  vet_report_log: 'Vet report saved',
};

export interface EarnEvent {
  coins: number;
  reason: string;
  label: string;
  milestone?: number;
  streakBroken?: boolean;
  previousStreak?: number;
}

interface StreakState {
  currentStreak: number;
  longestStreak: number;
  pawCoins: number;
  lastLoggedDate: string | null;
  isLoading: boolean;

  // Last earn event for CoinToast display
  lastEarnEvent: EarnEvent | null;

  // Internal freshness bookkeeping (mirrors usePetContextStore's staleness guard).
  _fetchedAt: number;
  _fetchedUser: string | null;

  fetchStreak: (userId: string, opts?: { force?: boolean }) => Promise<void>;
  awardCoins: (userId: string, action: string, referenceId?: string) => Promise<void>;
  deductCoins: (userId: string, amount: number) => Promise<boolean>;
  clearLastEarn: () => void;
  clearStreak: () => void;
}

// Skip a refetch within this window (awardCoins/deductCoins keep the store fresh).
const STREAK_STALE_MS = 30_000;

export const useStreakStore = create<StreakState>((set, get) => ({
  currentStreak: 0,
  longestStreak: 0,
  pawCoins: 0,
  lastLoggedDate: null,
  isLoading: true,
  lastEarnEvent: null,
  _fetchedAt: 0,
  _fetchedUser: null,

  fetchStreak: async (userId: string, opts?: { force?: boolean }) => {
    // Staleness guard: the streak is fetched on every Home focus + in the tab
    // layout. awardCoins/deductCoins update it optimistically, so a fresh fetch
    // within the window is redundant.
    const prev = get();
    if (!opts?.force && prev._fetchedUser === userId && (Date.now() - prev._fetchedAt) < STREAK_STALE_MS) {
      return;
    }
    try {
      const { data, error } = await supabase
        .from('streaks')
        .select('current_streak, longest_streak, paw_coins, last_logged_date')
        .eq('owner_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('[StreakStore] Fetch error:', error);
        set({ isLoading: false });
        return;
      }

      if (data) {
        set({
          currentStreak: data.current_streak || 0,
          longestStreak: data.longest_streak || 0,
          pawCoins: data.paw_coins || 0,
          lastLoggedDate: data.last_logged_date || null,
          isLoading: false,
          _fetchedAt: Date.now(),
          _fetchedUser: userId,
        });
      } else {
        set({ isLoading: false, _fetchedAt: Date.now(), _fetchedUser: userId });
      }
    } catch (err) {
      console.error('[StreakStore] Fetch error:', err);
      set({ isLoading: false });
    }
  },

  awardCoins: async (userId: string, action: string, referenceId?: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('update-streak', {
        body: { userId, action, referenceId },
      });

      if (error) throw error;

      if (data.success) {
        const earnEvent: EarnEvent = {
          coins: data.coinsEarned,
          reason: action,
          label: REASON_LABELS[action] || 'Coins earned!',
        };

        if (data.milestoneHit) {
          earnEvent.milestone = data.milestoneHit;
        }
        if (data.streakBroken) {
          earnEvent.streakBroken = true;
          earnEvent.previousStreak = data.previousStreak;
        }

        set({
          currentStreak: data.currentStreak,
          longestStreak: data.longestStreak,
          pawCoins: data.pawCoins,
          lastLoggedDate: new Date().toISOString().split('T')[0],
          lastEarnEvent: earnEvent,
          // Store is now authoritative → refresh the freshness stamp so the next
          // focus doesn't issue a redundant fetch.
          _fetchedAt: Date.now(),
          _fetchedUser: userId,
        });
      } else {
        console.error('[StreakStore] Award error:', data.error);
      }
    } catch (err) {
      console.error('[StreakStore] Award error:', err);
    }
  },

  deductCoins: async (userId: string, amount: number) => {
    const currentState = useStreakStore.getState();
    if (currentState.pawCoins < amount) return false;

    // Optimistic UI update
    const newBalance = currentState.pawCoins - amount;
    set({ pawCoins: newBalance });

    try {
      const { error } = await supabase
        .from('streaks')
        .update({ paw_coins: newBalance })
        .eq('owner_id', userId);

      if (error) {
        console.error('[StreakStore] Deduct error:', error);
        set({ pawCoins: currentState.pawCoins }); // Rollback
        return false;
      }
      return true;
    } catch (err) {
      console.error('[StreakStore] Deduct err:', err);
      set({ pawCoins: currentState.pawCoins }); // Rollback
      return false;
    }
  },

  clearLastEarn: () => set({ lastEarnEvent: null }),

  clearStreak: () => set({
    currentStreak: 0,
    longestStreak: 0,
    pawCoins: 0,
    lastLoggedDate: null,
    isLoading: true,
    lastEarnEvent: null,
    _fetchedAt: 0,
    _fetchedUser: null,
  }),
}));
