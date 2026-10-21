/**
 * Real ports for keepsakeBackup — storage, the database and the container.
 * Kept apart from the pure module so its test loads none of them.
 */

import type { BackupPorts, RestorePorts } from './keepsakeBackup';
import {
  fetchNeedingBackup,
  fetchOriginalPath,
  markBackedUp,
  signedOriginalUrl,
  updateLocalPath,
  uploadOriginal,
} from './keepsakeBackupSync';
import { keepsakeFileUri, restoreKeepsakeFile } from './keepsakeFile';

export const backupPorts: BackupPorts = {
  fetchNeedingBackup,
  fileUri: keepsakeFileUri,
  uploadOriginal,
  markBackedUp,
};

export const restorePorts: RestorePorts = {
  fetchOriginalPath,
  signedUrl: signedOriginalUrl,
  download: restoreKeepsakeFile,
  updateLocalPath,
};
