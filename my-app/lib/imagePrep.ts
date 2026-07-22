// Downscale a picked photo before it crosses the network.
//
// Camera frames are 8–12 MP; Gemini vision and the avatar bucket need nothing
// beyond ~1024 px on the longest edge. Shrinking here cuts a scan payload from
// multiple MB of base64 to a few hundred KB — the single biggest lever on
// scan/upload latency — and defuses the "Image Too Large" dead end.
//
// Contract: NEVER blocks the flow it serves. On any failure (or when the image
// is already small, or dimensions are unknown) the original asset is returned
// untouched, so the behavior is exactly what it was before this helper existed.

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export const MAX_UPLOAD_EDGE = 1024;
export const UPLOAD_JPEG_QUALITY = 0.7;

export interface UploadableAsset {
  uri: string;
  width?: number;
  height?: number;
  base64?: string | null;
  mimeType?: string | null;
}

export interface PreparedImage {
  uri: string;
  base64: string | null;
  mimeType: string;
  /** True when the image was actually re-encoded (for dev logging). */
  downscaled: boolean;
}

export async function prepareImageForUpload(
  asset: UploadableAsset,
  opts?: { maxEdge?: number; compress?: number },
): Promise<PreparedImage> {
  const maxEdge = opts?.maxEdge ?? MAX_UPLOAD_EDGE;
  const compress = opts?.compress ?? UPLOAD_JPEG_QUALITY;

  const original: PreparedImage = {
    uri: asset.uri,
    base64: asset.base64 ?? null,
    mimeType: asset.mimeType || 'image/jpeg',
    downscaled: false,
  };

  // Unknown dimensions → resizing could upscale; leave the asset alone.
  if (!asset.width || !asset.height) return original;
  // Already small enough → nothing to gain from a re-encode.
  if (Math.max(asset.width, asset.height) <= maxEdge) return original;

  try {
    const resize = asset.width >= asset.height ? { width: maxEdge } : { height: maxEdge };
    const result = await manipulateAsync(asset.uri, [{ resize }], {
      compress,
      format: SaveFormat.JPEG,
      base64: true,
    });
    if (!result?.uri || !result.base64) return original;
    return { uri: result.uri, base64: result.base64, mimeType: 'image/jpeg', downscaled: true };
  } catch {
    return original;
  }
}
