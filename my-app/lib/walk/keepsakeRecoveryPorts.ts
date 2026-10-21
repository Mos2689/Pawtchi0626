/**
 * The real ports for keepsakeRecovery — supabase, AsyncStorage, the app
 * container and the durable walk record. Kept apart from the pure module so its
 * test never loads any of them (same split as keepsakeOutboxPorts.ts).
 */

import { readJournal, removeFromJournal } from './captureJournal';
import { drainOutbox, enqueueOutbox } from './keepsakeOutbox';
import { outboxPorts } from './keepsakeOutboxPorts';
import { attachThumbnail, fetchOwnerPendingThumbnails, fetchWalkStartsBetween } from './keepsakeSync';
import { uploadThumbnail } from './keepsakeThumbnail';
import { keepsakeFileUri } from './keepsakeFile';
import { readActiveWalk } from './walkTracker';
import type { RecoveryPorts } from './keepsakeRecovery';

export const recoveryPorts: RecoveryPorts = {
  readJournal,
  removeFromJournal,
  enqueueOutbox,
  drainOutbox: () => drainOutbox(outboxPorts),
  fetchWalkStarts: fetchWalkStartsBetween,
  activeWalkStartedAt: async () => (await readActiveWalk())?.startedAt ?? null,
  fetchPendingThumbnails: (ownerId) => fetchOwnerPendingThumbnails(ownerId),
  fileUri: keepsakeFileUri,
  upload: uploadThumbnail,
  attach: attachThumbnail,
};
