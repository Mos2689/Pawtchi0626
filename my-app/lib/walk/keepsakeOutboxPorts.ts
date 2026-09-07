/**
 * The outbox's hands.
 *
 * keepsakeOutbox.ts deliberately imports neither supabase nor the filesystem so
 * that the part with decisions in it — what to retry, what to drop, which files
 * the storage sweep may not touch — stays testable under the `lib` suite's node
 * environment. This is the one place those decisions get wired to the real
 * implementations, so every caller drains the same queue the same way.
 */

import { insertKeepsake, attachThumbnail } from './keepsakeSync';
import { uploadThumbnail } from './keepsakeThumbnail';
import { keepsakeFileUri } from './keepsakeFile';
import type { OutboxPorts } from './keepsakeOutbox';

export const outboxPorts: OutboxPorts = {
  insert: insertKeepsake,
  upload: uploadThumbnail,
  attach: attachThumbnail,
  fileUri: keepsakeFileUri,
};
