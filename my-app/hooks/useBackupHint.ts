/**
 * useBackupHint — the one-time "Changing phones?" hint on a walk summary.
 *
 * Shown once per install, and only when it is true and useful: this walk kept
 * at least one photo, and the owner has not turned photo backup on. Dismissed
 * or acted on, it never comes back — backup is the owner's call, and a hint
 * repeated after every walk would turn an offer into a nag.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchBackupEnabled } from '../lib/walk/keepsakeBackupSync';

const SEEN_KEY = 'pawtchi.walk.backupHintSeen.v1';

export function useBackupHint(ownerId: string | null, photoCount: number, enabled: boolean) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled || !ownerId || photoCount === 0) return;
    let alive = true;
    void (async () => {
      try {
        if (await AsyncStorage.getItem(SEEN_KEY)) return;
        if (await fetchBackupEnabled(ownerId)) return;
        if (alive) setVisible(true);
      } catch {
        // No hint is the safe failure.
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, ownerId, photoCount]);

  const dismiss = useCallback(() => {
    setVisible(false);
    void AsyncStorage.setItem(SEEN_KEY, String(Date.now())).catch(() => undefined);
  }, []);

  return { visible, dismiss };
}
