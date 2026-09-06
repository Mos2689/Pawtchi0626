/**
 * Where a walk photo goes, beyond Pawtchi's own copy.
 *
 * ── Why this exists, and why it defaults to off ──
 * Every capture is written into the app container first (lib/walk/keepsakeFile.ts),
 * and that copy is what every surface renders from. The second copy — a
 * full-resolution one in the owner's camera roll — is a courtesy, and it costs
 * an iOS permission alert the first time.
 *
 * That alert used to fire automatically, seconds after the shutter, in the
 * middle of a walk. For an app whose whole photo argument is "we do not read
 * your library", a system sheet about photos is the wrong sentence to say at
 * the wrong moment — it reads as the app reaching for the camera roll, which is
 * exactly what the container copy was built to stop doing.
 *
 * So the courtesy is now something the owner asks for, from a control in the
 * camera, at a moment they chose. Off means no prompt, ever, and nothing about
 * the app degrades: the photo still exists, still renders, still syncs its
 * thumbnail. On means one prompt, once, because they went looking for it.
 *
 * ── Per-device, and not synced ──
 * Deliberately local, like useWalkPostPrefsStore. Photo permission is granted
 * per device against one camera roll; syncing this would let a phone that has
 * never been asked start asking on another phone's decision.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface WalkPhotoPrefsState {
  /** Also keep a full-resolution copy in the owner's own photo library. */
  saveToLibrary: boolean;
  setSaveToLibrary: (value: boolean) => void;
}

export const useWalkPhotoPrefsStore = create<WalkPhotoPrefsState>()(
  persist(
    set => ({
      saveToLibrary: false,
      setSaveToLibrary: value => set({ saveToLibrary: value }),
    }),
    {
      name: 'walk-photo-prefs',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);
