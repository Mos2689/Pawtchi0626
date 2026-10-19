/**
 * useKeepsakeRecovery — finish unfinished walk photos on launch and on every
 * return to the foreground (lib/walk/keepsakeRecovery.ts).
 *
 * Mounted once, in the signed-in tab layout. Before this, unfinished photos
 * were retried only when the walk screen next mounted — so a photo whose
 * thumbnail failed on a walk with no signal waited, as the only copy anywhere,
 * until the owner happened to start another walk.
 *
 * Fire-and-forget from an effect, never awaited by anything that renders: the
 * boot path must not gain an await that can hang (the Android login hang), and
 * nothing here is worth delaying a screen for.
 *
 * One run at a time, app-wide. A foreground event landing mid-run is dropped,
 * not queued — the next foreground picks up whatever is left.
 */

import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { recoverKeepsakes } from '../lib/walk/keepsakeRecovery';
import { recoveryPorts } from '../lib/walk/keepsakeRecoveryPorts';
import { track } from '../lib/analytics';
import { backupPending } from '../lib/walk/keepsakeBackup';
import { backupPorts } from '../lib/walk/keepsakeBackupPorts';
import { fetchBackupEnabled } from '../lib/walk/keepsakeBackupSync';

let running = false;

export async function runKeepsakeRecovery(ownerId: string): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await recoverKeepsakes(recoveryPorts, ownerId);
    // Counts only (support-diagnostics privacy boundary). Sent only when there
    // was something to do, so a healthy phone adds no events.
    if (r.rescued || r.unmatched || r.sent || r.queued || r.thumbsUploaded || r.thumbsUnrecoverable) {
      track('keepsake_recovery_summary', {
        rescued: r.rescued,
        unmatched: r.unmatched,
        sent: r.sent,
        queued: r.queued,
        thumbs_uploaded: r.thumbsUploaded,
        thumbs_unrecoverable: r.thumbsUnrecoverable,
      });
    }
    // Opt-in backup of full-size photos rides the same run, AFTER recovery so
    // rows written just now are already in its queue. Off by default; a phone
    // whose owner never turned it on makes exactly one cheap read here.
    if (await fetchBackupEnabled(ownerId)) {
      const b = await backupPending(backupPorts, ownerId);
      if (b.uploaded || b.failed || b.missing) {
        track('keepsake_backup_summary', { uploaded: b.uploaded, failed: b.failed, missing: b.missing });
      }
    }
  } finally {
    running = false;
  }
}

export function useKeepsakeRecovery(ownerId: string | null, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !ownerId) return;
    void runKeepsakeRecovery(ownerId);
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void runKeepsakeRecovery(ownerId);
    });
    return () => sub.remove();
  }, [ownerId, enabled]);
}
