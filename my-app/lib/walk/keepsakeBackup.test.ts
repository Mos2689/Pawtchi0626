/**
 * Backup moves the oldest unprotected photos first and never claims a backup
 * it did not make; restore brings a photo back without disturbing the row
 * unless the file had to take a new name.
 */

import { backupPending, rehydrateFromBackup, type BackupPorts, type RestorePorts } from './keepsakeBackup';

function backupPorts(over: Partial<BackupPorts> = {}): BackupPorts {
  return {
    fetchNeedingBackup: jest.fn(async () => [{ id: 'k1', localPath: 'a.jpg' }, { id: 'k2', localPath: 'b.jpg' }]),
    fileUri: jest.fn((n) => (n ? `file:///${n}` : null)),
    uploadOriginal: jest.fn(async ({ ownerId, keepsakeId }) => `${ownerId}/${keepsakeId}.jpg`),
    markBackedUp: jest.fn(async () => true),
    ...over,
  };
}

describe('backupPending', () => {
  it('uploads each photo and records where its backup is', async () => {
    const p = backupPorts();
    expect(await backupPending(p, 'owner')).toEqual({ uploaded: 2, failed: 0, missing: 0 });
    expect(p.markBackedUp).toHaveBeenCalledWith('k1', 'owner/k1.jpg');
  });

  it('counts a photo whose phone copy is gone instead of uploading nothing', async () => {
    const p = backupPorts({ fileUri: jest.fn((n) => (n === 'a.jpg' ? 'file:///a.jpg' : null)) });
    expect(await backupPending(p, 'owner')).toEqual({ uploaded: 1, failed: 0, missing: 1 });
    expect(p.uploadOriginal).toHaveBeenCalledTimes(1);
  });

  it('never records a backup that did not upload', async () => {
    const p = backupPorts({ uploadOriginal: jest.fn(async () => null) });
    expect(await backupPending(p, 'owner')).toEqual({ uploaded: 0, failed: 2, missing: 0 });
    expect(p.markBackedUp).not.toHaveBeenCalled();
  });

  it('does nothing when the queue cannot be read (e.g. not migrated)', async () => {
    const p = backupPorts({ fetchNeedingBackup: jest.fn(async () => null) });
    expect(await backupPending(p, 'owner')).toEqual({ uploaded: 0, failed: 0, missing: 0 });
  });
});

function restorePorts(over: Partial<RestorePorts> = {}): RestorePorts {
  return {
    fetchOriginalPath: jest.fn(async () => 'owner/k1.jpg'),
    signedUrl: jest.fn(async () => 'https://signed'),
    download: jest.fn(async (_url, name) => ({ fileName: name ?? 'new.jpg', uri: `file:///${name ?? 'new.jpg'}` })),
    updateLocalPath: jest.fn(async () => true),
    ...over,
  };
}

describe('rehydrateFromBackup', () => {
  it('restores under the row’s own filename without touching the row', async () => {
    const p = restorePorts();
    expect(await rehydrateFromBackup(p, { id: 'k1', localPath: 'a.jpg' })).toBe('file:///a.jpg');
    expect(p.updateLocalPath).not.toHaveBeenCalled();
  });

  it('teaches the row a new filename when it had to take one', async () => {
    const p = restorePorts();
    expect(await rehydrateFromBackup(p, { id: 'k1', localPath: null })).toBe('file:///new.jpg');
    expect(p.updateLocalPath).toHaveBeenCalledWith('k1', 'new.jpg');
  });

  it('returns null when there is no backup, without downloading', async () => {
    const p = restorePorts({ fetchOriginalPath: jest.fn(async () => null) });
    expect(await rehydrateFromBackup(p, { id: 'k1', localPath: 'a.jpg' })).toBeNull();
    expect(p.download).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    const p = restorePorts({ signedUrl: jest.fn(async () => { throw new Error('offline'); }) });
    expect(await rehydrateFromBackup(p, { id: 'k1', localPath: 'a.jpg' })).toBeNull();
  });
});
