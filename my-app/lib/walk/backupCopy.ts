/**
 * Every user-facing string for the opt-in walk-photo backup, in one place so
 * the promise it makes can be reviewed (and kept in step with the privacy
 * policy) without reading screen code.
 *
 * What the copy may claim, because the code does it:
 *   • full-size copies, stored privately (private bucket, owner-only RLS);
 *   • only the owner can see them (signed URLs, owner-scoped policies);
 *   • off by default; turning it off DELETES the backups (clearBackups).
 */

export const BACKUP_ROW_LABEL = 'Back up walk photos';

export function backupRowSub(on: boolean | null): string {
  if (on === null) return 'Keep full-size photos safe if you change phones';
  return on
    ? 'On — full-size photos are kept safe if you change phones'
    : 'Off — walk photos live only on this phone';
}

export const BACKUP_ON_TITLE = 'Back up walk photos?';
export const BACKUP_ON_BODY =
  'Pawtchi will keep a private, full-size copy of each walk photo, so they come back if you reinstall or get a new phone. Only you can see them. You can turn this off at any time.';
export const BACKUP_ON_CONFIRM = 'Turn on';

export const BACKUP_OFF_TITLE = 'Turn off backup?';
export const BACKUP_OFF_BODY =
  'Your backed-up copies will be deleted, and walk photos will live only on this phone again.';
export const BACKUP_OFF_CONFIRM = 'Turn off and delete';

export const BACKUP_FAILED_TITLE = 'That didn’t save';
export const BACKUP_FAILED_BODY = 'Please check your connection and try again.';

// The one-time hint on a walk summary (hooks/useBackupHint.ts).
export const BACKUP_HINT_TITLE = 'Changing phones one day?';
export const BACKUP_HINT_BODY =
  'Walk photos live only on this phone. Turn on backup in Profile to keep them safe if you reinstall or switch phones.';
export const BACKUP_HINT_ACTION = 'Back up photos';
export const BACKUP_HINT_DISMISS = 'Not now';

// "Save walk photos to Photos" in Profile (lib/walk/exportWalkPhotos.ts).
export const EXPORT_ROW_LABEL = 'Save walk photos to Photos';
export const EXPORT_ROW_SUB = 'Copy every walk photo on this phone into your photo library';
export const EXPORT_CONFIRM_TITLE = 'Save walk photos to Photos?';
export const EXPORT_CONFIRM_BODY =
  'Every walk photo on this phone will be copied into your photo library. Running this again saves them again.';
export const EXPORT_CONFIRM = 'Save';
export const EXPORT_DENIED_TITLE = 'Pawtchi can’t add to your photos';
export const EXPORT_DENIED_BODY = 'Allow Pawtchi to add photos in your phone’s settings, then try again.';

export function exportDoneBody(saved: number, notOnPhone: number): string {
  const head = saved === 0 ? 'No walk photos were saved.' : `${saved} walk ${saved === 1 ? 'photo was' : 'photos were'} saved to your photo library.`;
  const tail = notOnPhone > 0
    ? ` ${notOnPhone} ${notOnPhone === 1 ? 'isn’t' : 'aren’t'} on this phone any more, so ${notOnPhone === 1 ? 'it' : 'they'} couldn’t be saved.`
    : '';
  return head + tail;
}
