/**
 * `publishOneCapture` must not call a photo published when its picture failed
 * to upload — that marked it done and it never appeared ("still arriving"
 * forever). A failed upload returns false so the publisher and sweep retry.
 */

import { publishOneCapture } from './communityMedia';

const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulate(...args),
  SaveFormat: { JPEG: 'jpeg' },
}));

const mockUpload = jest.fn();
const mockUpsert = jest.fn();
jest.mock('./supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: (...a: unknown[]) => mockUpload(...a) }) },
    from: () => ({ upsert: (...a: unknown[]) => mockUpsert(...a) }),
  },
}));

const capture = {
  uri: 'file://photo.jpg',
  width: 3000,
  height: 4000,
  capturedAt: 1_000,
  lat: -33.8,
  lng: 151.2,
  mediaId: 'media-1',
} as any;
const target = { communityWalkId: 'walk-1', contributorId: 'user-1', dogId: 'dog-1' };

describe('publishOneCapture', () => {
  beforeEach(() => {
    mockManipulate.mockReset().mockResolvedValue({ uri: 'file://display.jpg' });
    mockUpload.mockReset().mockResolvedValue({ error: null });
    mockUpsert.mockReset().mockResolvedValue({ error: null });
  });

  it('is published when the picture and the row both land', async () => {
    await expect(publishOneCapture(capture, target)).resolves.toBe(true);
    expect(mockUpsert.mock.calls[0][0].display_path).toBe('walk-1/user-1/media-1.jpg');
  });

  it('is NOT published when the upload failed, even though the row was written', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'network' } });
    await expect(publishOneCapture(capture, target)).resolves.toBe(false);
    // The moment still exists for the pack, without its picture yet.
    expect(mockUpsert.mock.calls[0][0].display_path).toBeNull();
  });

  it('is NOT published when the upload threw', async () => {
    mockUpload.mockRejectedValue(new Error('offline'));
    await expect(publishOneCapture(capture, target)).resolves.toBe(false);
  });

  it('is done when there is no picture to send at all', async () => {
    mockManipulate.mockRejectedValue(new Error('decode'));
    await expect(publishOneCapture(capture, target)).resolves.toBe(true);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('is not published when the row fails', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'rls' } });
    await expect(publishOneCapture(capture, target)).resolves.toBe(false);
  });

  it('refuses a capture without its own id', async () => {
    await expect(publishOneCapture({ ...capture, mediaId: undefined }, target)).resolves.toBe(false);
  });
});
