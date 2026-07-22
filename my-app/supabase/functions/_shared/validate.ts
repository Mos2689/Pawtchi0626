/**
 * Shared input validation helpers for Edge Functions.
 *
 * Failures carry an EdgeErrorCode + an internal detail string. Callers log
 * the detail (logInternal) and return errorResponse(code) — the detail never
 * enters a response body.
 */

import type { EdgeErrorCode } from './errors.ts';

export interface ValidationFailure {
  code: EdgeErrorCode;
  /** Internal diagnostic — log it, never return it. */
  detail: string;
}

/** Maximum base64 image size: 5MB (encoded ≈ 6.67MB in base64) */
const MAX_BASE64_LENGTH = 7_000_000; // ~5MB decoded

/** Maximum JSON body size: 8MB (covers images + metadata) */
const MAX_BODY_SIZE = 8_000_000;

/**
 * Validate that a base64 image payload is within safe limits.
 * Returns a ValidationFailure if invalid, null if OK.
 */
export function validateImagePayload(
  imageBase64: string | undefined,
  mimeType: string | undefined,
): ValidationFailure | null {
  if (!imageBase64) return null; // No image is OK for some endpoints

  if (typeof imageBase64 !== 'string') {
    return { code: 'invalid_input', detail: 'imageBase64 must be a string' };
  }

  if (imageBase64.length > MAX_BASE64_LENGTH) {
    const sizeMB = (imageBase64.length * 0.75 / 1_000_000).toFixed(1);
    return { code: 'image_too_large', detail: `image ${sizeMB}MB exceeds 5MB limit` };
  }

  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (mimeType && !allowedMimes.includes(mimeType)) {
    return { code: 'invalid_input', detail: `invalid image mime type: ${mimeType}` };
  }

  return null; // Valid
}

/**
 * Safely parse the request body with size checks.
 * Returns the parsed JSON or a ValidationFailure.
 */
export async function safeParseBody(req: Request): Promise<
  | { data: Record<string, unknown>; error?: never }
  | { data?: never; error: ValidationFailure }
> {
  // Check Content-Length header if present
  const contentLength = req.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return { error: { code: 'invalid_input', detail: `body ${contentLength} bytes exceeds limit` } };
  }

  try {
    const body = await req.text();
    if (body.length > MAX_BODY_SIZE) {
      return { error: { code: 'invalid_input', detail: `body ${body.length} bytes exceeds limit` } };
    }
    const data = JSON.parse(body);
    return { data };
  } catch {
    return { error: { code: 'invalid_input', detail: 'request body is not valid JSON' } };
  }
}

/**
 * Validate that a UUID string is well-formed.
 */
export function isValidUUID(str: string | undefined): boolean {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}
