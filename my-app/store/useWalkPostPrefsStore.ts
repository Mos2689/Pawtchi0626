/**
 * Local UI prefs for the shareable Walk Post card. Not synced to Supabase —
 * these are per-device rendering choices, cheap to lose, cheap to keep.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface WalkPostPrefsState {
  /** Render the start-point and end-point pins on the SVG route trace. */
  showRoutePins: boolean;
  setShowRoutePins: (value: boolean) => void;
  toggleRoutePins: () => void;
}

export const useWalkPostPrefsStore = create<WalkPostPrefsState>()(
  persist(
    (set, get) => ({
      showRoutePins: true,
      setShowRoutePins: value => set({ showRoutePins: value }),
      toggleRoutePins: () => set({ showRoutePins: !get().showRoutePins }),
    }),
    {
      name: 'walk-post-prefs',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);
