import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { WalkStorySnapshot } from '../lib/walkStorySnapshot';

const MAX_CACHED_STORIES = 5;

interface WalkStoryCacheState {
  snapshots: Record<string, WalkStorySnapshot>;
  prime: (snapshot: WalkStorySnapshot) => void;
  removeForPet: (petId: string) => void;
  clear: () => void;
}

function keepMostRecent(
  snapshots: Record<string, WalkStorySnapshot>,
): Record<string, WalkStorySnapshot> {
  return Object.fromEntries(
    Object.entries(snapshots)
      .sort(([, a], [, b]) => b.cachedAt - a.cachedAt)
      .slice(0, MAX_CACHED_STORIES),
  );
}

/**
 * Small stale-while-revalidate cache for instant Story entry. Zustand makes a
 * freshly primed snapshot readable synchronously before navigation; persist
 * keeps recent replays instant after an app restart.
 */
export const useWalkStoryStore = create<WalkStoryCacheState>()(
  persist(
    (set) => ({
      snapshots: {},
      prime: (snapshot) =>
        set((state) => ({
          snapshots: keepMostRecent({
            ...state.snapshots,
            [snapshot.walkSessionId]: snapshot,
          }),
        })),
      removeForPet: (petId) =>
        set((state) => ({
          snapshots: Object.fromEntries(
            Object.entries(state.snapshots).filter(
              ([, snapshot]) => snapshot.petId !== petId,
            ),
          ),
        })),
      clear: () => set({ snapshots: {} }),
    }),
    {
      name: 'walkstory:snapshots:v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ snapshots: state.snapshots }),
    },
  ),
);

export function latestCachedStoryForPet(
  snapshots: Record<string, WalkStorySnapshot>,
  petId: string | null | undefined,
): WalkStorySnapshot | null {
  if (!petId) return null;
  return (
    Object.values(snapshots)
      .filter((snapshot) => snapshot.petId === petId)
      .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
  );
}
